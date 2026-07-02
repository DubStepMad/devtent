import path from "node:path";
import { loadConfig, loadProfile, resolvePath, pathExists } from "./config.js";
import { normalizeProfile } from "./profile-runtime.js";
import { parseProcfile } from "./services.js";
import { getServicePresets, writeProcfileRaw, syncPhpProcfileFromProfile } from "./procfile.js";
import type { ProcfileEntry } from "./types.js";

const OPTIONAL_SERVICE_IDS = new Set(["redis", "mailpit"]);

export type ProfileProcfileSyncMode = "merge" | "replace";

async function isPresetInstalled(root: string, command: string): Promise<boolean> {
  const binary = command.split(/\s+/)[0]?.replace(/^"|"$/g, "") ?? "";
  if (!binary) return false;
  return pathExists(resolvePath(root, binary));
}

function applyStackExclusions(entries: ProcfileEntry[]): ProcfileEntry[] {
  const names = new Set(entries.map((e) => e.name));
  if (names.has("nginx")) {
    return entries.filter((e) => e.name !== "apache");
  }
  if (names.has("apache")) {
    return entries.filter((e) => e.name !== "nginx");
  }
  if (names.has("mysql")) {
    return entries.filter((e) => e.name !== "postgresql");
  }
  if (names.has("postgresql")) {
    return entries.filter((e) => e.name !== "mysql");
  }
  return entries;
}

async function buildProfileOptionalEntries(
  root: string,
  profile: ReturnType<typeof normalizeProfile>,
  presets: Awaited<ReturnType<typeof getServicePresets>>
): Promise<ProcfileEntry[]> {
  const next: ProcfileEntry[] = [];
  for (const id of profile.services ?? []) {
    if (!OPTIONAL_SERVICE_IDS.has(id)) continue;
    const preset = presets.find((p) => p.id === id);
    if (preset && (await isPresetInstalled(root, preset.command))) {
      next.push({ name: id, command: preset.command });
    }
  }
  return next;
}

async function buildProfileStackEntries(
  root: string,
  profile: ReturnType<typeof normalizeProfile>,
  presets: Awaited<ReturnType<typeof getServicePresets>>
): Promise<ProcfileEntry[]> {
  const next: ProcfileEntry[] = [];

  const phpPreset = presets.find((p) => p.id === "php-fpm");
  if (phpPreset && (await isPresetInstalled(root, phpPreset.command))) {
    next.push({ name: "php-fpm", command: phpPreset.command });
  }

  const webServer = profile.webServer ?? "nginx";
  const webId = webServer === "apache" ? "apache" : "nginx";
  const webPreset = presets.find((p) => p.id === webId);
  if (webPreset && (await isPresetInstalled(root, webPreset.command))) {
    next.push({ name: webId, command: webPreset.command });
  }

  const database = profile.database ?? "mysql";
  if (database !== "none") {
    const dbPreset = presets.find((p) => p.id === database);
    if (dbPreset && (await isPresetInstalled(root, dbPreset.command))) {
      next.push({ name: database, command: dbPreset.command });
    }
  }

  return applyStackExclusions(next);
}

export async function syncProfileProcfileFromProfile(
  root: string,
  options?: { mode?: ProfileProcfileSyncMode }
): Promise<void> {
  const mode = options?.mode ?? "merge";
  const config = await loadConfig(root);
  const profile = normalizeProfile(await loadProfile(root, config.activeProfile));
  const presets = await getServicePresets(root);
  const entries = await parseProcfile(root);

  if (mode === "merge" && entries.length > 0) {
    const byName = new Map(entries.map((e) => [e.name, e]));
    for (const preset of presets) {
      if (!byName.has(preset.id)) continue;
      if (await isPresetInstalled(root, preset.command)) {
        byName.set(preset.id, { name: preset.id, command: preset.command });
      }
    }
    const merged = applyStackExclusions([...byName.values()]);
    const content =
      merged.length > 0
        ? merged.map((e) => `${e.name}: ${e.command}`).join("\n") + "\n"
        : "# DevTent Procfile — enable services from the tray panel\n";
    await writeProcfileRaw(root, content);
    await syncPhpProcfileFromProfile(root);
    return;
  }

  const optional = await buildProfileOptionalEntries(root, profile, presets);
  const stack = await buildProfileStackEntries(root, profile, presets);
  const next: ProcfileEntry[] = [...optional, ...stack];

  const content =
    next.length > 0
      ? next.map((e) => `${e.name}: ${e.command}`).join("\n") + "\n"
      : "# DevTent Procfile — enable services from the tray panel\n";

  await writeProcfileRaw(root, content);
  await syncPhpProcfileFromProfile(root);
}
