import assert from "assert";
import { newDb } from "pg-mem";
import { PostgresStorage } from "../src/repositories/postgres-storage.js";

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function createStorageHarness() {
  const mem = newDb({ autoCreateForeignKeyIndices: true });
  const pg = mem.adapters.createPg();
  const queryLog = [];
  const originalQuery = pg.Client.prototype.query;
  pg.Client.prototype.query = function patchedQuery(...args) {
    const text = typeof args[0] === "string" ? args[0] : args[0]?.text || "";
    queryLog.push(String(text));
    return originalQuery.apply(this, args);
  };

  const pool = new pg.Pool();
  const storage = new PostgresStorage({
    databaseUrl: "postgres://unit-test",
    databaseSsl: false,
    dbPoolMax: 4,
    dbStatementTimeoutMs: 5000,
    encryptionKey: "unit-test-encryption-key",
    singleWriterEnforced: false,
    pool,
  });
  return { storage, queryLog };
}

function buildSeedState() {
  return {
    licenses: {
      lic_a: {
        licenseKey: "lic_a",
        status: "active",
        contactEmail: "owner-a@example.test",
        entitlements: { mutations: true, tools: {} },
        subscription: { provider: "stripe", status: "active", seats: 1, metadata: {} },
        maxActivations: 3,
        boundFingerprints: [],
        stripeCustomerId: "cus_A",
        stripeSubscriptionId: "sub_A",
        createdAt: "2026-03-13T00:00:00.000Z",
        updatedAt: "2026-03-13T00:00:00.000Z",
        pastDueSince: null,
        canceledAt: null,
      },
      lic_b: {
        licenseKey: "lic_b",
        status: "active",
        contactEmail: "owner-b@example.test",
        entitlements: { mutations: true, tools: {} },
        subscription: { provider: "stripe", status: "active", seats: 1, metadata: {} },
        maxActivations: 3,
        boundFingerprints: [],
        stripeCustomerId: "cus_B",
        stripeSubscriptionId: "sub_B",
        createdAt: "2026-03-13T00:00:00.000Z",
        updatedAt: "2026-03-13T00:00:00.000Z",
        pastDueSince: null,
        canceledAt: null,
      },
    },
    tenants: {
      ten_a: {
        tenantId: "ten_a",
        licenseKey: "lic_a",
        label: "Tenant A",
        shopify: {
          domain: "shop-a.myshopify.com",
          accessToken: "shpat_a",
          clientId: null,
          clientSecret: null,
        },
        subscription: { provider: "stripe", status: "active", seats: 1, metadata: {} },
        createdAt: "2026-03-13T00:00:00.000Z",
        updatedAt: "2026-03-13T00:00:00.000Z",
      },
      ten_b: {
        tenantId: "ten_b",
        licenseKey: "lic_b",
        label: "Tenant B",
        shopify: {
          domain: "shop-b.myshopify.com",
          accessToken: "shpat_b",
          clientId: null,
          clientSecret: null,
        },
        subscription: { provider: "stripe", status: "active", seats: 1, metadata: {} },
        createdAt: "2026-03-13T00:00:00.000Z",
        updatedAt: "2026-03-13T00:00:00.000Z",
      },
    },
    mcpTokens: {
      tok_a: {
        tokenId: "tok_a",
        tenantId: "ten_a",
        licenseKey: "lic_a",
        tokenHash: "hash_tok_a",
        name: "Token A",
        oauthClientId: "cli_a",
        oauthRefreshTokenId: "rt_a",
        oauthTokenFamilyId: "fam_a",
        status: "active",
        createdAt: "2026-03-13T00:00:00.000Z",
        updatedAt: "2026-03-13T00:00:00.000Z",
        lastUsedAt: null,
        expiresAt: null,
      },
      tok_b: {
        tokenId: "tok_b",
        tenantId: "ten_b",
        licenseKey: "lic_b",
        tokenHash: "hash_tok_b",
        name: "Token B",
        oauthClientId: "cli_b",
        oauthRefreshTokenId: "rt_b",
        oauthTokenFamilyId: "fam_b",
        status: "active",
        createdAt: "2026-03-13T00:00:00.000Z",
        updatedAt: "2026-03-13T00:00:00.000Z",
        lastUsedAt: null,
        expiresAt: null,
      },
    },
    oauthClients: {
      cli_a: {
        clientId: "cli_a",
        clientName: "Client A",
        redirectUris: ["https://client-a.example.test/callback"],
        grantTypes: ["authorization_code", "refresh_token"],
        responseTypes: ["code"],
        tokenEndpointAuthMethod: "client_secret_post",
        scope: "mcp:tools",
        clientSecretHash: "hash_secret_a",
        status: "active",
        createdAt: "2026-03-13T00:00:00.000Z",
        updatedAt: "2026-03-13T00:00:00.000Z",
      },
      cli_b: {
        clientId: "cli_b",
        clientName: "Client B",
        redirectUris: ["https://client-b.example.test/callback"],
        grantTypes: ["authorization_code", "refresh_token"],
        responseTypes: ["code"],
        tokenEndpointAuthMethod: "client_secret_post",
        scope: "mcp:tools",
        clientSecretHash: "hash_secret_b",
        status: "active",
        createdAt: "2026-03-13T00:00:00.000Z",
        updatedAt: "2026-03-13T00:00:00.000Z",
      },
    },
    oauthAuthCodes: {
      code_a: {
        code: "code_a",
        clientId: "cli_a",
        tenantId: "ten_a",
        licenseKey: "lic_a",
        redirectUri: "https://client-a.example.test/callback",
        scope: "mcp:tools",
        codeChallenge: "challenge_a",
        codeChallengeMethod: "S256",
        status: "active",
        createdAt: "2026-03-13T00:00:00.000Z",
        expiresAt: "2026-03-14T00:00:00.000Z",
        usedAt: null,
      },
      code_b: {
        code: "code_b",
        clientId: "cli_b",
        tenantId: "ten_b",
        licenseKey: "lic_b",
        redirectUri: "https://client-b.example.test/callback",
        scope: "mcp:tools",
        codeChallenge: "challenge_b",
        codeChallengeMethod: "S256",
        status: "active",
        createdAt: "2026-03-13T00:00:00.000Z",
        expiresAt: "2026-03-14T00:00:00.000Z",
        usedAt: null,
      },
    },
    oauthRefreshTokens: {
      rt_a: {
        refreshTokenId: "rt_a",
        tokenHash: "hash_rt_a",
        clientId: "cli_a",
        tenantId: "ten_a",
        licenseKey: "lic_a",
        familyId: "fam_a",
        parentRefreshTokenId: null,
        replacedByRefreshTokenId: null,
        scope: "mcp:tools",
        status: "active",
        revokedAt: null,
        replayDetectedAt: null,
        createdAt: "2026-03-13T00:00:00.000Z",
        updatedAt: "2026-03-13T00:00:00.000Z",
        expiresAt: "2026-04-12T00:00:00.000Z",
      },
      rt_b: {
        refreshTokenId: "rt_b",
        tokenHash: "hash_rt_b",
        clientId: "cli_b",
        tenantId: "ten_b",
        licenseKey: "lic_b",
        familyId: "fam_b",
        parentRefreshTokenId: null,
        replacedByRefreshTokenId: null,
        scope: "mcp:tools",
        status: "active",
        revokedAt: null,
        replayDetectedAt: null,
        createdAt: "2026-03-13T00:00:00.000Z",
        updatedAt: "2026-03-13T00:00:00.000Z",
        expiresAt: "2026-04-12T00:00:00.000Z",
      },
    },
    accounts: {
      acct_a: {
        accountId: "acct_a",
        email: "acct-a@example.test",
        name: "Account A",
        passwordSalt: "salt_a",
        passwordHash: "hash_a",
        licenseKey: "lic_a",
        status: "active",
        createdAt: "2026-03-13T00:00:00.000Z",
        updatedAt: "2026-03-13T00:00:00.000Z",
        lastLoginAt: "2026-03-13T00:00:00.000Z",
      },
      acct_b: {
        accountId: "acct_b",
        email: "acct-b@example.test",
        name: "Account B",
        passwordSalt: "salt_b",
        passwordHash: "hash_b",
        licenseKey: "lic_b",
        status: "active",
        createdAt: "2026-03-13T00:00:00.000Z",
        updatedAt: "2026-03-13T00:00:00.000Z",
        lastLoginAt: "2026-03-13T00:00:00.000Z",
      },
    },
    accountSessions: {
      sess_a: {
        sessionId: "sess_a",
        accountId: "acct_a",
        tokenHash: "hash_sess_a",
        status: "active",
        createdAt: "2026-03-13T00:00:00.000Z",
        updatedAt: "2026-03-13T00:00:00.000Z",
        expiresAt: "2026-03-20T00:00:00.000Z",
        lastUsedAt: null,
        userAgent: "agent_a",
        ipHash: "ip_a",
      },
      sess_b: {
        sessionId: "sess_b",
        accountId: "acct_b",
        tokenHash: "hash_sess_b",
        status: "active",
        createdAt: "2026-03-13T00:00:00.000Z",
        updatedAt: "2026-03-13T00:00:00.000Z",
        expiresAt: "2026-03-20T00:00:00.000Z",
        lastUsedAt: null,
        userAgent: "agent_b",
        ipHash: "ip_b",
      },
    },
  };
}

function assertBucketCount(state, bucketName, expectedCount) {
  const actual = Object.keys(state[bucketName] || {}).length;
  assert.equal(actual, expectedCount, `${bucketName} should contain ${expectedCount} records`);
}

async function testEntityInsertUpdateDeleteAndNoDestructiveRewrite() {
  const { storage, queryLog } = createStorageHarness();
  await storage.init();
  const seed = buildSeedState();
  await storage.persistState(seed);

  const afterInsert = await storage.loadState();
  for (const bucketName of [
    "licenses",
    "tenants",
    "mcpTokens",
    "oauthClients",
    "oauthAuthCodes",
    "oauthRefreshTokens",
    "accounts",
    "accountSessions",
  ]) {
    assertBucketCount(afterInsert, bucketName, 2);
  }

  const updated = deepClone(seed);
  updated.licenses.lic_a.status = "past_due";
  updated.licenses.lic_a.pastDueSince = "2026-03-14T00:00:00.000Z";
  updated.tenants.ten_a.label = "Tenant A Updated";
  updated.accounts.acct_a.name = "Account A Updated";
  updated.accountSessions.sess_a.lastUsedAt = "2026-03-14T00:00:00.000Z";
  updated.oauthClients.cli_a.clientName = "Client A Updated";
  updated.oauthAuthCodes.code_a.status = "used";
  updated.oauthAuthCodes.code_a.usedAt = "2026-03-14T00:00:00.000Z";
  updated.mcpTokens.tok_a.status = "revoked";
  updated.mcpTokens.tok_a.updatedAt = "2026-03-14T00:00:00.000Z";
  updated.oauthRefreshTokens.rt_a.status = "rotated";
  updated.oauthRefreshTokens.rt_a.replacedByRefreshTokenId = "rt_a_next";
  updated.oauthRefreshTokens.rt_a.updatedAt = "2026-03-14T00:00:00.000Z";
  updated.oauthRefreshTokens.rt_a_next = {
    refreshTokenId: "rt_a_next",
    tokenHash: "hash_rt_a_next",
    clientId: "cli_a",
    tenantId: "ten_a",
    licenseKey: "lic_a",
    familyId: "fam_a",
    parentRefreshTokenId: "rt_a",
    replacedByRefreshTokenId: null,
    scope: "mcp:tools",
    status: "active",
    revokedAt: null,
    replayDetectedAt: null,
    createdAt: "2026-03-14T00:00:00.000Z",
    updatedAt: "2026-03-14T00:00:00.000Z",
    expiresAt: "2026-04-13T00:00:00.000Z",
  };

  await storage.persistState(updated);
  const afterUpdateDelete = await storage.loadState();
  assertBucketCount(afterUpdateDelete, "licenses", 2);
  assertBucketCount(afterUpdateDelete, "tenants", 2);
  assertBucketCount(afterUpdateDelete, "mcpTokens", 2);
  assertBucketCount(afterUpdateDelete, "oauthClients", 2);
  assertBucketCount(afterUpdateDelete, "oauthAuthCodes", 2);
  assertBucketCount(afterUpdateDelete, "oauthRefreshTokens", 3);
  assertBucketCount(afterUpdateDelete, "accounts", 2);
  assertBucketCount(afterUpdateDelete, "accountSessions", 2);
  assert.equal(afterUpdateDelete.licenses.lic_a.status, "past_due");
  assert.equal(afterUpdateDelete.oauthRefreshTokens.rt_a.status, "rotated");
  assert.equal(afterUpdateDelete.oauthRefreshTokens.rt_a_next.status, "active");

  await storage.persistState({
    licenses: {},
    tenants: {},
    mcpTokens: {},
    oauthClients: {},
    oauthAuthCodes: {},
    oauthRefreshTokens: {},
    accounts: {},
    accountSessions: {},
  });
  const afterFullDelete = await storage.loadState();
  for (const bucketName of [
    "licenses",
    "tenants",
    "mcpTokens",
    "oauthClients",
    "oauthAuthCodes",
    "oauthRefreshTokens",
    "accounts",
    "accountSessions",
  ]) {
    assertBucketCount(afterFullDelete, bucketName, 0);
  }

  const destructiveTruncate = queryLog.some((sql) => /\bTRUNCATE\b/i.test(sql));
  assert.equal(destructiveTruncate, false, "runtime persistence should not execute TRUNCATE");

  const fullTableDelete = queryLog.some((sql) => /^\s*DELETE\s+FROM\s+\w+\s*;?\s*$/i.test(sql));
  assert.equal(fullTableDelete, false, "runtime persistence should not perform full-table DELETE");

  const targetedDelete = queryLog.some((sql) => /DELETE\s+FROM\s+\w+\s+WHERE\s+\w+\s*=\s*\$1/i.test(sql));
  assert.equal(targetedDelete, true, "runtime persistence should perform targeted per-entity deletes");

  await storage.close();
}

async function testRefreshRotationAndFamilyRevocationPersistence() {
  const { storage } = createStorageHarness();
  await storage.init();
  const state = buildSeedState();

  state.oauthRefreshTokens = { rt_a: state.oauthRefreshTokens.rt_a };
  state.oauthClients = { cli_a: state.oauthClients.cli_a };
  state.oauthAuthCodes = {};
  state.mcpTokens = { tok_a: state.mcpTokens.tok_a };
  state.tenants = { ten_a: state.tenants.ten_a };
  state.licenses = { lic_a: state.licenses.lic_a };
  state.accounts = { acct_a: state.accounts.acct_a };
  state.accountSessions = { sess_a: state.accountSessions.sess_a };
  await storage.persistState(state);

  const rotated = deepClone(state);
  rotated.oauthRefreshTokens.rt_a.status = "rotated";
  rotated.oauthRefreshTokens.rt_a.updatedAt = "2026-03-15T00:00:00.000Z";
  rotated.oauthRefreshTokens.rt_a.replacedByRefreshTokenId = "rt_a_next";
  rotated.oauthRefreshTokens.rt_a_next = {
    refreshTokenId: "rt_a_next",
    tokenHash: "hash_rt_a_next",
    clientId: "cli_a",
    tenantId: "ten_a",
    licenseKey: "lic_a",
    familyId: "fam_a",
    parentRefreshTokenId: "rt_a",
    replacedByRefreshTokenId: null,
    scope: "mcp:tools",
    status: "active",
    revokedAt: null,
    replayDetectedAt: null,
    createdAt: "2026-03-15T00:00:00.000Z",
    updatedAt: "2026-03-15T00:00:00.000Z",
    expiresAt: "2026-04-15T00:00:00.000Z",
  };
  rotated.mcpTokens.tok_a.oauthRefreshTokenId = "rt_a_next";
  rotated.mcpTokens.tok_a.oauthTokenFamilyId = "fam_a";
  rotated.mcpTokens.tok_a.status = "active";
  rotated.mcpTokens.tok_a.updatedAt = "2026-03-15T00:00:00.000Z";
  await storage.persistState(rotated);

  const afterRotation = await storage.loadState();
  assert.equal(afterRotation.oauthRefreshTokens.rt_a.status, "rotated");
  assert.equal(afterRotation.oauthRefreshTokens.rt_a_next.status, "active");
  assert.equal(afterRotation.oauthRefreshTokens.rt_a_next.parentRefreshTokenId, "rt_a");
  assert.equal(afterRotation.mcpTokens.tok_a.oauthRefreshTokenId, "rt_a_next");

  const revokedFamily = deepClone(afterRotation);
  revokedFamily.oauthRefreshTokens.rt_a.status = "revoked";
  revokedFamily.oauthRefreshTokens.rt_a.revokedAt = "2026-03-16T00:00:00.000Z";
  revokedFamily.oauthRefreshTokens.rt_a.replayDetectedAt = "2026-03-16T00:00:00.000Z";
  revokedFamily.oauthRefreshTokens.rt_a.updatedAt = "2026-03-16T00:00:00.000Z";
  revokedFamily.oauthRefreshTokens.rt_a_next.status = "revoked";
  revokedFamily.oauthRefreshTokens.rt_a_next.revokedAt = "2026-03-16T00:00:00.000Z";
  revokedFamily.oauthRefreshTokens.rt_a_next.replayDetectedAt = "2026-03-16T00:00:00.000Z";
  revokedFamily.oauthRefreshTokens.rt_a_next.updatedAt = "2026-03-16T00:00:00.000Z";
  revokedFamily.mcpTokens.tok_a.status = "revoked";
  revokedFamily.mcpTokens.tok_a.updatedAt = "2026-03-16T00:00:00.000Z";
  await storage.persistState(revokedFamily);

  const afterRevocation = await storage.loadState();
  assert.equal(afterRevocation.oauthRefreshTokens.rt_a.status, "revoked");
  assert.equal(afterRevocation.oauthRefreshTokens.rt_a_next.status, "revoked");
  assert.equal(afterRevocation.oauthRefreshTokens.rt_a_next.replayDetectedAt, "2026-03-16T00:00:00.000Z");
  assert.equal(afterRevocation.mcpTokens.tok_a.status, "revoked");

  await storage.close();
}

async function testMcpTokenAndAccountSessionPersistence() {
  const { storage } = createStorageHarness();
  await storage.init();
  const state = buildSeedState();
  await storage.persistState(state);

  const mutated = deepClone(state);
  mutated.mcpTokens.tok_a.status = "revoked";
  mutated.mcpTokens.tok_a.updatedAt = "2026-03-17T00:00:00.000Z";
  mutated.accountSessions.sess_a.status = "revoked";
  mutated.accountSessions.sess_a.lastUsedAt = "2026-03-17T00:00:00.000Z";
  mutated.accountSessions.sess_a.updatedAt = "2026-03-17T00:00:00.000Z";
  await storage.persistState(mutated);

  const reloaded = await storage.loadState();
  assert.equal(reloaded.mcpTokens.tok_a.status, "revoked");
  assert.equal(reloaded.accountSessions.sess_a.status, "revoked");
  assert.equal(reloaded.accountSessions.sess_a.lastUsedAt, "2026-03-17T00:00:00.000Z");

  await storage.close();
}

await testEntityInsertUpdateDeleteAndNoDestructiveRewrite();
await testRefreshRotationAndFamilyRevocationPersistence();
await testMcpTokenAndAccountSessionPersistence();
console.log("storage-safety.test.mjs passed");
