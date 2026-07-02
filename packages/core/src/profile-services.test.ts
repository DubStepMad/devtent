import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { initDevTent, saveProfile } from "./config.js";
import { getProfileServiceIds, getProfileServices } from "./profile-services.js";
import { normalizeProfile } from "./profile-runtime.js";

describe("profile services", () => {
  it("lists stack service ids from profile settings", () => {
    const nginxMysql = normalizeProfile({
      name: "default",
      webServer: "nginx",
      database: "mysql",
    });
    assert.deepEqual(getProfileServiceIds(nginxMysql), ["php-fpm", "nginx", "mysql"]);

    const apachePg = normalizeProfile({
      name: "lamp",
      webServer: "apache",
      database: "postgresql",
    });
    assert.deepEqual(getProfileServiceIds(apachePg), ["php-fpm", "apache", "postgresql"]);

    const noDb = normalizeProfile({
      name: "static",
      webServer: "nginx",
      database: "none",
    });
    assert.deepEqual(getProfileServiceIds(noDb), ["php-fpm", "nginx"]);

    const withOptional = normalizeProfile({
      name: "full",
      webServer: "nginx",
      database: "mysql",
      services: ["redis", "mailpit"],
    });
    assert.deepEqual(getProfileServiceIds(withOptional), [
      "php-fpm",
      "nginx",
      "mysql",
      "redis",
      "mailpit",
    ]);
  });

  it("returns profile services for active profile", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "devtent-profile-svc-"));
    try {
      await initDevTent(tmp);
      await saveProfile(tmp, {
        name: "apache-stack",
        webServer: "apache",
        database: "mysql",
      });

      const services = await getProfileServices(tmp, "apache-stack");
      assert.deepEqual(
        services.map((s) => s.id),
        ["php-fpm", "apache", "mysql"]
      );
      assert.ok(services.every((s) => typeof s.runtimeInstalled === "boolean"));
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});
