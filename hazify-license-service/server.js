import crypto from "crypto";
import fs from "fs/promises";
import http from "http";
import path from "path";
import { URL, fileURLToPath } from "url";
import { createStorageAdapter } from "./src/repositories/storage-adapter.js";
import {
  renderDashboardPage,
  renderLoginPage,
  renderOAuthAuthorizePage as renderOAuthAuthorizePageV2,
  renderOAuthReconnectPage,
  renderOnboardingLandingPage,
  renderSignupPage,
} from "./src/views/pages.js";

const SERVICE_ROOT = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ONBOARDING_LOGO_PATH = path.resolve(SERVICE_ROOT, "logo.png");

const config = {
  port: Number(process.env.PORT || 8787),
  dbPath: path.resolve(SERVICE_ROOT, process.env.LICENSE_DB_PATH || "data/licenses.json"),
  adminApiKey: process.env.ADMIN_API_KEY || "",
  mcpApiKey: process.env.MCP_API_KEY || process.env.HAZIFY_MCP_API_KEY || "",
  publicBaseUrl: process.env.PUBLIC_BASE_URL || "",
  mcpPublicUrl: process.env.MCP_PUBLIC_URL || "",
  licenseGraceHours: Number(process.env.LICENSE_GRACE_HOURS || 72),
  readOnlyGraceDays: Number(process.env.READ_ONLY_GRACE_DAYS || 7),
  rateLimitPerMinute: Number(process.env.RATE_LIMIT_PER_MINUTE || 120),
  timestampSkewSeconds: Number(process.env.TIMESTAMP_SKEW_SECONDS || 900),
  freeMode: String(process.env.HAZIFY_FREE_MODE || "true").trim().toLowerCase() !== "false",
  stripeSecretKey: process.env.STRIPE_SECRET_KEY || "",
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET || "",
  stripeMode:
    String(process.env.STRIPE_MODE || "").trim().toLowerCase() === "test" ? "test" : "live",
  stripeDefaultPriceId: process.env.STRIPE_DEFAULT_PRICE_ID || "",
  stripeMonthlyPriceId: process.env.STRIPE_MONTHLY_PRICE_ID || "",
  stripeYearlyPriceId: process.env.STRIPE_YEARLY_PRICE_ID || "",
  stripeMonthlyPaymentLink: process.env.STRIPE_MONTHLY_PAYMENT_LINK || "",
  stripeYearlyPaymentLink: process.env.STRIPE_YEARLY_PAYMENT_LINK || "",
  checkoutSuccessUrl: process.env.CHECKOUT_SUCCESS_URL || "",
  checkoutCancelUrl: process.env.CHECKOUT_CANCEL_URL || "",
  portalReturnUrl: process.env.PORTAL_RETURN_URL || "",
  oauthIssuer: process.env.OAUTH_ISSUER || "",
  oauthAccessTokenTtlSeconds: Number(process.env.OAUTH_ACCESS_TOKEN_TTL_SECONDS || 3600),
  oauthRefreshTokenTtlDays: Number(process.env.OAUTH_REFRESH_TOKEN_TTL_DAYS || 30),
  oauthCodeTtlMinutes: Number(process.env.OAUTH_CODE_TTL_MINUTES || 10),
  onboardingLogoPath: path.resolve(process.env.ONBOARDING_LOGO_PATH || DEFAULT_ONBOARDING_LOGO_PATH),
  accountSessionTtlDays: Number(process.env.ACCOUNT_SESSION_TTL_DAYS || 14),
  databaseUrl: process.env.DATABASE_URL || "",
  databaseSsl: process.env.DATABASE_SSL ?? "true",
  dbPoolMax: Number(process.env.DB_POOL_MAX || 10),
  dbStatementTimeoutMs: Number(process.env.DB_STATEMENT_TIMEOUT_MS || 5000),
  dataEncryptionKey: process.env.DATA_ENCRYPTION_KEY || "",
  backupExportKey: process.env.BACKUP_EXPORT_KEY || "",
};

const RATE_BUCKETS = new Map();
const VALID_STATUSES = new Set(["active", "past_due", "canceled", "invalid", "unpaid"]);
const ACCOUNT_SESSION_COOKIE = "hz_user_session";
const storage = createStorageAdapter(config);
await storage.init();
let db = await loadDb();
db = await maybeBootstrapPostgresFromLegacyJson(db);
let writeQueue = Promise.resolve();

function nowIso() {
  return new Date().toISOString();
}

function addHours(iso, hours) {
  const base = Date.parse(iso || nowIso());
  return new Date(base + hours * 60 * 60 * 1000).toISOString();
}

function addDays(iso, days) {
  const base = Date.parse(iso || nowIso());
  return new Date(base + days * 24 * 60 * 60 * 1000).toISOString();
}

function addSeconds(iso, seconds) {
  const base = Date.parse(iso || nowIso());
  return new Date(base + seconds * 1000).toISOString();
}

function unixToIso(value) {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return null;
  }
  return new Date(numeric * 1000).toISOString();
}

function positiveNumber(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
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

function defaultEntitlements() {
  return { mutations: true, tools: {} };
}

function defaultLicenseSubscription(record = {}) {
  return {
    provider: "stripe",
    status: record.stripeSubscriptionId ? "linked" : "inactive",
    planCode: null,
    priceId: null,
    interval: null,
    seats: 1,
    customerId: record.stripeCustomerId || null,
    subscriptionId: record.stripeSubscriptionId || null,
    currentPeriodStart: null,
    currentPeriodEnd: null,
    cancelAt: null,
    canceledAt: record.canceledAt || null,
    trialEndsAt: null,
    metadata: {},
  };
}

function ensureLicenseRecordShape(record) {
  if (!record || typeof record !== "object") {
    return record;
  }
  record.entitlements =
    record.entitlements && typeof record.entitlements === "object"
      ? record.entitlements
      : defaultEntitlements();
  record.maxActivations = positiveNumber(record.maxActivations, 3);
  record.boundFingerprints = Array.isArray(record.boundFingerprints) ? record.boundFingerprints : [];
  record.stripeCustomerId =
    typeof record.stripeCustomerId === "string" && record.stripeCustomerId.trim()
      ? record.stripeCustomerId.trim()
      : null;
  record.stripeSubscriptionId =
    typeof record.stripeSubscriptionId === "string" && record.stripeSubscriptionId.trim()
      ? record.stripeSubscriptionId.trim()
      : null;

  if (!record.subscription || typeof record.subscription !== "object") {
    record.subscription = defaultLicenseSubscription(record);
  } else {
    const merged = { ...defaultLicenseSubscription(record), ...record.subscription };
    merged.provider =
      typeof merged.provider === "string" && merged.provider.trim() ? merged.provider.trim() : "stripe";
    merged.status =
      typeof merged.status === "string" && merged.status.trim() ? merged.status.trim() : "inactive";
    merged.seats = positiveNumber(merged.seats, 1);
    merged.customerId =
      typeof merged.customerId === "string" && merged.customerId.trim()
        ? merged.customerId.trim()
        : record.stripeCustomerId;
    merged.subscriptionId =
      typeof merged.subscriptionId === "string" && merged.subscriptionId.trim()
        ? merged.subscriptionId.trim()
        : record.stripeSubscriptionId;
    merged.metadata = merged.metadata && typeof merged.metadata === "object" ? merged.metadata : {};
    record.subscription = merged;
  }

  if (!record.stripeCustomerId && record.subscription.customerId) {
    record.stripeCustomerId = record.subscription.customerId;
  }
  if (!record.stripeSubscriptionId && record.subscription.subscriptionId) {
    record.stripeSubscriptionId = record.subscription.subscriptionId;
  }
  return record;
}

function defaultTenantSubscriptionProfile() {
  return {
    provider: "stripe",
    status: "inactive",
    planCode: null,
    priceId: null,
    interval: null,
    seats: 1,
    nextRenewalAt: null,
    cancelAt: null,
    metadata: {},
  };
}

function ensureTenantRecordShape(record) {
  if (!record || typeof record !== "object") {
    return record;
  }
  if (!record.subscription || typeof record.subscription !== "object") {
    record.subscription = defaultTenantSubscriptionProfile();
  } else {
    const merged = { ...defaultTenantSubscriptionProfile(), ...record.subscription };
    merged.provider =
      typeof merged.provider === "string" && merged.provider.trim() ? merged.provider.trim() : "stripe";
    merged.status =
      typeof merged.status === "string" && merged.status.trim() ? merged.status.trim() : "inactive";
    merged.seats = positiveNumber(merged.seats, 1);
    merged.metadata = merged.metadata && typeof merged.metadata === "object" ? merged.metadata : {};
    record.subscription = merged;
  }
  return record;
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

function safeRedirectPath(value, fallback = "/dashboard") {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw.startsWith("/")) {
    return fallback;
  }
  if (raw.startsWith("//")) {
    return fallback;
  }
  return raw;
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
  for await (const chunk of req) {
    chunks.push(Buffer.from(chunk));
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

function normalizeShopDomain(value) {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/+$/, "");
}

function normalizeOptionalEmail(value) {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    throw new Error("contactEmail must be a valid email address");
  }
  return normalized;
}

function normalizeAccountEmail(value) {
  const normalized = normalizeOptionalEmail(value);
  if (!normalized) {
    throw new Error("email is required");
  }
  return normalized;
}

function parseCookies(req) {
  const header = req.headers.cookie;
  if (typeof header !== "string" || !header.trim()) {
    return {};
  }
  return Object.fromEntries(
    header
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf("=");
        if (index < 0) {
          return [part, ""];
        }
        return [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
      })
  );
}

function isRequestSecure(req) {
  const forwardedProto = req.headers["x-forwarded-proto"];
  if (typeof forwardedProto === "string" && forwardedProto.toLowerCase().includes("https")) {
    return true;
  }
  return !!req.socket?.encrypted;
}

function buildCookieHeader(name, value, options = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, "Path=/", "HttpOnly", "SameSite=Lax"];
  if (options.maxAgeSeconds && Number.isFinite(Number(options.maxAgeSeconds))) {
    parts.push(`Max-Age=${Math.max(0, Number(options.maxAgeSeconds))}`);
  }
  if (options.secure) {
    parts.push("Secure");
  }
  return parts.join("; ");
}

function setCookie(res, cookieValue) {
  const current = res.getHeader("Set-Cookie");
  if (!current) {
    res.setHeader("Set-Cookie", [cookieValue]);
    return;
  }
  if (Array.isArray(current)) {
    res.setHeader("Set-Cookie", [...current, cookieValue]);
    return;
  }
  res.setHeader("Set-Cookie", [String(current), cookieValue]);
}

function passwordHash(password, salt) {
  return crypto.scryptSync(String(password), String(salt), 64).toString("hex");
}

function createPasswordDigest(password) {
  const value = typeof password === "string" ? password : "";
  if (value.length < 10) {
    throw new Error("Gebruik een wachtwoord van minimaal 10 tekens.");
  }
  const salt = crypto.randomBytes(16).toString("hex");
  return {
    salt,
    hash: passwordHash(value, salt),
  };
}

function verifyPasswordDigest(password, salt, expectedHash) {
  const digest = passwordHash(password, salt);
  return safeTimingEqual(digest, expectedHash);
}

function findAccountByEmail(email) {
  const normalized = normalizeAccountEmail(email);
  return (
    Object.values(db.accounts).find(
      (entry) =>
        entry &&
        entry.status !== "disabled" &&
        typeof entry.email === "string" &&
        normalizeOptionalEmail(entry.email) === normalized
    ) || null
  );
}

function createAccountSession(accountId, req = null) {
  const token = `hzacct_${crypto.randomBytes(24).toString("hex")}`;
  const sessionId = randomId("acctsess");
  const ttlDays = positiveNumber(config.accountSessionTtlDays, 14);
  const expiresAt = addDays(nowIso(), ttlDays);
  const userAgent =
    req && typeof req.headers?.["user-agent"] === "string" ? req.headers["user-agent"].slice(0, 300) : null;
  const rawIp = req ? clientIp(req) : "";
  const ipHash = rawIp ? hashToken(rawIp) : null;
  db.accountSessions[sessionId] = {
    sessionId,
    accountId,
    tokenHash: hashToken(token),
    status: "active",
    createdAt: nowIso(),
    updatedAt: nowIso(),
    lastUsedAt: null,
    expiresAt,
    userAgent,
    ipHash,
  };
  return {
    sessionId,
    token,
    expiresAt,
  };
}

function resolveAccountSessionFromRequest(req) {
  const cookies = parseCookies(req);
  const rawToken = cookies[ACCOUNT_SESSION_COOKIE];
  if (!rawToken) {
    return { account: null, session: null, reason: "missing" };
  }
  const tokenHash = hashToken(rawToken);
  const session = Object.values(db.accountSessions).find(
    (entry) => entry && entry.status === "active" && entry.tokenHash === tokenHash
  );
  if (!session) {
    return { account: null, session: null, reason: "invalid" };
  }
  if (session.expiresAt && Date.parse(session.expiresAt) < Date.now()) {
    session.status = "expired";
    session.updatedAt = nowIso();
    return { account: null, session: null, reason: "expired" };
  }
  const account = db.accounts[session.accountId] || null;
  if (!account || account.status === "disabled") {
    return { account: null, session: null, reason: "account_missing" };
  }
  return { account, session, reason: null };
}

async function requireAccountSession(req, res) {
  const resolved = resolveAccountSessionFromRequest(req);
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

function hashToken(token) {
  return crypto.createHash("sha256").update(token, "utf8").digest("hex");
}

function normalizeBaseUrl(value) {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim().replace(/\/+$/, "");
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

function resolveConfiguredPriceId(payload) {
  const requested = typeof payload?.plan === "string" ? payload.plan.trim().toLowerCase() : "";
  if (requested === "monthly") {
    return config.stripeMonthlyPriceId || config.stripeDefaultPriceId || "";
  }
  if (requested === "yearly" || requested === "annual") {
    return config.stripeYearlyPriceId || "";
  }
  if (typeof payload?.priceId === "string" && payload.priceId.trim()) {
    return payload.priceId.trim();
  }
  return config.stripeDefaultPriceId || config.stripeMonthlyPriceId || "";
}

function resolvePaymentLink(payload) {
  const requested = typeof payload?.plan === "string" ? payload.plan.trim().toLowerCase() : "";
  if (requested === "yearly" || requested === "annual") {
    return config.stripeYearlyPaymentLink || "";
  }
  if (requested === "monthly") {
    return config.stripeMonthlyPaymentLink || "";
  }
  return config.stripeMonthlyPaymentLink || config.stripeYearlyPaymentLink || "";
}

function appendCheckoutQueryParams(urlValue, params) {
  if (!urlValue) {
    return "";
  }
  const url = new URL(urlValue);
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== undefined && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

function isStripeTestSecret(value) {
  return typeof value === "string" && value.trim().startsWith("sk_test_");
}

function isStripeLiveSecret(value) {
  return typeof value === "string" && value.trim().startsWith("sk_live_");
}

function isStripeModePaymentLink(value, mode) {
  if (typeof value !== "string" || !value.trim()) {
    return false;
  }
  const normalized = value.trim().toLowerCase();
  if (mode === "test") {
    return normalized.includes("buy.stripe.com/test_");
  }
  return normalized.includes("buy.stripe.com/") && !normalized.includes("buy.stripe.com/test_");
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

function isLicenseUsableForOnboarding(record) {
  if (!record) {
    return false;
  }
  const status = VALID_STATUSES.has(record.status) ? record.status : "invalid";
  return status !== "invalid";
}

function billingDisabledPayload() {
  return {
    error: "billing_disabled",
    message: "Billing is disabled because HAZIFY_FREE_MODE=true",
    freeMode: true,
  };
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

function listTenantOAuthConnections(tenantId) {
  const map = new Map();
  for (const record of Object.values(db.oauthRefreshTokens)) {
    if (!record || record.status !== "active" || record.tenantId !== tenantId) {
      continue;
    }
    if (record.expiresAt && Date.parse(record.expiresAt) < Date.now()) {
      continue;
    }
    const key = record.clientId || `oauth:${record.refreshTokenId || record.tokenHash || "unknown"}`;
    const current = map.get(key);
    const client = record.clientId ? db.oauthClients[record.clientId] : null;
    const row = {
      clientId: record.clientId || null,
      clientName: client?.clientName || "Client app",
      scope: record.scope || "mcp:tools",
      createdAt: record.createdAt || null,
      updatedAt: record.updatedAt || null,
      expiresAt: record.expiresAt || null,
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
          }
        : {
            domain: null,
            authMode: null,
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
  if (typeof uriValue !== "string" || !uriValue.trim()) {
    return false;
  }
  try {
    const url = new URL(uriValue);
    if (url.protocol === "https:") {
      return true;
    }
    if (url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1")) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

function oauthIssuerBase(req) {
  if (config.oauthIssuer) {
    return normalizeBaseUrl(config.oauthIssuer);
  }
  return requestBaseUrl(req);
}

function oauthMetadata(req) {
  const issuer = oauthIssuerBase(req);
  return {
    issuer,
    authorization_endpoint: `${issuer}/oauth/authorize`,
    token_endpoint: `${issuer}/oauth/token`,
    registration_endpoint: `${issuer}/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    token_endpoint_auth_methods_supported: ["none", "client_secret_post", "client_secret_basic"],
    code_challenge_methods_supported: ["S256", "plain"],
    scopes_supported: ["mcp:tools", "offline_access"],
    service_documentation: `${requestBaseUrl(req)}/onboarding`,
  };
}

function readFormEncodedBody(rawBody) {
  const params = new URLSearchParams(rawBody);
  const payload = {};
  for (const [key, value] of params.entries()) {
    if (Object.prototype.hasOwnProperty.call(payload, key)) {
      const current = payload[key];
      payload[key] = Array.isArray(current) ? [...current, value] : [current, value];
    } else {
      payload[key] = value;
    }
  }
  return payload;
}

async function readJsonOrFormBody(req) {
  const contentType = String(req.headers["content-type"] || "").toLowerCase();
  const { raw } = await readBody(req, true);
  const text = raw || "";
  if (!text.trim()) {
    return {};
  }
  if (contentType.includes("application/json")) {
    try {
      return JSON.parse(text);
    } catch {
      throw new Error("Invalid JSON body");
    }
  }
  if (contentType.includes("application/x-www-form-urlencoded")) {
    return readFormEncodedBody(text);
  }
  try {
    return JSON.parse(text);
  } catch {
    return readFormEncodedBody(text);
  }
}

function base64UrlEncode(input) {
  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(String(input), "utf8");
  return buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function verifyPkceCodeVerifier(codeVerifier, challenge, method) {
  const verifier = typeof codeVerifier === "string" ? codeVerifier.trim() : "";
  if (!verifier) {
    return false;
  }
  const normalizedMethod = typeof method === "string" && method.trim() ? method.trim() : "plain";
  if (normalizedMethod === "S256") {
    const digest = crypto.createHash("sha256").update(verifier, "utf8").digest();
    return base64UrlEncode(digest) === challenge;
  }
  if (normalizedMethod === "plain") {
    return verifier === challenge;
  }
  return false;
}

function getTenantsByLicenseKey(licenseKey) {
  return Object.values(db.tenants).filter((tenant) => tenant?.licenseKey === licenseKey);
}

function resolveTenantForOAuth(licenseKey, shopDomainInput) {
  const tenants = getTenantsByLicenseKey(licenseKey);
  if (!tenants.length) {
    throw new Error("Geen tenant gevonden voor deze license key. Doorloop eerst onboarding.");
  }
  if (typeof shopDomainInput === "string" && shopDomainInput.trim()) {
    const requestedDomain = normalizeShopDomain(shopDomainInput);
    const matched = tenants.find((tenant) => tenant.shopify?.domain === requestedDomain);
    if (!matched) {
      throw new Error("Shop domain hoort niet bij deze license key.");
    }
    return matched;
  }
  if (tenants.length > 1) {
    throw new Error("Meerdere shops gekoppeld. Geef shopDomain op in de autorisatie.");
  }
  return tenants[0];
}

function appendQueryParamsToUrl(urlValue, params) {
  const url = new URL(urlValue);
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== undefined && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

function oauthJsonError(res, statusCode, error, description) {
  return json(res, statusCode, {
    error,
    error_description: description,
  });
}

function parseBasicClientAuth(req) {
  const authHeader = req.headers.authorization;
  if (typeof authHeader !== "string") {
    return null;
  }
  const match = authHeader.match(/^Basic\s+(.+)$/i);
  if (!match?.[1]) {
    return null;
  }
  try {
    const decoded = Buffer.from(match[1], "base64").toString("utf8");
    const separator = decoded.indexOf(":");
    if (separator < 0) {
      return null;
    }
    return {
      clientId: decoded.slice(0, separator),
      clientSecret: decoded.slice(separator + 1),
    };
  } catch {
    return null;
  }
}

function resolveClientCredentials(req, payload) {
  const basic = parseBasicClientAuth(req);
  if (basic?.clientId) {
    return basic;
  }
  return {
    clientId: typeof payload.client_id === "string" ? payload.client_id.trim() : "",
    clientSecret: typeof payload.client_secret === "string" ? payload.client_secret : "",
  };
}

function validateOAuthClientAuthentication(req, payload, client) {
  const method =
    typeof client.tokenEndpointAuthMethod === "string" && client.tokenEndpointAuthMethod
      ? client.tokenEndpointAuthMethod
      : "none";
  const creds = resolveClientCredentials(req, payload);
  if (method === "none") {
    if (creds.clientId && creds.clientId !== client.clientId) {
      throw new Error("invalid_client");
    }
    return;
  }
  if (!creds.clientId || !creds.clientSecret) {
    throw new Error("invalid_client");
  }
  if (creds.clientId !== client.clientId) {
    throw new Error("invalid_client");
  }
  if (!client.clientSecretHash || !safeTimingEqual(hashToken(creds.clientSecret), client.clientSecretHash)) {
    throw new Error("invalid_client");
  }
}

function canonicalLicense(record) {
  ensureLicenseRecordShape(record);
  const status = VALID_STATUSES.has(record.status) ? record.status : "invalid";
  const payload = {
    status,
    entitlements: record.entitlements || { mutations: true, tools: {} },
    expiresAt: record.expiresAt || null,
    graceUntil: null,
    readOnlyGraceUntil: null,
    subscription: record.subscription || defaultLicenseSubscription(record),
  };
  if (status === "past_due") {
    const start = record.pastDueSince || nowIso();
    payload.graceUntil = addHours(start, config.licenseGraceHours);
  }
  if (status === "canceled" || status === "unpaid") {
    const start = record.canceledAt || nowIso();
    payload.readOnlyGraceUntil = addDays(start, config.readOnlyGraceDays);
  }
  return payload;
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

function mapStripeStatus(status) {
  switch (status) {
    case "active":
    case "trialing":
      return "active";
    case "past_due":
    case "incomplete":
      return "past_due";
    case "unpaid":
      return "unpaid";
    case "canceled":
    case "incomplete_expired":
      return "canceled";
    default:
      return "invalid";
  }
}

function applyStripeSubscriptionSnapshot(record, object = {}) {
  ensureLicenseRecordShape(record);
  const status = mapStripeStatus(object.status);
  const subscriptionItem = Array.isArray(object.items?.data) ? object.items.data[0] : null;
  const price = subscriptionItem?.price || null;

  record.status = status;
  record.stripeCustomerId = object.customer || record.stripeCustomerId || null;
  record.stripeSubscriptionId = object.id || record.stripeSubscriptionId || null;
  record.subscription.provider = "stripe";
  record.subscription.status = status;
  record.subscription.customerId = record.stripeCustomerId;
  record.subscription.subscriptionId = record.stripeSubscriptionId;
  record.subscription.planCode =
    typeof object.metadata?.plan_code === "string" && object.metadata.plan_code.trim()
      ? object.metadata.plan_code.trim()
      : record.subscription.planCode;
  record.subscription.priceId = price?.id || record.subscription.priceId || null;
  record.subscription.interval = price?.recurring?.interval || record.subscription.interval || null;
  record.subscription.seats = positiveNumber(
    subscriptionItem?.quantity || record.subscription.seats || 1,
    1
  );
  record.subscription.currentPeriodStart = unixToIso(object.current_period_start);
  record.subscription.currentPeriodEnd = unixToIso(object.current_period_end);
  record.subscription.cancelAt = unixToIso(object.cancel_at);
  record.subscription.canceledAt = unixToIso(object.canceled_at) || record.canceledAt || null;
  record.subscription.trialEndsAt = unixToIso(object.trial_end);
  record.subscription.metadata =
    object.metadata && typeof object.metadata === "object"
      ? object.metadata
      : record.subscription.metadata || {};
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

async function handleValidateOrHeartbeat(req, res, mode) {
  if (!applyRateLimit(req, res)) {
    return;
  }
  try {
    const { json: payload } = await readBody(req);
    validateClientPayload(payload);

    let record = db.licenses[payload.licenseKey];
    if (!record && config.freeMode) {
      record = ensureFreeLicenseRecord(payload.licenseKey);
    }
    if (!record) {
      return json(res, 200, {
        status: "invalid",
        entitlements: { mutations: false, tools: {} },
        expiresAt: null,
        graceUntil: null,
        readOnlyGraceUntil: null,
      });
    }
    if (config.freeMode && record.status !== "active") {
      record = ensureFreeLicenseRecord(payload.licenseKey);
    }
    ensureLicenseRecordShape(record);

    record.boundFingerprints = Array.isArray(record.boundFingerprints) ? record.boundFingerprints : [];
    if (!record.boundFingerprints.includes(payload.machineFingerprint)) {
      if (!canBindFingerprint(record, payload.machineFingerprint)) {
        return json(res, 200, {
          status: "invalid",
          entitlements: { mutations: false, tools: {} },
          expiresAt: null,
          graceUntil: null,
          readOnlyGraceUntil: null,
          message: "Activation limit reached",
        });
      }
      record.boundFingerprints.push(payload.machineFingerprint);
    }

    if (record.status === "past_due" && !record.pastDueSince) {
      record.pastDueSince = nowIso();
    }
    if ((record.status === "canceled" || record.status === "unpaid") && !record.canceledAt) {
      record.canceledAt = nowIso();
    }

    record.lastSeenAt = nowIso();
    record.updatedAt = nowIso();
    record.lastMcpVersion = typeof payload.mcpVersion === "string" ? payload.mcpVersion : null;
    await persistDb();

    const normalized = canonicalLicense(record);
    return json(res, 200, normalized);
  } catch (error) {
    return json(res, 400, {
      error: "bad_request",
      message: error instanceof Error ? error.message : String(error),
      mode,
    });
  }
}

async function handleDeactivate(req, res) {
  if (!applyRateLimit(req, res)) {
    return;
  }
  try {
    const { json: payload } = await readBody(req);
    validateClientPayload(payload);
    const record = db.licenses[payload.licenseKey];
    if (record && Array.isArray(record.boundFingerprints)) {
      record.boundFingerprints = record.boundFingerprints.filter(
        (fp) => fp !== payload.machineFingerprint
      );
      record.updatedAt = nowIso();
      await persistDb();
    }
    return json(res, 200, { ok: true });
  } catch (error) {
    return json(res, 400, {
      error: "bad_request",
      message: error instanceof Error ? error.message : String(error),
    });
  }
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

async function handleCreateCheckout(req, res) {
  if (!applyRateLimit(req, res)) {
    return;
  }
  if (config.freeMode) {
    return json(res, 409, {
      ...billingDisabledPayload(),
      endpoint: "/v1/billing/create-checkout-session",
    });
  }
  try {
    const { json: payload } = await readBody(req);
    const customerEmail = payload.customerEmail;
    const priceId = resolveConfiguredPriceId(payload);

    if (!customerEmail) {
      throw new Error("customerEmail is required");
    }

    const licenseKey = payload.licenseKey || generateLicenseKey();
    const baseUrl = requestBaseUrl(req);
    const successUrl =
      payload.successUrl ||
      config.checkoutSuccessUrl ||
      `${baseUrl}/onboarding?payment=success&licenseKey=${encodeURIComponent(licenseKey)}`;
    const cancelUrl =
      payload.cancelUrl ||
      config.checkoutCancelUrl ||
      `${baseUrl}/onboarding?payment=cancel&licenseKey=${encodeURIComponent(licenseKey)}`;

    if (!db.licenses[licenseKey]) {
      db.licenses[licenseKey] = ensureLicenseRecordShape({
        licenseKey,
        status: "invalid",
        entitlements: { mutations: true, tools: {} },
        maxActivations: 3,
        boundFingerprints: [],
        stripeCustomerId: null,
        stripeSubscriptionId: null,
        createdAt: nowIso(),
        updatedAt: nowIso(),
      });
      await persistDb();
    }

    if (!config.stripeSecretKey) {
      const paymentLink = resolvePaymentLink(payload);
      if (!paymentLink) {
        throw new Error(
          "STRIPE_SECRET_KEY ontbreekt en er is geen STRIPE_MONTHLY_PAYMENT_LINK/STRIPE_YEARLY_PAYMENT_LINK ingesteld"
        );
      }
      if (!isStripeModePaymentLink(paymentLink, config.stripeMode)) {
        throw new Error(
          `Payment link past niet bij STRIPE_MODE=${config.stripeMode}. Gebruik een ${config.stripeMode} link.`
        );
      }

      const checkoutUrl = appendCheckoutQueryParams(paymentLink, {
        client_reference_id: licenseKey,
        prefilled_email: customerEmail,
      });

      return json(res, 200, {
        mode: "payment_link_fallback",
        stripeMode: config.stripeMode,
        managedCheckoutAvailable: false,
        checkoutUrl,
        licenseKey,
        onboardingUrl: `${baseUrl}/onboarding?licenseKey=${encodeURIComponent(licenseKey)}`,
      });
    }

    if (!priceId) {
      throw new Error("priceId ontbreekt (zet STRIPE_DEFAULT_PRICE_ID of kies een plan met prijs-ID)");
    }
    if (
      (config.stripeMode === "test" && !isStripeTestSecret(config.stripeSecretKey)) ||
      (config.stripeMode === "live" && !isStripeLiveSecret(config.stripeSecretKey))
    ) {
      throw new Error(
        `STRIPE_SECRET_KEY past niet bij STRIPE_MODE=${config.stripeMode}.`
      );
    }

    const session = await stripeRequest("POST", "/v1/checkout/sessions", {
      mode: "subscription",
      "line_items[0][price]": priceId,
      "line_items[0][quantity]": 1,
      success_url: successUrl,
      cancel_url: cancelUrl,
      customer_email: customerEmail,
      "metadata[license_key]": licenseKey,
      "subscription_data[metadata][license_key]": licenseKey,
    });

    return json(res, 200, {
      mode: "managed_checkout",
      stripeMode: config.stripeMode,
      managedCheckoutAvailable: true,
      checkoutUrl: session.url,
      sessionId: session.id,
      licenseKey,
      onboardingUrl: `${baseUrl}/onboarding?licenseKey=${encodeURIComponent(licenseKey)}`,
    });
  } catch (error) {
    return json(res, 400, {
      error: "billing_error",
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

async function handleCreatePortalSession(req, res) {
  if (!applyRateLimit(req, res)) {
    return;
  }
  if (config.freeMode) {
    return json(res, 409, {
      ...billingDisabledPayload(),
      endpoint: "/v1/billing/create-portal-session",
    });
  }
  try {
    const { json: payload } = await readBody(req);
    if (!payload.customerId) {
      throw new Error("customerId is required");
    }
    const returnUrl = payload.returnUrl || config.portalReturnUrl;
    if (!returnUrl) {
      throw new Error("returnUrl is required");
    }

    const session = await stripeRequest("POST", "/v1/billing_portal/sessions", {
      customer: payload.customerId,
      return_url: returnUrl,
    });

    return json(res, 200, {
      portalUrl: session.url,
    });
  } catch (error) {
    return json(res, 400, {
      error: "billing_error",
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

async function handleStripeWebhook(req, res) {
  if (config.freeMode) {
    return json(res, 200, { received: true, ignored: true, reason: "free_mode" });
  }
  try {
    const { raw } = await readBody(req, true);
    const signature = req.headers["stripe-signature"];
    if (!verifyStripeSignature(raw, signature)) {
      return json(res, 400, { error: "invalid_signature" });
    }
    const event = JSON.parse(raw);
    const type = event.type;
    const object = event.data?.object || {};

    if (type === "checkout.session.completed") {
      const licenseKey = object.metadata?.license_key || object.client_reference_id || null;
      const record = licenseKey ? db.licenses[licenseKey] : null;
      if (record) {
        ensureLicenseRecordShape(record);
        record.status = "active";
        record.stripeCustomerId = object.customer || record.stripeCustomerId || null;
        record.stripeSubscriptionId = object.subscription || record.stripeSubscriptionId || null;
        record.subscription.status = "active";
        record.subscription.customerId = record.stripeCustomerId;
        record.subscription.subscriptionId = record.stripeSubscriptionId;
        record.subscription.canceledAt = null;
        record.pastDueSince = null;
        record.canceledAt = null;
        record.updatedAt = nowIso();
      }
    }

    if (
      type === "customer.subscription.created" ||
      type === "customer.subscription.updated" ||
      type === "customer.subscription.deleted"
    ) {
      const lookup = findLicenseByStripe(
        object.id,
        object.customer,
        object.metadata?.license_key
      );
      if (lookup) {
        applyStripeSubscriptionSnapshot(lookup.record, object);
        if (lookup.record.status === "past_due" && !lookup.record.pastDueSince) {
          lookup.record.pastDueSince = nowIso();
        }
        if ((lookup.record.status === "canceled" || lookup.record.status === "unpaid") && !lookup.record.canceledAt) {
          lookup.record.canceledAt = nowIso();
        }
        if (lookup.record.status === "active") {
          lookup.record.pastDueSince = null;
          lookup.record.canceledAt = null;
        }
        lookup.record.updatedAt = nowIso();
      }
    }

    if (type === "invoice.payment_failed") {
      const lookup = findLicenseByStripe(
        object.subscription,
        object.customer,
        object.metadata?.license_key
      );
      if (lookup) {
        ensureLicenseRecordShape(lookup.record);
        lookup.record.status = "past_due";
        lookup.record.subscription.status = "past_due";
        lookup.record.pastDueSince = lookup.record.pastDueSince || nowIso();
        lookup.record.updatedAt = nowIso();
      }
    }

    if (type === "invoice.paid") {
      const lookup = findLicenseByStripe(
        object.subscription,
        object.customer,
        object.metadata?.license_key
      );
      if (lookup) {
        ensureLicenseRecordShape(lookup.record);
        lookup.record.status = "active";
        lookup.record.subscription.status = "active";
        lookup.record.pastDueSince = null;
        lookup.record.canceledAt = null;
        lookup.record.subscription.canceledAt = null;
        lookup.record.updatedAt = nowIso();
      }
    }

    await persistDb();
    return json(res, 200, { received: true });
  } catch (error) {
    return json(res, 400, {
      error: "webhook_error",
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

async function handleAdminCreate(req, res) {
  if (!requireAdmin(req, res)) {
    return;
  }
  const { json: payload } = await readBody(req);
  const status = payload.status && VALID_STATUSES.has(payload.status) ? payload.status : "active";
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
  if (!VALID_STATUSES.has(payload.status)) {
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
      shopify: {
        domain: shopify.domain,
        accessToken: shopify.accessToken,
        clientId: shopify.clientId,
        clientSecret: shopify.clientSecret,
      },
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
      // Convenience path: if no tenant is provided, create one from inline Shopify config.
      if (typeof payload.licenseKey !== "string" || !payload.licenseKey.trim()) {
        throw new Error("tenantId or licenseKey is required");
      }
      const licenseKey = payload.licenseKey.trim();
      if (!db.licenses[licenseKey]) {
        return json(res, 404, { error: "license_not_found" });
      }
      const shopify = validateTenantShopifyPayload(payload);
      tenantId = randomId("tenant");
      db.tenants[tenantId] = ensureTenantRecordShape({
        tenantId,
        licenseKey,
        label:
          typeof payload.label === "string" && payload.label.trim() ? payload.label.trim() : null,
        shopify: {
          domain: shopify.domain,
          accessToken: shopify.accessToken,
          clientId: shopify.clientId,
          clientSecret: shopify.clientSecret,
        },
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

async function handleMcpTokenIntrospect(req, res) {
  if (!requireMcpApiKey(req, res)) {
    return;
  }
  if (!applyRateLimit(req, res)) {
    return;
  }

  try {
    const { json: payload } = await readBody(req);
    if (typeof payload.token !== "string" || payload.token.length < 24) {
      throw new Error("token is required");
    }

    const tokenHash = hashToken(payload.token);
    const tokenRecord = Object.values(db.mcpTokens).find(
      (entry) => entry && entry.tokenHash === tokenHash
    );

    if (!tokenRecord || tokenRecord.status !== "active") {
      return json(res, 200, { active: false });
    }

    if (tokenRecord.expiresAt && Date.parse(tokenRecord.expiresAt) < Date.now()) {
      tokenRecord.status = "expired";
      tokenRecord.updatedAt = nowIso();
      await persistDb();
      return json(res, 200, { active: false });
    }

    const tenant = db.tenants[tokenRecord.tenantId];
    const license = db.licenses[tokenRecord.licenseKey];
    if (!tenant || !license) {
      return json(res, 200, { active: false });
    }

    tokenRecord.lastUsedAt = nowIso();
    tokenRecord.updatedAt = nowIso();
    await persistDb();

    return json(res, 200, {
      active: true,
      tokenId: tokenRecord.tokenId,
      tenantId: tenant.tenantId,
      licenseKey: tokenRecord.licenseKey,
      license: canonicalLicense(license),
      shopify: {
        domain: tenant.shopify?.domain || null,
        accessToken: tenant.shopify?.accessToken || null,
        clientId: tenant.shopify?.clientId || null,
        clientSecret: tenant.shopify?.clientSecret || null,
      },
    });
  } catch (error) {
    return json(res, 400, {
      error: "bad_request",
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

function billingReadiness() {
  const mode = config.stripeMode;
  const hasAnyPriceId = !!(config.stripeDefaultPriceId || config.stripeMonthlyPriceId || config.stripeYearlyPriceId);
  const hasAnyPaymentLink = !!(config.stripeMonthlyPaymentLink || config.stripeYearlyPaymentLink);
  const onboardingCoreReady = !!(config.mcpPublicUrl && config.mcpApiKey && config.adminApiKey);
  const hasAnySecret = !!config.stripeSecretKey;
  const secretMatchesMode =
    !hasAnySecret ||
    (mode === "test"
      ? isStripeTestSecret(config.stripeSecretKey)
      : isStripeLiveSecret(config.stripeSecretKey));
  const monthlyLinkMatchesMode =
    !config.stripeMonthlyPaymentLink ||
    isStripeModePaymentLink(config.stripeMonthlyPaymentLink, mode);
  const yearlyLinkMatchesMode =
    !config.stripeYearlyPaymentLink ||
    isStripeModePaymentLink(config.stripeYearlyPaymentLink, mode);
  const linksMatchMode = monthlyLinkMatchesMode && yearlyLinkMatchesMode;

  if (config.freeMode) {
    return {
      mode: "free",
      freeMode: true,
      stripe: {
        mode,
        billingEnabled: false,
        secretKeyConfigured: !!config.stripeSecretKey,
        secretMatchesMode,
        webhookSecretConfigured: !!config.stripeWebhookSecret,
        defaultPriceConfigured: !!config.stripeDefaultPriceId,
        monthlyPriceConfigured: !!config.stripeMonthlyPriceId,
        yearlyPriceConfigured: !!config.stripeYearlyPriceId,
        monthlyPaymentLinkConfigured: !!config.stripeMonthlyPaymentLink,
        yearlyPaymentLinkConfigured: !!config.stripeYearlyPaymentLink,
        linksMatchMode,
        checkoutSuccessConfigured: !!config.checkoutSuccessUrl,
        checkoutCancelConfigured: !!config.checkoutCancelUrl,
        portalReturnConfigured: !!config.portalReturnUrl,
      },
      remote: {
        mcpPublicUrlConfigured: !!config.mcpPublicUrl,
        mcpApiKeyConfigured: !!config.mcpApiKey,
        adminApiKeyConfigured: !!config.adminApiKey,
      },
      readyForPaymentLinks: false,
      readyForManagedCheckout: false,
      readyForOnboarding: onboardingCoreReady,
    };
  }

  return {
    mode: "paid",
    freeMode: false,
    stripe: {
      mode,
      billingEnabled: true,
      secretKeyConfigured: !!config.stripeSecretKey,
      secretMatchesMode,
      webhookSecretConfigured: !!config.stripeWebhookSecret,
      defaultPriceConfigured: !!config.stripeDefaultPriceId,
      monthlyPriceConfigured: !!config.stripeMonthlyPriceId,
      yearlyPriceConfigured: !!config.stripeYearlyPriceId,
      monthlyPaymentLinkConfigured: !!config.stripeMonthlyPaymentLink,
      yearlyPaymentLinkConfigured: !!config.stripeYearlyPaymentLink,
      linksMatchMode,
      checkoutSuccessConfigured: !!config.checkoutSuccessUrl,
      checkoutCancelConfigured: !!config.checkoutCancelUrl,
      portalReturnConfigured: !!config.portalReturnUrl,
    },
    remote: {
      mcpPublicUrlConfigured: !!config.mcpPublicUrl,
      mcpApiKeyConfigured: !!config.mcpApiKey,
      adminApiKeyConfigured: !!config.adminApiKey,
    },
    readyForPaymentLinks: onboardingCoreReady && hasAnyPaymentLink && linksMatchMode,
    readyForManagedCheckout:
      !!config.stripeSecretKey &&
      !!config.stripeWebhookSecret &&
      secretMatchesMode &&
      hasAnyPriceId &&
      onboardingCoreReady,
    readyForOnboarding: onboardingCoreReady,
  };
}

function handleBillingReadiness(_req, res) {
  return json(res, 200, billingReadiness());
}

function handleAdminReadiness(req, res) {
  if (!requireAdmin(req, res)) {
    return;
  }
  return json(res, 200, {
    ...billingReadiness(),
    values: {
      stripeMode: config.stripeMode,
      stripeDefaultPriceId: config.stripeDefaultPriceId || null,
      stripeMonthlyPriceId: config.stripeMonthlyPriceId || null,
      stripeYearlyPriceId: config.stripeYearlyPriceId || null,
      stripeSecretKey: maskSecret(config.stripeSecretKey),
      stripeWebhookSecret: maskSecret(config.stripeWebhookSecret),
      adminApiKey: maskSecret(config.adminApiKey),
      mcpApiKey: maskSecret(config.mcpApiKey),
      mcpPublicUrl: config.mcpPublicUrl || null,
      checkoutSuccessUrl: config.checkoutSuccessUrl || null,
      checkoutCancelUrl: config.checkoutCancelUrl || null,
      stripeMonthlyPaymentLink: config.stripeMonthlyPaymentLink || null,
      stripeYearlyPaymentLink: config.stripeYearlyPaymentLink || null,
    },
  });
}

function handleOnboardingPage(req, res, _url) {
  const resolved = resolveAccountSessionFromRequest(req);
  if (resolved.account) {
    return redirectTo(res, "/dashboard");
  }
  const html = renderOnboardingLandingPage();
  res.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(html);
}

function handleLoginPage(req, res, url) {
  const resolved = resolveAccountSessionFromRequest(req);
  if (resolved.account) {
    const next = safeRedirectPath(url.searchParams.get("next") || "/dashboard", "/dashboard");
    return redirectTo(res, next);
  }
  const html = renderLoginPage({
    next: safeRedirectPath(url.searchParams.get("next") || "/dashboard", "/dashboard"),
    error: url.searchParams.get("error") || "",
  });
  res.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(html);
}

function handleSignupPage(req, res, url) {
  const resolved = resolveAccountSessionFromRequest(req);
  if (resolved.account) {
    const next = safeRedirectPath(url.searchParams.get("next") || "/dashboard", "/dashboard");
    return redirectTo(res, next);
  }
  const html = renderSignupPage({
    next: safeRedirectPath(url.searchParams.get("next") || "/dashboard", "/dashboard"),
    error: url.searchParams.get("error") || "",
  });
  res.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(html);
}

function handleDashboardPage(req, res, url) {
  const resolved = resolveAccountSessionFromRequest(req);
  if (!resolved.account) {
    const next = safeRedirectPath(url.pathname + (url.search || ""), "/dashboard");
    return redirectTo(res, `/onboarding?next=${encodeURIComponent(next)}`);
  }
  const html = renderDashboardPage();
  res.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(html);
}

async function handleOnboardingLogo(_req, res) {
  try {
    const image = await fs.readFile(config.onboardingLogoPath);
    res.writeHead(200, {
      "Content-Type": "image/png",
      "Content-Length": image.byteLength,
      "Cache-Control": "public, max-age=600",
    });
    res.end(image);
  } catch {
    json(res, 404, { error: "logo_not_found" });
  }
}

async function handleBrandAsset(req, res, url) {
  const rel = decodeURIComponent(url.pathname.replace("/assets/brands/", ""));
  if (!/^[a-z0-9._-]+$/i.test(rel)) {
    return json(res, 400, { error: "invalid_asset_path" });
  }
  const assetPath = path.resolve(SERVICE_ROOT, "assets/brands", rel);
  const brandRoot = path.resolve(SERVICE_ROOT, "assets/brands");
  if (!assetPath.startsWith(brandRoot)) {
    return json(res, 400, { error: "invalid_asset_path" });
  }
  try {
    const content = await fs.readFile(assetPath);
    const ext = path.extname(assetPath).toLowerCase();
    const type =
      ext === ".svg"
        ? "image/svg+xml"
        : ext === ".png"
        ? "image/png"
        : ext === ".jpg" || ext === ".jpeg"
        ? "image/jpeg"
        : ext === ".ico"
        ? "image/x-icon"
        : "application/octet-stream";
    res.writeHead(200, {
      "Content-Type": type,
      "Content-Length": content.byteLength,
      "Cache-Control": "public, max-age=3600",
    });
    return res.end(content);
  } catch {
    return json(res, 404, { error: "asset_not_found" });
  }
}

async function handleDashboardState(req, res) {
  if (!applyRateLimit(req, res)) {
    return;
  }
  const resolved = await requireAccountSession(req, res);
  if (!resolved) {
    return;
  }
  try {
    const requestUrl = new URL(req.url || "/v1/dashboard/state", `http://localhost:${config.port}`);
    const tenantId = requestUrl.searchParams.get("tenantId") || "";
    return json(
      res,
      200,
      buildDashboardPayload(req, resolved.account, resolved.session, tenantId)
    );
  } catch (error) {
    return json(res, 404, {
      error: "dashboard_not_found",
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

async function handleDashboardCreateMcpToken(req, res) {
  if (!applyRateLimit(req, res)) {
    return;
  }
  const resolved = await requireAccountSession(req, res);
  if (!resolved) {
    return;
  }
  try {
    const { json: payload } = await readBody(req);
    const tenant = resolveTenantForAccount(resolved.account, payload?.tenantId || "");
    if (!tenant) {
      return json(res, 409, {
        error: "tenant_missing",
        message: "Koppel eerst een Shopify store binnen je account.",
      });
    }
    const revokeExisting = payload?.revokeExisting === true;
    const revokedTokenIds = [];
    if (revokeExisting) {
      for (const entry of Object.values(db.mcpTokens)) {
        if (!entry || entry.tenantId !== tenant.tenantId || entry.status !== "active") {
          continue;
        }
        entry.status = "revoked";
        entry.updatedAt = nowIso();
        revokedTokenIds.push(entry.tokenId);
      }
    }
    const token = createMcpTokenForTenant(tenant.tenantId, {
      name: payload?.name,
      expiresInDays: payload?.expiresInDays,
    });
    await persistDb();
    return json(res, 201, {
      ok: true,
      created: {
        tokenId: token.tokenId,
        accessToken: token.accessToken,
        expiresAt: token.expiresAt || null,
      },
      revokedTokenIds,
      dashboard: buildDashboardPayload(req, resolved.account, resolved.session, tenant.tenantId),
    });
  } catch (error) {
    return json(res, 400, {
      error: "bad_request",
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

async function handleDashboardRevokeMcpToken(req, res) {
  if (!applyRateLimit(req, res)) {
    return;
  }
  const resolved = await requireAccountSession(req, res);
  if (!resolved) {
    return;
  }
  try {
    const { json: payload } = await readBody(req);
    if (typeof payload?.tokenId !== "string" || !payload.tokenId.trim()) {
      throw new Error("tokenId is required");
    }
    const tokenId = payload.tokenId.trim();
    const token = db.mcpTokens[tokenId];
    const tenant = resolveTenantForAccount(resolved.account, payload?.tenantId || "");
    if (!token || !tenant || token.tenantId !== tenant.tenantId) {
      return json(res, 404, { error: "token_not_found" });
    }
    token.status = "revoked";
    token.updatedAt = nowIso();
    await persistDb();
    return json(res, 200, {
      ok: true,
      tokenId,
      dashboard: buildDashboardPayload(req, resolved.account, resolved.session, tenant.tenantId),
    });
  } catch (error) {
    return json(res, 400, {
      error: "bad_request",
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

function handleLandingPage(req, res) {
  return redirectTo(res, "/onboarding", 302);
}

function accountPublicPayload(account) {
  return {
    accountId: account.accountId,
    name: account.name,
    email: account.email,
    licenseKey: account.licenseKey,
    createdAt: account.createdAt || null,
    updatedAt: account.updatedAt || null,
    lastLoginAt: account.lastLoginAt || null,
  };
}

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

async function handleAccountSignup(req, res) {
  if (!applyRateLimit(req, res)) {
    return;
  }
  try {
    const { json: payload } = await readBody(req);
    const email = normalizeAccountEmail(payload?.email);
    const name =
      typeof payload?.name === "string" && payload.name.trim().length >= 2
        ? payload.name.trim()
        : "";
    if (!name) {
      throw new Error("Naam is verplicht.");
    }
    if (findAccountByEmail(email)) {
      return json(res, 409, {
        error: "account_exists",
        message: "Er bestaat al een account met dit e-mailadres.",
      });
    }

    const digest = createPasswordDigest(payload?.password || "");
    const accountId = randomId("acct");
    const account = {
      accountId,
      email,
      name,
      passwordSalt: digest.salt,
      passwordHash: digest.hash,
      licenseKey: generateLicenseKey(),
      status: "active",
      createdAt: nowIso(),
      updatedAt: nowIso(),
      lastLoginAt: nowIso(),
    };
    db.accounts[accountId] = account;
    ensureAccountLicenseRecord(account);
    const session = createAccountSession(accountId, req);
    await persistDb();

    setCookie(
      res,
      buildCookieHeader(ACCOUNT_SESSION_COOKIE, session.token, {
        secure: isRequestSecure(req),
        maxAgeSeconds: positiveNumber(config.accountSessionTtlDays, 14) * 24 * 60 * 60,
      })
    );

    return json(res, 201, {
      ok: true,
      account: accountPublicPayload(account),
      session: {
        expiresAt: session.expiresAt,
      },
    });
  } catch (error) {
    return json(res, 400, {
      error: "bad_request",
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

async function handleAccountLogin(req, res) {
  if (!applyRateLimit(req, res)) {
    return;
  }
  try {
    const { json: payload } = await readBody(req);
    const email = normalizeAccountEmail(payload?.email);
    const account = findAccountByEmail(email);
    if (!account) {
      return json(res, 401, {
        error: "invalid_credentials",
        message: "Onjuiste inloggegevens.",
      });
    }
    if (!verifyPasswordDigest(payload?.password || "", account.passwordSalt, account.passwordHash)) {
      return json(res, 401, {
        error: "invalid_credentials",
        message: "Onjuiste inloggegevens.",
      });
    }

    ensureAccountLicenseRecord(account);
    account.lastLoginAt = nowIso();
    account.updatedAt = nowIso();
    const session = createAccountSession(account.accountId, req);
    await persistDb();

    setCookie(
      res,
      buildCookieHeader(ACCOUNT_SESSION_COOKIE, session.token, {
        secure: isRequestSecure(req),
        maxAgeSeconds: positiveNumber(config.accountSessionTtlDays, 14) * 24 * 60 * 60,
      })
    );

    return json(res, 200, {
      ok: true,
      account: accountPublicPayload(account),
      session: {
        expiresAt: session.expiresAt,
      },
    });
  } catch (error) {
    return json(res, 400, {
      error: "bad_request",
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

async function handleAccountLogout(req, res) {
  const resolved = resolveAccountSessionFromRequest(req);
  if (resolved.session) {
    resolved.session.status = "revoked";
    resolved.session.updatedAt = nowIso();
    await persistDb();
  }
  setCookie(
    res,
    buildCookieHeader(ACCOUNT_SESSION_COOKIE, "", {
      secure: isRequestSecure(req),
      maxAgeSeconds: 0,
    })
  );
  return json(res, 200, { ok: true });
}

async function handleAccountMe(req, res) {
  const resolved = await requireAccountSession(req, res);
  if (!resolved) {
    return;
  }
  ensureAccountLicenseRecord(resolved.account);
  return json(res, 200, {
    ok: true,
    account: accountPublicPayload(resolved.account),
  });
}

async function handleSessionBootstrap(req, res) {
  if (!applyRateLimit(req, res)) {
    return;
  }
  const resolved = resolveAccountSessionFromRequest(req);
  if (!resolved.account || !resolved.session) {
    if (resolved.reason === "expired") {
      await persistDb();
    }
    return json(res, 200, {
      ok: true,
      authenticated: false,
      account: null,
      onboarding: {
        hasAccount: false,
        hasStoreConnection: false,
        hasActiveAccessCode: false,
      },
    });
  }

  const account = resolved.account;
  const tenants = listTenantsForAccount(account);
  const tenant = tenants[0] || null;
  const tokenRows = tenant ? listTenantMcpTokens(tenant.tenantId) : [];
  return json(res, 200, {
    ok: true,
    authenticated: true,
    account: accountPublicPayload(account),
    onboarding: {
      hasAccount: true,
      hasStoreConnection: !!tenant,
      hasActiveAccessCode: tokenRows.some((entry) => entry.status === "active"),
      storeCount: tenants.length,
    },
  });
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
    let artifact;
    if (keyMaterial) {
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
      artifact = {
        timestamp,
        encrypted: false,
        checksum,
        data: payload,
      };
    }

    const backupDir = path.resolve(SERVICE_ROOT, "data/backups");
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

async function handleOnboardingConnectShopify(req, res) {
  if (!applyRateLimit(req, res)) {
    return;
  }
  const resolved = await requireAccountSession(req, res);
  if (!resolved) {
    return;
  }
  try {
    const { json: payload } = await readBody(req);
    if (!payload || typeof payload !== "object") {
      throw new Error("Payload is required");
    }
    const account = resolved.account;
    const licenseKey = account.licenseKey;
    let license = ensureAccountLicenseRecord(account);
    if (!config.freeMode && !isLicenseUsableForOnboarding(license)) {
      return json(res, 403, {
        error: "license_not_eligible",
        message: "License status staat geen onboarding toe",
      });
    }

    const contactEmail = normalizeOptionalEmail(payload.contactEmail);
    if (contactEmail) {
      license.contactEmail = contactEmail;
    }
    license.updatedAt = nowIso();

    const shopify = validateTenantShopifyPayload(payload);
    const requestedTenantId =
      typeof payload.tenantId === "string" && payload.tenantId.trim()
        ? payload.tenantId.trim()
        : null;
    const replaceExistingTenant = payload.replaceExistingTenant === true;
    let tenant = requestedTenantId
      ? db.tenants[requestedTenantId] || null
      : findTenantByLicenseKey(licenseKey, shopify.domain);
    if (tenant && tenant.licenseKey !== licenseKey) {
      throw new Error("tenantId does not belong to provided licenseKey");
    }
    // Avoid accidental cross-user overwrite: if a license already has another shop and replaceExistingTenant is not set,
    // create a new tenant record instead of overwriting the existing one.
    if (
      tenant &&
      tenant.shopify?.domain &&
      tenant.shopify.domain !== shopify.domain &&
      !replaceExistingTenant &&
      !requestedTenantId
    ) {
      tenant = null;
    }
    const now = nowIso();
    let createdNewTenant = false;
    if (!tenant) {
      const tenantId = randomId("tenant");
      tenant = ensureTenantRecordShape({
        tenantId,
        licenseKey,
        label:
          typeof payload.label === "string" && payload.label.trim() ? payload.label.trim() : null,
        shopify: {
          domain: shopify.domain,
          accessToken: shopify.accessToken,
          clientId: shopify.clientId,
          clientSecret: shopify.clientSecret,
        },
        createdAt: now,
        updatedAt: now,
      });
      db.tenants[tenantId] = tenant;
      createdNewTenant = true;
    } else {
      tenant.label =
        typeof payload.label === "string" && payload.label.trim()
          ? payload.label.trim()
          : tenant.label || null;
      tenant.shopify = {
        domain: shopify.domain,
        accessToken: shopify.accessToken,
        clientId: shopify.clientId,
        clientSecret: shopify.clientSecret,
      };
      tenant.updatedAt = now;
      ensureTenantRecordShape(tenant);
    }

    const token = createMcpTokenForTenant(tenant.tenantId, {
      name:
        typeof payload.mcpTokenName === "string" && payload.mcpTokenName.trim()
          ? payload.mcpTokenName.trim()
          : "onboarding",
    });
    await persistDb();

    return json(res, 201, {
      ok: true,
      tenantId: tenant.tenantId,
      createdNewTenant,
      licenseKey,
      license: canonicalLicense(license),
      contactEmail: license.contactEmail || null,
      shopify: {
        domain: tenant.shopify.domain,
        authMode: tenant.shopify.accessToken ? "access_token" : "client_credentials",
      },
      mcp: {
        name: "hazify-mcp",
        url: resolvedMcpPublicUrl(req),
        bearerToken: token.accessToken,
      },
      config: {
        codexToml: `[mcp_servers.hazify-mcp]\nurl = "${resolvedMcpPublicUrl(req)}"\nbearer_token = "${token.accessToken}"`,
      },
      dashboard: buildDashboardPayload(req, account, resolved.session, tenant.tenantId),
      account: accountPublicPayload(account),
    });
  } catch (error) {
    return json(res, 400, {
      error: "bad_request",
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

function getOAuthClient(clientId) {
  if (typeof clientId !== "string" || !clientId.trim()) {
    return null;
  }
  const client = db.oauthClients[clientId.trim()];
  if (!client || client.status === "revoked") {
    return null;
  }
  return client;
}

function assertOAuthClientRedirectUri(client, redirectUri) {
  if (typeof redirectUri !== "string" || !redirectUri.trim()) {
    throw new Error("redirect_uri is required");
  }
  if (!Array.isArray(client.redirectUris) || !client.redirectUris.includes(redirectUri)) {
    throw new Error("redirect_uri is not registered for this client");
  }
}

function sendOAuthTokenResponse(res, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(200, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    Pragma: "no-cache",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function findOAuthRefreshTokenRecord(rawRefreshToken) {
  const tokenHash = hashToken(rawRefreshToken);
  return Object.values(db.oauthRefreshTokens).find(
    (record) => record && record.status === "active" && record.tokenHash === tokenHash
  );
}

function redirectWithOAuthResult(res, redirectUri, params) {
  const location = appendQueryParamsToUrl(redirectUri, params);
  res.writeHead(302, { Location: location, "Cache-Control": "no-store" });
  res.end();
}

function validateOAuthGrantType(grantType) {
  return grantType === "authorization_code" || grantType === "refresh_token";
}

async function handleOAuthAuthorizationServerMetadata(req, res) {
  res.writeHead(200, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(oauthMetadata(req)));
}

async function handleOAuthOpenIdConfiguration(req, res) {
  const metadata = oauthMetadata(req);
  res.writeHead(200, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  });
  res.end(
    JSON.stringify({
      ...metadata,
      subject_types_supported: ["public"],
      id_token_signing_alg_values_supported: ["none"],
      claims_supported: [],
    })
  );
}

async function handleOAuthRegister(req, res) {
  if (!applyRateLimit(req, res)) {
    return;
  }
  try {
    const payload = await readJsonOrFormBody(req);
    const redirectUris = normalizeStringArray(payload.redirect_uris);
    if (!redirectUris.length) {
      return oauthJsonError(res, 400, "invalid_client_metadata", "redirect_uris is required");
    }
    if (!redirectUris.every((uriValue) => isAllowedRedirectUri(uriValue))) {
      return oauthJsonError(
        res,
        400,
        "invalid_client_metadata",
        "All redirect_uris must be https:// or localhost http:// URIs"
      );
    }

    const tokenEndpointAuthMethod =
      typeof payload.token_endpoint_auth_method === "string" &&
      ["none", "client_secret_post", "client_secret_basic"].includes(payload.token_endpoint_auth_method)
        ? payload.token_endpoint_auth_method
        : "client_secret_post";
    const grantTypes = normalizeStringArray(payload.grant_types);
    const responseTypes = normalizeStringArray(payload.response_types);
    const scope =
      typeof payload.scope === "string" && payload.scope.trim() ? payload.scope.trim() : "mcp:tools";

    const clientId = randomId("oauthcli");
    const issuedAtSeconds = Math.floor(Date.now() / 1000);
    // Some MCP clients (including ChatGPT connector flows) require client_secret to always be a string
    // in dynamic registration responses, even for public clients.
    const clientSecret = `hzcsec_${crypto.randomBytes(24).toString("hex")}`;
    db.oauthClients[clientId] = {
      clientId,
      clientName:
        typeof payload.client_name === "string" && payload.client_name.trim()
          ? payload.client_name.trim()
          : "MCP Client",
      redirectUris,
      grantTypes: grantTypes.length ? grantTypes : ["authorization_code", "refresh_token"],
      responseTypes: responseTypes.length ? responseTypes : ["code"],
      tokenEndpointAuthMethod,
      scope,
      clientSecretHash: hashToken(clientSecret),
      createdAt: nowIso(),
      updatedAt: nowIso(),
      status: "active",
    };
    await persistDb();

    return json(res, 201, {
      client_id: clientId,
      client_id_issued_at: issuedAtSeconds,
      client_secret: clientSecret,
      client_secret_expires_at: 0,
      client_name: db.oauthClients[clientId].clientName,
      redirect_uris: redirectUris,
      grant_types: db.oauthClients[clientId].grantTypes,
      response_types: db.oauthClients[clientId].responseTypes,
      token_endpoint_auth_method: tokenEndpointAuthMethod,
      scope,
    });
  } catch (error) {
    return oauthJsonError(
      res,
      400,
      "invalid_client_metadata",
      error instanceof Error ? error.message : String(error)
    );
  }
}

async function handleOAuthAuthorizeGet(req, res, url) {
  const clientId = url.searchParams.get("client_id") || "";
  const redirectUri = url.searchParams.get("redirect_uri") || "";
  const state = url.searchParams.get("state") || "";
  const responseType = url.searchParams.get("response_type") || "code";
  const codeChallenge = url.searchParams.get("code_challenge") || "";
  const codeChallengeMethod = url.searchParams.get("code_challenge_method") || "S256";
  const scope = url.searchParams.get("scope") || "mcp:tools";

  const client = getOAuthClient(clientId);
  if (!client) {
    logEvent("oauth_client_missing", { clientId, redirectUri });
    logEvent("oauth_reconnect_started", { clientId, redirectUri });
    res.writeHead(410, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    res.end(
      renderOAuthReconnectPage({
        clientId,
        redirectUri,
        error: "invalid_client",
        errorCode: "oauth_client_expired",
      })
    );
    return;
  }
  try {
    assertOAuthClientRedirectUri(client, redirectUri);
    if (responseType !== "code") {
      redirectWithOAuthResult(res, redirectUri, {
        error: "unsupported_response_type",
        error_description: "Only response_type=code is supported",
        state,
      });
      return;
    }
    if (codeChallengeMethod && !["S256", "plain"].includes(codeChallengeMethod)) {
      redirectWithOAuthResult(res, redirectUri, {
        error: "invalid_request",
        error_description: "Unsupported code_challenge_method",
        state,
      });
      return;
    }
  } catch (error) {
    res.writeHead(400, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    res.end(
      renderOAuthAuthorizePageV2({
        error: error instanceof Error ? error.message : String(error),
        clientName: client.clientName,
        clientId,
        redirectUri,
        state,
        responseType,
        codeChallenge,
        codeChallengeMethod,
        scope,
      })
    );
    return;
  }

  const accountSession = resolveAccountSessionFromRequest(req);
  if (!accountSession.account) {
    const next = safeRedirectPath(`${url.pathname}${url.search}`, "/onboarding");
    return redirectTo(res, `/login?next=${encodeURIComponent(next)}`);
  }

  const shopOptions = getTenantsByLicenseKey(accountSession.account.licenseKey)
    .map((tenant) => tenant?.shopify?.domain)
    .filter(Boolean);

  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
  res.end(
    renderOAuthAuthorizePageV2({
      clientName: client.clientName,
      clientId,
      redirectUri,
      state,
      responseType,
      codeChallenge,
      codeChallengeMethod,
      scope,
      shopOptions,
    })
  );
}

async function handleOAuthAuthorizePost(req, res) {
  if (!applyRateLimit(req, res)) {
    return;
  }
  try {
    const payload = await readJsonOrFormBody(req);
    const clientId = typeof payload.client_id === "string" ? payload.client_id.trim() : "";
    const redirectUri = typeof payload.redirect_uri === "string" ? payload.redirect_uri.trim() : "";
    const state = typeof payload.state === "string" ? payload.state : "";
    const responseType =
      typeof payload.response_type === "string" && payload.response_type.trim()
        ? payload.response_type.trim()
        : "code";
    const codeChallenge =
      typeof payload.code_challenge === "string" && payload.code_challenge.trim()
        ? payload.code_challenge.trim()
        : "";
    const codeChallengeMethod =
      typeof payload.code_challenge_method === "string" && payload.code_challenge_method.trim()
        ? payload.code_challenge_method.trim()
        : codeChallenge
        ? "S256"
        : "";
    const scope = typeof payload.scope === "string" && payload.scope.trim() ? payload.scope.trim() : "mcp:tools";
    const decision =
      typeof payload.decision === "string" && payload.decision.trim() ? payload.decision.trim() : "deny";

    const client = getOAuthClient(clientId);
    if (!client) {
      logEvent("oauth_client_missing", { clientId, redirectUri });
      logEvent("oauth_reconnect_started", { clientId, redirectUri });
      res.writeHead(410, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      res.end(
        renderOAuthReconnectPage({
          clientId,
          redirectUri,
          error: "invalid_client",
          errorCode: "oauth_client_expired",
        })
      );
      return;
    }
    assertOAuthClientRedirectUri(client, redirectUri);
    if (responseType !== "code") {
      redirectWithOAuthResult(res, redirectUri, {
        error: "unsupported_response_type",
        error_description: "Only response_type=code is supported",
        state,
      });
      return;
    }
    if (codeChallengeMethod && !["S256", "plain"].includes(codeChallengeMethod)) {
      redirectWithOAuthResult(res, redirectUri, {
        error: "invalid_request",
        error_description: "Unsupported code_challenge_method",
        state,
      });
      return;
    }

    const accountSession = resolveAccountSessionFromRequest(req);
    if (!accountSession.account) {
      const next = safeRedirectPath(
        `/oauth/authorize?client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(
          redirectUri
        )}&state=${encodeURIComponent(state)}&response_type=${encodeURIComponent(
          responseType
        )}&code_challenge=${encodeURIComponent(codeChallenge)}&code_challenge_method=${encodeURIComponent(
          codeChallengeMethod
        )}&scope=${encodeURIComponent(scope)}`,
        "/onboarding"
      );
      return redirectTo(res, `/login?next=${encodeURIComponent(next)}`);
    }

    const licenseKey = accountSession.account.licenseKey;
    if (decision !== "allow") {
      redirectWithOAuthResult(res, redirectUri, {
        error: "access_denied",
        error_description: "Authorization denied by user",
        state,
      });
      return;
    }

    let license = db.licenses[licenseKey];
    if (!license && config.freeMode) {
      license = ensureFreeLicenseRecord(licenseKey);
    }
    if (!license) {
      res.writeHead(400, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      res.end(
        renderOAuthAuthorizePageV2({
          error: "Je account heeft nog geen actieve toegang.",
          clientName: client.clientName,
          clientId,
          redirectUri,
          state,
          responseType,
          codeChallenge,
          codeChallengeMethod,
          scope,
          shopOptions: getTenantsByLicenseKey(licenseKey)
            .map((tenant) => tenant?.shopify?.domain)
            .filter(Boolean),
        })
      );
      return;
    }
    if (config.freeMode) {
      license = ensureFreeLicenseRecord(licenseKey);
    }
    if (!config.freeMode && !isLicenseUsableForOnboarding(license)) {
      res.writeHead(400, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      res.end(
        renderOAuthAuthorizePageV2({
          error: "Je account kan deze koppeling nu niet afronden.",
          clientName: client.clientName,
          clientId,
          redirectUri,
          state,
          responseType,
          codeChallenge,
          codeChallengeMethod,
          scope,
          shopOptions: getTenantsByLicenseKey(licenseKey)
            .map((tenant) => tenant?.shopify?.domain)
            .filter(Boolean),
        })
      );
      return;
    }

    let tenant;
    try {
      tenant = resolveTenantForOAuth(licenseKey, payload.shopDomain);
    } catch (error) {
      res.writeHead(400, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      res.end(
        renderOAuthAuthorizePageV2({
          error: error instanceof Error ? error.message : String(error),
          clientName: client.clientName,
          clientId,
          redirectUri,
          state,
          responseType,
          codeChallenge,
          codeChallengeMethod,
          scope,
          shopDomain: typeof payload.shopDomain === "string" ? payload.shopDomain.trim() : "",
          shopOptions: getTenantsByLicenseKey(licenseKey)
            .map((entry) => entry?.shopify?.domain)
            .filter(Boolean),
        })
      );
      return;
    }
    const authCode = `hzauth_${crypto.randomBytes(24).toString("hex")}`;
    db.oauthAuthCodes[authCode] = {
      code: authCode,
      clientId: client.clientId,
      redirectUri,
      tenantId: tenant.tenantId,
      licenseKey,
      scope,
      codeChallenge: codeChallenge || null,
      codeChallengeMethod: codeChallenge ? codeChallengeMethod || "S256" : null,
      createdAt: nowIso(),
      expiresAt: addSeconds(nowIso(), Math.max(60, config.oauthCodeTtlMinutes * 60)),
      usedAt: null,
      status: "active",
    };
    await persistDb();
    logEvent("oauth_reconnect_completed", {
      clientId: client.clientId,
      tenantId: tenant.tenantId,
    });

    redirectWithOAuthResult(res, redirectUri, { code: authCode, state });
  } catch (error) {
    return oauthJsonError(res, 400, "invalid_request", error instanceof Error ? error.message : String(error));
  }
}

async function handleOAuthToken(req, res) {
  if (!applyRateLimit(req, res)) {
    return;
  }
  try {
    const payload = await readJsonOrFormBody(req);
    const grantType = typeof payload.grant_type === "string" ? payload.grant_type.trim() : "";
    if (!validateOAuthGrantType(grantType)) {
      return oauthJsonError(res, 400, "unsupported_grant_type", "Unsupported grant_type");
    }

    if (grantType === "authorization_code") {
      const code = typeof payload.code === "string" ? payload.code.trim() : "";
      if (!code) {
        return oauthJsonError(res, 400, "invalid_request", "code is required");
      }
      const codeRecord = db.oauthAuthCodes[code];
      if (!codeRecord || codeRecord.status !== "active" || codeRecord.usedAt) {
        return oauthJsonError(res, 400, "invalid_grant", "Authorization code is invalid or already used");
      }
      if (Date.parse(codeRecord.expiresAt) < Date.now()) {
        codeRecord.status = "expired";
        codeRecord.usedAt = nowIso();
        await persistDb();
        return oauthJsonError(res, 400, "invalid_grant", "Authorization code has expired");
      }

      const client = getOAuthClient(codeRecord.clientId);
      if (!client) {
        return oauthJsonError(res, 401, "invalid_client", "OAuth client is invalid");
      }

      try {
        validateOAuthClientAuthentication(req, payload, client);
      } catch (error) {
        if (error instanceof Error && error.message === "invalid_client") {
          return oauthJsonError(res, 401, "invalid_client", "Client authentication failed");
        }
        return oauthJsonError(res, 400, "invalid_request", error instanceof Error ? error.message : String(error));
      }

      const redirectUri = typeof payload.redirect_uri === "string" ? payload.redirect_uri.trim() : "";
      if (!redirectUri || redirectUri !== codeRecord.redirectUri) {
        return oauthJsonError(res, 400, "invalid_grant", "redirect_uri mismatch");
      }
      if (codeRecord.codeChallenge) {
        const verifier = typeof payload.code_verifier === "string" ? payload.code_verifier : "";
        if (
          !verifyPkceCodeVerifier(verifier, codeRecord.codeChallenge, codeRecord.codeChallengeMethod || "plain")
        ) {
          return oauthJsonError(res, 400, "invalid_grant", "Invalid code_verifier");
        }
      }

      const accessTokenTtlSeconds = Math.max(300, Number(config.oauthAccessTokenTtlSeconds || 3600));
      const refreshTokenTtlDays = positiveNumber(config.oauthRefreshTokenTtlDays || 30, 30);
      const accessToken = createMcpTokenForTenant(codeRecord.tenantId, {
        name: `oauth:${client.clientName || client.clientId}`,
        expiresInSeconds: accessTokenTtlSeconds,
      });
      const refreshToken = `hzrft_${crypto.randomBytes(28).toString("hex")}`;
      const refreshTokenId = randomId("oauthrt");

      db.oauthRefreshTokens[refreshTokenId] = {
        refreshTokenId,
        tokenHash: hashToken(refreshToken),
        clientId: client.clientId,
        tenantId: codeRecord.tenantId,
        licenseKey: codeRecord.licenseKey,
        scope: codeRecord.scope || "mcp:tools",
        status: "active",
        createdAt: nowIso(),
        updatedAt: nowIso(),
        expiresAt: addDays(nowIso(), refreshTokenTtlDays),
      };
      codeRecord.status = "used";
      codeRecord.usedAt = nowIso();
      await persistDb();

      return sendOAuthTokenResponse(res, {
        access_token: accessToken.accessToken,
        token_type: "Bearer",
        expires_in: accessTokenTtlSeconds,
        refresh_token: refreshToken,
        scope: codeRecord.scope || "mcp:tools",
      });
    }

    const rawRefreshToken =
      typeof payload.refresh_token === "string" ? payload.refresh_token.trim() : "";
    if (!rawRefreshToken) {
      return oauthJsonError(res, 400, "invalid_request", "refresh_token is required");
    }
    const refreshRecord = findOAuthRefreshTokenRecord(rawRefreshToken);
    if (!refreshRecord) {
      return oauthJsonError(res, 400, "invalid_grant", "Refresh token is invalid");
    }
    if (Date.parse(refreshRecord.expiresAt) < Date.now()) {
      refreshRecord.status = "expired";
      refreshRecord.updatedAt = nowIso();
      await persistDb();
      return oauthJsonError(res, 400, "invalid_grant", "Refresh token has expired");
    }
    const client = getOAuthClient(refreshRecord.clientId);
    if (!client) {
      return oauthJsonError(res, 401, "invalid_client", "OAuth client is invalid");
    }
    try {
      validateOAuthClientAuthentication(req, payload, client);
    } catch (error) {
      if (error instanceof Error && error.message === "invalid_client") {
        return oauthJsonError(res, 401, "invalid_client", "Client authentication failed");
      }
      return oauthJsonError(res, 400, "invalid_request", error instanceof Error ? error.message : String(error));
    }

    const accessTokenTtlSeconds = Math.max(300, Number(config.oauthAccessTokenTtlSeconds || 3600));
    const refreshTokenTtlDays = positiveNumber(config.oauthRefreshTokenTtlDays || 30, 30);
    const accessToken = createMcpTokenForTenant(refreshRecord.tenantId, {
      name: `oauth:${client.clientName || client.clientId}`,
      expiresInSeconds: accessTokenTtlSeconds,
    });
    const rotatedRefreshToken = `hzrft_${crypto.randomBytes(28).toString("hex")}`;
    const nextRefreshTokenId = randomId("oauthrt");

    refreshRecord.status = "rotated";
    refreshRecord.updatedAt = nowIso();
    db.oauthRefreshTokens[nextRefreshTokenId] = {
      refreshTokenId: nextRefreshTokenId,
      tokenHash: hashToken(rotatedRefreshToken),
      clientId: refreshRecord.clientId,
      tenantId: refreshRecord.tenantId,
      licenseKey: refreshRecord.licenseKey,
      scope: refreshRecord.scope || "mcp:tools",
      status: "active",
      createdAt: nowIso(),
      updatedAt: nowIso(),
      expiresAt: addDays(nowIso(), refreshTokenTtlDays),
    };
    await persistDb();

    return sendOAuthTokenResponse(res, {
      access_token: accessToken.accessToken,
      token_type: "Bearer",
      expires_in: accessTokenTtlSeconds,
      refresh_token: rotatedRefreshToken,
      scope: refreshRecord.scope || "mcp:tools",
    });
  } catch (error) {
    return oauthJsonError(res, 400, "invalid_request", error instanceof Error ? error.message : String(error));
  }
}

function routeNotFound(res) {
  return json(res, 404, { error: "not_found" });
}

const server = http.createServer(async (req, res) => {
  try {
    const method = req.method || "GET";
    const url = new URL(req.url || "/", `http://localhost:${config.port}`);

    if (method === "GET" && url.pathname === "/") {
      return handleLandingPage(req, res);
    }
    if (method === "GET" && url.pathname === "/onboarding") {
      return handleOnboardingPage(req, res, url);
    }
    if (method === "GET" && url.pathname === "/login") {
      return handleLoginPage(req, res, url);
    }
    if (method === "GET" && url.pathname === "/signup") {
      return handleSignupPage(req, res, url);
    }
    if (method === "GET" && url.pathname === "/dashboard") {
      return handleDashboardPage(req, res, url);
    }
    if (method === "GET" && url.pathname === "/logo.png") {
      return handleOnboardingLogo(req, res);
    }
    if (method === "GET" && url.pathname.startsWith("/assets/brands/")) {
      return handleBrandAsset(req, res, url);
    }
    if (method === "GET" && url.pathname === "/.well-known/oauth-authorization-server") {
      return handleOAuthAuthorizationServerMetadata(req, res);
    }
    if (method === "GET" && url.pathname === "/.well-known/openid-configuration") {
      return handleOAuthOpenIdConfiguration(req, res);
    }
    if (method === "POST" && (url.pathname === "/oauth/register" || url.pathname === "/register")) {
      return handleOAuthRegister(req, res);
    }
    if (method === "GET" && (url.pathname === "/oauth/authorize" || url.pathname === "/authorize")) {
      return handleOAuthAuthorizeGet(req, res, url);
    }
    if (method === "POST" && (url.pathname === "/oauth/authorize" || url.pathname === "/authorize")) {
      return handleOAuthAuthorizePost(req, res);
    }
    if (method === "POST" && (url.pathname === "/oauth/token" || url.pathname === "/token")) {
      return handleOAuthToken(req, res);
    }
    if (method === "GET" && url.pathname === "/health") {
      return json(res, 200, { ok: true, service: "hazify-license-service", timestamp: nowIso() });
    }
    if (method === "GET" && url.pathname === "/v1/billing/readiness") {
      return handleBillingReadiness(req, res);
    }
    if (method === "GET" && url.pathname === "/v1/account/me") {
      return handleAccountMe(req, res);
    }
    if (method === "GET" && url.pathname === "/v1/session/bootstrap") {
      return handleSessionBootstrap(req, res);
    }
    if (method === "POST" && url.pathname === "/v1/account/signup") {
      return handleAccountSignup(req, res);
    }
    if (method === "POST" && url.pathname === "/v1/account/login") {
      return handleAccountLogin(req, res);
    }
    if (method === "POST" && url.pathname === "/v1/account/logout") {
      return handleAccountLogout(req, res);
    }
    if (method === "GET" && url.pathname === "/v1/admin/readiness") {
      return handleAdminReadiness(req, res);
    }

    if (method === "POST" && url.pathname === "/v1/license/validate") {
      return handleValidateOrHeartbeat(req, res, "validate");
    }
    if (method === "POST" && url.pathname === "/v1/license/heartbeat") {
      return handleValidateOrHeartbeat(req, res, "heartbeat");
    }
    if (method === "POST" && url.pathname === "/v1/license/deactivate") {
      return handleDeactivate(req, res);
    }

    if (method === "POST" && url.pathname === "/v1/billing/create-checkout-session") {
      return handleCreateCheckout(req, res);
    }
    if (method === "POST" && url.pathname === "/v1/billing/create-portal-session") {
      return handleCreatePortalSession(req, res);
    }

    if (method === "POST" && url.pathname === "/v1/stripe/webhook") {
      return handleStripeWebhook(req, res);
    }

    if (method === "POST" && url.pathname === "/v1/admin/license/create") {
      return handleAdminCreate(req, res);
    }
    if (method === "POST" && url.pathname === "/v1/admin/license/update-status") {
      return handleAdminUpdateStatus(req, res);
    }
    if (method === "POST" && url.pathname === "/v1/admin/tenant/upsert") {
      return handleAdminUpsertTenant(req, res);
    }
    if (method === "POST" && url.pathname === "/v1/admin/mcp/token/create") {
      return handleAdminCreateMcpToken(req, res);
    }
    if (method === "POST" && url.pathname === "/v1/admin/mcp/token/revoke") {
      return handleAdminRevokeMcpToken(req, res);
    }
    if (method === "POST" && url.pathname === "/v1/admin/storage/export") {
      return handleAdminStorageExport(req, res);
    }
    if (method === "POST" && url.pathname === "/v1/mcp/token/introspect") {
      return handleMcpTokenIntrospect(req, res);
    }
    if (method === "POST" && url.pathname === "/v1/onboarding/connect-shopify") {
      return handleOnboardingConnectShopify(req, res);
    }
    if (method === "GET" && url.pathname === "/v1/dashboard/state") {
      return handleDashboardState(req, res);
    }
    if (method === "POST" && url.pathname === "/v1/dashboard/mcp-token/create") {
      return handleDashboardCreateMcpToken(req, res);
    }
    if (method === "POST" && url.pathname === "/v1/dashboard/mcp-token/revoke") {
      return handleDashboardRevokeMcpToken(req, res);
    }

    if (method === "GET" && url.pathname.startsWith("/v1/admin/license/")) {
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

    if (method === "GET" && url.pathname.startsWith("/v1/admin/tenant/")) {
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

    return routeNotFound(res);
  } catch (error) {
    return json(res, 500, {
      error: "internal_error",
      message: error instanceof Error ? error.message : String(error),
    });
  }
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
