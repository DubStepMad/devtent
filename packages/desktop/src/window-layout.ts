import { BrowserWindow } from "electron";

let mainWindowRef: BrowserWindow | null = null;

export function registerMainWindow(win: BrowserWindow | null): void {
  mainWindowRef = win;
}

export function applyWindowMode(mode: "setup" | "dashboard"): void {
  const win = mainWindowRef;
  if (!win || win.isDestroyed()) return;

  if (mode === "setup") {
    win.setTitle("DevTent — Welcome");
    win.setMinimumSize(500, 600);
    win.setMaximumSize(500, 960);
    win.setResizable(true);
    win.setSize(500, 780, true);
    win.center();
    return;
  }

  win.setTitle("DevTent");
  win.setMinimumSize(900, 560);
  win.setMaximumSize(0, 0);
  win.setResizable(true);
  win.setSize(1100, 720, true);
  win.center();
}
