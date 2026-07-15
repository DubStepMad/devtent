import { spawn, type ChildProcess } from "node:child_process";
import { openSync, appendFileSync } from "node:fs";
import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
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

type ProcfileCache = { mtimeMs: number; entries: ProcfileEntry[] };
const procfileCache = new Map<string, ProcfileCache>();

function invalidateProcfileCache(root: string): void {
  procfileCache.delete(path.resolve(root));
}

export function clearProcfileCache(root: string): void {
  invalidateProcfileCache(root);
}

function serviceStartOrder(name: string): number {
  if (
    name.startsWith("php-cgi-") ||
    name.startsWith("php-fpm-") ||
    name === "php-fpm"
  ) {
    return 0;
  }
  const idx = ["nginx", "apache", "mysql", "mariadb", "postgresql", "redis", "mailpit"].indexOf(name);
  return idx === -1 ? 500 : idx + 10;
}

/** Logical Services-tab id "php-fpm" maps to versioned php-cgi-* / php-fpm-* Procfile rows. */
export function isPhpStackServiceName(name: string): boolean {
  return name === "php-fpm" || name.startsWith("php-cgi-") || name.startsWith("php-fpm-");
}

export function resolveProcfileServiceNames(
  entries: ProcfileEntry[],
  name: string
): string[] {
  if (name === "php-fpm") {
    const phpNames = entries
      .filter((e) => isPhpStackServiceName(e.name))
      .map((e) => e.name);
    return phpNames.length > 0 ? phpNames : [];
  }
  return entries.some((e) => e.name === name) ? [name] : [];
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

const STARTUP_VERIFY_MS = 400;
const STARTUP_READY_MS = 80;

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
  const key = path.resolve(root);
  try {
    const info = await stat(procfilePath);
    const cached = procfileCache.get(key);
    if (cached && cached.mtimeMs === info.mtimeMs) {
      return cached.entries;
    }
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

    procfileCache.set(key, { mtimeMs: info.mtimeMs, entries });
    return entries;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT") return [];
    throw err;
  }
}

async function prepareServiceStart(
  root: string,
  name: string,
  entries?: ProcfileEntry[]
): Promise<void> {
  if (name === "nginx") {
    await ensureNginxSupportFiles(root);
  }
  if (name === "apache") {
    await ensureApacheConfig(root);
    const list = entries ?? (await parseProcfile(root));
    const apache = list.find((e) => e.name === "apache");
    if (apache && needsApacheProcfileRepair(apache.command)) {
      const httpd = resolvePath(root, "bin/apache/bin/httpd.exe");
      if (await pathExists(httpd)) {
        await saveProcfileEntry(root, { name: "apache", command: APACHE_PROCFILE_COMMAND });
      }
    }
  }
  if (name === "mysql") {
    const list = entries ?? (await parseProcfile(root));
    const mysql = list.find((e) => e.name === "mysql");
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

async function waitForStartup(child: ChildProcess): Promise<boolean> {
  const started = Date.now();
  while (Date.now() - started < STARTUP_VERIFY_MS) {
    if (!isChildAlive(child)) return false;
    if (Date.now() - started >= STARTUP_READY_MS) return true;
    await waitMs(40);
  }
  return isChildAlive(child);
}

export async function startService(
  root: string,
  name: string,
  options?: { entry?: ProcfileEntry; entries?: ProcfileEntry[]; configLogsDir?: string }
): Promise<ServiceStatus> {
  const entries = options?.entries ?? (await parseProcfile(root));

  // UI / profile use logical "php-fpm"; Procfile has php-cgi-8.3 / php-fpm-8.3 after sync.
  if (name === "php-fpm" && !options?.entry) {
    const phpNames = resolveProcfileServiceNames(entries, "php-fpm");
    if (phpNames.length === 0) {
      throw new Error(
        `Service "php-fpm" not found in Procfile — install PHP via Quick Add and sync the profile`
      );
    }
    const results: ServiceStatus[] = [];
    for (const phpName of phpNames) {
      results.push(
        await startService(root, phpName, {
          entries,
          configLogsDir: options?.configLogsDir,
        })
      );
    }
    const running = results.filter((r) => r.running);
    if (running.length === 0) {
      return {
        name: "php-fpm",
        running: false,
        error: results.find((r) => r.error)?.error ?? "PHP processes exited during startup",
      };
    }
    return {
      name: "php-fpm",
      running: true,
      pid: running[0]?.pid,
      startedAt: running[0]?.startedAt,
    };
  }

  const entry = options?.entry ?? entries.find((e) => e.name === name);

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

  await prepareServiceStart(root, name, entries);

  const logsDir =
    options?.configLogsDir ?? (await loadConfig(root)).paths.logs;
  await mkdir(resolvePath(root, logsDir), { recursive: true });
  await mkdir(resolvePath(root, "tmp"), { recursive: true });

  const logPath = path.join(root, logsDir, `${name}.log`);
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

  const alive = await waitForStartup(child);

  if (!alive) {
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
  // Expand logical php-fpm → all versioned PHP processes currently running or in Procfile
  if (name === "php-fpm") {
    const entries = root ? await parseProcfile(root) : [];
    const fromProcfile = resolveProcfileServiceNames(entries, "php-fpm");
    const fromRunning = [...runningProcesses.keys()].filter((n) => isPhpStackServiceName(n));
    const names = [...new Set([...fromProcfile, ...fromRunning])];
    if (names.length === 0) {
      return { name: "php-fpm", running: false };
    }
    for (const phpName of names) {
      await stopService(phpName, root, options);
    }
    return { name: "php-fpm", running: false };
  }

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

  const config = await loadConfig(root);
  await mkdir(resolvePath(root, config.paths.logs), { recursive: true });
  await mkdir(resolvePath(root, "tmp"), { recursive: true });

  // Start by wave so PHP CGI comes up before web servers, but services in a wave run in parallel.
  const waves = new Map<number, ProcfileEntry[]>();
  for (const entry of toStart) {
    const order = serviceStartOrder(entry.name);
    const wave = waves.get(order) ?? [];
    wave.push(entry);
    waves.set(order, wave);
  }

  const results: ServiceStatus[] = [];
  for (const order of [...waves.keys()].sort((a, b) => a - b)) {
    const wave = waves.get(order)!;
    const waveResults = await Promise.all(
      wave.map(async (entry) => {
        try {
          return await startService(root, entry.name, {
            entry,
            entries,
            configLogsDir: config.paths.logs,
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return { name: entry.name, running: false, error: message } satisfies ServiceStatus;
        }
      })
    );
    results.push(...waveResults);
  }
  return results;
}

export async function stopAll(
  root?: string,
  services?: string[],
  options?: { skipBackup?: boolean }
): Promise<ServiceStatus[]> {
  // Bulk stop skips MySQL dump by default — daily backup covers that; keep dump on single stop.
  const skipBackup = options?.skipBackup !== false;
  const names = services ?? [...runningProcesses.keys()];
  const results = await Promise.all(
    names.map((name) => stopService(name, root, { skipBackup }))
  );
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

  // Services UI uses logical id "php-fpm" — surface aggregate status when versioned PHP is running
  const phpRunning = statuses.filter((s) => isPhpStackServiceName(s.name) && s.name !== "php-fpm");
  if (phpRunning.length > 0 && !statuses.some((s) => s.name === "php-fpm")) {
    statuses.push({
      name: "php-fpm",
      running: true,
      pid: phpRunning[0]?.pid,
      startedAt: phpRunning[0]?.startedAt,
      uptime: phpRunning[0]?.uptime,
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
  invalidateProcfileCache(root);
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
