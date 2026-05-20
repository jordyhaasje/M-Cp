import assert from "assert";
import { isEffectiveProductionEnv, reloadRuntimeConfig } from "../src/config/runtime.js";

const STRONG_ADMIN_KEY = "admin-production-secret-1234567890";
const STRONG_MCP_KEY = "mcp-production-secret-123456789012";

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
      ADMIN_API_KEY: STRONG_ADMIN_KEY,
      MCP_API_KEY: STRONG_MCP_KEY,
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

const productionConfigWithoutBackupExport = reloadRuntimeConfig({
  NODE_ENV: "development",
  RAILWAY_ENVIRONMENT_NAME: "production",
  PORT: "8787",
  DATABASE_URL: "postgres://unit-test",
  DATABASE_SSL: "false",
  DB_POOL_MAX: "10",
  DB_STATEMENT_TIMEOUT_MS: "5000",
  DATA_ENCRYPTION_KEY: "data-production-secret-123456789012",
  HAZIFY_FREE_MODE: "false",
  ADMIN_API_KEY: STRONG_ADMIN_KEY,
  MCP_API_KEY: STRONG_MCP_KEY,
  PUBLIC_BASE_URL: "https://license.example.test",
  MCP_PUBLIC_URL: "https://mcp.example.test/mcp",
  DB_SINGLE_WRITER_ENFORCED: "true",
  BACKUP_EXPORT_KEY: "",
  BACKUP_EXPORT_DIRECTORY: "",
  BACKUP_EXPORT_POLICY: "",
});

assert.equal(
  productionConfigWithoutBackupExport.effectiveProduction,
  true,
  "startup should still resolve Railway production correctly when backup export is not configured"
);
assert.equal(
  productionConfigWithoutBackupExport.backupExportKey,
  "",
  "backup export should remain feature-gated instead of blocking production startup"
);
assert.equal(productionConfigWithoutBackupExport.backupExportDirectory, "");
assert.equal(productionConfigWithoutBackupExport.backupExportPolicy, "");

const productionFreeBillingConfig = reloadRuntimeConfig({
  NODE_ENV: "production",
  PORT: "8787",
  DATABASE_URL: "postgres://unit-test",
  DATABASE_SSL: "false",
  DB_POOL_MAX: "10",
  DB_STATEMENT_TIMEOUT_MS: "5000",
  DATA_ENCRYPTION_KEY: "data-production-secret-123456789012",
  HAZIFY_BILLING_MODE: "free",
  ADMIN_API_KEY: STRONG_ADMIN_KEY,
  MCP_API_KEY: STRONG_MCP_KEY,
  PUBLIC_BASE_URL: "https://license.example.test",
  MCP_PUBLIC_URL: "https://mcp.example.test/mcp",
  DB_SINGLE_WRITER_ENFORCED: "true",
});
assert.equal(productionFreeBillingConfig.effectiveProduction, true);
assert.equal(productionFreeBillingConfig.billingMode, "free");
assert.equal(productionFreeBillingConfig.freeMode, true);
assert.equal(productionFreeBillingConfig.stripeBillingEnabled, false);

assert.throws(
  () =>
    reloadRuntimeConfig({
      NODE_ENV: "production",
      PORT: "8787",
      DATABASE_URL: "postgres://unit-test",
      DATABASE_SSL: "false",
      DB_POOL_MAX: "10",
      DB_STATEMENT_TIMEOUT_MS: "5000",
      DATA_ENCRYPTION_KEY: "generate-a-long-random-encryption-key",
      HAZIFY_BILLING_MODE: "free",
      ADMIN_API_KEY: STRONG_ADMIN_KEY,
      MCP_API_KEY: STRONG_MCP_KEY,
      PUBLIC_BASE_URL: "https://license.example.test",
      MCP_PUBLIC_URL: "https://mcp.example.test/mcp",
      DB_SINGLE_WRITER_ENFORCED: "true",
    }),
  /DATA_ENCRYPTION_KEY moet in productie een sterke secret/,
  "production startup should reject placeholder data encryption keys"
);

assert.throws(
  () =>
    reloadRuntimeConfig({
      NODE_ENV: "production",
      PORT: "8787",
      DATABASE_URL: "postgres://unit-test",
      DATABASE_SSL: "false",
      DB_POOL_MAX: "10",
      DB_STATEMENT_TIMEOUT_MS: "5000",
      DATA_ENCRYPTION_KEY: "data-production-secret-123456789012",
      HAZIFY_FREE_MODE: "false",
      ADMIN_API_KEY: "change-this-admin-key",
      MCP_API_KEY: STRONG_MCP_KEY,
      PUBLIC_BASE_URL: "https://license.example.test",
      MCP_PUBLIC_URL: "https://mcp.example.test/mcp",
      DB_SINGLE_WRITER_ENFORCED: "true",
    }),
  /ADMIN_API_KEY moet in productie een sterke secret/,
  "production startup should reject placeholder admin secrets"
);

assert.throws(
  () =>
    reloadRuntimeConfig({
      NODE_ENV: "production",
      PORT: "8787",
      DATABASE_URL: "postgres://unit-test",
      DATABASE_SSL: "false",
      DB_POOL_MAX: "10",
      DB_STATEMENT_TIMEOUT_MS: "5000",
      DATA_ENCRYPTION_KEY: "data-production-secret-123456789012",
      HAZIFY_FREE_MODE: "false",
      ADMIN_API_KEY: STRONG_ADMIN_KEY,
      MCP_API_KEY: STRONG_ADMIN_KEY,
      PUBLIC_BASE_URL: "https://license.example.test",
      MCP_PUBLIC_URL: "https://mcp.example.test/mcp",
      DB_SINGLE_WRITER_ENFORCED: "true",
    }),
  /ADMIN_API_KEY en MCP_API_KEY moeten verschillende productie-secrets zijn/,
  "production startup should reject reused admin and MCP secrets"
);

assert.throws(
  () =>
    reloadRuntimeConfig({
      NODE_ENV: "production",
      PORT: "8787",
      DATABASE_URL: "postgres://unit-test",
      DATABASE_SSL: "false",
      DB_POOL_MAX: "10",
      DB_STATEMENT_TIMEOUT_MS: "5000",
      DATA_ENCRYPTION_KEY: "data-production-secret-123456789012",
      HAZIFY_FREE_MODE: "false",
      HAZIFY_AUTO_ACTIVATE_SIGNUP_LICENSES: "true",
      ADMIN_API_KEY: STRONG_ADMIN_KEY,
      MCP_API_KEY: STRONG_MCP_KEY,
      PUBLIC_BASE_URL: "https://license.example.test",
      MCP_PUBLIC_URL: "https://mcp.example.test/mcp",
      DB_SINGLE_WRITER_ENFORCED: "true",
    }),
  /HAZIFY_AUTO_ACTIVATE_SIGNUP_LICENSES mag niet actief zijn in productie/,
  "production startup should reject signup auto-activation"
);

console.log("runtime-config.test.mjs passed");
