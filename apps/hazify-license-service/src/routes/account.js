export function createAccountHandlers({
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
  accountSessionCookie,
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
}) {
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
      if (findAccountByEmail(db.accounts, email)) {
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
      const session = createAccountSession({
        db,
        accountId,
        req,
        createAccessToken: createAccountAccessToken,
        randomId,
        hashToken,
        nowIso,
        addDays,
        positiveNumber,
        accountSessionTtlDays: config.accountSessionTtlDays,
        clientIp,
      });
      await persistDb();

      setCookie(
        res,
        buildCookieHeader(accountSessionCookie, session.token, {
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
      const account = findAccountByEmail(db.accounts, email);
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
      const session = createAccountSession({
        db,
        accountId: account.accountId,
        req,
        createAccessToken: createAccountAccessToken,
        randomId,
        hashToken,
        nowIso,
        addDays,
        positiveNumber,
        accountSessionTtlDays: config.accountSessionTtlDays,
        clientIp,
      });
      await persistDb();

      setCookie(
        res,
        buildCookieHeader(accountSessionCookie, session.token, {
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
    const resolved = resolveAccountSession(req);
    if (resolved.session) {
      resolved.session.status = "revoked";
      resolved.session.updatedAt = nowIso();
      await persistDb();
    }
    setCookie(
      res,
      buildCookieHeader(accountSessionCookie, "", {
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
    const resolved = resolveAccountSession(req);
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
      await validateShopifyCredentialsLive(shopify);
      const requestedTenantId =
        typeof payload.tenantId === "string" && payload.tenantId.trim() ? payload.tenantId.trim() : null;
      const replaceExistingTenant = payload.replaceExistingTenant === true;
      let tenant = requestedTenantId
        ? db.tenants[requestedTenantId] || null
        : findTenantByLicenseKey(licenseKey, shopify.domain);
      if (tenant && tenant.licenseKey !== licenseKey) {
        throw new Error("tenantId does not belong to provided licenseKey");
      }
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
          shopify: buildTenantShopifyRecord(shopify, {
            validatedAt: now,
            lastValidationAt: now,
            lastValidationError: null,
          }),
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
        tenant.shopify = buildTenantShopifyRecord(shopify, {
          validatedAt: now,
          lastValidationAt: now,
          lastValidationError: null,
        });
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
          name: "Hazify MCP",
          url: resolvedMcpPublicUrl(req),
          bearerToken: token.accessToken,
        },
        config: {
          codexToml: `[mcp_servers."Hazify MCP"]\nurl = "${resolvedMcpPublicUrl(
            req
          )}"\nbearer_token = "${token.accessToken}"`,
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

  return {
    handleAccountSignup,
    handleAccountLogin,
    handleAccountLogout,
    handleAccountMe,
    handleSessionBootstrap,
    handleOnboardingConnectShopify,
  };
}
