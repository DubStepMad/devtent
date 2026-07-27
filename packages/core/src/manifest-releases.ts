import type { QuickAddManifest } from "./types.js";
import {
  compareVersionStrings,
  replaceLiteralVersion,
  readRuntimeRecord,
  writeRuntimeRecord,
} from "./runtime-record.js";
import { isManifestInstalled } from "./profile-runtime.js";
import {
  isPhpManifestName,
  resolvePhpManifestToLatest,
  checkPhpUpdateStatus,
} from "./php-releases.js";

export type ManifestLatestSource =
  | "nodejs.org"
  | "getcomposer.org"
  | "github"
  | "windows.php.net"
  | "static-php"
  | "manifest";

export interface ManifestLatestBuild {
  name: string;
  version: string;
  url: string;
  downloadType?: QuickAddManifest["downloadType"];
  archiveSubdir?: string;
  source: ManifestLatestSource;
}

export interface ManifestUpdateStatus {
  name: string;
  installed: boolean;
  installedVersion?: string;
  manifestVersion: string;
  latestVersion?: string;
  updateAvailable: boolean;
  latestUrl?: string;
}

type FetchLike = typeof fetch;
type PlatformKey = `${string}/${string}`;

const CACHE_MS = 60 * 60 * 1000;
const AUTO_LATEST_TOOLS = new Set([
  "composer",
  "bun",
  "mailpit",
  "cloudflared",
  "meilisearch",
  "minio",
]);

const USER_AGENT = { "User-Agent": "DevTent" } as const;

interface NodeDistEntry {
  version: string;
  files?: string[];
}

interface GitHubRelease {
  tag_name: string;
  assets: Array<{ name: string; browser_download_url: string }>;
}

interface NodePlatformSpec {
  distFile: string;
  downloadType: "zip" | "tar.gz";
  url: (version: string) => string;
  archiveSubdir: (version: string) => string;
}

interface Cached<T> {
  at: number;
  data: T;
}

let nodeIndexCache: Cached<NodeDistEntry[]> | null = null;
let composerVersionCache: Cached<string> | null = null;
const githubLatestCache = new Map<string, Cached<GitHubRelease>>();

const NODE_PLATFORMS: Record<string, NodePlatformSpec> = {
  "win32/x64": {
    distFile: "win-x64-zip",
    downloadType: "zip",
    url: (v) => `https://nodejs.org/dist/v${v}/node-v${v}-win-x64.zip`,
    archiveSubdir: (v) => `node-v${v}-win-x64`,
  },
  "linux/x64": {
    distFile: "linux-x64",
    downloadType: "tar.gz",
    url: (v) => `https://nodejs.org/dist/v${v}/node-v${v}-linux-x64.tar.gz`,
    archiveSubdir: (v) => `node-v${v}-linux-x64`,
  },
  "darwin/arm64": {
    distFile: "osx-arm64-tar",
    downloadType: "tar.gz",
    url: (v) => `https://nodejs.org/dist/v${v}/node-v${v}-darwin-arm64.tar.gz`,
    archiveSubdir: (v) => `node-v${v}-darwin-arm64`,
  },
  "darwin/x64": {
    distFile: "osx-x64-tar",
    downloadType: "tar.gz",
    url: (v) => `https://nodejs.org/dist/v${v}/node-v${v}-darwin-x64.tar.gz`,
    archiveSubdir: (v) => `node-v${v}-darwin-x64`,
  },
};

const BUN_PLATFORMS: Record<string, { asset: string; archiveSubdir: string }> = {
  "win32/x64": { asset: "bun-windows-x64.zip", archiveSubdir: "bun-windows-x64" },
  "linux/x64": { asset: "bun-linux-x64.zip", archiveSubdir: "bun-linux-x64" },
  "darwin/arm64": { asset: "bun-darwin-aarch64.zip", archiveSubdir: "bun-darwin-aarch64" },
  "darwin/x64": { asset: "bun-darwin-x64.zip", archiveSubdir: "bun-darwin-x64" },
};

const MINIO_PLATFORMS: Record<string, { path: string; downloadType: "exe" | "binary" }> = {
  "win32/x64": { path: "windows-amd64/minio.exe", downloadType: "exe" },
  "linux/x64": { path: "linux-amd64/minio", downloadType: "binary" },
  "darwin/arm64": { path: "darwin-arm64/minio", downloadType: "binary" },
  "darwin/x64": { path: "darwin-amd64/minio", downloadType: "binary" },
};

/** GitHub tools keyed by manifest name → owner/repo + asset matchers per platform. */
const GITHUB_TOOLS: Record<
  string,
  {
    owner: string;
    repo: string;
    versionFromTag: (tag: string) => string;
    assets: Record<string, Array<string | RegExp>>;
    archiveSubdir?: Record<string, string>;
  }
> = {
  bun: {
    owner: "oven-sh",
    repo: "bun",
    versionFromTag: (tag) => tag.replace(/^bun-v/i, "").replace(/^v/i, ""),
    assets: Object.fromEntries(
      Object.entries(BUN_PLATFORMS).map(([key, spec]) => [key, [spec.asset]])
    ),
    archiveSubdir: Object.fromEntries(
      Object.entries(BUN_PLATFORMS).map(([key, spec]) => [key, spec.archiveSubdir])
    ),
  },
  mailpit: {
    owner: "axllent",
    repo: "mailpit",
    versionFromTag: (tag) => tag.replace(/^v/i, ""),
    assets: {
      "win32/x64": ["mailpit-windows-amd64.zip"],
      "linux/x64": ["mailpit-linux-amd64.tar.gz"],
      "darwin/arm64": ["mailpit-darwin-arm64.tar.gz"],
      "darwin/x64": ["mailpit-darwin-amd64.tar.gz"],
    },
  },
  cloudflared: {
    owner: "cloudflare",
    repo: "cloudflared",
    versionFromTag: (tag) => tag.replace(/^v/i, ""),
    assets: {
      "win32/x64": ["cloudflared-windows-amd64.exe"],
      "linux/x64": ["cloudflared-linux-amd64"],
      "darwin/arm64": ["cloudflared-darwin-arm64.tgz", "cloudflared-darwin-arm64"],
      "darwin/x64": ["cloudflared-darwin-amd64.tgz", "cloudflared-darwin-amd64"],
    },
  },
  meilisearch: {
    owner: "meilisearch",
    repo: "meilisearch",
    versionFromTag: (tag) => tag.replace(/^v/i, ""),
    assets: {
      "win32/x64": ["meilisearch-windows-amd64.exe"],
      "linux/x64": ["meilisearch-linux-amd64"],
      "darwin/arm64": ["meilisearch-macos-apple-silicon", "meilisearch-macos-aarch64"],
      "darwin/x64": ["meilisearch-macos-amd64"],
    },
  },
};

function platformKey(platform: string, arch: string): PlatformKey {
  return `${platform}/${arch}`;
}

function requirePlatform<T>(
  table: Record<string, T>,
  platform: string,
  arch: string,
  label: string
): T {
  const spec = table[platformKey(platform, arch)];
  if (!spec) {
    throw new Error(`Unsupported platform for ${label}: ${platform}/${arch}`);
  }
  return spec;
}

function readCache<T>(entry: Cached<T> | null | undefined): T | null {
  if (!entry) return null;
  if (Date.now() - entry.at >= CACHE_MS) return null;
  return entry.data;
}

export function supportsAutoLatest(name: string): boolean {
  return isPhpManifestName(name) || Boolean(nodeMajorFromManifestName(name)) || AUTO_LATEST_TOOLS.has(name);
}

export function nodeMajorFromManifestName(name: string): string | null {
  const match = name.trim().match(/^node-(\d+)$/i);
  return match?.[1] ?? null;
}

async function fetchJson<T>(url: string, fetcher: FetchLike, init?: RequestInit): Promise<T> {
  const response = await fetcher(url, {
    ...init,
    headers: {
      Accept: "application/json",
      ...USER_AGENT,
      ...(init?.headers ?? {}),
    },
  });
  if (!response.ok) {
    throw new Error(`${url} HTTP ${response.status}`);
  }
  return (await response.json()) as T;
}

async function fetchNodeIndex(fetcher: FetchLike): Promise<NodeDistEntry[]> {
  const cached = readCache(nodeIndexCache);
  if (cached) return cached;
  const data = await fetchJson<NodeDistEntry[]>("https://nodejs.org/dist/index.json", fetcher);
  nodeIndexCache = { at: Date.now(), data };
  return data;
}

function composerBuild(version: string): ManifestLatestBuild {
  return {
    name: "composer",
    version,
    url: `https://getcomposer.org/download/${version}/composer.phar`,
    downloadType: "binary",
    source: "getcomposer.org",
  };
}

export async function resolveLatestNodeBuild(
  major: string,
  options?: { platform?: string; arch?: string; fetcher?: FetchLike }
): Promise<ManifestLatestBuild> {
  const platform = options?.platform ?? process.platform;
  const arch = options?.arch ?? process.arch;
  const fetcher = options?.fetcher ?? fetch;
  const dist = requirePlatform(NODE_PLATFORMS, platform, arch, "Node");

  const index = await fetchNodeIndex(fetcher);
  const prefix = `v${major}.`;
  let best: NodeDistEntry | null = null;
  for (const entry of index) {
    if (!entry.version.startsWith(prefix)) continue;
    if (entry.files && !entry.files.includes(dist.distFile)) continue;
    if (!best || compareVersionStrings(entry.version, best.version) > 0) {
      best = entry;
    }
  }
  if (!best) {
    throw new Error(`No Node.js ${major}.x build found for ${platform}/${arch}`);
  }

  const version = best.version.replace(/^v/, "");
  return {
    name: `node-${major}`,
    version,
    url: dist.url(version),
    downloadType: dist.downloadType,
    archiveSubdir: dist.archiveSubdir(version),
    source: "nodejs.org",
  };
}

export async function resolveLatestComposerBuild(
  options?: { fetcher?: FetchLike }
): Promise<ManifestLatestBuild> {
  const cached = readCache(composerVersionCache);
  if (cached) return composerBuild(cached);

  const fetcher = options?.fetcher ?? fetch;
  const data = await fetchJson<{ stable?: Array<{ version?: string }> }>(
    "https://getcomposer.org/versions",
    fetcher
  );
  const version = data.stable?.[0]?.version;
  if (!version) {
    throw new Error("Composer versions API returned no stable release");
  }
  composerVersionCache = { at: Date.now(), data: version };
  return composerBuild(version);
}

async function fetchGitHubLatest(
  owner: string,
  repo: string,
  fetcher: FetchLike
): Promise<GitHubRelease> {
  const key = `${owner}/${repo}`;
  const cached = readCache(githubLatestCache.get(key));
  if (cached) return cached;

  const release = await fetchJson<GitHubRelease>(
    `https://api.github.com/repos/${owner}/${repo}/releases/latest`,
    fetcher,
    { headers: { Accept: "application/vnd.github+json" } }
  );
  githubLatestCache.set(key, { at: Date.now(), data: release });
  return release;
}

function pickGitHubAsset(
  release: GitHubRelease,
  matchers: Array<string | RegExp>
): { name: string; url: string } {
  for (const matcher of matchers) {
    const asset = release.assets.find((a) =>
      typeof matcher === "string" ? a.name === matcher : matcher.test(a.name)
    );
    if (asset) {
      return { name: asset.name, url: asset.browser_download_url };
    }
  }
  throw new Error(
    `No matching asset in ${release.tag_name} (tried ${matchers.map(String).join(", ")})`
  );
}

function downloadTypeFromAsset(name: string): QuickAddManifest["downloadType"] {
  const lower = name.toLowerCase();
  if (lower.endsWith(".zip")) return "zip";
  if (lower.endsWith(".tar.gz") || lower.endsWith(".tgz")) return "tar.gz";
  if (lower.endsWith(".exe")) return "exe";
  return "binary";
}

function minioDisplayVersion(tagOrUrl: string): string {
  const match = tagOrUrl.match(/RELEASE\.(\d{4}-\d{2}-\d{2})/i);
  return match?.[1] ?? tagOrUrl.replace(/^RELEASE\./i, "");
}

async function resolveLatestMinioBuild(
  platform: string,
  arch: string,
  fetcher: FetchLike
): Promise<ManifestLatestBuild> {
  const spec = requirePlatform(MINIO_PLATFORMS, platform, arch, "minio");
  const latestUrl = `https://dl.min.io/server/minio/release/${spec.path}`;

  const head = await fetcher(latestUrl, {
    method: "HEAD",
    redirect: "manual",
    headers: USER_AGENT,
  }).catch(() => null);

  const redirected =
    head && head.status >= 301 && head.status <= 308 ? head.headers.get("location") : null;

  if (redirected) {
    return {
      name: "minio",
      version: minioDisplayVersion(redirected),
      url: redirected,
      downloadType: spec.downloadType,
      source: "github",
    };
  }

  return {
    name: "minio",
    version: new Date().toISOString().slice(0, 10),
    url: latestUrl,
    downloadType: spec.downloadType,
    source: "github",
  };
}

async function resolveGitHubTool(
  name: string,
  platform: string,
  arch: string,
  fetcher: FetchLike
): Promise<ManifestLatestBuild> {
  const tool = GITHUB_TOOLS[name];
  if (!tool) {
    throw new Error(`Unknown GitHub tool: ${name}`);
  }
  const matchers = requirePlatform(tool.assets, platform, arch, name);
  const release = await fetchGitHubLatest(tool.owner, tool.repo, fetcher);
  const asset = pickGitHubAsset(release, matchers);
  return {
    name,
    version: tool.versionFromTag(release.tag_name),
    url: asset.url,
    downloadType: downloadTypeFromAsset(asset.name),
    archiveSubdir: tool.archiveSubdir?.[platformKey(platform, arch)],
    source: "github",
  };
}

function phpSource(platform: string): ManifestLatestSource {
  return platform === "win32" ? "windows.php.net" : "static-php";
}

export async function resolveLatestManifestBuild(
  manifest: QuickAddManifest,
  options?: {
    platform?: NodeJS.Platform | string;
    arch?: string;
    fetcher?: FetchLike;
  }
): Promise<ManifestLatestBuild> {
  const platform = options?.platform ?? process.platform;
  const arch = options?.arch ?? process.arch;
  const fetcher = options?.fetcher ?? fetch;
  const name = manifest.name;

  if (isPhpManifestName(name)) {
    const php = await resolvePhpManifestToLatest(manifest, {
      platform: platform as NodeJS.Platform,
      arch,
      fetcher,
    });
    if (!php.resolvedFromLatest) {
      throw new Error(`Could not resolve latest PHP for ${name}`);
    }
    return {
      name,
      version: php.version,
      url: php.url,
      downloadType: php.downloadType,
      archiveSubdir: php.archiveSubdir,
      source: phpSource(platform),
    };
  }

  const nodeMajor = nodeMajorFromManifestName(name);
  if (nodeMajor) {
    return resolveLatestNodeBuild(nodeMajor, { platform, arch, fetcher });
  }

  if (name === "composer") {
    return resolveLatestComposerBuild({ fetcher });
  }

  if (name === "minio") {
    return resolveLatestMinioBuild(platform, arch, fetcher);
  }

  if (name in GITHUB_TOOLS) {
    return resolveGitHubTool(name, platform, arch, fetcher);
  }

  throw new Error(`Auto-latest not supported for ${name}`);
}

function overlayManifest(
  manifest: QuickAddManifest,
  latest: ManifestLatestBuild
): QuickAddManifest & { resolvedFromLatest: boolean } {
  return {
    ...manifest,
    version: latest.version,
    url: latest.url,
    downloadType: latest.downloadType ?? manifest.downloadType,
    archiveSubdir: latest.archiveSubdir ?? manifest.archiveSubdir,
    description: replaceLiteralVersion(manifest.description, manifest.version, latest.version),
    resolvedFromLatest: true,
  };
}

/**
 * Overlay a Quick Add manifest with the newest release when supported.
 * Falls back to the pinned manifest when lookup fails.
 */
export async function resolveManifestToLatest(
  manifest: QuickAddManifest,
  options?: {
    platform?: NodeJS.Platform | string;
    arch?: string;
    fetcher?: FetchLike;
    onFallback?: (err: unknown) => void;
  }
): Promise<QuickAddManifest & { resolvedFromLatest: boolean }> {
  if (!supportsAutoLatest(manifest.name)) {
    return { ...manifest, resolvedFromLatest: false };
  }

  if (isPhpManifestName(manifest.name)) {
    return resolvePhpManifestToLatest(manifest, {
      platform: (options?.platform as NodeJS.Platform) ?? process.platform,
      arch: options?.arch,
      fetcher: options?.fetcher,
      onFallback: options?.onFallback,
    });
  }

  try {
    const latest = await resolveLatestManifestBuild(manifest, options);
    return overlayManifest(manifest, latest);
  } catch (err) {
    options?.onFallback?.(err);
    return { ...manifest, resolvedFromLatest: false };
  }
}

export async function checkManifestUpdateStatus(
  root: string,
  manifest: QuickAddManifest,
  options?: {
    platform?: NodeJS.Platform | string;
    arch?: string;
    fetcher?: FetchLike;
  }
): Promise<ManifestUpdateStatus> {
  if (isPhpManifestName(manifest.name)) {
    const status = await checkPhpUpdateStatus(root, manifest, {
      platform: (options?.platform as NodeJS.Platform) ?? process.platform,
      arch: options?.arch,
      fetcher: options?.fetcher,
    });
    return {
      name: status.name,
      installed: status.installed,
      installedVersion: status.installedVersion,
      manifestVersion: status.manifestVersion,
      latestVersion: status.latestVersion,
      updateAvailable: status.updateAvailable,
      latestUrl: status.latestUrl,
    };
  }

  const [record, properlyInstalled] = await Promise.all([
    readRuntimeRecord(root, manifest.installPath),
    isManifestInstalled(root, manifest),
  ]);
  const installedVersion = record?.version;
  const installed = Boolean(installedVersion) || properlyInstalled;

  let latestVersion: string | undefined;
  let latestUrl: string | undefined;
  if (supportsAutoLatest(manifest.name)) {
    try {
      const latest = await resolveLatestManifestBuild(manifest, options);
      latestVersion = latest.version;
      latestUrl = latest.url;
    } catch {
      // offline / unsupported — leave latest unset
    }
  }

  const compareFrom = installedVersion ?? (installed ? "0.0.0" : manifest.version);
  return {
    name: manifest.name,
    installed,
    installedVersion,
    manifestVersion: manifest.version,
    latestVersion,
    updateAvailable: Boolean(
      installed && latestVersion && compareVersionStrings(latestVersion, compareFrom) > 0
    ),
    latestUrl,
  };
}

export async function writeManifestRuntimeRecord(
  root: string,
  installPath: string,
  version: string,
  source: string
): Promise<void> {
  await writeRuntimeRecord(root, installPath, {
    version,
    source,
    installedAt: new Date().toISOString(),
  });
}

export function runtimeSourceForManifest(
  name: string,
  resolvedFromLatest: boolean,
  platform = process.platform
): string {
  if (!resolvedFromLatest) return "manifest";
  if (isPhpManifestName(name)) return phpSource(platform);
  return "auto-latest";
}

/** Test helper */
export function clearManifestReleasesCache(): void {
  nodeIndexCache = null;
  composerVersionCache = null;
  githubLatestCache.clear();
}
