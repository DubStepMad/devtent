export function trimIniTrailingWhitespace(value: string): string {
  let end = value.length;
  while (end > 0) {
    const c = value.charCodeAt(end - 1);
    if (c !== 32 && c !== 9 && c !== 13 && c !== 10 && c !== 12 && c !== 11) break;
    end -= 1;
  }
  return end === value.length ? value : value.slice(0, end);
}

/** Paths in MySQL/MariaDB/PHP ini files: forward slashes, quoted. */
export function toIniFilePath(absPath: string): string {
  return absPath.replace(/\\/g, "/");
}

export function quoteIniValue(value: string): string {
  const escaped = value.replace(/"/g, '\\"');
  return `"${escaped}"`;
}

export function upsertIniDirective(content: string, key: string, value: string): string {
  const keyLower = key.toLowerCase();
  const lines = content.split(/\r?\n/);
  let replaced = false;
  const next: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    const uncommented = trimmed.startsWith(";") ? trimmed.slice(1).trim() : trimmed;
    const eq = uncommented.indexOf("=");
    if (eq === -1) {
      next.push(line);
      continue;
    }
    const lineKey = uncommented.slice(0, eq).trim().toLowerCase();
    if (lineKey !== keyLower) {
      next.push(line);
      continue;
    }
    if (replaced) continue;
    replaced = true;
    next.push(`${key}=${value}`);
  }
  if (!replaced) {
    const body = trimIniTrailingWhitespace(next.join("\n"));
    return `${body}\n${key}=${value}\n`;
  }
  return next.join("\n");
}
