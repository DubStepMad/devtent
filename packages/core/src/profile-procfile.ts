import path from "node:path";
import { loadConfig, loadProfile, resolvePath, pathExists } from "./config.js";
import { normalizeProfile } from "./profile-runtime.js";
import { parseProcfile } from "./services.js";
import { getServicePresets, writeProcfileRaw, syncPhpProcfileFromProfile } from "./procfile.js";
import type { ProcfileEntry } from "./types.js";

const OPTIONAL_SERVICE_IDS = new Set(["redis", "mailpit"]);

async function isPresetInstalled(root: string, command: string): Promise<boolean> {
  const binary = command.split(/\s+/)[0]?.replace(/^"|"$/g, "") ?? "";
  if (!binary) return false;
  return pathExists(resolvePath(root, binary));
}

export async function syncProfileProcfileFromProfile(root: string): Promise<void> {
  const config = await loadConfig(root);
  const profile = normalizeProfile(await loadProfile(root, config.activeProfile));
  const presets = await getServicePresets(root);
  const entries = await parseProcfile(root);

  const optional = entries.filter((e) => OPTIONAL_SERVICE_IDS.has(e.name));
  const next: ProcfileEntry[] = [...optional];

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

  const content =
    next.length > 0
      ? next.map((e) => `${e.name}: ${e.command}`).join("\n") + "\n"
      : "# DevTent Procfile — enable services from the tray panel\n";

  await writeProcfileRaw(root, content);
  await syncPhpProcfileFromProfile(root);
}
