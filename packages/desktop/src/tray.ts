import {
  app,
  BrowserWindow,
  Tray,
  Menu,
  screen,
} from "electron";
import path from "node:path";
import { existsSync } from "node:fs";
import { createTrayIcon, createTrayAnimationFrames } from "./icon.js";
import { __dirname } from "./dir.js";
import { openFolderInShell } from "./open-folder.js";
import { loadSettings, saveSettings } from "./paths.js";

const POPUP_WIDTH = 380;
const POPUP_HEIGHT = 620;

export type RefreshScope = "all" | "services" | "sites" | "profiles" | "tooling" | "settings";

let tray: Tray | null = null;
let trayPopup: BrowserWindow | null = null;
let popupVisible = false;
let animationTimer: ReturnType<typeof setInterval> | null = null;
let animationFrame = 0;
let idleIcon: Electron.NativeImage | null = null;
let animationFrames: Electron.NativeImage[] | null = null;

function getIdleIcon(): Electron.NativeImage {
  if (!idleIcon) idleIcon = createTrayIcon(0);
  return idleIcon;
}

function getAnimationFrames(): Electron.NativeImage[] {
  if (!animationFrames) animationFrames = createTrayAnimationFrames();
  return animationFrames;
}

export function getTray(): Tray | null {
  return tray;
}

export function getIconPath(name: string): string {
  const devPath = path.join(__dirname, "..", "assets", name);
  if (existsSync(devPath)) return devPath;
  const packaged = path.join(process.resourcesPath, "assets", name);
  if (existsSync(packaged)) return packaged;
  return devPath;
}

export function broadcastRefresh(scope: RefreshScope = "all"): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send("devtent:refresh", scope);
    }
  }
}

function stopTrayAnimation(): void {
  if (animationTimer) {
    clearInterval(animationTimer);
    animationTimer = null;
  }
  animationFrame = 0;
  tray?.setImage(getIdleIcon());
}

function startTrayAnimation(): void {
  stopTrayAnimation();
  const frames = getAnimationFrames();
  animationTimer = setInterval(() => {
    animationFrame = (animationFrame + 1) % frames.length;
    tray?.setImage(frames[animationFrame] ?? getIdleIcon());
  }, 450);
}

function clampPopupPosition(
  x: number,
  y: number,
  width: number,
  height: number
): { x: number; y: number } {
  const display = screen.getDisplayNearestPoint({ x, y });
  const work = display.workArea;
  return {
    x: Math.max(work.x + 8, Math.min(x, work.x + work.width - width - 8)),
    y: Math.max(work.y + 8, Math.min(y, work.y + work.height - height - 8)),
  };
}

function positionPopup(popup: BrowserWindow, saved?: { x: number; y: number } | null): void {
  const { width, height } = popup.getBounds();

  if (saved) {
    const clamped = clampPopupPosition(saved.x, saved.y, width, height);
    popup.setPosition(clamped.x, clamped.y, false);
    return;
  }

  if (!tray) return;

  const trayBounds = tray.getBounds();
  const display = screen.getDisplayNearestPoint({
    x: trayBounds.x,
    y: trayBounds.y,
  });
  const work = display.workArea;

  let x = Math.round(trayBounds.x + trayBounds.width / 2 - width / 2);
  let y: number;

  if (process.platform === "win32") {
    y = trayBounds.y - height - 8;
    if (y < work.y) {
      y = trayBounds.y + trayBounds.height + 8;
    }
  } else {
    y = trayBounds.y + trayBounds.height + 4;
  }

  const clamped = clampPopupPosition(x, y, width, height);
  popup.setPosition(clamped.x, clamped.y, false);
}

export function createTrayPopup(): BrowserWindow {
  if (trayPopup && !trayPopup.isDestroyed()) {
    return trayPopup;
  }

  trayPopup = new BrowserWindow({
    width: POPUP_WIDTH,
    height: POPUP_HEIGHT,
    show: false,
    frame: false,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    transparent: true,
    hasShadow: true,
    focusable: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  trayPopup.loadFile(path.join(__dirname, "ui", "tray-popup.html"));
  trayPopup.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false });

  let moveSaveTimer: ReturnType<typeof setTimeout> | null = null;
  trayPopup.on("moved", () => {
    if (!trayPopup || trayPopup.isDestroyed()) return;
    if (moveSaveTimer) clearTimeout(moveSaveTimer);
    moveSaveTimer = setTimeout(() => {
      if (!trayPopup || trayPopup.isDestroyed()) return;
      const [x, y] = trayPopup.getPosition();
      void saveSettings({ trayPopupPosition: { x, y } });
    }, 200);
  });

  trayPopup.on("closed", () => {
    trayPopup = null;
    popupVisible = false;
  });

  return trayPopup;
}

export async function toggleTrayPopup(): Promise<void> {
  const popup = createTrayPopup();
  if (popupVisible && popup.isVisible()) {
    hideTrayPopup();
    return;
  }
  const settings = await loadSettings();
  positionPopup(popup, settings.trayPopupPosition ?? null);
  popup.show();
  popup.focus();
  popupVisible = true;
  popup.webContents.send("devtent:refresh");
}

export function hideTrayPopup(): void {
  if (trayPopup && !trayPopup.isDestroyed()) {
    trayPopup.destroy();
  }
  trayPopup = null;
  popupVisible = false;
}

function buildContextMenu(
  onOpenDashboard: () => void,
  onQuit: () => void,
  getRoot: () => string
): Menu {
  return Menu.buildFromTemplate([
    { label: "DevTent", enabled: false },
    { type: "separator" },
    { label: "Open Quick Panel", click: () => void toggleTrayPopup() },
    { label: "Open Dashboard", click: onOpenDashboard },
    { type: "separator" },
    {
      label: "www",
      click: () => void openFolderInShell(path.join(getRoot(), "www")),
    },
    { type: "separator" },
    { label: "Quit DevTent", click: onQuit },
  ]);
}

export async function setupTray(
  onOpenDashboard: () => void,
  onQuit: () => void,
  getRoot: () => string
): Promise<Tray> {
  const icon = getIdleIcon();
  tray = new Tray(icon);
  tray.setToolTip("DevTent — click for quick panel");

  const contextMenu = buildContextMenu(onOpenDashboard, onQuit, getRoot);
  tray.setContextMenu(contextMenu);
  tray.on("click", () => void toggleTrayPopup());

  return tray;
}

let trayUpdateVersion: string | null = null;
let servicesRunning = false;

function refreshTrayTooltip(): void {
  if (!tray) return;
  const parts = ["DevTent"];
  if (trayUpdateVersion) {
    parts.push(`update v${trayUpdateVersion} available`);
  } else if (servicesRunning) {
    parts.push("services running (click for panel)");
  } else {
    parts.push("idle (click for panel)");
  }
  tray.setToolTip(parts.join(" — "));
}

export function setTrayUpdateAvailable(version: string | null): void {
  trayUpdateVersion = version ? String(version).replace(/^v/i, "") : null;
  refreshTrayTooltip();
}

export function setTrayRunning(running: boolean): void {
  if (!tray) return;
  servicesRunning = running;
  refreshTrayTooltip();
  if (running) {
    startTrayAnimation();
  } else {
    stopTrayAnimation();
  }
}

export function destroyTray(): void {
  stopTrayAnimation();
  tray?.destroy();
  tray = null;
}
