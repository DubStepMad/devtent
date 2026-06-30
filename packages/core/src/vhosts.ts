import { readFile, writeFile, readdir, mkdir } from "node:fs/promises";
import path from "node:path";
import { loadConfig, resolvePath, pathExists } from "./config.js";
import type { VirtualHost } from "./types.js";
import { requestElevatedHostsSync, getElevatedHostsSyncMessage, getElevatedHostsSyncFailureMessage } from "./hosts-elevate.js";

export interface HostsSyncResult {
  updated: boolean;
  requiresAdmin: boolean;
  elevationRequested?: boolean;
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

export async function discoverProjects(wwwRoot: string): Promise<string[]> {
  if (!(await pathExists(wwwRoot))) return [];

  const entries = await readdir(wwwRoot, { withFileTypes: true });
  return entries.filter((e) => e.isDirectory()).map((e) => e.name);
}

export async function generateVirtualHosts(root: string): Promise<VhostSyncResult> {
  const config = await loadConfig(root);
  const wwwRoot = resolvePath(root, config.paths.www);
  const tld = config.tld;
  const projects = await discoverProjects(wwwRoot);

  const vhosts: VirtualHost[] = projects.map((name) => ({
    name,
    domain: `${name}.${tld}`,
    root: path.join(wwwRoot, name),
    ssl: config.ssl.enabled,
  }));

  await mkdir(resolvePath(root, "etc/nginx/sites"), { recursive: true });
  await mkdir(resolvePath(root, "etc/apache/sites"), { recursive: true });

  for (const vhost of vhosts) {
    await writeNginxSite(root, vhost);
    await writeApacheSite(root, vhost);
  }

  const hosts = await syncHostsFile(vhosts, { root });

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

  const content = `# DevTent auto-generated — ${vhost.domain}
<VirtualHost *:80>
  ServerName ${vhost.domain}
  DocumentRoot "${rootPath}"
  <Directory "${rootPath}">
    AllowOverride All
    Require all granted
  </Directory>
  <FilesMatch \\.php$>
    SetHandler "proxy:fcgi://127.0.0.1:9000"
  </FilesMatch>
  ErrorLog "logs/${vhost.name}-error.log"
  CustomLog "logs/${vhost.name}-access.log" common
</VirtualHost>
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
export async function elevateHostsSync(root: string): Promise<HostsSyncResult> {
  const config = await loadConfig(root);
  const wwwRoot = resolvePath(root, config.paths.www);
  const projects = await discoverProjects(wwwRoot);
  const vhosts: VirtualHost[] = projects.map((name) => ({
    name,
    domain: `${name}.${config.tld}`,
    root: path.join(wwwRoot, name),
    ssl: config.ssl.enabled,
  }));

  return syncHostsFile(vhosts, { root, elevateOnly: true });
}

export function getHostsSyncInstructions(vhosts: VirtualHost[]): string {
  const lines = vhosts.map((v) => `127.0.0.1 ${v.domain}`).join("\n");
  return `Add these lines to your hosts file:\n\n${lines}\n\nOn Windows, use Sync Virtual Hosts in DevTent to launch an elevated prompt (DevTent itself does not need admin).`;
}
