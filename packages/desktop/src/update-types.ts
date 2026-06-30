export interface UpdateInfo {
  currentVersion: string;
  latestVersion: string;
  releaseName: string;
  releaseNotes: string;
  releaseUrl: string;
  downloadUrl: string;
  publishedAt: string;
}

export type UpdateCheckResult =
  | { status: "dev"; currentVersion: string; message: string }
  | { status: "error"; currentVersion: string; message: string }
  | { status: "up-to-date"; currentVersion: string; latestVersion: string; releaseUrl: string }
  | { status: "available"; update: UpdateInfo };
