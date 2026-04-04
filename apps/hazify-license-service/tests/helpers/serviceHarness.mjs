import crypto from "crypto";
import { newDb } from "pg-mem";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { PostgresStorage } from "../../src/repositories/postgres-storage.js";
import { createInitialState } from "../../src/repositories/state-shape.js";
import {
  clearLicenseServiceTestPoolOverride,
  setLicenseServiceTestPoolOverride,
} from "../../src/testing/storage-overrides.js";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const serverModulePath = path.resolve(testDir, "../../src/server.js");

function createPgMemPool() {
  const mem = newDb({ autoCreateForeignKeyIndices: true });
  mem.public.registerFunction({
    name: "gen_random_uuid",
    args: [],
    returns: "uuid",
    implementation: () => crypto.randomUUID(),
  });
  const pg = mem.adapters.createPg();
  return new pg.Pool();
}

function normalizeSeedState(seedState) {
  return {
    ...createInitialState(),
    ...(seedState && typeof seedState === "object" ? seedState : {}),
  };
}

export async function startLicenseServiceTestServer({
  port,
  publicBaseUrl,
  mcpPublicUrl,
  seedState = null,
  env = {},
  cacheBuster = `test=${Date.now()}`,
} = {}) {
  const pool = createPgMemPool();

  if (seedState) {
    const seedStorage = new PostgresStorage({
      databaseUrl: "postgres://license-service-test",
      databaseSsl: false,
      dbPoolMax: 4,
      dbStatementTimeoutMs: 5000,
      encryptionKey: "license-service-test-encryption-key",
      singleWriterEnforced: false,
      pool,
      testSchemaCompatibility: true,
    });
    await seedStorage.init();
    await seedStorage.persistState(normalizeSeedState(seedState));
  }

  const nextEnv = {
    NODE_ENV: "test",
    PORT: String(port),
    DATABASE_URL: "postgres://license-service-test",
    DATABASE_SSL: "false",
    DB_SINGLE_WRITER_ENFORCED: "false",
    DATA_ENCRYPTION_KEY: "license-service-test-encryption-key",
    HAZIFY_FREE_MODE: "true",
    ADMIN_API_KEY: "admin-test-key",
    MCP_API_KEY: "mcp-test-key",
    PUBLIC_BASE_URL: publicBaseUrl,
    MCP_PUBLIC_URL: mcpPublicUrl,
    MAX_BODY_BYTES: "1048576",
    ...env,
  };

  const previousEnv = Object.fromEntries(
    Object.keys(nextEnv).map((key) => [key, process.env[key]])
  );

  for (const [key, value] of Object.entries(nextEnv)) {
    process.env[key] = value;
  }

  setLicenseServiceTestPoolOverride(pool);

  let startedServer = null;
  try {
    const moduleUrl = `${pathToFileURL(serverModulePath).href}?${cacheBuster}`;
    const { startLicenseService } = await import(moduleUrl);
    const started = await startLicenseService({ port });
    startedServer = started.server;
    return {
      server: startedServer,
      async cleanup() {
        if (startedServer?.listening) {
          await new Promise((resolve) => startedServer.close(resolve));
        }
        clearLicenseServiceTestPoolOverride();
        for (const [key, value] of Object.entries(previousEnv)) {
          if (value === undefined) {
            delete process.env[key];
          } else {
            process.env[key] = value;
          }
        }
      },
    };
  } catch (error) {
    clearLicenseServiceTestPoolOverride();
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    try {
      await pool.end();
    } catch {
      // best effort cleanup for failed test bootstrap
    }
    throw error;
  }
}
