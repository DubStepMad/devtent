export const GITHUB_OWNER = "DubStepMad";
export const GITHUB_REPO = "devtent";
export const INSTALLER_NAME_PREFIX = "DevTent Setup";

export type GitHubReleaseAsset = {
  name: string;
  browser_download_url: string;
};

export type GitHubRelease = {
  tag_name: string;
  name: string;
  body: string | null;
  html_url: string;
  published_at: string;
  assets: GitHubReleaseAsset[];
};

export function normalizeVersion(version: string): string {
  return version.trim().replace(/^v/i, "");
}

function parseVersionParts(version: string): number[] {
  const core = normalizeVersion(version).split("-")[0] ?? "";
  const parts = core.split(".").map((p) => Number.parseInt(p, 10));
  while (parts.length < 3) parts.push(0);
  return parts.slice(0, 3).map((n) => (Number.isFinite(n) ? n : 0));
}

export function compareVersions(a: string, b: string): number {
  const left = parseVersionParts(a);
  const right = parseVersionParts(b);
  for (let i = 0; i < 3; i++) {
    if (left[i]! > right[i]!) return 1;
    if (left[i]! < right[i]!) return -1;
  }
  return 0;
}

export function validateReleaseDownloadUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("Invalid download URL");
  }
  if (parsed.protocol !== "https:" || parsed.hostname !== "github.com") {
    throw new Error("Download must come from GitHub");
  }
  const expectedPrefix = `/${GITHUB_OWNER}/${GITHUB_REPO}/releases/download/`;
  if (!parsed.pathname.startsWith(expectedPrefix)) {
    throw new Error("Download URL is not from this repository");
  }
  return parsed.toString();
}

export function findInstallerAsset(release: GitHubRelease): { name: string; url: string } | null {
  const asset = release.assets.find(
    (a) =>
      a.name.toLowerCase().endsWith(".exe") && a.name.startsWith(INSTALLER_NAME_PREFIX)
  );
  if (!asset) return null;
  return { name: asset.name, url: validateReleaseDownloadUrl(asset.browser_download_url) };
}

export function parseUpdateCheckFromRelease(
  release: GitHubRelease,
  currentVersion: string,
  options?: { respectSkip?: boolean; skipVersion?: string }
): {
  status: "up-to-date" | "available" | "error";
  latestVersion: string;
  releaseUrl: string;
  update?: {
    currentVersion: string;
    latestVersion: string;
    releaseName: string;
    releaseNotes: string;
    releaseUrl: string;
    downloadUrl: string;
    publishedAt: string;
  };
  message?: string;
} {
  const latestVersion = normalizeVersion(release.tag_name);
  const installer = findInstallerAsset(release);

  if (!installer) {
    return {
      status: "error",
      latestVersion,
      releaseUrl: release.html_url,
      message: `Release v${latestVersion} has no Windows installer attached.`,
    };
  }

  if (compareVersions(latestVersion, currentVersion) <= 0) {
    return { status: "up-to-date", latestVersion, releaseUrl: release.html_url };
  }

  if (options?.respectSkip && options.skipVersion === latestVersion) {
    return { status: "up-to-date", latestVersion, releaseUrl: release.html_url };
  }

  return {
    status: "available",
    latestVersion,
    releaseUrl: release.html_url,
    update: {
      currentVersion,
      latestVersion,
      releaseName: release.name || `DevTent ${latestVersion}`,
      releaseNotes: release.body?.trim() || "No release notes provided.",
      releaseUrl: release.html_url,
      downloadUrl: installer.url,
      publishedAt: release.published_at,
    },
  };
}
