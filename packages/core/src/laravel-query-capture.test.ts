import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  installLaravelQueryCapture,
  hasLaravelQueryCapture,
  LARAVEL_QUERY_CAPTURE_MARKER,
} from "./laravel-query-capture.js";

describe("laravel query capture", () => {
  it("injects listener into AppServiceProvider boot", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "devtent-laravel-"));
    await writeFile(path.join(tmp, "artisan"), "", "utf-8");
    await mkdir(path.join(tmp, "app/Providers"), { recursive: true });
    await writeFile(
      path.join(tmp, "app/Providers/AppServiceProvider.php"),
      `<?php
namespace App\\Providers;
class AppServiceProvider {
    public function boot(): void {}
}
`,
      "utf-8"
    );

    const result = await installLaravelQueryCapture(tmp);
    assert.equal(result.installed, true);
    assert.equal(result.alreadyInstalled, false);
    assert.equal(await hasLaravelQueryCapture(tmp), true);

    const updated = await readFile(
      path.join(tmp, "app/Providers/AppServiceProvider.php"),
      "utf-8"
    );
    assert.match(updated, new RegExp(LARAVEL_QUERY_CAPTURE_MARKER));
  });
});
