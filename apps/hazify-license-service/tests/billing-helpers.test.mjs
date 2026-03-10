import assert from "assert";
import {
  billingDisabledPayload,
  billingReadiness,
  isStripeModePaymentLink,
  isStripeSecretForMode,
  resolveConfiguredPriceId,
  resolvePaymentLink,
} from "../src/services/billing.js";

const baseConfig = {
  freeMode: false,
  stripeMode: "test",
  stripeSecretKey: "sk_test_123",
  stripeWebhookSecret: "whsec_123",
  stripeDefaultPriceId: "price_default",
  stripeMonthlyPriceId: "price_monthly",
  stripeYearlyPriceId: "price_yearly",
  stripeMonthlyPaymentLink: "https://buy.stripe.com/test_monthly",
  stripeYearlyPaymentLink: "https://buy.stripe.com/test_yearly",
  checkoutSuccessUrl: "https://hazify.dev/success",
  checkoutCancelUrl: "https://hazify.dev/cancel",
  portalReturnUrl: "https://hazify.dev/portal",
  mcpPublicUrl: "https://mcp.hazify.dev/mcp",
  mcpApiKey: "mcp_key",
  adminApiKey: "admin_key",
};

assert.equal(resolveConfiguredPriceId(baseConfig, { plan: "monthly" }), "price_monthly");
assert.equal(resolveConfiguredPriceId(baseConfig, { plan: "yearly" }), "price_yearly");
assert.equal(resolveConfiguredPriceId(baseConfig, { priceId: "price_custom" }), "price_custom");
assert.equal(resolveConfiguredPriceId({ ...baseConfig, stripeMonthlyPriceId: "" }, { plan: "monthly" }), "price_default");

assert.equal(resolvePaymentLink(baseConfig, { plan: "monthly" }), "https://buy.stripe.com/test_monthly");
assert.equal(resolvePaymentLink(baseConfig, { plan: "annual" }), "https://buy.stripe.com/test_yearly");
assert.equal(
  resolvePaymentLink({ ...baseConfig, stripeMonthlyPaymentLink: "" }, {}),
  "https://buy.stripe.com/test_yearly"
);

assert.equal(isStripeSecretForMode("sk_test_abc", "test"), true);
assert.equal(isStripeSecretForMode("sk_live_abc", "live"), true);
assert.equal(isStripeSecretForMode("sk_test_abc", "live"), false);

assert.equal(isStripeModePaymentLink("https://buy.stripe.com/test_abc", "test"), true);
assert.equal(isStripeModePaymentLink("https://buy.stripe.com/abc", "live"), true);
assert.equal(isStripeModePaymentLink("https://buy.stripe.com/test_abc", "live"), false);

assert.deepEqual(billingDisabledPayload(), {
  error: "billing_disabled",
  message: "Billing is disabled because HAZIFY_FREE_MODE=true",
  freeMode: true,
});

const paidReadiness = billingReadiness(baseConfig);
assert.equal(paidReadiness.mode, "paid");
assert.equal(paidReadiness.freeMode, false);
assert.equal(paidReadiness.readyForManagedCheckout, true);
assert.equal(paidReadiness.readyForPaymentLinks, true);
assert.equal(paidReadiness.readyForOnboarding, true);
assert.equal(paidReadiness.stripe.secretMatchesMode, true);
assert.equal(paidReadiness.stripe.linksMatchMode, true);

const freeReadiness = billingReadiness({ ...baseConfig, freeMode: true });
assert.equal(freeReadiness.mode, "free");
assert.equal(freeReadiness.freeMode, true);
assert.equal(freeReadiness.readyForManagedCheckout, false);
assert.equal(freeReadiness.readyForPaymentLinks, false);
assert.equal(freeReadiness.readyForOnboarding, true);

const mismatchedReadiness = billingReadiness({
  ...baseConfig,
  stripeMode: "live",
  stripeSecretKey: "sk_test_123",
  stripeMonthlyPaymentLink: "https://buy.stripe.com/test_monthly",
});
assert.equal(mismatchedReadiness.stripe.secretMatchesMode, false);
assert.equal(mismatchedReadiness.stripe.linksMatchMode, false);
assert.equal(mismatchedReadiness.readyForManagedCheckout, false);
assert.equal(mismatchedReadiness.readyForPaymentLinks, false);

console.log("billing-helpers.test.mjs passed");
