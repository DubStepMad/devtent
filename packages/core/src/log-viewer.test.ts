import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseLogLineLocations, searchLogFiles } from "./log-viewer.js";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { initDevTent } from "./config.js";
import { resolveNodePaths, getNodeDisplayLabel } from "./node-runtime.js";

describe("log viewer", () => {
  it("parses PHP file locations from log lines", () => {
    const line = "Error in C:\\devtent\\www\\demo\\index.php on line 42";
    const locations = parseLogLineLocations(line);
    assert.equal(locations.length, 1);
    assert.match(locations[0].filePath, /index\.php$/);
    assert.equal(locations[0].line, 42);
  });

  it("ignores overlong lines to avoid regex DoS", () => {
    const line = "/" + "a".repeat(9000) + ".php:1";
    assert.equal(parseLogLineLocations(line).length, 0);
  });

  it("ignores slash-heavy lines without a source extension", () => {
    const line = "/" + "/".repeat(500);
    assert.equal(parseLogLineLocations(line).length, 0);
  });

  it("searches log files for a query", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "devtent-log-search-"));
    await initDevTent(tmp, () => {});
    await mkdir(path.join(tmp, "logs"), { recursive: true });
    await writeFile(
      path.join(tmp, "logs", "app.log"),
      "INFO started\nERROR database connection failed\nINFO done\n",
      "utf-8"
    );

    const matches = await searchLogFiles(tmp, "database");
    assert.equal(matches.length, 1);
    assert.equal(matches[0].fileName, "app.log");
    assert.match(matches[0].line, /database/);
  });
});

describe("node runtime", () => {
  it("resolves node paths from manifest id", () => {
    const paths = resolveNodePaths("node-22");
    assert.equal(paths.cli, "bin/node/node-22/node.exe");
    assert.equal(getNodeDisplayLabel("node-22", "22.14.0"), "22.x (22.14.0)");
  });
});
