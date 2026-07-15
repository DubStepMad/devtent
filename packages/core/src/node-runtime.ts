import path from "node:path";
import { loadConfig, loadProfile, resolvePath, pathExists, saveProfile, updateProfile } from "./config.js";
import { normalizeProfile } from "./profile-runtime.js";
import type { QuickAddManifest } from "./types.js";
import { isManifestInstalled } from "./profile-runtime.js";
import { listManifests, loadManifest } from "./quick-add.js";
import { binaryName, npmLauncher } from "./platform/binary.js";

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

export function resolveNodePaths(
  nodeVersion: string,
  platform = process.platform
): NodeRuntimePaths {
  const base = `bin/node/${nodeVersion}`;
  if (platform === "win32") {
    return {
      nodeVersion,
      cli: `${base}/${binaryName("node", platform)}`,
      npm: `${base}/${npmLauncher(platform)}`,
    };
  }
  // Official Node.js unix tarballs use bin/node after hoist
  return {
    nodeVersion,
    cli: `${base}/bin/node`,
    npm: `${base}/bin/npm`,
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
  const activeId = profile.useExternalNode ? undefined : profile.nodeVersion ?? nodeVersionFromLegacyPath(profile.node);

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

export {
  applyExternalNodeToActiveProfile,
  applyNodeVersionToActiveProfile,
  clearActiveNodeVersion,
  detectExternalNode,
  EXTERNAL_NODE_ID,
  isExternalNodeActive,
} from "./external-node.js";
export type { ExternalNodeInfo } from "./external-node.js";

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
