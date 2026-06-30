import { open, readFile, stat, readdir } from "node:fs/promises";
import path from "node:path";
import { loadConfig, pathExists } from "./config.js";

export interface LogFileInfo {
  name: string;
  sizeBytes: number;
  modifiedAt: string;
}

function resolveLogFile(root: string, fileName: string): string {
  const logsDir = path.resolve(root, "logs");
  const base = path.basename(fileName);
  if (base !== fileName || base.includes("..")) {
    throw new Error("Invalid log file name");
  }
  const full = path.resolve(logsDir, base);
  const relative = path.relative(logsDir, full);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Log file must be inside logs/");
  }
  return full;
}

export async function listLogFiles(root: string): Promise<LogFileInfo[]> {
  const config = await loadConfig(root);
  const logsDir = path.join(root, config.paths.logs);
  if (!(await pathExists(logsDir))) return [];

  const entries = await readdir(logsDir, { withFileTypes: true });
  const files: LogFileInfo[] = [];

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const full = path.join(logsDir, entry.name);
    const info = await stat(full);
    files.push({
      name: entry.name,
      sizeBytes: info.size,
      modifiedAt: info.mtime.toISOString(),
    });
  }

  return files.sort((a, b) => a.name.localeCompare(b.name));
}

export async function readLogTail(
  root: string,
  fileName: string,
  maxLines = 500
): Promise<string> {
  const lines = Math.min(Math.max(1, maxLines), 5000);
  const full = resolveLogFile(root, fileName);
  if (!(await pathExists(full))) {
    throw new Error(`Log file not found: ${fileName}`);
  }

  const info = await stat(full);
  if (info.size === 0) return "";

  const chunkSize = Math.min(info.size, 256 * 1024);
  const handle = await open(full, "r");
  try {
    const buffer = Buffer.alloc(chunkSize);
    await handle.read(buffer, 0, chunkSize, Math.max(0, info.size - chunkSize));
    const text = buffer.toString("utf8");
    const allLines = text.split(/\r?\n/);
    if (info.size > chunkSize && allLines.length > 0) {
      allLines.shift();
    }
    return allLines.slice(-lines).join("\n");
  } finally {
    await handle.close();
  }
}

export async function readLogContent(root: string, fileName: string): Promise<string> {
  const full = resolveLogFile(root, fileName);
  if (!(await pathExists(full))) {
    throw new Error(`Log file not found: ${fileName}`);
  }
  const info = await stat(full);
  const maxBytes = 512 * 1024;
  if (info.size <= maxBytes) {
    return readFile(full, "utf8");
  }
  return readLogTail(root, fileName, 2000);
}
