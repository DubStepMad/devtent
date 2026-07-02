import path from "node:path";
import { loadConfig, loadProfile, resolvePath, pathExists, saveProfile, updateProfile } from "./config.js";
import { normalizeProfile } from "./profile-runtime.js";
import type { QuickAddManifest } from "./types.js";
import { isManifestInstalled } from "./profile-runtime.js";
import { listManifests, loadManifest } from "./quick-add.js";

export interface NodeRuntimePaths {
  nodeVersion: string;
  cli: string;
  npm: string;
}

export interface NodeVersionInfo {
  id: string;
  version: string;
  label: string;
  description?: string;
  installed: boolean;
  active: boolean;
}

export function nodeVersionFromLegacyPath(nodePath?: string): string | undefined {
  if (!nodePath) return undefined;
  const normalized = nodePath.replace(/\\/g, "/");
  const match = normalized.match(/bin\/node\/(node-[\d.]+)/i);
  return match?.[1];
}

export function resolveNodePaths(nodeVersion: string): NodeRuntimePaths {
  const base = `bin/node/${nodeVersion}`;
  return {
    nodeVersion,
    cli: `${base}/node.exe`,
    npm: `${base}/npm.cmd`,
  };
}

export function getNodeDisplayLabel(nodeVersion: string, manifestVersion?: string): string {
  const major = nodeVersion.replace(/^node-/, "").split(".")[0];
  if (manifestVersion) {
    return `${major}.x (${manifestVersion})`;
  }
  return `${major}.x`;
}

export async function isNodeVersionInstalled(root: string, nodeVersion: string): Promise<boolean> {
  const paths = resolveNodePaths(nodeVersion);
  return pathExists(resolvePath(root, paths.cli));
}

export async function listNodeVersions(
  root: string,
  manifestsDir: string
): Promise<NodeVersionInfo[]> {
  const config = await loadConfig(root);
  const profile = normalizeProfile(await loadProfile(root, config.activeProfile));
  const activeId = profile.nodeVersion ?? nodeVersionFromLegacyPath(profile.node);

  const manifests = (await listManifests(manifestsDir)).filter((m) => m.name.startsWith("node-"));
  const versions: NodeVersionInfo[] = [];

  for (const manifest of manifests) {
    const installed = await isManifestInstalled(root, manifest);
    versions.push({
      id: manifest.name,
      version: manifest.version,
      label: getNodeDisplayLabel(manifest.name, manifest.version),
      description: manifest.description,
      installed,
      active: activeId === manifest.name,
    });
  }

  return versions.sort((a, b) => b.id.localeCompare(a.id));
}

export async function applyNodeVersionToActiveProfile(
  root: string,
  nodeVersion: string
): Promise<import("./types.js").Profile> {
  if (!(await isNodeVersionInstalled(root, nodeVersion))) {
    throw new Error(`Node ${nodeVersion} is not installed — install it from Quick Add or the Node panel first`);
  }
  const config = await loadConfig(root);
  return updateProfile(root, config.activeProfile, { nodeVersion });
}

export async function clearActiveNodeVersion(root: string): Promise<import("./types.js").Profile> {
  const config = await loadConfig(root);
  const current = await loadProfile(root, config.activeProfile);
  const profile = normalizeProfile({
    ...current,
    nodeVersion: undefined,
    node: undefined,
    name: config.activeProfile,
  });
  await saveProfile(root, profile);
  return profile;
}

export async function installNodeVersion(
  root: string,
  manifestsDir: string,
  nodeVersion: string,
  onProgress?: (msg: string) => void
): Promise<string> {
  const manifest = await loadManifest(manifestsDir, nodeVersion);
  if (!manifest.name.startsWith("node-")) {
    throw new Error(`Not a Node manifest: ${nodeVersion}`);
  }
  const { installFromManifest } = await import("./quick-add.js");
  return installFromManifest(root, manifest, onProgress);
}
