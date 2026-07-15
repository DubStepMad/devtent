/** Platform-aware binary path helpers (Windows keeps .exe; Unix does not). */

export type DevTentPlatform = "win32" | "darwin" | "linux" | "other";

export function currentPlatform(platform = process.platform): DevTentPlatform {
  if (platform === "win32" || platform === "darwin" || platform === "linux") return platform;
  return "other";
}

export function isWindows(platform = process.platform): boolean {
  return currentPlatform(platform) === "win32";
}

export function isUnix(platform = process.platform): boolean {
  const p = currentPlatform(platform);
  return p === "darwin" || p === "linux";
}

/** Append `.exe` on Windows; leave name unchanged elsewhere. */
export function binaryName(name: string, platform = process.platform): string {
  const base = name.replace(/\.exe$/i, "");
  return isWindows(platform) ? `${base}.exe` : base;
}

/** Relative path with platform-correct binary filename (forward slashes). */
export function binPath(segments: string[], platform = process.platform): string {
  if (segments.length === 0) return "";
  const parts = [...segments];
  const last = parts[parts.length - 1]!;
  parts[parts.length - 1] = binaryName(last, platform);
  return parts.join("/");
}

/** Node.js npm launcher: npm.cmd on Windows, npm elsewhere. */
export function npmLauncher(platform = process.platform): string {
  return isWindows(platform) ? "npm.cmd" : "npm";
}

/** Redis config file shipped with the Windows port vs official Redis. */
export function redisConfigPath(platform = process.platform): string {
  return isWindows(platform) ? "bin/redis/redis.windows.conf" : "bin/redis/redis.conf";
}
