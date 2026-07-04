import { app } from "electron";
import { loadSettings, saveSettings } from "./paths.js";
import {
  readStartupPreferences,
  type StartupPreferences,
} from "./startup-preferences.js";

export type { StartupPreferences };
export { readStartupPreferences };

/** Sync Windows login item with saved preference (installed app only). */
export function applyLaunchAtLoginSetting(enabled: boolean): void {
  if (!app.isPackaged) return;

  app.setLoginItemSettings({
    openAtLogin: enabled,
    openAsHidden: true,
    path: process.execPath,
  });
}

export async function setLaunchAtLogin(enabled: boolean): Promise<StartupPreferences> {
  await saveSettings({ launchAtLogin: enabled });
  applyLaunchAtLoginSetting(enabled);
  const settings = await loadSettings();
  return readStartupPreferences(settings);
}

export async function setAutoStartServices(enabled: boolean): Promise<StartupPreferences> {
  await saveSettings({ autoStartServices: enabled });
  const settings = await loadSettings();
  return readStartupPreferences(settings);
}

/** Re-apply login item after updates that change the install path. */
export async function syncLaunchAtLoginFromSettings(): Promise<void> {
  const settings = await loadSettings();
  applyLaunchAtLoginSetting(settings.launchAtLogin === true);
}
