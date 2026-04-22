import assert from "assert";
import { isEffectiveProductionEnv, reloadRuntimeConfig } from "../src/config/runtime.js";

assert.equal(
  isEffectiveProductionEnv({
    NODE_ENV: "development",
    RAILWAY_ENVIRONMENT_NAME: "production",
  }),
  true,
  "Railway production should count as production even when NODE_ENV is not production"
);

assert.equal(
  isEffectiveProductionEnv({
    NODE_ENV: "",
    RAILWAY_ENVIRONMENT: "production",
  }),
  true,
  "Railway production alias should count as production even when NODE_ENV is missing"
);

assert.equal(
  isEffectiveProductionEnv({
    NODE_ENV: "production",
    RAILWAY_ENVIRONMENT_NAME: "staging",
  }),
  true,
  "Explicit NODE_ENV=production should still count as production"
);

assert.equal(
  isEffectiveProductionEnv({
    NODE_ENV: "development",
    RAILWAY_ENVIRONMENT_NAME: "staging",
  }),
  false,
  "Non-production environments should remain non-production"
);

assert.throws(
  () =>
    reloadRuntimeConfig({
      NODE_ENV: "development",
      RAILWAY_ENVIRONMENT_NAME: "production",
      PORT: "8787",
      DATABASE_URL: "postgres://unit-test",
      DATABASE_SSL: "false",
      DB_POOL_MAX: "10",
      DB_STATEMENT_TIMEOUT_MS: "5000",
      DATA_ENCRYPTION_KEY: "",
      HAZIFY_FREE_MODE: "false",
      ADMIN_API_KEY: "admin-key",
      MCP_API_KEY: "mcp-key",
      PUBLIC_BASE_URL: "https://license.example.test",
      MCP_PUBLIC_URL: "https://mcp.example.test/mcp",
      DB_SINGLE_WRITER_ENFORCED: "true",
      BACKUP_EXPORT_KEY: "",
      BACKUP_EXPORT_DIRECTORY: "",
      BACKUP_EXPORT_POLICY: "",
    }),
  /DATA_ENCRYPTION_KEY is verplicht in productie\./,
  "Railway production should hard fail startup when mandatory production envs are missing"
);

assert.throws(
  () =>
    reloadRuntimeConfig({
      NODE_ENV: "development",
      RAILWAY_ENVIRONMENT_NAME: "production",
      PORT: "8787",
      DATABASE_URL: "postgres://unit-test",
      DATABASE_SSL: "false",
      DB_POOL_MAX: "10",
      DB_STATEMENT_TIMEOUT_MS: "5000",
      DATA_ENCRYPTION_KEY: "unit-test-key",
      HAZIFY_FREE_MODE: "false",
      ADMIN_API_KEY: "admin-key",
      MCP_API_KEY: "mcp-key",
      PUBLIC_BASE_URL: "https://license.example.test",
      MCP_PUBLIC_URL: "https://mcp.example.test/mcp",
      DB_SINGLE_WRITER_ENFORCED: "true",
      BACKUP_EXPORT_KEY: "",
      BACKUP_EXPORT_DIRECTORY: "",
      BACKUP_EXPORT_POLICY: "",
    }),
  /BACKUP_EXPORT_KEY is verplicht in productie\./,
  "backup export should require explicit production configuration"
);

console.log("runtime-config.test.mjs passed");
