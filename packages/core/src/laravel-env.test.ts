import assert from "node:assert/strict";
import { mkdir, writeFile, rm, mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { initDevTent, saveProfile } from "./config.js";
import { buildLaravelEnvSnippet } from "./laravel-env.js";

describe("laravel env meilisearch/minio", () => {
  it("includes Meilisearch and MinIO hints when enabled on the profile", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "devtent-env-"));
    try {
      await initDevTent(tmp, () => {});
      await mkdir(path.join(tmp, "www", "shop"), { recursive: true });
      await writeFile(path.join(tmp, "www", "shop", "index.php"), "<?php", "utf-8");
      await saveProfile(tmp, {
        name: "default",
        phpVersion: "php-8.3",
        webServer: "nginx",
        database: "mysql",
        services: ["meilisearch", "minio"],
      });

      const snippet = await buildLaravelEnvSnippet(tmp, "shop");
      assert.match(snippet.envBlock, /MEILISEARCH_HOST=http:\/\/127\.0\.0\.1:7700/);
      assert.match(snippet.envBlock, /MEILISEARCH_KEY=masterKey/);
      assert.match(snippet.envBlock, /AWS_ENDPOINT=http:\/\/127\.0\.0\.1:9000/);
      assert.match(snippet.envBlockRedacted, /AWS_SECRET_ACCESS_KEY=\*\*\*/);
      assert.ok(!snippet.envBlockRedacted.includes("AWS_SECRET_ACCESS_KEY=minioadmin"));
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});
