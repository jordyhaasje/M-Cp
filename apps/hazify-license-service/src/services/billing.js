function requestedPlan(payload) {
  return typeof payload?.plan === "string" ? payload.plan.trim().toLowerCase() : "";
}

function resolveConfiguredPriceId(config, payload) {
  const requested = requestedPlan(payload);
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

function resolvePaymentLink(config, payload) {
  const requested = requestedPlan(payload);
  if (requested === "yearly" || requested === "annual") {
    return config.stripeYearlyPaymentLink || "";
  }
  if (requested === "monthly") {
    return config.stripeMonthlyPaymentLink || "";
  }
  return config.stripeMonthlyPaymentLink || config.stripeYearlyPaymentLink || "";
}

function isStripeTestSecret(value) {
  return typeof value === "string" && value.trim().startsWith("sk_test_");
}

function isStripeLiveSecret(value) {
  return typeof value === "string" && value.trim().startsWith("sk_live_");
}

function isStripeSecretForMode(value, mode) {
  if (!value) {
    return false;
  }
  return mode === "test" ? isStripeTestSecret(value) : isStripeLiveSecret(value);
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

function billingDisabledPayload() {
  return {
    error: "billing_disabled",
    message: "Billing is disabled because HAZIFY_FREE_MODE=true",
    freeMode: true,
  };
}

function billingReadiness(config) {
  const mode = config.stripeMode;
  const hasAnyPriceId = !!(config.stripeDefaultPriceId || config.stripeMonthlyPriceId || config.stripeYearlyPriceId);
  const hasAnyPaymentLink = !!(config.stripeMonthlyPaymentLink || config.stripeYearlyPaymentLink);
  const onboardingCoreReady = !!(config.mcpPublicUrl && config.mcpApiKey && config.adminApiKey);
  const hasAnySecret = !!config.stripeSecretKey;
  const secretMatchesMode = !hasAnySecret || isStripeSecretForMode(config.stripeSecretKey, mode);
  const monthlyLinkMatchesMode =
    !config.stripeMonthlyPaymentLink ||
    isStripeModePaymentLink(config.stripeMonthlyPaymentLink, mode);
  const yearlyLinkMatchesMode =
    !config.stripeYearlyPaymentLink ||
    isStripeModePaymentLink(config.stripeYearlyPaymentLink, mode);
  const linksMatchMode = monthlyLinkMatchesMode && yearlyLinkMatchesMode;

  return {
    mode: config.freeMode ? "free" : "paid",
    freeMode: config.freeMode,
    stripe: {
      mode,
      billingEnabled: !config.freeMode,
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
    readyForPaymentLinks: !config.freeMode && onboardingCoreReady && hasAnyPaymentLink && linksMatchMode,
    readyForManagedCheckout:
      !config.freeMode &&
      !!config.stripeSecretKey &&
      !!config.stripeWebhookSecret &&
      secretMatchesMode &&
      hasAnyPriceId &&
      onboardingCoreReady,
    readyForOnboarding: onboardingCoreReady,
  };
}

export {
  billingDisabledPayload,
  billingReadiness,
  isStripeLiveSecret,
  isStripeModePaymentLink,
  isStripeSecretForMode,
  isStripeTestSecret,
  resolveConfiguredPriceId,
  resolvePaymentLink,
};
