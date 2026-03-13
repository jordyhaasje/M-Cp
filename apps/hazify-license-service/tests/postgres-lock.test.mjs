import assert from "assert";
import { PostgresStorage } from "../src/repositories/postgres-storage.js";

const databaseUrl = String(process.env.HAZIFY_TEST_POSTGRES_URL || "").trim();

if (!databaseUrl) {
  console.log(
    "postgres-lock.test.mjs skipped: HAZIFY_TEST_POSTGRES_URL ontbreekt; advisory lock semantiek vereist echte Postgres."
  );
} else {
  const lockKey = Number((Date.now() % 1_000_000_000) + 1000);
  const sharedOptions = {
    databaseUrl,
    databaseSsl: process.env.HAZIFY_TEST_POSTGRES_SSL ?? "true",
    dbPoolMax: 3,
    dbStatementTimeoutMs: 5000,
    encryptionKey: "hazify-postgres-lock-test-key",
    singleWriterEnforced: true,
    singleWriterLockKey: lockKey,
  };

  const writerA = new PostgresStorage(sharedOptions);
  const writerB = new PostgresStorage(sharedOptions);
  let writerC = null;
  try {
    await writerA.init();
    await assert.rejects(
      () => writerB.init(),
      /single-writer advisory lock|Another writer instance is active/i,
      "second writer should fail while first writer holds advisory lock"
    );

    await writerA.close();
    writerC = new PostgresStorage(sharedOptions);
    await writerC.init();
  } finally {
    await Promise.allSettled([writerA.close(), writerB.close(), writerC?.close()]);
  }

  console.log("postgres-lock.test.mjs passed");
}
