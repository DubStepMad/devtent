import { loadSettings, isInitialized } from "./paths.js";
import { broadcastRefresh, setTrayRunning } from "./tray.js";

export async function maybeAutoStartServices(root: string): Promise<void> {
  const settings = await loadSettings();
  if (settings.autoStartServices !== true) return;
  if (!(await isInitialized(root))) return;

  const { startAll, getServiceStatuses } = await import("@devtent/core");
  await startAll(root);
  const running = getServiceStatuses();
  setTrayRunning(running.length > 0);
  broadcastRefresh("services");
}
