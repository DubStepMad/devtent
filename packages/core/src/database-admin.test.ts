import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveDatabaseTargetFromProfile } from "./database-admin.js";
import { getProfileServiceIds } from "./profile-services.js";
import { normalizeProfile } from "./profile-runtime.js";

describe("resolveDatabaseTargetFromProfile", () => {
  it("returns none for database none", () => {
    const target = resolveDatabaseTargetFromProfile(
      normalizeProfile({ name: "static", webServer: "nginx", database: "none" })
    );
    assert.equal(target.mode, "none");
    assert.equal(target.engine, "none");
  });

  it("returns managed localhost defaults for mysql", () => {
    const target = resolveDatabaseTargetFromProfile(
      normalizeProfile({ name: "default", webServer: "nginx", database: "mysql" })
    );
    assert.equal(target.mode, "managed");
    assert.equal(target.engine, "mysql");
    assert.equal(target.host, "127.0.0.1");
    assert.equal(target.port, 3306);
    assert.equal(target.user, "root");
    assert.equal(target.password, "");
  });

  it("returns managed mariadb port 3307", () => {
    const target = resolveDatabaseTargetFromProfile(
      normalizeProfile({ name: "m", webServer: "nginx", database: "mariadb" })
    );
    assert.equal(target.mode, "managed");
    assert.equal(target.engine, "mariadb");
    assert.equal(target.port, 3307);
  });

  it("resolves external NAS connection", () => {
    const target = resolveDatabaseTargetFromProfile(
      normalizeProfile({
        name: "nas",
        webServer: "nginx",
        database: "external",
        databaseConnection: {
          engine: "mariadb",
          host: "nas.local",
          port: 3306,
          user: "dev",
          password: "secret",
        },
      })
    );
    assert.equal(target.mode, "external");
    assert.equal(target.engine, "mariadb");
    assert.equal(target.host, "nas.local");
    assert.equal(target.port, 3306);
    assert.equal(target.user, "dev");
    assert.equal(target.password, "secret");
  });

  it("fills external defaults when connection fields are sparse", () => {
    const target = resolveDatabaseTargetFromProfile(
      normalizeProfile({
        name: "nas",
        webServer: "nginx",
        database: "external",
        databaseConnection: { engine: "postgresql", host: "db.example", port: 0, user: "", password: "" },
      })
    );
    assert.equal(target.mode, "external");
    assert.equal(target.engine, "postgresql");
    assert.equal(target.host, "db.example");
    assert.equal(target.port, 5432);
    assert.equal(target.user, "postgres");
  });
});

describe("external database not in profile services", () => {
  it("excludes external from Procfile service ids", () => {
    const external = normalizeProfile({
      name: "nas",
      webServer: "nginx",
      database: "external",
      databaseConnection: {
        engine: "mariadb",
        host: "192.168.1.50",
        port: 3306,
        user: "root",
      },
      services: ["redis"],
    });
    assert.deepEqual(getProfileServiceIds(external), ["php-fpm", "nginx", "redis"]);
    assert.ok(!getProfileServiceIds(external).includes("external"));
    assert.ok(!getProfileServiceIds(external).includes("mariadb"));
  });

  it("still includes managed database ids", () => {
    const managed = normalizeProfile({
      name: "local",
      webServer: "nginx",
      database: "mariadb",
    });
    assert.deepEqual(getProfileServiceIds(managed), ["php-fpm", "nginx", "mariadb"]);
  });

  it("clears databaseConnection when switching away from external", () => {
    const cleared = normalizeProfile({
      name: "local",
      webServer: "nginx",
      database: "mysql",
      databaseConnection: {
        engine: "mariadb",
        host: "nas.local",
        port: 3306,
        user: "root",
      },
    });
    assert.equal(cleared.databaseConnection, undefined);
  });
});
