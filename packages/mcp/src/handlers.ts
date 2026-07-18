import {
  buildLaravelEnvSnippet,
  disableSsl,
  enableSsl,
  getServiceStatuses,
  getState,
  installFromManifest,
  listInstalledPhpVersions,
  listManifestsWithStatus,
  loadManifest,
  resolveDatabaseTarget,
  runDoctor,
  setSitePhpVersion,
  startService,
  stopService,
  listVirtualHosts,
  loadConfig,
  loadProfile,
  readDumpEvents,
} from "@devtent/core";
import type { McpContext } from "./context.js";
import { matchSiteFromPath, resolveCurrentSite } from "./context.js";

function textResult(data: unknown, isError = false) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
    isError,
  };
}

function errorResult(message: string) {
  return textResult({ error: message }, true);
}

async function resolveSiteName(
  ctx: McpContext,
  siteName?: string
): Promise<{ name: string; domain: string; phpVersion?: string; ssl: boolean } | null> {
  if (siteName?.trim()) {
    const vhosts = await listVirtualHosts(ctx.root);
    const v = vhosts.find((h) => h.name === siteName.trim());
    if (!v) return null;
    return { name: v.name, domain: v.domain, phpVersion: v.phpVersion, ssl: v.ssl };
  }
  const current = await resolveCurrentSite(ctx.root, ctx.sitePath);
  if (!current) return null;
  return {
    name: current.name,
    domain: current.domain,
    phpVersion: current.phpVersion,
    ssl: current.ssl,
  };
}

export async function findAvailableServices(ctx: McpContext) {
  const [manifests, statuses, db] = await Promise.all([
    listManifestsWithStatus(ctx.root, ctx.manifestsDir),
    Promise.resolve(getServiceStatuses()),
    resolveDatabaseTarget(ctx.root),
  ]);

  const serviceHints: Record<string, Record<string, string | number>> = {};
  if (db.engine !== "none") {
    serviceHints.database = {
      engine: db.engine,
      mode: db.mode,
      host: db.host,
      port: db.port,
      user: db.user,
      password: "***",
    };
  }
  serviceHints.redis = { host: "127.0.0.1", port: 6379 };
  serviceHints.mailpit = {
    smtpHost: "127.0.0.1",
    smtpPort: 1025,
    ui: "http://127.0.0.1:8025",
  };

  return textResult({
    manifests: manifests.map((m) => ({
      name: m.name,
      version: m.version,
      description: m.description,
      installed: m.installed,
      platform: m.platform,
    })),
    running: statuses,
    connectionHints: serviceHints,
  });
}

export async function installService(ctx: McpContext, service: string) {
  const name = service.trim();
  if (!name) return errorResult("service is required");
  try {
    const manifest = await loadManifest(ctx.manifestsDir, name);
    const message = await installFromManifest(ctx.root, manifest);
    return textResult({ ok: true, service: name, message });
  } catch (err) {
    return errorResult(err instanceof Error ? err.message : String(err));
  }
}

export async function startOrStopService(
  ctx: McpContext,
  service: string,
  action: "start" | "stop"
) {
  const name = service.trim();
  if (!name) return errorResult("service is required");
  if (action !== "start" && action !== "stop") {
    return errorResult('action must be "start" or "stop"');
  }
  try {
    if (action === "start") {
      await startService(ctx.root, name);
    } else {
      await stopService(ctx.root, name);
    }
    const statuses = getServiceStatuses();
    return textResult({ ok: true, service: name, action, statuses });
  } catch (err) {
    return errorResult(err instanceof Error ? err.message : String(err));
  }
}

export async function getAllPhpVersions(ctx: McpContext) {
  const [installed, manifests, config] = await Promise.all([
    listInstalledPhpVersions(ctx.root),
    listManifestsWithStatus(ctx.root, ctx.manifestsDir),
    loadConfig(ctx.root),
  ]);
  const profile = await loadProfile(ctx.root, config.activeProfile);
  const phpManifests = manifests.filter((m) => m.name.startsWith("php-"));
  return textResult({
    activeProfile: config.activeProfile,
    activePhpVersion: profile.phpVersion,
    installed,
    available: phpManifests.map((m) => ({
      name: m.name,
      version: m.version,
      installed: m.installed,
    })),
  });
}

export async function installPhpVersion(ctx: McpContext, version: string) {
  const raw = version.trim();
  if (!raw) return errorResult("version is required (e.g. 8.3 or php-8.3)");
  const name = raw.startsWith("php-") ? raw : `php-${raw}`;
  return installService(ctx, name);
}

export async function getAllSites(ctx: McpContext) {
  const [state, config] = await Promise.all([getState(ctx.root), loadConfig(ctx.root)]);
  const sites = state.virtualHosts.map((v) => ({
    name: v.name,
    domain: v.domain,
    url: `${v.ssl ? "https" : "http"}://${v.domain}/`,
    ssl: v.ssl,
    phpVersion: v.phpVersion,
    source: v.source,
    projectPath: v.projectPath,
    root: v.root,
  }));
  return textResult({
    activeProfile: state.activeProfile,
    tld: config.tld,
    sites,
  });
}

export async function secureOrUnsecureSite(
  ctx: McpContext,
  action: "secure" | "unsecure",
  siteName?: string
) {
  if (action !== "secure" && action !== "unsecure") {
    return errorResult('action must be "secure" or "unsecure"');
  }
  const site = await resolveSiteName(ctx, siteName);
  if (!site) {
    return errorResult(
      siteName
        ? `Site not found: ${siteName}`
        : "No site matched SITE_PATH; pass siteName explicitly"
    );
  }
  try {
    const result =
      action === "secure"
        ? await enableSsl(ctx.root, site.domain)
        : await disableSsl(ctx.root, site.domain);
    return textResult(result, !result.success);
  } catch (err) {
    return errorResult(err instanceof Error ? err.message : String(err));
  }
}

export async function isolateOrUnisolateSite(
  ctx: McpContext,
  action: "isolate" | "unisolate",
  phpVersion?: string,
  siteName?: string
) {
  if (action !== "isolate" && action !== "unisolate") {
    return errorResult('action must be "isolate" or "unisolate"');
  }
  const site = await resolveSiteName(ctx, siteName);
  if (!site) {
    return errorResult(
      siteName
        ? `Site not found: ${siteName}`
        : "No site matched SITE_PATH; pass siteName explicitly"
    );
  }
  if (action === "isolate") {
    const ver = phpVersion?.trim();
    if (!ver) return errorResult("phpVersion is required when action is isolate");
    const normalized = ver.startsWith("php-") ? ver : `php-${ver}`;
    await setSitePhpVersion(ctx.root, site.name, normalized);
    return textResult({
      ok: true,
      site: site.name,
      action,
      phpVersion: normalized,
    });
  }
  await setSitePhpVersion(ctx.root, site.name, null);
  return textResult({ ok: true, site: site.name, action, phpVersion: null });
}

export async function runDoctorTool(
  ctx: McpContext,
  fix = false,
  startServices = false
) {
  const report = await runDoctor(ctx.root, { repair: fix, startServices });
  return textResult(report);
}

export async function getLaravelEnvSnippetTool(
  ctx: McpContext,
  siteName?: string,
  includeSecrets = false
) {
  const site = await resolveSiteName(ctx, siteName);
  if (!site) {
    return errorResult(
      siteName
        ? `Site not found: ${siteName}`
        : "No site matched SITE_PATH; pass siteName explicitly"
    );
  }
  try {
    const snippet = await buildLaravelEnvSnippet(ctx.root, site.name);
    return textResult({
      siteName: snippet.siteName,
      domain: snippet.domain,
      envBlock: includeSecrets ? snippet.envBlock : snippet.envBlockRedacted,
      secretsIncluded: includeSecrets,
    });
  } catch (err) {
    return errorResult(err instanceof Error ? err.message : String(err));
  }
}

export async function buildSiteInformationResource(ctx: McpContext) {
  if (!ctx.sitePath) {
    return {
      contents: [
        {
          uri: "devtent://site_information",
          mimeType: "application/json",
          text: JSON.stringify(
            { error: "SITE_PATH is not set; configure it in your MCP client env" },
            null,
            2
          ),
        },
      ],
    };
  }

  const vhosts = await listVirtualHosts(ctx.root);
  const site = matchSiteFromPath(ctx.sitePath, vhosts);
  if (!site) {
    return {
      contents: [
        {
          uri: "devtent://site_information",
          mimeType: "application/json",
          text: JSON.stringify(
            {
              error: "SITE_PATH did not match a DevTent site",
              sitePath: ctx.sitePath,
              knownSites: vhosts.map((v) => ({
                name: v.name,
                projectPath: v.projectPath,
                root: v.root,
              })),
            },
            null,
            2
          ),
        },
      ],
    };
  }

  const [config, db, snippet] = await Promise.all([
    loadConfig(ctx.root),
    resolveDatabaseTarget(ctx.root),
    buildLaravelEnvSnippet(ctx.root, site.name).catch(() => null),
  ]);
  const profile = await loadProfile(ctx.root, config.activeProfile);

  const payload = {
    name: site.name,
    domain: site.domain,
    url: `${site.ssl ? "https" : "http"}://${site.domain}/`,
    ssl: site.ssl,
    phpVersion: site.phpVersion ?? profile.phpVersion,
    source: site.source,
    projectPath: site.projectPath,
    profile: config.activeProfile,
    database: {
      engine: db.engine,
      mode: db.mode,
      host: db.host,
      port: db.port,
      user: db.user,
      password: "***",
    },
    laravelEnv: snippet?.envBlockRedacted ?? null,
  };

  return {
    contents: [
      {
        uri: "devtent://site_information",
        mimeType: "application/json",
        text: JSON.stringify(payload, null, 2),
      },
    ],
  };
}

export async function buildDebugSitePrompt(ctx: McpContext) {
  const site = await resolveCurrentSite(ctx.root, ctx.sitePath);
  let dumpHint = "No SITE_PATH / site match — pass a site or set SITE_PATH.";
  let recentDumps: unknown[] = [];
  if (site) {
    dumpHint = `Current site: ${site.name} (${site.domain}).`;
    try {
      const events = await readDumpEvents(ctx.root, { tail: 20 });
      recentDumps = events.filter(
        (e) =>
          !e.site ||
          e.site === site.name ||
          (typeof e.site === "string" && e.site.includes(site.name))
      );
    } catch {
      recentDumps = [];
    }
  }

  const text = [
    "Debug the current DevTent site.",
    dumpHint,
    "",
    "Suggested steps:",
    "1. Call run_doctor (optionally with fix=true for safe repairs).",
    "2. Call get_all_sites / read site_information for URL, PHP, and SSL.",
    "3. Call get_laravel_env_snippet for DB/mail connection hints (redacted).",
    "4. Inspect recent dump events below; check Laravel storage/logs if needed.",
    "5. Use find_available_services / start_or_stop_service if a dependency is down.",
    "",
    "Recent dump events (JSON):",
    JSON.stringify(recentDumps, null, 2),
  ].join("\n");

  return {
    messages: [
      {
        role: "user" as const,
        content: { type: "text" as const, text },
      },
    ],
  };
}

/** Validate start/stop action for unit tests. */
export function validateServiceAction(action: string): action is "start" | "stop" {
  return action === "start" || action === "stop";
}

/** Validate secure/unsecure action for unit tests. */
export function validateSslAction(action: string): action is "secure" | "unsecure" {
  return action === "secure" || action === "unsecure";
}

/** Validate isolate/unisolate action for unit tests. */
export function validateIsolateAction(
  action: string
): action is "isolate" | "unisolate" {
  return action === "isolate" || action === "unisolate";
}
