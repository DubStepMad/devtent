import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, readFile, readdir, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import { resolvePath, pathExists } from "./config.js";
import { listVirtualHosts } from "./vhosts.js";
import { ensureCloudflared, cloudflaredHomeEnv } from "./share.js";

export interface NamedTunnel {
  id: string;
  name: string;
  credentialsFile: string;
  hostname?: string;
  siteName?: string;
  localUrl?: string;
  createdAt: string;
}

export interface NamedTunnelRuntime extends NamedTunnel {
  running: boolean;
  pid?: number;
}

interface TunnelRegistry {
  tunnels: NamedTunnel[];
}

const REGISTRY = "etc/cloudflared/registry.json";
const activeNamed = new Map<string, ChildProcess>();

function cloudflaredDir(root: string): string {
  return resolvePath(root, "etc/cloudflared");
}

async function loadRegistry(root: string): Promise<TunnelRegistry> {
  const p = resolvePath(root, REGISTRY);
  if (!(await pathExists(p))) return { tunnels: [] };
  try {
    const data = JSON.parse(await readFile(p, "utf-8")) as TunnelRegistry;
    return { tunnels: Array.isArray(data.tunnels) ? data.tunnels : [] };
  } catch {
    return { tunnels: [] };
  }
}

async function saveRegistry(root: string, registry: TunnelRegistry): Promise<void> {
  await mkdir(cloudflaredDir(root), { recursive: true });
  await writeFile(resolvePath(root, REGISTRY), JSON.stringify(registry, null, 2) + "\n", "utf-8");
}

function configPathFor(root: string, tunnel: NamedTunnel): string {
  return path.join(cloudflaredDir(root), `${tunnel.name}.yml`);
}

async function writeTunnelConfig(root: string, tunnel: NamedTunnel): Promise<string> {
  const cfg = configPathFor(root, tunnel);
  const creds = path.join(cloudflaredDir(root), tunnel.credentialsFile).replace(/\\/g, "/");
  const lines = [
    `tunnel: ${tunnel.id}`,
    `credentials-file: ${creds}`,
    "ingress:",
  ];
  if (tunnel.hostname && tunnel.localUrl) {
    lines.push(`  - hostname: ${tunnel.hostname}`);
    lines.push(`    service: ${tunnel.localUrl}`);
    // Disable TLS verify for local mkcert / self-signed origins
    if (tunnel.localUrl.startsWith("https://")) {
      lines.push("    originRequest:");
      lines.push("      noTLSVerify: true");
    }
  }
  lines.push("  - service: http_status:404");
  lines.push("");
  await writeFile(cfg, lines.join("\n"), "utf-8");
  return cfg;
}

function runCloudflared(
  binary: string,
  root: string,
  args: string[],
  opts?: { inherit?: boolean }
): Promise<{ code: number; output: string }> {
  return new Promise((resolve, reject) => {
    let output = "";
    const child = spawn(binary, args, {
      cwd: cloudflaredDir(root),
      windowsHide: true,
      stdio: opts?.inherit ? "inherit" : ["ignore", "pipe", "pipe"],
      env: cloudflaredHomeEnv(root),
    });
    child.stdout?.on("data", (c) => {
      output += String(c);
    });
    child.stderr?.on("data", (c) => {
      output += String(c);
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? 1, output }));
  });
}

export async function cloudflareLoginStatus(root: string): Promise<{ loggedIn: boolean; certPath: string }> {
  const certPath = path.join(cloudflaredDir(root), ".cloudflared", "cert.pem");
  // With HOME override, cert lands in HOME/.cloudflared/cert.pem — our HOME is etc/cloudflared
  const alt = path.join(cloudflaredDir(root), "cert.pem");
  const loggedIn = (await pathExists(certPath)) || (await pathExists(alt));
  return { loggedIn, certPath: (await pathExists(certPath)) ? certPath : alt };
}

export async function loginCloudflare(
  root: string,
  manifestsDir: string,
  onProgress?: (msg: string) => void
): Promise<{ ok: boolean; message: string }> {
  await mkdir(cloudflaredDir(root), { recursive: true });
  const binary = await ensureCloudflared(root, manifestsDir, onProgress);
  onProgress?.("Opening Cloudflare login in your browser…");

  const result = await runCloudflared(binary, root, ["tunnel", "login"], { inherit: false });
  const status = await cloudflareLoginStatus(root);
  if (status.loggedIn) {
    return { ok: true, message: "Cloudflare account linked for named tunnels" };
  }
  return {
    ok: false,
    message: result.output.trim() || "Login did not complete — try again and finish the browser flow",
  };
}

export async function createNamedTunnel(
  root: string,
  manifestsDir: string,
  name: string,
  onProgress?: (msg: string) => void
): Promise<NamedTunnel> {
  const safe = name.trim().toLowerCase().replace(/[^a-z0-9-]/g, "-");
  if (!safe || safe.length > 64) throw new Error("Invalid tunnel name");

  const login = await cloudflareLoginStatus(root);
  if (!login.loggedIn) {
    throw new Error("Run Cloudflare login first (Share → Named tunnels → Login)");
  }

  const registry = await loadRegistry(root);
  if (registry.tunnels.some((t) => t.name === safe)) {
    throw new Error(`Tunnel already exists: ${safe}`);
  }

  const binary = await ensureCloudflared(root, manifestsDir, onProgress);
  onProgress?.(`Creating named tunnel ${safe}…`);
  const result = await runCloudflared(binary, root, ["tunnel", "create", safe]);
  if (result.code !== 0) {
    throw new Error(result.output.trim() || `Failed to create tunnel ${safe}`);
  }

  // Credentials JSON is written next to cloudflared home
  const homeCf = path.join(cloudflaredDir(root), ".cloudflared");
  const files = (await pathExists(homeCf)) ? await readdir(homeCf) : await readdir(cloudflaredDir(root));
  const jsonFiles = files.filter((f) => f.endsWith(".json"));
  // Prefer newest matching create output UUID
  const uuidMatch = result.output.match(
    /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i
  );
  let credentialsFile = uuidMatch ? `${uuidMatch[1]}.json` : "";
  if (credentialsFile && !(await pathExists(path.join(homeCf, credentialsFile)))) {
    if (await pathExists(path.join(cloudflaredDir(root), credentialsFile))) {
      // ok
    } else {
      credentialsFile = "";
    }
  }
  if (!credentialsFile) {
    const candidates = [];
    for (const f of jsonFiles) {
      const full = path.join(homeCf, f);
      if (await pathExists(full)) candidates.push({ f, full, dir: homeCf });
      else candidates.push({ f, full: path.join(cloudflaredDir(root), f), dir: cloudflaredDir(root) });
    }
    // Pick file that isn't registry
    const pick = candidates.find((c) => c.f !== "cert.pem" && c.f.endsWith(".json"));
    if (!pick) throw new Error("Tunnel created but credentials file was not found");
    credentialsFile = pick.f;
  }

  // Normalize credentials into etc/cloudflared/<uuid>.json
  const srcA = path.join(homeCf, credentialsFile);
  const srcB = path.join(cloudflaredDir(root), credentialsFile);
  const src = (await pathExists(srcA)) ? srcA : srcB;
  const dest = path.join(cloudflaredDir(root), credentialsFile);
  if (src !== dest) {
    const raw = await readFile(src, "utf-8");
    await writeFile(dest, raw, "utf-8");
  }

  let id = uuidMatch?.[1] ?? "";
  if (!id) {
    try {
      const creds = JSON.parse(await readFile(dest, "utf-8")) as { TunnelID?: string; tunnelID?: string };
      id = creds.TunnelID ?? creds.tunnelID ?? credentialsFile.replace(/\.json$/i, "");
    } catch {
      id = credentialsFile.replace(/\.json$/i, "");
    }
  }

  const tunnel: NamedTunnel = {
    id,
    name: safe,
    credentialsFile,
    createdAt: new Date().toISOString(),
  };
  registry.tunnels.push(tunnel);
  await saveRegistry(root, registry);
  await writeTunnelConfig(root, tunnel);
  return tunnel;
}

export async function listNamedTunnels(root: string): Promise<NamedTunnelRuntime[]> {
  const registry = await loadRegistry(root);
  return registry.tunnels.map((t) => ({
    ...t,
    running: activeNamed.has(t.name),
    pid: activeNamed.get(t.name)?.pid,
  }));
}

export async function configureNamedTunnel(
  root: string,
  manifestsDir: string,
  tunnelName: string,
  options: { siteName: string; hostname: string },
  onProgress?: (msg: string) => void
): Promise<NamedTunnel> {
  const registry = await loadRegistry(root);
  const tunnel = registry.tunnels.find((t) => t.name === tunnelName);
  if (!tunnel) throw new Error(`Unknown tunnel: ${tunnelName}`);

  const vhosts = await listVirtualHosts(root);
  const vhost = vhosts.find((v) => v.name === options.siteName);
  if (!vhost) throw new Error(`Site not found: ${options.siteName}`);

  const hostname = options.hostname.trim().toLowerCase();
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(hostname)) {
    throw new Error("Invalid hostname");
  }

  const scheme = vhost.ssl ? "https" : "http";
  tunnel.hostname = hostname;
  tunnel.siteName = vhost.name;
  tunnel.localUrl = `${scheme}://${vhost.domain}`;
  await saveRegistry(root, registry);
  await writeTunnelConfig(root, tunnel);

  const binary = await ensureCloudflared(root, manifestsDir, onProgress);
  onProgress?.(`Routing DNS ${hostname} → tunnel ${tunnel.name}…`);
  const route = await runCloudflared(binary, root, ["tunnel", "route", "dns", tunnel.name, hostname]);
  if (route.code !== 0 && !/already|exist/i.test(route.output)) {
    // Non-fatal if DNS route needs dashboard — config still saved
    onProgress?.(route.output.trim() || "DNS route may need Cloudflare dashboard confirmation");
  }

  return tunnel;
}

export async function startNamedTunnel(
  root: string,
  manifestsDir: string,
  tunnelName: string,
  onProgress?: (msg: string) => void
): Promise<NamedTunnelRuntime> {
  if (activeNamed.has(tunnelName)) {
    const list = await listNamedTunnels(root);
    return list.find((t) => t.name === tunnelName)!;
  }

  const registry = await loadRegistry(root);
  const tunnel = registry.tunnels.find((t) => t.name === tunnelName);
  if (!tunnel) throw new Error(`Unknown tunnel: ${tunnelName}`);
  if (!tunnel.hostname || !tunnel.localUrl) {
    throw new Error("Configure a hostname and site before starting this tunnel");
  }

  const binary = await ensureCloudflared(root, manifestsDir, onProgress);
  const cfg = await writeTunnelConfig(root, tunnel);
  onProgress?.(`Starting named tunnel ${tunnel.name}…`);

  const child = spawn(binary, ["tunnel", "--config", cfg, "run", tunnel.name], {
    cwd: cloudflaredDir(root),
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: cloudflaredHomeEnv(root),
  });
  activeNamed.set(tunnel.name, child);
  child.on("exit", () => {
    activeNamed.delete(tunnel.name);
  });

  return {
    ...tunnel,
    running: true,
    pid: child.pid,
  };
}

export async function stopNamedTunnel(tunnelName: string): Promise<void> {
  const child = activeNamed.get(tunnelName);
  if (!child) return;
  child.kill();
  activeNamed.delete(tunnelName);
}

export async function deleteNamedTunnel(
  root: string,
  manifestsDir: string,
  tunnelName: string,
  onProgress?: (msg: string) => void
): Promise<void> {
  await stopNamedTunnel(tunnelName);
  const registry = await loadRegistry(root);
  const tunnel = registry.tunnels.find((t) => t.name === tunnelName);
  if (!tunnel) return;

  try {
    const binary = await ensureCloudflared(root, manifestsDir, onProgress);
    await runCloudflared(binary, root, ["tunnel", "delete", "-f", tunnel.name]);
  } catch {
    // best-effort remote delete
  }

  registry.tunnels = registry.tunnels.filter((t) => t.name !== tunnelName);
  await saveRegistry(root, registry);

  for (const f of [configPathFor(root, tunnel), path.join(cloudflaredDir(root), tunnel.credentialsFile)]) {
    if (await pathExists(f)) {
      try {
        await unlink(f);
      } catch {
        // ignore
      }
    }
  }
}
