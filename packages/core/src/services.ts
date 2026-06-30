import { spawn, type ChildProcess } from "node:child_process";
import { openSync } from "node:fs";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { loadConfig, resolvePath, pathExists } from "./config.js";
import type { ProcfileEntry, ServiceStatus } from "./types.js";
import { backupMysql } from "./mysql.js";

const runningProcesses = new Map<string, { process: ChildProcess; startedAt: Date }>();

export async function parseProcfile(root: string): Promise<ProcfileEntry[]> {
  const procfilePath = path.join(root, "Procfile");
  if (!(await pathExists(procfilePath))) return [];

  const content = await readFile(procfilePath, "utf-8");
  const entries: ProcfileEntry[] = [];

  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const colonIdx = trimmed.indexOf(":");
    if (colonIdx === -1) continue;

    const name = trimmed.slice(0, colonIdx).trim();
    const command = trimmed.slice(colonIdx + 1).trim();
    if (name && command) {
      entries.push({ name, command });
    }
  }

  return entries;
}

export async function startService(root: string, name: string): Promise<ServiceStatus> {
  const entries = await parseProcfile(root);
  const entry = entries.find((e) => e.name === name);

  if (!entry) {
    throw new Error(`Service "${name}" not found in Procfile`);
  }

  if (runningProcesses.has(name)) {
    const existing = runningProcesses.get(name)!;
    return {
      name,
      running: true,
      pid: existing.process.pid,
      startedAt: existing.startedAt.toISOString(),
    };
  }

  const config = await loadConfig(root);
  await mkdir(resolvePath(root, config.paths.logs), { recursive: true });

  const logPath = path.join(root, config.paths.logs, `${name}.log`);
  const logFd = openSync(logPath, "a");

  const child = spawn(entry.command, [], {
    cwd: root,
    shell: true,
    detached: process.platform !== "win32",
    stdio: ["ignore", logFd, logFd],
    env: { ...process.env, DEVTENT_ROOT: root },
  });

  child.unref();

  const startedAt = new Date();
  runningProcesses.set(name, { process: child, startedAt });

  child.on("exit", () => {
    runningProcesses.delete(name);
  });

  return {
    name,
    running: true,
    pid: child.pid,
    startedAt: startedAt.toISOString(),
  };
}

export async function stopService(name: string, root?: string, options?: { skipBackup?: boolean }): Promise<ServiceStatus> {
  const entry = runningProcesses.get(name);
  if (!entry) {
    return { name, running: false };
  }

  if (name === "mysql" && root && !options?.skipBackup) {
    try {
      await backupMysql(root, "before-stop");
    } catch {
      // Continue stopping even if backup fails
    }
  }

  const { process: child } = entry;

  if (process.platform === "win32" && child.pid) {
    spawn("taskkill", ["/pid", String(child.pid), "/f", "/t"], { shell: true });
  } else {
    child.kill("SIGTERM");
  }

  runningProcesses.delete(name);
  return { name, running: false };
}

export async function startAll(root: string, services?: string[]): Promise<ServiceStatus[]> {
  const entries = await parseProcfile(root);
  const toStart = services
    ? entries.filter((e) => services.includes(e.name))
    : entries;

  const results: ServiceStatus[] = [];
  for (const entry of toStart) {
    results.push(await startService(root, entry.name));
  }
  return results;
}

export async function stopAll(
  root?: string,
  services?: string[],
  options?: { skipBackup?: boolean }
): Promise<ServiceStatus[]> {
  const names = services ?? [...runningProcesses.keys()];
  const results: ServiceStatus[] = [];
  for (const name of names) {
    results.push(await stopService(name, root, options));
  }
  return results;
}

export function getServiceStatuses(): ServiceStatus[] {
  return [...runningProcesses.entries()].map(([name, { process, startedAt }]) => ({
    name,
    running: true,
    pid: process.pid,
    startedAt: startedAt.toISOString(),
    uptime: Date.now() - startedAt.getTime(),
  }));
}

export async function saveProcfileEntry(root: string, entry: ProcfileEntry): Promise<void> {
  const entries = await parseProcfile(root);
  const idx = entries.findIndex((e) => e.name === entry.name);
  if (idx >= 0) {
    entries[idx] = entry;
  } else {
    entries.push(entry);
  }

  const content = entries.map((e) => `${e.name}: ${e.command}`).join("\n") + "\n";
  await writeFile(path.join(root, "Procfile"), content, "utf-8");
}

export function isServiceRunning(name: string): boolean {
  return runningProcesses.has(name);
}
