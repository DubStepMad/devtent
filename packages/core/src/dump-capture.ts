import { appendFile, mkdir, open, readFile, writeFile, stat } from "node:fs/promises";
import path from "node:path";
import { resolvePath, pathExists } from "./config.js";
import { resolvePhpPaths } from "./profile-runtime.js";

export const DUMPS_LOG = "logs/dumps.jsonl";
export const LARAVEL_QUERY_CAPTURE_MARKER = "DevTent live query capture";
export const LARAVEL_TELEMETRY_MARKER = "DevTent live Laravel telemetry v2";
export const CAPTURE_PHP_VERSION = 3;

export type DumpEventType =
  | "dump"
  | "dd"
  | "error"
  | "exception"
  | "query"
  | "job"
  | "view"
  | "request"
  | "log"
  | "cache"
  | "http";

export interface DumpEvent {
  ts: number;
  type: DumpEventType;
  site?: string;
  message: string;
  file?: string;
  line?: number;
  context?: string;
}

const CAPTURE_PHP = `<?php
declare(strict_types=1);
// DevTent capture v${CAPTURE_PHP_VERSION}

$root = getenv('DEVTENT_ROOT') ?: '';
$logFile = $root !== '' ? $root . DIRECTORY_SEPARATOR . 'logs' . DIRECTORY_SEPARATOR . 'dumps.jsonl' : '';

function devtent_dump_site(): ?string {
    $host = $_SERVER['HTTP_HOST'] ?? $_SERVER['SERVER_NAME'] ?? null;
    if (!is_string($host) || $host === '') return null;
    return strtolower(preg_replace('/:\\d+$/', '', $host) ?: $host);
}

function devtent_dump_log(string $type, array $payload): void {
    global $logFile;
    if ($logFile === '') return;
    $site = devtent_dump_site();
    if ($site !== null && !isset($payload['site'])) {
        $payload['site'] = $site;
    }
    $line = json_encode(['ts' => microtime(true), 'type' => $type] + $payload, JSON_UNESCAPED_UNICODE);
    if ($line === false) return;
    @file_put_contents($logFile, $line . "\\n", FILE_APPEND | LOCK_EX);
}

set_exception_handler(function (Throwable $e): void {
    devtent_dump_log('exception', [
        'message' => $e->getMessage(),
        'file' => $e->getFile(),
        'line' => $e->getLine(),
    ]);
});

set_error_handler(function (int $severity, string $message, string $file, int $line): bool {
    if (!(error_reporting() & $severity)) return false;
    devtent_dump_log('error', ['message' => $message, 'file' => $file, 'line' => $line]);
    return false;
});

spl_autoload_register(static function (string $class): void {
    static $hooked = false;
    if ($hooked || $class !== 'Symfony\\\\Component\\\\VarDumper\\\\VarDumper') return;
    if (!class_exists($class, false)) return;
    $hooked = true;
    \\Symfony\\Component\\VarDumper\\VarDumper::setHandler(static function ($var) {
        ob_start();
        $cloner = new \\Symfony\\Component\\VarDumper\\Cloner\\VarCloner();
        $dumper = new \\Symfony\\Component\\VarDumper\\Dumper\\CliDumper();
        $dumper->dump($cloner->cloneVar($var));
        $output = (string) ob_get_clean();
        devtent_dump_log('dump', ['message' => $output !== '' ? $output : 'dump']);
    });
}, true, true);
`;

export async function ensureDumpCaptureFiles(root: string): Promise<void> {
  await mkdir(resolvePath(root, "etc/php"), { recursive: true });
  await mkdir(resolvePath(root, "logs"), { recursive: true });
  const capturePhp = resolvePath(root, "etc/php/devtent-capture.php");
  const needsWrite =
    !(await pathExists(capturePhp)) ||
    !(await readFile(capturePhp, "utf-8")).includes(`capture v${CAPTURE_PHP_VERSION}`);
  if (needsWrite) {
    await writeFile(capturePhp, CAPTURE_PHP, "utf-8");
  }
  const logPath = resolvePath(root, DUMPS_LOG);
  if (!(await pathExists(logPath))) {
    await writeFile(logPath, "", "utf-8");
  }
}

const phpCaptureReady = new Set<string>();

export async function ensurePhpCaptureForVersion(root: string, phpVersion: string): Promise<void> {
  const key = `${path.resolve(root)}::${phpVersion}`;
  if (phpCaptureReady.has(key)) return;

  await ensureDumpCaptureFiles(root);
  const paths = resolvePhpPaths(phpVersion);
  const phpDir = resolvePath(root, paths.phpRc);
  await mkdir(phpDir, { recursive: true });

  const capturePath = resolvePath(root, "etc/php/devtent-capture.php").replace(/\\/g, "/");
  const devtentIni = path.join(phpDir, "devtent.ini");
  const snippet = `; DevTent — live dump capture
auto_prepend_file = "${capturePath}"
`;

  let existing = "";
  if (await pathExists(devtentIni)) {
    existing = await readFile(devtentIni, "utf-8");
  }
  if (!existing.includes("devtent-capture.php")) {
    await writeFile(devtentIni, `${existing.trimEnd()}\n${snippet}`.trim() + "\n", "utf-8");
  }

  const phpIni = path.join(phpDir, "php.ini");
  if (await pathExists(phpIni)) {
    const ini = await readFile(phpIni, "utf-8");
    if (!ini.includes("devtent.ini")) {
      await appendFile(phpIni, `\n; DevTent\ninclude="devtent.ini"\n`, "utf-8");
    }
  } else {
    await writeFile(phpIni, `; DevTent PHP config\ninclude="devtent.ini"\n`, "utf-8");
  }

  phpCaptureReady.add(key);
}

export async function readDumpEvents(
  root: string,
  options?: { tail?: number }
): Promise<DumpEvent[]> {
  const logPath = resolvePath(root, DUMPS_LOG);
  if (!(await pathExists(logPath))) return [];

  const info = await stat(logPath);
  if (info.size === 0) return [];

  const tail = options?.tail;
  let raw: string;
  if (!tail || info.size <= 512 * 1024) {
    raw = await readFile(logPath, "utf-8");
  } else {
    // Approximate: ~400 bytes/event → read a trailing window instead of the whole file.
    const chunkSize = Math.min(info.size, Math.max(64 * 1024, tail * 512));
    const handle = await open(logPath, "r");
    try {
      const buffer = Buffer.alloc(chunkSize);
      await handle.read(buffer, 0, chunkSize, Math.max(0, info.size - chunkSize));
      raw = buffer.toString("utf8");
      if (info.size > chunkSize) {
        const nl = raw.indexOf("\n");
        if (nl >= 0) raw = raw.slice(nl + 1);
      }
    } finally {
      await handle.close();
    }
  }

  const lines = raw.split(/\r?\n/).filter(Boolean);
  const slice = tail ? lines.slice(-tail) : lines;
  const events: DumpEvent[] = [];
  for (const line of slice) {
    try {
      events.push(JSON.parse(line) as DumpEvent);
    } catch {
      // skip malformed
    }
  }
  return events;
}

export async function clearDumpEvents(
  root: string,
  options?: { types?: DumpEventType[] }
): Promise<void> {
  await ensureDumpCaptureFiles(root);
  const logPath = resolvePath(root, DUMPS_LOG);
  if (!options?.types?.length) {
    await writeFile(logPath, "", "utf-8");
    return;
  }
  const keep = new Set(options.types);
  const events = await readDumpEvents(root);
  const remaining = events.filter((e) => !keep.has(e.type));
  const body = remaining.map((e) => JSON.stringify(e)).join("\n");
  await writeFile(logPath, body ? body + "\n" : "", "utf-8");
}

export function laravelCaptureProviderSnippet(): string {
  return `// ${LARAVEL_TELEMETRY_MARKER} — usually installed automatically by DevTent
// Add to App\\Providers\\AppServiceProvider::boot() if needed manually:
// Captures queries, jobs, views, requests, logs, cache hits, and outbound HTTP.
`;
}
