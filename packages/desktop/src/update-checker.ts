import { app } from "electron";
import path from "node:path";
import { mkdir, unlink } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { loadSettings, saveSettings } from "./paths.js";
import { queueInstallerLaunch } from "./install-lifecycle.js";
import {
  findInstallerAsset,
  normalizeVersion,
  parseUpdateCheckFromRelease,
  validateReleaseDownloadUrl,
  type GitHubRelease,
} from "./update-version.js";

export type { UpdateInfo, UpdateCheckResult } from "./update-types.js";
export { compareVersions } from "./update-version.js";

const GITHUB_API = `https://api.github.com/repos/DubStepMad/devtent/releases/latest`;
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

async function fetchLatestRelease(): Promise<GitHubRelease> {
  const response = await fetch(GITHUB_API, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "DevTent-Updater",
    },
  });
  if (!response.ok) {
    throw new Error(`GitHub API error (${response.status})`);
  }
  return (await response.json()) as GitHubRelease;
}

function updatesDir(): string {
  return path.join(app.getPath("temp"), "DevTent", "updates");
}

export function getCurrentAppVersion(): string {
  return app.getVersion();
}

export async function checkForUpdates(options?: {
  respectSkip?: boolean;
}): Promise<import("./update-types.js").UpdateCheckResult> {
  const currentVersion = getCurrentAppVersion();

  if (!app.isPackaged) {
    return {
      status: "dev",
      currentVersion,
      message: "Updates are available in the installed Windows app.",
    };
  }

  try {
    const release = await fetchLatestRelease();
    const settings = await loadSettings();
    await saveSettings({ lastUpdateCheckAt: Date.now() });

    const parsed = parseUpdateCheckFromRelease(release, currentVersion, {
      respectSkip: options?.respectSkip,
      skipVersion: settings.skipUpdateVersion,
    });

    if (parsed.status === "error") {
      return {
        status: "error",
        currentVersion,
        message: parsed.message ?? "Update check failed",
      };
    }

    if (parsed.status === "up-to-date") {
      return {
        status: "up-to-date",
        currentVersion,
        latestVersion: parsed.latestVersion,
        releaseUrl: parsed.releaseUrl,
      };
    }

    return { status: "available", update: parsed.update! };
  } catch (err) {
    return {
      status: "error",
      currentVersion,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function shouldRunBackgroundCheck(): Promise<boolean> {
  if (!app.isPackaged) return false;
  const settings = await loadSettings();
  if (!settings.lastUpdateCheckAt) return true;
  return Date.now() - settings.lastUpdateCheckAt >= CHECK_INTERVAL_MS;
}

export async function skipUpdateVersion(version: string): Promise<void> {
  await saveSettings({ skipUpdateVersion: normalizeVersion(version) });
}

export async function downloadUpdate(
  update: import("./update-types.js").UpdateInfo,
  onProgress: (percent: number, message: string) => void
): Promise<string> {
  const url = validateReleaseDownloadUrl(update.downloadUrl);
  const dir = updatesDir();
  await mkdir(dir, { recursive: true });

  const fileName = `DevTent Setup ${update.latestVersion}.exe`;
  const dest = path.join(dir, fileName);

  try {
    await unlink(dest);
  } catch {
  }

  const response = await fetch(url, {
    headers: { "User-Agent": "DevTent-Updater" },
  });
  if (!response.ok) {
    throw new Error(`Download failed (${response.status})`);
  }
  if (!response.body) {
    throw new Error("Empty download response");
  }

  const total = Number(response.headers.get("content-length") ?? 0);
  let downloaded = 0;
  const writer = createWriteStream(dest);
  const reader = response.body.getReader();

  onProgress(0, "Starting download…");

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      writer.write(value);
      downloaded += value.length;
      if (total > 0) {
        const percent = Math.min(99, Math.round((downloaded / total) * 100));
        onProgress(percent, `Downloading… ${percent}%`);
      } else {
        onProgress(50, `Downloading… ${formatBytes(downloaded)}`);
      }
    }
  } finally {
    writer.end();
  }

  await new Promise<void>((resolve, reject) => {
    writer.on("finish", resolve);
    writer.on("error", reject);
  });

  onProgress(100, "Download complete");
  return dest;
}

export function launchInstaller(installerPath: string): void {
  if (process.platform !== "win32") {
    throw new Error("In-app updates are only supported on Windows");
  }
  queueInstallerLaunch(installerPath);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export { findInstallerAsset, parseUpdateCheckFromRelease };
