import { normalizeInstallRoot } from "@devtent/core";

export function setupCompletedForRoot(
  settings: { setupCompleted?: boolean; setupCompletedRoot?: string; root: string },
  root: string
): boolean {
  if (!settings.setupCompleted) return false;
  const completedRoot = normalizeInstallRoot(settings.setupCompletedRoot ?? settings.root);
  return completedRoot === normalizeInstallRoot(root);
}
