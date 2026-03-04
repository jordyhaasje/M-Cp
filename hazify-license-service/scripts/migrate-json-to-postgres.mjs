import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { PostgresStorage } from "../src/repositories/postgres-storage.js";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const sourceDbPath = path.resolve(process.env.SOURCE_DB_PATH || path.resolve(ROOT, "../data/licenses.json"));
const databaseUrl = process.env.DATABASE_URL || "";

if (!databaseUrl) {
  console.error("DATABASE_URL is verplicht voor migratie.");
  process.exit(1);
}

const raw = await fs.readFile(sourceDbPath, "utf8");
const snapshot = JSON.parse(raw);

const storage = new PostgresStorage({
  databaseUrl,
  databaseSsl: process.env.DATABASE_SSL ?? "true",
  dbPoolMax: Number(process.env.DB_POOL_MAX || 10),
  dbStatementTimeoutMs: Number(process.env.DB_STATEMENT_TIMEOUT_MS || 5000),
  encryptionKey: process.env.DATA_ENCRYPTION_KEY || "",
});

await storage.init();
await storage.persistState({
  licenses: snapshot.licenses || {},
  tenants: snapshot.tenants || {},
  mcpTokens: snapshot.mcpTokens || {},
  oauthClients: snapshot.oauthClients || {},
  oauthAuthCodes: snapshot.oauthAuthCodes || {},
  oauthRefreshTokens: snapshot.oauthRefreshTokens || {},
  accounts: snapshot.accounts || {},
  accountSessions: snapshot.accountSessions || {},
});

const loaded = await storage.loadState();

const counts = {
  licenses: Object.keys(loaded.licenses || {}).length,
  tenants: Object.keys(loaded.tenants || {}).length,
  mcpTokens: Object.keys(loaded.mcpTokens || {}).length,
  oauthClients: Object.keys(loaded.oauthClients || {}).length,
  oauthAuthCodes: Object.keys(loaded.oauthAuthCodes || {}).length,
  oauthRefreshTokens: Object.keys(loaded.oauthRefreshTokens || {}).length,
  accounts: Object.keys(loaded.accounts || {}).length,
  accountSessions: Object.keys(loaded.accountSessions || {}).length,
};

console.log("Migratie gereed.");
console.log(JSON.stringify({ sourceDbPath, counts }, null, 2));
