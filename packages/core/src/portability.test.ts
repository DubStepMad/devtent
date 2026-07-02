import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { initDevTent, saveProfile } from "./config.js";
import { exportEnvironment, importEnvironmentBundle } from "./portability.js";
import { listProfiles } from "./config.js";

describe("portability", () => {
  it("exports and imports environment bundle", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "devtent-export-"));
    const dest = path.join(tmp, "export");
    const target = path.join(tmp, "import-target");

    await initDevTent(tmp, () => {});
    await mkdir(path.join(tmp, "www", "demo"), { recursive: true });
    await writeFile(path.join(tmp, "www/demo/index.php"), "<?php echo 1;");
    await saveProfile(tmp, { name: "custom", webServer: "nginx", database: "none" });

    const exported = await exportEnvironment(tmp, dest);
    assert.ok(exported.included.includes("www"));
    assert.ok(exported.included.includes("profiles"));

    await initDevTent(target, () => {});
    const imported = await importEnvironmentBundle(target, dest);
    assert.ok(imported.imported.includes("www"));

    const profiles = await listProfiles(target);
    assert.ok(profiles.some((p) => p.name === "custom"));

    const manifest = JSON.parse(await readFile(path.join(dest, "devtent-export.json"), "utf-8"));
    assert.equal(manifest.version, 1);
  });
});
