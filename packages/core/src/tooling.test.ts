import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { initDevTent } from "./config.js";
import { isToolingManifest, listTooling } from "./tooling.js";

const manifestsDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../manifests"
);

describe("tooling", () => {
  it("flags tooling manifests for Quick Add filtering", () => {
    assert.equal(isToolingManifest("composer"), true);
    assert.equal(isToolingManifest("node-22"), true);
    assert.equal(isToolingManifest("bun"), true);
    assert.equal(isToolingManifest("nginx"), false);
  });

  it("lists developer tools with managed composer status", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "devtent-tooling-"));
    await initDevTent(tmp, () => {});

    const composerDir = path.join(tmp, "bin", "composer");
    await mkdir(composerDir, { recursive: true });
    await writeFile(path.join(composerDir, "composer.phar"), "stub", "utf-8");
    await writeFile(
      path.join(composerDir, "composer.bat"),
      '@echo off\nphp "%~dp0composer.phar" %*\n',
      "utf-8"
    );

    const overview = await listTooling(tmp, manifestsDir);
    assert.equal(overview.tools.length, 4);
    const composer = overview.tools.find((t) => t.id === "composer");
    assert.equal(composer?.source, "managed");
    assert.equal(composer?.canInstall, false);
    assert.equal(composer?.canRemove, true);
    assert.ok(overview.pathEntries.some((entry) => entry.endsWith("bin\\composer")));
  });
});
