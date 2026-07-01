import { repairDevTentEnvironment, hasExistingEnvironment, normalizeInstallRoot } from "@devtent/core";
import { loadSettings, saveSettings, isInitialized } from "./paths.js";
import { setupCompletedForRoot } from "./setup-completion.js";
import { isInstallInProgress } from "./install-lock.js";

export type EnvironmentStartup = "ready" | "needs-wizard";

/**
 * After an app update or reinstall, repair missing devtent.toml without showing setup.
 * Only shows the first-run wizard for a genuinely empty install folder.
 */
export async function ensureEnvironmentReady(root: string): Promise<EnvironmentStartup> {
  if (await isInstallInProgress(root)) {
    return "ready";
  }

  if (await isInitialized(root)) {
    return "ready";
  }

  const settings = await loadSettings();
  const normalizedRoot = normalizeInstallRoot(root);
  const hasData = setupCompletedForRoot(settings, normalizedRoot) || (await hasExistingEnvironment(normalizedRoot));

  if (hasData) {
    await repairDevTentEnvironment(normalizedRoot);
    await saveSettings({
      setupCompleted: true,
      setupCompletedRoot: normalizedRoot,
      root: normalizedRoot,
    });
    return "ready";
  }

  return "needs-wizard";
}

export async function markSetupCompleted(root: string): Promise<void> {
  const normalizedRoot = normalizeInstallRoot(root);
  await saveSettings({
    setupCompleted: true,
    setupCompletedRoot: normalizedRoot,
    root: normalizedRoot,
  });
}
