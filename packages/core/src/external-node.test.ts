import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { inferNodeManager } from "./external-node.js";

describe("external node", () => {
  it("infers common Node version managers from paths", () => {
    assert.equal(
      inferNodeManager("C:\\Users\\me\\AppData\\Roaming\\nvm\\v22.14.0\\node.exe"),
      "nvm-windows"
    );
    assert.equal(inferNodeManager("/home/me/.nvm/versions/node/v20/bin/node"), "nvm");
    assert.equal(inferNodeManager("/home/me/.local/share/fnm/node-versions/v20/node"), "fnm");
    assert.equal(inferNodeManager("C:\\Program Files\\nodejs\\node.exe"), "system");
  });
});
