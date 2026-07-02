import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { initDevTent, saveProfile, switchProfile } from "./config.js";
import { parseProcfile } from "./services.js";
import { syncProfileProcfileFromProfile } from "./profile-procfile.js";

async function touch(root: string, relative: string): Promise<void> {
  const full = path.join(root, relative);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, "");
}

describe("profile-procfile", () => {
  it("syncProfileProcfileFromProfile enables apache and postgresql from profile", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "devtent-profile-"));

    await initDevTent(tmp, () => {});
    await touch(tmp, "bin/apache/bin/httpd.exe");
    await touch(tmp, "bin/postgresql/bin/postgres.exe");
    await touch(tmp, "bin/php/php-8.3/php-cgi.exe");

    await saveProfile(tmp, {
      name: "apache-pg",
      description: "Apache + PostgreSQL",
      phpVersion: "php-8.3",
      webServer: "apache",
      database: "postgresql",
    });

    await switchProfile(tmp, "apache-pg");

    const entries = await parseProcfile(tmp);
    const names = entries.map((e) => e.name).sort();

    assert.deepEqual(names, ["apache", "php-fpm", "postgresql"]);
  });

  it("merge mode keeps existing procfile entries on update", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "devtent-profile-"));

    await initDevTent(tmp, () => {});
    await touch(tmp, "bin/nginx/nginx.exe");
    await touch(tmp, "bin/mysql/bin/mysqld.exe");
    await touch(tmp, "bin/php/php-8.3/php-cgi.exe");
    await touch(tmp, "bin/redis/redis-server.exe");
    await touch(tmp, "bin/mailpit/mailpit.exe");

    await writeFile(
      path.join(tmp, "Procfile"),
      [
        "redis: bin/redis/redis-server.exe bin/redis/redis.windows.conf",
        "mailpit: bin/mailpit/mailpit.exe",
        "nginx: bin/nginx/nginx.exe -p . -c etc/nginx/nginx.conf",
        "mysql: bin/mysql/bin/mysqld.exe --datadir=data/mysql --console",
        "php-fpm: bin/php/php-8.3/php-cgi.exe -b 127.0.0.1:9000",
      ].join("\n") + "\n"
    );

    await syncProfileProcfileFromProfile(tmp);
    const names = (await parseProcfile(tmp)).map((e) => e.name).sort();

    assert.ok(names.includes("redis"));
    assert.ok(names.includes("mailpit"));
    assert.ok(names.includes("nginx"));
    assert.ok(names.includes("mysql"));
    assert.ok(names.includes("php-fpm"));
  });

  it("replace mode uses profile optional services instead of procfile leftovers", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "devtent-profile-"));

    await initDevTent(tmp, () => {});
    await touch(tmp, "bin/nginx/nginx.exe");
    await touch(tmp, "bin/php/php-8.3/php-cgi.exe");
    await touch(tmp, "bin/redis/redis-server.exe");
    await touch(tmp, "bin/mailpit/mailpit.exe");

    await saveProfile(tmp, {
      name: "redis-only",
      phpVersion: "php-8.3",
      webServer: "nginx",
      database: "none",
      services: ["redis"],
    });

    await switchProfile(tmp, "redis-only");

    const names = (await parseProcfile(tmp)).map((e) => e.name).sort();
    assert.deepEqual(names, ["nginx", "php-fpm", "redis"]);
    assert.ok(!names.includes("mailpit"));
    assert.ok(!names.includes("mysql"));
  });
});
