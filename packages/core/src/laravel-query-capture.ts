import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathExists } from "./config.js";
import {
  LARAVEL_QUERY_CAPTURE_MARKER,
  LARAVEL_TELEMETRY_MARKER,
} from "./dump-capture.js";

export { LARAVEL_QUERY_CAPTURE_MARKER, LARAVEL_TELEMETRY_MARKER };

export async function isLaravelProject(projectPath: string): Promise<boolean> {
  return pathExists(path.join(projectPath, "artisan"));
}

export async function hasLaravelQueryCapture(projectPath: string): Promise<boolean> {
  const providerPath = path.join(projectPath, "app/Providers/AppServiceProvider.php");
  if (!(await pathExists(providerPath))) return false;
  const content = await readFile(providerPath, "utf-8");
  return (
      content.includes(LARAVEL_TELEMETRY_MARKER) ||
    content.includes("DevTent live Laravel telemetry") ||
    content.includes(LARAVEL_QUERY_CAPTURE_MARKER)
  );
}

function buildBootInjection(): string {
  // Laravel Event listeners write JSONL for DevTent Dumps (no native extension required).
  return `
        // ${LARAVEL_TELEMETRY_MARKER}
        if (app()->environment('local')) {
            $__devtentLog = static function (string $type, string $message, $context = null): void {
                $log = (getenv('DEVTENT_ROOT') ?: '') . DIRECTORY_SEPARATOR . 'logs' . DIRECTORY_SEPARATOR . 'dumps.jsonl';
                if ($log === DIRECTORY_SEPARATOR . 'logs' . DIRECTORY_SEPARATOR . 'dumps.jsonl') {
                    return;
                }
                $site = null;
                try {
                    $host = request()->getHost();
                    if (is_string($host) && $host !== '') {
                        $site = strtolower($host);
                    }
                } catch (\\Throwable $e) {
                }
                $payload = [
                    'ts' => microtime(true),
                    'type' => $type,
                    'message' => $message,
                ];
                if ($site !== null) {
                    $payload['site'] = $site;
                }
                if ($context !== null) {
                    $payload['context'] = is_string($context) ? $context : json_encode($context, JSON_UNESCAPED_UNICODE);
                }
                $line = json_encode($payload, JSON_UNESCAPED_UNICODE);
                if ($line !== false) {
                    @file_put_contents($log, $line . "\\n", FILE_APPEND | LOCK_EX);
                }
            };

            if (class_exists(\\Illuminate\\Support\\Facades\\DB::class)) {
                \\Illuminate\\Support\\Facades\\DB::listen(function ($query) use ($__devtentLog) {
                    $__devtentLog('query', $query->sql, [
                        'bindings' => $query->bindings,
                        'time_ms' => $query->time,
                    ]);
                });
            }

            if (class_exists(\\Illuminate\\Support\\Facades\\Event::class)) {
                \\Illuminate\\Support\\Facades\\Event::listen(\\Illuminate\\Queue\\Events\\JobProcessing::class, function ($e) use ($__devtentLog) {
                    $__devtentLog('job', 'processing: ' . ($e->job->resolveName() ?? 'job'), ['connection' => $e->connectionName ?? null]);
                });
                \\Illuminate\\Support\\Facades\\Event::listen(\\Illuminate\\Queue\\Events\\JobProcessed::class, function ($e) use ($__devtentLog) {
                    $__devtentLog('job', 'processed: ' . ($e->job->resolveName() ?? 'job'));
                });
                \\Illuminate\\Support\\Facades\\Event::listen(\\Illuminate\\Queue\\Events\\JobFailed::class, function ($e) use ($__devtentLog) {
                    $__devtentLog('job', 'failed: ' . ($e->job->resolveName() ?? 'job'), ['exception' => $e->exception?->getMessage()]);
                });

                \\Illuminate\\Support\\Facades\\Event::listen(\\Illuminate\\Log\\Events\\MessageLogged::class, function ($e) use ($__devtentLog) {
                    $__devtentLog('log', '[' . $e->level . '] ' . (is_string($e->message) ? $e->message : json_encode($e->message)), $e->context ?? null);
                });

                \\Illuminate\\Support\\Facades\\Event::listen(\\Illuminate\\Cache\\Events\\CacheHit::class, function ($e) use ($__devtentLog) {
                    $__devtentLog('cache', 'hit: ' . $e->key);
                });
                \\Illuminate\\Support\\Facades\\Event::listen(\\Illuminate\\Cache\\Events\\CacheMissed::class, function ($e) use ($__devtentLog) {
                    $__devtentLog('cache', 'miss: ' . $e->key);
                });
                \\Illuminate\\Support\\Facades\\Event::listen(\\Illuminate\\Cache\\Events\\KeyWritten::class, function ($e) use ($__devtentLog) {
                    $__devtentLog('cache', 'write: ' . $e->key);
                });
                \\Illuminate\\Support\\Facades\\Event::listen(\\Illuminate\\Cache\\Events\\KeyForgotten::class, function ($e) use ($__devtentLog) {
                    $__devtentLog('cache', 'forget: ' . $e->key);
                });

                \\Illuminate\\Support\\Facades\\Event::listen(\\Illuminate\\Http\\Client\\Events\\ResponseReceived::class, function ($e) use ($__devtentLog) {
                    $req = $e->request;
                    $res = $e->response;
                    $__devtentLog('http', strtoupper(method_exists($req, 'method') ? $req->method() : 'GET') . ' ' . (method_exists($req, 'url') ? $req->url() : ''), [
                        'status' => method_exists($res, 'status') ? $res->status() : null,
                    ]);
                });
                \\Illuminate\\Support\\Facades\\Event::listen(\\Illuminate\\Http\\Client\\Events\\ConnectionFailed::class, function ($e) use ($__devtentLog) {
                    $req = $e->request;
                    $__devtentLog('http', 'FAILED ' . (method_exists($req, 'url') ? $req->url() : 'request'));
                });
            }

            app()->terminating(function () use ($__devtentLog) {
                try {
                    $req = request();
                    $__devtentLog('request', strtoupper($req->method()) . ' ' . $req->getRequestUri(), [
                        'status' => http_response_code() ?: null,
                        'ip' => $req->ip(),
                    ]);
                } catch (\\Throwable $e) {
                }
            });

            if (class_exists(\\Illuminate\\Support\\Facades\\View::class)) {
                \\Illuminate\\Support\\Facades\\View::composer('*', function ($view) use ($__devtentLog) {
                    static $seen = [];
                    $name = method_exists($view, 'name') ? $view->name() : 'view';
                    if (isset($seen[$name])) {
                        return;
                    }
                    $seen[$name] = true;
                    $data = method_exists($view, 'getData') ? array_keys($view->getData()) : [];
                    $__devtentLog('view', (string) $name, ['data_keys' => $data]);
                });
            }
        }
`;
}

export async function installLaravelQueryCapture(
  projectPath: string
): Promise<{ installed: boolean; alreadyInstalled: boolean; message: string }> {
  if (!(await isLaravelProject(projectPath))) {
    return { installed: false, alreadyInstalled: false, message: "Not a Laravel project" };
  }

  const providerPath = path.join(projectPath, "app/Providers/AppServiceProvider.php");
  if (!(await pathExists(providerPath))) {
    return {
      installed: false,
      alreadyInstalled: false,
      message: "AppServiceProvider.php not found",
    };
  }

  let content = await readFile(providerPath, "utf-8");
  if (content.includes(LARAVEL_TELEMETRY_MARKER)) {
    return {
      installed: true,
      alreadyInstalled: true,
      message: "Laravel telemetry capture already enabled",
    };
  }

  // Upgrade legacy query-only or older telemetry injection
  for (const marker of [LARAVEL_QUERY_CAPTURE_MARKER, "DevTent live Laravel telemetry"]) {
    if (!content.includes(marker)) continue;
    const legacyStart = content.indexOf(`// ${marker}`);
    if (legacyStart < 0) continue;
    const after = content.slice(legacyStart);
    const endMatch = after.match(/\n        \}\n/);
    if (endMatch && endMatch.index !== undefined) {
      content =
        content.slice(0, legacyStart) +
        content.slice(legacyStart + endMatch.index + endMatch[0].length);
    }
  }

  const bootMatch = content.match(/public\s+function\s+boot\s*\(\s*\)\s*(?::\s*void\s*)?\{/);
  if (!bootMatch || bootMatch.index === undefined) {
    return {
      installed: false,
      alreadyInstalled: false,
      message: "Could not find boot() in AppServiceProvider.php",
    };
  }

  const insertAt = bootMatch.index + bootMatch[0].length;
  content = `${content.slice(0, insertAt)}${buildBootInjection()}${content.slice(insertAt)}`;
  await writeFile(providerPath, content, "utf-8");

  return {
    installed: true,
    alreadyInstalled: false,
    message: "Laravel telemetry capture installed (queries, jobs, views, requests, logs, cache, HTTP)",
  };
}

export async function installLaravelQueryCaptureForSites(root: string): Promise<string[]> {
  const { listVirtualHosts } = await import("./vhosts.js");
  const vhosts = await listVirtualHosts(root);
  const installed: string[] = [];

  for (const vhost of vhosts) {
    const projectPath = vhost.projectPath ?? path.join(root, "www", vhost.name);
    const result = await installLaravelQueryCapture(projectPath);
    if (result.installed && !result.alreadyInstalled) {
      installed.push(vhost.name);
    }
  }

  return installed;
}
