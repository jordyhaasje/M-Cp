import assert from "assert";
import { PostgresStorage } from "../src/repositories/postgres-storage.js";

function createFakePool({ failAttempts = 0 } = {}) {
  let attempts = 0;
  let releases = 0;
  const lockedClient = {
    async query() {
      return { rows: [{ acquired: true }] };
    },
    release() {
      releases += 1;
    },
  };
  return {
    stats() {
      return { attempts, releases };
    },
    async connect() {
      attempts += 1;
      const shouldAcquire = attempts > failAttempts;
      return {
        async query() {
          return { rows: [{ acquired: shouldAcquire }] };
        },
        release() {
          releases += 1;
        },
      };
    },
    async end() {},
    lockedClient,
  };
}

const pool = createFakePool({ failAttempts: 2 });
const storage = new PostgresStorage({
  databaseUrl: "postgres://retry-test",
  databaseSsl: "false",
  dbPoolMax: 1,
  dbStatementTimeoutMs: 5000,
  encryptionKey: "retry-test-key",
  singleWriterEnforced: true,
  singleWriterLockKey: 123456,
  singleWriterLockRetryMs: 1,
  singleWriterLockTimeoutMs: 50,
  pool,
});

await storage.acquireWriterLock();
assert.ok(storage.writerLockClient, "writer lock client should be stored after a successful retry");
assert.equal(pool.stats().attempts, 3, "storage should retry until the advisory lock becomes available");

await storage.close();
console.log("postgres-lock-retry.test.mjs passed");
