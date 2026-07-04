import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { loadConfig, pathExists } from "./config.js";
import { listLogFiles } from "./logs.js";

export interface LogSearchMatch {
  fileName: string;
  lineNumber: number;
  line: string;
  column: number;
}

export interface LogFileLocation {
  filePath: string;
  line: number;
  column?: number;
  raw: string;
}

const MAX_PARSE_LINE_LENGTH = 8192;
const SOURCE_EXT = "(?:php|js|ts|tsx|jsx|vue|py|rb|go|java)";
/** Bounded path chars — avoids ReDoS from [^\s:]+ on slash-heavy input. */
const PATH_CHARS = String.raw`[A-Za-z0-9_./\\-]{1,512}`;
const LINE_NUM = String.raw`\d{1,9}`;

const LOCATION_PATTERNS: RegExp[] = [
  new RegExp(String.raw`\(([^()]+\.${SOURCE_EXT}):(${LINE_NUM})\)`, "gi"),
  new RegExp(
    String.raw`\bin\s+((?:[A-Za-z]:\\${PATH_CHARS}|\/${PATH_CHARS})\.${SOURCE_EXT})\s+on\s+line\s+(${LINE_NUM})`,
    "gi"
  ),
  new RegExp(
    String.raw`((?:[A-Za-z]:\\${PATH_CHARS}|\/${PATH_CHARS})\.${SOURCE_EXT})\((${LINE_NUM})\)`,
    "gi"
  ),
  new RegExp(
    String.raw`((?:[A-Za-z]:\\${PATH_CHARS}|\/${PATH_CHARS})\.${SOURCE_EXT}):(${LINE_NUM})`,
    "g"
  ),
];

function resolveLogFilePath(root: string, fileName: string): string {
  const logsDir = path.resolve(root, "logs");
  const base = path.basename(fileName);
  if (base !== fileName || base.includes("..")) {
    throw new Error("Invalid log file name");
  }
  return path.resolve(logsDir, base);
}

async function readLogLines(root: string, fileName: string): Promise<string[]> {
  const full = resolveLogFilePath(root, fileName);
  if (!(await pathExists(full))) return [];
  const info = await stat(full);
  if (info.size === 0) return [];
  const maxBytes = 2 * 1024 * 1024;
  const content =
    info.size <= maxBytes
      ? await readFile(full, "utf-8")
      : await readFile(full, "utf-8").then((text) => {
          const lines = text.split(/\r?\n/);
          return lines.slice(-5000).join("\n");
        });
  return content.split(/\r?\n/);
}

export async function searchLogFiles(
  root: string,
  query: string,
  options?: { fileName?: string; maxResults?: number }
): Promise<LogSearchMatch[]> {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const maxResults = options?.maxResults ?? 200;
  const files = options?.fileName
    ? [{ name: options.fileName }]
    : (await listLogFiles(root)).map((f) => ({ name: f.name }));

  const matches: LogSearchMatch[] = [];

  for (const file of files) {
    const lines = await readLogLines(root, file.name);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const idx = line.toLowerCase().indexOf(q);
      if (idx === -1) continue;
      matches.push({
        fileName: file.name,
        lineNumber: i + 1,
        line,
        column: idx + 1,
      });
      if (matches.length >= maxResults) return matches;
    }
  }

  return matches;
}

export function parseLogLineLocations(line: string, root?: string): LogFileLocation[] {
  if (line.length > MAX_PARSE_LINE_LENGTH) return [];

  const found: LogFileLocation[] = [];
  const seen = new Set<string>();

  for (const pattern of LOCATION_PATTERNS) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(line)) !== null) {
      const filePath = match[1].replace(/\//g, path.sep);
      const lineNum = Number(match[2]);
      if (!Number.isFinite(lineNum)) continue;
      const key = `${filePath}:${lineNum}`;
      if (seen.has(key)) continue;
      seen.add(key);
      found.push({
        filePath: root ? resolveProjectPath(root, filePath) : filePath,
        line: lineNum,
        raw: match[0],
      });
    }
  }

  return found;
}

function resolveProjectPath(root: string, filePath: string): string {
  if (path.isAbsolute(filePath)) return filePath;
  return path.join(root, filePath);
}

export async function listLogFilesWithMeta(root: string): Promise<
  Array<{ name: string; sizeBytes: number; modifiedAt: string; label?: string }>
> {
  const config = await loadConfig(root);
  const files = await listLogFiles(root);
  return files.map((f) => ({
    ...f,
    label: f.name.endsWith("-error.log")
      ? `${f.name} (error)`
      : f.name.endsWith("-access.log")
        ? `${f.name} (access)`
        : f.name,
  }));
}
