export function createLicenseBillingHandlers({
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
}) {
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
      const priceId = resolveConfiguredPriceId(config, payload);

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
        const paymentLink = resolvePaymentLink(config, payload);
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

        const checkoutUrl = appendQueryParamsToUrl(paymentLink, {
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
        throw new Error(
          "priceId ontbreekt (zet STRIPE_DEFAULT_PRICE_ID of kies een plan met prijs-ID)"
        );
      }
      if (!isStripeSecretForMode(config.stripeSecretKey, config.stripeMode)) {
        throw new Error(`STRIPE_SECRET_KEY past niet bij STRIPE_MODE=${config.stripeMode}.`);
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
        const lookup = findLicenseByStripe(object.id, object.customer, object.metadata?.license_key);
        if (lookup) {
          applyStripeSubscriptionSnapshot(lookup.record, object);
          if (lookup.record.status === "past_due" && !lookup.record.pastDueSince) {
            lookup.record.pastDueSince = nowIso();
          }
          if (
            (lookup.record.status === "canceled" || lookup.record.status === "unpaid") &&
            !lookup.record.canceledAt
          ) {
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

      const authMode = tenant.shopify?.accessToken ? "access_token" : "client_credentials";
      const includesAccessToken = authMode === "access_token";

      return json(res, 200, {
        active: true,
        tokenId: tokenRecord.tokenId,
        tenantId: tenant.tenantId,
        licenseKey: tokenRecord.licenseKey,
        license: canonicalLicense(license),
        shopify: {
          domain: tenant.shopify?.domain || null,
          authMode,
          accessToken: includesAccessToken ? tenant.shopify?.accessToken || null : null,
          clientId: includesAccessToken ? null : tenant.shopify?.clientId || null,
          clientSecret: includesAccessToken ? null : tenant.shopify?.clientSecret || null,
        },
      });
    } catch (error) {
      return json(res, 400, {
        error: "bad_request",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  function handleBillingReadiness(_req, res) {
    return json(res, 200, billingReadiness(config));
  }

  function handleAdminReadiness(req, res) {
    if (!requireAdmin(req, res)) {
      return;
    }
    return json(res, 200, {
      ...billingReadiness(config),
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

  return {
    handleValidateOrHeartbeat,
    handleDeactivate,
    handleCreateCheckout,
    handleCreatePortalSession,
    handleStripeWebhook,
    handleMcpTokenIntrospect,
    handleBillingReadiness,
    handleAdminReadiness,
  };
}
