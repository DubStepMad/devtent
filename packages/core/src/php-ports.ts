import { binaryName, isUnix } from "./platform/binary.js";

const DEFAULT_PHP_VERSION = "php-8.3";

/** Deterministic FastCGI port per PHP manifest (9082, 9083, 9084, …). */
export function resolvePhpCgiPort(phpVersion: string): number {
  const match = phpVersion.match(/^php-(\d+)\.(\d+)/i);
  if (match) {
    return 9000 + Number.parseInt(match[1]!, 10) * 10 + Number.parseInt(match[2]!, 10);
  }
  return 9000;
}

/** Windows CGI service name (kept for backwards compatibility). */
export function phpCgiProcfileName(phpVersion: string): string {
  const suffix = phpVersion.replace(/^php-/i, "");
  return `php-cgi-${suffix}`;
}

/** Unix FPM service name. */
export function phpFpmProcfileName(phpVersion: string): string {
  const suffix = phpVersion.replace(/^php-/i, "");
  return `php-fpm-${suffix}`;
}

/** Platform-correct Procfile service name for a PHP version. */
export function phpProcfileName(phpVersion: string, platform = process.platform): string {
  return isUnix(platform) ? phpFpmProcfileName(phpVersion) : phpCgiProcfileName(phpVersion);
}

export function phpVersionFromProcfileName(name: string): string | undefined {
  if (name === "php-fpm") return undefined;
  const cgi = name.match(/^php-cgi-(.+)$/);
  if (cgi) return `php-${cgi[1]}`;
  const fpm = name.match(/^php-fpm-(.+)$/);
  if (fpm) return `php-${fpm[1]}`;
  return undefined;
}

export function resolvePhpVersionForVhost(
  phpVersion: string | undefined,
  fallback = DEFAULT_PHP_VERSION
): string {
  return phpVersion ?? fallback;
}

export type PhpBackendKind = "cgi" | "fpm";

export function phpBackendKind(platform = process.platform): PhpBackendKind {
  return isUnix(platform) ? "fpm" : "cgi";
}

/** Relative path to the PHP FastCGI binary for this platform. */
export function phpFastcgiBinaryRel(
  phpVersion: string,
  platform = process.platform
): string {
  const base = `bin/php/${phpVersion}`;
  if (isUnix(platform)) {
    return `${base}/sbin/php-fpm`;
  }
  return `${base}/${binaryName("php-cgi", platform)}`;
}
