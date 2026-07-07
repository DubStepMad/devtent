export interface DevTentConfig {
  version: number;
  root: string;
  activeProfile: string;
  tld: string;
  ssl: SslConfig;
  paths: PathsConfig;
  services: Record<string, ServiceConfig>;
  sites?: SitesConfig;
}

export interface SslConfig {
  enabled: boolean;
  mkcertPath: string;
  /** Domains with generated mkcert certificates */
  domains?: string[];
}

export interface PathsConfig {
  www: string;
  bin: string;
  logs: string;
  data: string;
}

/** Parked folders (scan subdirs as sites) and linked external project paths. */
export interface SitesConfig {
  /** Absolute paths — each immediate subfolder becomes `{name}.{tld}`. */
  parked?: string[];
  linked?: LinkedSite[];
  /** Per-site PHP manifest overrides for www/parked/linked sites by name. */
  phpOverrides?: Record<string, string>;
}

export interface LinkedSite {
  name: string;
  /** Absolute path to project directory. */
  path: string;
  /** Optional per-site PHP manifest id (e.g. php-8.2) — stored for future routing. */
  phpVersion?: string;
}

export interface ServiceConfig {
  enabled: boolean;
  port?: number;
  sslPort?: number;
  binary?: string;
  config?: string;
  dataDir?: string;
}

export interface ServiceDefinition extends ServiceConfig {
  name: string;
}

export type ProfileOptionalService = "redis" | "mailpit";

export interface Profile {
  name: string;
  description?: string;
  /** Quick Add manifest id, e.g. php-8.4 */
  phpVersion?: string;
  /** CLI binary path — derived from phpVersion when saving */
  php?: string;
  webServer?: "nginx" | "apache";
  database?: "mysql" | "mariadb" | "postgresql" | "none";
  /** Optional add-on services included in this profile's Services tab */
  services?: ProfileOptionalService[];
  /** Quick Add manifest id, e.g. node-22 */
  nodeVersion?: string;
  /** Use Node from PATH (nvm, fnm, Volta, system) instead of DevTent-managed builds */
  useExternalNode?: boolean;
  /** CLI binary path — derived from nodeVersion when saving */
  node?: string;
  env?: Record<string, string>;
}

export interface VirtualHost {
  name: string;
  domain: string;
  root: string;
  ssl: boolean;
  phpVersion?: string;
  source?: "www" | "parked" | "linked";
  /** Full project directory (for open-in-folder). */
  projectPath?: string;
  /** Parked root when source is parked. */
  parkedFrom?: string;
}

export type PostInstallStep =
  | { copy: string }
  | { run: string }
  | { env: Record<string, string> };

export interface QuickAddManifest {
  name: string;
  version: string;
  description?: string;
  platform: "win32" | "linux" | "darwin" | "all";
  arch?: "x64" | "arm64" | "all";
  url: string;
  installPath: string;
  binary?: string;
  /** `zip` (default) or `exe` for single-file downloads like mkcert */
  downloadType?: "zip" | "exe";
  /** After extract, hoist a single nested folder (e.g. `pgsql` for PostgreSQL zips). */
  archiveSubdir?: string;
  postInstall?: PostInstallStep[];
}

export interface QuickAppTemplate {
  name: string;
  description: string;
  commands: string[];
  postCreate?: string[];
}

export interface ServiceStatus {
  name: string;
  running: boolean;
  pid?: number;
  port?: number;
  uptime?: number;
  startedAt?: string;
  error?: string;
}

export interface ProcfileEntry {
  name: string;
  command: string;
}

export interface DevTentState {
  root: string;
  services: ServiceStatus[];
  activeProfile: string;
  virtualHosts: VirtualHost[];
}
