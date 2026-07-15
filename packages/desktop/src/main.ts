import { app, BrowserWindow, Menu, nativeImage } from "electron";
import path from "node:path";
import { existsSync, watch as watchFs } from "node:fs";
import { registerIpcHandlers, refreshRoot, getCurrentRoot, setOpenDashboardHandler, setRequestQuitHandler, broadcastUpdateAvailable } from "./ipc-handlers.js";
import { __dirname } from "./dir.js";
import { setupTray, hideTrayPopup, setTrayRunning, getIconPath, destroyTray } from "./tray.js";
import { ensureEnvironmentReady } from "./startup-environment.js";
import { syncLaunchAtLoginFromSettings } from "./startup-settings.js";
import { maybeAutoStartServices } from "./auto-start-services.js";
import { isInitialized } from "./paths.js";
import { checkForUpdates, shouldRunBackgroundCheck } from "./update-checker.js";
import { applyWindowMode, registerMainWindow } from "./window-layout.js";
import { createAppIcon } from "./icon.js";
import { spawn } from "node:child_process";
import { takePendingInstallerPath } from "./install-lifecycle.js";
import { initAppLogger } from "./app-logger.js";
import { getDefaultRoot, getInstallRootEarly } from "./paths.js";
import { isInstallInProgressSync, shouldExitForInstallInProgress } from "./install-lock.js";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

/** Delay first scheduled MySQL dump so it does not compete with tray/UI startup. */
const FIRST_BACKUP_DELAY_MS = 10 * 60 * 1000;
const BACKUP_INTERVAL_MS = 60 * 60 * 1000;

const isE2eSmoke = process.argv.includes("--e2e-smoke");
const wantsQuit = process.argv.includes("--quit");
const openViewArg = process.argv.find((a) => a.startsWith("--open="))?.slice("--open=".length);

function shouldBlockForInstallLock(): boolean {
  return !isE2eSmoke && !wantsQuit && isInstallInProgressSync(getInstallRootEarly());
}

initAppLogger();

let mainWindow: BrowserWindow | null = null;
let isQuitting = false;
let gracefulShutdownDone = false;

// Exit before Electron boots when the NSIS installer holds the lock file.
if (shouldBlockForInstallLock()) {
  app.exit(0);
}

// Single instance: second launch focuses the app; --quit asks the running instance to exit (for updates).
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
    if (shouldBlockForInstallLock()) {
      app.exit(0);
      return;
    }
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
    if (openViewArg && !isSetup) {
      mainWindow?.webContents.send("devtent:navigate", openViewArg);
    }
  });
  mainWindow.on("closed", () => {
    registerMainWindow(null);
    mainWindow = null;
  });

  registerMainWindow(mainWindow);
  return mainWindow;
}

/** In unpackaged runs, reload windows when UI assets change (dev watcher copies into dist/ui). */
function watchUiForDevReload(): void {
  if (app.isPackaged) return;
  const uiDir = path.join(__dirname, "ui");
  if (!existsSync(uiDir)) return;
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    watchFs(uiDir, { recursive: true }, () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        for (const win of BrowserWindow.getAllWindows()) {
          if (!win.isDestroyed()) win.webContents.reloadIgnoringCache();
        }
      }, 120);
    });
  } catch (err) {
    console.warn("UI reload watch unavailable:", err);
  }
}

app.whenReady().then(async () => {
  if (isE2eSmoke) return;

  if (process.platform === "win32") {
    app.setAppUserModelId("dev.devtent.app");
  }

  watchUiForDevReload();

  if (!wantsQuit && (await shouldExitForInstallInProgress(getDefaultRoot()))) {
    app.quit();
    return;
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
  } else {
    await syncLaunchAtLoginFromSettings();
    // Do not block tray/UI on service spawn — start in the background.
    void maybeAutoStartServices(getCurrentRoot()).catch((err) => {
      console.error("Auto-start services failed:", err);
    });
  }

  // Warm the core module after tray is up so the first IPC call is faster.
  void import("@devtent/core");

  const runScheduledBackup = async () => {
    const activeRoot = getCurrentRoot();
    if (!activeRoot || !(await isInitialized(activeRoot))) return;
    try {
      const { maybeDailyMysqlBackup } = await import("@devtent/core");
      await maybeDailyMysqlBackup(activeRoot);
    } catch {
      // Non-fatal
    }
  };

  setTimeout(() => {
    void runScheduledBackup();
    setInterval(() => {
      void runScheduledBackup();
    }, BACKUP_INTERVAL_MS);
  }, FIRST_BACKUP_DELAY_MS);

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

app.on("before-quit", (event) => {
  isQuitting = true;
  destroyTray();
  const installerPath = takePendingInstallerPath();
  if (installerPath && process.platform === "win32") {
    const launcher = path.join(tmpdir(), `devtent-run-installer-${process.pid}.cmd`);
    writeFileSync(
      launcher,
      `@echo off\r\ntimeout /t 2 /nobreak >nul\r\nstart "" "${installerPath.replace(/"/g, '""')}"\r\ndel "%~f0"\r\n`,
      "utf-8"
    );
    spawn("cmd.exe", ["/c", launcher], { detached: true, stdio: "ignore" }).unref();
    process.exit(0);
    return;
  }

  if (gracefulShutdownDone) return;

  event.preventDefault();
  void (async () => {
    try {
      const { loadSettings } = await import("./paths.js");
      const settings = await loadSettings();
      const root = getCurrentRoot();
      if (settings.stopServicesOnQuit !== false && root && (await isInitialized(root))) {
        const { stopAll } = await import("@devtent/core");
        await stopAll(root);
      }
    } catch {
      // Non-fatal — still exit
    } finally {
      gracefulShutdownDone = true;
      process.exit(0);
    }
  })();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

export { setTrayRunning, hideTrayPopup };
