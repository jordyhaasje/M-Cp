import crypto from "crypto";
import fs from "fs/promises";
import http from "http";
import path from "path";
import { URL } from "url";
import { sha256Hex, normalizeBaseUrl } from "@hazify/mcp-common";
import {
  exchangeShopifyClientCredentials,
  normalizeShopDomain,
  REQUIRED_SHOPIFY_ADMIN_SCOPES,
  validateShopifyCredentialsLive as validateShopifyCredentialsLiveCore,
} from "@hazify/shopify-core";
import {
  ACCOUNT_SESSION_COOKIE,
  APP_ROOT,
  IS_PRODUCTION,
  SHOPIFY_CREDENTIAL_VALIDATION_TIMEOUT_MS,
  VALID_LICENSE_STATUSES as VALID_STATUSES,
  config,
} from "./config/runtime.js";
import {
  applyStripeSubscriptionSnapshot,
  canonicalLicense,
  defaultEntitlements,
  defaultLicenseSubscription,
  defaultTenantSubscriptionProfile,
  ensureLicenseRecordShape,
  ensureTenantRecordShape,
  isLicenseUsableForOnboarding,
} from "./domain/license-records.js";
import {
  accountPublicPayload,
  createPasswordDigest,
  normalizeAccountEmail,
  normalizeOptionalEmail,
  verifyPasswordDigest,
} from "./domain/accounts.js";
import {
  appendQueryParamsToUrl,
  buildOauthMetadata,
  isAllowedRedirectUri as isAllowedRedirectUriValue,
  oauthJsonError,
  readJsonOrFormBody,
  validateOAuthClientAuthentication,
  verifyPkceCodeVerifier,
} from "./lib/oauth.js";
import {
  buildCookieHeader,
  isRequestSecure,
  parseCookies,
  safeRedirectPath,
  setCookie,
} from "./lib/http.js";
import { addDays, addHours, addSeconds, nowIso, positiveNumber, unixToIso } from "./lib/time.js";
import { createStorageAdapter } from "./repositories/storage-adapter.js";
import {
  createAccountSession,
  findAccountByEmail,
  resolveAccountSessionFromRequest,
} from "./services/account-sessions.js";
import {
  billingDisabledPayload,
  billingReadiness,
  isStripeModePaymentLink,
  isStripeSecretForMode,
  resolveConfiguredPriceId,
  resolvePaymentLink,
} from "./services/billing.js";
import {
  renderDashboardPage,
  renderLoginPage,
  renderOAuthAuthorizePage as renderOAuthAuthorizePageV2,
  renderOAuthReconnectPage,
  renderOnboardingLandingPage,
  renderSignupPage,
} from "./views/pages.js";
import { createPublicUiHandlers } from "./routes/public-ui.js";
import { createDashboardHandlers } from "./routes/dashboard.js";
import { createAccountHandlers } from "./routes/account.js";
import { createLicenseBillingHandlers } from "./routes/license-billing.js";
import { createAdminHandlers } from "./routes/admin.js";
import { createOAuthHandlers } from "./routes/oauth.js";

const RATE_BUCKETS = new Map();

const storage = createStorageAdapter(config);
await storage.init();
// Process-memory working set remains the active state for this instance.
// Correctness depends on single-writer enforcement at storage level.
let db = await loadDb();
db = await maybeBootstrapPostgresFromLegacyJson(db);
let writeQueue = Promise.resolve();
let storageClosed = false;

async function closeStorage() {
  if (storageClosed) {
    return;
  }
  storageClosed = true;
  if (typeof storage.close === "function") {
    await storage.close();
  }
}

function randomId(prefix) {
  return `${prefix}_${crypto.randomBytes(16).toString("hex")}`;
}

function generateLicenseKey() {
  return `HZY-${crypto.randomBytes(4).toString("hex").toUpperCase()}-${crypto
    .randomBytes(4)
    .toString("hex")
    .toUpperCase()}-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
}

function createAccountAccessToken() {
  return `hzacct_${crypto.randomBytes(24).toString("hex")}`;
}


function ensureFreeLicenseRecord(licenseKey) {
  const key = String(licenseKey || "").trim();
  if (!key) {
    throw new Error("licenseKey is required");
  }
  const existing = db.licenses[key];
  if (!existing) {
    db.licenses[key] = ensureLicenseRecordShape({
      licenseKey: key,
      status: "active",
      entitlements: defaultEntitlements(),
      maxActivations: 3,
      boundFingerprints: [],
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      pastDueSince: null,
      canceledAt: null,
    });
    return db.licenses[key];
  }
  ensureLicenseRecordShape(existing);
  existing.status = "active";
  existing.pastDueSince = null;
  existing.canceledAt = null;
  existing.subscription.status = "active";
  existing.subscription.canceledAt = null;
  existing.updatedAt = nowIso();
  return existing;
}

async function loadDb() {
  const parsed = await storage.loadState();
  const safeState = {
    licenses: parsed.licenses && typeof parsed.licenses === "object" ? parsed.licenses : {},
    tenants: parsed.tenants && typeof parsed.tenants === "object" ? parsed.tenants : {},
    mcpTokens: parsed.mcpTokens && typeof parsed.mcpTokens === "object" ? parsed.mcpTokens : {},
    oauthClients: parsed.oauthClients && typeof parsed.oauthClients === "object" ? parsed.oauthClients : {},
    oauthAuthCodes:
      parsed.oauthAuthCodes && typeof parsed.oauthAuthCodes === "object" ? parsed.oauthAuthCodes : {},
    oauthRefreshTokens:
      parsed.oauthRefreshTokens && typeof parsed.oauthRefreshTokens === "object"
        ? parsed.oauthRefreshTokens
        : {},
    accounts: parsed.accounts && typeof parsed.accounts === "object" ? parsed.accounts : {},
    accountSessions:
      parsed.accountSessions && typeof parsed.accountSessions === "object"
        ? parsed.accountSessions
        : {},
  };

  for (const record of Object.values(safeState.licenses)) {
    ensureLicenseRecordShape(record);
  }
  for (const tenant of Object.values(safeState.tenants)) {
    ensureTenantRecordShape(tenant);
  }

  return safeState;
}

function snapshotRecordCount(state = {}) {
  const keys = [
    "licenses",
    "tenants",
    "mcpTokens",
    "oauthClients",
    "oauthAuthCodes",
    "oauthRefreshTokens",
    "accounts",
    "accountSessions",
  ];
  return keys.reduce((total, key) => {
    const bucket = state[key];
    if (!bucket || typeof bucket !== "object") {
      return total;
    }
    return total + Object.keys(bucket).length;
  }, 0);
}

async function maybeBootstrapPostgresFromLegacyJson(currentState) {
  if (!config.databaseUrl) {
    return currentState;
  }
  if (snapshotRecordCount(currentState) > 0) {
    return currentState;
  }

  let legacyRaw;
  try {
    legacyRaw = await fs.readFile(config.dbPath, "utf8");
  } catch {
    return currentState;
  }

  let legacyParsed;
  try {
    legacyParsed = JSON.parse(legacyRaw);
  } catch {
    return currentState;
  }

  const legacySnapshot = {
    licenses: legacyParsed.licenses && typeof legacyParsed.licenses === "object" ? legacyParsed.licenses : {},
    tenants: legacyParsed.tenants && typeof legacyParsed.tenants === "object" ? legacyParsed.tenants : {},
    mcpTokens: legacyParsed.mcpTokens && typeof legacyParsed.mcpTokens === "object" ? legacyParsed.mcpTokens : {},
    oauthClients:
      legacyParsed.oauthClients && typeof legacyParsed.oauthClients === "object" ? legacyParsed.oauthClients : {},
    oauthAuthCodes:
      legacyParsed.oauthAuthCodes && typeof legacyParsed.oauthAuthCodes === "object"
        ? legacyParsed.oauthAuthCodes
        : {},
    oauthRefreshTokens:
      legacyParsed.oauthRefreshTokens && typeof legacyParsed.oauthRefreshTokens === "object"
        ? legacyParsed.oauthRefreshTokens
        : {},
    accounts: legacyParsed.accounts && typeof legacyParsed.accounts === "object" ? legacyParsed.accounts : {},
    accountSessions:
      legacyParsed.accountSessions && typeof legacyParsed.accountSessions === "object"
        ? legacyParsed.accountSessions
        : {},
  };

  if (snapshotRecordCount(legacySnapshot) === 0) {
    return currentState;
  }

  await storage.persistState(legacySnapshot);
  const reloaded = await loadDb();
  logEvent("storage_bootstrap_from_json", {
    source: config.dbPath,
    recordsImported: snapshotRecordCount(reloaded),
  });
  return reloaded;
}

async function persistDb() {
  writeQueue = writeQueue.then(async () => {
    await storage.persistState(db);
  });
  await writeQueue;
}

function logEvent(event, data = {}) {
  console.log(
    JSON.stringify({
      ts: nowIso(),
      event,
      ...data,
    })
  );
}

function normalizeCspOrigin(value) {
  if (typeof value !== "string" || !value.trim()) {
    return "";
  }
  try {
    const parsed = new URL(value.trim());
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return parsed.origin;
    }
  } catch {
    // noop
  }
  return "";
}

function requestPathname(req) {
  try {
    const parsed = new URL(req.url || "/", "http://localhost");
    return parsed.pathname || "/";
  } catch {
    return "/";
  }
}

function applySecurityHeaders(req, res) {
  const secure = isRequestSecure(req);
  const formActionSources = new Set(["'self'"]);
  const interactiveFormActionSources = new Set(["'self'"]);
  const connectSources = new Set(["'self'"]);
  const pathname = requestPathname(req);
  const isInteractiveOAuthRoute =
    pathname === "/oauth/authorize" || pathname === "/authorize" || pathname === "/login" || pathname === "/signup";

  const requestOrigin = normalizeCspOrigin(requestBaseUrl(req));
  const oauthOrigin = normalizeCspOrigin(oauthIssuerBase(req));
  if (requestOrigin) {
    formActionSources.add(requestOrigin);
    interactiveFormActionSources.add(requestOrigin);
    connectSources.add(requestOrigin);
  }
  if (oauthOrigin) {
    formActionSources.add(oauthOrigin);
    interactiveFormActionSources.add(oauthOrigin);
    connectSources.add(oauthOrigin);
  }
  if (isInteractiveOAuthRoute) {
    // Native OAuth clients often use loopback redirect URIs on random local ports.
    interactiveFormActionSources.add("http://127.0.0.1:*");
    interactiveFormActionSources.add("http://localhost:*");
    interactiveFormActionSources.add("http://[::1]:*");
    for (const scheme of config.oauthAllowedCustomRedirectSchemes) {
      if (/^[a-z][a-z0-9+.-]*$/i.test(scheme)) {
        interactiveFormActionSources.add(`${scheme}:`);
      }
    }
  }

  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  if (!isInteractiveOAuthRoute) {
    res.setHeader("X-Frame-Options", "DENY");
  }
  const frameAncestors = isInteractiveOAuthRoute
    ? "'self' https://chatgpt.com https://chat.openai.com https://claude.ai https://www.perplexity.ai https://perplexity.ai"
    : "'none'";
  const formActionDirective = isInteractiveOAuthRoute
    ? Array.from(interactiveFormActionSources).join(" ")
    : Array.from(formActionSources).join(" ");
  res.setHeader(
    "Content-Security-Policy",
    `default-src 'self'; base-uri 'self'; frame-ancestors ${frameAncestors}; form-action ${formActionDirective}; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src ${Array.from(
      connectSources
    ).join(" ")}`
  );
  if (secure) {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
}

function redirectTo(res, location, statusCode = 302) {
  res.writeHead(statusCode, {
    Location: location,
    "Cache-Control": "no-store",
  });
  res.end();
}

function json(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

async function readBody(req, asRaw = false) {
  const chunks = [];
  let totalBytes = 0;
  for await (const chunk of req) {
    const buf = Buffer.from(chunk);
    totalBytes += buf.length;
    if (totalBytes > config.maxBodyBytes) {
      const error = new Error(`Request body too large (max ${config.maxBodyBytes} bytes)`);
      error.code = "payload_too_large";
      throw error;
    }
    chunks.push(buf);
  }
  const rawBuffer = Buffer.concat(chunks);
  if (asRaw) {
    return { raw: rawBuffer.toString("utf8"), json: null };
  }
  const text = rawBuffer.toString("utf8") || "{}";
  try {
    return { raw: text, json: JSON.parse(text) };
  } catch {
    throw new Error("Invalid JSON body");
  }
}

function clientIp(req) {
  return (req.socket?.remoteAddress || "unknown").replace("::ffff:", "");
}

function applyRateLimit(req, res) {
  const ip = clientIp(req);
  const bucket = `${ip}:${Math.floor(Date.now() / 60000)}`;
  const count = (RATE_BUCKETS.get(bucket) || 0) + 1;
  RATE_BUCKETS.set(bucket, count);
  if (count > config.rateLimitPerMinute) {
    json(res, 429, { error: "rate_limited", message: "Too many requests" });
    return false;
  }
  return true;
}

function requireAdmin(req, res) {
  const key = req.headers["x-admin-api-key"];
  if (!config.adminApiKey || key !== config.adminApiKey) {
    json(res, 401, { error: "unauthorized", message: "Missing or invalid admin API key" });
    return false;
  }
  return true;
}

function requireMcpApiKey(req, res) {
  const key = req.headers["x-mcp-api-key"];
  if (!config.mcpApiKey || key !== config.mcpApiKey) {
    json(res, 401, { error: "unauthorized", message: "Missing or invalid MCP API key" });
    return false;
  }
  return true;
}

async function requireAccountSession(req, res) {
  const resolved = resolveAccountSession(req);
  if (!resolved.account || !resolved.session) {
    await persistDb();
    json(res, 401, {
      error: "unauthorized",
      message: "Meld je aan om deze actie uit te voeren.",
    });
    return null;
  }
  resolved.session.lastUsedAt = nowIso();
  resolved.session.updatedAt = nowIso();
  await persistDb();
  return resolved;
}

function resolveAccountSession(req) {
  return resolveAccountSessionFromRequest({
    db,
    req,
    parseCookies,
    accountSessionCookie: ACCOUNT_SESSION_COOKIE,
    hashToken,
    nowIso,
  });
}

function validateTenantShopifyPayload(payload) {
  if (!payload || typeof payload !== "object") {
    throw new Error("payload is required");
  }
  const domain = normalizeShopDomain(payload.shopDomain || payload.domain);
  if (!domain || !domain.endsWith(".myshopify.com")) {
    throw new Error("shopDomain must be a valid *.myshopify.com domain");
  }

  const accessToken =
    typeof payload.shopAccessToken === "string" && payload.shopAccessToken.trim()
      ? payload.shopAccessToken.trim()
      : null;
  const clientId =
    typeof payload.shopClientId === "string" && payload.shopClientId.trim()
      ? payload.shopClientId.trim()
      : null;
  const clientSecret =
    typeof payload.shopClientSecret === "string" && payload.shopClientSecret.trim()
      ? payload.shopClientSecret.trim()
      : null;

  if (!accessToken && !(clientId && clientSecret)) {
    throw new Error("Provide either shopAccessToken or shopClientId + shopClientSecret");
  }

  return {
    domain,
    accessToken,
    clientId,
    clientSecret,
  };
}

function buildTenantShopifyRecord(shopify, options = {}) {
  const source = shopify && typeof shopify === "object" ? shopify : {};
  const validatedAt =
    typeof options.validatedAt === "string" && options.validatedAt.trim()
      ? options.validatedAt.trim()
      : null;
  const lastValidationAt =
    typeof options.lastValidationAt === "string" && options.lastValidationAt.trim()
      ? options.lastValidationAt.trim()
      : validatedAt;
  const lastValidationError =
    typeof options.lastValidationError === "string" && options.lastValidationError.trim()
      ? options.lastValidationError.trim()
      : null;
  return {
    domain: normalizeShopDomain(source.domain || source.shopDomain || ""),
    accessToken:
      typeof source.accessToken === "string" && source.accessToken.trim()
        ? source.accessToken.trim()
        : null,
    clientId:
      typeof source.clientId === "string" && source.clientId.trim() ? source.clientId.trim() : null,
    clientSecret:
      typeof source.clientSecret === "string" && source.clientSecret.trim()
        ? source.clientSecret.trim()
        : null,
    credentialsValidatedAt: validatedAt,
    lastValidationAt: lastValidationAt || null,
    lastValidationError,
  };
}

function revokeTenantAuthArtifacts(tenantId) {
  let revokedMcpTokens = 0;
  let revokedRefreshTokens = 0;
  for (const tokenRecord of Object.values(db.mcpTokens)) {
    if (!tokenRecord || tokenRecord.tenantId !== tenantId || tokenRecord.status !== "active") {
      continue;
    }
    tokenRecord.status = "revoked";
    tokenRecord.updatedAt = nowIso();
    revokedMcpTokens += 1;
  }
  for (const refreshRecord of Object.values(db.oauthRefreshTokens)) {
    if (!refreshRecord || refreshRecord.tenantId !== tenantId || refreshRecord.status !== "active") {
      continue;
    }
    refreshRecord.status = "revoked";
    refreshRecord.revokedAt = nowIso();
    refreshRecord.updatedAt = nowIso();
    revokedRefreshTokens += 1;
  }
  return { revokedMcpTokens, revokedRefreshTokens };
}

async function validateShopifyCredentialsLive(shopify) {
  return validateShopifyCredentialsLiveCore(shopify, {
    requiredScopes: REQUIRED_SHOPIFY_ADMIN_SCOPES,
    timeoutMs: SHOPIFY_CREDENTIAL_VALIDATION_TIMEOUT_MS,
  });
}

function hashToken(token) {
  return sha256Hex(token);
}

function requestBaseUrl(req) {
  if (config.publicBaseUrl) {
    return normalizeBaseUrl(config.publicBaseUrl);
  }
  const protoHeader = req.headers["x-forwarded-proto"];
  const hostHeader = req.headers["x-forwarded-host"] || req.headers.host;
  const protocol =
    typeof protoHeader === "string" && protoHeader.trim() ? protoHeader.split(",")[0].trim() : "http";
  const host =
    typeof hostHeader === "string" && hostHeader.trim() ? hostHeader.split(",")[0].trim() : `localhost:${config.port}`;
  return `${protocol}://${host}`;
}

function resolvedMcpPublicUrl(req) {
  if (config.mcpPublicUrl) {
    return normalizeBaseUrl(config.mcpPublicUrl);
  }
  return `${requestBaseUrl(req)}/mcp`;
}

function findTenantByLicenseKey(licenseKey, preferredDomain = null) {
  let fallback = null;
  for (const tenant of Object.values(db.tenants)) {
    if (tenant?.licenseKey === licenseKey) {
      if (preferredDomain && tenant.shopify?.domain === preferredDomain) {
        return tenant;
      }
      if (!fallback) {
        fallback = tenant;
      }
    }
  }
  return fallback;
}

function maskSecret(value) {
  if (!value || typeof value !== "string") {
    return null;
  }
  if (value.length <= 8) {
    return `${value.slice(0, 2)}***`;
  }
  return `${value.slice(0, 4)}***${value.slice(-2)}`;
}

function createMcpTokenForTenant(tenantId, options = {}) {
  const tenant = db.tenants[tenantId];
  if (!tenant) {
    throw new Error("tenant_not_found");
  }
  ensureTenantRecordShape(tenant);
  const license = db.licenses[tenant.licenseKey];
  if (!license) {
    throw new Error("license_not_found");
  }
  ensureLicenseRecordShape(license);
  const accessToken = `hzmcp_${crypto.randomBytes(24).toString("hex")}`;
  const tokenId = randomId("mcp");
  const tokenHash = hashToken(accessToken);
  const expiresInSeconds = Number(options.expiresInSeconds || 0);
  const expiresInDays = Number(options.expiresInDays || 0);
  const expiresAt =
    Number.isFinite(expiresInSeconds) && expiresInSeconds > 0
      ? addSeconds(nowIso(), expiresInSeconds)
      : Number.isFinite(expiresInDays) && expiresInDays > 0
      ? addDays(nowIso(), expiresInDays)
      : null;

  db.mcpTokens[tokenId] = {
    tokenId,
    tokenHash,
    tenantId,
    licenseKey: tenant.licenseKey,
    name: typeof options.name === "string" && options.name.trim() ? options.name.trim() : null,
    oauthClientId:
      typeof options.oauthClientId === "string" && options.oauthClientId.trim()
        ? options.oauthClientId.trim()
        : null,
    oauthRefreshTokenId:
      typeof options.oauthRefreshTokenId === "string" && options.oauthRefreshTokenId.trim()
        ? options.oauthRefreshTokenId.trim()
        : null,
    oauthTokenFamilyId:
      typeof options.oauthTokenFamilyId === "string" && options.oauthTokenFamilyId.trim()
        ? options.oauthTokenFamilyId.trim()
        : null,
    status: "active",
    createdAt: nowIso(),
    updatedAt: nowIso(),
    lastUsedAt: null,
    expiresAt,
  };

  return {
    tokenId,
    accessToken,
    expiresAt,
    tenant,
    license,
  };
}

function listTenantMcpTokens(tenantId) {
  return Object.values(db.mcpTokens)
    .filter((entry) => entry && entry.tenantId === tenantId)
    .sort((a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0))
    .map((entry) => ({
      tokenId: entry.tokenId,
      name: entry.name || null,
      status: entry.status,
      createdAt: entry.createdAt || null,
      updatedAt: entry.updatedAt || null,
      lastUsedAt: entry.lastUsedAt || null,
      expiresAt: entry.expiresAt || null,
    }));
}

function oauthConnectionKeyFromRefreshRecord(record) {
  if (!record || typeof record !== "object") {
    return "";
  }
  const clientId = typeof record.clientId === "string" ? record.clientId.trim() : "";
  if (clientId) {
    return `client:${clientId}`;
  }
  const fallback =
    typeof record.refreshTokenId === "string" && record.refreshTokenId.trim()
      ? record.refreshTokenId.trim()
      : typeof record.tokenHash === "string" && record.tokenHash.trim()
      ? record.tokenHash.trim()
      : "unknown";
  return `token:${fallback}`;
}

function listTenantOAuthConnections(tenantId) {
  const map = new Map();
  for (const record of Object.values(db.oauthRefreshTokens)) {
    if (!record || record.status !== "active" || record.tenantId !== tenantId) {
      continue;
    }
    if (record.expiresAt && Date.parse(record.expiresAt) < Date.now()) {
      continue;
    }
    const key = oauthConnectionKeyFromRefreshRecord(record);
    const current = map.get(key);
    const client = record.clientId ? db.oauthClients[record.clientId] : null;
    const row = {
      connectionKey: key,
      clientId: record.clientId || null,
      clientName: client?.clientName || "Client app",
      scope: record.scope || "mcp:tools",
      createdAt: record.createdAt || null,
      updatedAt: record.updatedAt || null,
      expiresAt: record.expiresAt || null,
      revocable: true,
    };
    if (!current || Date.parse(row.updatedAt || 0) > Date.parse(current.updatedAt || 0)) {
      map.set(key, row);
    }
  }
  return Array.from(map.values()).sort(
    (a, b) => Date.parse(b.updatedAt || b.createdAt || 0) - Date.parse(a.updatedAt || a.createdAt || 0)
  );
}

function listTenantsForAccount(account) {
  if (!account?.licenseKey) {
    return [];
  }
  return Object.values(db.tenants)
    .filter((entry) => entry && entry.licenseKey === account.licenseKey)
    .sort((a, b) => Date.parse(b.updatedAt || 0) - Date.parse(a.updatedAt || 0));
}

function resolveTenantForAccount(account, preferredTenantId = "") {
  const matching = listTenantsForAccount(account);
  if (!matching.length) {
    return null;
  }
  if (preferredTenantId) {
    const found = matching.find((entry) => entry.tenantId === preferredTenantId);
    if (found) {
      return found;
    }
  }
  return matching[0];
}

function buildDashboardPayload(req, account, session, preferredTenantId = "") {
  const license = ensureAccountLicenseRecord(account);
  const tenants = listTenantsForAccount(account);
  const tenant = resolveTenantForAccount(account, preferredTenantId);
  if (tenant) {
    ensureTenantRecordShape(tenant);
  }
  const tokenRows = tenant ? listTenantMcpTokens(tenant.tenantId) : [];
  const connectionRows = tenant ? listTenantOAuthConnections(tenant.tenantId) : [];
  return {
    ok: true,
    account: accountPublicPayload(account),
    tenant: {
      tenantId: tenant?.tenantId || null,
      label: tenant?.label || null,
      createdAt: tenant?.createdAt || null,
      updatedAt: tenant?.updatedAt || null,
      shopify: tenant
        ? {
            domain: tenant.shopify?.domain || null,
            authMode: tenant.shopify?.accessToken ? "access_token" : "client_credentials",
            credentials: {
              domain: tenant.shopify?.domain || null,
              accessTokenMasked: maskSecret(tenant.shopify?.accessToken || null),
              clientIdMasked: maskSecret(tenant.shopify?.clientId || null),
              clientSecretMasked: maskSecret(tenant.shopify?.clientSecret || null),
              hasAccessToken: !!tenant.shopify?.accessToken,
              hasClientCredentials: !!tenant.shopify?.clientId && !!tenant.shopify?.clientSecret,
              validatedAt: tenant.shopify?.credentialsValidatedAt || null,
              lastValidationAt: tenant.shopify?.lastValidationAt || null,
              lastValidationError: tenant.shopify?.lastValidationError || null,
            },
          }
        : {
            domain: null,
            authMode: null,
            credentials: {
              domain: null,
              accessTokenMasked: null,
              clientIdMasked: null,
              clientSecretMasked: null,
              hasAccessToken: false,
              hasClientCredentials: false,
              validatedAt: null,
              lastValidationAt: null,
              lastValidationError: null,
            },
          },
      subscription: tenant ? tenant.subscription || defaultTenantSubscriptionProfile() : null,
    },
    tenants: tenants.map((entry) => {
      ensureTenantRecordShape(entry);
      const activeTokenCount = listTenantMcpTokens(entry.tenantId).filter(
        (token) => token.status === "active"
      ).length;
      const activeConnectionCount = listTenantOAuthConnections(entry.tenantId).length;
      return {
        tenantId: entry.tenantId,
        label: entry.label || null,
        createdAt: entry.createdAt || null,
        updatedAt: entry.updatedAt || null,
        active: entry.tenantId === tenant?.tenantId,
        shopify: {
          domain: entry.shopify?.domain || null,
          authMode: entry.shopify?.accessToken ? "access_token" : "client_credentials",
        },
        stats: {
          activeTokenCount,
          activeConnectionCount,
        },
      };
    }),
    license: {
      licenseKey: account.licenseKey,
      ...canonicalLicense(license),
    },
    mcp: {
      url: resolvedMcpPublicUrl(req),
      activeTokenCount: tokenRows.filter((entry) => entry.status === "active").length,
      tokens: tokenRows,
    },
    connections: {
      clients: connectionRows,
      oauth: connectionRows,
    },
    session: {
      expiresAt: session?.expiresAt || null,
      lastUsedAt: session?.lastUsedAt || null,
    },
  };
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter(Boolean);
}

function isAllowedRedirectUri(uriValue) {
  return isAllowedRedirectUriValue(uriValue, config.oauthAllowedCustomRedirectSchemes);
}

function oauthIssuerBase(req) {
  if (config.oauthIssuer) {
    return normalizeBaseUrl(config.oauthIssuer);
  }
  return requestBaseUrl(req);
}

function findLicenseByStripe(subscriptionId, customerId, licenseKeyFromMetadata) {
  if (licenseKeyFromMetadata && db.licenses[licenseKeyFromMetadata]) {
    return { key: licenseKeyFromMetadata, record: db.licenses[licenseKeyFromMetadata] };
  }
  for (const [key, record] of Object.entries(db.licenses)) {
    if (subscriptionId && record.stripeSubscriptionId === subscriptionId) {
      return { key, record };
    }
    if (customerId && record.stripeCustomerId === customerId) {
      return { key, record };
    }
  }
  return null;
}

function safeTimingEqual(a, b) {
  const aBuf = Buffer.from(a, "utf8");
  const bBuf = Buffer.from(b, "utf8");
  if (aBuf.length !== bBuf.length) {
    return false;
  }
  return crypto.timingSafeEqual(aBuf, bBuf);
}

function verifyStripeSignature(rawBody, header) {
  if (!config.stripeWebhookSecret) {
    return false;
  }
  if (!header || typeof header !== "string") {
    return false;
  }
  const parts = Object.fromEntries(
    header.split(",").map((segment) => {
      const [k, v] = segment.split("=");
      return [k, v];
    })
  );
  const ts = Number(parts.t || 0);
  const sig = parts.v1;
  if (!ts || !sig) {
    return false;
  }
  const age = Math.abs(Date.now() / 1000 - ts);
  if (age > config.timestampSkewSeconds) {
    return false;
  }
  const signedPayload = `${ts}.${rawBody}`;
  const expected = crypto
    .createHmac("sha256", config.stripeWebhookSecret)
    .update(signedPayload)
    .digest("hex");
  return safeTimingEqual(expected, sig);
}

function validateClientPayload(payload) {
  if (!payload || typeof payload !== "object") {
    throw new Error("Payload is required");
  }
  if (typeof payload.licenseKey !== "string" || payload.licenseKey.length < 8) {
    throw new Error("licenseKey is required");
  }
  if (typeof payload.machineFingerprint !== "string" || payload.machineFingerprint.length < 16) {
    throw new Error("machineFingerprint is required");
  }
  if (typeof payload.timestamp !== "string") {
    throw new Error("timestamp is required");
  }
  const ts = Date.parse(payload.timestamp);
  if (Number.isNaN(ts)) {
    throw new Error("timestamp is invalid");
  }
  const skew = Math.abs(Date.now() - ts) / 1000;
  if (skew > config.timestampSkewSeconds) {
    throw new Error("timestamp skew too large");
  }
}

function canBindFingerprint(record, fingerprint) {
  const list = Array.isArray(record.boundFingerprints) ? record.boundFingerprints : [];
  if (list.includes(fingerprint)) {
    return true;
  }
  const maxActivations = Number(record.maxActivations || 3);
  return list.length < maxActivations;
}

async function stripeRequest(method, pathname, params) {
  if (!config.stripeSecretKey) {
    throw new Error("STRIPE_SECRET_KEY is not configured");
  }
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined || value === "") {
      continue;
    }
    body.append(key, String(value));
  }
  const response = await fetch(`https://api.stripe.com${pathname}`, {
    method,
    headers: {
      Authorization: `Bearer ${config.stripeSecretKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Stripe response parse error (${response.status})`);
  }
  if (!response.ok) {
    const message = data?.error?.message || `Stripe HTTP ${response.status}`;
    throw new Error(message);
  }
  return data;
}

const publicUiHandlers = createPublicUiHandlers({
  appRoot: APP_ROOT,
  onboardingLogoPath: config.onboardingLogoPath,
  json,
  redirectTo,
  renderOnboardingLandingPage,
  renderLoginPage,
  renderSignupPage,
  renderDashboardPage,
  resolveAccountSession,
  safeRedirectPath,
});

const dashboardHandlers = createDashboardHandlers({
  db,
  config,
  json,
  nowIso,
  persistDb,
  buildDashboardPayload,
  requireAccountSession,
  resolveTenantForAccount,
  readBody,
  applyRateLimit,
  createMcpTokenForTenant,
  oauthConnectionKeyFromRefreshRecord,
  listTenantsForAccount,
});

const accountHandlers = createAccountHandlers({
  db,
  config,
  json,
  nowIso,
  persistDb,
  applyRateLimit,
  requireAccountSession,
  resolveAccountSession,
  readBody,
  randomId,
  createAccountAccessToken,
  generateLicenseKey,
  createPasswordDigest,
  verifyPasswordDigest,
  normalizeAccountEmail,
  normalizeOptionalEmail,
  findAccountByEmail,
  ensureAccountLicenseRecord,
  accountPublicPayload,
  createAccountSession,
  buildCookieHeader,
  accountSessionCookie: ACCOUNT_SESSION_COOKIE,
  isRequestSecure,
  setCookie,
  positiveNumber,
  clientIp,
  hashToken,
  addDays,
  buildDashboardPayload,
  validateTenantShopifyPayload,
  validateShopifyCredentialsLive,
  isLicenseUsableForOnboarding,
  findTenantByLicenseKey,
  ensureTenantRecordShape,
  buildTenantShopifyRecord,
  createMcpTokenForTenant,
  resolvedMcpPublicUrl,
  canonicalLicense,
  resolveTenantForAccount,
  listTenantMcpTokens,
  listTenantsForAccount,
});

const licenseBillingHandlers = createLicenseBillingHandlers({
  db,
  config,
  json,
  nowIso,
  persistDb,
  applyRateLimit,
  readBody,
  validateClientPayload,
  ensureFreeLicenseRecord,
  ensureLicenseRecordShape,
  canBindFingerprint,
  canonicalLicense,
  billingDisabledPayload,
  resolveConfiguredPriceId,
  resolvePaymentLink,
  isStripeModePaymentLink,
  isStripeSecretForMode,
  generateLicenseKey,
  requestBaseUrl,
  appendQueryParamsToUrl,
  stripeRequest,
  verifyStripeSignature,
  findLicenseByStripe,
  applyStripeSubscriptionSnapshot,
  hashToken,
  requireMcpApiKey,
  requireAdmin,
  billingReadiness,
  maskSecret,
  exchangeShopifyClientCredentials,
});

const adminHandlers = createAdminHandlers({
  appRoot: APP_ROOT,
  db,
  config,
  validStatuses: VALID_STATUSES,
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
});

const oauthHandlers = createOAuthHandlers({
  db,
  config,
  json,
  nowIso,
  persistDb,
  applyRateLimit,
  readBody,
  buildOauthMetadata,
  requestBaseUrl,
  normalizeBaseUrl,
  oauthJsonError,
  readJsonOrFormBody,
  validateOAuthClientAuthentication,
  verifyPkceCodeVerifier,
  appendQueryParamsToUrl,
  normalizeStringArray,
  isAllowedRedirectUri,
  randomId,
  hashToken,
  safeTimingEqual,
  addSeconds,
  addDays,
  positiveNumber,
  createMcpTokenForTenant,
  resolveAccountSession,
  safeRedirectPath,
  redirectTo,
  renderOAuthAuthorizePage: renderOAuthAuthorizePageV2,
  renderOAuthReconnectPage,
  ensureFreeLicenseRecord,
  isLicenseUsableForOnboarding,
  normalizeShopDomain,
  logEvent,
});

function ensureAccountLicenseRecord(account) {
  let license = db.licenses[account.licenseKey];
  if (!license && config.freeMode) {
    license = ensureFreeLicenseRecord(account.licenseKey);
  }
  if (!license) {
    db.licenses[account.licenseKey] = ensureLicenseRecordShape({
      licenseKey: account.licenseKey,
      status: "invalid",
      entitlements: defaultEntitlements(),
      maxActivations: 3,
      boundFingerprints: [],
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      pastDueSince: null,
      canceledAt: null,
    });
    license = db.licenses[account.licenseKey];
  }
  ensureLicenseRecordShape(license);
  if (config.freeMode) {
    license = ensureFreeLicenseRecord(account.licenseKey);
  }
  return license;
}

function routeNotFound(res) {
  return json(res, 404, { error: "not_found" });
}

const server = http.createServer(async (req, res) => {
  try {
    const method = req.method || "GET";
    const url = new URL(req.url || "/", `http://localhost:${config.port}`);
    applySecurityHeaders(req, res);

    if (method === "GET" && url.pathname === "/") {
      return publicUiHandlers.handleLandingPage(req, res);
    }
    if (method === "GET" && url.pathname === "/onboarding") {
      return publicUiHandlers.handleOnboardingPage(req, res, url);
    }
    if (method === "GET" && url.pathname === "/login") {
      return publicUiHandlers.handleLoginPage(req, res, url);
    }
    if (method === "GET" && url.pathname === "/signup") {
      return publicUiHandlers.handleSignupPage(req, res, url);
    }
    if (method === "GET" && url.pathname === "/dashboard") {
      return publicUiHandlers.handleDashboardPage(req, res, url);
    }
    if (method === "GET" && url.pathname === "/logo.png") {
      return publicUiHandlers.handleOnboardingLogo(req, res);
    }
    if (method === "GET" && url.pathname.startsWith("/assets/brands/")) {
      return publicUiHandlers.handleBrandAsset(req, res, url);
    }
    if (method === "GET" && url.pathname === "/.well-known/oauth-authorization-server") {
      return oauthHandlers.handleOAuthAuthorizationServerMetadata(req, res);
    }
    if (method === "GET" && url.pathname === "/.well-known/openid-configuration") {
      return oauthHandlers.handleOAuthOpenIdConfiguration(req, res);
    }
    if (method === "POST" && (url.pathname === "/oauth/register" || url.pathname === "/register")) {
      return oauthHandlers.handleOAuthRegister(req, res);
    }
    if (method === "GET" && (url.pathname === "/oauth/authorize" || url.pathname === "/authorize")) {
      return oauthHandlers.handleOAuthAuthorizeGet(req, res, url);
    }
    if (method === "POST" && (url.pathname === "/oauth/authorize" || url.pathname === "/authorize")) {
      return oauthHandlers.handleOAuthAuthorizePost(req, res);
    }
    if (method === "POST" && (url.pathname === "/oauth/token" || url.pathname === "/token")) {
      return oauthHandlers.handleOAuthToken(req, res);
    }
    if (method === "GET" && url.pathname === "/health") {
      return json(res, 200, { ok: true, service: "hazify-license-service", timestamp: nowIso() });
    }
    if (method === "GET" && url.pathname === "/v1/billing/readiness") {
      return licenseBillingHandlers.handleBillingReadiness(req, res);
    }
    if (method === "GET" && url.pathname === "/v1/account/me") {
      return accountHandlers.handleAccountMe(req, res);
    }
    if (method === "GET" && url.pathname === "/v1/session/bootstrap") {
      return accountHandlers.handleSessionBootstrap(req, res);
    }
    if (method === "POST" && url.pathname === "/v1/account/signup") {
      return accountHandlers.handleAccountSignup(req, res);
    }
    if (method === "POST" && url.pathname === "/v1/account/login") {
      return accountHandlers.handleAccountLogin(req, res);
    }
    if (method === "POST" && url.pathname === "/v1/account/logout") {
      return accountHandlers.handleAccountLogout(req, res);
    }
    if (method === "GET" && url.pathname === "/v1/admin/readiness") {
      return licenseBillingHandlers.handleAdminReadiness(req, res);
    }

    if (method === "POST" && url.pathname === "/v1/license/validate") {
      return licenseBillingHandlers.handleValidateOrHeartbeat(req, res, "validate");
    }
    if (method === "POST" && url.pathname === "/v1/license/heartbeat") {
      return licenseBillingHandlers.handleValidateOrHeartbeat(req, res, "heartbeat");
    }
    if (method === "POST" && url.pathname === "/v1/license/deactivate") {
      return licenseBillingHandlers.handleDeactivate(req, res);
    }

    if (method === "POST" && url.pathname === "/v1/billing/create-checkout-session") {
      return licenseBillingHandlers.handleCreateCheckout(req, res);
    }
    if (method === "POST" && url.pathname === "/v1/billing/create-portal-session") {
      return licenseBillingHandlers.handleCreatePortalSession(req, res);
    }

    if (method === "POST" && url.pathname === "/v1/stripe/webhook") {
      return licenseBillingHandlers.handleStripeWebhook(req, res);
    }

    if (method === "POST" && url.pathname === "/v1/admin/license/create") {
      return adminHandlers.handleAdminCreate(req, res);
    }
    if (method === "POST" && url.pathname === "/v1/admin/license/update-status") {
      return adminHandlers.handleAdminUpdateStatus(req, res);
    }
    if (method === "POST" && url.pathname === "/v1/admin/tenant/upsert") {
      return adminHandlers.handleAdminUpsertTenant(req, res);
    }
    if (method === "POST" && url.pathname === "/v1/admin/mcp/token/create") {
      return adminHandlers.handleAdminCreateMcpToken(req, res);
    }
    if (method === "POST" && url.pathname === "/v1/admin/mcp/token/revoke") {
      return adminHandlers.handleAdminRevokeMcpToken(req, res);
    }
    if (method === "POST" && url.pathname === "/v1/admin/tenant/revalidate") {
      return adminHandlers.handleAdminRevalidateTenants(req, res);
    }
    if (method === "POST" && url.pathname === "/v1/admin/storage/export") {
      return adminHandlers.handleAdminStorageExport(req, res);
    }
    if (method === "POST" && url.pathname === "/v1/mcp/token/introspect") {
      return licenseBillingHandlers.handleMcpTokenIntrospect(req, res);
    }
    if (method === "POST" && url.pathname === "/v1/mcp/token/exchange") {
      return licenseBillingHandlers.handleMcpTokenExchange(req, res);
    }
    if (method === "POST" && url.pathname === "/v1/onboarding/connect-shopify") {
      return accountHandlers.handleOnboardingConnectShopify(req, res);
    }
    if (method === "GET" && url.pathname === "/v1/dashboard/state") {
      return dashboardHandlers.handleDashboardState(req, res);
    }
    if (method === "POST" && url.pathname === "/v1/dashboard/mcp-token/create") {
      return dashboardHandlers.handleDashboardCreateMcpToken(req, res);
    }
    if (method === "POST" && url.pathname === "/v1/dashboard/mcp-token/revoke") {
      return dashboardHandlers.handleDashboardRevokeMcpToken(req, res);
    }
    if (method === "POST" && url.pathname === "/v1/dashboard/oauth/revoke") {
      return dashboardHandlers.handleDashboardRevokeOAuthConnection(req, res);
    }
    if (method === "POST" && url.pathname === "/v1/dashboard/tenant/delete") {
      return dashboardHandlers.handleDashboardDeleteTenant(req, res);
    }

    if (method === "GET" && url.pathname.startsWith("/v1/admin/license/")) {
      return adminHandlers.handleAdminLicenseGet(req, res, url);
    }

    if (method === "GET" && url.pathname.startsWith("/v1/admin/tenant/")) {
      return adminHandlers.handleAdminTenantGet(req, res, url);
    }

    return routeNotFound(res);
  } catch (error) {
    if (error && typeof error === "object" && error.code === "payload_too_large") {
      return json(res, 413, {
        error: "payload_too_large",
        message: error instanceof Error ? error.message : "Request body too large",
      });
    }
    return json(res, 500, {
      error: "internal_error",
      message: error instanceof Error ? error.message : String(error),
    });
  }
});

server.on("close", () => {
  closeStorage().catch((error) => {
    console.error("Failed to close storage cleanly:", error);
  });
});

server.listen(config.port, () => {
  console.log(`hazify-license-service listening on :${config.port}`);
  if (config.databaseUrl) {
    console.log("Storage: PostgreSQL (DATABASE_URL)");
  } else {
    console.log(`Storage: JSON file (${config.dbPath})`);
    if (String(process.env.NODE_ENV || "").toLowerCase() === "production") {
      console.warn(
        "WARNING: DATABASE_URL ontbreekt in productie; account- en OAuth-data zijn dan niet persistent bij redeploy/restart."
      );
    }
  }
});

export { server };
