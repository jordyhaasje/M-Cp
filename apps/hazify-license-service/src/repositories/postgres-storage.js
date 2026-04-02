import crypto from "crypto";
import { isDeepStrictEqual } from "util";
import { Pool } from "pg";
import { createInitialState } from "./json-storage.js";

function toJson(value, fallback = null) {
  if (value === null || value === undefined) {
    return fallback;
  }
  if (typeof value === "object") {
    return value;
  }
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function isTruthy(value, fallback = false) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  return fallback;
}

function createCryptoHelper(rawKey) {
  const key = typeof rawKey === "string" && rawKey.trim() ? rawKey.trim() : "";
  if (!key) {
    return {
      enabled: false,
      encrypt(value) {
        return value ?? null;
      },
      decrypt(value) {
        return value ?? null;
      },
    };
  }

  const derivedKey = crypto.createHash("sha256").update(key, "utf8").digest();

  return {
    enabled: true,
    encrypt(value) {
      if (value === null || value === undefined || value === "") {
        return null;
      }
      const plain = Buffer.from(String(value), "utf8");
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv("aes-256-gcm", derivedKey, iv);
      const encrypted = Buffer.concat([cipher.update(plain), cipher.final()]);
      const tag = cipher.getAuthTag();
      return `encv1:${Buffer.concat([iv, tag, encrypted]).toString("base64")}`;
    },
    decrypt(value) {
      if (value === null || value === undefined || value === "") {
        return null;
      }
      const text = String(value);
      if (!text.startsWith("encv1:")) {
        return text;
      }
      const payload = Buffer.from(text.slice(6), "base64");
      const iv = payload.subarray(0, 12);
      const tag = payload.subarray(12, 28);
      const encrypted = payload.subarray(28);
      const decipher = crypto.createDecipheriv("aes-256-gcm", derivedKey, iv);
      decipher.setAuthTag(tag);
      const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
      return decrypted.toString("utf8");
    },
  };
}

function rowMap(rows, keyName, mapFn = (value) => value) {
  return Object.fromEntries(rows.map((row) => [row[keyName], mapFn(row)]));
}

function ensureBucketObject(value) {
  return value && typeof value === "object" ? value : {};
}

function normalizeStateShape(state) {
  const source = state && typeof state === "object" ? state : {};
  return {
    licenses: ensureBucketObject(source.licenses),
    tenants: ensureBucketObject(source.tenants),
    mcpTokens: ensureBucketObject(source.mcpTokens),
    oauthClients: ensureBucketObject(source.oauthClients),
    oauthAuthCodes: ensureBucketObject(source.oauthAuthCodes),
    oauthRefreshTokens: ensureBucketObject(source.oauthRefreshTokens),
    accounts: ensureBucketObject(source.accounts),
    accountSessions: ensureBucketObject(source.accountSessions),
  };
}

export class PostgresStorage {
  constructor({
    databaseUrl,
    databaseSsl,
    dbPoolMax,
    dbStatementTimeoutMs,
    encryptionKey,
    singleWriterEnforced = true,
    singleWriterLockKey = 19450603,
    pool = null,
  }) {
    this.pool =
      pool ||
      new Pool({
        connectionString: databaseUrl,
        max: Number(dbPoolMax || 10),
        statement_timeout: Number(dbStatementTimeoutMs || 5000),
        ssl: isTruthy(databaseSsl, true) ? { rejectUnauthorized: false } : false,
      });
    this.crypto = createCryptoHelper(encryptionKey);
    this.singleWriterEnforced = Boolean(singleWriterEnforced);
    this.singleWriterLockKey = Number(singleWriterLockKey);
    this.writerLockClient = null;
    this.closed = false;
  }

  async init() {
    if (this.closed) {
      throw new Error("Postgres storage is closed");
    }
    await this.ensureSchema();
    await this.acquireWriterLock();
  }

  async acquireWriterLock() {
    if (!this.singleWriterEnforced) {
      return;
    }
    if (!Number.isSafeInteger(this.singleWriterLockKey)) {
      throw new Error("Invalid single-writer advisory lock key");
    }
    if (this.writerLockClient) {
      return;
    }
    const client = await this.pool.connect();
    try {
      const result = await client.query("SELECT pg_try_advisory_lock($1::bigint) AS acquired", [
        String(this.singleWriterLockKey),
      ]);
      const acquired = Boolean(result.rows?.[0]?.acquired);
      if (!acquired) {
        throw new Error(
          `Failed to acquire Postgres single-writer advisory lock (${this.singleWriterLockKey}). Another writer instance is active.`
        );
      }
      this.writerLockClient = client;
    } catch (error) {
      client.release();
      throw error;
    }
  }

  async close() {
    if (this.closed) {
      return;
    }
    this.closed = true;
    if (this.writerLockClient) {
      try {
        await this.writerLockClient.query("SELECT pg_advisory_unlock($1::bigint)", [
          String(this.singleWriterLockKey),
        ]);
      } catch {
        // best effort unlock
      }
      this.writerLockClient.release();
      this.writerLockClient = null;
    }
    await this.pool.end();
  }

  async ensureSchema() {
    const sql = `
CREATE TABLE IF NOT EXISTS licenses (
  license_key TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  contact_email TEXT,
  entitlements_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  subscription_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  max_activations INTEGER NOT NULL DEFAULT 3,
  bound_fingerprints_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  past_due_since TIMESTAMPTZ,
  canceled_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS tenants (
  tenant_id TEXT PRIMARY KEY,
  license_key TEXT NOT NULL REFERENCES licenses(license_key) ON DELETE CASCADE,
  label TEXT,
  shop_domain TEXT NOT NULL,
  shop_access_token_enc TEXT,
  shop_client_id_enc TEXT,
  shop_client_secret_enc TEXT,
  subscription_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS accounts (
  account_id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  license_key TEXT NOT NULL REFERENCES licenses(license_key) ON DELETE RESTRICT,
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  last_login_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS account_sessions (
  session_id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(account_id) ON DELETE CASCADE,
  token_hash TEXT UNIQUE NOT NULL,
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ,
  user_agent TEXT,
  ip_hash TEXT
);

CREATE TABLE IF NOT EXISTS mcp_tokens (
  token_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  license_key TEXT REFERENCES licenses(license_key) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  name TEXT,
  oauth_client_id TEXT,
  oauth_refresh_token_id TEXT,
  oauth_token_family_id TEXT,
  scope TEXT,
  target_resource TEXT,
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS oauth_clients (
  client_id TEXT PRIMARY KEY,
  client_name TEXT NOT NULL,
  redirect_uris_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  grant_types_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  response_types_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  token_endpoint_auth_method TEXT,
  scope TEXT,
  client_secret_hash TEXT,
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS oauth_auth_codes (
  code TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES oauth_clients(client_id) ON DELETE CASCADE,
  tenant_id TEXT NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  license_key TEXT NOT NULL REFERENCES licenses(license_key) ON DELETE CASCADE,
  redirect_uri TEXT NOT NULL,
  scope TEXT,
  target_resource TEXT,
  code_challenge TEXT,
  code_challenge_method TEXT,
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  used_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS oauth_refresh_tokens (
  refresh_token_id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL,
  client_id TEXT NOT NULL REFERENCES oauth_clients(client_id) ON DELETE CASCADE,
  tenant_id TEXT NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  license_key TEXT NOT NULL REFERENCES licenses(license_key) ON DELETE CASCADE,
  family_id TEXT,
  parent_refresh_token_id TEXT REFERENCES oauth_refresh_tokens(refresh_token_id) ON DELETE SET NULL,
  replaced_by_refresh_token_id TEXT REFERENCES oauth_refresh_tokens(refresh_token_id) ON DELETE SET NULL,
  scope TEXT,
  target_resource TEXT,
  status TEXT NOT NULL,
  revoked_at TIMESTAMPTZ,
  replay_detected_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ
);

ALTER TABLE mcp_tokens ADD COLUMN IF NOT EXISTS license_key TEXT REFERENCES licenses(license_key) ON DELETE CASCADE;
ALTER TABLE mcp_tokens ADD COLUMN IF NOT EXISTS oauth_client_id TEXT;
ALTER TABLE mcp_tokens ADD COLUMN IF NOT EXISTS oauth_refresh_token_id TEXT;
ALTER TABLE mcp_tokens ADD COLUMN IF NOT EXISTS oauth_token_family_id TEXT;
ALTER TABLE mcp_tokens ADD COLUMN IF NOT EXISTS scope TEXT;
ALTER TABLE mcp_tokens ADD COLUMN IF NOT EXISTS target_resource TEXT;

ALTER TABLE oauth_refresh_tokens ADD COLUMN IF NOT EXISTS family_id TEXT;
ALTER TABLE oauth_refresh_tokens ADD COLUMN IF NOT EXISTS parent_refresh_token_id TEXT REFERENCES oauth_refresh_tokens(refresh_token_id) ON DELETE SET NULL;
ALTER TABLE oauth_refresh_tokens ADD COLUMN IF NOT EXISTS replaced_by_refresh_token_id TEXT REFERENCES oauth_refresh_tokens(refresh_token_id) ON DELETE SET NULL;
ALTER TABLE oauth_refresh_tokens ADD COLUMN IF NOT EXISTS target_resource TEXT;
ALTER TABLE oauth_refresh_tokens ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ;
ALTER TABLE oauth_refresh_tokens ADD COLUMN IF NOT EXISTS replay_detected_at TIMESTAMPTZ;

ALTER TABLE oauth_auth_codes ADD COLUMN IF NOT EXISTS target_resource TEXT;

CREATE INDEX IF NOT EXISTS idx_mcp_tokens_tenant ON mcp_tokens(tenant_id);
CREATE INDEX IF NOT EXISTS idx_mcp_tokens_hash ON mcp_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_mcp_tokens_oauth_client ON mcp_tokens(oauth_client_id);
CREATE INDEX IF NOT EXISTS idx_oauth_auth_codes_client ON oauth_auth_codes(client_id);
CREATE INDEX IF NOT EXISTS idx_oauth_auth_codes_tenant ON oauth_auth_codes(tenant_id);
CREATE INDEX IF NOT EXISTS idx_oauth_refresh_tokens_hash ON oauth_refresh_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_oauth_refresh_tokens_family ON oauth_refresh_tokens(family_id);

CREATE TABLE IF NOT EXISTS theme_drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_domain TEXT NOT NULL,
  status TEXT NOT NULL,
  files_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  reference_input_json JSONB,
  reference_spec_json JSONB,
  lint_report_json JSONB,
  verify_result_json JSONB,
  preview_theme_id BIGINT,
  applied_theme_id BIGINT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE theme_drafts ALTER COLUMN files_json SET DEFAULT '[]'::jsonb;
ALTER TABLE theme_drafts ADD COLUMN IF NOT EXISTS reference_input_json JSONB;
ALTER TABLE theme_drafts ADD COLUMN IF NOT EXISTS reference_spec_json JSONB;
ALTER TABLE theme_drafts ADD COLUMN IF NOT EXISTS lint_report_json JSONB;
ALTER TABLE theme_drafts ADD COLUMN IF NOT EXISTS verify_result_json JSONB;
ALTER TABLE theme_drafts ADD COLUMN IF NOT EXISTS preview_theme_id BIGINT;
ALTER TABLE theme_drafts ADD COLUMN IF NOT EXISTS applied_theme_id BIGINT;
`;
    await this.pool.query(sql);
  }

  async loadRowsFromPool() {
    return Promise.all([
      this.pool.query("SELECT * FROM licenses"),
      this.pool.query("SELECT * FROM tenants"),
      this.pool.query("SELECT * FROM mcp_tokens"),
      this.pool.query("SELECT * FROM oauth_clients"),
      this.pool.query("SELECT * FROM oauth_auth_codes"),
      this.pool.query("SELECT * FROM oauth_refresh_tokens"),
      this.pool.query("SELECT * FROM accounts"),
      this.pool.query("SELECT * FROM account_sessions"),
    ]);
  }

  async loadRowsFromClient(client) {
    return {
      licenses: await client.query("SELECT * FROM licenses"),
      tenants: await client.query("SELECT * FROM tenants"),
      mcpTokens: await client.query("SELECT * FROM mcp_tokens"),
      oauthClients: await client.query("SELECT * FROM oauth_clients"),
      oauthAuthCodes: await client.query("SELECT * FROM oauth_auth_codes"),
      oauthRefreshTokens: await client.query("SELECT * FROM oauth_refresh_tokens"),
      accounts: await client.query("SELECT * FROM accounts"),
      accountSessions: await client.query("SELECT * FROM account_sessions"),
    };
  }

  mapRowsToState({
    licenses,
    tenants,
    mcpTokens,
    oauthClients,
    oauthAuthCodes,
    oauthRefreshTokens,
    accounts,
    accountSessions,
  }) {
    const state = createInitialState();

    state.licenses = rowMap(licenses.rows, "license_key", (row) => ({
      licenseKey: row.license_key,
      status: row.status,
      contactEmail: row.contact_email,
      entitlements: toJson(row.entitlements_json, {}),
      subscription: toJson(row.subscription_json, {}),
      maxActivations: row.max_activations,
      boundFingerprints: toJson(row.bound_fingerprints_json, []),
      stripeCustomerId: row.stripe_customer_id,
      stripeSubscriptionId: row.stripe_subscription_id,
      createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
      updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
      pastDueSince: row.past_due_since ? new Date(row.past_due_since).toISOString() : null,
      canceledAt: row.canceled_at ? new Date(row.canceled_at).toISOString() : null,
    }));

    state.tenants = rowMap(tenants.rows, "tenant_id", (row) => ({
      tenantId: row.tenant_id,
      licenseKey: row.license_key,
      label: row.label,
      shopify: {
        domain: row.shop_domain,
        accessToken: this.crypto.decrypt(row.shop_access_token_enc),
        clientId: this.crypto.decrypt(row.shop_client_id_enc),
        clientSecret: this.crypto.decrypt(row.shop_client_secret_enc),
      },
      subscription: toJson(row.subscription_json, {}),
      createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
      updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
    }));

    state.mcpTokens = rowMap(mcpTokens.rows, "token_id", (row) => ({
      tokenId: row.token_id,
      tenantId: row.tenant_id,
      licenseKey: row.license_key,
      tokenHash: row.token_hash,
      name: row.name,
      oauthClientId: row.oauth_client_id,
      oauthRefreshTokenId: row.oauth_refresh_token_id,
      oauthTokenFamilyId: row.oauth_token_family_id,
      scope: row.scope,
      targetResource: row.target_resource,
      status: row.status,
      createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
      updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
      lastUsedAt: row.last_used_at ? new Date(row.last_used_at).toISOString() : null,
      expiresAt: row.expires_at ? new Date(row.expires_at).toISOString() : null,
    }));

    state.oauthClients = rowMap(oauthClients.rows, "client_id", (row) => ({
      clientId: row.client_id,
      clientName: row.client_name,
      redirectUris: toJson(row.redirect_uris_json, []),
      grantTypes: toJson(row.grant_types_json, []),
      responseTypes: toJson(row.response_types_json, []),
      tokenEndpointAuthMethod: row.token_endpoint_auth_method,
      scope: row.scope,
      clientSecretHash: row.client_secret_hash,
      status: row.status,
      createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
      updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
    }));

    state.oauthAuthCodes = rowMap(oauthAuthCodes.rows, "code", (row) => ({
      code: row.code,
      clientId: row.client_id,
      tenantId: row.tenant_id,
      licenseKey: row.license_key,
      redirectUri: row.redirect_uri,
      scope: row.scope,
      targetResource: row.target_resource,
      codeChallenge: row.code_challenge,
      codeChallengeMethod: row.code_challenge_method,
      status: row.status,
      createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
      expiresAt: row.expires_at ? new Date(row.expires_at).toISOString() : null,
      usedAt: row.used_at ? new Date(row.used_at).toISOString() : null,
    }));

    state.oauthRefreshTokens = rowMap(oauthRefreshTokens.rows, "refresh_token_id", (row) => ({
      refreshTokenId: row.refresh_token_id,
      tokenHash: row.token_hash,
      clientId: row.client_id,
      tenantId: row.tenant_id,
      licenseKey: row.license_key,
      familyId: row.family_id,
      parentRefreshTokenId: row.parent_refresh_token_id,
      replacedByRefreshTokenId: row.replaced_by_refresh_token_id,
      scope: row.scope,
      targetResource: row.target_resource,
      status: row.status,
      revokedAt: row.revoked_at ? new Date(row.revoked_at).toISOString() : null,
      replayDetectedAt: row.replay_detected_at ? new Date(row.replay_detected_at).toISOString() : null,
      createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
      updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
      expiresAt: row.expires_at ? new Date(row.expires_at).toISOString() : null,
    }));

    state.accounts = rowMap(accounts.rows, "account_id", (row) => ({
      accountId: row.account_id,
      email: row.email,
      name: row.name,
      passwordSalt: row.password_salt,
      passwordHash: row.password_hash,
      licenseKey: row.license_key,
      status: row.status,
      createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
      updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
      lastLoginAt: row.last_login_at ? new Date(row.last_login_at).toISOString() : null,
    }));

    state.accountSessions = rowMap(accountSessions.rows, "session_id", (row) => ({
      sessionId: row.session_id,
      accountId: row.account_id,
      tokenHash: row.token_hash,
      status: row.status,
      createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
      updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
      expiresAt: row.expires_at ? new Date(row.expires_at).toISOString() : null,
      lastUsedAt: row.last_used_at ? new Date(row.last_used_at).toISOString() : null,
      userAgent: row.user_agent,
      ipHash: row.ip_hash,
    }));
    return state;
  }

  async loadState() {
    const [
      licenses,
      tenants,
      mcpTokens,
      oauthClients,
      oauthAuthCodes,
      oauthRefreshTokens,
      accounts,
      accountSessions,
    ] = await this.loadRowsFromPool();
    return this.mapRowsToState({
      licenses,
      tenants,
      mcpTokens,
      oauthClients,
      oauthAuthCodes,
      oauthRefreshTokens,
      accounts,
      accountSessions,
    });
  }

  async persistState(state) {
    const nextState = normalizeStateShape(state);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const baselineRows = await this.loadRowsFromClient(client);
      const prevState = normalizeStateShape(this.mapRowsToState(baselineRows));
      const removedIds = (prevBucket, nextBucket) =>
        Object.keys(prevBucket).filter((id) => !Object.prototype.hasOwnProperty.call(nextBucket, id));
      const persistChanged = async (prevBucket, nextBucket, upsertFn) => {
        for (const [recordId, record] of Object.entries(nextBucket)) {
          const previous = prevBucket[recordId];
          if (!previous || !isDeepStrictEqual(previous, record)) {
            await upsertFn(record);
          }
        }
      };
      const deleteByIds = async (tableName, columnName, ids) => {
        if (!ids.length) {
          return;
        }
        for (const id of ids) {
          await client.query(`DELETE FROM ${tableName} WHERE ${columnName} = $1`, [id]);
        }
      };

      await deleteByIds(
        "oauth_refresh_tokens",
        "refresh_token_id",
        removedIds(prevState.oauthRefreshTokens, nextState.oauthRefreshTokens)
      );
      await deleteByIds("oauth_auth_codes", "code", removedIds(prevState.oauthAuthCodes, nextState.oauthAuthCodes));
      await deleteByIds("mcp_tokens", "token_id", removedIds(prevState.mcpTokens, nextState.mcpTokens));
      await deleteByIds(
        "account_sessions",
        "session_id",
        removedIds(prevState.accountSessions, nextState.accountSessions)
      );
      await deleteByIds("accounts", "account_id", removedIds(prevState.accounts, nextState.accounts));
      await deleteByIds("oauth_clients", "client_id", removedIds(prevState.oauthClients, nextState.oauthClients));
      await deleteByIds("tenants", "tenant_id", removedIds(prevState.tenants, nextState.tenants));
      await deleteByIds("licenses", "license_key", removedIds(prevState.licenses, nextState.licenses));

      await persistChanged(prevState.licenses, nextState.licenses, async (record) => {
        await client.query(
          `INSERT INTO licenses (license_key, status, contact_email, entitlements_json, subscription_json, max_activations, bound_fingerprints_json, stripe_customer_id, stripe_subscription_id, created_at, updated_at, past_due_since, canceled_at)
           VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6,$7::jsonb,$8,$9,$10,$11,$12,$13)
           ON CONFLICT (license_key) DO UPDATE SET
             status = EXCLUDED.status,
             contact_email = EXCLUDED.contact_email,
             entitlements_json = EXCLUDED.entitlements_json,
             subscription_json = EXCLUDED.subscription_json,
             max_activations = EXCLUDED.max_activations,
             bound_fingerprints_json = EXCLUDED.bound_fingerprints_json,
             stripe_customer_id = EXCLUDED.stripe_customer_id,
             stripe_subscription_id = EXCLUDED.stripe_subscription_id,
             created_at = EXCLUDED.created_at,
             updated_at = EXCLUDED.updated_at,
             past_due_since = EXCLUDED.past_due_since,
             canceled_at = EXCLUDED.canceled_at`,
          [
            record.licenseKey,
            record.status,
            record.contactEmail || null,
            JSON.stringify(record.entitlements || {}),
            JSON.stringify(record.subscription || {}),
            Number(record.maxActivations || 3),
            JSON.stringify(Array.isArray(record.boundFingerprints) ? record.boundFingerprints : []),
            record.stripeCustomerId || null,
            record.stripeSubscriptionId || null,
            record.createdAt || null,
            record.updatedAt || null,
            record.pastDueSince || null,
            record.canceledAt || null,
          ]
        );
      });

      await persistChanged(prevState.tenants, nextState.tenants, async (record) => {
        await client.query(
          `INSERT INTO tenants (tenant_id, license_key, label, shop_domain, shop_access_token_enc, shop_client_id_enc, shop_client_secret_enc, subscription_json, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10)
           ON CONFLICT (tenant_id) DO UPDATE SET
             license_key = EXCLUDED.license_key,
             label = EXCLUDED.label,
             shop_domain = EXCLUDED.shop_domain,
             shop_access_token_enc = EXCLUDED.shop_access_token_enc,
             shop_client_id_enc = EXCLUDED.shop_client_id_enc,
             shop_client_secret_enc = EXCLUDED.shop_client_secret_enc,
             subscription_json = EXCLUDED.subscription_json,
             created_at = EXCLUDED.created_at,
             updated_at = EXCLUDED.updated_at`,
          [
            record.tenantId,
            record.licenseKey,
            record.label || null,
            record.shopify?.domain || null,
            this.crypto.encrypt(record.shopify?.accessToken || null),
            this.crypto.encrypt(record.shopify?.clientId || null),
            this.crypto.encrypt(record.shopify?.clientSecret || null),
            JSON.stringify(record.subscription || {}),
            record.createdAt || null,
            record.updatedAt || null,
          ]
        );
      });

      await persistChanged(prevState.accounts, nextState.accounts, async (record) => {
        await client.query(
          `INSERT INTO accounts (account_id, email, name, password_salt, password_hash, license_key, status, created_at, updated_at, last_login_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
           ON CONFLICT (account_id) DO UPDATE SET
             email = EXCLUDED.email,
             name = EXCLUDED.name,
             password_salt = EXCLUDED.password_salt,
             password_hash = EXCLUDED.password_hash,
             license_key = EXCLUDED.license_key,
             status = EXCLUDED.status,
             created_at = EXCLUDED.created_at,
             updated_at = EXCLUDED.updated_at,
             last_login_at = EXCLUDED.last_login_at`,
          [
            record.accountId,
            record.email,
            record.name,
            record.passwordSalt,
            record.passwordHash,
            record.licenseKey,
            record.status,
            record.createdAt || null,
            record.updatedAt || null,
            record.lastLoginAt || null,
          ]
        );
      });

      await persistChanged(prevState.accountSessions, nextState.accountSessions, async (record) => {
        await client.query(
          `INSERT INTO account_sessions (session_id, account_id, token_hash, status, created_at, updated_at, expires_at, last_used_at, user_agent, ip_hash)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
           ON CONFLICT (session_id) DO UPDATE SET
             account_id = EXCLUDED.account_id,
             token_hash = EXCLUDED.token_hash,
             status = EXCLUDED.status,
             created_at = EXCLUDED.created_at,
             updated_at = EXCLUDED.updated_at,
             expires_at = EXCLUDED.expires_at,
             last_used_at = EXCLUDED.last_used_at,
             user_agent = EXCLUDED.user_agent,
             ip_hash = EXCLUDED.ip_hash`,
          [
            record.sessionId,
            record.accountId,
            record.tokenHash,
            record.status,
            record.createdAt || null,
            record.updatedAt || null,
            record.expiresAt || null,
            record.lastUsedAt || null,
            record.userAgent || null,
            record.ipHash || null,
          ]
        );
      });

      await persistChanged(prevState.oauthClients, nextState.oauthClients, async (record) => {
        await client.query(
          `INSERT INTO oauth_clients (client_id, client_name, redirect_uris_json, grant_types_json, response_types_json, token_endpoint_auth_method, scope, client_secret_hash, status, created_at, updated_at)
           VALUES ($1,$2,$3::jsonb,$4::jsonb,$5::jsonb,$6,$7,$8,$9,$10,$11)
           ON CONFLICT (client_id) DO UPDATE SET
             client_name = EXCLUDED.client_name,
             redirect_uris_json = EXCLUDED.redirect_uris_json,
             grant_types_json = EXCLUDED.grant_types_json,
             response_types_json = EXCLUDED.response_types_json,
             token_endpoint_auth_method = EXCLUDED.token_endpoint_auth_method,
             scope = EXCLUDED.scope,
             client_secret_hash = EXCLUDED.client_secret_hash,
             status = EXCLUDED.status,
             created_at = EXCLUDED.created_at,
             updated_at = EXCLUDED.updated_at`,
          [
            record.clientId,
            record.clientName,
            JSON.stringify(Array.isArray(record.redirectUris) ? record.redirectUris : []),
            JSON.stringify(Array.isArray(record.grantTypes) ? record.grantTypes : []),
            JSON.stringify(Array.isArray(record.responseTypes) ? record.responseTypes : []),
            record.tokenEndpointAuthMethod || null,
            record.scope || null,
            record.clientSecretHash || null,
            record.status,
            record.createdAt || null,
            record.updatedAt || null,
          ]
        );
      });

      await persistChanged(prevState.oauthAuthCodes, nextState.oauthAuthCodes, async (record) => {
        await client.query(
          `INSERT INTO oauth_auth_codes (code, client_id, tenant_id, license_key, redirect_uri, scope, target_resource, code_challenge, code_challenge_method, status, created_at, expires_at, used_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
           ON CONFLICT (code) DO UPDATE SET
             client_id = EXCLUDED.client_id,
             tenant_id = EXCLUDED.tenant_id,
             license_key = EXCLUDED.license_key,
             redirect_uri = EXCLUDED.redirect_uri,
             scope = EXCLUDED.scope,
             target_resource = EXCLUDED.target_resource,
             code_challenge = EXCLUDED.code_challenge,
             code_challenge_method = EXCLUDED.code_challenge_method,
             status = EXCLUDED.status,
             created_at = EXCLUDED.created_at,
             expires_at = EXCLUDED.expires_at,
             used_at = EXCLUDED.used_at`,
          [
            record.code,
            record.clientId,
            record.tenantId,
            record.licenseKey,
            record.redirectUri,
            record.scope || null,
            record.targetResource || null,
            record.codeChallenge || null,
            record.codeChallengeMethod || null,
            record.status,
            record.createdAt || null,
            record.expiresAt || null,
            record.usedAt || null,
          ]
        );
      });

      await persistChanged(prevState.mcpTokens, nextState.mcpTokens, async (record) => {
        await client.query(
          `INSERT INTO mcp_tokens (token_id, tenant_id, license_key, token_hash, name, oauth_client_id, oauth_refresh_token_id, oauth_token_family_id, scope, target_resource, status, created_at, updated_at, last_used_at, expires_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
           ON CONFLICT (token_id) DO UPDATE SET
             tenant_id = EXCLUDED.tenant_id,
             license_key = EXCLUDED.license_key,
             token_hash = EXCLUDED.token_hash,
             name = EXCLUDED.name,
             oauth_client_id = EXCLUDED.oauth_client_id,
             oauth_refresh_token_id = EXCLUDED.oauth_refresh_token_id,
             oauth_token_family_id = EXCLUDED.oauth_token_family_id,
             scope = EXCLUDED.scope,
             target_resource = EXCLUDED.target_resource,
             status = EXCLUDED.status,
             created_at = EXCLUDED.created_at,
             updated_at = EXCLUDED.updated_at,
             last_used_at = EXCLUDED.last_used_at,
             expires_at = EXCLUDED.expires_at`,
          [
            record.tokenId,
            record.tenantId,
            record.licenseKey || null,
            record.tokenHash,
            record.name || null,
            record.oauthClientId || null,
            record.oauthRefreshTokenId || null,
            record.oauthTokenFamilyId || null,
            record.scope || null,
            record.targetResource || null,
            record.status,
            record.createdAt || null,
            record.updatedAt || null,
            record.lastUsedAt || null,
            record.expiresAt || null,
          ]
        );
      });

      const changedRefreshRecords = [];
      await persistChanged(prevState.oauthRefreshTokens, nextState.oauthRefreshTokens, async (record) => {
        changedRefreshRecords.push(record);
        await client.query(
          `INSERT INTO oauth_refresh_tokens (refresh_token_id, token_hash, client_id, tenant_id, license_key, family_id, parent_refresh_token_id, replaced_by_refresh_token_id, scope, target_resource, status, revoked_at, replay_detected_at, created_at, updated_at, expires_at)
           VALUES ($1,$2,$3,$4,$5,$6,NULL,NULL,$7,$8,$9,$10,$11,$12,$13,$14)
           ON CONFLICT (refresh_token_id) DO UPDATE SET
             token_hash = EXCLUDED.token_hash,
             client_id = EXCLUDED.client_id,
             tenant_id = EXCLUDED.tenant_id,
             license_key = EXCLUDED.license_key,
             family_id = EXCLUDED.family_id,
             parent_refresh_token_id = NULL,
             replaced_by_refresh_token_id = NULL,
             scope = EXCLUDED.scope,
             target_resource = EXCLUDED.target_resource,
             status = EXCLUDED.status,
             revoked_at = EXCLUDED.revoked_at,
             replay_detected_at = EXCLUDED.replay_detected_at,
             created_at = EXCLUDED.created_at,
             updated_at = EXCLUDED.updated_at,
             expires_at = EXCLUDED.expires_at`,
          [
            record.refreshTokenId,
            record.tokenHash,
            record.clientId,
            record.tenantId,
            record.licenseKey,
            record.familyId || null,
            record.scope || null,
            record.targetResource || null,
            record.status,
            record.revokedAt || null,
            record.replayDetectedAt || null,
            record.createdAt || null,
            record.updatedAt || null,
            record.expiresAt || null,
          ]
        );
      });
      for (const record of changedRefreshRecords) {
        await client.query(
          `UPDATE oauth_refresh_tokens
             SET parent_refresh_token_id = $2,
                 replaced_by_refresh_token_id = $3
           WHERE refresh_token_id = $1`,
          [
            record.refreshTokenId,
            record.parentRefreshTokenId || null,
            record.replacedByRefreshTokenId || null,
          ]
        );
      }

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async exportSnapshot() {
    return this.loadState();
  }
}
