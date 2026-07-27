import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { clampDashboardSize, shouldApplyWindowGeometry } from "./window-layout-mode.js";

describe("window-layout-mode", () => {
  it("applies geometry when mode changes or is forced", () => {
    assert.equal(shouldApplyWindowGeometry(null, "dashboard"), true);
    assert.equal(shouldApplyWindowGeometry("setup", "dashboard"), true);
    assert.equal(shouldApplyWindowGeometry("dashboard", "setup"), true);
    assert.equal(shouldApplyWindowGeometry("dashboard", "dashboard"), false);
    assert.equal(shouldApplyWindowGeometry("setup", "setup"), false);
    assert.equal(shouldApplyWindowGeometry("dashboard", "dashboard", true), true);
  });

  it("clamps dashboard size to minimums", () => {
    assert.deepEqual(clampDashboardSize({ width: 800, height: 400 }), {
      width: 900,
      height: 560,
    });
    assert.deepEqual(clampDashboardSize({ width: 1400, height: 900 }), {
      width: 1400,
      height: 900,
    });
  });
});
