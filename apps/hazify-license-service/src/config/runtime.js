import path from "path";
import { fileURLToPath } from "url";
import { parseCommaSeparatedList } from "@hazify/mcp-common";

const SERVICE_ROOT = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(SERVICE_ROOT, "..", "..");
const DEFAULT_ONBOARDING_LOGO_PATH = path.resolve(APP_ROOT, "logo.png");
const DEFAULT_OAUTH_CUSTOM_REDIRECT_SCHEMES = ["vscode", "cursor", "claude", "perplexity"];

const config = {
  port: Number(process.env.PORT || 8787),
  dbPath: path.resolve(APP_ROOT, process.env.LICENSE_DB_PATH || "data/licenses.json"),
  adminApiKey: process.env.ADMIN_API_KEY || "",
  mcpApiKey: process.env.MCP_API_KEY || process.env.HAZIFY_MCP_API_KEY || "",
  publicBaseUrl: process.env.PUBLIC_BASE_URL || "",
  mcpPublicUrl: process.env.MCP_PUBLIC_URL || "",
  licenseGraceHours: Number(process.env.LICENSE_GRACE_HOURS || 72),
  readOnlyGraceDays: Number(process.env.READ_ONLY_GRACE_DAYS || 7),
  rateLimitPerMinute: Number(process.env.RATE_LIMIT_PER_MINUTE || 120),
  maxBodyBytes: Number(process.env.MAX_BODY_BYTES || 1_048_576),
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
  oauthAllowedCustomRedirectSchemes: parseCommaSeparatedList(
    process.env.OAUTH_ALLOWED_CUSTOM_REDIRECT_SCHEMES,
    DEFAULT_OAUTH_CUSTOM_REDIRECT_SCHEMES
  ).map((entry) => String(entry).toLowerCase()),
  onboardingLogoPath: path.resolve(
    APP_ROOT,
    process.env.ONBOARDING_LOGO_PATH || DEFAULT_ONBOARDING_LOGO_PATH
  ),
  accountSessionTtlDays: Number(process.env.ACCOUNT_SESSION_TTL_DAYS || 14),
  databaseUrl: process.env.DATABASE_URL || "",
  databaseSsl: process.env.DATABASE_SSL ?? "true",
  dbPoolMax: Number(process.env.DB_POOL_MAX || 10),
  dbStatementTimeoutMs: Number(process.env.DB_STATEMENT_TIMEOUT_MS || 5000),
  dataEncryptionKey: process.env.DATA_ENCRYPTION_KEY || "",
  backupExportKey: process.env.BACKUP_EXPORT_KEY || "",
};

const VALID_LICENSE_STATUSES = new Set(["active", "past_due", "canceled", "invalid", "unpaid"]);
const ACCOUNT_SESSION_COOKIE = "hz_user_session";
const SHOPIFY_CREDENTIAL_VALIDATION_TIMEOUT_MS = 10000;
const IS_PRODUCTION = String(process.env.NODE_ENV || "").trim().toLowerCase() === "production";

if (IS_PRODUCTION) {
  if (!config.databaseUrl) {
    throw new Error("DATABASE_URL is verplicht in productie.");
  }
  if (!String(config.dataEncryptionKey || "").trim()) {
    throw new Error("DATA_ENCRYPTION_KEY is verplicht in productie.");
  }
}

export {
  ACCOUNT_SESSION_COOKIE,
  APP_ROOT,
  DEFAULT_ONBOARDING_LOGO_PATH,
  IS_PRODUCTION,
  SHOPIFY_CREDENTIAL_VALIDATION_TIMEOUT_MS,
  VALID_LICENSE_STATUSES,
  config,
};
