import { app } from "electron";
import path from "node:path";
import { appendFile, mkdir, readFile, stat } from "node:fs/promises";

export const APP_LOG_VIRTUAL_NAME = "__app__.log";

let logPath: string | null = null;

function getLogPath(): string {
  if (!logPath) {
    logPath = path.join(app.getPath("userData"), "logs", "app.log");
  }
  return logPath;
}

function formatDetail(detail: unknown): string {
  if (detail instanceof Error) {
    return detail.stack ?? detail.message;
  }
  if (typeof detail === "string") return detail;
  try {
    return JSON.stringify(detail);
  } catch {
    return String(detail);
  }
}

export async function writeAppLog(
  level: "info" | "warn" | "error",
  message: string,
  detail?: unknown
): Promise<void> {
  const file = getLogPath();
  await mkdir(path.dirname(file), { recursive: true });
  const suffix = detail !== undefined ? ` ${formatDetail(detail)}` : "";
  const line = `[${new Date().toISOString()}] ${level.toUpperCase()} ${message}${suffix}\n`;
  await appendFile(file, line, "utf-8");
}

export function initAppLogger(): void {
  void writeAppLog("info", `DevTent ${app.getVersion()} starting`);

  process.on("uncaughtException", (err) => {
    void writeAppLog("error", "uncaughtException", err);
  });

  process.on("unhandledRejection", (reason) => {
    void writeAppLog("error", "unhandledRejection", reason);
  });
}

export async function getAppLogInfo(): Promise<{
  name: string;
  sizeBytes: number;
  modifiedAt: number;
} | null> {
  const file = getLogPath();
  try {
    const info = await stat(file);
    return {
      name: APP_LOG_VIRTUAL_NAME,
      sizeBytes: info.size,
      modifiedAt: info.mtimeMs,
    };
  } catch {
    return null;
  }
}

export async function readAppLogTail(maxLines = 500): Promise<string> {
  const file = getLogPath();
  try {
    const raw = await readFile(file, "utf-8");
    const lines = raw.split(/\r?\n/).filter(Boolean);
    return lines.slice(-maxLines).join("\n");
  } catch {
    return "";
  }
}
