import { loadConfig, loadProfile, resolvePath, pathExists } from "./config.js";
import { discoverAllVirtualHosts } from "./sites.js";
import { isPhpVersionInstalled, resolvePhpPaths } from "./profile-runtime.js";
import { phpCgiProcfileName } from "./php-ports.js";
import { parseProcfile } from "./services.js";
import { writeProcfileRaw } from "./procfile.js";
import type { ProcfileEntry, VirtualHost } from "./types.js";

function isPhpCgiServiceName(name: string): boolean {
  return name === "php-fpm" || name.startsWith("php-cgi-");
}

export async function collectRequiredPhpVersions(
  root: string,
  vhosts?: VirtualHost[]
): Promise<string[]> {
  const config = await loadConfig(root);
  const profile = await loadProfile(root, config.activeProfile);
  const hosts = vhosts ?? (await discoverAllVirtualHosts(root));
  const versions = new Set<string>();

  if (profile.phpVersion) versions.add(profile.phpVersion);
  for (const vhost of hosts) {
    if (vhost.phpVersion) versions.add(vhost.phpVersion);
  }

  return [...versions].sort();
}

export async function syncPhpCgiProcfile(
  root: string,
  vhosts?: VirtualHost[]
): Promise<string[]> {
  const versions = await collectRequiredPhpVersions(root, vhosts);
  const entries = await parseProcfile(root);
  const kept = entries.filter((e) => !isPhpCgiServiceName(e.name));

  const phpEntries: ProcfileEntry[] = [];
  for (const version of versions) {
    if (!(await isPhpVersionInstalled(root, version))) continue;
    const paths = resolvePhpPaths(version);
    phpEntries.push({
      name: phpCgiProcfileName(version),
      command: paths.procfileCommand,
    });
  }

  const next = [...kept, ...phpEntries];
  const content =
    next.length > 0
      ? next.map((e) => `${e.name}: ${e.command}`).join("\n") + "\n"
      : "# DevTent Procfile — enable services from the tray panel\n";

  await writeProcfileRaw(root, content);
  return versions;
}

export async function listInstalledPhpCgiServices(root: string): Promise<string[]> {
  const entries = await parseProcfile(root);
  return entries.filter((e) => e.name.startsWith("php-cgi-")).map((e) => e.name);
}

export async function resolvePhpCgiPortForVersion(
  root: string,
  phpVersion: string
): Promise<number> {
  const paths = resolvePhpPaths(phpVersion);
  if (!(await pathExists(resolvePath(root, paths.cgi)))) {
    throw new Error(`PHP ${phpVersion} is not installed`);
  }
  return paths.cgiPort;
}
