import { exec } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { loadConfig, loadProfile, saveProfile, updateProfile } from "./config.js";
import { normalizeProfile } from "./profile-runtime.js";

const execAsync = promisify(exec);

export const EXTERNAL_NODE_ID = "external";

export interface ExternalNodeInfo {
  path: string;
  version?: string;
  manager: string;
  label: string;
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
  const command =
    process.platform === "win32" ? `where ${executable}` : `which -a ${executable}`;
  try {
    const { stdout } = await execAsync(command, { windowsHide: true });
    return stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

export function inferNodeManager(nodePath: string): string {
  const normalized = nodePath.replace(/\\/g, "/").toLowerCase();
  if (normalized.includes("/appdata/roaming/nvm") || normalized.includes("/nvm4w/")) {
    return "nvm-windows";
  }
  if (normalized.includes("/.nvm/") || normalized.includes("/nvm/versions/")) {
    return "nvm";
  }
  if (normalized.includes("/fnm/") || normalized.includes("/.local/share/fnm")) {
    return "fnm";
  }
  if (normalized.includes("/volta/")) {
    return "Volta";
  }
  if (normalized.includes("/nvs/")) {
    return "nvs";
  }
  if (normalized.includes("/scoop/apps/nodejs")) {
    return "Scoop";
  }
  if (normalized.includes("/program files/nodejs")) {
    return "system";
  }
  return "PATH";
}

async function readNodeVersion(nodePath: string): Promise<string | undefined> {
  try {
    const { stdout } = await execAsync(`"${nodePath}" --version`, {
      windowsHide: true,
      timeout: 10000,
    });
    return stdout.trim().replace(/^v/i, "");
  } catch {
    return undefined;
  }
}

export async function detectExternalNode(root: string): Promise<ExternalNodeInfo | undefined> {
  const matches = await findOnPath(process.platform === "win32" ? "node.exe" : "node");
  const external = matches.find((match) => !isUnderRoot(root, match));
  if (!external) return undefined;

  const manager = inferNodeManager(external);
  const version = await readNodeVersion(external);
  const label = version ? `${version} (${manager})` : manager;

  return { path: external, version, manager, label };
}

export function isExternalNodeActive(profile: { useExternalNode?: boolean; nodeVersion?: string }): boolean {
  return profile.useExternalNode === true && !profile.nodeVersion;
}

export async function applyExternalNodeToActiveProfile(
  root: string
): Promise<import("./types.js").Profile> {
  const external = await detectExternalNode(root);
  if (!external) {
    throw new Error(
      "No external Node.js found on PATH. Install Node via nvm, fnm, Volta, or nodejs.org first."
    );
  }

  const config = await loadConfig(root);
  const current = await loadProfile(root, config.activeProfile);
  const profile = normalizeProfile({
    ...current,
    name: config.activeProfile,
    useExternalNode: true,
    nodeVersion: undefined,
    node: undefined,
  });
  await saveProfile(root, profile);
  return profile;
}

export async function applyNodeVersionToActiveProfile(
  root: string,
  nodeVersion: string
): Promise<import("./types.js").Profile> {
  if (nodeVersion === EXTERNAL_NODE_ID) {
    return applyExternalNodeToActiveProfile(root);
  }

  const { isNodeVersionInstalled } = await import("./node-runtime.js");
  if (!(await isNodeVersionInstalled(root, nodeVersion))) {
    throw new Error(`Node ${nodeVersion} is not installed — install it from Tooling first`);
  }
  const config = await loadConfig(root);
  return updateProfile(root, config.activeProfile, {
    nodeVersion,
    useExternalNode: false,
  });
}

export async function clearActiveNodeVersion(root: string): Promise<import("./types.js").Profile> {
  const config = await loadConfig(root);
  const current = await loadProfile(root, config.activeProfile);
  const profile = normalizeProfile({
    ...current,
    nodeVersion: undefined,
    node: undefined,
    useExternalNode: false,
    name: config.activeProfile,
  });
  await saveProfile(root, profile);
  return profile;
}
