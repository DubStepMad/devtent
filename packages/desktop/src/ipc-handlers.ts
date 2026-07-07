import { ipcMain, dialog, shell, BrowserWindow, app } from "electron";
import path from "node:path";
import {
  initDevTent,
  getState,
  hasExistingEnvironment,
  startAll,
  stopAll,
  startService,
  stopService,
  parseProcfile,
  generateVirtualHosts,
  elevateHostsSync,
  listProfiles,
  switchProfile,
  createProfile,
  updateProfile,
  deleteProfile,
  applyPhpVersionToActiveProfile,
  listManifestsWithStatus,
  loadManifest,
  installFromManifest,
  syncPhpProcfileFromProfile,
  listTemplates,
  createFromTemplate,
  writePlainPhpProject,
  enableSsl,
  isServiceRunning,
  getServiceStatuses,
  getProcfileToggles,
  setProcfileToggle,
  readProcfileRaw,
  writeProcfileRaw,
  enableCoreServicesIfReady,
  getProfileServices,
  previewProfileSwitch,
  restartService,
  detectLaragonInstalls,
  previewLaragonMigration,
  migrateFromLaragon,
  installRecommendedStack,
  backupMysql,
  listMysqlBackups,
  restoreMysql,
  maybeDailyMysqlBackup,
  listLogFiles,
  readLogTail,
  getEnvironmentHealth,
  exportEnvironment,
  importEnvironmentBundle,
  searchLogFiles,
  parseLogLineLocations,
  listNodeVersions,
  installNodeVersion,
  applyNodeVersionToActiveProfile,
  clearActiveNodeVersion,
  listParkedPaths,
  listLinkedSites,
  addParkedPath,
  removeParkedPath,
  linkSite,
  unlinkSite,
  setSitePhpVersion,
  runDoctor,
  buildLaravelEnvSnippet,
  laravelCaptureProviderSnippet,
  listVirtualHosts,
  listTooling,
  installTool,
  updateTool,
  removeTool,
  getPathEntries,
  readDumpEvents,
  clearDumpEvents,
  startShare,
  stopShare,
  listActiveShares,
  loadConfig,
  setDevTentTld,
  installLaravelQueryCapture,
  tldRequiresHostsFile,
} from "@devtent/core";
import type { ProcfileEntry, ProcfileToggle } from "@devtent/core";
import {
  loadSettings,
  saveSettings,
  isInitialized,
  getManifestsDir,
  getTemplatesDir,
  getDefaultRoot,
} from "./paths.js";
import { broadcastRefresh, setTrayRunning, hideTrayPopup } from "./tray.js";
import { applyWindowMode } from "./window-layout.js";
import { validateExternalUrl, resolveRootSubpath } from "./security.js";
import { openFolderInShell } from "./open-folder.js";
import { markSetupCompleted } from "./startup-environment.js";
import { setupCompletedForRoot } from "./setup-completion.js";
import { assertInstallNotInProgress } from "./install-lock.js";
import {
  checkForUpdates,
  downloadUpdate,
  getCurrentAppVersion,
  skipUpdateVersion,
  type UpdateCheckResult,
  type UpdateInfo,
} from "./update-checker.js";
import { queueInstallerLaunch } from "./install-lifecycle.js";
import {
  APP_LOG_VIRTUAL_NAME,
  getAppLogInfo,
  readAppLogTail,
} from "./app-logger.js";
import {
  backupAppBeforeUpdate,
  listAppBackups,
  rollbackAppBinary,
} from "./update-backup.js";
import { completeStandaloneHostsElevation } from "./hosts-elevation.js";
import { openFileInEditor } from "./open-in-editor.js";
import {
  applyLaunchAtLoginSetting,
  readStartupPreferences,
  setAutoStartServices,
  setLaunchAtLogin,
} from "./startup-settings.js";

let currentRoot = "";
let openDashboardHandler: (() => void) | null = null;
let requestQuitHandler: (() => void) | null = null;

export function setOpenDashboardHandler(handler: () => void): void {
  openDashboardHandler = handler;
}

export function setRequestQuitHandler(handler: () => void): void {
  requestQuitHandler = handler;
}

export function getCurrentRoot(): string {
  return currentRoot;
}

export async function refreshRoot(): Promise<string> {
  const settings = await loadSettings();
  currentRoot = settings.root;
  return currentRoot;
}

function getWindow(): BrowserWindow | null {
  return BrowserWindow.getAllWindows()[0] ?? null;
}

function sendProgress(message: string, percent?: number): void {
  const payload = percent !== undefined ? { message, percent } : { message };
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send("devtent:progress", payload);
    }
  }
}

function sendUpdateDownloadProgress(percent: number, message: string): void {
  const payload = { percent, message };
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send("devtent:update-download-progress", payload);
    }
  }
}

export function broadcastUpdateAvailable(result: UpdateCheckResult): void {
  if (result.status !== "available") return;
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send("devtent:update-available", result);
    }
  }
}

async function afterServiceChange(): Promise<void> {
  const running = getServiceStatuses();
  setTrayRunning(running.length > 0);
  broadcastRefresh();
}

export function registerIpcHandlers(): void {
  ipcMain.handle("devtent:getRoot", async () => {
    await refreshRoot();
    const settings = await loadSettings();
    const initialized = await isInitialized(currentRoot);
    const base = {
      root: currentRoot,
      initialized,
      setupCompleted: settings.setupCompleted ?? false,
      setupCompletedForRoot: setupCompletedForRoot(settings, currentRoot),
      hasExistingData: await hasExistingEnvironment(currentRoot),
      stopServicesOnQuit: settings.stopServicesOnQuit !== false,
      ...readStartupPreferences(settings),
      launchAtLoginAvailable: app.isPackaged,
    };
    if (!initialized) return base;
    const config = await loadConfig(currentRoot);
    return {
      ...base,
      tld: config.tld,
      zeroAdminDomains: !tldRequiresHostsFile(config.tld),
    };
  });

  ipcMain.handle("devtent:getDefaultRoot", () => getDefaultRoot());

  ipcMain.handle("devtent:setWindowMode", async (_e, mode: "setup" | "dashboard") => {
    applyWindowMode(mode);
  });

  ipcMain.handle("devtent:pickRoot", async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory", "createDirectory"],
      title: "Choose DevTent folder",
    });
    if (result.canceled || !result.filePaths[0]) return null;
    return result.filePaths[0];
  });

  ipcMain.handle("devtent:pickLaragonRoot", async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory"],
      title: "Choose your existing environment folder",
    });
    if (result.canceled || !result.filePaths[0]) return null;
    return result.filePaths[0];
  });

  ipcMain.handle("devtent:detectLaragon", async () => {
    await refreshRoot();
    return detectLaragonInstalls(currentRoot);
  });

  ipcMain.handle("devtent:previewLaragonMigration", async (_e, laragonRoot: string) => {
    return previewLaragonMigration(laragonRoot);
  });

  ipcMain.handle(
    "devtent:migrateFromLaragon",
    async (_e, laragonRoot: string, projects: string[] | undefined, via: string) => {
      if (via !== "settings-import") {
        throw new Error(
          "Environment import is only available from Settings → Import environment."
        );
      }
      await assertInstallNotInProgress(getDefaultRoot());
      await refreshRoot();
      if (!(await isInitialized(currentRoot))) {
        throw new Error("Finish setup first, then import from Settings.");
      }
      sendProgress("Starting environment import…", 46);
      const result = await migrateFromLaragon(
        laragonRoot,
        currentRoot,
        (msg: string, percent?: number) => sendProgress(msg, percent),
        {
          explicitImport: true,
          ...(projects !== undefined ? { projects } : {}),
        }
      );
      broadcastRefresh();
      return result;
    }
  );

  ipcMain.handle("devtent:setRoot", async (_e, root: string) => {
    await saveSettings({ root });
    currentRoot = root;
    return { root, initialized: await isInitialized(root) };
  });

  ipcMain.handle("devtent:setStopServicesOnQuit", async (_e, enabled: boolean) => {
    await saveSettings({ stopServicesOnQuit: enabled });
    return { stopServicesOnQuit: enabled };
  });

  ipcMain.handle("devtent:setLaunchAtLogin", async (_e, enabled: boolean) => {
    if (enabled && !app.isPackaged) {
      throw new Error("Start with Windows is available in the installed DevTent app.");
    }
    return setLaunchAtLogin(enabled);
  });

  ipcMain.handle("devtent:setAutoStartServices", async (_e, enabled: boolean) => {
    return setAutoStartServices(enabled);
  });

  ipcMain.handle("devtent:pickExportFolder", async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory", "createDirectory"],
      title: "Choose export destination",
    });
    if (result.canceled || !result.filePaths[0]) return null;
    return result.filePaths[0];
  });

  ipcMain.handle("devtent:pickImportBundle", async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory"],
      title: "Choose DevTent export folder",
    });
    if (result.canceled || !result.filePaths[0]) return null;
    return result.filePaths[0];
  });

  ipcMain.handle(
    "devtent:exportEnvironment",
    async (_e, destPath: string, options?: { includeBin?: boolean }) => {
      sendProgress("Exporting environment…", 10);
      const result = await exportEnvironment(currentRoot, destPath, options);
      sendProgress("Export complete", 100);
      return result;
    }
  );

  ipcMain.handle("devtent:importEnvironmentBundle", async (_e, bundlePath: string) => {
    sendProgress("Importing environment bundle…", 10);
    const result = await importEnvironmentBundle(currentRoot, bundlePath);
    broadcastRefresh();
    sendProgress("Import complete", 100);
    return result;
  });

  ipcMain.handle("devtent:getEnvironmentHealth", async () => {
    return getEnvironmentHealth(currentRoot);
  });

  ipcMain.handle("devtent:runDoctor", async (_e, options?: { repair?: boolean; startServices?: boolean }) => {
    const report = await runDoctor(currentRoot, options);
    if (options?.repair) {
      broadcastRefresh();
      await afterServiceChange();
    }
    return report;
  });

  ipcMain.handle("devtent:getLaravelEnv", async (_e, siteName: string) => {
    return buildLaravelEnvSnippet(currentRoot, siteName);
  });

  ipcMain.handle("devtent:listSitesConfig", async () => {
    return {
      parked: await listParkedPaths(currentRoot),
      linked: await listLinkedSites(currentRoot),
    };
  });

  ipcMain.handle("devtent:parkFolder", async (_e, folderPath: string) => {
    await addParkedPath(currentRoot, folderPath);
    const result = await generateVirtualHosts(currentRoot);
    broadcastRefresh();
    return result;
  });

  ipcMain.handle("devtent:unparkFolder", async (_e, folderPath: string) => {
    await removeParkedPath(currentRoot, folderPath);
    const result = await generateVirtualHosts(currentRoot);
    broadcastRefresh();
    return result;
  });

  ipcMain.handle("devtent:linkProject", async (_e, projectPath: string, name?: string) => {
    await linkSite(currentRoot, projectPath, name);
    const result = await generateVirtualHosts(currentRoot);
    broadcastRefresh();
    return result;
  });

  ipcMain.handle("devtent:unlinkProject", async (_e, name: string) => {
    await unlinkSite(currentRoot, name);
    const result = await generateVirtualHosts(currentRoot);
    broadcastRefresh();
    return result;
  });

  ipcMain.handle("devtent:openProjectPath", async (_e, projectPath: string) => {
    const vhosts = await listVirtualHosts(currentRoot);
    const allowed = vhosts.some((v) => v.projectPath && path.resolve(v.projectPath) === path.resolve(projectPath));
    if (!allowed) {
      throw new Error("Path is not a registered DevTent site");
    }
    await openFolderInShell(projectPath);
    return { ok: true };
  });

  ipcMain.handle("devtent:setSitePhpVersion", async (_e, siteName: string, phpVersion: string | null) => {
    await setSitePhpVersion(currentRoot, siteName, phpVersion);
    const result = await generateVirtualHosts(currentRoot);
    broadcastRefresh();
    return result;
  });

  ipcMain.handle("devtent:getLaravelCaptureSnippet", async () => {
    return laravelCaptureProviderSnippet();
  });

  ipcMain.handle("devtent:listDumps", async (_e, tail?: number) => {
    return readDumpEvents(currentRoot, { tail: tail ?? 200 });
  });

  ipcMain.handle("devtent:clearDumps", async () => {
    await clearDumpEvents(currentRoot);
    return { ok: true };
  });

  ipcMain.handle("devtent:startShare", async (_e, siteName: string) => {
    sendProgress(`Sharing ${siteName}…`);
    const session = await startShare(currentRoot, getManifestsDir(), siteName, sendProgress);
    return session;
  });

  ipcMain.handle("devtent:stopShare", async (_e, siteName: string) => {
    await stopShare(siteName);
    return { ok: true };
  });

  ipcMain.handle("devtent:listShares", async () => {
    await refreshRoot();
    const vhosts = await listVirtualHosts(currentRoot);
    return listActiveShares(
      currentRoot,
      vhosts.map((v) => ({ name: v.name, domain: v.domain }))
    );
  });

  ipcMain.handle("devtent:setTld", async (_e, tld: string) => {
    await refreshRoot();
    const normalized = await setDevTentTld(currentRoot, tld);
    await generateVirtualHosts(currentRoot);
    broadcastRefresh();
    return { tld: normalized, zeroAdminDomains: !tldRequiresHostsFile(normalized) };
  });

  ipcMain.handle("devtent:installLaravelQueryCapture", async (_e, siteName: string) => {
    await refreshRoot();
    const vhosts = await listVirtualHosts(currentRoot);
    const vhost = vhosts.find((v) => v.name === siteName);
    if (!vhost) throw new Error(`Site not found: ${siteName}`);
    const projectPath =
      vhost.projectPath ?? path.join(currentRoot, "www", vhost.name);
    return installLaravelQueryCapture(projectPath);
  });

  ipcMain.handle("devtent:init", async (_e, root?: string) => {
    const target = root ?? currentRoot;
    await assertInstallNotInProgress(getDefaultRoot());
    sendProgress("Creating environment…", 5);
    await initDevTent(target, (msg: string, percent?: number) => sendProgress(msg, percent));
    currentRoot = target;
    await markSetupCompleted(target);
    return { root: target, initialized: true };
  });

  ipcMain.handle("devtent:getState", async () => {
    await refreshRoot();
    if (!(await isInitialized(currentRoot))) {
      return {
        root: currentRoot,
        initialized: false,
        services: [],
        virtualHosts: [],
        activeProfile: "default",
      };
    }
    const state = await getState(currentRoot);
    return { ...state, initialized: true };
  });

  ipcMain.handle("devtent:syncCoreServices", async () => {
    const enabled = await enableCoreServicesIfReady(currentRoot);
    if (enabled) broadcastRefresh();
    return { enabled };
  });

  ipcMain.handle("devtent:startAll", async () => {
    const result = await startAll(currentRoot);
    await afterServiceChange();
    return result;
  });

  ipcMain.handle("devtent:stopAll", async () => {
    const result = await stopAll(currentRoot);
    await afterServiceChange();
    return result;
  });

  ipcMain.handle("devtent:startService", async (_e, name: string) => {
    const result = await startService(currentRoot, name);
    await afterServiceChange();
    return result;
  });

  ipcMain.handle("devtent:stopService", async (_e, name: string) => {
    const result = await stopService(name, currentRoot);
    await afterServiceChange();
    return result;
  });

  ipcMain.handle("devtent:restartService", async (_e, name: string) => {
    const result = await restartService(currentRoot, name);
    await afterServiceChange();
    return result;
  });

  ipcMain.handle("devtent:getProfileServices", async (_e, profileName?: string) => {
    return getProfileServices(currentRoot, profileName);
  });

  ipcMain.handle("devtent:previewProfileSwitch", async (_e, name: string) => {
    return previewProfileSwitch(currentRoot, name);
  });

  ipcMain.handle("devtent:getServices", async () => {
    const entries = await parseProcfile(currentRoot);
    const running = getServiceStatuses();
    return entries.map((entry: ProcfileEntry) => ({
      ...entry,
      running: isServiceRunning(entry.name),
      pid: running.find((r) => r.name === entry.name)?.pid,
    }));
  });

  ipcMain.handle("devtent:syncVhosts", async () => {
    return generateVirtualHosts(currentRoot, {
      deferHostsElevation: process.platform === "win32",
    });
  });

  ipcMain.handle("devtent:elevateHostsSync", async () => {
    const defer = process.platform === "win32";
    const hosts = await elevateHostsSync(currentRoot, { deferElevation: defer });
    return defer ? completeStandaloneHostsElevation(hosts, getWindow) : hosts;
  });

  ipcMain.handle("devtent:listProfiles", async () => {
    const { loadConfig } = await import("@devtent/core");
    const config = await loadConfig(currentRoot);
    const profiles = await listProfiles(currentRoot);
    return { active: config.activeProfile, profiles };
  });

  ipcMain.handle("devtent:switchProfile", async (_e, name: string) => {
    const result = await switchProfile(currentRoot, name);
    await afterServiceChange();
    broadcastRefresh();
    return result;
  });

  ipcMain.handle(
    "devtent:createProfile",
    async (
      _e,
      input: {
        name: string;
        description?: string;
        phpVersion?: string;
        webServer?: "nginx" | "apache";
        database?: "mysql" | "postgresql" | "none";
        services?: ("redis" | "mailpit")[];
      }
    ) => {
      const profile = await createProfile(currentRoot, input);
      broadcastRefresh();
      return profile;
    }
  );

  ipcMain.handle(
    "devtent:updateProfile",
    async (
      _e,
      name: string,
      patch: {
        description?: string;
        phpVersion?: string;
        webServer?: "nginx" | "apache";
        database?: "mysql" | "postgresql" | "none";
        services?: ("redis" | "mailpit")[];
      }
    ) => {
      const profile = await updateProfile(currentRoot, name, patch);
      broadcastRefresh();
      return profile;
    }
  );

  ipcMain.handle("devtent:deleteProfile", async (_e, name: string) => {
    await deleteProfile(currentRoot, name);
    broadcastRefresh();
    return { ok: true };
  });

  ipcMain.handle("devtent:listManifests", async () => {
    return listManifestsWithStatus(currentRoot, getManifestsDir());
  });

  ipcMain.handle("devtent:installManifest", async (_e, name: string) => {
    const manifest = await loadManifest(getManifestsDir(), name);
    sendProgress(`Installing ${manifest.name}…`);
    const installPath = await installFromManifest(currentRoot, manifest, sendProgress);

    if (name.startsWith("php-")) {
      await applyPhpVersionToActiveProfile(currentRoot, name);
      const toggles = await getProcfileToggles(currentRoot);
      const php = toggles.find((t: ProcfileToggle) => t.id === "php-fpm");
      if (php?.runtimeInstalled && !php.enabled) {
        await setProcfileToggle(currentRoot, "php-fpm", true);
      } else if (php?.enabled) {
        await syncPhpProcfileFromProfile(currentRoot);
      }
    }

    broadcastRefresh();
    return { name, installPath };
  });

  ipcMain.handle("devtent:installRecommendedStack", async () => {
    await assertInstallNotInProgress(getDefaultRoot());
    sendProgress("Installing recommended stack…", 5);
    const result = await installRecommendedStack(
      currentRoot,
      getManifestsDir(),
      (msg: string, percent?: number) => sendProgress(msg, percent)
    );
    broadcastRefresh();
    return result;
  });

  ipcMain.handle("devtent:backupMysql", async () => {
    sendProgress("Backing up MySQL…");
    return backupMysql(currentRoot, "manual", sendProgress);
  });

  ipcMain.handle("devtent:listMysqlBackups", async () => {
    return listMysqlBackups(currentRoot);
  });

  ipcMain.handle("devtent:restoreMysql", async (_e, backupId: string) => {
    sendProgress("Restoring MySQL backup…");
    const result = await restoreMysql(currentRoot, backupId, sendProgress);
    broadcastRefresh();
    return result;
  });

  ipcMain.handle("devtent:listTemplates", async () => {
    return listTemplates(getTemplatesDir());
  });

  ipcMain.handle("devtent:createProject", async (_e, template: string, projectName: string) => {
    sendProgress(`Creating ${projectName}…`);
    if (template === "php") {
      await writePlainPhpProject(currentRoot, projectName);
      await generateVirtualHosts(currentRoot, { skipHostsSync: true });
      return { path: path.join(currentRoot, "www", projectName) };
    }
    const projectPath = await createFromTemplate(
      currentRoot,
      template,
      projectName,
      getTemplatesDir(),
      sendProgress
    );
    await generateVirtualHosts(currentRoot, { skipHostsSync: true });
    return { path: projectPath };
  });

  ipcMain.handle("devtent:enableSsl", async (_e, domain: string) => {
    const result = await enableSsl(currentRoot, domain);
    broadcastRefresh();
    return result;
  });

  ipcMain.handle("devtent:openPath", async (_e, subpath: string) => {
    const full = resolveRootSubpath(currentRoot, subpath);
    return openFolderInShell(full);
  });

  ipcMain.handle("devtent:openExternal", async (_e, url: string) => {
    return shell.openExternal(validateExternalUrl(url));
  });

  ipcMain.handle("devtent:getProcfileToggles", async () => {
    return getProcfileToggles(currentRoot);
  });

  ipcMain.handle("devtent:setProcfileToggle", async (_e, id: string, enabled: boolean) => {
    const result = await setProcfileToggle(currentRoot, id, enabled);
    broadcastRefresh();
    return result;
  });

  ipcMain.handle("devtent:readProcfileRaw", async () => {
    return readProcfileRaw(currentRoot);
  });

  ipcMain.handle("devtent:writeProcfileRaw", async (_e, content: string) => {
    await writeProcfileRaw(currentRoot, content);
    broadcastRefresh();
  });

  ipcMain.handle("devtent:openTerminal", async () => {
    const { writePathScript } = await import("@devtent/core");
    const script = await writePathScript(currentRoot);
    if (process.platform === "win32") {
      const { spawn } = await import("node:child_process");
      spawn("cmd.exe", ["/k", script], { detached: true, shell: true });
    } else {
      const { spawn } = await import("node:child_process");
      spawn("x-terminal-emulator", ["-e", `bash -c 'source "${script}" && exec bash'`], {
        detached: true,
      });
    }
  });

  ipcMain.handle("devtent:listTooling", async () => {
    await refreshRoot();
    return listTooling(currentRoot, getManifestsDir());
  });

  ipcMain.handle("devtent:getPathEntries", async () => {
    await refreshRoot();
    return getPathEntries(currentRoot);
  });

  ipcMain.handle("devtent:installTool", async (_e, toolId: string) => {
    sendProgress(`Installing ${toolId}…`);
    await installTool(currentRoot, getManifestsDir(), toolId as import("@devtent/core").ToolingId, sendProgress);
    broadcastRefresh();
    return { ok: true };
  });

  ipcMain.handle("devtent:updateTool", async (_e, toolId: string) => {
    sendProgress(`Updating ${toolId}…`);
    await updateTool(currentRoot, getManifestsDir(), toolId as import("@devtent/core").ToolingId, sendProgress);
    broadcastRefresh();
    return { ok: true };
  });

  ipcMain.handle(
    "devtent:removeTool",
    async (_e, toolId: string, options?: { nodeVersion?: string }) => {
      await removeTool(
        currentRoot,
        getManifestsDir(),
        toolId as import("@devtent/core").ToolingId,
        options
      );
      broadcastRefresh();
      return { ok: true };
    }
  );

  ipcMain.handle("devtent:quit", async () => {
    if (requestQuitHandler) {
      requestQuitHandler();
    } else {
      const { app } = await import("electron");
      app.quit();
    }
  });

  ipcMain.handle("devtent:getAppVersion", () => getCurrentAppVersion());

  ipcMain.handle("devtent:listLogs", async () => {
    await refreshRoot();
    const serviceLogs = await listLogFiles(currentRoot);
    const appLog = await getAppLogInfo();
    const appEntry = appLog
      ? [{ ...appLog, label: "DevTent app.log" }]
      : [];
    return [...appEntry, ...serviceLogs];
  });

  ipcMain.handle("devtent:readLogTail", async (_e, fileName: string, lines?: number) => {
    if (fileName === APP_LOG_VIRTUAL_NAME) {
      return readAppLogTail(lines ?? 500);
    }
    await refreshRoot();
    return readLogTail(currentRoot, fileName, lines ?? 500);
  });

  ipcMain.handle(
    "devtent:searchLogs",
    async (_e, query: string, fileName?: string) => {
      await refreshRoot();
      return searchLogFiles(currentRoot, query, { fileName, maxResults: 200 });
    }
  );

  ipcMain.handle(
    "devtent:openLogInEditor",
    async (_e, filePath: string, line?: number) => {
      await refreshRoot();
      const vhosts = await listVirtualHosts(currentRoot);
      const extraRoots = vhosts
        .map((v) => v.projectPath ?? path.join(currentRoot, "www", v.name))
        .filter(Boolean);
      return openFileInEditor(currentRoot, filePath, line, extraRoots);
    }
  );

  ipcMain.handle("devtent:listNodeVersions", async () => {
    await refreshRoot();
    return listNodeVersions(currentRoot, getManifestsDir());
  });

  ipcMain.handle("devtent:installNodeVersion", async (_e, nodeVersion: string) => {
    sendProgress(`Installing ${nodeVersion}…`);
    const installPath = await installNodeVersion(
      currentRoot,
      getManifestsDir(),
      nodeVersion,
      sendProgress
    );
    const { loadConfig, loadProfile } = await import("@devtent/core");
    const config = await loadConfig(currentRoot);
    const profile = await loadProfile(currentRoot, config.activeProfile);
    if (!profile.nodeVersion && !profile.useExternalNode) {
      await applyNodeVersionToActiveProfile(currentRoot, nodeVersion);
    }
    broadcastRefresh();
    return { nodeVersion, installPath };
  });

  ipcMain.handle("devtent:setActiveNodeVersion", async (_e, nodeVersion: string | null) => {
    if (!nodeVersion) {
      const profile = await clearActiveNodeVersion(currentRoot);
      broadcastRefresh();
      return profile;
    }
    const profile = await applyNodeVersionToActiveProfile(currentRoot, nodeVersion);
    broadcastRefresh();
    return profile;
  });

  ipcMain.handle("devtent:checkForUpdates", async (_e, options?: { respectSkip?: boolean }) => {
    return checkForUpdates(options);
  });

  ipcMain.handle("devtent:skipUpdateVersion", async (_e, version: string) => {
    await skipUpdateVersion(version);
  });

  ipcMain.handle("devtent:downloadAndInstallUpdate", async (_e, update: UpdateInfo) => {
    await backupAppBeforeUpdate(update.latestVersion);
    const installerPath = await downloadUpdate(update, sendUpdateDownloadProgress);
    queueInstallerLaunch(installerPath);
    if (requestQuitHandler) {
      requestQuitHandler();
    } else {
      const { app } = await import("electron");
      app.quit();
    }
    return { installerPath };
  });

  ipcMain.handle("devtent:listAppBackups", async () => listAppBackups());

  ipcMain.handle("devtent:rollbackApp", async () => {
    await rollbackAppBinary();
    if (requestQuitHandler) {
      requestQuitHandler();
    } else {
      const { app } = await import("electron");
      app.quit();
    }
    return { ok: true };
  });

  ipcMain.handle("devtent:closeQuickPanel", async () => {
    hideTrayPopup();
  });

  ipcMain.handle("devtent:openDashboard", async (_e, view?: string) => {
    openDashboardHandler?.();
    if (view) {
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) {
          win.webContents.send("devtent:navigate", view);
        }
      }
    }
  });
}
