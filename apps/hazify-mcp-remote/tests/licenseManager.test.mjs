import assert from "assert";
import http from "http";
import { LicenseManager } from "../src/lib/licenseManager.js";

let currentPayload = {
  status: "active",
  entitlements: { mutations: true, tools: {} },
  expiresAt: null,
  graceUntil: null,
  readOnlyGraceUntil: null,
};

const server = http.createServer(async (req, res) => {
  if (req.method === "POST" && req.url === "/v1/license/validate") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(currentPayload));
    return;
  }
  if (req.method === "POST" && req.url === "/v1/license/heartbeat") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(currentPayload));
    return;
  }
  if (req.method === "POST" && req.url === "/v1/license/deactivate") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "not_found" }));
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
const apiBaseUrl = `http://127.0.0.1:${address.port}`;

const manager = new LicenseManager({
  licenseKey: "HZY-TEST-KEY",
  apiBaseUrl,
  graceHours: 72,
  heartbeatHours: 24,
  machineFingerprint: "fingerprint-test",
  mcpVersion: "1.1.0",
  requestTimeoutMs: 5000,
});

await manager.initialize();
await manager.assertToolAllowed("update-order", { mutating: true });

currentPayload = {
  status: "past_due",
  entitlements: { mutations: true, tools: {} },
  graceUntil: new Date(Date.now() - 60 * 1000).toISOString(),
  expiresAt: null,
  readOnlyGraceUntil: null,
};
await manager.validate("test-past-due-expired");

let blockedMutation = false;
try {
  await manager.assertToolAllowed("update-order", { mutating: true });
} catch {
  blockedMutation = true;
}
assert.equal(blockedMutation, true, "Mutation should be blocked when past_due grace expired");

await manager.assertToolAllowed("get-orders", { mutating: false });

currentPayload = {
  status: "canceled",
  entitlements: { mutations: true, tools: {} },
  graceUntil: null,
  expiresAt: null,
  readOnlyGraceUntil: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
};
await manager.validate("test-canceled-read-only");
await manager.assertToolAllowed("get-orders", { mutating: false });

let blockedCanceledWrite = false;
try {
  await manager.assertToolAllowed("update-product", { mutating: true });
} catch {
  blockedCanceledWrite = true;
}
assert.equal(blockedCanceledWrite, true, "Mutation should be blocked for canceled status");

await manager.destroy();
server.close();
console.log("licenseManager.test.mjs passed");
