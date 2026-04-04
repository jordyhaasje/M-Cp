import { PostgresStorage } from "./postgres-storage.js";
import { getLicenseServiceTestPoolOverride } from "../testing/storage-overrides.js";

export function createStorageAdapter(config) {
  const testPoolOverride = getLicenseServiceTestPoolOverride();
  if (!config.databaseUrl && !testPoolOverride) {
    throw new Error("DATABASE_URL is verplicht voor de Hazify License Service.");
  }

  return new PostgresStorage({
    databaseUrl: config.databaseUrl || "postgres://license-service-test",
    databaseSsl: config.databaseSsl,
    dbPoolMax: config.dbPoolMax,
    dbStatementTimeoutMs: config.dbStatementTimeoutMs,
    encryptionKey: config.dataEncryptionKey,
    singleWriterEnforced: config.dbSingleWriterEnforced,
    singleWriterLockKey: config.dbSingleWriterLockKey,
    pool: testPoolOverride,
    testSchemaCompatibility: Boolean(testPoolOverride),
  });
}
