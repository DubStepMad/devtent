import { contextBridge, ipcRenderer, IpcRendererEvent } from "electron";

const api = {
  getRoot: () => ipcRenderer.invoke("devtent:getRoot"),
  getDefaultRoot: () => ipcRenderer.invoke("devtent:getDefaultRoot"),
  pickRoot: () => ipcRenderer.invoke("devtent:pickRoot"),
  pickLaragonRoot: () => ipcRenderer.invoke("devtent:pickLaragonRoot"),
  detectLaragon: () => ipcRenderer.invoke("devtent:detectLaragon"),
  previewLaragonMigration: (laragonRoot: string) =>
    ipcRenderer.invoke("devtent:previewLaragonMigration", laragonRoot),
  migrateFromLaragon: (laragonRoot: string, projects?: string[]) =>
    ipcRenderer.invoke("devtent:migrateFromLaragon", laragonRoot, projects, "settings-import"),
  setRoot: (root: string) => ipcRenderer.invoke("devtent:setRoot", root),
  init: (root?: string) => ipcRenderer.invoke("devtent:init", root),
  getState: () => ipcRenderer.invoke("devtent:getState"),
  startAll: () => ipcRenderer.invoke("devtent:startAll"),
  stopAll: () => ipcRenderer.invoke("devtent:stopAll"),
  startService: (name: string) => ipcRenderer.invoke("devtent:startService", name),
  stopService: (name: string) => ipcRenderer.invoke("devtent:stopService", name),
  restartService: (name: string) => ipcRenderer.invoke("devtent:restartService", name),
  getServices: () => ipcRenderer.invoke("devtent:getServices"),
  getProfileServices: (profileName?: string) =>
    ipcRenderer.invoke("devtent:getProfileServices", profileName),
  previewProfileSwitch: (name: string) => ipcRenderer.invoke("devtent:previewProfileSwitch", name),
  syncVhosts: () => ipcRenderer.invoke("devtent:syncVhosts"),
  elevateHostsSync: () => ipcRenderer.invoke("devtent:elevateHostsSync"),
  listProfiles: () => ipcRenderer.invoke("devtent:listProfiles"),
  switchProfile: (name: string) => ipcRenderer.invoke("devtent:switchProfile", name),
  createProfile: (input: {
    name: string;
    description?: string;
    phpVersion?: string;
    webServer?: "nginx" | "apache";
    database?: "mysql" | "postgresql" | "none";
    services?: ("redis" | "mailpit")[];
  }) => ipcRenderer.invoke("devtent:createProfile", input),
  updateProfile: (
    name: string,
    patch: {
      description?: string;
      phpVersion?: string;
      webServer?: "nginx" | "apache";
      database?: "mysql" | "postgresql" | "none";
      services?: ("redis" | "mailpit")[];
    }
  ) => ipcRenderer.invoke("devtent:updateProfile", name, patch),
  deleteProfile: (name: string) => ipcRenderer.invoke("devtent:deleteProfile", name),
  listManifests: () => ipcRenderer.invoke("devtent:listManifests"),
  installManifest: (name: string) => ipcRenderer.invoke("devtent:installManifest", name),
  installRecommendedStack: () => ipcRenderer.invoke("devtent:installRecommendedStack"),
  backupMysql: () => ipcRenderer.invoke("devtent:backupMysql"),
  listMysqlBackups: () => ipcRenderer.invoke("devtent:listMysqlBackups"),
  restoreMysql: (backupId: string) => ipcRenderer.invoke("devtent:restoreMysql", backupId),
  getEnvironmentHealth: () => ipcRenderer.invoke("devtent:getEnvironmentHealth"),
  runDoctor: (options?: { repair?: boolean; startServices?: boolean }) =>
    ipcRenderer.invoke("devtent:runDoctor", options),
  getLaravelEnv: (siteName: string) => ipcRenderer.invoke("devtent:getLaravelEnv", siteName),
  listSitesConfig: () => ipcRenderer.invoke("devtent:listSitesConfig"),
  parkFolder: (folderPath: string) => ipcRenderer.invoke("devtent:parkFolder", folderPath),
  unparkFolder: (folderPath: string) => ipcRenderer.invoke("devtent:unparkFolder", folderPath),
  linkProject: (projectPath: string, name?: string) =>
    ipcRenderer.invoke("devtent:linkProject", projectPath, name),
  unlinkProject: (name: string) => ipcRenderer.invoke("devtent:unlinkProject", name),
  openProjectPath: (projectPath: string) => ipcRenderer.invoke("devtent:openProjectPath", projectPath),
  setSitePhpVersion: (siteName: string, phpVersion: string | null) =>
    ipcRenderer.invoke("devtent:setSitePhpVersion", siteName, phpVersion),
  getLaravelCaptureSnippet: () => ipcRenderer.invoke("devtent:getLaravelCaptureSnippet"),
  listDumps: (tail?: number) => ipcRenderer.invoke("devtent:listDumps", tail),
  clearDumps: () => ipcRenderer.invoke("devtent:clearDumps"),
  startShare: (siteName: string) => ipcRenderer.invoke("devtent:startShare", siteName),
  stopShare: (siteName: string) => ipcRenderer.invoke("devtent:stopShare", siteName),
  listShares: () => ipcRenderer.invoke("devtent:listShares"),
  setTld: (tld: string) => ipcRenderer.invoke("devtent:setTld", tld),
  installLaravelQueryCapture: (siteName: string) =>
    ipcRenderer.invoke("devtent:installLaravelQueryCapture", siteName),
  setStopServicesOnQuit: (enabled: boolean) =>
    ipcRenderer.invoke("devtent:setStopServicesOnQuit", enabled),
  setLaunchAtLogin: (enabled: boolean) => ipcRenderer.invoke("devtent:setLaunchAtLogin", enabled),
  setAutoStartServices: (enabled: boolean) =>
    ipcRenderer.invoke("devtent:setAutoStartServices", enabled),
  pickExportFolder: () => ipcRenderer.invoke("devtent:pickExportFolder"),
  pickImportBundle: () => ipcRenderer.invoke("devtent:pickImportBundle"),
  exportEnvironment: (destPath: string, options?: { includeBin?: boolean }) =>
    ipcRenderer.invoke("devtent:exportEnvironment", destPath, options),
  importEnvironmentBundle: (bundlePath: string) =>
    ipcRenderer.invoke("devtent:importEnvironmentBundle", bundlePath),
  listTemplates: () => ipcRenderer.invoke("devtent:listTemplates"),
  createProject: (template: string, name: string) =>
    ipcRenderer.invoke("devtent:createProject", template, name),
  enableSsl: (domain: string) => ipcRenderer.invoke("devtent:enableSsl", domain),
  getProcfileToggles: () => ipcRenderer.invoke("devtent:getProcfileToggles"),
  syncCoreServices: () => ipcRenderer.invoke("devtent:syncCoreServices"),
  setProcfileToggle: (id: string, enabled: boolean) =>
    ipcRenderer.invoke("devtent:setProcfileToggle", id, enabled),
  readProcfileRaw: () => ipcRenderer.invoke("devtent:readProcfileRaw"),
  writeProcfileRaw: (content: string) => ipcRenderer.invoke("devtent:writeProcfileRaw", content),
  openPath: (subpath: string) => ipcRenderer.invoke("devtent:openPath", subpath),
  openExternal: (url: string) => ipcRenderer.invoke("devtent:openExternal", url),
  getAppVersion: () => ipcRenderer.invoke("devtent:getAppVersion"),
  listLogs: () => ipcRenderer.invoke("devtent:listLogs"),
  readLogTail: (fileName: string, lines?: number) =>
    ipcRenderer.invoke("devtent:readLogTail", fileName, lines),
  searchLogs: (query: string, fileName?: string) =>
    ipcRenderer.invoke("devtent:searchLogs", query, fileName),
  openLogInEditor: (filePath: string, line?: number) =>
    ipcRenderer.invoke("devtent:openLogInEditor", filePath, line),
  listNodeVersions: () => ipcRenderer.invoke("devtent:listNodeVersions"),
  installNodeVersion: (nodeVersion: string) =>
    ipcRenderer.invoke("devtent:installNodeVersion", nodeVersion),
  setActiveNodeVersion: (nodeVersion: string | null) =>
    ipcRenderer.invoke("devtent:setActiveNodeVersion", nodeVersion),
  checkForUpdates: (options?: { respectSkip?: boolean }) =>
    ipcRenderer.invoke("devtent:checkForUpdates", options),
  skipUpdateVersion: (version: string) => ipcRenderer.invoke("devtent:skipUpdateVersion", version),
  downloadAndInstallUpdate: (update: {
    currentVersion: string;
    latestVersion: string;
    releaseName: string;
    releaseNotes: string;
    releaseUrl: string;
    downloadUrl: string;
    publishedAt: string;
  }) => ipcRenderer.invoke("devtent:downloadAndInstallUpdate", update),
  listAppBackups: () => ipcRenderer.invoke("devtent:listAppBackups"),
  rollbackApp: () => ipcRenderer.invoke("devtent:rollbackApp"),
  openTerminal: () => ipcRenderer.invoke("devtent:openTerminal"),
  listTooling: () => ipcRenderer.invoke("devtent:listTooling"),
  getPathEntries: () => ipcRenderer.invoke("devtent:getPathEntries"),
  installTool: (toolId: string) => ipcRenderer.invoke("devtent:installTool", toolId),
  updateTool: (toolId: string) => ipcRenderer.invoke("devtent:updateTool", toolId),
  removeTool: (toolId: string, options?: { nodeVersion?: string }) =>
    ipcRenderer.invoke("devtent:removeTool", toolId, options),
  quit: () => ipcRenderer.invoke("devtent:quit"),
  openDashboard: (view?: string) => ipcRenderer.invoke("devtent:openDashboard", view),
  closeQuickPanel: () => ipcRenderer.invoke("devtent:closeQuickPanel"),
  setWindowMode: (mode: "setup" | "dashboard") => ipcRenderer.invoke("devtent:setWindowMode", mode),
  onProgress: (callback: (message: string) => void) => {
    const handler = (_event: IpcRendererEvent, message: string) => callback(message);
    ipcRenderer.on("devtent:progress", handler);
    return () => ipcRenderer.removeListener("devtent:progress", handler);
  },
  onRefresh: (callback: (scope?: string) => void) => {
    const handler = (_event: IpcRendererEvent, scope?: string) => callback(scope ?? "all");
    ipcRenderer.on("devtent:refresh", handler);
    return () => ipcRenderer.removeListener("devtent:refresh", handler);
  },
  onUpdateAvailable: (callback: (result: { status: string; update?: unknown }) => void) => {
    const handler = (_event: IpcRendererEvent, result: { status: string; update?: unknown }) =>
      callback(result);
    ipcRenderer.on("devtent:update-available", handler);
    return () => ipcRenderer.removeListener("devtent:update-available", handler);
  },
  onUpdateDownloadProgress: (
    callback: (payload: { percent: number; message: string }) => void
  ) => {
    const handler = (_event: IpcRendererEvent, payload: { percent: number; message: string }) =>
      callback(payload);
    ipcRenderer.on("devtent:update-download-progress", handler);
    return () => ipcRenderer.removeListener("devtent:update-download-progress", handler);
  },
  onNavigate: (callback: (view: string) => void) => {
    const handler = (_event: IpcRendererEvent, view: string) => callback(view);
    ipcRenderer.on("devtent:navigate", handler);
    return () => ipcRenderer.removeListener("devtent:navigate", handler);
  },
};

contextBridge.exposeInMainWorld("devtent", api);

export type DevTentApi = typeof api;
