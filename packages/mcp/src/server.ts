import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { createMcpContext } from "./context.js";
import {
  backupDatabaseTool,
  buildDebugSitePrompt,
  buildSiteInformationResource,
  clearDumpsTool,
  createDatabaseTool,
  findAvailableServices,
  getAllPhpVersions,
  getAllSites,
  getLaravelEnvSnippetTool,
  installPhpVersion,
  installService,
  isolateOrUnisolateSite,
  listDatabasesTool,
  listDumpsTool,
  listSiteWorkersTool,
  runDoctorTool,
  secureOrUnsecureSite,
  setSiteWorkerTool,
  startOrStopService,
} from "./handlers.js";

export function createDevTentMcpServer(env: NodeJS.ProcessEnv = process.env): McpServer {
  const ctx = createMcpContext(env);
  const server = new McpServer({
    name: "devtent",
    version: "1.5.0",
  });

  server.tool(
    "find_available_services",
    "List Quick Add manifests, running services, and connection env hints (DB/Redis/Mailpit/Meilisearch/MinIO).",
    {},
    async () => findAvailableServices(ctx)
  );

  server.tool(
    "install_service",
    "Install a runtime/service from a DevTent Quick Add manifest (e.g. mysql-8.4, redis, mailpit, meilisearch, minio, nginx).",
    { service: z.string().describe("Manifest name, e.g. redis or php-8.3") },
    async ({ service }) => installService(ctx, service)
  );

  server.tool(
    "start_or_stop_service",
    "Start or stop a single DevTent service by Procfile name.",
    {
      service: z.string().describe("Service name, e.g. nginx, mysql, redis"),
      action: z.enum(["start", "stop"]),
    },
    async ({ service, action }) => startOrStopService(ctx, service, action)
  );

  server.tool(
    "get_all_php_versions",
    "List installed PHP versions and available php-* Quick Add manifests.",
    {},
    async () => getAllPhpVersions(ctx)
  );

  server.tool(
    "install_php_version",
    "Install a PHP version via Quick Add (e.g. 8.3 or php-8.3).",
    { version: z.string().describe("PHP version like 8.3 or php-8.3") },
    async ({ version }) => installPhpVersion(ctx, version)
  );

  server.tool(
    "get_all_sites",
    "List all DevTent sites with domain, URL, PHP version, and SSL status.",
    {},
    async () => getAllSites(ctx)
  );

  server.tool(
    "secure_or_unsecure_site",
    "Enable or disable local SSL (mkcert) for a site. Defaults to SITE_PATH when siteName omitted.",
    {
      action: z.enum(["secure", "unsecure"]),
      siteName: z
        .string()
        .optional()
        .describe("Site name; defaults to the site matching SITE_PATH"),
    },
    async ({ action, siteName }) => secureOrUnsecureSite(ctx, action, siteName)
  );

  server.tool(
    "isolate_or_unisolate_site",
    "Pin a site to a PHP version (isolate) or clear the override (unisolate). Defaults to SITE_PATH.",
    {
      action: z.enum(["isolate", "unisolate"]),
      phpVersion: z
        .string()
        .optional()
        .describe("Required for isolate — e.g. 8.3 or php-8.3"),
      siteName: z
        .string()
        .optional()
        .describe("Site name; defaults to the site matching SITE_PATH"),
    },
    async ({ action, phpVersion, siteName }) =>
      isolateOrUnisolateSite(ctx, action, phpVersion, siteName)
  );

  server.tool(
    "run_doctor",
    "Diagnose the DevTent environment; optionally apply safe repairs.",
    {
      fix: z.boolean().optional().describe("Apply safe automatic repairs"),
      startServices: z
        .boolean()
        .optional()
        .describe("Start services after repair (only with fix)"),
    },
    async ({ fix, startServices }) => runDoctorTool(ctx, fix ?? false, startServices ?? false)
  );

  server.tool(
    "get_laravel_env_snippet",
    "Laravel .env snippet for APP_URL, DB, mail, Redis, Meilisearch, MinIO. Passwords redacted unless includeSecrets is true.",
    {
      siteName: z
        .string()
        .optional()
        .describe("Site name; defaults to the site matching SITE_PATH"),
      includeSecrets: z
        .boolean()
        .optional()
        .describe("Include clear-text DB passwords (default false)"),
    },
    async ({ siteName, includeSecrets }) =>
      getLaravelEnvSnippetTool(ctx, siteName, includeSecrets ?? false)
  );

  server.tool(
    "list_dumps",
    "Read recent dump / Laravel telemetry events from logs/dumps.jsonl.",
    {
      tail: z.number().optional().describe("Max events to return (default 50, max 500)"),
      siteName: z
        .string()
        .optional()
        .describe("Filter by site; defaults to SITE_PATH match when set"),
    },
    async ({ tail, siteName }) => listDumpsTool(ctx, tail ?? 50, siteName)
  );

  server.tool(
    "clear_dumps",
    "Clear all dump / Laravel telemetry events.",
    {},
    async () => clearDumpsTool(ctx)
  );

  server.tool(
    "list_databases",
    "List databases for the active profile database engine.",
    {},
    async () => listDatabasesTool(ctx)
  );

  server.tool(
    "create_database",
    "Create a database on the active profile engine.",
    { name: z.string().describe("Database name") },
    async ({ name }) => createDatabaseTool(ctx, name)
  );

  server.tool(
    "backup_database",
    "Run a manual backup for mysql, mariadb, postgresql, or the active managed engine.",
    {
      engine: z
        .enum(["mysql", "mariadb", "postgresql", "active"])
        .optional()
        .describe("Engine to back up (default active)"),
    },
    async ({ engine }) => backupDatabaseTool(ctx, engine ?? "active")
  );

  server.tool(
    "list_site_workers",
    "List queue / Vite / scheduler worker status for sites.",
    {
      siteName: z
        .string()
        .optional()
        .describe("Limit to one site; defaults to SITE_PATH match when set"),
    },
    async ({ siteName }) => listSiteWorkersTool(ctx, siteName)
  );

  server.tool(
    "set_site_worker",
    "Enable or disable a queue, Vite, or schedule worker for a site (starts/stops immediately).",
    {
      kind: z.enum(["queue", "vite", "schedule"]),
      enabled: z.boolean(),
      siteName: z
        .string()
        .optional()
        .describe("Site name; defaults to the site matching SITE_PATH"),
    },
    async ({ kind, enabled, siteName }) => setSiteWorkerTool(ctx, kind, enabled, siteName)
  );

  server.resource(
    "site_information",
    "devtent://site_information",
    {
      description:
        "Current site from SITE_PATH: URL, PHP, SSL, redacted DB env, active profile",
      mimeType: "application/json",
    },
    async () => buildSiteInformationResource(ctx)
  );

  server.prompt(
    "debug_site",
    "Guide for debugging the current SITE_PATH site using doctor, dumps, and services",
    async () => buildDebugSitePrompt(ctx)
  );

  return server;
}

export async function runMcpServer(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const server = createDevTentMcpServer(env);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
