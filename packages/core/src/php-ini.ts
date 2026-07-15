import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { resolvePath, pathExists, loadConfig, loadProfile } from "./config.js";
import { DEFAULT_PHP_VERSION, resolvePhpPaths } from "./profile-runtime.js";
import { ensurePhpCaptureForVersion } from "./dump-capture.js";

export interface PhpIniExtension {
  name: string;
  enabled: boolean;
  /** Line as it appears (or would appear) in php.ini */
  line: string;
  /** Whether the extension DLL/so appears to exist */
  filePresent: boolean;
}

export interface PhpIniSummary {
  phpVersion: string;
  iniPath: string;
  exists: boolean;
  content: string;
  extensions: PhpIniExtension[];
}

const COMMON_EXTENSIONS = [
  "curl",
  "fileinfo",
  "gd",
  "intl",
  "mbstring",
  "exif",
  "mysqli",
  "openssl",
  "pdo_mysql",
  "pdo_pgsql",
  "pdo_sqlite",
  "sockets",
  "zip",
  "opcache",
  "redis",
  "sodium",
  "xsl",
];

function iniPathFor(root: string, phpVersion: string): string {
  const paths = resolvePhpPaths(phpVersion);
  return resolvePath(root, path.join(paths.phpRc, "php.ini"));
}

export async function listInstalledPhpVersions(root: string): Promise<string[]> {
  const phpRoot = resolvePath(root, "bin/php");
  if (!(await pathExists(phpRoot))) return [];
  const entries = await readdir(phpRoot, { withFileTypes: true });
  return entries
    .filter((e) => e.isDirectory() && /^php-\d/.test(e.name))
    .map((e) => e.name)
    .sort();
}

export async function getActivePhpVersion(root: string): Promise<string> {
  const config = await loadConfig(root);
  const profile = await loadProfile(root, config.activeProfile);
  return profile.phpVersion ?? DEFAULT_PHP_VERSION;
}

function parseExtensions(content: string, extDirListing: Set<string>): PhpIniExtension[] {
  const found = new Map<string, PhpIniExtension>();

  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^\s*;?\s*extension\s*=\s*(?:["']?)([^"'\s;]+)/i);
    if (!match) continue;
    const raw = match[1].replace(/^php_/i, "").replace(/\.(dll|so)$/i, "");
    const name = raw.toLowerCase();
    const enabled = !/^\s*;/.test(line);
    const filePresent =
      extDirListing.has(`php_${name}.dll`) ||
      extDirListing.has(`${name}.dll`) ||
      extDirListing.has(`${name}.so`) ||
      extDirListing.has(`php_${name}.so`) ||
      extDirListing.size === 0;
    found.set(name, {
      name,
      enabled,
      line: line.trim(),
      filePresent,
    });
  }

  for (const name of COMMON_EXTENSIONS) {
    if (found.has(name)) continue;
    const filePresent =
      extDirListing.has(`php_${name}.dll`) ||
      extDirListing.has(`${name}.dll`) ||
      extDirListing.has(`${name}.so`) ||
      extDirListing.has(`php_${name}.so`);
    if (!filePresent && extDirListing.size > 0) continue;
    found.set(name, {
      name,
      enabled: false,
      line: `;extension=${name}`,
      filePresent: filePresent || extDirListing.size === 0,
    });
  }

  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name));
}

async function listExtDir(root: string, phpVersion: string): Promise<Set<string>> {
  const paths = resolvePhpPaths(phpVersion);
  const candidates = [
    resolvePath(root, path.join(paths.phpRc, "ext")),
    resolvePath(root, path.join(paths.phpRc, "lib", "php", "extensions")),
  ];
  const names = new Set<string>();
  for (const dir of candidates) {
    if (!(await pathExists(dir))) continue;
    try {
      for (const f of await readdir(dir)) {
        names.add(f.toLowerCase());
      }
    } catch {
      // ignore
    }
  }
  return names;
}

export async function readPhpIni(root: string, phpVersion: string): Promise<PhpIniSummary> {
  await ensurePhpCaptureForVersion(root, phpVersion);
  const iniPath = iniPathFor(root, phpVersion);
  const exists = await pathExists(iniPath);
  const content = exists ? await readFile(iniPath, "utf-8") : "";
  const extDir = await listExtDir(root, phpVersion);
  return {
    phpVersion,
    iniPath,
    exists,
    content,
    extensions: parseExtensions(content, extDir),
  };
}

export async function writePhpIni(
  root: string,
  phpVersion: string,
  content: string
): Promise<PhpIniSummary> {
  const iniPath = iniPathFor(root, phpVersion);
  const dir = path.dirname(iniPath);
  const { mkdir } = await import("node:fs/promises");
  await mkdir(dir, { recursive: true });
  await writeFile(iniPath, content.replace(/\r?\n/g, "\n"), "utf-8");
  await ensurePhpCaptureForVersion(root, phpVersion);
  return readPhpIni(root, phpVersion);
}

export async function setPhpExtension(
  root: string,
  phpVersion: string,
  extensionName: string,
  enabled: boolean
): Promise<PhpIniSummary> {
  const name = extensionName.trim().toLowerCase().replace(/^php_/, "").replace(/\.(dll|so)$/i, "");
  if (!/^[a-z0-9_]+$/.test(name)) throw new Error("Invalid extension name");

  const summary = await readPhpIni(root, phpVersion);
  let content = summary.content || `; DevTent php.ini for ${phpVersion}\n`;
  const lines = content.split(/\r?\n/);
  const extRe = new RegExp(
    `^\\s*;?\\s*extension\\s*=\\s*(?:["']?)(?:php_)?${name}(?:\\.(?:dll|so))?`,
    "i"
  );
  let touched = false;
  const next = lines.map((line) => {
    if (!extRe.test(line)) return line;
    touched = true;
    return enabled ? `extension=${name}` : `;extension=${name}`;
  });
  if (!touched && enabled) {
    next.push(`extension=${name}`);
  }
  return writePhpIni(root, phpVersion, next.join("\n") + (next[next.length - 1] === "" ? "" : "\n"));
}
