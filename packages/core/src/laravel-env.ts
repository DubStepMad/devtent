import path from "node:path";
import { loadConfig, resolvePath, pathExists } from "./config.js";
import { loadProfile } from "./config.js";
import { listVirtualHosts } from "./vhosts.js";
import type { VirtualHost } from "./types.js";

export interface LaravelEnvSnippet {
  siteName: string;
  domain: string;
  lines: string[];
  envBlock: string;
}

export async function buildLaravelEnvSnippet(
  root: string,
  siteName: string
): Promise<LaravelEnvSnippet> {
  const vhosts = await listVirtualHosts(root);
  const vhost = vhosts.find((v) => v.name === siteName);
  if (!vhost) {
    throw new Error(`Site not found: ${siteName}`);
  }

  const config = await loadConfig(root);
  const profile = await loadProfile(root, config.activeProfile);
  const lines: string[] = [];
  const scheme = vhost.ssl ? "https" : "http";
  lines.push(`APP_URL=${scheme}://${vhost.domain}`);
  lines.push("");

  if (profile.database === "mysql") {
    lines.push("DB_CONNECTION=mysql");
    lines.push("DB_HOST=127.0.0.1");
    lines.push("DB_PORT=3306");
    lines.push(`DB_DATABASE=${siteName.replace(/-/g, "_")}`);
    lines.push("DB_USERNAME=root");
    lines.push("DB_PASSWORD=");
    lines.push("");
  } else if (profile.database === "mariadb") {
    lines.push("DB_CONNECTION=mysql");
    lines.push("DB_HOST=127.0.0.1");
    lines.push("DB_PORT=3307");
    lines.push(`DB_DATABASE=${siteName.replace(/-/g, "_")}`);
    lines.push("DB_USERNAME=root");
    lines.push("DB_PASSWORD=");
    lines.push("");
  } else if (profile.database === "postgresql") {
    lines.push("DB_CONNECTION=pgsql");
    lines.push("DB_HOST=127.0.0.1");
    lines.push("DB_PORT=5432");
    lines.push(`DB_DATABASE=${siteName.replace(/-/g, "_")}`);
    lines.push("DB_USERNAME=postgres");
    lines.push("DB_PASSWORD=");
    lines.push("");
  }

  const mailpitPath = resolvePath(root, "bin/mailpit/mailpit.exe");
  const profileServices = profile.services ?? [];
  if (profileServices.includes("mailpit") && (await pathExists(mailpitPath))) {
    lines.push("MAIL_MAILER=smtp");
    lines.push("MAIL_HOST=127.0.0.1");
    lines.push("MAIL_PORT=1025");
    lines.push("MAIL_USERNAME=null");
    lines.push("MAIL_PASSWORD=null");
    lines.push("MAIL_ENCRYPTION=null");
    lines.push("MAIL_FROM_ADDRESS=hello@example.com");
    lines.push(`MAIL_FROM_NAME="${siteName}"`);
    lines.push("");
    lines.push("# Mailpit web UI: http://127.0.0.1:8025");
  }

  if (profile.services?.includes("redis")) {
    lines.push("REDIS_HOST=127.0.0.1");
    lines.push("REDIS_PASSWORD=null");
    lines.push("REDIS_PORT=6379");
    lines.push("");
  }

  return {
    siteName,
    domain: vhost.domain,
    lines,
    envBlock: lines.join("\n"),
  };
}

export function formatSiteLabel(vhost: VirtualHost): string {
  if (vhost.source === "parked" && vhost.parkedFrom) {
    return `parked · ${vhost.parkedFrom}`;
  }
  if (vhost.source === "linked" && vhost.projectPath) {
    return `linked · ${vhost.projectPath}`;
  }
  return "www/";
}
