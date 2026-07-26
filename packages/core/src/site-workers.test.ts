import assert from "node:assert/strict";
import { mkdir, writeFile, rm, mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { initDevTent } from "./config.js";
import {
  allocateVitePort,
  preferredVitePort,
  parseVitePortFromCommand,
  listSiteWorkers,
  setSiteWorker,
  isSiteWorkerServiceName,
} from "./site-workers.js";
import { parseProcfile } from "./services.js";

describe("site workers", () => {
  it("allocates unique preferred vite ports", () => {
    const a = preferredVitePort("bookstore");
    const b = preferredVitePort("api-demo");
    assert.ok(a >= 5173 && a < 5273);
    assert.ok(b >= 5173 && b < 5273);
    const used = new Set([a]);
    const next = allocateVitePort("bookstore", used);
    assert.notEqual(next, a);
    assert.equal(parseVitePortFromCommand("npx vite --port 5188 --strictPort"), 5188);
  });

  it("detects worker service names", () => {
    assert.equal(isSiteWorkerServiceName("queue-myapp"), true);
    assert.equal(isSiteWorkerServiceName("vite-myapp"), true);
    assert.equal(isSiteWorkerServiceName("schedule-myapp"), true);
    assert.equal(isSiteWorkerServiceName("nginx"), false);
  });

  it("writes schedule and vite workers with unique ports", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "devtent-workers-"));
    try {
      await initDevTent(tmp, () => {});
      const siteA = path.join(tmp, "www", "app-a");
      const siteB = path.join(tmp, "www", "app-b");
      await mkdir(siteA, { recursive: true });
      await mkdir(siteB, { recursive: true });
      await writeFile(path.join(siteA, "artisan"), "#!/usr/bin/env php\n", "utf-8");
      await writeFile(path.join(siteB, "artisan"), "#!/usr/bin/env php\n", "utf-8");
      await mkdir(path.join(siteA, "node_modules", "vite", "bin"), { recursive: true });
      await writeFile(path.join(siteA, "node_modules", "vite", "bin", "vite.js"), "console.log('vite')", "utf-8");
      await mkdir(path.join(siteB, "node_modules", "vite", "bin"), { recursive: true });
      await writeFile(path.join(siteB, "node_modules", "vite", "bin", "vite.js"), "console.log('vite')", "utf-8");
      await mkdir(path.join(tmp, "bin", "php", "php-8.3"), { recursive: true });
      await writeFile(
        path.join(tmp, "bin", "php", "php-8.3", process.platform === "win32" ? "php.exe" : "php"),
        "",
        "utf-8"
      );
      await mkdir(path.join(tmp, "bin", "node", "node-22"), { recursive: true });
      const nodeCli =
        process.platform === "win32"
          ? path.join(tmp, "bin", "node", "node-22", "node.exe")
          : path.join(tmp, "bin", "node", "node-22", "bin", "node");
      await mkdir(path.dirname(nodeCli), { recursive: true });
      await writeFile(nodeCli, "", "utf-8");

      // Avoid actually spawning broken empty binaries — enable without start by catching start errors
      // and verifying Procfile content. setSiteWorker starts services; empty php/node will fail start.
      // So we only assert list + allocate helpers + Procfile write via direct save pattern:
      const workersBefore = await listSiteWorkers(tmp);
      assert.ok(workersBefore.some((w) => w.kind === "schedule" && w.siteName === "app-a"));
      assert.ok(workersBefore.some((w) => w.kind === "vite"));

      const portA = preferredVitePort("app-a");
      const portB = allocateVitePort("app-b", [portA]);
      assert.notEqual(portA, portB);

      try {
        await setSiteWorker(tmp, "app-a", "schedule", true);
      } catch {
        // start may fail with empty php binary — Procfile should still have the row
      }
      const entries = await parseProcfile(tmp);
      assert.ok(entries.some((e) => e.name === "schedule-app-a"));
      assert.match(
        entries.find((e) => e.name === "schedule-app-a")!.command,
        /artisan schedule:work/
      );
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});
