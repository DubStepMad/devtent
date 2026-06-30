export {
  initDevTent,
  loadConfig,
  saveConfig,
  loadProfile,
  saveProfile,
  listProfiles,
  switchProfile,
  createProfile,
  updateProfile,
  deleteProfile,
  applyPhpVersionToActiveProfile,
  getDefaultConfig,
  getDefaultInstallRoot,
  normalizeInstallRoot,
  resolvePath,
  pathExists,
  getActiveServices,
  CONFIG_FILENAME,
  DEFAULT_PROFILE,
} from "./config.js";

export {
  startService,
  stopService,
  startAll,
  stopAll,
  getServiceStatuses,
  parseProcfile,
  saveProcfileEntry,
  isServiceRunning,
} from "./services.js";

export {
  generateVirtualHosts,
  discoverProjects,
  syncHostsFile,
  elevateHostsSync,
  getHostsSyncInstructions,
  buildHostsContent,
  getHostsFilePath,
} from "./vhosts.js";
export type { HostsSyncResult, VhostSyncResult, HostsSyncOptions } from "./vhosts.js";

export type { CreateProfileInput, UpdateProfileInput } from "./config.js";

export {
  loadManifest,
  listManifests,
  listManifestsWithStatus,
  installFromManifest,
  validateManifestPlatform,
} from "./quick-add.js";
export type { ManifestWithStatus } from "./quick-add.js";

export {
  DEFAULT_PHP_VERSION,
  normalizeProfile,
  resolvePhpPaths,
  isManifestInstalled,
  isPhpVersionInstalled,
  getPhpDisplayName,
} from "./profile-runtime.js";
export type { PhpRuntimePaths } from "./profile-runtime.js";

export {
  loadTemplate,
  listTemplates,
  createFromTemplate,
  writePlainPhpProject,
} from "./quick-app.js";

export {
  enableSsl,
  installMkcertCa,
} from "./ssl.js";

export {
  getPathEntries,
  generatePathScript,
  writePathScript,
  getShellCommand,
} from "./path.js";

export {
  readProcfileRaw,
  writeProcfileRaw,
  getServicePresets,
  getProcfileToggles,
  setProcfileToggle,
  updateProcfileEntry,
  enableCoreServicesIfReady,
  syncPhpProcfileFromProfile,
} from "./procfile.js";

export { syncProfileProcfileFromProfile } from "./profile-procfile.js";

export {
  writeMysqlIni,
  isMysqlDataInitialized,
  initializeMysql,
  backupMysql,
  listMysqlBackups,
  pruneMysqlBackups,
  maybeDailyMysqlBackup,
  MYSQL_BACKUP_DIR,
  BACKUP_RETENTION_DAYS,
} from "./mysql.js";
export type { MysqlBackupInfo } from "./mysql.js";

export {
  installRecommendedStack,
  RECOMMENDED_STACK_MANIFESTS,
  RECOMMENDED_STACK_SERVICES,
} from "./recommended-stack.js";
export type { RecommendedStackResult } from "./recommended-stack.js";

export { hasExistingEnvironment, isDevTentEnvironment } from "./environment.js";

export { listLogFiles, readLogTail, readLogContent } from "./logs.js";
export type { LogFileInfo } from "./logs.js";

export {
  detectLaragonInstalls,
  isLaragonRoot,
  migrateFromLaragon,
  previewLaragonMigration,
  listLaragonDatabaseDirs,
} from "./migrate/laragon.js";

export type {
  DevTentConfig,
  Profile,
  ServiceConfig,
  ServiceDefinition,
  ServiceStatus,
  VirtualHost,
  QuickAddManifest,
  QuickAppTemplate,
  ProcfileEntry,
  DevTentState,
} from "./types.js";

export type { ServicePreset, ProcfileToggle } from "./procfile.js";
export type {
  LaragonInstallInfo,
  LaragonMigrationResult,
  LaragonMigrationOptions,
  LaragonDatabaseInfo,
} from "./migrate/laragon.js";

export async function getState(root: string): Promise<import("./types.js").DevTentState> {
  const { loadConfig } = await import("./config.js");
  const { getServiceStatuses } = await import("./services.js");
  const { generateVirtualHosts } = await import("./vhosts.js");

  const config = await loadConfig(root);
  const virtualHosts = (await generateVirtualHosts(root)).vhosts;

  return {
    root,
    services: getServiceStatuses(),
    activeProfile: config.activeProfile,
    virtualHosts,
  };
}
