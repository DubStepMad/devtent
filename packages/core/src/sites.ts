import path from "node:path";
import { readdir, stat } from "node:fs/promises";
import { loadConfig, saveConfig, resolvePath, pathExists, loadProfile } from "./config.js";
import type { DevTentConfig, LinkedSite, SitesConfig, VirtualHost } from "./types.js";
import { hasSslCertificate } from "./ssl.js";

async function isDirectory(dirPath: string): Promise<boolean> {
  try {
    return (await stat(dirPath)).isDirectory();
  } catch {
    return false;
  }
}

/** Laragon-style web root: Laravel/Symfony public/ (or web/) when present. */
export async function resolveProjectWebRoot(projectDir: string): Promise<string> {
  const publicDir = path.join(projectDir, "public");
  if (await isDirectory(publicDir)) {
    return publicDir;
  }

  const webDir = path.join(projectDir, "web");
  if ((await isDirectory(webDir)) && (await pathExists(path.join(webDir, "index.php")))) {
    return webDir;
  }

  return projectDir;
}

export async function discoverProjectNames(wwwRoot: string): Promise<string[]> {
  if (!(await pathExists(wwwRoot))) return [];

  const entries = await readdir(wwwRoot, { withFileTypes: true });
  return entries.filter((e) => e.isDirectory()).map((e) => e.name);
}

function normalizeSites(config: DevTentConfig): Required<SitesConfig> & { phpOverrides: Record<string, string> } {
  return {
    parked: config.sites?.parked ?? [],
    linked: config.sites?.linked ?? [],
    phpOverrides: config.sites?.phpOverrides ?? {},
  };
}

export async function listParkedPaths(root: string): Promise<string[]> {
  const config = await loadConfig(root);
  return normalizeSites(config).parked;
}

export async function listLinkedSites(root: string): Promise<LinkedSite[]> {
  const config = await loadConfig(root);
  return normalizeSites(config).linked;
}

export async function addParkedPath(root: string, folderPath: string): Promise<string[]> {
  const resolved = path.resolve(folderPath);
  if (!(await pathExists(resolved))) {
    throw new Error(`Folder not found: ${resolved}`);
  }

  const config = await loadConfig(root);
  const sites = normalizeSites(config);
  const parked = sites.parked;
  if (!parked.some((p) => path.resolve(p) === resolved)) {
    parked.push(resolved);
  }
  await saveConfig(root, { ...config, sites: { ...sites, parked } });
  return parked;
}

export async function removeParkedPath(root: string, folderPath: string): Promise<string[]> {
  const resolved = path.resolve(folderPath);
  const config = await loadConfig(root);
  const sites = normalizeSites(config);
  const parked = (sites.parked ?? []).filter((p) => path.resolve(p) !== resolved);
  await saveConfig(root, { ...config, sites: { ...sites, parked } });
  return parked;
}

function validateSiteName(name: string): void {
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(name)) {
    throw new Error(
      `Invalid site name "${name}". Use letters, numbers, and hyphens (e.g. my-app).`
    );
  }
}

export async function linkSite(
  root: string,
  projectPath: string,
  name?: string
): Promise<LinkedSite[]> {
  const resolved = path.resolve(projectPath);
  if (!(await pathExists(resolved))) {
    throw new Error(`Project folder not found: ${resolved}`);
  }

  const siteName = name ?? path.basename(resolved);
  validateSiteName(siteName);

  const config = await loadConfig(root);
  const sites = normalizeSites(config);
  const linked = sites.linked.filter((s) => s.name !== siteName);
  linked.push({ name: siteName, path: resolved });

  await saveConfig(root, { ...config, sites: { ...sites, linked } });
  return linked;
}

export async function unlinkSite(root: string, name: string): Promise<LinkedSite[]> {
  const config = await loadConfig(root);
  const sites = normalizeSites(config);
  const linked = sites.linked.filter((s) => s.name !== name);
  await saveConfig(root, { ...config, sites: { ...sites, linked } });
  return linked;
}

export async function setSitePhpVersion(
  root: string,
  name: string,
  phpVersion: string | null
): Promise<{ linked: LinkedSite[]; phpOverrides: Record<string, string> }> {
  const config = await loadConfig(root);
  const sites = normalizeSites(config);
  const linked = sites.linked;
  const phpOverrides = { ...sites.phpOverrides };
  const entry = linked.find((s) => s.name === name);

  if (entry) {
    if (phpVersion) {
      entry.phpVersion = phpVersion;
    } else {
      delete entry.phpVersion;
    }
  } else {
    if (phpVersion) {
      phpOverrides[name] = phpVersion;
    } else {
      delete phpOverrides[name];
    }
  }

  await saveConfig(root, {
    ...config,
    sites: { ...sites, linked, phpOverrides },
  });
  return { linked, phpOverrides };
}

/** Discover sites from www/, parked folders, and linked paths (Yerd-style). */
export async function discoverAllVirtualHosts(root: string): Promise<VirtualHost[]> {
  const config = await loadConfig(root);
  const profile = await loadProfile(root, config.activeProfile);
  const sites = normalizeSites(config);
  const defaultPhp = profile.phpVersion;
  const phpOverrides = sites.phpOverrides;
  const tld = config.tld;
  const seen = new Set<string>();
  const vhosts: VirtualHost[] = [];

  const pushSite = async (entry: {
    name: string;
    projectDir: string;
    source: VirtualHost["source"];
    parkedFrom?: string;
    phpVersion?: string;
  }) => {
    if (seen.has(entry.name)) return;
    seen.add(entry.name);

    const domain = `${entry.name}.${tld}`;
    vhosts.push({
      name: entry.name,
      domain,
      root: await resolveProjectWebRoot(entry.projectDir),
      ssl: await hasSslCertificate(root, domain),
      phpVersion: entry.phpVersion ?? phpOverrides[entry.name] ?? defaultPhp,
      source: entry.source,
      projectPath: entry.projectDir,
      parkedFrom: entry.parkedFrom,
    });
  };

  const wwwRoot = resolvePath(root, config.paths.www);
  for (const name of await discoverProjectNames(wwwRoot)) {
    await pushSite({
      name,
      projectDir: path.join(wwwRoot, name),
      source: "www",
      phpVersion: phpOverrides[name],
    });
  }

  for (const parkedRoot of sites.parked) {
    if (!(await pathExists(parkedRoot))) continue;
    for (const name of await discoverProjectNames(parkedRoot)) {
      await pushSite({
        name,
        projectDir: path.join(parkedRoot, name),
        source: "parked",
        parkedFrom: parkedRoot,
        phpVersion: phpOverrides[name],
      });
    }
  }

  for (const link of sites.linked) {
    if (!(await pathExists(link.path))) continue;
    await pushSite({
      name: link.name,
      projectDir: link.path,
      source: "linked",
      phpVersion: link.phpVersion,
    });
  }

  return vhosts.sort((a, b) => a.name.localeCompare(b.name));
}
