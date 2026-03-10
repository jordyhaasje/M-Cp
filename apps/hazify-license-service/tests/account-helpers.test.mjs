import assert from "assert";
import {
  accountPublicPayload,
  createPasswordDigest,
  normalizeAccountEmail,
  normalizeOptionalEmail,
  verifyPasswordDigest,
} from "../src/domain/accounts.js";

assert.equal(normalizeOptionalEmail("  User@Example.com "), "user@example.com");
assert.equal(normalizeOptionalEmail(""), null);
assert.throws(() => normalizeOptionalEmail("not-an-email"), /contactEmail must be a valid email address/);

assert.equal(normalizeAccountEmail("owner@example.com"), "owner@example.com");
assert.throws(() => normalizeAccountEmail(""), /email is required/);

const digest = createPasswordDigest("supersecret1");
assert.equal(typeof digest.salt, "string");
assert.equal(typeof digest.hash, "string");
assert.equal(verifyPasswordDigest("supersecret1", digest.salt, digest.hash), true);
assert.equal(verifyPasswordDigest("wrong-password", digest.salt, digest.hash), false);
assert.throws(() => createPasswordDigest("short"), /minimaal 10 tekens/);

assert.deepEqual(
  accountPublicPayload({
    accountId: "acct_1",
    name: "Hazify",
    email: "owner@example.com",
    licenseKey: "HZY-123",
    createdAt: "2026-03-10T00:00:00.000Z",
    updatedAt: "2026-03-10T00:05:00.000Z",
    lastLoginAt: null,
  }),
  {
    accountId: "acct_1",
    name: "Hazify",
    email: "owner@example.com",
    licenseKey: "HZY-123",
    createdAt: "2026-03-10T00:00:00.000Z",
    updatedAt: "2026-03-10T00:05:00.000Z",
    lastLoginAt: null,
  }
);

console.log("account-helpers.test.mjs passed");
