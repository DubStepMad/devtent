import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { initDevTent } from "./config.js";
import { runDoctor } from "./doctor.js";

describe("doctor", () => {
  it("reports health and applies safe repairs", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "devtent-doctor-"));
    await initDevTent(tmp, () => {});
    await mkdir(path.join(tmp, "www", "demo"), { recursive: true });

    const report = await runDoctor(tmp, { repair: true });
    assert.ok(report.repaired.length > 0);
    assert.ok(report.findings.some((f) => f.id === "projects" || f.id === "no-projects"));
  });
});
