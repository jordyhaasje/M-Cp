import path from "path";
import { fileURLToPath } from "url";
import { parseCommaSeparatedList } from "@hazify/mcp-common";

const SERVICE_ROOT = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(SERVICE_ROOT, "..", "..");
const DEFAULT_ONBOARDING_LOGO_PATH = path.resolve(APP_ROOT, "logo.png");
const DEFAULT_OAUTH_CUSTOM_REDIRECT_SCHEMES = ["vscode", "cursor", "claude", "perplexity"];
const VALID_LICENSE_STATUSES = new Set(["active", "past_due", "canceled", "invalid", "unpaid"]);
const ACCOUNT_SESSION_COOKIE = "hz_user_session";
const SHOPIFY_CREDENTIAL_VALIDATION_TIMEOUT_MS = 10000;

function isRailwayProductionEnvironment(env = process.env) {
  const railwayEnvironmentName = String(
    env.RAILWAY_ENVIRONMENT_NAME || env.RAILWAY_ENVIRONMENT || ""
  )
    .trim()
    .toLowerCase();
  return railwayEnvironmentName === "production";
}

function isEffectiveProductionEnv(env = process.env) {
  const nodeEnv = String(env.NODE_ENV || "").trim().toLowerCase();
  return nodeEnv === "production" || isRailwayProductionEnvironment(env);
}

function resolveRuntimeConfig(env = process.env) {
  const isProduction = isEffectiveProductionEnv(env);
  return {
    port: Number(env.PORT || 8787),
    adminApiKey: env.ADMIN_API_KEY || "",
    mcpApiKey: env.MCP_API_KEY || env.HAZIFY_MCP_API_KEY || "",
    publicBaseUrl: env.PUBLIC_BASE_URL || "",
    mcpPublicUrl: env.MCP_PUBLIC_URL || "",
    licenseGraceHours: Number(env.LICENSE_GRACE_HOURS || 72),
    readOnlyGraceDays: Number(env.READ_ONLY_GRACE_DAYS || 7),
    rateLimitPerMinute: Number(env.RATE_LIMIT_PER_MINUTE || 120),
    maxBodyBytes: Number(env.MAX_BODY_BYTES || 1_048_576),
    timestampSkewSeconds: Number(env.TIMESTAMP_SKEW_SECONDS || 900),
    freeMode: String(env.HAZIFY_FREE_MODE || "true").trim().toLowerCase() !== "false",
    stripeSecretKey: env.STRIPE_SECRET_KEY || "",
    stripeWebhookSecret: env.STRIPE_WEBHOOK_SECRET || "",
    stripeMode: String(env.STRIPE_MODE || "").trim().toLowerCase() === "test" ? "test" : "live",
    stripeDefaultPriceId: env.STRIPE_DEFAULT_PRICE_ID || "",
    stripeMonthlyPriceId: env.STRIPE_MONTHLY_PRICE_ID || "",
    stripeYearlyPriceId: env.STRIPE_YEARLY_PRICE_ID || "",
    stripeMonthlyPaymentLink: env.STRIPE_MONTHLY_PAYMENT_LINK || "",
    stripeYearlyPaymentLink: env.STRIPE_YEARLY_PAYMENT_LINK || "",
    checkoutSuccessUrl: env.CHECKOUT_SUCCESS_URL || "",
    checkoutCancelUrl: env.CHECKOUT_CANCEL_URL || "",
    portalReturnUrl: env.PORTAL_RETURN_URL || "",
    oauthIssuer: env.OAUTH_ISSUER || "",
    oauthAccessTokenTtlSeconds: Number(env.OAUTH_ACCESS_TOKEN_TTL_SECONDS || 3600),
    oauthRefreshTokenTtlDays: Number(env.OAUTH_REFRESH_TOKEN_TTL_DAYS || 30),
    oauthCodeTtlMinutes: Number(env.OAUTH_CODE_TTL_MINUTES || 10),
    oauthAllowedCustomRedirectSchemes: parseCommaSeparatedList(
      env.OAUTH_ALLOWED_CUSTOM_REDIRECT_SCHEMES,
      DEFAULT_OAUTH_CUSTOM_REDIRECT_SCHEMES
    ).map((entry) => String(entry).toLowerCase()),
    onboardingLogoPath: path.resolve(APP_ROOT, env.ONBOARDING_LOGO_PATH || DEFAULT_ONBOARDING_LOGO_PATH),
    accountSessionTtlDays: Number(env.ACCOUNT_SESSION_TTL_DAYS || 14),
    databaseUrl: env.DATABASE_URL || "",
    databaseSsl: env.DATABASE_SSL ?? "true",
    dbPoolMax: Number(env.DB_POOL_MAX || 10),
    dbStatementTimeoutMs: Number(env.DB_STATEMENT_TIMEOUT_MS || 5000),
    dataEncryptionKey: env.DATA_ENCRYPTION_KEY || "",
    dbSingleWriterEnforced:
      String(env.DB_SINGLE_WRITER_ENFORCED || "true").trim().toLowerCase() !== "false",
    dbSingleWriterLockKey: Number(env.DB_SINGLE_WRITER_LOCK_KEY || 19450603),
    dbSingleWriterLockRetryMs: Number(env.DB_SINGLE_WRITER_LOCK_RETRY_MS || (isProduction ? 2000 : 0)),
    dbSingleWriterLockTimeoutMs: Number(env.DB_SINGLE_WRITER_LOCK_TIMEOUT_MS || (isProduction ? 120000 : 0)),
    autoActivateSignupLicenses:
      String(env.HAZIFY_AUTO_ACTIVATE_SIGNUP_LICENSES || "").trim().toLowerCase() === "true",
    backupExportKey: env.BACKUP_EXPORT_KEY || "",
    backupExportDirectory: env.BACKUP_EXPORT_DIRECTORY || "",
    backupExportPolicy: String(env.BACKUP_EXPORT_POLICY || "").trim().toLowerCase(),
    effectiveProduction: isProduction,
  };
}

function assertValidRuntimeConfig(nextConfig, env = process.env) {
  const isProduction = isEffectiveProductionEnv(env);

  if (!Number.isSafeInteger(nextConfig.dbSingleWriterLockKey)) {
    throw new Error("DB_SINGLE_WRITER_LOCK_KEY moet een geldig integer lock-ID zijn.");
  }
  if (!Number.isFinite(nextConfig.dbSingleWriterLockRetryMs) || nextConfig.dbSingleWriterLockRetryMs < 0) {
    throw new Error("DB_SINGLE_WRITER_LOCK_RETRY_MS moet een geldig getal >= 0 zijn.");
  }
  if (!Number.isFinite(nextConfig.dbSingleWriterLockTimeoutMs) || nextConfig.dbSingleWriterLockTimeoutMs < 0) {
    throw new Error("DB_SINGLE_WRITER_LOCK_TIMEOUT_MS moet een geldig getal >= 0 zijn.");
  }

  if (!nextConfig.databaseUrl) {
    throw new Error("DATABASE_URL is verplicht.");
  }

  if (isProduction) {
    if (!String(nextConfig.dataEncryptionKey || "").trim()) {
      throw new Error("DATA_ENCRYPTION_KEY is verplicht in productie.");
    }
    if (nextConfig.freeMode) {
      throw new Error("HAZIFY_FREE_MODE=false is verplicht in productie.");
    }
    if (!String(nextConfig.mcpApiKey || "").trim()) {
      throw new Error("MCP_API_KEY is verplicht in productie.");
    }
    if (!String(nextConfig.adminApiKey || "").trim()) {
      throw new Error("ADMIN_API_KEY is verplicht in productie.");
    }
    if (!String(nextConfig.publicBaseUrl || "").trim()) {
      throw new Error("PUBLIC_BASE_URL is verplicht in productie.");
    }
    if (!String(nextConfig.mcpPublicUrl || "").trim()) {
      throw new Error("MCP_PUBLIC_URL is verplicht in productie.");
    }
    if (!nextConfig.dbSingleWriterEnforced) {
      throw new Error("DB_SINGLE_WRITER_ENFORCED=true is verplicht in productie.");
    }
    if (!String(nextConfig.backupExportKey || "").trim()) {
      throw new Error("BACKUP_EXPORT_KEY is verplicht in productie.");
    }
    if (!String(nextConfig.backupExportDirectory || "").trim()) {
      throw new Error("BACKUP_EXPORT_DIRECTORY is verplicht in productie.");
    }
    if (String(nextConfig.backupExportPolicy || "").trim() !== "encrypted") {
      throw new Error("BACKUP_EXPORT_POLICY=encrypted is verplicht in productie.");
    }
  }
}

const config = resolveRuntimeConfig();
const IS_PRODUCTION = isEffectiveProductionEnv();

function reloadRuntimeConfig(env = process.env) {
  const nextConfig = resolveRuntimeConfig(env);
  assertValidRuntimeConfig(nextConfig, env);

  for (const key of Object.keys(config)) {
    delete config[key];
  }
  Object.assign(config, nextConfig);
  return config;
}

export {
  ACCOUNT_SESSION_COOKIE,
  APP_ROOT,
  DEFAULT_ONBOARDING_LOGO_PATH,
  IS_PRODUCTION,
  SHOPIFY_CREDENTIAL_VALIDATION_TIMEOUT_MS,
  VALID_LICENSE_STATUSES,
  config,
  isEffectiveProductionEnv,
  reloadRuntimeConfig,
};
