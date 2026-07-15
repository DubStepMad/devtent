import { spawn, type ChildProcess } from "node:child_process";
import { resolvePath, pathExists } from "./config.js";
import { listVirtualHosts } from "./vhosts.js";
import { installFromManifest, loadManifest } from "./quick-add.js";
import { binaryName, binPath } from "./platform/binary.js";

export interface ShareSession {
  siteName: string;
  domain: string;
  publicUrl: string;
  pid?: number;
}

const activeShares = new Map<string, { process: ChildProcess; publicUrl: string }>();

/** Isolate cloudflared credentials under the DevTent root (named tunnels + login). */
export function cloudflaredHomeEnv(root: string): NodeJS.ProcessEnv {
  const home = resolvePath(root, "etc/cloudflared");
  return {
    ...process.env,
    DEVTENT_ROOT: root,
    HOME: home,
    USERPROFILE: home,
  };
}

export async function ensureCloudflared(
  root: string,
  manifestsDir: string,
  onProgress?: (msg: string) => void
): Promise<string> {
  const binary = resolvePath(root, binPath(["bin", "cloudflared", "cloudflared"]));
  if (await pathExists(binary)) return binary;

  const manifest = await loadManifest(manifestsDir, "cloudflared");
  await installFromManifest(root, manifest, onProgress);
  if (!(await pathExists(binary))) {
    throw new Error(`${binaryName("cloudflared")} install failed`);
  }
  return binary;
}

function parseTunnelUrl(output: string): string | undefined {
  const match = output.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
  return match?.[0];
}

export async function startShare(
  root: string,
  manifestsDir: string,
  siteName: string,
  onProgress?: (msg: string) => void
): Promise<ShareSession> {
  if (activeShares.has(siteName)) {
    const existing = activeShares.get(siteName)!;
    const vhosts = await listVirtualHosts(root);
    const vhost = vhosts.find((v) => v.name === siteName);
    return {
      siteName,
      domain: vhost?.domain ?? `${siteName}.test`,
      publicUrl: existing.publicUrl,
      pid: existing.process.pid,
    };
  }

  const vhosts = await listVirtualHosts(root);
  const vhost = vhosts.find((v) => v.name === siteName);
  if (!vhost) {
    throw new Error(`Site not found: ${siteName}`);
  }

  const cloudflared = await ensureCloudflared(root, manifestsDir, onProgress);
  const scheme = vhost.ssl ? "https" : "http";
  const localUrl = `${scheme}://${vhost.domain}`;

  onProgress?.(`Starting tunnel for ${localUrl}…`);

  return new Promise((resolve, reject) => {
    let settled = false;
    let output = "";
    const child = spawn(cloudflared, ["tunnel", "--url", localUrl], {
      cwd: root,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, DEVTENT_ROOT: root },
    });

    const tryResolve = () => {
      const url = parseTunnelUrl(output);
      if (!url || settled) return;
      settled = true;
      activeShares.set(siteName, { process: child, publicUrl: url });
      resolve({
        siteName,
        domain: vhost.domain,
        publicUrl: url,
        pid: child.pid,
      });
    };

    child.stdout?.on("data", (chunk) => {
      output += String(chunk);
      tryResolve();
    });
    child.stderr?.on("data", (chunk) => {
      output += String(chunk);
      tryResolve();
    });

    child.on("error", (err) => {
      if (!settled) reject(err);
    });

    child.on("exit", (code) => {
      activeShares.delete(siteName);
      if (!settled) {
        reject(new Error(`cloudflared exited (${code}) — ${output.trim()}`));
      }
    });

    setTimeout(() => {
      if (!settled) {
        child.kill();
        reject(new Error("Tunnel timed out — is the web server running?"));
      }
    }, 45000);
  });
}

export async function stopShare(siteName: string): Promise<void> {
  const session = activeShares.get(siteName);
  if (!session) return;
  session.process.kill();
  activeShares.delete(siteName);
}

export function listActiveShares(root?: string, vhosts?: { name: string; domain: string }[]): ShareSession[] {
  return [...activeShares.entries()].map(([siteName, session]) => {
    const vhost = vhosts?.find((v) => v.name === siteName);
    return {
      siteName,
      domain: vhost?.domain ?? `${siteName}.test`,
      publicUrl: session.publicUrl,
      pid: session.process.pid,
    };
  });
}
