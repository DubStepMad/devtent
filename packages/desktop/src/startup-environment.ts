import { initDevTent, hasExistingEnvironment } from "@devtent/core";
import { loadSettings, saveSettings, isInitialized } from "./paths.js";

export type EnvironmentStartup = "ready" | "needs-wizard";

/**
 * After an app update or reinstall, repair missing devtent.toml without showing setup.
 * Only shows the first-run wizard for a genuinely empty install folder.
 */
export async function ensureEnvironmentReady(root: string): Promise<EnvironmentStartup> {
  if (await isInitialized(root)) {
    return "ready";
  }

  const settings = await loadSettings();
  const hasData = settings.setupCompleted || (await hasExistingEnvironment(root));

  if (hasData) {
    await initDevTent(root);
    await saveSettings({ setupCompleted: true, root });
    return "ready";
  }

  return "needs-wizard";
}

export async function markSetupCompleted(root: string): Promise<void> {
  await saveSettings({ setupCompleted: true, root });
}
