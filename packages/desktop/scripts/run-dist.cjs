"use strict";

const { execSync, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const projectDir = path.join(__dirname, "..");
const releaseDir = path.join(projectDir, "release");
const winUnpacked = path.join(releaseDir, "win-unpacked");
const fallbackOutput = path.join(projectDir, "release-build");

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function killDevTent() {
  for (const image of ["DevTent.exe", "electron.exe"]) {
    try {
      execSync(`taskkill /F /IM ${image} /FI "USERNAME eq %USERNAME%"`, {
        stdio: "ignore",
        shell: true,
      });
    } catch {
      // Not running
    }
  }
}

function tryRemoveDir(dir) {
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
      return true;
    } catch {
      if (attempt < 5) sleep(400 * attempt);
    }
  }
  return !fs.existsSync(dir);
}

function copyInstallers(fromDir, toDir) {
  fs.mkdirSync(toDir, { recursive: true });
  for (const name of fs.readdirSync(fromDir)) {
    if (!/^DevTent( Setup .+|\.Setup\.\d+\.\d+\.\d+)\.exe(\.blockmap)?$/i.test(name)) continue;
    fs.copyFileSync(path.join(fromDir, name), path.join(toDir, name));
    console.log(`Copied ${name} → release/`);
  }
}

function resolveElectronBuilderCli() {
  const candidates = [
    path.join(projectDir, "node_modules", "electron-builder", "cli.js"),
    path.join(projectDir, "..", "..", "node_modules", "electron-builder", "cli.js"),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error("electron-builder not found — run npm install from the repo root.");
}

function runElectronBuilder(outputDir) {
  const outputName = path.basename(outputDir);
  const builderCli = resolveElectronBuilderCli();
  const args = [builderCli, "--win", `--config.directories.output=${outputName}`];

  const result = spawnSync(process.execPath, args, {
    cwd: projectDir,
    stdio: "inherit",
  });

  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }

  return outputDir;
}

function pickOutputDir() {
  killDevTent();
  sleep(500);

  if (tryRemoveDir(winUnpacked)) {
    return releaseDir;
  }

  if (tryRemoveDir(fallbackOutput)) {
    console.warn("");
    console.warn("Could not clear release/win-unpacked (file in use).");
    console.warn("Using release-build/ for this build.");
    console.warn("");
    return fallbackOutput;
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const uniqueOutput = path.join(projectDir, `release-${stamp}`);
  console.warn("");
  console.warn("release/ and release-build/ are locked (app.asar in use).");
  console.warn(`Using ${path.basename(uniqueOutput)}/ for this build.`);
  console.warn("Close DevTent, Explorer windows, or your IDE preview of release/ and retry.");
  console.warn("");
  return uniqueOutput;
}

function main() {
  execSync("node scripts/ensure-eb-nsis.cjs", { cwd: projectDir, stdio: "inherit" });

  const outputDir = pickOutputDir();
  runElectronBuilder(outputDir);

  if (outputDir !== releaseDir) {
    copyInstallers(outputDir, releaseDir);
  }
}

main();
