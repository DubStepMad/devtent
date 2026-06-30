import { app } from "electron";
import path from "node:path";
import { copyFile, mkdir, readdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { writeAppLog } from "./app-logger.js";

const MAX_BACKUPS = 3;
const BACKUP_DIR_NAME = "app";

export interface AppBinaryBackup {
  fileName: string;
  version: string;
  createdAt: number;
  sizeBytes: number;
}

function backupDir(): string {
  return path.join(app.getPath("userData"), "backups", BACKUP_DIR_NAME);
}

function metaPath(fileName: string): string {
  return path.join(backupDir(), `${fileName}.json`);
}

export async function backupAppBeforeUpdate(targetVersion: string): Promise<AppBinaryBackup | null> {
  if (!app.isPackaged) return null;

  const exePath = app.getPath("exe");
  const version = app.getVersion();
  const dir = backupDir();
  await mkdir(dir, { recursive: true });

  const stamp = Date.now();
  const fileName = `DevTent-${version}-${stamp}.exe`;
  const dest = path.join(dir, fileName);

  await copyFile(exePath, dest);
  const info = await stat(dest);

  const backup: AppBinaryBackup = {
    fileName,
    version,
    createdAt: stamp,
    sizeBytes: info.size,
  };

  await writeFile(
    metaPath(fileName),
    JSON.stringify({ ...backup, targetVersion }, null, 2),
    "utf-8"
  );

  await pruneOldBackups();
  await writeAppLog("info", `Backed up app binary before update to v${targetVersion}`, fileName);
  return backup;
}

async function pruneOldBackups(): Promise<void> {
  const backups = await listAppBackups();
  const excess = backups.slice(MAX_BACKUPS);
  for (const backup of excess) {
    await unlink(path.join(backupDir(), backup.fileName)).catch(() => {});
    await unlink(metaPath(backup.fileName)).catch(() => {});
  }
}

export async function listAppBackups(): Promise<AppBinaryBackup[]> {
  const dir = backupDir();
  try {
    const files = await readdir(dir);
    const backups: AppBinaryBackup[] = [];

    for (const file of files) {
      if (!file.endsWith(".exe")) continue;
      const metaFile = metaPath(file);
      try {
        const raw = await readFile(metaFile, "utf-8");
        backups.push(JSON.parse(raw) as AppBinaryBackup);
      } catch {
        const info = await stat(path.join(dir, file));
        backups.push({
          fileName: file,
          version: "unknown",
          createdAt: info.mtimeMs,
          sizeBytes: info.size,
        });
      }
    }

    return backups.sort((a, b) => b.createdAt - a.createdAt);
  } catch {
    return [];
  }
}

export async function rollbackAppBinary(): Promise<void> {
  if (!app.isPackaged) {
    throw new Error("Rollback is only available in the installed app");
  }

  const backups = await listAppBackups();
  const latest = backups[0];
  if (!latest) {
    throw new Error("No previous version backup found");
  }

  const exePath = app.getPath("exe");
  const backupPath = path.join(backupDir(), latest.fileName);
  const scriptPath = path.join(app.getPath("temp"), "DevTent", "rollback.cmd");

  await mkdir(path.dirname(scriptPath), { recursive: true });
  const script = `@echo off
timeout /t 2 /nobreak >nul
copy /y "${backupPath}" "${exePath}"
start "" "${exePath}"
`;
  await writeFile(scriptPath, script, "utf-8");
  await writeAppLog("info", `Rolling back to v${latest.version}`, latest.fileName);

  spawn("cmd.exe", ["/c", scriptPath], { detached: true, stdio: "ignore" }).unref();
}
