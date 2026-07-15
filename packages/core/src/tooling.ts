import { execFile } from "node:child_process";
import { rm } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { loadConfig, loadProfile, resolvePath, pathExists } from "./config.js";
import { normalizeProfile, resolvePhpPaths } from "./profile-runtime.js";
import { binPath } from "./platform/binary.js";
import { isManifestInstalled } from "./profile-runtime.js";
import {
  applyNodeVersionToActiveProfile,
  clearActiveNodeVersion,
  detectExternalNode,
  EXTERNAL_NODE_ID,
  isExternalNodeActive,
} from "./external-node.js";
import type { NodeVersionInfo } from "./node-runtime.js";
import { installNodeVersion, listNodeVersions, nodeVersionFromLegacyPath } from "./node-runtime.js";
import { installFromManifest, loadManifest } from "./quick-add.js";

const execFileAsync = promisify(execFile);

const PATH_CACHE_TTL_MS = 60_000;
const pathLookupCache = new Map<string, { at: number; paths: string[] }>();

export type ToolingSource = "managed" | "external" | "missing";

export interface ToolingEntry {
  id: string;
  name: string;
  description: string;
  binaries: string[];
  source: ToolingSource;
  version?: string;
  statusLabel: string;
  externalPath?: string;
  managedPath?: string;
  manifestId?: string;
  requires?: string[];
  canInstall: boolean;
  canUpdate: boolean;
  canRemove: boolean;
  canUseExternal?: boolean;
  isExternalActive?: boolean;
}

export interface ExternalNodeOption {
  id: typeof EXTERNAL_NODE_ID;
  label: string;
  version?: string;
  manager: string;
  path: string;
  active: boolean;
  available: boolean;
}

export interface ToolingOverview {
  tools: ToolingEntry[];
  pathEntries: string[];
  nodeVersions: NodeVersionInfo[];
  externalNode?: ExternalNodeOption;
}

export const TOOLING_IDS = ["composer", "node", "bun", "laravel-installer"] as const;
export type ToolingId = (typeof TOOLING_IDS)[number];

export function isToolingManifest(name: string): boolean {
  return name === "composer" || name === "bun" || name.startsWith("node-");
}

export function getComposerHome(root: string): string {
  return path.join(root, "data", "composer-home");
}

function isUnderRoot(root: string, candidate: string): boolean {
  const normalizedRoot = path.resolve(root).toLowerCase();
  const normalizedCandidate = path.resolve(candidate).toLowerCase();
  return (
    normalizedCandidate === normalizedRoot ||
    normalizedCandidate.startsWith(normalizedRoot + path.sep)
  );
}

async function findOnPath(executable: string): Promise<string[]> {
  const cached = pathLookupCache.get(executable);
  if (cached && Date.now() - cached.at < PATH_CACHE_TTL_MS) {
    return cached.paths;
  }
  const file = process.platform === "win32" ? "where.exe" : "which";
  const args = process.platform === "win32" ? [executable] : ["-a", executable];
  try {
    const { stdout } = await execFileAsync(file, args, { windowsHide: true });
    const paths = String(stdout)
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    pathLookupCache.set(executable, { at: Date.now(), paths });
    return paths;
  } catch {
    pathLookupCache.set(executable, { at: Date.now(), paths: [] });
    return [];
  }
}

async function detectExternalBinary(
  root: string,
  names: string[]
): Promise<{ path: string; version?: string } | undefined> {
  for (const name of names) {
    const matches = await findOnPath(name);
    const external = matches.find((match) => !isUnderRoot(root, match));
    if (external) {
      return { path: external };
    }
  }
  return undefined;
}

async function captureCommand(
  file: string,
  args: string[],
  cwd: string,
  env?: NodeJS.ProcessEnv
): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync(file, args, {
      cwd,
      windowsHide: true,
      timeout: 15000,
      env,
    });
    return String(stdout).trim();
  } catch {
    return undefined;
  }
}

function withComposerHome(composerHome: string): NodeJS.ProcessEnv {
  return { ...process.env, COMPOSER_HOME: composerHome };
}

async function getActivePhpCli(root: string): Promise<string | undefined> {
  const config = await loadConfig(root);
  const profile = normalizeProfile(await loadProfile(root, config.activeProfile));
  const fallback = resolvePhpPaths(profile.phpVersion ?? "php-8.3").cli;
  const phpPath = resolvePath(root, profile.php ?? fallback);
  return (await pathExists(phpPath)) ? phpPath : undefined;
}

async function getManagedComposerVersion(root: string): Promise<string | undefined> {
  const composerPhar = resolvePath(root, "bin/composer/composer.phar");
  if (!(await pathExists(composerPhar))) return undefined;

  const php = await getActivePhpCli(root);
  if (!php) return undefined;

  const output = await captureCommand(php, [composerPhar, "--version", "--no-ansi"], root);
  const match = output?.match(/Composer version\s+([^\s]+)/i);
  return match?.[1];
}

async function getManagedBunVersion(root: string): Promise<string | undefined> {
  const bunExe = resolvePath(root, binPath(["bin", "bun", "bun"]));
  if (!(await pathExists(bunExe))) return undefined;
  const output = await captureCommand(bunExe, ["--version"], root);
  return output?.replace(/^v/i, "");
}

async function getLaravelInstallerPaths(root: string): Promise<string[]> {
  const globalBin = path.join(getComposerHome(root), "vendor", "bin");
  const candidates = [
    path.join(globalBin, "laravel.bat"),
    path.join(globalBin, "laravel"),
    path.join(globalBin, "laravel.exe"),
  ];
  const found: string[] = [];
  for (const candidate of candidates) {
    if (await pathExists(candidate)) found.push(candidate);
  }
  return found;
}

async function getLaravelInstallerVersion(root: string): Promise<string | undefined> {
  const composerPhar = resolvePath(root, "bin/composer/composer.phar");
  const php = await getActivePhpCli(root);
  if (!(await pathExists(composerPhar)) || !php) return undefined;

  const composerHome = getComposerHome(root);
  const output = await captureCommand(
    php,
    [composerPhar, "global", "show", "laravel/installer", "--no-ansi"],
    root,
    withComposerHome(composerHome)
  );
  const match = output?.match(/versions?\s*:\s*\*?\s*([^\s]+)/i);
  return match?.[1];
}

async function buildComposerEntry(root: string, manifestsDir: string): Promise<ToolingEntry> {
  const manifest = await loadManifest(manifestsDir, "composer").catch(() => null);
  const managed = manifest ? await isManifestInstalled(root, manifest) : false;
  const external = await detectExternalBinary(root, ["composer", "composer.bat"]);
  const version = managed ? await getManagedComposerVersion(root) : undefined;

  let source: ToolingSource = "missing";
  let statusLabel = "Not installed";
  if (managed) {
    source = "managed";
    statusLabel = version ?? manifest?.version ?? "Installed";
  } else if (external) {
    source = "external";
    statusLabel = "External";
  }

  return {
    id: "composer",
    name: "Composer",
    description: "PHP dependency manager",
    binaries: ["composer"],
    source,
    version: managed ? version : undefined,
    statusLabel,
    externalPath: external?.path,
    managedPath: managed ? resolvePath(root, "bin/composer") : undefined,
    manifestId: "composer",
    canInstall: !managed,
    canUpdate: managed,
    canRemove: managed,
  };
}

async function buildNodeEntry(
  root: string,
  manifestsDir: string,
  nodeVersions: NodeVersionInfo[],
  externalNode?: ExternalNodeOption
): Promise<ToolingEntry> {
  const config = await loadConfig(root);
  const profile = normalizeProfile(await loadProfile(root, config.activeProfile));
  const activeId = profile.nodeVersion ?? nodeVersionFromLegacyPath(profile.node);
  const active = nodeVersions.find((v) => v.id === activeId);
  const anyInstalled = nodeVersions.some((v) => v.installed);
  const externalActive = isExternalNodeActive(profile) && Boolean(externalNode?.available);

  let source: ToolingSource = "missing";
  let statusLabel = "Not installed";
  if (externalActive && externalNode) {
    source = "external";
    statusLabel = externalNode.label;
  } else if (active?.installed) {
    source = "managed";
    statusLabel = active.label;
  } else if (anyInstalled) {
    source = "managed";
    statusLabel = "Installed (none active)";
  } else if (externalNode?.available) {
    source = "external";
    statusLabel = externalNode.label;
  }

  return {
    id: "node",
    name: "Node.js",
    description: "Node.js runtime for building frontend assets",
    binaries: ["node", "npm", "npx"],
    source,
    version: externalActive ? externalNode?.version : active?.version,
    statusLabel,
    externalPath: externalNode?.path,
    managedPath: active ? resolvePath(root, `bin/node/${active.id}`) : undefined,
    canInstall: nodeVersions.some((v) => !v.installed),
    canUpdate: Boolean(active?.installed),
    canRemove: Boolean(active?.installed),
    canUseExternal: Boolean(externalNode?.available),
    isExternalActive: externalActive,
  };
}

async function buildBunEntry(root: string, manifestsDir: string): Promise<ToolingEntry> {
  const manifest = await loadManifest(manifestsDir, "bun").catch(() => null);
  const managed = manifest ? await isManifestInstalled(root, manifest) : false;
  const external = await detectExternalBinary(root, ["bun", "bun.exe"]);
  const version = managed ? await getManagedBunVersion(root) : undefined;

  let source: ToolingSource = "missing";
  let statusLabel = "Not installed";
  if (managed) {
    source = "managed";
    statusLabel = version ?? manifest?.version ?? "Installed";
  } else if (external) {
    source = "external";
    statusLabel = "External";
  }

  return {
    id: "bun",
    name: "Bun",
    description: "Fast JavaScript runtime and package manager",
    binaries: ["bun", "bunx"],
    source,
    version: managed ? version : undefined,
    statusLabel,
    externalPath: external?.path,
    managedPath: managed ? resolvePath(root, "bin/bun") : undefined,
    manifestId: "bun",
    canInstall: !managed,
    canUpdate: managed,
    canRemove: managed,
  };
}

async function buildLaravelInstallerEntry(root: string): Promise<ToolingEntry> {
  const installedPaths = await getLaravelInstallerPaths(root);
  const managed = installedPaths.length > 0;
  const external = managed ? undefined : await detectExternalBinary(root, ["laravel", "laravel.bat"]);
  const version = managed ? await getLaravelInstallerVersion(root) : undefined;
  const composerInstalled = await pathExists(resolvePath(root, "bin/composer/composer.phar"));

  let source: ToolingSource = "missing";
  let statusLabel = "Not installed";
  if (managed) {
    source = "managed";
    statusLabel = version ?? "Installed";
  } else if (external) {
    source = "external";
    statusLabel = "External";
  } else if (!composerInstalled) {
    statusLabel = "Needs Composer";
  }

  return {
    id: "laravel-installer",
    name: "Laravel Installer",
    description: "The laravel new installer for scaffolding Laravel apps",
    binaries: ["laravel"],
    source,
    version: managed ? version : undefined,
    statusLabel,
    externalPath: external?.path,
    managedPath: managed ? path.dirname(installedPaths[0]!) : undefined,
    requires: ["composer"],
    canInstall: !managed && composerInstalled,
    canUpdate: managed,
    canRemove: managed,
  };
}

export async function listTooling(root: string, manifestsDir: string): Promise<ToolingOverview> {
  const { getPathEntries } = await import("./path.js");
  const nodeVersions = await listNodeVersions(root, manifestsDir);
  const config = await loadConfig(root);
  const profile = normalizeProfile(await loadProfile(root, config.activeProfile));
  const detected = await detectExternalNode(root);
  const externalNode: ExternalNodeOption | undefined = detected
    ? {
        id: EXTERNAL_NODE_ID,
        label: detected.label,
        version: detected.version,
        manager: detected.manager,
        path: detected.path,
        active: isExternalNodeActive(profile),
        available: true,
      }
    : undefined;

  const tools = await Promise.all([
    buildComposerEntry(root, manifestsDir),
    buildNodeEntry(root, manifestsDir, nodeVersions, externalNode),
    buildBunEntry(root, manifestsDir),
    buildLaravelInstallerEntry(root),
  ]);
  const pathEntries = await getPathEntries(root, {
    externalNodePath: detected?.path,
  });
  return { tools, pathEntries, nodeVersions, externalNode };
}

export async function installTool(
  root: string,
  manifestsDir: string,
  toolId: ToolingId,
  onProgress?: (msg: string) => void
): Promise<void> {
  const log = onProgress ?? (() => {});

  if (toolId === "composer") {
    const manifest = await loadManifest(manifestsDir, "composer");
    await installFromManifest(root, manifest, log);
    return;
  }

  if (toolId === "bun") {
    const manifest = await loadManifest(manifestsDir, "bun");
    await installFromManifest(root, manifest, log);
    return;
  }

  if (toolId === "laravel-installer") {
    const composerPhar = resolvePath(root, "bin/composer/composer.phar");
    if (!(await pathExists(composerPhar))) {
      throw new Error("Install Composer first — the Laravel installer needs it.");
    }
    const php = await getActivePhpCli(root);
    if (!php) {
      throw new Error("Install PHP and select an active profile before installing the Laravel installer.");
    }

    const composerHome = getComposerHome(root);
    log("Installing Laravel installer via Composer…");
    await execFileAsync(
      php,
      [composerPhar, "global", "require", "laravel/installer", "--no-interaction"],
      { cwd: root, windowsHide: true, env: withComposerHome(composerHome) }
    );
    log("✓ Laravel installer installed");
    return;
  }

  if (toolId === "node") {
    const versions = await listNodeVersions(root, manifestsDir);
    const target = versions.find((v) => !v.installed) ?? versions[0];
    if (!target) {
      throw new Error("No Node manifests found.");
    }
    await installNodeVersion(root, manifestsDir, target.id, log);
    const config = await loadConfig(root);
    const profile = normalizeProfile(await loadProfile(root, config.activeProfile));
    const activeId = profile.nodeVersion ?? nodeVersionFromLegacyPath(profile.node);
    if (!activeId) {
      await applyNodeVersionToActiveProfile(root, target.id);
    }
    return;
  }

  throw new Error(`Unknown tool: ${toolId}`);
}

export async function updateTool(
  root: string,
  manifestsDir: string,
  toolId: ToolingId,
  onProgress?: (msg: string) => void
): Promise<void> {
  if (toolId === "laravel-installer") {
    await removeTool(root, manifestsDir, toolId);
    await installTool(root, manifestsDir, toolId, onProgress);
    return;
  }

  if (toolId === "node") {
    const config = await loadConfig(root);
    const profile = normalizeProfile(await loadProfile(root, config.activeProfile));
    const activeId = profile.nodeVersion ?? nodeVersionFromLegacyPath(profile.node);
    if (!activeId) {
      throw new Error("No active Node version to update.");
    }
    await installNodeVersion(root, manifestsDir, activeId, onProgress);
    return;
  }

  const manifestId =
    toolId === "composer" ? "composer" : toolId === "bun" ? "bun" : undefined;
  if (!manifestId) {
    throw new Error(`Cannot update tool: ${toolId}`);
  }
  const manifest = await loadManifest(manifestsDir, manifestId);
  await installFromManifest(root, manifest, onProgress);
}

export async function removeTool(
  root: string,
  manifestsDir: string,
  toolId: ToolingId,
  options?: { nodeVersion?: string }
): Promise<void> {
  if (toolId === "composer") {
    await rm(resolvePath(root, "bin/composer"), { recursive: true, force: true });
    return;
  }

  if (toolId === "bun") {
    await rm(resolvePath(root, "bin/bun"), { recursive: true, force: true });
    return;
  }

  if (toolId === "laravel-installer") {
    const composerPhar = resolvePath(root, "bin/composer/composer.phar");
    const php = await getActivePhpCli(root);
    const composerHome = getComposerHome(root);
    if ((await pathExists(composerPhar)) && php) {
      try {
        await execFileAsync(
          php,
          [composerPhar, "global", "remove", "laravel/installer", "--no-interaction"],
          { cwd: root, windowsHide: true, env: withComposerHome(composerHome) }
        );
        return;
      } catch {
        // fall through to directory cleanup
      }
    }
    await rm(path.join(composerHome, "vendor", "laravel"), { recursive: true, force: true });
    for (const binName of ["laravel", "laravel.bat", "laravel.exe"]) {
      await rm(path.join(composerHome, "vendor", "bin", binName), { force: true });
    }
    return;
  }

  if (toolId === "node") {
    const config = await loadConfig(root);
    const profile = normalizeProfile(await loadProfile(root, config.activeProfile));
    const activeId = profile.nodeVersion ?? nodeVersionFromLegacyPath(profile.node);
    const nodeVersion = options?.nodeVersion ?? activeId;
    if (!nodeVersion) {
      throw new Error("No Node version specified to remove.");
    }
    await rm(resolvePath(root, `bin/node/${nodeVersion}`), { recursive: true, force: true });
    if (activeId === nodeVersion) {
      await clearActiveNodeVersion(root);
    }
    return;
  }

  throw new Error(`Unknown tool: ${toolId}`);
}
