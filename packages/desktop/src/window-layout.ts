import { BrowserWindow, screen } from "electron";
import type { Rectangle } from "electron";
import {
  clampDashboardSize,
  DEFAULT_DASHBOARD_SIZE,
  DEFAULT_SETUP_SIZE,
  shouldApplyWindowGeometry,
  type WindowBounds,
  type WindowMode,
} from "./window-layout-mode.js";

export {
  clampDashboardSize,
  DEFAULT_DASHBOARD_SIZE,
  DEFAULT_SETUP_SIZE,
  shouldApplyWindowGeometry,
};
export type { WindowBounds, WindowMode };

let mainWindowRef: BrowserWindow | null = null;
let currentMode: WindowMode | null = null;
let savedDashboardBounds: WindowBounds | null = null;

export function registerMainWindow(win: BrowserWindow | null): void {
  mainWindowRef = win;
  if (!win) {
    currentMode = null;
  }
}

export function getCurrentWindowMode(): WindowMode | null {
  return currentMode;
}

export function setSavedDashboardBounds(bounds: WindowBounds | null): void {
  savedDashboardBounds = bounds ? { ...bounds } : null;
}

export function getSavedDashboardBounds(): WindowBounds | null {
  return savedDashboardBounds ? { ...savedDashboardBounds } : null;
}

/** Keep saved bounds on-screen and above minimum dashboard size. */
export function normalizeDashboardBounds(bounds: WindowBounds): WindowBounds {
  const { width, height } = clampDashboardSize(bounds);
  const display = screen.getDisplayMatching({
    x: Math.round(bounds.x),
    y: Math.round(bounds.y),
    width,
    height,
  });
  const work = display.workArea;
  const x = Math.min(Math.max(Math.round(bounds.x), work.x), work.x + work.width - 100);
  const y = Math.min(Math.max(Math.round(bounds.y), work.y), work.y + work.height - 100);
  return {
    x,
    y,
    width: Math.min(width, work.width),
    height: Math.min(height, work.height),
  };
}

export function applyWindowMode(
  mode: WindowMode,
  options?: { forceLayout?: boolean }
): void {
  const win = mainWindowRef;
  if (!win || win.isDestroyed()) return;

  const previousMode = currentMode;
  const applyGeometry = shouldApplyWindowGeometry(previousMode, mode, options?.forceLayout);
  currentMode = mode;

  if (mode === "setup") {
    win.setTitle("DevTent — Welcome");
    win.setMinimumSize(500, 600);
    win.setMaximumSize(500, 960);
    win.setResizable(true);
    if (applyGeometry) {
      win.setSize(DEFAULT_SETUP_SIZE.width, DEFAULT_SETUP_SIZE.height, true);
      win.center();
    }
    return;
  }

  win.setTitle("DevTent");
  win.setMinimumSize(900, 560);
  win.setMaximumSize(0, 0);
  win.setResizable(true);
  if (applyGeometry) {
    if (savedDashboardBounds) {
      win.setBounds(normalizeDashboardBounds(savedDashboardBounds), true);
    } else {
      win.setSize(DEFAULT_DASHBOARD_SIZE.width, DEFAULT_DASHBOARD_SIZE.height, true);
      win.center();
    }
  }
}

export function captureDashboardBounds(win: BrowserWindow): WindowBounds | null {
  if (win.isDestroyed() || currentMode !== "dashboard") return null;
  if (win.isMinimized() || win.isMaximized() || win.isFullScreen()) return null;
  const b = win.getBounds();
  const next: WindowBounds = { x: b.x, y: b.y, width: b.width, height: b.height };
  savedDashboardBounds = next;
  return { ...next };
}

export function attachWindowBoundsPersistence(
  win: BrowserWindow,
  save: (bounds: WindowBounds) => void
): void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      const bounds = captureDashboardBounds(win);
      if (bounds) save(bounds);
    }, 400);
  };
  win.on("resize", schedule);
  win.on("moved", schedule);
}

/** Initial BrowserWindow options for dashboard creation. */
export function resolveDashboardCreateBounds(): Partial<Rectangle> & {
  width: number;
  height: number;
} {
  if (!savedDashboardBounds) {
    return { ...DEFAULT_DASHBOARD_SIZE };
  }
  const b = normalizeDashboardBounds(savedDashboardBounds);
  return { x: b.x, y: b.y, width: b.width, height: b.height };
}
