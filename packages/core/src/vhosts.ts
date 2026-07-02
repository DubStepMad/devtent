import { readFile, writeFile, readdir, mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { loadConfig, resolvePath, pathExists } from "./config.js";
import type { VirtualHost } from "./types.js";
import { apachePhpHandlerBlock, ensureApacheConfig } from "./apache-support.js";
import { hasSslCertificate } from "./ssl.js";
import { requestElevatedHostsSync, prepareHostsSyncFiles, getElevatedHostsSyncMessage, getElevatedHostsSyncFailureMessage } from "./hosts-elevate.js";

export interface HostsSyncResult {
  updated: boolean;
  requiresAdmin: boolean;
  hostsCurrent?: boolean;
  elevationRequested?: boolean;
  elevationPending?: boolean;
  elevationLaunchFailed?: boolean;
  hostsHelperPath?: string;
  message?: string;
}

export interface VhostSyncResult {
  vhosts: VirtualHost[];
  hosts: HostsSyncResult;
}

export interface HostsSyncOptions {
  root?: string;
  /** When true, skip direct write and only launch the elevated helper (Windows). */
  elevateOnly?: boolean;
  /** When true, prepare the helper script but do not launch UAC (desktop shows a dialog first). */
  deferElevation?: boolean;
}

const MARKER_START = "# devtent-start";
const MARKER_END = "# devtent-end";

export function getHostsFilePath(): string {
  return process.platform === "win32"
    ? "C:\\Windows\\System32\\drivers\\etc\\hosts"
    : "/etc/hosts";
}

export function buildHostsContent(existingContent: string, vhosts: VirtualHost[]): string {
  const block = [
    MARKER_START,
    ...vhosts.map((v) => `127.0.0.1 ${v.domain}`),
    MARKER_END,
  ].join("\n");

  const startIdx = existingContent.indexOf(MARKER_START);
  const endIdx = existingContent.indexOf(MARKER_END);

  if (startIdx !== -1 && endIdx !== -1) {
    return existingContent.slice(0, startIdx) + block + existingContent.slice(endIdx + MARKER_END.length);
  }

  return existingContent.trimEnd() + "\n\n" + block + "\n";
}

function normalizeHostsContent(content: string): string {
  return content.replace(/\r\n/g, "\n").trimEnd();
}

function hostsContentMatches(a: string, b: string): boolean {
  return normalizeHostsContent(a) === normalizeHostsContent(b);
}

export async function discoverProjects(wwwRoot: string): Promise<string[]> {
  if (!(await pathExists(wwwRoot))) return [];

  const entries = await readdir(wwwRoot, { withFileTypes: true });
  return entries.filter((e) => e.isDirectory()).map((e) => e.name);
}

async function isDirectory(dirPath: string): Promise<boolean> {
  try {
    return (await stat(dirPath)).isDirectory();
  } catch {
    return false;
  }
}

/** Laragon-style web root: Laravel/Symfony public/ (or web/) when present. */
export async function resolveProjectWebRoot(projectDir: string): Promise<string> {
  const publicDir = path.join(projectDir, "public");
  if (await isDirectory(publicDir)) {
    return publicDir;
  }

  const webDir = path.join(projectDir, "web");
  if ((await isDirectory(webDir)) && (await pathExists(path.join(webDir, "index.php")))) {
    return webDir;
  }

  return projectDir;
}

/** List projects under www/ as virtual hosts without writing configs or syncing hosts. */
export async function listVirtualHosts(root: string): Promise<VirtualHost[]> {
  const config = await loadConfig(root);
  const wwwRoot = resolvePath(root, config.paths.www);
  const projects = await discoverProjects(wwwRoot);
  const vhosts: VirtualHost[] = [];

  for (const name of projects) {
    const projectDir = path.join(wwwRoot, name);
    const domain = `${name}.${config.tld}`;
    vhosts.push({
      name,
      domain,
      root: await resolveProjectWebRoot(projectDir),
      ssl: await hasSslCertificate(root, domain),
    });
  }

  return vhosts;
}

export async function generateVirtualHosts(
  root: string,
  options?: { deferHostsElevation?: boolean; skipHostsSync?: boolean }
): Promise<VhostSyncResult> {
  const vhosts = await listVirtualHosts(root);

  await mkdir(resolvePath(root, "etc/nginx/sites"), { recursive: true });
  await mkdir(resolvePath(root, "etc/apache/sites"), { recursive: true });

  if (vhosts.some((v) => v.ssl)) {
    await ensureApacheConfig(root);
  }

  for (const vhost of vhosts) {
    await writeNginxSite(root, vhost);
    await writeApacheSite(root, vhost);
  }

  const hosts = options?.skipHostsSync
    ? { updated: false, requiresAdmin: false }
    : await syncHostsFile(vhosts, {
        root,
        deferElevation: options?.deferHostsElevation,
      });

  return { vhosts, hosts };
}

async function writeNginxSite(root: string, vhost: VirtualHost): Promise<void> {
  const sitePath = path.join(root, "etc/nginx/sites", `${vhost.name}.conf`);
  const rootPath = vhost.root.replace(/\\/g, "/");

  const sslBlock = vhost.ssl
    ? `
  listen 443 ssl;
  ssl_certificate etc/ssl/${vhost.domain}.pem;
  ssl_certificate_key etc/ssl/${vhost.domain}-key.pem;`
    : "";

  const content = `# DevTent auto-generated — ${vhost.domain}
server {
  listen 80;
  server_name ${vhost.domain};${sslBlock}
  root "${rootPath}";
  index index.php index.html index.htm;

  location / {
    try_files $uri $uri/ /index.php?$query_string;
  }

  location ~ \\.php$ {
    fastcgi_pass 127.0.0.1:9000;
    fastcgi_index index.php;
    fastcgi_param SCRIPT_FILENAME $document_root$fastcgi_script_name;
    include fastcgi_params;
  }

  access_log logs/${vhost.name}-access.log;
  error_log logs/${vhost.name}-error.log;
}
`;
  await writeFile(sitePath, content, "utf-8");
}

async function writeApacheSite(root: string, vhost: VirtualHost): Promise<void> {
  const sitePath = path.join(root, "etc/apache/sites", `${vhost.name}.conf`);
  const rootPath = vhost.root.replace(/\\/g, "/");

  const sslBlock = vhost.ssl
    ? `
<VirtualHost *:443>
  ServerName ${vhost.domain}
  DocumentRoot "${rootPath}"
  SSLEngine on
  SSLCertificateFile "etc/ssl/${vhost.domain}.pem"
  SSLCertificateKeyFile "etc/ssl/${vhost.domain}-key.pem"
  <Directory "${rootPath}">
    Options -Indexes +FollowSymLinks
    AllowOverride All
    Require all granted
  </Directory>
  ${apachePhpHandlerBlock()}
  ErrorLog "logs/${vhost.name}-ssl-error.log"
  CustomLog "logs/${vhost.name}-ssl-access.log" common
</VirtualHost>`
    : "";

  const content = `# DevTent auto-generated — ${vhost.domain}
<VirtualHost *:80>
  ServerName ${vhost.domain}
  DocumentRoot "${rootPath}"
  <Directory "${rootPath}">
    Options -Indexes +FollowSymLinks
    AllowOverride All
    Require all granted
  </Directory>
  ${apachePhpHandlerBlock()}
  ErrorLog "logs/${vhost.name}-error.log"
  CustomLog "logs/${vhost.name}-access.log" common
</VirtualHost>${sslBlock}
`;
  await writeFile(sitePath, content, "utf-8");
}

async function readHostsFileContent(): Promise<string | null> {
  try {
    return await readFile(getHostsFilePath(), "utf-8");
  } catch {
    return null;
  }
}

export async function syncHostsFile(
  vhosts: VirtualHost[],
  options?: HostsSyncOptions
): Promise<HostsSyncResult> {
  const hostsPath = getHostsFilePath();
  const existing = await readHostsFileContent();

  if (existing === null) {
    return launchOrInstruct(vhosts, options, buildHostsContent("", vhosts));
  }

  const newContent = buildHostsContent(existing, vhosts);

  if (!options?.elevateOnly && hostsContentMatches(existing, newContent)) {
    return { updated: false, requiresAdmin: false, hostsCurrent: true };
  }

  if (options?.elevateOnly) {
    return launchOrInstruct(vhosts, options, newContent);
  }

  try {
    await writeFile(hostsPath, newContent, "utf-8");
    return { updated: true, requiresAdmin: false };
  } catch {
    return launchOrInstruct(vhosts, options, newContent);
  }
}

async function launchOrInstruct(
  vhosts: VirtualHost[],
  options: HostsSyncOptions | undefined,
  newContent: string
): Promise<HostsSyncResult> {
  if (process.platform === "win32" && options?.root && newContent) {
    if (options.deferElevation) {
      const { batchFile } = await prepareHostsSyncFiles(options.root, newContent);
      return {
        updated: false,
        requiresAdmin: true,
        elevationPending: true,
        hostsHelperPath: batchFile,
        message: getElevatedHostsSyncMessage(batchFile),
      };
    }

    const { launched, batchFile } = await requestElevatedHostsSync(options.root, newContent);
    if (launched) {
      return {
        updated: false,
        requiresAdmin: true,
        elevationRequested: true,
        hostsHelperPath: batchFile,
        message: getElevatedHostsSyncMessage(batchFile),
      };
    }

    return {
      updated: false,
      requiresAdmin: true,
      elevationLaunchFailed: true,
      hostsHelperPath: batchFile,
      message: getElevatedHostsSyncFailureMessage(batchFile),
    };
  }

  return {
    updated: false,
    requiresAdmin: true,
    message: getHostsSyncInstructions(vhosts),
  };
}

/** Re-run hosts sync using only the elevated CMD helper (Windows). */
export async function elevateHostsSync(
  root: string,
  options?: { deferElevation?: boolean }
): Promise<HostsSyncResult> {
  const vhosts = await listVirtualHosts(root);
  return syncHostsFile(vhosts, { root, elevateOnly: true, deferElevation: options?.deferElevation });
}

export function getHostsSyncInstructions(vhosts: VirtualHost[]): string {
  const lines = vhosts.map((v) => `127.0.0.1 ${v.domain}`).join("\n");
  return `Add these lines to your hosts file:\n\n${lines}\n\nOn Windows, use Sync Virtual Hosts in DevTent to launch an elevated prompt (DevTent itself does not need admin).`;
}
