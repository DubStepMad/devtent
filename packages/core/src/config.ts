import { mkdir, readFile, writeFile, access, readdir, copyFile, unlink } from "node:fs/promises";
import { constants } from "node:fs";
import os from "node:os";
import path from "node:path";
import { parse as parseToml, stringify as stringifyToml } from "smol-toml";
import type { DevTentConfig, Profile, ServiceDefinition } from "./types.js";
import { DEFAULT_PHP_VERSION, normalizeProfile } from "./profile-runtime.js";

export const CONFIG_FILENAME = "devtent.toml";
export const DEFAULT_PROFILE = "default";

export const DEFAULT_DIRS = [
  "bin",
  "www",
  "etc/nginx/sites",
  "etc/apache/sites",
  "etc/ssl",
  "data/mysql",
  "data/postgresql",
  "logs",
  "profiles",
  "tmp",
] as const;

/** Portable default: {drive}:\devtent on Windows, ~/devtent elsewhere. */
export function getDefaultInstallRoot(preferredPath?: string): string {
  if (process.platform === "win32") {
    const drive = preferredPath
      ? path.parse(preferredPath).root
      : path.parse(process.env.SystemDrive ?? "C:").root;
    return path.join(drive, "devtent");
  }
  return path.join(os.homedir(), "devtent");
}

/** Avoid bare drive roots (e.g. P:\\) — mkdir fails with EPERM on Windows. */
export function normalizeInstallRoot(root: string): string {
  const resolved = path.resolve(root);
  if (process.platform === "win32") {
    const parsed = path.parse(resolved);
    if (parsed.root && !parsed.base) {
      return path.join(parsed.root, "devtent");
    }
  }
  return resolved;
}

export function getDefaultConfig(root: string): DevTentConfig {
  return {
    version: 1,
    root,
    activeProfile: DEFAULT_PROFILE,
    tld: "test",
    ssl: { enabled: false, mkcertPath: "bin/mkcert/mkcert.exe" },
    paths: {
      www: "www",
      bin: "bin",
      logs: "logs",
      data: "data",
    },
    services: {
      nginx: {
        enabled: true,
        port: 80,
        sslPort: 443,
        binary: "bin/nginx/nginx.exe",
        config: "etc/nginx/nginx.conf",
      },
      mysql: {
        enabled: true,
        port: 3306,
        binary: "bin/mysql/bin/mysqld.exe",
        dataDir: "data/mysql",
      },
    },
  };
}

export function resolvePath(root: string, relative: string): string {
  return path.isAbsolute(relative) ? relative : path.join(root, relative);
}

export async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function loadConfig(root: string): Promise<DevTentConfig> {
  const configPath = path.join(root, CONFIG_FILENAME);
  if (!(await pathExists(configPath))) {
    throw new Error(`DevTent not initialized at ${root}. Run: devtent init ${root}`);
  }
  const raw = await readFile(configPath, "utf-8");
  return parseToml(raw) as unknown as DevTentConfig;
}

export async function saveConfig(root: string, config: DevTentConfig): Promise<void> {
  const configPath = path.join(root, CONFIG_FILENAME);
  await writeFile(configPath, stringifyToml(config as unknown as Record<string, unknown>), "utf-8");
}

export async function initDevTent(
  root: string,
  onProgress?: (msg: string, percent?: number) => void
): Promise<DevTentConfig> {
  root = normalizeInstallRoot(root);
  const report = (msg: string, percent?: number) => onProgress?.(msg, percent);

  const configPath = path.join(root, CONFIG_FILENAME);
  if (await pathExists(configPath)) {
    report("Environment already initialized", 45);
    return loadConfig(root);
  }

  report("Creating environment folders…", 8);
  await mkdir(root, { recursive: true });

  const dirs = DEFAULT_DIRS.length;
  for (let i = 0; i < DEFAULT_DIRS.length; i++) {
    const dir = DEFAULT_DIRS[i]!;
    await mkdir(path.join(root, dir), { recursive: true });
    const pct = 10 + Math.round(((i + 1) / dirs) * 22);
    report(`Created ${dir}/`, pct);
  }

  report("Writing configuration…", 36);
  const config = getDefaultConfig(root);

  if (!(await pathExists(configPath))) {
    await saveConfig(root, config);
  }

  const defaultProfile = getDefaultProfile();
  const profilePath = path.join(root, "profiles", `${DEFAULT_PROFILE}.toml`);
  if (!(await pathExists(profilePath))) {
    await saveProfile(root, defaultProfile);
  }

  await writeDefaultNginxConf(root);
  await writeDefaultApacheConf(root);
  await writeDefaultProcfile(root);
  await writeReadme(root);

  report("Environment ready", 45);
  return config;
}

function getDefaultProfile(): Profile {
  return normalizeProfile({
    name: DEFAULT_PROFILE,
    description: "Default PHP + Nginx + MySQL stack",
    phpVersion: DEFAULT_PHP_VERSION,
    webServer: "nginx",
    database: "mysql",
  });
}

export async function saveProfile(root: string, profile: Profile): Promise<void> {
  const normalized = normalizeProfile(profile);
  const profilePath = path.join(root, "profiles", `${normalized.name}.toml`);
  await writeFile(
    profilePath,
    stringifyToml(normalized as unknown as Record<string, unknown>),
    "utf-8"
  );
}

export async function loadProfile(root: string, name: string): Promise<Profile> {
  const profilePath = path.join(root, "profiles", `${name}.toml`);
  if (!(await pathExists(profilePath))) {
    throw new Error(`Profile "${name}" not found`);
  }
  const raw = await readFile(profilePath, "utf-8");
  return normalizeProfile(parseToml(raw) as unknown as Profile);
}

export async function listProfiles(root: string): Promise<Profile[]> {
  const profilesDir = path.join(root, "profiles");
  if (!(await pathExists(profilesDir))) return [];

  const files = await readdir(profilesDir);
  const profiles: Profile[] = [];

  for (const file of files) {
    if (!file.endsWith(".toml")) continue;
    const name = file.replace(/\.toml$/, "");
    profiles.push(await loadProfile(root, name));
  }

  return profiles;
}

export async function switchProfile(root: string, name: string): Promise<Profile> {
  const profile = await loadProfile(root, name);
  const config = await loadConfig(root);
  config.activeProfile = name;
  await saveConfig(root, config);
  const { syncProfileProcfileFromProfile } = await import("./profile-procfile.js");
  await syncProfileProcfileFromProfile(root);
  return profile;
}

export interface CreateProfileInput {
  name: string;
  description?: string;
  phpVersion?: string;
  webServer?: Profile["webServer"];
  database?: Profile["database"];
}

export async function createProfile(root: string, input: CreateProfileInput): Promise<Profile> {
  const name = input.name.trim();
  if (!name) throw new Error("Profile name is required");
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(name)) {
    throw new Error("Profile name must start with a letter or number and contain only letters, numbers, _ or -");
  }

  const profilePath = path.join(root, "profiles", `${name}.toml`);
  if (await pathExists(profilePath)) {
    throw new Error(`Profile "${name}" already exists`);
  }

  const profile = normalizeProfile({
    name,
    description: input.description,
    phpVersion: input.phpVersion ?? DEFAULT_PHP_VERSION,
    webServer: input.webServer ?? "nginx",
    database: input.database ?? "mysql",
  });
  await saveProfile(root, profile);
  return profile;
}

export interface UpdateProfileInput {
  description?: string;
  phpVersion?: string;
  webServer?: Profile["webServer"];
  database?: Profile["database"];
}

export async function updateProfile(
  root: string,
  name: string,
  patch: UpdateProfileInput
): Promise<Profile> {
  const current = await loadProfile(root, name);
  const profile = normalizeProfile({
    ...current,
    ...patch,
    name,
  });
  await saveProfile(root, profile);

  const config = await loadConfig(root);
  if (config.activeProfile === name) {
    const { syncProfileProcfileFromProfile } = await import("./profile-procfile.js");
    await syncProfileProcfileFromProfile(root);
  }

  return profile;
}

export async function deleteProfile(root: string, name: string): Promise<void> {
  const config = await loadConfig(root);
  if (config.activeProfile === name) {
    throw new Error("Cannot delete the active profile — switch to another profile first");
  }

  const profiles = await listProfiles(root);
  if (profiles.length <= 1) {
    throw new Error("Cannot delete the last profile");
  }

  const profilePath = path.join(root, "profiles", `${name}.toml`);
  if (!(await pathExists(profilePath))) {
    throw new Error(`Profile "${name}" not found`);
  }
  await unlink(profilePath);
}

export async function applyPhpVersionToActiveProfile(
  root: string,
  phpVersion: string
): Promise<Profile> {
  const config = await loadConfig(root);
  return updateProfile(root, config.activeProfile, { phpVersion });
}

async function writeDefaultNginxConf(root: string): Promise<void> {
  const nginxConf = path.join(root, "etc/nginx/nginx.conf");
  if (await pathExists(nginxConf)) return;

  const content = `# DevTent — auto-generated nginx config
worker_processes 1;
error_log logs/nginx-error.log;
pid tmp/nginx.pid;

events {
  worker_connections 1024;
}

http {
  include       mime.types;
  default_type  application/octet-stream;
  sendfile      on;
  keepalive_timeout 65;
  client_max_body_size 128m;

  server {
    listen 80 default_server;
    server_name localhost;
    root www;
    index index.php index.html;

    location / {
      try_files $uri $uri/ /index.php?$query_string;
    }

    location ~ \\.php$ {
      fastcgi_pass 127.0.0.1:9000;
      fastcgi_index index.php;
      fastcgi_param SCRIPT_FILENAME $document_root$fastcgi_script_name;
      include fastcgi_params;
    }
  }

  include sites/*.conf;
}
`;
  await writeFile(nginxConf, content, "utf-8");
}

async function writeDefaultApacheConf(root: string): Promise<void> {
  const apacheConf = path.join(root, "etc/apache/httpd.conf");
  if (await pathExists(apacheConf)) return;

  const content = `# DevTent — auto-generated Apache config
Define SRVROOT "bin/apache"
ServerRoot "\${SRVROOT}"
Listen 80

LoadModule access_compat_module modules/mod_access_compat.so
LoadModule actions_module modules/mod_actions.so
LoadModule alias_module modules/mod_alias.so
LoadModule auth_basic_module modules/mod_auth_basic.so
LoadModule authn_core_module modules/mod_authn_core.so
LoadModule authz_core_module modules/mod_authz_core.so
LoadModule authz_host_module modules/mod_authz_host.so
LoadModule autoindex_module modules/mod_autoindex.so
LoadModule dir_module modules/mod_dir.so
LoadModule env_module modules/mod_env.so
LoadModule log_config_module modules/mod_log_config.so
LoadModule mime_module modules/mod_mime.so
LoadModule proxy_module modules/mod_proxy.so
LoadModule proxy_fcgi_module modules/mod_proxy_fcgi.so
LoadModule rewrite_module modules/mod_rewrite.so
LoadModule setenvif_module modules/mod_setenvif.so

PidFile tmp/apache.pid
ErrorLog logs/apache-error.log
LogLevel warn

<Directory />
  AllowOverride none
  Require all denied
</Directory>

DocumentRoot "www"
<Directory "www">
  Options Indexes FollowSymLinks
  AllowOverride All
  Require all granted
</Directory>

DirectoryIndex index.php index.html
TypesConfig conf/mime.types

<FilesMatch \\.php$>
  SetHandler "proxy:fcgi://127.0.0.1:9000"
</FilesMatch>

Include etc/apache/sites/*.conf
`;
  await writeFile(apacheConf, content, "utf-8");
}

async function writeDefaultProcfile(root: string): Promise<void> {
  const procfilePath = path.join(root, "Procfile");
  if (await pathExists(procfilePath)) return;

  const content = `# DevTent Procfile — one service per line
# Format: name: command
# Uncomment after installing runtimes via quick-add

# nginx: bin/nginx/nginx.exe -p . -c etc/nginx/nginx.conf
# mysql: bin/mysql/bin/mysqld.exe --defaults-file=etc/mysql/my.ini
# php-fpm: bin/php/php-8.3/php-cgi.exe -b 127.0.0.1:9000
`;
  await writeFile(procfilePath, content, "utf-8");
}

async function writeReadme(root: string): Promise<void> {
  const readmePath = path.join(root, "www", "index.html");
  if (await pathExists(readmePath)) return;

  const content = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>DevTent</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: system-ui, sans-serif; background: #0f172a; color: #e2e8f0; min-height: 100vh; display: flex; align-items: center; justify-content: center; }
    .card { background: #1e293b; border-radius: 12px; padding: 2.5rem; max-width: 520px; text-align: center; border: 1px solid #334155; }
    h1 { font-size: 2rem; margin-bottom: 0.5rem; color: #38bdf8; }
    p { color: #94a3b8; line-height: 1.6; margin-bottom: 1rem; }
    code { background: #0f172a; padding: 0.2rem 0.5rem; border-radius: 4px; font-size: 0.9rem; }
    .badge { display: inline-block; background: #166534; color: #86efac; padding: 0.25rem 0.75rem; border-radius: 999px; font-size: 0.75rem; margin-bottom: 1rem; }
  </style>
</head>
<body>
  <div class="card">
    <div class="badge">DTCL v1.0 · Free · Not For Sale</div>
    <h1>⛺ DevTent</h1>
    <p>Your open-source local dev environment is running.</p>
    <p>Drop projects into <code>www/</code> and run <code>devtent vhost sync</code> for pretty URLs like <code>myapp.test</code>.</p>
    <p><a href="https://github.com/DubStepMad/devtent" style="color:#38bdf8">Contribute on GitHub →</a></p>
  </div>
</body>
</html>
`;
  await writeFile(readmePath, content, "utf-8");
}

export function getActiveServices(config: DevTentConfig): ServiceDefinition[] {
  return Object.entries(config.services)
    .filter(([, svc]) => svc.enabled)
    .map(([name, svc]) => ({ name, ...svc }));
}

export async function copyTemplateFile(src: string, dest: string): Promise<void> {
  await mkdir(path.dirname(dest), { recursive: true });
  await copyFile(src, dest);
}
