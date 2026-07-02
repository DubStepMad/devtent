import { app } from "electron";
import path from "node:path";
import { existsSync } from "node:fs";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { pathExists, getDefaultInstallRoot, normalizeInstallRoot } from "@devtent/core";
import { __dirname } from "./dir.js";

export interface DesktopSettings {
  root: string;
  setupCompleted?: boolean;
  /** Install folder where setupCompleted was recorded (portable updates). */
  setupCompletedRoot?: string;
  skipUpdateVersion?: string;
  lastUpdateCheckAt?: number;
  trayPopupPosition?: { x: number; y: number };
  /** Stop services and backup MySQL before quitting. Default true. */
  stopServicesOnQuit?: boolean;
}

/** Portable default: folder containing DevTent.exe when packaged; {drive}:\\devtent in dev. */
export function getDefaultRoot(): string {
  return getInstallRootEarly();
}

/** Safe before app.whenReady — used to read the install lock at process start. */
export function getInstallRootEarly(): string {
  if (app.isPackaged) {
    return normalizeInstallRoot(path.dirname(app.getPath("exe")));
  }
  return getDefaultInstallRoot();
}

function settingsPath(): string {
  return path.join(app.getPath("userData"), "settings.json");
}

export async function loadSettings(): Promise<DesktopSettings> {
  const exeRoot = getDefaultRoot();
  const defaults: DesktopSettings = { root: exeRoot };
  const file = settingsPath();
  if (await pathExists(file)) {
    const raw = await readFile(file, "utf-8");
    const parsed = JSON.parse(raw) as Partial<DesktopSettings>;
    return {
      ...defaults,
      ...parsed,
      // Portable install: always use the folder containing DevTent.exe.
      root: app.isPackaged ? exeRoot : normalizeInstallRoot(parsed.root ?? defaults.root),
    };
  }
  return defaults;
}

export async function saveSettings(partial: Partial<DesktopSettings>): Promise<void> {
  const current = await loadSettings();
  const next: DesktopSettings = { ...current, ...partial, root: normalizeInstallRoot(partial.root ?? current.root) };
  await mkdir(app.getPath("userData"), { recursive: true });
  await writeFile(settingsPath(), JSON.stringify(next, null, 2), "utf-8");
}

export function getManifestsDir(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "manifests");
  }
  const bundled = path.join(__dirname, "manifests");
  if (existsSync(bundled)) return bundled;
  return path.join(getAppRoot(), "manifests");
}

export function getTemplatesDir(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "templates");
  }
  const bundled = path.join(__dirname, "templates");
  if (existsSync(bundled)) return bundled;
  return path.join(getAppRoot(), "templates");
}

function getAppRoot(): string {
  return path.resolve(__dirname, "..", "..", "..");
}

export async function isInitialized(root: string): Promise<boolean> {
  return pathExists(path.join(root, "devtent.toml"));
}
