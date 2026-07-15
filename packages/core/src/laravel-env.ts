import path from "node:path";
import { loadConfig, resolvePath, pathExists } from "./config.js";
import { loadProfile } from "./config.js";
import { listVirtualHosts } from "./vhosts.js";
import { binPath } from "./platform/binary.js";
import { resolveDatabaseTargetFromProfile } from "./database-admin.js";
import type { VirtualHost } from "./types.js";

export interface LaravelEnvSnippet {
  siteName: string;
  domain: string;
  lines: string[];
  envBlock: string;
  /** Same as envBlock with secrets never interpolated — safe for terminals / logs. */
  envBlockRedacted: string;
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
  const redacted: string[] = [];
  const push = (line: string, logLine = line) => {
    lines.push(line);
    redacted.push(logLine);
  };

  const scheme = vhost.ssl ? "https" : "http";
  push(`APP_URL=${scheme}://${vhost.domain}`);
  push("");

  const db = resolveDatabaseTargetFromProfile(profile);
  if (db.engine === "mysql" || db.engine === "mariadb") {
    push("DB_CONNECTION=mysql");
    push(`DB_HOST=${db.host}`);
    push(`DB_PORT=${db.port}`);
    push(`DB_DATABASE=${siteName.replace(/-/g, "_")}`);
    push(`DB_USERNAME=${db.user}`);
    push(`DB_PASSWORD=${db.password}`, db.password ? "DB_PASSWORD=***" : "DB_PASSWORD=");
    push("");
  } else if (db.engine === "postgresql") {
    push("DB_CONNECTION=pgsql");
    push(`DB_HOST=${db.host}`);
    push(`DB_PORT=${db.port}`);
    push(`DB_DATABASE=${siteName.replace(/-/g, "_")}`);
    push(`DB_USERNAME=${db.user}`);
    push(`DB_PASSWORD=${db.password}`, db.password ? "DB_PASSWORD=***" : "DB_PASSWORD=");
    push("");
  }

  const mailpitPath = resolvePath(root, binPath(["bin", "mailpit", "mailpit"]));
  const profileServices = profile.services ?? [];
  if (profileServices.includes("mailpit") && (await pathExists(mailpitPath))) {
    push("MAIL_MAILER=smtp");
    push("MAIL_HOST=127.0.0.1");
    push("MAIL_PORT=1025");
    push("MAIL_USERNAME=null");
    push("MAIL_PASSWORD=null");
    push("MAIL_ENCRYPTION=null");
    push("MAIL_FROM_ADDRESS=hello@example.com");
    push(`MAIL_FROM_NAME="${siteName}"`);
    push("");
    push("# Mailpit web UI: http://127.0.0.1:8025");
  }

  if (profile.services?.includes("redis")) {
    push("REDIS_HOST=127.0.0.1");
    push("REDIS_PASSWORD=null");
    push("REDIS_PORT=6379");
    push("");
  }

  return {
    siteName,
    domain: vhost.domain,
    lines,
    envBlock: lines.join("\n"),
    envBlockRedacted: redacted.join("\n"),
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
