import { createSocket, type Socket } from "node:dgram";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadConfig, resolvePath, pathExists } from "./config.js";
import { normalizeTld } from "./domain.js";
import { launchUnixElevated } from "./platform/hosts-elevate-unix.js";

export const LOCAL_DNS_PORT = 15353;
const STATE_FILE = "etc/dns/state.json";

export interface LocalDnsStatus {
  running: boolean;
  port: number;
  tld: string;
  bind: string;
  resolverInstalled: boolean;
  resolverPath?: string;
  message: string;
}

interface DnsStateFile {
  enabled?: boolean;
}

let dnsSocket: Socket | null = null;
let answeringTld = "localhost";

function encodeName(name: string): Buffer {
  const labels = name.replace(/\.$/, "").split(".").filter(Boolean);
  const parts: number[] = [];
  for (const label of labels) {
    const buf = Buffer.from(label, "utf8");
    parts.push(buf.length, ...buf);
  }
  parts.push(0);
  return Buffer.from(parts);
}

function parseQuestionName(msg: Buffer, offset: number): { name: string; next: number } {
  const labels: string[] = [];
  let i = offset;
  let jumped = false;
  let next = offset;
  while (i < msg.length) {
    const len = msg[i];
    if (len === 0) {
      if (!jumped) next = i + 1;
      break;
    }
    if ((len & 0xc0) === 0xc0) {
      const ptr = ((len & 0x3f) << 8) | msg[i + 1];
      if (!jumped) next = i + 2;
      i = ptr;
      jumped = true;
      continue;
    }
    i += 1;
    labels.push(msg.subarray(i, i + len).toString("utf8"));
    i += len;
    if (!jumped) next = i;
  }
  return { name: labels.join(".").toLowerCase(), next };
}

function buildAResponse(query: Buffer, qname: string): Buffer | null {
  if (query.length < 12) return null;
  const qCount = query.readUInt16BE(4);
  if (qCount < 1) return null;

  const { next } = parseQuestionName(query, 12);
  if (next + 4 > query.length) return null;
  const qtype = query.readUInt16BE(next);
  const qclass = query.readUInt16BE(next + 2);
  const suffix = `.${answeringTld}`;
  const matches =
    qname === answeringTld ||
    qname.endsWith(suffix) ||
    qname === "localhost" ||
    qname.endsWith(".localhost");

  const question = query.subarray(12, next + 4);
  const header = Buffer.alloc(12);
  query.copy(header, 0, 0, 12);
  header[2] = 0x84; // response + AA
  header[3] = 0x80; // RA
  header.writeUInt16BE(1, 4);
  header.writeUInt16BE(0, 8);
  header.writeUInt16BE(0, 10);

  if (!matches || (qtype !== 1 && qtype !== 255)) {
    header.writeUInt16BE(0, 6);
    return Buffer.concat([header, question]);
  }

  const nameBuf = encodeName(qname);
  const answer = Buffer.alloc(nameBuf.length + 14);
  nameBuf.copy(answer, 0);
  let o = nameBuf.length;
  answer.writeUInt16BE(1, o);
  answer.writeUInt16BE(qclass || 1, o + 2);
  answer.writeUInt32BE(30, o + 4);
  answer.writeUInt16BE(4, o + 8);
  answer[o + 10] = 127;
  answer[o + 11] = 0;
  answer[o + 12] = 0;
  answer[o + 13] = 1;
  header.writeUInt16BE(1, 6);
  return Buffer.concat([header, question, answer]);
}

async function readState(root: string): Promise<DnsStateFile> {
  const p = resolvePath(root, STATE_FILE);
  if (!(await pathExists(p))) return {};
  try {
    return JSON.parse(await readFile(p, "utf-8")) as DnsStateFile;
  } catch {
    return {};
  }
}

async function writeState(root: string, state: DnsStateFile): Promise<void> {
  const dir = resolvePath(root, "etc/dns");
  await mkdir(dir, { recursive: true });
  await writeFile(resolvePath(root, STATE_FILE), JSON.stringify(state, null, 2) + "\n", "utf-8");
}

export function isLocalDnsRunning(): boolean {
  return dnsSocket !== null;
}

export async function getLocalDnsStatus(root: string): Promise<LocalDnsStatus> {
  const config = await loadConfig(root);
  const tld = normalizeTld(config.tld);
  const resolverPath =
    process.platform === "darwin" ? `/etc/resolver/${tld}` : undefined;
  let resolverInstalled = false;
  if (resolverPath && (await pathExists(resolverPath))) {
    try {
      const content = await readFile(resolverPath, "utf-8");
      resolverInstalled = content.includes("127.0.0.1") && content.includes(String(LOCAL_DNS_PORT));
    } catch {
      resolverInstalled = false;
    }
  }

  const running = isLocalDnsRunning();
  let message: string;
  if (running) {
    message = `Answering *.${tld} → 127.0.0.1 on ${LOCAL_DNS_PORT}`;
  } else if (tld === "localhost") {
    message = "Not needed for .localhost (browsers resolve it automatically)";
  } else {
    message = `Start local DNS for wildcard *.${tld} without editing hosts for every site`;
  }

  return {
    running,
    port: LOCAL_DNS_PORT,
    tld,
    bind: "127.0.0.1",
    resolverInstalled,
    resolverPath,
    message,
  };
}

export async function startLocalDns(root: string): Promise<LocalDnsStatus> {
  if (dnsSocket) return getLocalDnsStatus(root);

  const config = await loadConfig(root);
  answeringTld = normalizeTld(config.tld);

  await new Promise<void>((resolve, reject) => {
    const socket = createSocket("udp4");
    socket.on("error", (err) => {
      dnsSocket = null;
      reject(err);
    });
    socket.on("message", (msg, rinfo) => {
      try {
        const { name } = parseQuestionName(msg, 12);
        const response = buildAResponse(msg, name);
        if (response) socket.send(response, rinfo.port, rinfo.address);
      } catch {
        // ignore malformed
      }
    });
    socket.bind(LOCAL_DNS_PORT, "127.0.0.1", () => {
      dnsSocket = socket;
      resolve();
    });
  });

  await writeState(root, { enabled: true });
  return getLocalDnsStatus(root);
}

export async function stopLocalDns(root: string): Promise<LocalDnsStatus> {
  if (dnsSocket) {
    await new Promise<void>((resolve) => {
      dnsSocket!.close(() => resolve());
    });
    dnsSocket = null;
  }
  await writeState(root, { enabled: false });
  return getLocalDnsStatus(root);
}

/**
 * macOS: install /etc/resolver/<tld> so the OS asks DevTent DNS for that TLD.
 * Linux/Windows: returns setup guidance (hosts file or systemd-resolved).
 */
export async function installLocalDnsResolver(
  root: string
): Promise<{ ok: boolean; message: string; scriptFile?: string }> {
  const config = await loadConfig(root);
  const tld = normalizeTld(config.tld);

  if (tld === "localhost") {
    return {
      ok: true,
      message: ".localhost needs no resolver — browsers already map it to 127.0.0.1",
    };
  }

  if (process.platform === "darwin") {
    const tmpDir = resolvePath(root, "tmp");
    await mkdir(tmpDir, { recursive: true });
    const staged = path.join(tmpDir, `devtent-resolver-${tld}`);
    const content = `# DevTent local DNS\nnameserver 127.0.0.1\nport ${LOCAL_DNS_PORT}\n`;
    await writeFile(staged, content, "utf-8");

    const scriptFile = path.join(tmpDir, `devtent-install-resolver-${tld}.sh`);
    const script = [
      "#!/bin/sh",
      "set -e",
      "mkdir -p /etc/resolver",
      `cp "${staged}" "/etc/resolver/${tld}"`,
      `echo "DevTent: installed /etc/resolver/${tld}"`,
      "",
    ].join("\n");
    await writeFile(scriptFile, script, "utf-8");
    await chmod(scriptFile, 0o755);
    await launchUnixElevated(scriptFile);

    return {
      ok: true,
      message: `Approve the admin prompt to install /etc/resolver/${tld}. Then start local DNS.`,
      scriptFile,
    };
  }

  if (process.platform === "linux") {
    return {
      ok: false,
      message:
        `Start DevTent DNS (port ${LOCAL_DNS_PORT}), then point your resolver at 127.0.0.1:${LOCAL_DNS_PORT} for *.${tld}, or use Update hosts for per-site entries.`,
    };
  }

  return {
    ok: false,
    message:
      `Windows: use Update hosts (Admin) for *.${tld}, or start DevTent DNS on port ${LOCAL_DNS_PORT} and configure a local resolver that forwards that TLD.`,
  };
}

export async function ensureLocalDnsFromState(root: string): Promise<void> {
  const state = await readState(root);
  if (state.enabled && !isLocalDnsRunning()) {
    try {
      await startLocalDns(root);
    } catch {
      // Port may be busy — doctor will surface status
    }
  }
}
