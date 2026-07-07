import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolvePhpCgiPort, phpCgiProcfileName } from "./php-ports.js";

describe("php ports", () => {
  it("maps PHP versions to deterministic FastCGI ports", () => {
    assert.equal(resolvePhpCgiPort("php-8.2"), 9082);
    assert.equal(resolvePhpCgiPort("php-8.3"), 9083);
    assert.equal(resolvePhpCgiPort("php-8.4"), 9084);
  });

  it("builds procfile service names", () => {
    assert.equal(phpCgiProcfileName("php-8.3"), "php-cgi-8.3");
  });
});
