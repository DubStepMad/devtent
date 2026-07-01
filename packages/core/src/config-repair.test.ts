import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  initDevTent,
  repairDevTentEnvironment,
  saveProfile,
  switchProfile,
  loadConfig,
  loadProfile,
} from "./config.js";

describe("repairDevTentEnvironment", () => {
  it("restores active profile from marker when devtent.toml was lost", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "devtent-repair-"));

    await initDevTent(tmp, () => {});
    await saveProfile(tmp, {
      name: "laravel-84",
      description: "Laravel stack",
      phpVersion: "php-8.4",
      webServer: "nginx",
      database: "mysql",
    });
    await switchProfile(tmp, "laravel-84");

    await unlink(path.join(tmp, "devtent.toml"));

    const config = await repairDevTentEnvironment(tmp);
    assert.equal(config.activeProfile, "laravel-84");

    const profile = await loadProfile(tmp, "laravel-84");
    assert.equal(profile.phpVersion, "php-8.4");
    assert.equal(profile.description, "Laravel stack");
  });

  it("does not overwrite existing profile files during repair", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "devtent-repair-"));

    await initDevTent(tmp, () => {});
    await saveProfile(tmp, {
      name: "custom",
      description: "Keep me",
      phpVersion: "php-8.2",
      webServer: "apache",
      database: "postgresql",
    });
    await switchProfile(tmp, "custom");
    await unlink(path.join(tmp, "devtent.toml"));

    await repairDevTentEnvironment(tmp);

    const profile = await loadProfile(tmp, "custom");
    assert.equal(profile.webServer, "apache");
    assert.equal(profile.database, "postgresql");
    assert.equal((await loadConfig(tmp)).activeProfile, "custom");
  });
});
