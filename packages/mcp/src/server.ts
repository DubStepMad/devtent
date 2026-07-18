import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { createMcpContext } from "./context.js";
import {
  buildDebugSitePrompt,
  buildSiteInformationResource,
  findAvailableServices,
  getAllPhpVersions,
  getAllSites,
  getLaravelEnvSnippetTool,
  installPhpVersion,
  installService,
  isolateOrUnisolateSite,
  runDoctorTool,
  secureOrUnsecureSite,
  startOrStopService,
} from "./handlers.js";

export function createDevTentMcpServer(env: NodeJS.ProcessEnv = process.env): McpServer {
  const ctx = createMcpContext(env);
  const server = new McpServer({
    name: "devtent",
    version: "1.4.0",
  });

  server.tool(
    "find_available_services",
    "List Quick Add manifests, running services, and connection env hints (DB/Redis/Mailpit).",
    {},
    async () => findAvailableServices(ctx)
  );

  server.tool(
    "install_service",
    "Install a runtime/service from a DevTent Quick Add manifest (e.g. mysql-8.4, redis, mailpit, nginx).",
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
    "Laravel .env snippet for APP_URL, DB, mail, Redis. Passwords redacted unless includeSecrets is true.",
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
