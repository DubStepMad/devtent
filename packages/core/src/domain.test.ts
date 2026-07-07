import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeTld,
  tldRequiresHostsFile,
  formatSiteDomain,
  ZERO_ADMIN_TLD,
} from "./domain.js";

describe("domain", () => {
  it("defaults localhost as zero-admin TLD", () => {
    assert.equal(ZERO_ADMIN_TLD, "localhost");
    assert.equal(tldRequiresHostsFile("localhost"), false);
    assert.equal(tldRequiresHostsFile("test"), true);
  });

  it("normalizes TLD input", () => {
    assert.equal(normalizeTld(".localhost"), "localhost");
    assert.equal(formatSiteDomain("myapp", "localhost"), "myapp.localhost");
  });

  it("rejects invalid TLD", () => {
    assert.throws(() => normalizeTld("bad.tld"));
  });
});
