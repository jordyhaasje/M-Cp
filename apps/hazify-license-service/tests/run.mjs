process.env.NODE_ENV = "test";

await import("./oauth-security.test.mjs");
await import("./oauthIssuerPath.test.mjs");
await import("./oauth-helpers.test.mjs");
await import("./http-helpers.test.mjs");
await import("./account-helpers.test.mjs");
await import("./account-sessions.test.mjs");
await import("./billing-helpers.test.mjs");
await import("./license-records.test.mjs");
await import("./runtime-config.test.mjs");
await import("./persist-db.test.mjs");
await import("./admin-storage-export.test.mjs");
await import("./startup-production-env.test.mjs");
await import("./smoke-prod.test.mjs");
await import("./storage-safety.test.mjs");
await import("./postgres-lock-retry.test.mjs");
await import("./postgres-lock.test.mjs");
console.log("All hazify-license-service tests passed");
