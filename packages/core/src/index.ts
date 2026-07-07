export {
  initDevTent,
  repairDevTentEnvironment,
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
  setDevTentTld,
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
  restartService,
  startAll,
  stopAll,
  getServiceStatuses,
  parseProcfile,
  saveProcfileEntry,
  isServiceRunning,
} from "./services.js";

export {
  generateVirtualHosts,
  listVirtualHosts,
  discoverProjects,
  resolveProjectWebRoot,
  syncHostsFile,
  elevateHostsSync,
  getHostsSyncInstructions,
  buildHostsContent,
  getHostsFilePath,
} from "./vhosts.js";
export type { HostsSyncResult, VhostSyncResult, HostsSyncOptions } from "./vhosts.js";

export {
  discoverAllVirtualHosts,
  discoverProjectNames,
  listParkedPaths,
  listLinkedSites,
  addParkedPath,
  removeParkedPath,
  linkSite,
  unlinkSite,
  setSitePhpVersion,
} from "./sites.js";

export { runDoctor } from "./doctor.js";
export type { DoctorFinding, DoctorReport } from "./doctor.js";

export {
  normalizeTld,
  tldRequiresHostsFile,
  formatSiteDomain,
  ZERO_ADMIN_TLD,
} from "./domain.js";

export {
  installLaravelQueryCapture,
  installLaravelQueryCaptureForSites,
  isLaravelProject,
  hasLaravelQueryCapture,
} from "./laravel-query-capture.js";
export { LARAVEL_QUERY_CAPTURE_MARKER } from "./dump-capture.js";

export {
  groupQuickAddManifests,
  listQuickAddManifests,
  getQuickAddCategory,
  QUICK_ADD_CATEGORY_LABELS,
} from "./quick-add-manifests.js";
export type { QuickAddCategory } from "./quick-add-manifests.js";
export { buildLaravelEnvSnippet, formatSiteLabel } from "./laravel-env.js";
export { laravelCaptureProviderSnippet } from "./dump-capture.js";
export type { LaravelEnvSnippet } from "./laravel-env.js";

export {
  resolvePhpCgiPort,
  phpCgiProcfileName,
  phpVersionFromProcfileName,
  resolvePhpVersionForVhost,
} from "./php-ports.js";

export { syncPhpCgiProcfile, collectRequiredPhpVersions } from "./php-cgi-sync.js";

export {
  ensureDumpCaptureFiles,
  ensurePhpCaptureForVersion,
  readDumpEvents,
  clearDumpEvents,
  DUMPS_LOG,
} from "./dump-capture.js";
export type { DumpEvent } from "./dump-capture.js";

export { startShare, stopShare, listActiveShares } from "./share.js";
export type { ShareSession } from "./share.js";

export { writeMariaDbIni, initializeMariaDb, isMariaDbDataInitialized } from "./mariadb.js";

export type { CreateProfileInput, UpdateProfileInput, SwitchProfileResult } from "./config.js";

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
  applyNodeVersionToActiveProfile,
  clearActiveNodeVersion,
  installNodeVersion,
  listNodeVersions,
  resolveNodePaths,
  isNodeVersionInstalled,
  getNodeDisplayLabel,
  nodeVersionFromLegacyPath,
  applyExternalNodeToActiveProfile,
  detectExternalNode,
  EXTERNAL_NODE_ID,
  isExternalNodeActive,
} from "./node-runtime.js";
export type { NodeRuntimePaths, NodeVersionInfo, ExternalNodeInfo } from "./node-runtime.js";

export {
  listTooling,
  installTool,
  updateTool,
  removeTool,
  isToolingManifest,
  getComposerHome,
  TOOLING_IDS,
} from "./tooling.js";
export type { ToolingEntry, ToolingOverview, ToolingSource, ToolingId, ExternalNodeOption } from "./tooling.js";

export {
  searchLogFiles,
  parseLogLineLocations,
  listLogFilesWithMeta,
} from "./log-viewer.js";
export type { LogSearchMatch, LogFileLocation } from "./log-viewer.js";

export {
  loadTemplate,
  listTemplates,
  createFromTemplate,
  writePlainPhpProject,
} from "./quick-app.js";

export {
  enableSsl,
  installMkcertCa,
  hasSslCertificate,
  sslCertPaths,
} from "./ssl.js";
export type { SslResult } from "./ssl.js";

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
  getServicePresetsForProfile,
  getProcfileToggles,
  setProcfileToggle,
  updateProcfileEntry,
  enableCoreServicesIfReady,
  syncPhpProcfileFromProfile,
} from "./procfile.js";

export {
  ensureApacheConfig,
  APACHE_PROCFILE_COMMAND,
  needsApacheProcfileRepair,
  apachePhpHandlerBlock,
} from "./apache-support.js";

export {
  prepareHostsSyncFiles,
  launchElevatedHostsSync,
  requestElevatedHostsSync,
  getElevatedHostsSyncMessage,
  getElevatedHostsSyncFailureMessage,
  isHostsElevationDisabled,
} from "./hosts-elevate.js";

export { syncProfileProcfileFromProfile } from "./profile-procfile.js";

export {
  getProfileServiceIds,
  getProfileServices,
  previewProfileSwitch,
} from "./profile-services.js";
export type { ProfileService } from "./profile-services.js";

export {
  writeMysqlIni,
  isMysqlDataInitialized,
  initializeMysql,
  backupMysql,
  restoreMysql,
  listMysqlBackups,
  pruneMysqlBackups,
  maybeDailyMysqlBackup,
  MYSQL_BACKUP_DIR,
  BACKUP_RETENTION_DAYS,
} from "./mysql.js";
export type { MysqlBackupInfo } from "./mysql.js";

export { getEnvironmentHealth } from "./health.js";
export type { HealthItem, HealthSeverity } from "./health.js";

export {
  exportEnvironment,
  importEnvironmentBundle,
} from "./portability.js";
export type {
  ExportEnvironmentOptions,
  ExportEnvironmentResult,
  ImportEnvironmentResult,
} from "./portability.js";

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
  const { listVirtualHosts } = await import("./vhosts.js");

  const config = await loadConfig(root);
  const virtualHosts = await listVirtualHosts(root);

  return {
    root,
    services: getServiceStatuses(),
    activeProfile: config.activeProfile,
    virtualHosts,
  };
}
