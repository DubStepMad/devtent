import { loadConfig, loadProfile } from "./config.js";
import { normalizeProfile } from "./profile-runtime.js";
import type { Profile } from "./types.js";
import { parseProcfile } from "./services.js";
import { getServicePresetsForProfile, type ServicePreset } from "./procfile.js";
import { pathExists, resolvePath } from "./config.js";

export interface ProfileService extends ServicePreset {
  runtimeInstalled: boolean;
}

async function isPresetRuntimeInstalled(root: string, preset: ServicePreset): Promise<boolean> {
  const binary = preset.command.split(/\s+/)[0]?.replace(/^"|"$/g, "") ?? "";
  if (!binary) return false;
  return pathExists(resolvePath(root, binary));
}

/** Service ids included in a profile stack. */
export function getProfileServiceIds(profile: Profile): string[] {
  const normalized = normalizeProfile(profile);
  const ids: string[] = ["php-fpm"];
  ids.push(normalized.webServer === "apache" ? "apache" : "nginx");
  if (normalized.database && normalized.database !== "none") {
    ids.push(normalized.database);
  }
  for (const id of normalized.services ?? []) {
    if (!ids.includes(id)) ids.push(id);
  }
  return ids;
}

export async function getProfileServices(
  root: string,
  profileName?: string
): Promise<ProfileService[]> {
  const config = await loadConfig(root);
  const name = profileName ?? config.activeProfile;
  const profile = normalizeProfile(await loadProfile(root, name));
  const presets = await getServicePresetsForProfile(root, profile);
  const entries = await parseProcfile(root);
  const entryMap = new Map(entries.map((e) => [e.name, e]));

  const services: ProfileService[] = [];
  for (const id of getProfileServiceIds(profile)) {
    const preset = presets.find((p) => p.id === id);
    if (!preset) continue;
    services.push({
      ...preset,
      command: entryMap.get(id)?.command ?? preset.command,
      runtimeInstalled: await isPresetRuntimeInstalled(root, preset),
    });
  }
  return services;
}

export async function previewProfileSwitch(
  root: string,
  profileName: string
): Promise<{ runningToStop: string[]; targetServiceIds: string[] }> {
  const profile = normalizeProfile(await loadProfile(root, profileName));
  const targetServiceIds = getProfileServiceIds(profile);
  const allowed = new Set(targetServiceIds);
  const { getServiceStatuses } = await import("./services.js");
  const runningToStop = getServiceStatuses()
    .filter((s) => s.running)
    .map((s) => s.name)
    .filter((name) => !allowed.has(name));
  return { runningToStop, targetServiceIds };
}
