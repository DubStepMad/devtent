import { app, BrowserWindow, Menu, nativeImage } from "electron";
import path from "node:path";
import { existsSync } from "node:fs";
import { registerIpcHandlers, refreshRoot, getCurrentRoot, setOpenDashboardHandler, setRequestQuitHandler, broadcastUpdateAvailable } from "./ipc-handlers.js";
import { stopAll, maybeDailyMysqlBackup } from "@devtent/core";
import { __dirname } from "./dir.js";
import { setupTray, hideTrayPopup, setTrayRunning, getIconPath, destroyTray } from "./tray.js";
import { ensureEnvironmentReady } from "./startup-environment.js";
import { isInitialized } from "./paths.js";
import { checkForUpdates, shouldRunBackgroundCheck } from "./update-checker.js";
import { applyWindowMode, registerMainWindow } from "./window-layout.js";
import { createAppIcon } from "./icon.js";
import { spawn } from "node:child_process";
import { takePendingInstallerPath } from "./install-lifecycle.js";
import { initAppLogger } from "./app-logger.js";

const isE2eSmoke = process.argv.includes("--e2e-smoke");

initAppLogger();

let mainWindow: BrowserWindow | null = null;
let isQuitting = false;

// Single instance: second launch focuses the app; --quit asks the running instance to exit (for updates).
const wantsQuit = process.argv.includes("--quit");
if (isE2eSmoke) {
  app.whenReady().then(() => {
    console.log("E2E_SMOKE_OK");
    app.exit(0);
  });
} else {
const hasInstanceLock = app.requestSingleInstanceLock();
if (!hasInstanceLock) {
  // Running instance receives second-instance with --quit; exit this stub immediately.
  app.quit();
  process.exit(0);
} else {
  app.on("second-instance", (_event, argv) => {
    if (argv.some((a) => a === "--quit")) {
      requestQuit();
      return;
    }
    hideTrayPopup();
    createWindow();
    mainWindow?.show();
    mainWindow?.focus();
  });
  if (wantsQuit) {
    app.whenReady().then(() => requestQuit());
  }
}
}

function requestQuit(): void {
  if (isQuitting) return;
  isQuitting = true;
  destroyTray();
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.destroy();
  }
  app.quit();
}

function getWindowIcon(): Electron.NativeImage {
  const png = getIconPath("icon.png");
  if (existsSync(png)) {
    return nativeImage.createFromPath(png);
  }
  return createAppIcon(256);
}

export function createWindow(options?: { setup?: boolean }): BrowserWindow {
  if (mainWindow) {
    if (options?.setup) applyWindowMode("setup");
    else applyWindowMode("dashboard");
    mainWindow.focus();
    return mainWindow;
  }

  const isSetup = options?.setup ?? false;
  const winTitleBar =
    process.platform === "win32"
      ? {
          titleBarStyle: "hidden" as const,
          titleBarOverlay: {
            color: "#0b1220",
            symbolColor: "#e8edf5",
            height: 36,
          },
        }
      : {};

  mainWindow = new BrowserWindow({
    width: isSetup ? 500 : 1100,
    height: isSetup ? 860 : 720,
    minWidth: isSetup ? 500 : 900,
    minHeight: isSetup ? 600 : 560,
    maxWidth: isSetup ? 500 : undefined,
    maxHeight: isSetup ? 960 : undefined,
    title: isSetup ? "DevTent — Welcome" : "DevTent",
    icon: getWindowIcon(),
    show: false,
    autoHideMenuBar: true,
    ...winTitleBar,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, "ui", "index.html"));
  mainWindow.once("ready-to-show", () => {
    if (process.platform === "win32") {
      void mainWindow?.webContents.executeJavaScript(
        'document.documentElement.classList.add("electron-win")'
      );
    }
    applyWindowMode(isSetup ? "setup" : "dashboard");
    mainWindow?.show();
  });
  mainWindow.on("closed", () => {
    registerMainWindow(null);
    mainWindow = null;
  });

  registerMainWindow(mainWindow);
  return mainWindow;
}

app.whenReady().then(async () => {
  if (isE2eSmoke) return;

  if (process.platform === "win32") {
    app.setAppUserModelId("dev.devtent.app");
  }

  Menu.setApplicationMenu(null);

  registerIpcHandlers();
  setRequestQuitHandler(() => requestQuit());
  const root = await refreshRoot();

  setOpenDashboardHandler(() => {
    hideTrayPopup();
    createWindow();
  });

  await setupTray(
    () => {
      hideTrayPopup();
      createWindow();
    },
    () => requestQuit(),
    () => getCurrentRoot()
  ).catch((err) => {
    console.error("Tray failed to start:", err);
    createWindow();
  });

  // First run: compact setup wizard. Updates/reinstalls with existing data skip the wizard.
  const startup = await ensureEnvironmentReady(root);
  if (startup === "needs-wizard") {
    createWindow({ setup: true });
  }

  const runScheduledBackup = async () => {
    const activeRoot = getCurrentRoot();
    if (!activeRoot || !(await isInitialized(activeRoot))) return;
    try {
      await maybeDailyMysqlBackup(activeRoot);
    } catch {
      // Non-fatal
    }
  };

  void runScheduledBackup();
  setInterval(() => {
    void runScheduledBackup();
  }, 60 * 60 * 1000);

  void scheduleBackgroundUpdateCheck();
});

const STARTUP_UPDATE_DELAY_MS = 30_000;

async function scheduleBackgroundUpdateCheck(): Promise<void> {
  if (!(await shouldRunBackgroundCheck())) return;
  setTimeout(() => {
    void (async () => {
      try {
        const result = await checkForUpdates({ respectSkip: true });
        if (result.status === "available") {
          broadcastUpdateAvailable(result);
        }
      } catch {
        // Non-fatal
      }
    })();
  }, STARTUP_UPDATE_DELAY_MS);
}

app.on("window-all-closed", () => {
  // Stay in tray unless we are shutting down for install/replace.
  if (isQuitting) app.quit();
});

app.on("before-quit", () => {
  isQuitting = true;
  destroyTray();
  const installerPath = takePendingInstallerPath();
  if (installerPath && process.platform === "win32") {
    spawn(installerPath, [], { detached: true, stdio: "ignore" }).unref();
  }
  // Exit immediately so the NSIS installer can replace files (do not await service stop).
  process.exit(0);
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

export { setTrayRunning, hideTrayPopup };
