let pendingInstallerPath: string | null = null;
export function queueInstallerLaunch(installerPath: string): void {
  pendingInstallerPath = installerPath;
}

export function takePendingInstallerPath(): string | null {
  const path = pendingInstallerPath;
  pendingInstallerPath = null;
  return path;
}
