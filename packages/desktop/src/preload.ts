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
  }) => ipcRenderer.invoke("devtent:createProfile", input),
  updateProfile: (
    name: string,
    patch: {
      description?: string;
      phpVersion?: string;
      webServer?: "nginx" | "apache";
      database?: "mysql" | "postgresql" | "none";
    }
  ) => ipcRenderer.invoke("devtent:updateProfile", name, patch),
  deleteProfile: (name: string) => ipcRenderer.invoke("devtent:deleteProfile", name),
  listManifests: () => ipcRenderer.invoke("devtent:listManifests"),
  installManifest: (name: string) => ipcRenderer.invoke("devtent:installManifest", name),
  installRecommendedStack: () => ipcRenderer.invoke("devtent:installRecommendedStack"),
  backupMysql: () => ipcRenderer.invoke("devtent:backupMysql"),
  listMysqlBackups: () => ipcRenderer.invoke("devtent:listMysqlBackups"),
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
  quit: () => ipcRenderer.invoke("devtent:quit"),
  openDashboard: (view?: string) => ipcRenderer.invoke("devtent:openDashboard", view),
  closeQuickPanel: () => ipcRenderer.invoke("devtent:closeQuickPanel"),
  setWindowMode: (mode: "setup" | "dashboard") => ipcRenderer.invoke("devtent:setWindowMode", mode),
  onProgress: (callback: (message: string) => void) => {
    const handler = (_event: IpcRendererEvent, message: string) => callback(message);
    ipcRenderer.on("devtent:progress", handler);
    return () => ipcRenderer.removeListener("devtent:progress", handler);
  },
  onRefresh: (callback: () => void) => {
    const handler = () => callback();
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
