import path from "node:path";
import { pathExists, resolvePath } from "./config.js";
import type { Profile, QuickAddManifest } from "./types.js";

export const DEFAULT_PHP_VERSION = "php-8.3";

export interface PhpRuntimePaths {
  phpVersion: string;
  cli: string;
  cgi: string;
  phpRc: string;
  procfileCommand: string;
}

export function phpVersionFromLegacyPath(phpPath?: string): string | undefined {
  if (!phpPath) return undefined;
  const normalized = phpPath.replace(/\\/g, "/");
  const match = normalized.match(/bin\/php\/(php-[\d.]+)/i);
  return match?.[1];
}

export function resolvePhpPaths(phpVersion: string): PhpRuntimePaths {
  const base = `bin/php/${phpVersion}`;
  const cgi = `${base}/php-cgi.exe`;
  return {
    phpVersion,
    cli: `${base}/php.exe`,
    cgi,
    phpRc: base,
    procfileCommand: `${cgi} -b 127.0.0.1:9000`,
  };
}

export function normalizeProfile(profile: Profile): Profile {
  const phpVersion =
    profile.phpVersion ?? phpVersionFromLegacyPath(profile.php) ?? DEFAULT_PHP_VERSION;
  const paths = resolvePhpPaths(phpVersion);

  return {
    ...profile,
    phpVersion,
    php: paths.cli,
    env: {
      ...profile.env,
      PHPRC: paths.phpRc,
    },
  };
}

export async function isManifestInstalled(
  root: string,
  manifest: QuickAddManifest
): Promise<boolean> {
  if (manifest.binary) {
    const binaryPath = resolvePath(root, path.join(manifest.installPath, manifest.binary));
    if (await pathExists(binaryPath)) return true;
  }
  return pathExists(resolvePath(root, manifest.installPath));
}

export async function isPhpVersionInstalled(root: string, phpVersion: string): Promise<boolean> {
  const paths = resolvePhpPaths(phpVersion);
  if (await pathExists(resolvePath(root, paths.cgi))) return true;
  return pathExists(resolvePath(root, paths.cli));
}

export function getPhpDisplayName(phpVersion?: string): string {
  if (!phpVersion) return "PHP";
  return `PHP ${phpVersion.replace(/^php-/, "")}`;
}
