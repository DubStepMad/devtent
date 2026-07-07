import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadConfig, loadProfile, resolvePath, pathExists } from "./config.js";
import { parseProcfile, saveProcfileEntry } from "./services.js";
import {
  DEFAULT_PHP_VERSION,
  getPhpDisplayName,
  normalizeProfile,
  resolvePhpPaths,
} from "./profile-runtime.js";
import type { ProcfileEntry } from "./types.js";

export interface ServicePreset {
  id: string;
  name: string;
  command: string;
}

export interface ProcfileToggle extends ServicePreset {
  enabled: boolean;
  runtimeInstalled: boolean;
}

async function isPresetRuntimeInstalled(root: string, preset: ServicePreset): Promise<boolean> {
  const binary = preset.command.split(/\s+/)[0]?.replace(/^"|"$/g, "");
  if (!binary) return false;
  return pathExists(resolvePath(root, binary));
}

export async function readProcfileRaw(root: string): Promise<string> {
  const procfilePath = path.join(root, "Procfile");
  if (!(await pathExists(procfilePath))) return "";
  return readFile(procfilePath, "utf-8");
}

export async function writeProcfileRaw(root: string, content: string): Promise<void> {
  const procfilePath = path.join(root, "Procfile");
  await writeFile(procfilePath, content.endsWith("\n") ? content : content + "\n", "utf-8");
}

export async function getServicePresets(root: string): Promise<ServicePreset[]> {
  try {
    const config = await loadConfig(root);
    const profile = normalizeProfile(await loadProfile(root, config.activeProfile));
    return getServicePresetsForProfile(root, profile);
  } catch {
    return getServicePresetsForProfile(root, normalizeProfile({ name: "default" }));
  }
}

export async function getServicePresetsForProfile(
  root: string,
  profile: import("./types.js").Profile
): Promise<ServicePreset[]> {
  const normalized = normalizeProfile(profile);
  const phpVersion = normalized.phpVersion ?? DEFAULT_PHP_VERSION;
  const phpLabel = getPhpDisplayName(phpVersion);
  const phpPaths = resolvePhpPaths(phpVersion);
  const phpCommand = phpPaths.procfileCommand;

  return [
    {
      id: "nginx",
      name: "NGINX",
      command: "bin/nginx/nginx.exe -p . -c etc/nginx/nginx.conf",
    },
    {
      id: "apache",
      name: "Apache",
      command: "bin/apache/bin/httpd.exe -d . -f etc/apache/httpd.conf",
    },
    {
      id: "mysql",
      name: "MySQL",
      command: "bin/mysql/bin/mysqld.exe --defaults-file=etc/mysql/my.ini --console",
    },
    {
      id: "mariadb",
      name: "MariaDB",
      command: "bin/mariadb/bin/mysqld.exe --defaults-file=etc/mariadb/my.ini --console",
    },
    {
      id: "postgresql",
      name: "PostgreSQL",
      command: 'bin/postgresql/bin/postgres.exe -D data/postgresql -p 5432',
    },
    {
      id: "redis",
      name: "Redis",
      command: "bin/redis/redis-server.exe bin/redis/redis.windows.conf",
    },
    {
      id: "mailpit",
      name: "Mailpit",
      command: "bin/mailpit/mailpit.exe",
    },
    {
      id: "php-fpm",
      name: phpLabel,
      command: phpCommand,
    },
  ];
}

export async function syncPhpProcfileFromProfile(root: string): Promise<void> {
  const { syncPhpCgiProcfile } = await import("./php-cgi-sync.js");
  await syncPhpCgiProcfile(root);
}

export async function getProcfileToggles(root: string): Promise<ProcfileToggle[]> {
  const presets = await getServicePresets(root);
  const entries = await parseProcfile(root);
  const entryMap = new Map(entries.map((e) => [e.name, e]));

  const toggles: ProcfileToggle[] = [];
  for (const preset of presets) {
    toggles.push({
      ...preset,
      enabled: entryMap.has(preset.id),
      command: entryMap.get(preset.id)?.command ?? preset.command,
      runtimeInstalled: await isPresetRuntimeInstalled(root, preset),
    });
  }
  return toggles;
}

export async function enableCoreServicesIfReady(root: string): Promise<boolean> {
  const entries = await parseProcfile(root);
  if (entries.length > 0) return false;

  const { syncProfileProcfileFromProfile } = await import("./profile-procfile.js");
  await syncProfileProcfileFromProfile(root, { mode: "merge" });
  const after = await parseProcfile(root);
  return after.length > 0;
}

export async function setProcfileToggle(
  root: string,
  id: string,
  enabled: boolean
): Promise<ProcfileToggle[]> {
  const presets = await getServicePresets(root);
  const preset = presets.find((p) => p.id === id);
  if (!preset) {
    throw new Error(`Unknown service: ${id}`);
  }

  const entries = await parseProcfile(root);
  let filtered = entries.filter((e) => e.name !== id);

  if (enabled) {
    if (id === "nginx") {
      filtered = filtered.filter((e) => e.name !== "apache");
    } else if (id === "apache") {
      filtered = filtered.filter((e) => e.name !== "nginx");
    } else if (id === "mysql") {
      filtered = filtered.filter((e) => e.name !== "postgresql" && e.name !== "mariadb");
    } else if (id === "mariadb") {
      filtered = filtered.filter((e) => e.name !== "postgresql" && e.name !== "mysql");
    } else if (id === "postgresql") {
      filtered = filtered.filter((e) => e.name !== "mysql" && e.name !== "mariadb");
    }
    filtered.push({ name: id, command: preset.command });
  }

  const content =
    filtered.length > 0
      ? filtered.map((e) => `${e.name}: ${e.command}`).join("\n") + "\n"
      : "# DevTent Procfile — enable services from the tray panel\n";

  await writeProcfileRaw(root, content);
  return getProcfileToggles(root);
}

export async function updateProcfileEntry(root: string, entry: ProcfileEntry): Promise<void> {
  await saveProcfileEntry(root, entry);
}
