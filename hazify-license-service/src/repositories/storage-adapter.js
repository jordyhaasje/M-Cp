import path from "path";
import { JsonStorage } from "./json-storage.js";
import { PostgresStorage } from "./postgres-storage.js";

export function createStorageAdapter(config) {
  if (config.databaseUrl) {
    return new PostgresStorage({
      databaseUrl: config.databaseUrl,
      databaseSsl: config.databaseSsl,
      dbPoolMax: config.dbPoolMax,
      dbStatementTimeoutMs: config.dbStatementTimeoutMs,
      encryptionKey: config.dataEncryptionKey,
    });
  }

  return new JsonStorage({
    dbPath: path.resolve(config.dbPath),
  });
}
