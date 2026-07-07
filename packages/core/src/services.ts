import { spawn, type ChildProcess } from "node:child_process";
import { openSync, appendFileSync } from "node:fs";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { loadConfig, resolvePath, pathExists } from "./config.js";
import type { ProcfileEntry, ServiceStatus } from "./types.js";
import { backupMysql, writeMysqlIni } from "./mysql.js";
import { writeMariaDbIni } from "./mariadb.js";
import { ensureNginxSupportFiles } from "./nginx-support.js";
import { ensurePhpCaptureForVersion } from "./dump-capture.js";
import { phpVersionFromProcfileName } from "./php-ports.js";
import { resolvePhpPaths } from "./profile-runtime.js";
import { ensureApacheConfig, APACHE_PROCFILE_COMMAND, needsApacheProcfileRepair } from "./apache-support.js";

const runningProcesses = new Map<string, { process: ChildProcess; startedAt: Date }>();

function serviceStartOrder(name: string): number {
  if (name.startsWith("php-cgi-") || name === "php-fpm") return 0;
  const idx = ["nginx", "apache", "mysql", "mariadb", "postgresql", "redis", "mailpit"].indexOf(name);
  return idx === -1 ? 500 : idx + 10;
}

function sortEntriesForStart(entries: ProcfileEntry[]): ProcfileEntry[] {
  return [...entries].sort((a, b) => serviceStartOrder(a.name) - serviceStartOrder(b.name));
}

export function parseProcfileCommand(command: string): { executable: string; args: string[] } {
  const tokens: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < command.length; i++) {
    const ch = command[i]!;
    if (ch === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (!inQuotes && /\s/.test(ch)) {
      if (current) tokens.push(current);
      current = "";
      continue;
    }
    current += ch;
  }

  if (current) tokens.push(current);

  if (!tokens.length) {
    throw new Error(`Invalid Procfile command: ${command}`);
  }
  return { executable: tokens[0]!, args: tokens.slice(1) };
}

const STARTUP_VERIFY_MS = 600;

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function isChildAlive(child: ChildProcess): boolean {
  if (child.exitCode !== null || child.signalCode !== null) return false;
  if (!child.pid) return false;
  return isPidAlive(child.pid);
}

function waitMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function appendServiceLog(logPath: string, message: string): void {
  try {
    appendFileSync(logPath, `\n[devtent] ${message}\n`);
  } catch {
    // ignore
  }
}

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

async function prepareServiceStart(root: string, name: string): Promise<void> {
  if (name === "nginx") {
    await ensureNginxSupportFiles(root);
  }
  if (name === "apache") {
    await ensureApacheConfig(root);
    const entries = await parseProcfile(root);
    const apache = entries.find((e) => e.name === "apache");
    if (apache && needsApacheProcfileRepair(apache.command)) {
      const httpd = resolvePath(root, "bin/apache/bin/httpd.exe");
      if (await pathExists(httpd)) {
        await saveProcfileEntry(root, { name: "apache", command: APACHE_PROCFILE_COMMAND });
      }
    }
  }
  if (name === "mysql") {
    const entries = await parseProcfile(root);
    const mysql = entries.find((e) => e.name === "mysql");
    if (mysql && !mysql.command.includes("--defaults-file=")) {
      await saveProcfileEntry(root, {
        name: "mysql",
        command: "bin/mysql/bin/mysqld.exe --defaults-file=etc/mysql/my.ini --console",
      });
    }
    await writeMysqlIni(root);
  }
  if (name === "mariadb") {
    await writeMariaDbIni(root);
  }
  const phpVersion = phpVersionFromProcfileName(name);
  if (phpVersion) {
    await ensurePhpCaptureForVersion(root, phpVersion);
  }
}

export async function startService(root: string, name: string): Promise<ServiceStatus> {
  const entries = await parseProcfile(root);
  const entry = entries.find((e) => e.name === name);

  if (!entry) {
    throw new Error(`Service "${name}" not found in Procfile`);
  }

  if (isServiceRunning(name)) {
    const existing = runningProcesses.get(name)!;
    return {
      name,
      running: true,
      pid: existing.process.pid,
      startedAt: existing.startedAt.toISOString(),
    };
  }

  await prepareServiceStart(root, name);

  const config = await loadConfig(root);
  await mkdir(resolvePath(root, config.paths.logs), { recursive: true });
  await mkdir(resolvePath(root, "tmp"), { recursive: true });

  const logPath = path.join(root, config.paths.logs, `${name}.log`);
  const logFd = openSync(logPath, "a");

  const { executable, args } = parseProcfileCommand(entry.command);
  const exePath = resolvePath(root, executable);
  if (!(await pathExists(exePath))) {
    throw new Error(`Service "${name}" binary not found: ${executable}`);
  }

  const spawnEnv: NodeJS.ProcessEnv = { ...process.env, DEVTENT_ROOT: root };
  const phpVersion = phpVersionFromProcfileName(name);
  if (phpVersion) {
    const paths = resolvePhpPaths(phpVersion);
    spawnEnv.PHPRC = resolvePath(root, paths.phpRc);
  }

  const child = spawn(exePath, args, {
    cwd: root,
    shell: false,
    windowsHide: true,
    detached: process.platform !== "win32",
    stdio: ["ignore", logFd, logFd],
    env: spawnEnv,
  });

  if (!child.pid) {
    throw new Error(`Service "${name}" failed to start`);
  }

  if (process.platform !== "win32") {
    child.unref();
  }

  const startedAt = new Date();
  runningProcesses.set(name, { process: child, startedAt });

  child.on("exit", (code, signal) => {
    runningProcesses.delete(name);
    appendServiceLog(
      logPath,
      `Process exited (code=${code ?? "null"}, signal=${signal ?? "null"})`
    );
  });

  await waitMs(STARTUP_VERIFY_MS);

  if (!isChildAlive(child)) {
    runningProcesses.delete(name);
    return {
      name,
      running: false,
      error: `Exited during startup — see logs/${name}.log`,
    };
  }

  return {
    name,
    running: true,
    pid: child.pid,
    startedAt: startedAt.toISOString(),
  };
}

export async function restartService(root: string, name: string): Promise<ServiceStatus> {
  await stopService(name, root);
  await waitMs(300);
  return startService(root, name);
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
  const toStart = sortEntriesForStart(
    services ? entries.filter((e) => services.includes(e.name)) : entries
  );

  const results: ServiceStatus[] = [];
  for (const entry of toStart) {
    try {
      results.push(await startService(root, entry.name));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      results.push({ name: entry.name, running: false, error: message });
    }
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
  const statuses: ServiceStatus[] = [];
  for (const [name, { process, startedAt }] of runningProcesses.entries()) {
    if (!isChildAlive(process)) {
      runningProcesses.delete(name);
      continue;
    }
    statuses.push({
      name,
      running: true,
      pid: process.pid,
      startedAt: startedAt.toISOString(),
      uptime: Date.now() - startedAt.getTime(),
    });
  }
  return statuses;
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
  const entry = runningProcesses.get(name);
  if (!entry) return false;
  if (!isChildAlive(entry.process)) {
    runningProcesses.delete(name);
    return false;
  }
  return true;
}
