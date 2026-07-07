import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { resolvePath, pathExists } from "./config.js";
import { resolvePhpPaths } from "./profile-runtime.js";

export const DUMPS_LOG = "logs/dumps.jsonl";
export const LARAVEL_QUERY_CAPTURE_MARKER = "DevTent live query capture";

export interface DumpEvent {
  ts: number;
  type: "dump" | "dd" | "error" | "exception" | "query";
  site?: string;
  message: string;
  file?: string;
  line?: number;
  context?: string;
}

const CAPTURE_PHP = `<?php
declare(strict_types=1);

$root = getenv('DEVTENT_ROOT') ?: '';
$logFile = $root !== '' ? $root . DIRECTORY_SEPARATOR . 'logs' . DIRECTORY_SEPARATOR . 'dumps.jsonl' : '';

function devtent_dump_log(string $type, array $payload): void {
    global $logFile;
    if ($logFile === '') return;
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
  await writeFile(resolvePath(root, "etc/php/devtent-capture.php"), CAPTURE_PHP, "utf-8");
  const logPath = resolvePath(root, DUMPS_LOG);
  if (!(await pathExists(logPath))) {
    await writeFile(logPath, "", "utf-8");
  }
}

export async function ensurePhpCaptureForVersion(root: string, phpVersion: string): Promise<void> {
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
}

export async function readDumpEvents(
  root: string,
  options?: { tail?: number }
): Promise<DumpEvent[]> {
  const logPath = resolvePath(root, DUMPS_LOG);
  if (!(await pathExists(logPath))) return [];

  const raw = await readFile(logPath, "utf-8");
  const lines = raw.split(/\r?\n/).filter(Boolean);
  const slice = options?.tail ? lines.slice(-options.tail) : lines;
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

export async function clearDumpEvents(root: string): Promise<void> {
  await ensureDumpCaptureFiles(root);
  await writeFile(resolvePath(root, DUMPS_LOG), "", "utf-8");
}

export function laravelCaptureProviderSnippet(): string {
  return `// ${LARAVEL_QUERY_CAPTURE_MARKER} — usually installed automatically by DevTent
// Add to App\\Providers\\AppServiceProvider::boot() if needed manually:
if (app()->environment('local') && class_exists(\\Illuminate\\Support\\Facades\\DB::class)) {
    \\Illuminate\\Support\\Facades\\DB::listen(function ($query) {
        $log = (getenv('DEVTENT_ROOT') ?: '') . '/logs/dumps.jsonl';
        if ($log === '/logs/dumps.jsonl') return;
        $line = json_encode([
            'ts' => microtime(true),
            'type' => 'query',
            'message' => $query->sql,
            'context' => json_encode($query->bindings),
        ]);
        if ($line) @file_put_contents($log, $line . "\\n", FILE_APPEND | LOCK_EX);
    });
}
`;
}
