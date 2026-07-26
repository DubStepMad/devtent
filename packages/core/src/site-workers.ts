import path from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { loadConfig, loadProfile, resolvePath, pathExists } from "./config.js";
import { listVirtualHosts } from "./vhosts.js";
import { parseProcfile, saveProcfileEntry, clearProcfileCache } from "./services.js";
import { DEFAULT_PHP_VERSION, resolvePhpPaths } from "./profile-runtime.js";
import { resolveNodePaths } from "./node-runtime.js";
import { npmLauncher } from "./platform/binary.js";
import type { ProcfileEntry } from "./types.js";

export type SiteWorkerKind = "queue" | "vite" | "schedule";

export interface SiteWorkerStatus {
  siteName: string;
  kind: SiteWorkerKind;
  procfileName: string;
  enabled: boolean;
  command: string;
  /** Assigned Vite port when kind is vite. */
  port?: number;
}

export const VITE_BASE_PORT = 5173;
export const VITE_PORT_RANGE = 100;

const WORKER_KINDS: SiteWorkerKind[] = ["queue", "vite", "schedule"];

export function workerName(siteName: string, kind: SiteWorkerKind): string {
  return `${kind}-${siteName}`;
}

/** Stable preferred Vite port for a site name (5173–5272). */
export function preferredVitePort(siteName: string): number {
  let hash = 0;
  for (let i = 0; i < siteName.length; i++) {
    hash = (hash * 31 + siteName.charCodeAt(i)) >>> 0;
  }
  return VITE_BASE_PORT + (hash % VITE_PORT_RANGE);
}

/** Parse `--port N` from an existing vite Procfile command. */
export function parseVitePortFromCommand(command: string): number | undefined {
  const match = command.match(/--port\s+(\d+)/i);
  if (!match) return undefined;
  const port = Number(match[1]);
  return Number.isFinite(port) ? port : undefined;
}

export function allocateVitePort(
  siteName: string,
  usedPorts: Iterable<number>
): number {
  const used = new Set(usedPorts);
  const preferred = preferredVitePort(siteName);
  for (let offset = 0; offset < VITE_PORT_RANGE; offset++) {
    const port = VITE_BASE_PORT + ((preferred - VITE_BASE_PORT + offset) % VITE_PORT_RANGE);
    if (!used.has(port)) return port;
  }
  return preferred;
}

async function resolvePhpCli(root: string, siteName: string): Promise<string> {
  const [config, vhosts] = await Promise.all([
    loadConfig(root),
    listVirtualHosts(root),
  ]);
  const profile = await loadProfile(root, config.activeProfile);
  const vhost = vhosts.find((v) => v.name === siteName);
  const phpVersion = vhost?.phpVersion ?? profile.phpVersion ?? DEFAULT_PHP_VERSION;
  return resolvePhpPaths(phpVersion).cli;
}

async function resolveNodeCli(root: string): Promise<string> {
  const config = await loadConfig(root);
  const profile = await loadProfile(root, config.activeProfile);
  if (profile.nodeVersion) {
    const paths = resolveNodePaths(profile.nodeVersion);
    if (await pathExists(resolvePath(root, paths.cli))) {
      return paths.cli;
    }
  }
  // Fall back to npx on PATH via a relative shim name — startService resolves PATH when missing under root.
  return npmLauncher() === "npm.cmd" ? "npx.cmd" : "npx";
}

async function buildCommand(
  root: string,
  siteName: string,
  projectPath: string,
  kind: SiteWorkerKind,
  vitePort?: number
): Promise<string> {
  if (kind === "queue" || kind === "schedule") {
    const phpCli = await resolvePhpCli(root, siteName);
    const artisanArgs =
      kind === "queue"
        ? "artisan queue:work --sleep=1 --tries=1"
        : "artisan schedule:work";
    return `${phpCli} ${artisanArgs}`;
  }

  const port = vitePort ?? preferredVitePort(siteName);
  const nodeCli = await resolveNodeCli(root);
  const viteJs = path
    .join(path.relative(root, projectPath) || ".", "node_modules", "vite", "bin", "vite.js")
    .replace(/\\/g, "/");
  // Prefer managed node + project's vite.js; fall back to npx when node path is the launcher.
  if (nodeCli.endsWith("npx") || nodeCli.endsWith("npx.cmd")) {
    return `${nodeCli} --yes vite --host 127.0.0.1 --port ${port} --strictPort`;
  }
  return `${nodeCli} ${viteJs} --host 127.0.0.1 --port ${port} --strictPort`;
}

function collectUsedVitePorts(entries: ProcfileEntry[], exceptSite?: string): Set<number> {
  const used = new Set<number>();
  for (const entry of entries) {
    if (!entry.name.startsWith("vite-")) continue;
    const site = entry.name.slice("vite-".length);
    if (exceptSite && site === exceptSite) continue;
    const port = parseVitePortFromCommand(entry.command);
    if (port !== undefined) used.add(port);
  }
  return used;
}

export async function listSiteWorkers(root: string): Promise<SiteWorkerStatus[]> {
  const vhosts = await listVirtualHosts(root);
  const entries = await parseProcfile(root);
  const byName = new Map(entries.map((e) => [e.name, e]));
  const out: SiteWorkerStatus[] = [];
  for (const v of vhosts) {
    const projectPath = v.projectPath ?? resolvePath(root, path.join("www", v.name));
    for (const kind of WORKER_KINDS) {
      const name = workerName(v.name, kind);
      const existing = byName.get(name);
      const port =
        kind === "vite"
          ? parseVitePortFromCommand(existing?.command ?? "") ?? preferredVitePort(v.name)
          : undefined;
      const command =
        existing?.command ?? (await buildCommand(root, v.name, projectPath, kind, port));
      out.push({
        siteName: v.name,
        kind,
        procfileName: name,
        enabled: Boolean(existing),
        command,
        port,
      });
    }
  }
  return out;
}

export async function setSiteWorker(
  root: string,
  siteName: string,
  kind: SiteWorkerKind,
  enabled: boolean
): Promise<SiteWorkerStatus> {
  if (!WORKER_KINDS.includes(kind)) {
    throw new Error(`Unknown worker kind: ${kind}`);
  }
  const vhosts = await listVirtualHosts(root);
  const vhost = vhosts.find((v) => v.name === siteName);
  if (!vhost) throw new Error(`Site not found: ${siteName}`);
  const projectPath = vhost.projectPath ?? resolvePath(root, path.join("www", siteName));
  const name = workerName(siteName, kind);

  let port: number | undefined;
  let command: string;

  if (enabled) {
    if (kind === "queue" || kind === "schedule") {
      const artisan = path.join(projectPath, "artisan");
      if (!(await pathExists(artisan))) {
        throw new Error(`${siteName} is not a Laravel project (no artisan)`);
      }
    }
    if (kind === "vite") {
      const viteJs = path.join(projectPath, "node_modules", "vite", "bin", "vite.js");
      const entries = await parseProcfile(root);
      port = allocateVitePort(siteName, collectUsedVitePorts(entries, siteName));
      const nodeCli = await resolveNodeCli(root);
      if (!nodeCli.endsWith("npx") && !nodeCli.endsWith("npx.cmd")) {
        if (!(await pathExists(viteJs))) {
          throw new Error(
            `${siteName} has no Vite install (expected node_modules/vite). Run npm install in the project first.`
          );
        }
        if (!(await pathExists(resolvePath(root, nodeCli)))) {
          throw new Error("Node is not installed — install Node via Tooling or Quick Add first");
        }
      }
    }
    command = await buildCommand(root, siteName, projectPath, kind, port);
    await saveProcfileEntry(root, { name, command } satisfies ProcfileEntry);
    try {
      const { startService } = await import("./services.js");
      await startService(root, name);
    } catch (err) {
      // Procfile row stays so Start All / retry works; surface the error.
      throw err instanceof Error ? err : new Error(String(err));
    }
  } else {
    try {
      const { stopService } = await import("./services.js");
      await stopService(name, root, { skipBackup: true });
    } catch {
      // Not running is fine
    }
    const procfilePath = resolvePath(root, "Procfile");
    if (await pathExists(procfilePath)) {
      const raw = await readFile(procfilePath, "utf-8");
      const entries = (await parseProcfile(root)).filter((e) => e.name !== name);
      const headerMatch = raw.match(/^(?:#.*\r?\n)*/);
      const header = headerMatch?.[0] ?? "";
      const body = entries.map((e) => `${e.name}: ${e.command}`).join("\n");
      await writeFile(procfilePath, `${header}${body}${body ? "\n" : ""}`, "utf-8");
      clearProcfileCache(root);
    }
    command = await buildCommand(root, siteName, projectPath, kind);
    if (kind === "vite") port = preferredVitePort(siteName);
  }

  return {
    siteName,
    kind,
    procfileName: name,
    enabled,
    command,
    port: kind === "vite" ? port ?? preferredVitePort(siteName) : undefined,
  };
}

/** Resolve project cwd for queue/vite/schedule Procfile services. */
export async function resolveWorkerCwd(
  root: string,
  serviceName: string
): Promise<string | undefined> {
  const match = serviceName.match(/^(?:queue|vite|schedule)-(.+)$/);
  if (!match) return undefined;
  const siteName = match[1]!;
  const vhosts = await listVirtualHosts(root);
  const vhost = vhosts.find((v) => v.name === siteName);
  return vhost?.projectPath ?? resolvePath(root, path.join("www", siteName));
}

export function isSiteWorkerServiceName(name: string): boolean {
  return /^(?:queue|vite|schedule)-/.test(name);
}
