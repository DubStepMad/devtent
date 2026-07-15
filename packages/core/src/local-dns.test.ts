import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createSocket } from "node:dgram";
import {
  LOCAL_DNS_PORT,
  startLocalDns,
  stopLocalDns,
  getLocalDnsStatus,
  isLocalDnsRunning,
} from "./local-dns.js";
import { initDevTent } from "./config.js";

function encodeQuery(name: string): Buffer {
  const labels = name.split(".").filter(Boolean);
  const parts: number[] = [];
  for (const label of labels) {
    const b = Buffer.from(label);
    parts.push(b.length, ...b);
  }
  parts.push(0);
  const q = Buffer.alloc(12 + parts.length + 4);
  q.writeUInt16BE(0x1234, 0);
  q.writeUInt16BE(0x0100, 2);
  q.writeUInt16BE(1, 4);
  Buffer.from(parts).copy(q, 12);
  q.writeUInt16BE(1, 12 + parts.length);
  q.writeUInt16BE(1, 12 + parts.length + 2);
  return q;
}

describe("local dns", () => {
  it("answers A records for the active TLD", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "devtent-dns-"));
    await initDevTent(tmp);
    // Use .test so DNS is meaningful
    const { setDevTentTld } = await import("./config.js");
    await setDevTentTld(tmp, "test");

    try {
      await startLocalDns(tmp);
      assert.equal(isLocalDnsRunning(), true);
      const status = await getLocalDnsStatus(tmp);
      assert.equal(status.port, LOCAL_DNS_PORT);
      assert.equal(status.tld, "test");

      const answer = await new Promise<Buffer>((resolve, reject) => {
        const sock = createSocket("udp4");
        const timer = setTimeout(() => {
          sock.close();
          reject(new Error("DNS query timed out"));
        }, 2000);
        sock.on("message", (msg) => {
          clearTimeout(timer);
          sock.close();
          resolve(msg);
        });
        sock.send(encodeQuery("demo.test"), LOCAL_DNS_PORT, "127.0.0.1");
      });

      assert.ok(answer.length > 12);
      assert.equal(answer.readUInt16BE(6) >= 1, true); // ANCOUNT
      // Last 4 bytes of A rdata should be 127.0.0.1
      const ip = [...answer.subarray(answer.length - 4)];
      assert.deepEqual(ip, [127, 0, 0, 1]);
    } finally {
      await stopLocalDns(tmp);
    }
  });
});
