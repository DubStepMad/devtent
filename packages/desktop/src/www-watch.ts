import { watch, existsSync, type FSWatcher } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { isInitialized } from "./paths.js";
import { broadcastRefresh, broadcastWwwChanged } from "./tray.js";

const DEBOUNCE_MS = 450;

let getRoot: () => string = () => "";
let watcher: FSWatcher | null = null;
let watchedWww: string | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let snapshot: string[] = [];
let handling = false;
let handleAgain = false;

export function setWwwWatchGetRoot(fn: () => string): void {
  getRoot = fn;
}

export function stopWwwProjectWatcher(): void {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  watcher?.close();
  watcher = null;
  watchedWww = null;
  snapshot = [];
}

export async function restartWwwProjectWatcher(): Promise<void> {
  stopWwwProjectWatcher();
  const root = getRoot();
  if (!root || !(await isInitialized(root))) return;

  const www = path.join(root, "www");
  try {
    if (!existsSync(www)) {
      await mkdir(www, { recursive: true });
    }
  } catch (err) {
    console.warn("www watch: could not ensure www/:", err);
    return;
  }

  const core = await import("@devtent/core");
  snapshot = await core.listWwwProjectNames(root);

  try {
    watcher = watch(www, () => scheduleHandle());
    watchedWww = www;
  } catch (err) {
    console.warn("www watch unavailable:", err);
  }
}

function scheduleHandle(): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    void handleWwwChange();
  }, DEBOUNCE_MS);
}

async function handleWwwChange(): Promise<void> {
  if (handling) {
    handleAgain = true;
    return;
  }
  handling = true;
  try {
    const root = getRoot();
    if (!root || !(await isInitialized(root))) return;
    const www = path.join(root, "www");
    if (watchedWww && path.resolve(www) !== path.resolve(watchedWww)) {
      await restartWwwProjectWatcher();
      return;
    }

    const core = await import("@devtent/core");
    const names = await core.listWwwProjectNames(root);
    const diff = core.diffNameLists(snapshot, names);
    if (diff.added.length === 0 && diff.removed.length === 0) return;

    const result = await core.generateVirtualHosts(root, {
      deferHostsElevation: process.platform === "win32",
    });
    snapshot = names;

    if (core.isServiceRunning("php-fpm")) {
      await core.startService(root, "php-fpm").catch(() => undefined);
    }
    if (core.isServiceRunning("nginx") || core.isServiceRunning("apache")) {
      await core.reloadWebServers(root).catch((err: unknown) => {
        console.warn("www watch: web server reload failed:", err);
      });
    }

    broadcastRefresh("sites");
    broadcastWwwChanged({ added: diff.added, removed: diff.removed, result });
  } catch (err) {
    console.warn("www watch: failed to apply project changes:", err);
  } finally {
    handling = false;
    if (handleAgain) {
      handleAgain = false;
      scheduleHandle();
    }
  }
}
