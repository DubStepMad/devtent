import type { QuickAddManifest } from "./types.js";
import {
  compareVersionStrings,
  escapeRegExp,
  replaceLiteralVersion,
  readRuntimeRecord,
  writeRuntimeRecord,
  wipeInstallPreserving,
  type RuntimeRecord,
} from "./runtime-record.js";
import { isManifestInstalled } from "./profile-runtime.js";

const WINDOWS_RELEASES_JSON =
  "https://downloads.php.net/~windows/releases/releases.json";
const WINDOWS_RELEASES_BASE = "https://downloads.php.net/~windows/releases/";
const STATIC_PHP_COMMON = "https://dl.static-php.dev/static-php-cli/common/";
const CACHE_MS = 60 * 60 * 1000;

export type PhpRuntimeRecord = RuntimeRecord & {
  source: "windows.php.net" | "static-php" | "manifest";
};

export interface PhpLatestBuild {
  minor: string;
  version: string;
  url: string;
  sha256?: string;
  source: "windows.php.net" | "static-php";
}

export interface PhpUpdateStatus {
  name: string;
  minor: string;
  installed: boolean;
  installedVersion?: string;
  manifestVersion: string;
  latestVersion?: string;
  updateAvailable: boolean;
  latestUrl?: string;
}

type ReleasesJson = Record<
  string,
  {
    version?: string;
    [variant: string]:
      | string
      | undefined
      | {
          zip?: { path?: string; sha256?: string };
        };
  }
>;

let releasesCache: { at: number; data: ReleasesJson } | null = null;

export function isPhpManifestName(name: string): boolean {
  return /^php-\d+\.\d+$/i.test(name.trim());
}

/** `php-8.4` → `8.4` */
export function phpMinorFromManifestName(name: string): string | null {
  const match = name.trim().match(/^php-(\d+\.\d+)$/i);
  return match?.[1] ?? null;
}

export function comparePhpVersions(a: string, b: string): number {
  return compareVersionStrings(a, b);
}

export async function readPhpRuntimeRecord(
  root: string,
  installPath: string
): Promise<PhpRuntimeRecord | null> {
  const record = await readRuntimeRecord(root, installPath);
  return record as PhpRuntimeRecord | null;
}

export async function writePhpRuntimeRecord(
  root: string,
  installPath: string,
  record: PhpRuntimeRecord
): Promise<void> {
  await writeRuntimeRecord(root, installPath, record);
}

async function fetchWindowsReleasesJson(fetcher: typeof fetch = fetch): Promise<ReleasesJson> {
  if (releasesCache && Date.now() - releasesCache.at < CACHE_MS) {
    return releasesCache.data;
  }
  const response = await fetcher(WINDOWS_RELEASES_JSON, {
    headers: { Accept: "application/json", "User-Agent": "DevTent" },
  });
  if (!response.ok) {
    throw new Error(`PHP releases.json HTTP ${response.status}`);
  }
  const data = (await response.json()) as ReleasesJson;
  releasesCache = { at: Date.now(), data };
  return data;
}

/** Prefer NTS x64 variant keys used by current PHP Windows builds. */
export function pickWindowsNtsX64Variant(
  entry: ReleasesJson[string]
): { path: string; sha256?: string } | null {
  const preferred = ["nts-vs17-x64", "nts-vs16-x64", "nts-vc15-x64"];
  for (const key of preferred) {
    const variant = entry[key];
    if (variant && typeof variant === "object" && variant.zip?.path) {
      return { path: variant.zip.path, sha256: variant.zip.sha256 };
    }
  }
  for (const [key, variant] of Object.entries(entry)) {
    if (!key.startsWith("nts-") || !key.endsWith("-x64")) continue;
    if (variant && typeof variant === "object" && variant.zip?.path) {
      return { path: variant.zip.path, sha256: variant.zip.sha256 };
    }
  }
  return null;
}

export function staticPhpOsArch(
  platform: string = process.platform,
  arch: string = process.arch
): string | null {
  if (platform === "darwin" && arch === "arm64") return "macos-aarch64";
  if (platform === "darwin" && arch === "x64") return "macos-x86_64";
  if (platform === "linux" && arch === "x64") return "linux-x86_64";
  if (platform === "linux" && arch === "arm64") return "linux-aarch64";
  return null;
}

export function buildStaticPhpFpmUrl(version: string, osArch: string): string {
  return `${STATIC_PHP_COMMON}php-${version}-fpm-${osArch}.tar.gz`;
}

/** Parse highest patch for a minor line from a static-php directory listing HTML. */
export function pickLatestStaticPhpVersionFromListing(
  html: string,
  minor: string,
  osArch: string
): string | null {
  // Bound input size and use fixed-width digit classes to keep matching linear-time.
  const sample = html.length > 2_000_000 ? html.slice(0, 2_000_000) : html;
  const escapedMinor = escapeRegExp(minor);
  const escapedArch = escapeRegExp(osArch);
  const re = new RegExp(
    `php-(${escapedMinor}\\.\\d{1,3})-fpm-${escapedArch}\\.tar\\.gz`,
    "gi"
  );
  let best: string | null = null;
  for (const match of sample.matchAll(re)) {
    const version = match[1]!;
    if (!best || comparePhpVersions(version, best) > 0) best = version;
  }
  return best;
}

async function resolveWindowsLatest(
  minor: string,
  fetcher: typeof fetch
): Promise<PhpLatestBuild> {
  const data = await fetchWindowsReleasesJson(fetcher);
  const entry = data[minor];
  if (!entry?.version) {
    throw new Error(`No Windows PHP release found for ${minor}`);
  }
  const zip = pickWindowsNtsX64Variant(entry);
  if (!zip) {
    throw new Error(`No NTS x64 Windows build for PHP ${minor}`);
  }
  return {
    minor,
    version: entry.version,
    url: new URL(zip.path, WINDOWS_RELEASES_BASE).href,
    sha256: zip.sha256,
    source: "windows.php.net",
  };
}

async function resolveStaticPhpLatest(
  minor: string,
  platform: string,
  arch: string,
  fetcher: typeof fetch
): Promise<PhpLatestBuild> {
  const osArch = staticPhpOsArch(platform, arch);
  if (!osArch) {
    throw new Error(`Unsupported platform for static-php PHP builds: ${platform}/${arch}`);
  }

  // Prefer the same patch as windows.php.net when that build exists on static-php.
  try {
    const data = await fetchWindowsReleasesJson(fetcher);
    const candidateVersion = data[minor]?.version;
    if (candidateVersion) {
      const url = buildStaticPhpFpmUrl(candidateVersion, osArch);
      const head = await fetcher(url, { method: "HEAD" }).catch(() => null);
      if (head && (head.ok || head.status === 301 || head.status === 302)) {
        return { minor, version: candidateVersion, url, source: "static-php" };
      }
    }
  } catch {
    // fall through to directory listing
  }

  const listing = await fetcher(STATIC_PHP_COMMON);
  if (!listing.ok) {
    throw new Error(`static-php listing HTTP ${listing.status}`);
  }
  const version = pickLatestStaticPhpVersionFromListing(await listing.text(), minor, osArch);
  if (!version) {
    throw new Error(`No static-php FPM build found for PHP ${minor} (${osArch})`);
  }
  return {
    minor,
    version,
    url: buildStaticPhpFpmUrl(version, osArch),
    source: "static-php",
  };
}

export async function resolveLatestPhpBuild(
  minor: string,
  options?: {
    platform?: NodeJS.Platform;
    arch?: string;
    fetcher?: typeof fetch;
  }
): Promise<PhpLatestBuild> {
  const platform = options?.platform ?? process.platform;
  const arch = options?.arch ?? process.arch;
  const fetcher = options?.fetcher ?? fetch;

  if (platform === "win32") {
    return resolveWindowsLatest(minor, fetcher);
  }
  return resolveStaticPhpLatest(minor, platform, arch, fetcher);
}

function withResolvedVersion(
  manifest: QuickAddManifest,
  version: string,
  url: string,
  downloadType: QuickAddManifest["downloadType"]
): QuickAddManifest & { resolvedFromLatest: boolean } {
  return {
    ...manifest,
    version,
    url,
    downloadType,
    description: replaceLiteralVersion(manifest.description, manifest.version, version),
    resolvedFromLatest: true,
  };
}

/**
 * Overlay a php-* Quick Add manifest with the newest patch release for that line.
 * Falls back to the pinned manifest URL/version when the network lookup fails.
 */
export async function resolvePhpManifestToLatest(
  manifest: QuickAddManifest,
  options?: {
    platform?: NodeJS.Platform;
    arch?: string;
    fetcher?: typeof fetch;
    onFallback?: (err: unknown) => void;
  }
): Promise<QuickAddManifest & { resolvedFromLatest: boolean }> {
  const minor = phpMinorFromManifestName(manifest.name);
  if (!minor) {
    return { ...manifest, resolvedFromLatest: false };
  }

  try {
    const latest = await resolveLatestPhpBuild(minor, options);
    const platform = options?.platform ?? process.platform;
    return withResolvedVersion(
      manifest,
      latest.version,
      latest.url,
      platform === "win32" ? "zip" : "tar.gz"
    );
  } catch (err) {
    options?.onFallback?.(err);
    return { ...manifest, resolvedFromLatest: false };
  }
}

export async function getInstalledPhpVersion(
  root: string,
  manifest: QuickAddManifest
): Promise<string | undefined> {
  return (await readPhpRuntimeRecord(root, manifest.installPath))?.version;
}

export async function checkPhpUpdateStatus(
  root: string,
  manifest: QuickAddManifest,
  options?: {
    platform?: NodeJS.Platform;
    arch?: string;
    fetcher?: typeof fetch;
  }
): Promise<PhpUpdateStatus> {
  const minor = phpMinorFromManifestName(manifest.name) ?? "";
  const [installedVersion, properlyInstalled] = await Promise.all([
    getInstalledPhpVersion(root, manifest),
    isManifestInstalled(root, manifest),
  ]);
  const installed = Boolean(installedVersion) || properlyInstalled;

  let latestVersion: string | undefined;
  let latestUrl: string | undefined;
  if (minor) {
    try {
      const latest = await resolveLatestPhpBuild(minor, options);
      latestVersion = latest.version;
      latestUrl = latest.url;
    } catch {
      // offline — leave latest unset
    }
  }

  // No runtime marker → treat as older than latest so Update appears once.
  const compareFrom = installedVersion ?? (installed ? "0.0.0" : manifest.version);
  return {
    name: manifest.name,
    minor,
    installed,
    installedVersion,
    manifestVersion: manifest.version,
    latestVersion,
    updateAvailable: Boolean(
      installed && latestVersion && comparePhpVersions(latestVersion, compareFrom) > 0
    ),
    latestUrl,
  };
}

/** Preserve php.ini across a wipe so user toggles survive updates. */
export async function wipePhpInstallPreservingIni(
  root: string,
  installPathRel: string
): Promise<string | null> {
  const preserved = await wipeInstallPreserving(root, installPathRel, ["php.ini"]);
  return preserved.get("php.ini") ?? null;
}

/** Test helper — clear the in-memory releases cache. */
export function clearPhpReleasesCache(): void {
  releasesCache = null;
}
