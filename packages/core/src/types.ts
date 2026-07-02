export interface DevTentConfig {
  version: number;
  root: string;
  activeProfile: string;
  tld: string;
  ssl: SslConfig;
  paths: PathsConfig;
  services: Record<string, ServiceConfig>;
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
  database?: "mysql" | "postgresql" | "none";
  /** Optional add-on services included in this profile's Services tab */
  services?: ProfileOptionalService[];
  /** Quick Add manifest id, e.g. node-22 */
  nodeVersion?: string;
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
