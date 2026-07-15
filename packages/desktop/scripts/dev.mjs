/**
 * Dev watcher: initial build, then Electron stays up while sources change.
 * - src/ui → copy-assets (main process reloads windows)
 * - other src/*.ts → tsc + preload + restart Electron
 * - assets/logo-source.png → regenerate icons + copy + restart
 */
import { spawn, execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
process.chdir(root);

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const npx = process.platform === "win32" ? "npx.cmd" : "npx";

/** @type {import("node:child_process").ChildProcess | null} */
let electronProc = null;
let restarting = false;
/** @type {ReturnType<typeof setTimeout> | null} */
let mainTimer = null;
/** @type {ReturnType<typeof setTimeout> | null} */
let uiTimer = null;
/** @type {ReturnType<typeof setTimeout> | null} */
let iconsTimer = null;

function log(msg) {
  console.log(`[dev] ${msg}`);
}

function run(cmd, args = []) {
  execSync(cmd + (args.length ? ` ${args.join(" ")}` : ""), {
    stdio: "inherit",
    shell: true,
    cwd: root,
    env: process.env,
  });
}

function buildMain() {
  run(`${npx} tsc -p tsconfig.json`);
  run(`${npx} tsc -p tsconfig.preload.json`);
  run(`node scripts/build-preload.mjs`);
}

function copyAssets() {
  run(`${npm} run copy-assets`);
}

function generateIcons() {
  run(`${npm} run generate-icons`);
  copyAssets();
}

function killElectron() {
  if (!electronProc || electronProc.killed) {
    electronProc = null;
    return;
  }
  const proc = electronProc;
  electronProc = null;
  try {
    if (process.platform === "win32" && proc.pid) {
      spawn("taskkill", ["/pid", String(proc.pid), "/T", "/F"], {
        stdio: "ignore",
        shell: true,
        windowsHide: true,
      });
    } else {
      proc.kill("SIGTERM");
    }
  } catch {
    /* already gone */
  }
}

function startElectron() {
  killElectron();
  electronProc = spawn(npx, ["--no-install", "electron", "."], {
    stdio: "inherit",
    shell: true,
    cwd: root,
    env: { ...process.env, DEVTENT_DEV: "1" },
  });
  electronProc.on("exit", (code, signal) => {
    if (restarting) return;
    // User closed the app window/tray quit — keep watching; relaunch on next change.
    if (signal || code === 0) {
      log("Electron exited — still watching (edit a file to relaunch)");
    } else {
      log(`Electron exited with code ${code} — still watching`);
    }
    electronProc = null;
  });
}

function restartElectron() {
  restarting = true;
  startElectron();
  // Allow exit handler to treat subsequent deaths as user closes again
  setTimeout(() => {
    restarting = false;
  }, 1500);
}

function scheduleMainRebuild() {
  if (mainTimer) clearTimeout(mainTimer);
  mainTimer = setTimeout(() => {
    log("rebuilding main/preload…");
    try {
      buildMain();
      restartElectron();
      log("restarted Electron");
    } catch {
      log("main rebuild failed — fix errors, save again");
    }
  }, 350);
}

function scheduleUiCopy() {
  if (uiTimer) clearTimeout(uiTimer);
  uiTimer = setTimeout(() => {
    log("copying UI…");
    try {
      copyAssets();
      log("UI updated (window will reload)");
    } catch {
      log("UI copy failed");
    }
  }, 150);
}

function scheduleIcons() {
  if (iconsTimer) clearTimeout(iconsTimer);
  iconsTimer = setTimeout(() => {
    log("regenerating icons…");
    try {
      generateIcons();
      restartElectron();
      log("icons updated + Electron restarted");
    } catch {
      log("icon generation failed");
    }
  }, 400);
}

function norm(file) {
  return file.replace(/\\/g, "/");
}

function onSrcChange(filename) {
  if (!filename) return;
  const f = norm(filename);
  if (f.endsWith(".test.ts")) return;
  if (f.startsWith("ui/") || f.includes("/ui/")) {
    scheduleUiCopy();
    return;
  }
  if (f.endsWith(".ts") || f.endsWith(".tsx")) {
    scheduleMainRebuild();
  }
}

function onAssetsChange(filename) {
  if (!filename) return;
  const f = norm(filename);
  if (f.includes("logo-source") || f === "logo-source.png") {
    scheduleIcons();
  }
}

log("initial build…");
run(`${npm} run build`);
log("starting Electron (watching for changes — Ctrl+C to stop)");
startElectron();

const srcDir = path.join(root, "src");
const assetsDir = path.join(root, "assets");

try {
  fs.watch(srcDir, { recursive: true }, (_event, filename) => onSrcChange(filename ?? ""));
} catch (err) {
  console.error("[dev] could not watch src:", err);
  process.exit(1);
}

if (fs.existsSync(assetsDir)) {
  try {
    fs.watch(assetsDir, { recursive: true }, (_event, filename) =>
      onAssetsChange(filename ?? "")
    );
  } catch (err) {
    console.warn("[dev] could not watch assets:", err);
  }
}

function shutdown() {
  log("shutting down…");
  killElectron();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
