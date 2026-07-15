import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  binaryName,
  binPath,
  currentPlatform,
  isUnix,
  isWindows,
  npmLauncher,
  redisConfigPath,
} from "./binary.js";

describe("platform/binary", () => {
  it("maps process.platform to DevTentPlatform", () => {
    assert.equal(currentPlatform("win32"), "win32");
    assert.equal(currentPlatform("darwin"), "darwin");
    assert.equal(currentPlatform("linux"), "linux");
    assert.equal(currentPlatform("freebsd"), "other");
  });

  it("adds .exe only on Windows", () => {
    assert.equal(binaryName("nginx", "win32"), "nginx.exe");
    assert.equal(binaryName("nginx.exe", "win32"), "nginx.exe");
    assert.equal(binaryName("nginx", "darwin"), "nginx");
    assert.equal(binaryName("nginx", "linux"), "nginx");
    assert.equal(binaryName("mysqld.exe", "linux"), "mysqld");
  });

  it("builds relative bin paths", () => {
    assert.equal(binPath(["bin", "nginx", "nginx"], "win32"), "bin/nginx/nginx.exe");
    assert.equal(binPath(["bin", "nginx", "nginx"], "darwin"), "bin/nginx/nginx");
    assert.equal(binPath(["bin", "mysql", "bin", "mysqld"], "linux"), "bin/mysql/bin/mysqld");
  });

  it("npm launcher and redis config differ by OS", () => {
    assert.equal(npmLauncher("win32"), "npm.cmd");
    assert.equal(npmLauncher("linux"), "npm");
    assert.equal(redisConfigPath("win32"), "bin/redis/redis.windows.conf");
    assert.equal(redisConfigPath("darwin"), "bin/redis/redis.conf");
  });

  it("isWindows / isUnix helpers", () => {
    assert.equal(isWindows("win32"), true);
    assert.equal(isWindows("darwin"), false);
    assert.equal(isUnix("darwin"), true);
    assert.equal(isUnix("linux"), true);
    assert.equal(isUnix("win32"), false);
  });
});
