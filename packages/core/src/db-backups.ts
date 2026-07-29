import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { mkdir, readdir, writeFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { resolvePath, pathExists } from "./config.js";
import { isServiceRunning } from "./services.js";
import { binaryName } from "./platform/binary.js";
import { findMysqlFamilyBinary, findPostgresBinary } from "./database-admin.js";

export const MARIADB_BACKUP_DIR = "data/backups/mariadb";
export const POSTGRES_BACKUP_DIR = "data/backups/postgresql";
export const BACKUP_RETENTION_DAYS = 7;

export interface DbBackupInfo {
  id: string;
  engine: "mariadb" | "postgresql";
  path: string;
  createdAt: string;
  sizeBytes: number;
  reason: string;
}

function runCommand(cwd: string, file: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(file, args, { cwd, shell: false, windowsHide: true, stdio: "pipe" });
    let stderr = "";
    proc.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `Command failed (${code})`));
    });
    proc.on("error", reject);
  });
}

async function pruneDir(backupRoot: string): Promise<void> {
  if (!(await pathExists(backupRoot))) return;
  const cutoff = Date.now() - BACKUP_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  for (const name of await readdir(backupRoot)) {
    const full = path.join(backupRoot, name);
    try {
      const info = await stat(full);
      if (info.isDirectory() && info.mtimeMs < cutoff) {
        await rm(full, { recursive: true, force: true });
      }
    } catch {
      // ignore
    }
  }
}

export async function backupMariaDb(
  root: string,
  reason = "manual",
  onProgress?: (msg: string) => void
): Promise<DbBackupInfo | null> {
  const log = onProgress ?? (() => {});
  const dump = await findMysqlFamilyBinary(root, "mariadb", "mysqldump");
  if (!dump) {
    log("mysqldump not found for MariaDB — skip backup");
    return null;
  }
  if (!isServiceRunning("mariadb")) {
    log("MariaDB is not running — skip backup");
    return null;
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const backupRoot = resolvePath(root, MARIADB_BACKUP_DIR);
  const backupDir = path.join(backupRoot, `${stamp}_${reason}`);
  const sqlPath = path.join(backupDir, "all-databases.sql");
  await mkdir(backupDir, { recursive: true });
  log(`Backing up MariaDB (${reason})…`);
  await runCommand(root, dump, [
    "-uroot",
    "-P3307",
    "-h127.0.0.1",
    "--all-databases",
    `--result-file=${sqlPath}`,
  ]);
  await pruneDir(backupRoot);
  const size = (await stat(sqlPath)).size;
  return {
    id: path.basename(backupDir),
    engine: "mariadb",
    path: backupDir,
    createdAt: new Date().toISOString(),
    sizeBytes: size,
    reason,
  };
}

export async function listMariaDbBackups(root: string): Promise<DbBackupInfo[]> {
  const backupRoot = resolvePath(root, MARIADB_BACKUP_DIR);
  if (!(await pathExists(backupRoot))) return [];
  const dirs = await readdir(backupRoot);
  const out: DbBackupInfo[] = [];
  for (const id of dirs) {
    const dir = path.join(backupRoot, id);
    const sql = path.join(dir, "all-databases.sql");
    if (!(await pathExists(sql))) continue;
    const info = await stat(sql);
    out.push({
      id,
      engine: "mariadb",
      path: dir,
      createdAt: info.mtime.toISOString(),
      sizeBytes: info.size,
      reason: id.includes("_") ? id.split("_").slice(1).join("_") : "manual",
    });
  }
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function backupPostgres(
  root: string,
  reason = "manual",
  onProgress?: (msg: string) => void
): Promise<DbBackupInfo | null> {
  const log = onProgress ?? (() => {});
  const pgDumpAll = await findPostgresBinary(root, "pg_dumpall");
  if (!pgDumpAll) {
    log("pg_dumpall not found — skip backup");
    return null;
  }
  if (!isServiceRunning("postgresql")) {
    log("PostgreSQL is not running — skip backup");
    return null;
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const backupRoot = resolvePath(root, POSTGRES_BACKUP_DIR);
  const backupDir = path.join(backupRoot, `${stamp}_${reason}`);
  const sqlPath = path.join(backupDir, "all-databases.sql");
  await mkdir(backupDir, { recursive: true });
  log(`Backing up PostgreSQL (${reason})…`);

  await new Promise<void>((resolve, reject) => {
    const out: Buffer[] = [];
    const proc = spawn(
      pgDumpAll,
      ["-U", "postgres", "-h", "127.0.0.1", "-p", "5432"],
      { cwd: root, shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }
    );
    let stderr = "";
    proc.stdout?.on("data", (c) => out.push(Buffer.from(c)));
    proc.stderr?.on("data", (c) => {
      stderr += String(c);
    });
    proc.on("close", async (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || `pg_dumpall failed (${code})`));
        return;
      }
      await writeFile(sqlPath, Buffer.concat(out));
      resolve();
    });
    proc.on("error", reject);
  });

  await pruneDir(backupRoot);
  const size = (await stat(sqlPath)).size;
  return {
    id: path.basename(backupDir),
    engine: "postgresql",
    path: backupDir,
    createdAt: new Date().toISOString(),
    sizeBytes: size,
    reason,
  };
}

export async function listPostgresBackups(root: string): Promise<DbBackupInfo[]> {
  const backupRoot = resolvePath(root, POSTGRES_BACKUP_DIR);
  if (!(await pathExists(backupRoot))) return [];
  const dirs = await readdir(backupRoot);
  const out: DbBackupInfo[] = [];
  for (const id of dirs) {
    const dir = path.join(backupRoot, id);
    const sql = path.join(dir, "all-databases.sql");
    if (!(await pathExists(sql))) continue;
    const info = await stat(sql);
    out.push({
      id,
      engine: "postgresql",
      path: dir,
      createdAt: info.mtime.toISOString(),
      sizeBytes: info.size,
      reason: id.includes("_") ? id.split("_").slice(1).join("_") : "manual",
    });
  }
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function maybeDailyMariaDbBackup(root: string): Promise<DbBackupInfo | null> {
  const backups = await listMariaDbBackups(root);
  const latest = backups[0];
  if (latest) {
    const age = Date.now() - new Date(latest.createdAt).getTime();
    if (age < 24 * 60 * 60 * 1000) return null;
  }
  return backupMariaDb(root, "scheduled");
}

export async function maybeDailyPostgresBackup(root: string): Promise<DbBackupInfo | null> {
  const backups = await listPostgresBackups(root);
  const latest = backups[0];
  if (latest) {
    const age = Date.now() - new Date(latest.createdAt).getTime();
    if (age < 24 * 60 * 60 * 1000) return null;
  }
  return backupPostgres(root, "scheduled");
}

export async function restoreMariaDb(
  root: string,
  backupId: string,
  onProgress?: (msg: string) => void
): Promise<{ success: boolean; message: string }> {
  const log = onProgress ?? (() => {});
  const backups = await listMariaDbBackups(root);
  const backup = backups.find((b) => b.id === backupId);
  if (!backup) {
    return { success: false, message: `Backup "${backupId}" not found` };
  }

  const sqlPath = path.join(backup.path, "all-databases.sql");
  if (!(await pathExists(sqlPath))) {
    return { success: false, message: `SQL dump missing in backup ${backupId}` };
  }

  const client =
    (await findMysqlFamilyBinary(root, "mariadb", "mariadb")) ??
    (await findMysqlFamilyBinary(root, "mariadb", "mysql"));
  if (!client) {
    return {
      success: false,
      message: `${binaryName("mysql")} / mariadb client not found — install MariaDB via Quick Add first`,
    };
  }

  if (!isServiceRunning("mariadb")) {
    return { success: false, message: "MariaDB must be running to restore a backup" };
  }

  log(`Restoring MariaDB from ${backup.id}…`);
  await new Promise<void>((resolve, reject) => {
    const proc = spawn(client, ["-uroot", "-P3307", "-h127.0.0.1"], {
      cwd: root,
      shell: false,
      windowsHide: true,
      stdio: ["pipe", "ignore", "pipe"],
    });
    let stderr = "";
    proc.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `MariaDB restore failed (${code})`));
    });
    proc.on("error", reject);
    createReadStream(sqlPath).pipe(proc.stdin!);
  });

  return { success: true, message: `Restored MariaDB from ${backupId}` };
}

export async function restorePostgres(
  root: string,
  backupId: string,
  onProgress?: (msg: string) => void
): Promise<{ success: boolean; message: string }> {
  const log = onProgress ?? (() => {});
  const backups = await listPostgresBackups(root);
  const backup = backups.find((b) => b.id === backupId);
  if (!backup) {
    return { success: false, message: `Backup "${backupId}" not found` };
  }

  const sqlPath = path.join(backup.path, "all-databases.sql");
  if (!(await pathExists(sqlPath))) {
    return { success: false, message: `SQL dump missing in backup ${backupId}` };
  }

  const psql = await findPostgresBinary(root, "psql");
  if (!psql) {
    return { success: false, message: "psql not found — install PostgreSQL via Quick Add first" };
  }

  if (!isServiceRunning("postgresql")) {
    return { success: false, message: "PostgreSQL must be running to restore a backup" };
  }

  log(`Restoring PostgreSQL from ${backup.id}…`);
  await new Promise<void>((resolve, reject) => {
    const proc = spawn(
      psql,
      ["-U", "postgres", "-h", "127.0.0.1", "-p", "5432", "-f", sqlPath],
      {
        cwd: root,
        shell: false,
        windowsHide: true,
        stdio: ["ignore", "ignore", "pipe"],
      }
    );
    let stderr = "";
    proc.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `PostgreSQL restore failed (${code})`));
    });
    proc.on("error", reject);
  });

  return { success: true, message: `Restored PostgreSQL from ${backupId}` };
}
