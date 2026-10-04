import { writeFile } from "node:fs/promises";
import path from "node:path";
import { loadConfig, loadProfile, resolvePath, pathExists } from "./config.js";
import { DEFAULT_PHP_VERSION, normalizeProfile, resolvePhpPaths } from "./profile-runtime.js";
import { resolveNodePaths } from "./node-runtime.js";
import { detectExternalNode } from "./external-node.js";

export const COMPOSER_HOME_DIR = "data/composer-home";

export interface PathScriptOptions {
  phpVersion?: string;
  externalNodePath?: string;
  /** Override destination (default: <root>/devtent-path.bat|.sh). */
  outputPath?: string;
}

function composerHome(root: string): string {
  return path.join(root, COMPOSER_HOME_DIR);
}

function batEscape(value: string): string {
  return value.replace(/%/g, "%%");
}

export async function getPathEntries(
  root: string,
  options?: PathScriptOptions
): Promise<string[]> {
  const config = await loadConfig(root);
  const profile = normalizeProfile(await loadProfile(root, config.activeProfile));
  const entries: string[] = [];

  entries.push(resolvePath(root, config.paths.bin));

  const phpVersion = options?.phpVersion ?? profile.phpVersion ?? DEFAULT_PHP_VERSION;
  const phpPaths = resolvePhpPaths(phpVersion);
  entries.push(resolvePath(root, path.dirname(phpPaths.cli)));

  if (profile.useExternalNode) {
    const externalPath =
      options?.externalNodePath ?? (await detectExternalNode(root))?.path;
    if (externalPath) {
      entries.push(path.dirname(externalPath));
    }
  } else if (profile.nodeVersion) {
    const nodePaths = resolveNodePaths(profile.nodeVersion);
    entries.push(resolvePath(root, path.dirname(nodePaths.cli)));
  } else if (profile.node) {
    entries.push(resolvePath(root, path.dirname(profile.node)));
  }

  const composerPath = resolvePath(root, "bin/composer");
  if (await pathExists(composerPath)) {
    entries.push(composerPath);
  }

  const bunPath = resolvePath(root, "bin/bun");
  if (await pathExists(bunPath)) {
    entries.push(bunPath);
  }

  const composerGlobalBin = path.join(composerHome(root), "vendor", "bin");
  if (await pathExists(composerGlobalBin)) {
    entries.push(composerGlobalBin);
  }

  return [...new Set(entries)];
}

async function resolvePhpRc(root: string, options?: PathScriptOptions): Promise<string> {
  const phpVersion = options?.phpVersion;
  if (phpVersion) {
    return resolvePath(root, resolvePhpPaths(phpVersion).phpRc);
  }
  const config = await loadConfig(root);
  const profile = normalizeProfile(await loadProfile(root, config.activeProfile));
  const version = profile.phpVersion ?? DEFAULT_PHP_VERSION;
  return resolvePath(root, resolvePhpPaths(version).phpRc);
}

export async function getDevTentProcessEnv(
  root: string,
  options?: PathScriptOptions
): Promise<NodeJS.ProcessEnv> {
  const entries = await getPathEntries(root, options);
  const phpRc = await resolvePhpRc(root, options);
  const sep = path.delimiter;
  return {
    ...process.env,
    DEVTENT_ROOT: root,
    PHPRC: phpRc,
    COMPOSER_HOME: composerHome(root),
    PATH: `${entries.join(sep)}${sep}${process.env.PATH ?? ""}`,
  };
}

export async function generatePathScript(
  root: string,
  options?: PathScriptOptions
): Promise<string> {
  const entries = await getPathEntries(root, options);
  const phpRc = await resolvePhpRc(root, options);
  const home = composerHome(root);

  if (process.platform === "win32") {
    const pathLines = entries.map((e) => `set "PATH=${batEscape(e)};%PATH%"`).join("\n");
    return `@echo off
REM devtent-path-start
set "DEVTENT_ROOT=${batEscape(root)}"
set "PHPRC=${batEscape(phpRc)}"
set "COMPOSER_HOME=${batEscape(home)}"
${pathLines}
REM devtent-path-end
echo DevTent paths added for this session.
echo Root: ${batEscape(root)}
`;
  }

  return `# devtent-path-start
export DEVTENT_ROOT="${root.replace(/"/g, '\\"')}"
export PHPRC="${phpRc.replace(/"/g, '\\"')}"
export COMPOSER_HOME="${home.replace(/"/g, '\\"')}"
export PATH="${entries.join(":")}:$PATH"
# devtent-path-end
`;
}

export async function writePathScript(
  root: string,
  options?: PathScriptOptions
): Promise<string> {
  const script = await generatePathScript(root, options);
  const filename = process.platform === "win32" ? "devtent-path.bat" : "devtent-path.sh";
  const scriptPath = options?.outputPath ?? path.join(root, filename);
  await writeFile(scriptPath, script, "utf-8");
  return scriptPath;
}

export async function getShellCommand(
  root: string,
  options?: PathScriptOptions
): Promise<string> {
  const scriptPath = await writePathScript(root, options);
  if (process.platform === "win32") {
    return `cmd /k "${scriptPath}"`;
  }
  return `source "${scriptPath}" && exec $SHELL`;
}
