import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { prepareHostsSyncFiles, launchElevatedHostsSync, isHostsElevationDisabled } from "./hosts-elevate.js";

describe("hosts elevation", () => {
  it("writes helper scripts for elevated hosts sync", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "devtent-hosts-elevate-"));
    const content = "# devtent-start\n127.0.0.1 demo.test\n# devtent-end\n";
    const { batchFile } = await prepareHostsSyncFiles(tmp, content);

    assert.match(batchFile, /devtent-sync-hosts\.cmd$/);
    const batch = await readFile(batchFile, "utf-8");
    assert.match(batch, /devtent-hosts-new/);
    assert.match(batch, /drivers\\etc\\hosts/);

    const hostsNew = await readFile(path.join(tmp, "tmp", "devtent-hosts-new"), "utf-8");
    assert.equal(hostsNew, content);
  });

  it("does not launch wscript during automated test runs", async () => {
    assert.equal(isHostsElevationDisabled(), true);
    const launched = await launchElevatedHostsSync("C:\\fake\\devtent-sync-hosts.cmd");
    assert.equal(launched, false);
  });
});
