#!/usr/bin/env node
/**
 * Capture README screenshots with fictional demo data.
 * Usage: node packages/desktop/scripts/capture-screenshots.mjs
 */
import { createServer } from "node:http";
import { readFile, mkdir, access } from "node:fs/promises";
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uiDir = path.resolve(__dirname, "../src/ui");
const assetsDir = path.resolve(__dirname, "../assets");
const outDir = path.resolve(__dirname, "../../../docs/screenshots");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

function contentType(filePath) {
  return MIME[path.extname(filePath).toLowerCase()] ?? "application/octet-stream";
}

async function ensureAppIcon() {
  const icon128 = path.join(assetsDir, "icon-128.png");
  try {
    await access(icon128);
    return icon128;
  } catch {
    console.log("Generating app icons…");
    execSync("npm run generate-icons", {
      cwd: path.resolve(__dirname, ".."),
      stdio: "inherit",
    });
    return icon128;
  }
}

async function readStaticFile(root, urlPath, appIconPath) {
  const rel = urlPath === "/" ? "/screenshot-demo.html" : urlPath;
  const filePath = path.normalize(path.join(root, rel.replace(/^\//, "")));
  if (!filePath.startsWith(root)) {
    throw new Error("Forbidden");
  }
  try {
    return await readFile(filePath);
  } catch {
    const base = path.basename(rel);
    if (base === "app-icon.png") {
      return await readFile(appIconPath);
    }
    throw new Error("Not found");
  }
}

function startStaticServer(root, appIconPath) {
  return new Promise((resolve) => {
    const server = createServer(async (req, res) => {
      try {
        const urlPath = decodeURIComponent((req.url ?? "/").split("?")[0]);
        const data = await readStaticFile(root, urlPath, appIconPath);
        const servedPath =
          urlPath === "/" ? "/screenshot-demo.html" : urlPath;
        const extPath = servedPath.endsWith("app-icon.png")
          ? appIconPath
          : path.join(root, servedPath.replace(/^\//, ""));
        res.writeHead(200, { "Content-Type": contentType(extPath) });
        res.end(data);
      } catch {
        res.writeHead(404);
        res.end("Not found");
      }
    });
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

async function loadPlaywright() {
  const { chromium } = await import("playwright");
  return { chromium };
}

async function switchView(page, view) {
  await page.locator(`.nav-item[data-view="${view}"]`).click({ force: true });
  await page.evaluate((viewName) => {
    document.querySelectorAll(".view-panel").forEach((p) => p.classList.add("hidden"));
    document.getElementById(`view-${viewName}`)?.classList.remove("hidden");
    document.querySelectorAll(".nav-item").forEach((n) => {
      n.classList.toggle("active", n.dataset.view === viewName);
    });
  }, view);
  await page.waitForTimeout(600);
}
const MAIN_VIEWS = [
  { file: "dashboard.png", view: "dashboard", wait: "#view-dashboard:not(.hidden) #health-list .health-item" },
  { file: "projects.png", view: "projects", wait: "#view-projects:not(.hidden) #projects-list .project-card" },
  { file: "services.png", view: "services", wait: "#view-services:not(.hidden) #services-list li" },
  { file: "tooling.png", view: "tooling", wait: "#view-tooling:not(.hidden) #tooling-cards .tool-card" },
  { file: "dumps.png", view: "dumps", wait: "#view-dumps:not(.hidden) #dumps-viewer .dump-entry" },
  { file: "profiles.png", view: "profiles", wait: "#view-profiles:not(.hidden) #profiles-list li" },
];

async function captureMain(browser, baseUrl) {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 820 },
    deviceScaleFactor: 2,
  });
  await page.goto(`${baseUrl}/screenshot-demo.html`, { waitUntil: "networkidle" });
  await page.waitForSelector("#app-shell:not(.hidden)", { timeout: 15000 });
  await page.waitForSelector("#stat-projects", { timeout: 15000 });
  await page.waitForFunction(
    () => document.getElementById("stat-projects")?.textContent === "3",
    { timeout: 15000 }
  );

  for (const { file, view, wait } of MAIN_VIEWS) {
    await switchView(page, view);
    await page.waitForSelector(wait, { state: "attached", timeout: 15000 });
    await page.waitForTimeout(300);
    await page.locator("#app-shell").screenshot({
      path: path.join(outDir, file),
    });
    console.log(`  ✓ ${file}`);
  }

  await page.close();
}

async function captureTray(browser, baseUrl) {
  const page = await browser.newPage({
    viewport: { width: 380, height: 640 },
    deviceScaleFactor: 2,
  });
  await page.goto(`${baseUrl}/screenshot-tray-demo.html`, { waitUntil: "networkidle" });
  await page.waitForSelector("#service-list li.running", { state: "attached", timeout: 10000 });
  await page.waitForTimeout(400);
  await page.locator("#popup").screenshot({
    path: path.join(outDir, "tray.png"),
  });
  console.log("  ✓ tray.png");
  await page.close();
}

async function main() {
  await mkdir(outDir, { recursive: true });
  const appIconPath = await ensureAppIcon();

  const server = await startStaticServer(uiDir, appIconPath);
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Failed to bind server");
  const baseUrl = `http://127.0.0.1:${address.port}`;

  console.log(`Serving UI from ${uiDir}`);
  console.log(`Writing screenshots to ${outDir}`);

  const { chromium } = await loadPlaywright();
  const browser = await chromium.launch();

  try {
    console.log("Capturing main window views…");
    await captureMain(browser, baseUrl);
    console.log("Capturing tray panel…");
    await captureTray(browser, baseUrl);
  } finally {
    await browser.close();
    server.close();
  }

  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
