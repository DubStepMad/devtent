import { spawn } from "node:child_process";
import { mkdir, readdir, readFile, writeFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { resolvePath, pathExists } from "./config.js";
import { isServiceRunning } from "./services.js";

export const MYSQL_BACKUP_DIR = "data/backups/mysql";
export const BACKUP_RETENTION_DAYS = 7;

export interface MysqlBackupInfo {
  id: string;
  path: string;
  createdAt: string;
  sizeBytes: number;
  reason: string;
}

async function findMysqlBinary(root: string, name: string): Promise<string | null> {
  const candidates = [
    resolvePath(root, `bin/mysql/bin/${name}`),
    resolvePath(root, `bin/mysql/${name}`),
  ];
  for (const candidate of candidates) {
    if (await pathExists(candidate)) return candidate;
  }
  return null;
}

export async function writeMysqlIni(root: string): Promise<void> {
  const iniDir = path.join(root, "etc", "mysql");
  await mkdir(iniDir, { recursive: true });

  const content = `[mysqld]
port=3306
datadir=data/mysql
basedir=bin/mysql
console
default_authentication_plugin=mysql_native_password
max_allowed_packet=512M
`;
  await writeFile(path.join(iniDir, "my.ini"), content, "utf-8");
}

export async function isMysqlDataInitialized(root: string): Promise<boolean> {
  const dataDir = resolvePath(root, "data/mysql");
  if (!(await pathExists(dataDir))) return false;
  if (await pathExists(path.join(dataDir, "ibdata1"))) return true;
  if (await pathExists(path.join(dataDir, "mysql"))) return true;
  return false;
}

function runCommand(cwd: string, command: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, [], { cwd, shell: true, stdio: "pipe" });
    let stderr = "";
    proc.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `Command failed (${code}): ${command}`));
    });
    proc.on("error", reject);
  });
}

export async function initializeMysql(root: string, onProgress?: (msg: string) => void): Promise<void> {
  const log = onProgress ?? (() => {});
  if (await isMysqlDataInitialized(root)) {
    log("MySQL data directory already initialized");
    return;
  }

  const mysqld = await findMysqlBinary(root, "mysqld.exe");
  if (!mysqld) {
    throw new Error("mysqld.exe not found — install MySQL via Quick Add first");
  }

  await mkdir(resolvePath(root, "data/mysql"), { recursive: true });
  await writeMysqlIni(root);
  log("Initializing MySQL data directory…");
  await runCommand(root, `"${mysqld}" --initialize-insecure --datadir=data/mysql`);
  log("MySQL data directory ready");
}

export async function backupMysql(
  root: string,
  reason = "manual",
  onProgress?: (msg: string) => void
): Promise<MysqlBackupInfo | null> {
  const log = onProgress ?? (() => {});
  const mysqldump = await findMysqlBinary(root, "mysqldump.exe");
  if (!mysqldump) {
    log("mysqldump.exe not found — skip backup");
    return null;
  }

  if (!isServiceRunning("mysql")) {
    log("MySQL is not running — skip backup");
    return null;
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const backupRoot = resolvePath(root, MYSQL_BACKUP_DIR);
  const backupDir = path.join(backupRoot, `${stamp}_${reason}`);
  const sqlPath = path.join(backupDir, "all-databases.sql");

  await mkdir(backupDir, { recursive: true });
  log(`Backing up MySQL (${reason})…`);

  await runCommand(root, `"${mysqldump}" -uroot --all-databases --result-file="${sqlPath}"`);

  const info: MysqlBackupInfo = {
    id: path.basename(backupDir),
    path: backupDir,
    createdAt: new Date().toISOString(),
    sizeBytes: (await stat(sqlPath)).size,
    reason,
  };

  await writeFile(
    path.join(backupDir, "manifest.json"),
    JSON.stringify(info, null, 2),
    "utf-8"
  );

  await pruneMysqlBackups(root);
  log(`MySQL backup saved → ${path.relative(root, sqlPath)}`);
  return info;
}

export async function listMysqlBackups(root: string): Promise<MysqlBackupInfo[]> {
  const backupRoot = resolvePath(root, MYSQL_BACKUP_DIR);
  if (!(await pathExists(backupRoot))) return [];

  const entries = await readdir(backupRoot, { withFileTypes: true });
  const backups: MysqlBackupInfo[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const manifestPath = path.join(backupRoot, entry.name, "manifest.json");
    const sqlPath = path.join(backupRoot, entry.name, "all-databases.sql");
    if (await pathExists(manifestPath)) {
      const raw = await readFile(manifestPath, "utf-8");
      backups.push(JSON.parse(raw) as MysqlBackupInfo);
      continue;
    }
    if (await pathExists(sqlPath)) {
      const st = await stat(sqlPath);
      backups.push({
        id: entry.name,
        path: path.join(backupRoot, entry.name),
        createdAt: st.mtime.toISOString(),
        sizeBytes: st.size,
        reason: "legacy",
      });
    }
  }

  return backups.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function restoreMysql(
  root: string,
  backupId: string,
  onProgress?: (msg: string) => void
): Promise<{ success: boolean; message: string }> {
  const log = onProgress ?? (() => {});
  const backups = await listMysqlBackups(root);
  const backup = backups.find((b) => b.id === backupId);
  if (!backup) {
    return { success: false, message: `Backup "${backupId}" not found` };
  }

  const sqlPath = path.join(backup.path, "all-databases.sql");
  if (!(await pathExists(sqlPath))) {
    return { success: false, message: `SQL dump missing in backup ${backupId}` };
  }

  const mysql = await findMysqlBinary(root, "mysql.exe");
  if (!mysql) {
    return { success: false, message: "mysql.exe not found — install MySQL via Quick Add first" };
  }

  if (!isServiceRunning("mysql")) {
    return { success: false, message: "MySQL must be running to restore a backup" };
  }

  log(`Restoring MySQL from ${backup.id}…`);
  const cmd =
    process.platform === "win32"
      ? `type "${sqlPath}" | "${mysql}" -uroot`
      : `"${mysql}" -uroot < "${sqlPath}"`;
  await runCommand(root, cmd);
  log("MySQL restore completed");
  return { success: true, message: `Restored MySQL from backup ${backup.id}` };
}

export async function pruneMysqlBackups(root: string, keepDays = BACKUP_RETENTION_DAYS): Promise<void> {
  const backups = await listMysqlBackups(root);
  const cutoff = Date.now() - keepDays * 24 * 60 * 60 * 1000;

  for (const backup of backups) {
    if (new Date(backup.createdAt).getTime() < cutoff) {
      await rm(backup.path, { recursive: true, force: true });
    }
  }
}

export async function maybeDailyMysqlBackup(root: string): Promise<MysqlBackupInfo | null> {
  const backups = await listMysqlBackups(root);
  const latest = backups[0];
  if (latest) {
    const age = Date.now() - new Date(latest.createdAt).getTime();
    if (age < 24 * 60 * 60 * 1000) return null;
  }
  return backupMysql(root, "scheduled");
}
