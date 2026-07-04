import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readStartupPreferences } from "./startup-preferences.js";

describe("startup preferences", () => {
  it("defaults startup preferences to off", () => {
    assert.deepEqual(readStartupPreferences({}), {
      launchAtLogin: false,
      autoStartServices: false,
    });
  });

  it("reads saved startup preferences", () => {
    assert.deepEqual(
      readStartupPreferences({ launchAtLogin: true, autoStartServices: true }),
      { launchAtLogin: true, autoStartServices: true }
    );
  });
});
