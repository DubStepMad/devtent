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
  /** True for zend_extension entries (e.g. xdebug). */
  zend?: boolean;
}

export interface PhpIniSummary {
  phpVersion: string;
  iniPath: string;
  exists: boolean;
  content: string;
  extensions: PhpIniExtension[];
  /** Short IDE / debugger setup hint when Xdebug is enabled. */
  xdebugIdeHint?: string;
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

/** Extensions that must use zend_extension= (not extension=). */
const ZEND_EXTENSIONS = new Set(["xdebug"]);

const XDEBUG_DEFAULT_SETTINGS = [
  "xdebug.mode=debug,develop",
  "xdebug.start_with_request=trigger",
  "xdebug.client_host=127.0.0.1",
  "xdebug.client_port=9003",
  "xdebug.idekey=DEVTENT",
];

export const XDEBUG_IDE_HINT =
  "Listen for Xdebug on port 9003 (IDE key DEVTENT). Trigger with XDEBUG_TRIGGER=1 or a browser cookie/extension.";

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

function isZendExtension(name: string): boolean {
  return ZEND_EXTENSIONS.has(name);
}

function filePresentFor(
  name: string,
  extDirListing: Set<string>
): boolean {
  return (
    extDirListing.has(`php_${name}.dll`) ||
    extDirListing.has(`${name}.dll`) ||
    extDirListing.has(`${name}.so`) ||
    extDirListing.has(`php_${name}.so`)
  );
}

function parseExtensions(content: string, extDirListing: Set<string>): PhpIniExtension[] {
  const found = new Map<string, PhpIniExtension>();

  for (const line of content.split(/\r?\n/)) {
    const match = line.match(
      /^\s*;?\s*(zend_extension|extension)\s*=\s*(?:["']?)([^"'\s;]+)/i
    );
    if (!match) continue;
    const kind = match[1]!.toLowerCase();
    const raw = match[2]!.replace(/^php_/i, "").replace(/\.(dll|so)$/i, "");
    const name = path.basename(raw).toLowerCase();
    const enabled = !/^\s*;/.test(line);
    const zend = kind === "zend_extension" || isZendExtension(name);
    const present =
      filePresentFor(name, extDirListing) || extDirListing.size === 0;
    found.set(name, {
      name,
      enabled,
      line: line.trim(),
      filePresent: present,
      zend,
    });
  }

  for (const name of [...COMMON_EXTENSIONS, ...ZEND_EXTENSIONS]) {
    if (found.has(name)) continue;
    const present = filePresentFor(name, extDirListing);
    if (!present && extDirListing.size > 0) continue;
    const zend = isZendExtension(name);
    found.set(name, {
      name,
      enabled: false,
      line: zend ? `;zend_extension=${name}` : `;extension=${name}`,
      filePresent: present || extDirListing.size === 0,
      zend,
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

function applyXdebugSettings(content: string, enabled: boolean): string {
  const lines = content.split(/\r?\n/);
  const settingKeys = new Set(
    XDEBUG_DEFAULT_SETTINGS.map((s) => s.split("=")[0]!.toLowerCase())
  );
  const without = lines.filter((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(";")) {
      // Keep comments unless they are our exact setting lines commented out.
      const uncommented = trimmed.replace(/^;\s*/, "");
      const key = uncommented.split("=")[0]?.toLowerCase();
      return !key || !settingKeys.has(key);
    }
    const key = trimmed.split("=")[0]?.toLowerCase();
    return !key || !settingKeys.has(key);
  });

  if (!enabled) {
    return without.join("\n").replace(/\n{3,}/g, "\n\n");
  }

  const body = without.join("\n").replace(/\s+$/, "");
  return `${body}\n\n; DevTent Xdebug defaults\n${XDEBUG_DEFAULT_SETTINGS.join("\n")}\n`;
}

export async function readPhpIni(root: string, phpVersion: string): Promise<PhpIniSummary> {
  await ensurePhpCaptureForVersion(root, phpVersion);
  const iniPath = iniPathFor(root, phpVersion);
  const exists = await pathExists(iniPath);
  const content = exists ? await readFile(iniPath, "utf-8") : "";
  const extDir = await listExtDir(root, phpVersion);
  const extensions = parseExtensions(content, extDir);
  const xdebug = extensions.find((e) => e.name === "xdebug");
  return {
    phpVersion,
    iniPath,
    exists,
    content,
    extensions,
    xdebugIdeHint: xdebug?.enabled ? XDEBUG_IDE_HINT : undefined,
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
  const zend = isZendExtension(name);
  const directive = zend ? "zend_extension" : "extension";
  const extRe = new RegExp(
    `^\\s*;?\\s*(?:zend_extension|extension)\\s*=\\s*(?:["']?)(?:(?:.*[/\\\\])?(?:php_)?)${name}(?:\\.(?:dll|so))?`,
    "i"
  );
  let touched = false;
  let next = lines.map((line) => {
    if (!extRe.test(line)) return line;
    touched = true;
    return enabled ? `${directive}=${name}` : `;${directive}=${name}`;
  });
  if (!touched && enabled) {
    next.push(`${directive}=${name}`);
  }

  if (name === "xdebug") {
    next = applyXdebugSettings(next.join("\n"), enabled).split(/\r?\n/);
  }

  return writePhpIni(root, phpVersion, next.join("\n") + (next[next.length - 1] === "" ? "" : "\n"));
}
