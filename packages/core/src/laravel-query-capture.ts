import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathExists } from "./config.js";
import { LARAVEL_QUERY_CAPTURE_MARKER } from "./dump-capture.js";

export { LARAVEL_QUERY_CAPTURE_MARKER };

export async function isLaravelProject(projectPath: string): Promise<boolean> {
  return pathExists(path.join(projectPath, "artisan"));
}

export async function hasLaravelQueryCapture(projectPath: string): Promise<boolean> {
  const providerPath = path.join(projectPath, "app/Providers/AppServiceProvider.php");
  if (!(await pathExists(providerPath))) return false;
  const content = await readFile(providerPath, "utf-8");
  return content.includes(LARAVEL_QUERY_CAPTURE_MARKER);
}

function buildBootInjection(): string {
  return `
        // ${LARAVEL_QUERY_CAPTURE_MARKER}
        if (app()->environment('local') && class_exists(\\Illuminate\\Support\\Facades\\DB::class)) {
            \\Illuminate\\Support\\Facades\\DB::listen(function ($query) {
                $log = (getenv('DEVTENT_ROOT') ?: '') . DIRECTORY_SEPARATOR . 'logs' . DIRECTORY_SEPARATOR . 'dumps.jsonl';
                if ($log === DIRECTORY_SEPARATOR . 'logs' . DIRECTORY_SEPARATOR . 'dumps.jsonl') {
                    return;
                }
                $line = json_encode([
                    'ts' => microtime(true),
                    'type' => 'query',
                    'message' => $query->sql,
                    'context' => json_encode($query->bindings),
                ], JSON_UNESCAPED_UNICODE);
                if ($line !== false) {
                    @file_put_contents($log, $line . "\\n", FILE_APPEND | LOCK_EX);
                }
            });
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
  if (content.includes(LARAVEL_QUERY_CAPTURE_MARKER)) {
    return {
      installed: true,
      alreadyInstalled: true,
      message: "Laravel query capture already enabled",
    };
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
    message: "Laravel query capture installed in AppServiceProvider",
  };
}

export async function installLaravelQueryCaptureForSites(root: string): Promise<string[]> {
  const { listVirtualHosts } = await import("./vhosts.js");
  const vhosts = await listVirtualHosts(root);
  const installed: string[] = [];

  for (const vhost of vhosts) {
    const projectPath =
      vhost.projectPath ?? path.join(root, "www", vhost.name);
    const result = await installLaravelQueryCapture(projectPath);
    if (result.installed && !result.alreadyInstalled) {
      installed.push(vhost.name);
    }
  }

  return installed;
}
