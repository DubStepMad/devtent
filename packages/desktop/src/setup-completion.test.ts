import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { setupCompletedForRoot } from "./setup-completion.js";

describe("setupCompletedForRoot", () => {
  it("matches when setup was completed for the same install folder", () => {
    assert.equal(
      setupCompletedForRoot(
        { setupCompleted: true, setupCompletedRoot: "P:\\devtent", root: "P:\\devtent" },
        "P:\\devtent"
      ),
      true
    );
  });

  it("does not match when setup was completed for a different folder", () => {
    assert.equal(
      setupCompletedForRoot(
        { setupCompleted: true, setupCompletedRoot: "C:\\devtent", root: "C:\\devtent" },
        "P:\\devtent"
      ),
      false
    );
  });

  it("returns false when setup was never completed", () => {
    assert.equal(
      setupCompletedForRoot({ setupCompleted: false, root: "P:\\devtent" }, "P:\\devtent"),
      false
    );
  });
});
