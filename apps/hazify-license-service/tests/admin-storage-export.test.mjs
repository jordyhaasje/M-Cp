import assert from "assert";
import fs from "fs/promises";
import os from "os";
import path from "path";
import crypto from "crypto";
import { createAdminHandlers } from "../src/routes/admin.js";
import {
  canonicalLicense,
  defaultEntitlements,
  defaultLicenseSubscription,
  defaultTenantSubscriptionProfile,
  ensureLicenseRecordShape,
  ensureTenantRecordShape,
} from "../src/domain/license-records.js";

function createJsonRecorder() {
  const calls = [];
  return {
    calls,
    json(_res, statusCode, payload) {
      calls.push({ statusCode, payload });
    },
  };
}

function createTempDir(name) {
  return fs.mkdtemp(path.join(os.tmpdir(), name));
}

const db = {
  licenses: {
    lic_1: ensureLicenseRecordShape({
      licenseKey: "lic_1",
      status: "active",
      entitlements: defaultEntitlements(),
      subscription: defaultLicenseSubscription({
        licenseKey: "lic_1",
        status: "active",
        entitlements: defaultEntitlements(),
      }),
      maxActivations: 3,
      boundFingerprints: [],
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      pastDueSince: null,
      canceledAt: null,
    }),
  },
  tenants: {
    ten_1: ensureTenantRecordShape({
      tenantId: "ten_1",
      licenseKey: "lic_1",
      label: "Tenant",
      shopify: {
        domain: "tenant.myshopify.com",
        accessToken: "shpat_test",
        clientId: null,
        clientSecret: null,
      },
      subscription: defaultTenantSubscriptionProfile(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }),
  },
  mcpTokens: {},
  oauthClients: {},
  oauthAuthCodes: {},
  oauthRefreshTokens: {},
  accounts: {},
  accountSessions: {},
};

const baseOptions = {
  appRoot: process.cwd(),
  db,
  validStatuses: new Set(["active", "past_due", "canceled", "invalid", "unpaid"]),
  nowIso: () => "2026-04-22T12:00:00.000Z",
  persistDb: async () => {},
  requireAdmin: () => true,
  readBody: async () => ({ json: {} }),
  randomId: () => "id_1",
  generateLicenseKey: () => "HZY-TEST-KEY",
  canonicalLicense,
  defaultLicenseSubscription,
  defaultTenantSubscriptionProfile,
  defaultEntitlements,
  ensureLicenseRecordShape,
  ensureTenantRecordShape,
  validateTenantShopifyPayload: (payload) => ({
    domain: payload.shopDomain || payload.domain || "tenant.myshopify.com",
    accessToken: payload.shopAccessToken || null,
    clientId: payload.shopClientId || null,
    clientSecret: payload.shopClientSecret || null,
  }),
  validateShopifyCredentialsLive: async () => ({}),
  buildTenantShopifyRecord: (shopify) => shopify,
  createMcpTokenForTenant: () => ({ tokenId: "token_1" }),
  revokeTenantAuthArtifacts: () => ({ revokedMcpTokens: 0, revokedRefreshTokens: 0 }),
  storage: {
    async exportSnapshot() {
      return {
        ok: true,
        at: "2026-04-22T12:00:00.000Z",
      };
    },
  },
  logEvent: () => {},
};

{
  const tempDir = await createTempDir("hz-backup-prod-");
  const { calls, json } = createJsonRecorder();
  const handlers = createAdminHandlers({
    ...baseOptions,
    json,
    config: {
      backupExportKey: "backup-secret",
      backupExportDirectory: tempDir,
      backupExportPolicy: "plaintext",
      effectiveProduction: true,
    },
  });

  await handlers.handleAdminStorageExport({}, {});

  assert.equal(calls[0].statusCode, 500, "plain backup export should be rejected in production");
  assert.match(
    String(calls[0].payload.message || ""),
    /BACKUP_EXPORT_POLICY=encrypted is verplicht voor export in productie\./,
    "production plaintext export should be blocked before a write happens"
  );

  const entries = await fs.readdir(tempDir);
  assert.equal(entries.length, 0, "no export file should be created when production plaintext is blocked");
}

{
  const tempDir = await createTempDir("hz-backup-encrypted-");
  const { calls, json } = createJsonRecorder();
  const handlers = createAdminHandlers({
    ...baseOptions,
    json,
    config: {
      backupExportKey: "backup-secret",
      backupExportDirectory: tempDir,
      backupExportPolicy: "encrypted",
      effectiveProduction: true,
    },
  });

  await handlers.handleAdminStorageExport({}, {});

  assert.equal(calls[0].statusCode, 200, "encrypted backup export should succeed in production");
  assert.equal(calls[0].payload.encrypted, true, "production export should be encrypted");
  assert.equal(calls[0].payload.fileName.endsWith(".json"), true);

  const filePath = calls[0].payload.filePath;
  const fileContents = JSON.parse(await fs.readFile(filePath, "utf8"));
  assert.equal(fileContents.encrypted, true, "written export artifact should be encrypted");
  assert.equal(typeof fileContents.data, "string");
  assert.notEqual(
    fileContents.data,
    JSON.stringify({ ok: true, at: "2026-04-22T12:00:00.000Z" }),
    "encrypted export should not store plaintext payload data"
  );

  const checksum = crypto.createHash("sha256").update(JSON.stringify({ ok: true, at: "2026-04-22T12:00:00.000Z" }), "utf8").digest("hex");
  assert.equal(fileContents.checksum, checksum, "checksum should match the exported snapshot payload");
}

console.log("admin-storage-export.test.mjs passed");
