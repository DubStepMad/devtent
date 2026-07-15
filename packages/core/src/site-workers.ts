import path from "node:path";
import { resolvePath, pathExists } from "./config.js";
import { listVirtualHosts } from "./vhosts.js";
import { parseProcfile, saveProcfileEntry } from "./services.js";
import { readFile, writeFile } from "node:fs/promises";
import type { ProcfileEntry } from "./types.js";

export type SiteWorkerKind = "queue" | "vite";

export interface SiteWorkerStatus {
  siteName: string;
  kind: SiteWorkerKind;
  procfileName: string;
  enabled: boolean;
  command: string;
}

function workerName(siteName: string, kind: SiteWorkerKind): string {
  return `${kind}-${siteName}`;
}

function buildCommand(root: string, projectPath: string, kind: SiteWorkerKind): string {
  const rel = path.relative(root, projectPath).replace(/\\/g, "/") || ".";
  if (kind === "queue") {
    return `php ${rel}/artisan queue:work --sleep=1 --tries=1`;
  }
  return `npx --yes vite --host 127.0.0.1 --port 5173 --strictPort`;
}

export async function listSiteWorkers(root: string): Promise<SiteWorkerStatus[]> {
  const vhosts = await listVirtualHosts(root);
  const entries = await parseProcfile(root);
  const byName = new Map(entries.map((e) => [e.name, e]));
  const out: SiteWorkerStatus[] = [];
  for (const v of vhosts) {
    const projectPath = v.projectPath ?? resolvePath(root, path.join("www", v.name));
    for (const kind of ["queue", "vite"] as SiteWorkerKind[]) {
      const name = workerName(v.name, kind);
      const existing = byName.get(name);
      const command = existing?.command ?? buildCommand(root, projectPath, kind);
      out.push({
        siteName: v.name,
        kind,
        procfileName: name,
        enabled: Boolean(existing),
        command,
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
  const vhosts = await listVirtualHosts(root);
  const vhost = vhosts.find((v) => v.name === siteName);
  if (!vhost) throw new Error(`Site not found: ${siteName}`);
  const projectPath = vhost.projectPath ?? resolvePath(root, path.join("www", siteName));
  const name = workerName(siteName, kind);
  const command = buildCommand(root, projectPath, kind);

  if (enabled) {
    if (kind === "queue") {
      const artisan = path.join(projectPath, "artisan");
      if (!(await pathExists(artisan))) {
        throw new Error(`${siteName} is not a Laravel project (no artisan)`);
      }
    }
    await saveProcfileEntry(root, { name, command } satisfies ProcfileEntry);
  } else {
    const procfilePath = resolvePath(root, "Procfile");
    if (await pathExists(procfilePath)) {
      const raw = await readFile(procfilePath, "utf-8");
      const entries = (await parseProcfile(root)).filter((e) => e.name !== name);
      const headerMatch = raw.match(/^(?:#.*\r?\n)*/);
      const header = headerMatch?.[0] ?? "";
      const body = entries.map((e) => `${e.name}: ${e.command}`).join("\n");
      await writeFile(procfilePath, `${header}${body}${body ? "\n" : ""}`, "utf-8");
    }
  }

  return {
    siteName,
    kind,
    procfileName: name,
    enabled,
    command,
  };
}
