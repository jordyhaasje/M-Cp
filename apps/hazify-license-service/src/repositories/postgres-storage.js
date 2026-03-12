import crypto from "crypto";
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

export class PostgresStorage {
  constructor({
    databaseUrl,
    databaseSsl,
    dbPoolMax,
    dbStatementTimeoutMs,
    encryptionKey,
  }) {
    this.pool = new Pool({
      connectionString: databaseUrl,
      max: Number(dbPoolMax || 10),
      statement_timeout: Number(dbStatementTimeoutMs || 5000),
      ssl: isTruthy(databaseSsl, true) ? { rejectUnauthorized: false } : false,
    });
    this.crypto = createCryptoHelper(encryptionKey);
  }

  async init() {
    await this.ensureSchema();
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
  token_hash TEXT NOT NULL,
  name TEXT,
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS mcp_artifacts (
  tenant_id TEXT NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  artifact_id TEXT NOT NULL,
  type TEXT NOT NULL,
  status TEXT NOT NULL,
  parent_ids_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  last_accessed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  version TEXT NOT NULL DEFAULT 'section-workflow-v1',
  PRIMARY KEY (tenant_id, artifact_id)
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
  scope TEXT,
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ
);
`;
    await this.pool.query(sql);
  }

  async loadState() {
    const state = createInitialState();

    const [
      licenses,
      tenants,
      mcpTokens,
      mcpArtifacts,
      oauthClients,
      oauthAuthCodes,
      oauthRefreshTokens,
      accounts,
      accountSessions,
    ] = await Promise.all([
      this.pool.query("SELECT * FROM licenses"),
      this.pool.query("SELECT * FROM tenants"),
      this.pool.query("SELECT * FROM mcp_tokens"),
      this.pool.query("SELECT * FROM mcp_artifacts"),
      this.pool.query("SELECT * FROM oauth_clients"),
      this.pool.query("SELECT * FROM oauth_auth_codes"),
      this.pool.query("SELECT * FROM oauth_refresh_tokens"),
      this.pool.query("SELECT * FROM accounts"),
      this.pool.query("SELECT * FROM account_sessions"),
    ]);

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
      tokenHash: row.token_hash,
      name: row.name,
      status: row.status,
      createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
      updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
      lastUsedAt: row.last_used_at ? new Date(row.last_used_at).toISOString() : null,
      expiresAt: row.expires_at ? new Date(row.expires_at).toISOString() : null,
    }));

    state.mcpArtifacts = Object.fromEntries(
      mcpArtifacts.rows.map((row) => [
        `${row.tenant_id}:${row.artifact_id}`,
        {
          artifactId: row.artifact_id,
          tenantId: row.tenant_id,
          type: row.type,
          status: row.status,
          parentIds: toJson(row.parent_ids_json, []),
          payload: toJson(row.payload_json, {}),
          createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
          updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
          lastAccessedAt: row.last_accessed_at ? new Date(row.last_accessed_at).toISOString() : null,
          expiresAt: row.expires_at ? new Date(row.expires_at).toISOString() : null,
          version: row.version || "section-workflow-v1",
        },
      ])
    );

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
      scope: row.scope,
      status: row.status,
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

  async persistState(state) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "TRUNCATE TABLE oauth_refresh_tokens, oauth_auth_codes, oauth_clients, mcp_artifacts, mcp_tokens, account_sessions, accounts, tenants, licenses RESTART IDENTITY CASCADE"
      );

      for (const record of Object.values(state.licenses || {})) {
        await client.query(
          `INSERT INTO licenses (license_key, status, contact_email, entitlements_json, subscription_json, max_activations, bound_fingerprints_json, stripe_customer_id, stripe_subscription_id, created_at, updated_at, past_due_since, canceled_at)
           VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6,$7::jsonb,$8,$9,$10,$11,$12,$13)`,
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
      }

      for (const record of Object.values(state.tenants || {})) {
        await client.query(
          `INSERT INTO tenants (tenant_id, license_key, label, shop_domain, shop_access_token_enc, shop_client_id_enc, shop_client_secret_enc, subscription_json, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10)`,
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
      }

      for (const record of Object.values(state.accounts || {})) {
        await client.query(
          `INSERT INTO accounts (account_id, email, name, password_salt, password_hash, license_key, status, created_at, updated_at, last_login_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
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
      }

      for (const record of Object.values(state.accountSessions || {})) {
        await client.query(
          `INSERT INTO account_sessions (session_id, account_id, token_hash, status, created_at, updated_at, expires_at, last_used_at, user_agent, ip_hash)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
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
      }

      for (const record of Object.values(state.mcpTokens || {})) {
        await client.query(
          `INSERT INTO mcp_tokens (token_id, tenant_id, token_hash, name, status, created_at, updated_at, last_used_at, expires_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [
            record.tokenId,
            record.tenantId,
            record.tokenHash,
            record.name || null,
            record.status,
            record.createdAt || null,
            record.updatedAt || null,
            record.lastUsedAt || null,
            record.expiresAt || null,
          ]
        );
      }

      for (const record of Object.values(state.mcpArtifacts || {})) {
        await client.query(
          `INSERT INTO mcp_artifacts (tenant_id, artifact_id, type, status, parent_ids_json, payload_json, created_at, updated_at, last_accessed_at, expires_at, version)
           VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8,$9,$10,$11)`,
          [
            record.tenantId,
            record.artifactId,
            record.type,
            record.status,
            JSON.stringify(Array.isArray(record.parentIds) ? record.parentIds : []),
            JSON.stringify(record.payload || {}),
            record.createdAt || null,
            record.updatedAt || null,
            record.lastAccessedAt || null,
            record.expiresAt || null,
            record.version || "section-workflow-v1",
          ]
        );
      }

      for (const record of Object.values(state.oauthClients || {})) {
        await client.query(
          `INSERT INTO oauth_clients (client_id, client_name, redirect_uris_json, grant_types_json, response_types_json, token_endpoint_auth_method, scope, client_secret_hash, status, created_at, updated_at)
           VALUES ($1,$2,$3::jsonb,$4::jsonb,$5::jsonb,$6,$7,$8,$9,$10,$11)`,
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
      }

      for (const record of Object.values(state.oauthAuthCodes || {})) {
        await client.query(
          `INSERT INTO oauth_auth_codes (code, client_id, tenant_id, license_key, redirect_uri, scope, code_challenge, code_challenge_method, status, created_at, expires_at, used_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
          [
            record.code,
            record.clientId,
            record.tenantId,
            record.licenseKey,
            record.redirectUri,
            record.scope || null,
            record.codeChallenge || null,
            record.codeChallengeMethod || null,
            record.status,
            record.createdAt || null,
            record.expiresAt || null,
            record.usedAt || null,
          ]
        );
      }

      for (const record of Object.values(state.oauthRefreshTokens || {})) {
        await client.query(
          `INSERT INTO oauth_refresh_tokens (refresh_token_id, token_hash, client_id, tenant_id, license_key, scope, status, created_at, updated_at, expires_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [
            record.refreshTokenId,
            record.tokenHash,
            record.clientId,
            record.tenantId,
            record.licenseKey,
            record.scope || null,
            record.status,
            record.createdAt || null,
            record.updatedAt || null,
            record.expiresAt || null,
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
