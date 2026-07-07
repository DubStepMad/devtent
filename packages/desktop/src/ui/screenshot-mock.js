/** Demo API for README screenshots — fictional sites and stack data only. */
(function () {
  const DEMO_ROOT = "c:\\devtent";

  const FAKE_HOSTS = [
    {
      name: "bookstore",
      domain: "bookstore.test",
      ssl: true,
      source: "www",
      phpVersion: "php-8.3",
      projectPath: `${DEMO_ROOT}\\www\\bookstore`,
    },
    {
      name: "api-demo",
      domain: "api-demo.test",
      ssl: false,
      source: "parked",
      phpVersion: "php-8.4",
      projectPath: "c:\\projects\\parked\\api-demo",
    },
    {
      name: "client-portal",
      domain: "client-portal.test",
      ssl: true,
      source: "linked",
      phpVersion: "php-8.2",
      projectPath: "d:\\clients\\portal",
    },
  ];

  const FAKE_SERVICES = [
    { name: "nginx", running: true, pid: 4821 },
    { name: "php-cgi-8.3", running: true, pid: 5102 },
    { name: "mysql", running: true, pid: 6204 },
    { name: "redis", running: true, pid: 7011 },
    { name: "mailpit", running: false, pid: null },
  ];

  const FAKE_PROFILE_SERVICES = [
    {
      id: "nginx",
      name: "Nginx",
      command: "nginx -c etc/nginx/nginx.conf",
      runtimeInstalled: true,
    },
    {
      id: "php-cgi-8.3",
      name: "PHP 8.3 (CGI)",
      command: "php-cgi-8.3 -b 127.0.0.1:9082",
      runtimeInstalled: true,
    },
    {
      id: "mysql",
      name: "MySQL",
      command: "mysqld --defaults-file=etc/mysql/my.ini",
      runtimeInstalled: true,
    },
    {
      id: "redis",
      name: "Redis",
      command: "redis-server etc/redis/redis.conf",
      runtimeInstalled: true,
    },
    {
      id: "mailpit",
      name: "Mailpit",
      command: "mailpit --listen 127.0.0.1:8025",
      runtimeInstalled: true,
    },
  ];

  const FAKE_PROFILES = [
    {
      name: "default",
      description: "PHP 8.3 · Nginx · MySQL",
      phpVersion: "php-8.3",
      webServer: "nginx",
      database: "mysql",
      services: ["redis", "mailpit"],
    },
    {
      name: "laravel",
      description: "PHP 8.4 · Redis · Mailpit",
      phpVersion: "php-8.4",
      webServer: "nginx",
      database: "mysql",
      services: ["redis", "mailpit"],
    },
    {
      name: "legacy",
      description: "PHP 8.2 · Apache",
      phpVersion: "php-8.2",
      webServer: "apache",
      database: "mysql",
      services: [],
    },
  ];

  const FAKE_MANIFESTS = [
    { name: "php-8.2", version: "8.2.28", description: "PHP 8.2", installed: true },
    { name: "php-8.3", version: "8.3.20", description: "PHP 8.3", installed: true },
    { name: "php-8.4", version: "8.4.6", description: "PHP 8.4", installed: true },
    { name: "nginx", version: "1.27.4", description: "Nginx web server", installed: true },
    { name: "mysql", version: "8.4.4", description: "MySQL database", installed: true },
    { name: "redis", version: "7.4.2", description: "Redis cache", installed: true },
    { name: "mailpit", version: "1.22.3", description: "Local mail catcher", installed: true },
    { name: "mkcert", version: "1.4.4", description: "Local HTTPS certificates", installed: true },
    { name: "postgresql", version: "17.4", description: "PostgreSQL", installed: false },
    { name: "mariadb-11.4", version: "11.4.5", description: "MariaDB", installed: false },
  ];

  const FAKE_TOOLING = {
    tools: [
      {
        id: "composer",
        name: "Composer",
        description: "PHP dependency manager",
        binaries: ["composer", "composer.phar"],
        source: "managed",
        statusLabel: "Managed",
        canInstall: false,
        canUpdate: true,
        canRemove: true,
      },
      {
        id: "node",
        name: "Node.js",
        description: "JavaScript runtime",
        binaries: ["node", "npm", "npx"],
        source: "managed",
        statusLabel: "v22.14.0",
        canInstall: false,
        canUpdate: false,
        canRemove: true,
      },
      {
        id: "bun",
        name: "Bun",
        description: "Fast JavaScript toolkit",
        binaries: ["bun"],
        source: "managed",
        statusLabel: "v1.2.5",
        canInstall: false,
        canUpdate: true,
        canRemove: true,
      },
      {
        id: "laravel-installer",
        name: "Laravel Installer",
        description: "Scaffold new Laravel apps",
        binaries: ["laravel"],
        source: "managed",
        statusLabel: "Installed",
        canInstall: false,
        canUpdate: false,
        canRemove: true,
      },
    ],
    pathEntries: [
      `${DEMO_ROOT}\\bin\\php-8.3`,
      `${DEMO_ROOT}\\bin\\composer`,
      `${DEMO_ROOT}\\bin\\node-22`,
      `${DEMO_ROOT}\\bin\\bun`,
    ],
    nodeVersions: [
      { id: "node-20", label: "Node 20 LTS", installed: false, active: false },
      { id: "node-22", label: "Node 22 LTS", installed: true, active: true },
    ],
    externalNode: {
      id: "external",
      label: "Node 22.11.0",
      manager: "fnm",
      path: "C:\\Users\\demo\\.fnm\\node-versions\\v22.11.0",
      active: false,
      available: true,
    },
  };

  const FAKE_DUMPS = [
    {
      ts: Math.floor(Date.now() / 1000) - 95,
      type: "dump",
      message: 'array:3 [\n  "id" => 42\n  "title" => "Example product"\n  "price" => 19.99\n]',
      file: "ProductController.php",
      line: 28,
    },
    {
      ts: Math.floor(Date.now() / 1000) - 52,
      type: "query",
      message: "select * from `orders` where `user_id` = ? limit 10",
      context: "bindings: [7]\ntime: 2.4ms",
      file: "OrderRepository.php",
      line: 15,
    },
    {
      ts: Math.floor(Date.now() / 1000) - 18,
      type: "dd",
      message: '"Checkout complete"',
      file: "CheckoutController.php",
      line: 44,
    },
  ];

  const FAKE_LOGS = `2026-07-07 14:02:11 [notice] nginx/1.27.4 started
2026-07-07 14:02:12 [info] php-cgi-8.3 listening on 127.0.0.1:9082
2026-07-07 14:02:14 [info] mysql ready for connections on port 3306
2026-07-07 14:05:33 GET / HTTP/1.1 200 bookstore.test
2026-07-07 14:05:41 GET /api/health HTTP/1.1 200 api-demo.test`;

  const noop = () => {};
  const ok = (value) => () => Promise.resolve(value);

  window.devtent = {
    getRoot: ok({
      root: DEMO_ROOT,
      initialized: true,
      setupCompletedForRoot: true,
      hasExistingData: true,
      stopServicesOnQuit: true,
      launchAtLogin: false,
      launchAtLoginAvailable: true,
      autoStartServices: true,
    }),
    getDefaultRoot: ok(DEMO_ROOT),
    getState: ok({
      root: DEMO_ROOT,
      initialized: true,
      services: FAKE_SERVICES,
      virtualHosts: FAKE_HOSTS,
      activeProfile: "default",
    }),
    getServices: ok(FAKE_SERVICES),
    getProfileServices: ok(FAKE_PROFILE_SERVICES),
    listProfiles: ok({ active: "default", profiles: FAKE_PROFILES }),
    listManifests: ok(FAKE_MANIFESTS),
    listTemplates: ok([
      { name: "laravel", description: "Fresh Laravel app" },
      { name: "php", description: "Plain PHP starter" },
    ]),
    listTooling: ok(FAKE_TOOLING),
    listNodeVersions: ok(FAKE_TOOLING.nodeVersions),
    listDumps: ok(FAKE_DUMPS),
    listLogs: ok([
      { name: "nginx.log", path: `${DEMO_ROOT}\\logs\\nginx.log`, sizeBytes: 4096 },
      { name: "php-cgi-8.3.log", path: `${DEMO_ROOT}\\logs\\php-cgi-8.3.log`, sizeBytes: 2048 },
    ]),
    readLogTail: ok(FAKE_LOGS),
    searchLogs: ok([]),
    getEnvironmentHealth: ok([
      { id: "runtimes", severity: "ok", title: "Profile runtimes installed" },
      { id: "services", severity: "ok", title: "Core services running" },
      { id: "hosts", severity: "ok", title: "Hosts file in sync" },
      { id: "ssl", severity: "ok", title: "HTTPS certificates valid" },
    ]),
    listSitesConfig: ok({
      parked: ["c:\\projects\\parked"],
      linked: [{ name: "client-portal", path: "d:\\clients\\portal" }],
    }),
    listMysqlBackups: ok([
      {
        id: "2026-07-07T08-00-00",
        createdAt: "2026-07-07T08:00:00.000Z",
        reason: "scheduled",
        sizeBytes: 245760,
      },
    ]),
    listAppBackups: ok([]),
    getAppVersion: ok("1.2.0"),
    checkForUpdates: ok({ status: "up-to-date", currentVersion: "1.2.0" }),
    previewProfileSwitch: ok({ servicesToStart: [], servicesToStop: [] }),
    switchProfile: ok({ success: true }),
    setWindowMode: ok(undefined),
    setRoot: ok({ root: DEMO_ROOT, initialized: true }),
    init: ok({ root: DEMO_ROOT, initialized: true }),
    syncVhosts: ok({ success: true, message: "Synced" }),
    elevateHostsSync: ok({ success: true, launched: false }),
    openExternal: noop,
    openPath: noop,
    openProjectPath: noop,
    openTerminal: noop,
    openLogInEditor: ok({ success: false }),
    getLaravelEnv: ok({
      domain: "bookstore.test",
      envBlock: "APP_URL=https://bookstore.test\nDB_DATABASE=bookstore\n",
    }),
    getLaravelCaptureSnippet: ok("// Laravel query capture snippet"),
    clearDumps: ok(undefined),
    onProgress: noop,
    onRefresh: noop,
    onUpdateAvailable: noop,
    onUpdateDownloadProgress: noop,
    onNavigate: noop,
    closeQuickPanel: noop,
    startAll: ok([]),
    stopAll: ok([]),
    startService: ok({ success: true }),
    stopService: ok({ success: true }),
    restartService: ok({ success: true }),
    installManifest: ok({ success: true }),
    installTool: ok({ success: true }),
    updateTool: ok({ success: true }),
    removeTool: ok({ success: true }),
    setActiveNodeVersion: ok({ success: true }),
    installNodeVersion: ok({ success: true }),
    createProfile: ok({ success: true }),
    updateProfile: ok({ success: true }),
    deleteProfile: ok({ success: true }),
    createProject: ok({ name: "demo" }),
    enableSsl: ok({ success: true, message: "Certificate generated" }),
    setSitePhpVersion: ok({ success: true }),
    startShare: ok({ publicUrl: "https://example-demo.trycloudflare.com" }),
    unparkFolder: ok({ success: true }),
    unlinkProject: ok({ success: true }),
    parkFolder: ok({ success: true }),
    linkProject: ok({ success: true }),
    detectLaragon: ok([]),
    previewLaragonMigration: ok({ valid: false, projects: [], phpVersions: [], databases: [] }),
    migrateFromLaragon: ok({ projectsCopied: [] }),
    installRecommendedStack: ok({ success: true }),
    restoreMysql: ok({ success: true, message: "Restored" }),
    pickRoot: ok(null),
    pickLaragonRoot: ok(null),
    pickExportFolder: ok(null),
    pickImportBundle: ok(null),
    exportEnvironment: ok({ success: true }),
    importEnvironmentBundle: ok({ success: true }),
    runDoctor: ok({ findings: [] }),
    setStopServicesOnQuit: ok(undefined),
    setLaunchAtLogin: ok(undefined),
    setAutoStartServices: ok(undefined),
  };
})();
