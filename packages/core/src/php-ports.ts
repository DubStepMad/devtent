const DEFAULT_PHP_VERSION = "php-8.3";

/** Deterministic FastCGI port per PHP manifest (9082, 9083, 9084, …). */
export function resolvePhpCgiPort(phpVersion: string): number {
  const match = phpVersion.match(/^php-(\d+)\.(\d+)/i);
  if (match) {
    return 9000 + Number.parseInt(match[1]!, 10) * 10 + Number.parseInt(match[2]!, 10);
  }
  return 9000;
}

export function phpCgiProcfileName(phpVersion: string): string {
  const suffix = phpVersion.replace(/^php-/i, "");
  return `php-cgi-${suffix}`;
}

export function phpVersionFromProcfileName(name: string): string | undefined {
  if (name === "php-fpm") return undefined;
  const match = name.match(/^php-cgi-(.+)$/);
  return match ? `php-${match[1]}` : undefined;
}

export function resolvePhpVersionForVhost(
  phpVersion: string | undefined,
  fallback = DEFAULT_PHP_VERSION
): string {
  return phpVersion ?? fallback;
}
