import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadConfig, loadProfile, resolvePath, pathExists } from "./config.js";
import { normalizeProfile } from "./profile-runtime.js";
import { resolveNodePaths } from "./node-runtime.js";

export async function getPathEntries(root: string): Promise<string[]> {
  const config = await loadConfig(root);
  const profile = normalizeProfile(await loadProfile(root, config.activeProfile));
  const entries: string[] = [];

  entries.push(resolvePath(root, config.paths.bin));

  if (profile.php) {
    entries.push(resolvePath(root, path.dirname(profile.php)));
  }
  if (profile.nodeVersion) {
    const nodePaths = resolveNodePaths(profile.nodeVersion);
    entries.push(resolvePath(root, path.dirname(nodePaths.cli)));
  } else if (profile.node) {
    entries.push(resolvePath(root, path.dirname(profile.node)));
  }

  const composerPath = resolvePath(root, "bin/composer");
  if (await pathExists(composerPath)) {
    entries.push(composerPath);
  }

  return [...new Set(entries)];
}

export async function generatePathScript(root: string): Promise<string> {
  const entries = await getPathEntries(root);
  const markerStart = "# devtent-path-start";
  const markerEnd = "# devtent-path-end";

  if (process.platform === "win32") {
    const pathAdditions = entries.map((e) => e.replace(/\\/g, "\\\\")).join(";");
    return `@echo off
${markerStart}
set "DEVTENT_ROOT=${root.replace(/\\/g, "\\\\")}"
${entries.map((e) => `set "PATH=${e.replace(/\\/g, "\\\\")};%PATH%"`).join("\n")}
${markerEnd}
echo DevTent paths added for this session.
echo Root cause: run from DevTent terminal or use "devtent shell"
`;
  }

  return `# ${markerStart}
export DEVTENT_ROOT="${root}"
export PATH="${entries.join(":")}:$PATH"
# ${markerEnd}
`;
}

export async function writePathScript(root: string): Promise<string> {
  const script = await generatePathScript(root);
  const scriptPath = path.join(root, process.platform === "win32" ? "devtent-path.bat" : "devtent-path.sh");
  await writeFile(scriptPath, script, "utf-8");
  return scriptPath;
}

export async function getShellCommand(root: string): Promise<string> {
  const scriptPath = await writePathScript(root);
  if (process.platform === "win32") {
    return `cmd /k "${scriptPath}"`;
  }
  return `source "${scriptPath}" && exec $SHELL`;
}
