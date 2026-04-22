import crypto from "crypto";
import fs from "fs/promises";
import path from "path";

export function createAdminHandlers({
  appRoot,
  db,
  config,
  validStatuses,
  json,
  nowIso,
  persistDb,
  requireAdmin,
  readBody,
  randomId,
  generateLicenseKey,
  canonicalLicense,
  defaultLicenseSubscription,
  defaultTenantSubscriptionProfile,
  defaultEntitlements,
  ensureLicenseRecordShape,
  ensureTenantRecordShape,
  validateTenantShopifyPayload,
  validateShopifyCredentialsLive,
  buildTenantShopifyRecord,
  createMcpTokenForTenant,
  revokeTenantAuthArtifacts,
  storage,
  logEvent,
}) {
  async function handleAdminCreate(req, res) {
    if (!requireAdmin(req, res)) {
      return;
    }
    const { json: payload } = await readBody(req);
    const status = payload.status && validStatuses.has(payload.status) ? payload.status : "active";
    const licenseKey = payload.licenseKey || generateLicenseKey();
    if (db.licenses[licenseKey]) {
      return json(res, 409, { error: "exists", message: "license already exists" });
    }
    db.licenses[licenseKey] = ensureLicenseRecordShape({
      licenseKey,
      status,
      entitlements:
        payload.entitlements && typeof payload.entitlements === "object"
          ? payload.entitlements
          : { mutations: true, tools: {} },
      maxActivations: Number(payload.maxActivations || 3),
      stripeCustomerId: payload.stripeCustomerId || null,
      stripeSubscriptionId: payload.stripeSubscriptionId || null,
      boundFingerprints: [],
      createdAt: nowIso(),
      updatedAt: nowIso(),
      pastDueSince: status === "past_due" ? nowIso() : null,
      canceledAt: status === "canceled" || status === "unpaid" ? nowIso() : null,
    });
    await persistDb();
    return json(res, 201, {
      licenseKey,
      ...canonicalLicense(db.licenses[licenseKey]),
    });
  }

  async function handleAdminUpdateStatus(req, res) {
    if (!requireAdmin(req, res)) {
      return;
    }
    const { json: payload } = await readBody(req);
    const record = db.licenses[payload.licenseKey];
    if (!record) {
      return json(res, 404, { error: "not_found" });
    }
    if (!validStatuses.has(payload.status)) {
      return json(res, 400, { error: "invalid_status" });
    }
    ensureLicenseRecordShape(record);
    record.status = payload.status;
    record.subscription.status = payload.status;
    record.updatedAt = nowIso();
    if (payload.status === "past_due") {
      record.pastDueSince = record.pastDueSince || nowIso();
    }
    if (payload.status === "canceled" || payload.status === "unpaid") {
      record.canceledAt = record.canceledAt || nowIso();
      record.subscription.canceledAt = record.canceledAt;
    }
    if (payload.status === "active") {
      record.pastDueSince = null;
      record.canceledAt = null;
      record.subscription.canceledAt = null;
    }
    await persistDb();
    return json(res, 200, {
      licenseKey: payload.licenseKey,
      ...canonicalLicense(record),
    });
  }

  async function handleAdminUpsertTenant(req, res) {
    if (!requireAdmin(req, res)) {
      return;
    }

    try {
      const { json: payload } = await readBody(req);
      if (typeof payload.licenseKey !== "string" || !payload.licenseKey.trim()) {
        throw new Error("licenseKey is required");
      }

      const licenseKey = payload.licenseKey.trim();
      const license = db.licenses[licenseKey];
      if (!license) {
        return json(res, 404, { error: "license_not_found" });
      }

      const shopify = validateTenantShopifyPayload(payload);
      await validateShopifyCredentialsLive(shopify);
      const tenantId =
        typeof payload.tenantId === "string" && payload.tenantId.trim()
          ? payload.tenantId.trim()
          : randomId("tenant");
      const now = nowIso();
      const existing = db.tenants[tenantId];

      db.tenants[tenantId] = ensureTenantRecordShape({
        tenantId,
        licenseKey,
        label:
          typeof payload.label === "string" && payload.label.trim()
            ? payload.label.trim()
            : existing?.label || null,
        shopify: buildTenantShopifyRecord(shopify, {
          validatedAt: now,
          lastValidationAt: now,
          lastValidationError: null,
        }),
        createdAt: existing?.createdAt || now,
        updatedAt: now,
      });

      await persistDb();

      return json(res, existing ? 200 : 201, {
        tenantId,
        licenseKey,
        label: db.tenants[tenantId].label,
        shopify: {
          domain: db.tenants[tenantId].shopify.domain,
          hasAccessToken: !!db.tenants[tenantId].shopify.accessToken,
          hasClientCredentials:
            !!db.tenants[tenantId].shopify.clientId && !!db.tenants[tenantId].shopify.clientSecret,
        },
        license: canonicalLicense(license),
      });
    } catch (error) {
      return json(res, 400, {
        error: "bad_request",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async function handleAdminCreateMcpToken(req, res) {
    if (!requireAdmin(req, res)) {
      return;
    }

    try {
      const { json: payload } = await readBody(req);

      let tenantId =
        typeof payload.tenantId === "string" && payload.tenantId.trim() ? payload.tenantId.trim() : "";

      if (!tenantId) {
        if (typeof payload.licenseKey !== "string" || !payload.licenseKey.trim()) {
          throw new Error("tenantId or licenseKey is required");
        }
        const licenseKey = payload.licenseKey.trim();
        if (!db.licenses[licenseKey]) {
          return json(res, 404, { error: "license_not_found" });
        }
        const shopify = validateTenantShopifyPayload(payload);
        await validateShopifyCredentialsLive(shopify);
        tenantId = randomId("tenant");
        db.tenants[tenantId] = ensureTenantRecordShape({
          tenantId,
          licenseKey,
          label:
            typeof payload.label === "string" && payload.label.trim() ? payload.label.trim() : null,
          shopify: buildTenantShopifyRecord(shopify, {
            validatedAt: nowIso(),
            lastValidationAt: nowIso(),
            lastValidationError: null,
          }),
          createdAt: nowIso(),
          updatedAt: nowIso(),
        });
      }

      const tenant = db.tenants[tenantId];
      if (!tenant) {
        return json(res, 404, { error: "tenant_not_found" });
      }
      ensureTenantRecordShape(tenant);

      const token = createMcpTokenForTenant(tenantId, {
        name: payload.name,
        expiresInDays: payload.expiresInDays,
      });

      await persistDb();

      return json(res, 201, {
        tokenId: token.tokenId,
        accessToken: token.accessToken,
        tenantId,
        licenseKey: tenant.licenseKey,
        expiresAt: token.expiresAt,
        license: canonicalLicense(token.license),
        shopify: {
          domain: tenant.shopify?.domain || null,
          hasAccessToken: !!tenant.shopify?.accessToken,
          hasClientCredentials: !!tenant.shopify?.clientId && !!tenant.shopify?.clientSecret,
        },
      });
    } catch (error) {
      return json(res, 400, {
        error: "bad_request",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async function handleAdminRevokeMcpToken(req, res) {
    if (!requireAdmin(req, res)) {
      return;
    }
    try {
      const { json: payload } = await readBody(req);
      if (typeof payload.tokenId !== "string" || !payload.tokenId.trim()) {
        throw new Error("tokenId is required");
      }
      const tokenId = payload.tokenId.trim();
      const token = db.mcpTokens[tokenId];
      if (!token) {
        return json(res, 404, { error: "token_not_found" });
      }
      token.status = "revoked";
      token.updatedAt = nowIso();
      await persistDb();
      return json(res, 200, { ok: true, tokenId });
    } catch (error) {
      return json(res, 400, {
        error: "bad_request",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async function handleAdminRevalidateTenants(req, res) {
    if (!requireAdmin(req, res)) {
      return;
    }
    try {
      const { json: payload } = await readBody(req);
      const revokeInvalidTokens = payload?.revokeInvalidTokens === true;
      const tenantRecords = Object.values(db.tenants).filter(Boolean);
      const summary = {
        total: tenantRecords.length,
        valid: 0,
        invalid: 0,
        tokensRevoked: {
          mcp: 0,
          oauthRefresh: 0,
        },
        invalidTenants: [],
      };

      for (const tenant of tenantRecords) {
        ensureTenantRecordShape(tenant);
        const sourceShopify = tenant.shopify && typeof tenant.shopify === "object" ? tenant.shopify : {};
        const now = nowIso();
        try {
          const credentials = validateTenantShopifyPayload({
            shopDomain: sourceShopify.domain,
            shopAccessToken: sourceShopify.accessToken,
            shopClientId: sourceShopify.clientId,
            shopClientSecret: sourceShopify.clientSecret,
          });
          await validateShopifyCredentialsLive(credentials);
          tenant.shopify = buildTenantShopifyRecord(credentials, {
            validatedAt: now,
            lastValidationAt: now,
            lastValidationError: null,
          });
          tenant.updatedAt = now;
          summary.valid += 1;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          tenant.shopify = buildTenantShopifyRecord(sourceShopify, {
            validatedAt: null,
            lastValidationAt: now,
            lastValidationError: message,
          });
          tenant.updatedAt = now;
          summary.invalid += 1;
          summary.invalidTenants.push({
            tenantId: tenant.tenantId,
            label: tenant.label || null,
            domain: tenant.shopify?.domain || null,
            error: message,
          });
          if (revokeInvalidTokens) {
            const revoked = revokeTenantAuthArtifacts(tenant.tenantId);
            summary.tokensRevoked.mcp += revoked.revokedMcpTokens;
            summary.tokensRevoked.oauthRefresh += revoked.revokedRefreshTokens;
          }
        }
      }

      await persistDb();
      return json(res, 200, {
        ok: true,
        revalidatedAt: nowIso(),
        revokeInvalidTokens,
        summary,
      });
    } catch (error) {
      return json(res, 400, {
        error: "bad_request",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async function handleAdminStorageExport(req, res) {
    if (!requireAdmin(req, res)) {
      return;
    }
    try {
      const snapshot = await storage.exportSnapshot();
      const timestamp = nowIso();
      const payload = JSON.stringify(snapshot);
      const checksum = crypto.createHash("sha256").update(payload, "utf8").digest("hex");

      const keyMaterial = String(config.backupExportKey || "").trim();
      const backupDirectory = String(config.backupExportDirectory || "").trim();
      const backupPolicy = String(config.backupExportPolicy || "").trim().toLowerCase();
      const isProduction = config.effectiveProduction === true;
      if (isProduction) {
        if (!keyMaterial) {
          throw new Error("BACKUP_EXPORT_KEY is verplicht voor export in productie.");
        }
        if (!backupDirectory) {
          throw new Error("BACKUP_EXPORT_DIRECTORY is verplicht voor export in productie.");
        }
        if (backupPolicy !== "encrypted") {
          throw new Error("BACKUP_EXPORT_POLICY=encrypted is verplicht voor export in productie.");
        }
      }

      let artifact;
      const shouldEncrypt = backupPolicy === "encrypted" || (!backupPolicy && !!keyMaterial);
      if (shouldEncrypt) {
        if (!keyMaterial) {
          throw new Error("BACKUP_EXPORT_KEY is required to encrypt the export.");
        }
        const key = crypto.createHash("sha256").update(keyMaterial, "utf8").digest();
        const iv = crypto.randomBytes(12);
        const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
        const encrypted = Buffer.concat([cipher.update(payload, "utf8"), cipher.final()]);
        const tag = cipher.getAuthTag();
        artifact = {
          timestamp,
          encrypted: true,
          algorithm: "aes-256-gcm",
          checksum,
          data: Buffer.concat([iv, tag, encrypted]).toString("base64"),
        };
      } else {
        if (isProduction) {
          throw new Error("Plaintext backup exports are not allowed in production.");
        }
        artifact = {
          timestamp,
          encrypted: false,
          checksum,
          data: payload,
        };
      }

      const backupDir = path.resolve(appRoot, backupDirectory || "data/backups");
      await fs.mkdir(backupDir, { recursive: true });
      const fileName = `export-${timestamp.replace(/[:.]/g, "-")}.json`;
      const filePath = path.resolve(backupDir, fileName);
      await fs.writeFile(filePath, JSON.stringify(artifact, null, 2));

      logEvent("storage_export_created", {
        fileName,
        checksum,
        encrypted: artifact.encrypted,
      });

      return json(res, 200, {
        ok: true,
        timestamp,
        checksum,
        encrypted: artifact.encrypted,
        fileName,
        filePath,
        bytes: Buffer.byteLength(JSON.stringify(artifact)),
      });
    } catch (error) {
      return json(res, 500, {
        error: "export_failed",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  function handleAdminLicenseGet(req, res, url) {
    if (!requireAdmin(req, res)) {
      return;
    }
    const licenseKey = decodeURIComponent(url.pathname.replace("/v1/admin/license/", ""));
    const record = db.licenses[licenseKey];
    if (!record) {
      return json(res, 404, { error: "not_found" });
    }
    ensureLicenseRecordShape(record);
    return json(res, 200, {
      licenseKey,
      status: record.status,
      entitlements: record.entitlements,
      maxActivations: record.maxActivations,
      stripeCustomerId: record.stripeCustomerId || null,
      stripeSubscriptionId: record.stripeSubscriptionId || null,
      subscription: record.subscription || defaultLicenseSubscription(record),
      boundFingerprints: record.boundFingerprints || [],
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      pastDueSince: record.pastDueSince || null,
      canceledAt: record.canceledAt || null,
      effective: canonicalLicense(record),
    });
  }

  function handleAdminTenantGet(req, res, url) {
    if (!requireAdmin(req, res)) {
      return;
    }
    const tenantId = decodeURIComponent(url.pathname.replace("/v1/admin/tenant/", ""));
    const tenant = db.tenants[tenantId];
    if (!tenant) {
      return json(res, 404, { error: "not_found" });
    }
    ensureTenantRecordShape(tenant);
    const license = db.licenses[tenant.licenseKey];
    return json(res, 200, {
      tenantId: tenant.tenantId,
      licenseKey: tenant.licenseKey,
      label: tenant.label || null,
      shopify: {
        domain: tenant.shopify?.domain || null,
        hasAccessToken: !!tenant.shopify?.accessToken,
        hasClientCredentials: !!tenant.shopify?.clientId && !!tenant.shopify?.clientSecret,
      },
      subscription: tenant.subscription || defaultTenantSubscriptionProfile(),
      createdAt: tenant.createdAt,
      updatedAt: tenant.updatedAt,
      license: license ? canonicalLicense(license) : null,
    });
  }

  return {
    handleAdminCreate,
    handleAdminUpdateStatus,
    handleAdminUpsertTenant,
    handleAdminCreateMcpToken,
    handleAdminRevokeMcpToken,
    handleAdminRevalidateTenants,
    handleAdminStorageExport,
    handleAdminLicenseGet,
    handleAdminTenantGet,
  };
}
