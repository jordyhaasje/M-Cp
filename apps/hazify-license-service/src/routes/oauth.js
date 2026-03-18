import crypto from "crypto";

export function createOAuthHandlers({
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
  renderOAuthAuthorizePage,
  renderOAuthReconnectPage,
  ensureFreeLicenseRecord,
  isLicenseUsableForOnboarding,
  normalizeShopDomain,
  logEvent,
}) {
  function oauthIssuerBase(req) {
    if (config.oauthIssuer) {
      return normalizeBaseUrl(config.oauthIssuer);
    }
    return requestBaseUrl(req);
  }

  function oauthMetadata(req) {
    const issuer = oauthIssuerBase(req);
    return buildOauthMetadata({
      issuer,
      serviceDocumentation: `${requestBaseUrl(req)}/onboarding`,
    });
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
    return Object.values(db.oauthRefreshTokens).find((record) => record && record.tokenHash === tokenHash);
  }

  async function revokeRefreshTokenFamily(familyId, reason = "manual") {
    if (!familyId) {
      return { revokedRefreshTokens: 0, revokedAccessTokens: 0 };
    }
    const now = nowIso();
    let revokedRefreshTokens = 0;
    let revokedAccessTokens = 0;
    for (const record of Object.values(db.oauthRefreshTokens)) {
      if (!record || record.familyId !== familyId) {
        continue;
      }
      if (record.status === "revoked" || record.status === "expired") {
        continue;
      }
      record.status = "revoked";
      record.revokedAt = now;
      if (reason === "replay") {
        record.replayDetectedAt = now;
      }
      record.updatedAt = now;
      revokedRefreshTokens += 1;
    }
    for (const tokenRecord of Object.values(db.mcpTokens)) {
      if (!tokenRecord || tokenRecord.oauthTokenFamilyId !== familyId) {
        continue;
      }
      if (tokenRecord.status !== "active") {
        continue;
      }
      tokenRecord.status = "revoked";
      tokenRecord.updatedAt = now;
      revokedAccessTokens += 1;
    }
    await persistDb();
    return { revokedRefreshTokens, revokedAccessTokens };
  }

  const flowLocks = new Map();
  async function runSerializedByKey(key, work) {
    const lockKey = key || "__default__";
    const previous = flowLocks.get(lockKey) || Promise.resolve();
    const next = previous.then(work, work);
    const settled = next.then(
      () => undefined,
      () => undefined
    );
    flowLocks.set(lockKey, settled);
    try {
      return await next;
    } finally {
      if (flowLocks.get(lockKey) === settled) {
        flowLocks.delete(lockKey);
      }
    }
  }

  function isValidPkceChallenge(challenge) {
    return typeof challenge === "string" && /^[A-Za-z0-9_-]{43,128}$/.test(challenge);
  }

  function redirectWithOAuthResult(res, redirectUri, params) {
    const location = appendQueryParamsToUrl(redirectUri, params);
    res.writeHead(302, { Location: location, "Cache-Control": "no-store" });
    res.end();
  }

  function validateOAuthGrantType(grantType) {
    return grantType === "authorization_code" || grantType === "refresh_token";
  }

  function logOAuthTokenFailure(reason, details = {}) {
    try {
      logEvent("oauth_token_failed", {
        reason,
        ...details,
      });
    } catch {
      // Logging should never block token responses.
    }
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
      const payload = await readJsonOrFormBody(req, readBody);
      const redirectUris = normalizeStringArray(payload.redirect_uris);
      if (!redirectUris.length) {
        return oauthJsonError(res, 400, "invalid_client_metadata", "redirect_uris is required", json);
      }
      if (!redirectUris.every((uriValue) => isAllowedRedirectUri(uriValue))) {
        return oauthJsonError(
          res,
          400,
          "invalid_client_metadata",
          "All redirect_uris must be https:// or localhost http:// URIs",
          json
        );
      }

      const tokenEndpointAuthMethod =
        typeof payload.token_endpoint_auth_method === "string" &&
        ["none", "client_secret_post", "client_secret_basic"].includes(payload.token_endpoint_auth_method)
          ? payload.token_endpoint_auth_method
          : "none";
      const grantTypes = normalizeStringArray(payload.grant_types);
      const responseTypes = normalizeStringArray(payload.response_types);
      if (grantTypes.length && !grantTypes.every((value) => value === "authorization_code" || value === "refresh_token")) {
        return oauthJsonError(
          res,
          400,
          "invalid_client_metadata",
          "grant_types must contain only authorization_code and refresh_token",
          json
        );
      }
      if (responseTypes.length && !responseTypes.every((value) => value === "code")) {
        return oauthJsonError(
          res,
          400,
          "invalid_client_metadata",
          "response_types must contain only code",
          json
        );
      }
      const scope = "mcp:tools";

      const clientId = randomId("oauthcli");
      const issuedAtSeconds = Math.floor(Date.now() / 1000);
      const isPublicClient = tokenEndpointAuthMethod === "none";
      const clientSecret = isPublicClient ? null : `hzcsec_${crypto.randomBytes(24).toString("hex")}`;
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
        clientSecretHash: clientSecret ? hashToken(clientSecret) : null,
        createdAt: nowIso(),
        updatedAt: nowIso(),
        status: "active",
      };
      await persistDb();

      const responsePayload = {
        client_id: clientId,
        client_id_issued_at: issuedAtSeconds,
        client_name: db.oauthClients[clientId].clientName,
        redirect_uris: redirectUris,
        grant_types: db.oauthClients[clientId].grantTypes,
        response_types: db.oauthClients[clientId].responseTypes,
        token_endpoint_auth_method: tokenEndpointAuthMethod,
        scope,
      };
      if (clientSecret) {
        responsePayload.client_secret = clientSecret;
        responsePayload.client_secret_expires_at = 0;
      }
      return json(res, 201, responsePayload);
    } catch (error) {
      return oauthJsonError(
        res,
        400,
        "invalid_client_metadata",
        error instanceof Error ? error.message : String(error),
        json
      );
    }
  }

  async function completeOAuthAuthorizeDecision({
    res,
    client,
    clientId,
    redirectUri,
    state,
    responseType,
    codeChallenge,
    codeChallengeMethod,
    scope,
    decision,
    licenseKey,
    shopDomain = "",
    authorizePath = "/oauth/authorize",
  }) {
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
        renderOAuthAuthorizePage({
          error: "Je account heeft nog geen actieve toegang.",
          clientName: client.clientName,
          clientId,
          authorizeAction: authorizePath,
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
        renderOAuthAuthorizePage({
          error: "Je account kan deze koppeling nu niet afronden.",
          clientName: client.clientName,
          clientId,
          authorizeAction: authorizePath,
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
      tenant = resolveTenantForOAuth(licenseKey, shopDomain);
    } catch (error) {
      res.writeHead(400, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      res.end(
        renderOAuthAuthorizePage({
          error: error instanceof Error ? error.message : String(error),
          clientName: client.clientName,
          clientId,
          authorizeAction: authorizePath,
          redirectUri,
          state,
          responseType,
          codeChallenge,
          codeChallengeMethod,
          scope,
          shopDomain,
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
      codeChallenge,
      codeChallengeMethod: "S256",
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
  }

  async function handleOAuthAuthorizeGet(req, res, url) {
    const clientId = url.searchParams.get("client_id") || "";
    const redirectUri = url.searchParams.get("redirect_uri") || "";
    const state = url.searchParams.get("state") || "";
    const responseType = url.searchParams.get("response_type") || "code";
    const codeChallenge = url.searchParams.get("code_challenge") || "";
    const codeChallengeMethod = url.searchParams.get("code_challenge_method") || "S256";
    const requestedShopDomain =
      typeof url.searchParams.get("shopDomain") === "string"
        ? String(url.searchParams.get("shopDomain")).trim()
        : "";
    const scope = "mcp:tools";

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
      if (!codeChallenge) {
        redirectWithOAuthResult(res, redirectUri, {
          error: "invalid_request",
          error_description: "PKCE code_challenge (S256) is required",
          state,
        });
        return;
      }
      if (!isValidPkceChallenge(codeChallenge)) {
        redirectWithOAuthResult(res, redirectUri, {
          error: "invalid_request",
          error_description: "Invalid PKCE code_challenge format",
          state,
        });
        return;
      }
      if (codeChallengeMethod !== "S256") {
        redirectWithOAuthResult(res, redirectUri, {
          error: "invalid_request",
          error_description: "Unsupported code_challenge_method (only S256 is allowed)",
          state,
        });
        return;
      }
    } catch (error) {
      res.writeHead(400, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      res.end(
        renderOAuthAuthorizePage({
          error: error instanceof Error ? error.message : String(error),
          clientName: client.clientName,
          clientId,
          authorizeAction: url.pathname || "/oauth/authorize",
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

    const accountSession = resolveAccountSession(req);
    if (!accountSession.account) {
      const next = safeRedirectPath(`${url.pathname}${url.search}`, "/onboarding");
      return redirectTo(res, `/login?next=${encodeURIComponent(next)}`);
    }

    const shopOptions = getTenantsByLicenseKey(accountSession.account.licenseKey)
      .map((tenant) => tenant?.shopify?.domain)
      .filter(Boolean);

    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    res.end(
      renderOAuthAuthorizePage({
        clientName: client.clientName,
        clientId,
        authorizeAction: url.pathname || "/oauth/authorize",
        redirectUri,
        state,
        responseType,
        codeChallenge,
        codeChallengeMethod,
        scope,
        shopDomain: requestedShopDomain,
        shopOptions,
      })
    );
  }

  async function handleOAuthAuthorizePost(req, res) {
    if (!applyRateLimit(req, res)) {
      return;
    }
    try {
      const payload = await readJsonOrFormBody(req, readBody);
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
          : "S256";
      const scope = "mcp:tools";
      const decision =
        typeof payload.decision === "string" && payload.decision.trim() ? payload.decision.trim() : "deny";
      const authorizePath = (() => {
        try {
          const parsed = new URL(req.url || "/oauth/authorize", "http://localhost");
          return parsed.pathname || "/oauth/authorize";
        } catch {
          return "/oauth/authorize";
        }
      })();

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
      if (!codeChallenge) {
        redirectWithOAuthResult(res, redirectUri, {
          error: "invalid_request",
          error_description: "PKCE code_challenge (S256) is required",
          state,
        });
        return;
      }
      if (!isValidPkceChallenge(codeChallenge)) {
        redirectWithOAuthResult(res, redirectUri, {
          error: "invalid_request",
          error_description: "Invalid PKCE code_challenge format",
          state,
        });
        return;
      }
      if (codeChallengeMethod !== "S256") {
        redirectWithOAuthResult(res, redirectUri, {
          error: "invalid_request",
          error_description: "Unsupported code_challenge_method (only S256 is allowed)",
          state,
        });
        return;
      }

      const accountSession = resolveAccountSession(req);
      if (!accountSession.account) {
        const next = safeRedirectPath(
          `/oauth/authorize?client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(
            redirectUri
          )}&state=${encodeURIComponent(state)}&response_type=${encodeURIComponent(
            responseType
          )}&code_challenge=${encodeURIComponent(
            codeChallenge
          )}&code_challenge_method=${encodeURIComponent(codeChallengeMethod)}&scope=${encodeURIComponent(
            scope
          )}`,
          "/onboarding"
        );
        return redirectTo(res, `/login?next=${encodeURIComponent(next)}`);
      }

      const licenseKey = accountSession.account.licenseKey;
      return completeOAuthAuthorizeDecision({
        res,
        client,
        clientId,
        redirectUri,
        state,
        responseType,
        codeChallenge,
        codeChallengeMethod,
        scope,
        decision,
        licenseKey,
        shopDomain: typeof payload.shopDomain === "string" ? payload.shopDomain.trim() : "",
        authorizePath,
      });
    } catch (error) {
      return oauthJsonError(
        res,
        400,
        "invalid_request",
        error instanceof Error ? error.message : String(error),
        json
      );
    }
  }

  async function handleOAuthToken(req, res) {
    if (!applyRateLimit(req, res)) {
      return;
    }
    try {
      const payload = await readJsonOrFormBody(req, readBody);
      const grantType = typeof payload.grant_type === "string" ? payload.grant_type.trim() : "";
      if (!validateOAuthGrantType(grantType)) {
        logOAuthTokenFailure("unsupported_grant_type", { grantType });
        return oauthJsonError(res, 400, "unsupported_grant_type", "Unsupported grant_type", json);
      }

      if (grantType === "authorization_code") {
        const code = typeof payload.code === "string" ? payload.code.trim() : "";
        if (!code) {
          logOAuthTokenFailure("missing_code", { grantType });
          return oauthJsonError(res, 400, "invalid_request", "code is required", json);
        }
        return await runSerializedByKey(`oauth:code:${code}`, async () => {
          const codeRecord = db.oauthAuthCodes[code];
          if (!codeRecord || codeRecord.status !== "active" || codeRecord.usedAt) {
            logOAuthTokenFailure("invalid_code", { grantType });
            return oauthJsonError(
              res,
              400,
              "invalid_grant",
              "Authorization code is invalid or already used",
              json
            );
          }
          if (Date.parse(codeRecord.expiresAt) < Date.now()) {
            codeRecord.status = "expired";
            codeRecord.usedAt = nowIso();
            await persistDb();
            logOAuthTokenFailure("expired_code", {
              grantType,
              clientId: codeRecord.clientId,
            });
            return oauthJsonError(res, 400, "invalid_grant", "Authorization code has expired", json);
          }

          const client = getOAuthClient(codeRecord.clientId);
          if (!client) {
            logOAuthTokenFailure("missing_client", {
              grantType,
              clientId: codeRecord.clientId,
            });
            return oauthJsonError(res, 401, "invalid_client", "OAuth client is invalid", json);
          }

          try {
            validateOAuthClientAuthentication({
              req,
              payload,
              client,
              hashToken,
              safeTimingEqual,
              allowedCustomRedirectSchemes: config.oauthAllowedCustomRedirectSchemes,
            });
          } catch (error) {
            if (error instanceof Error && error.message === "invalid_client") {
              logOAuthTokenFailure("invalid_client_auth", {
                grantType,
                clientId: client.clientId,
                authMethod: client.tokenEndpointAuthMethod || "none",
              });
              return oauthJsonError(res, 401, "invalid_client", "Client authentication failed", json);
            }
            logOAuthTokenFailure("invalid_auth_request", {
              grantType,
              clientId: client.clientId,
              authMethod: client.tokenEndpointAuthMethod || "none",
            });
            return oauthJsonError(
              res,
              400,
              "invalid_request",
              error instanceof Error ? error.message : String(error),
              json
            );
          }

          const redirectUri = typeof payload.redirect_uri === "string" ? payload.redirect_uri.trim() : "";
          if (!redirectUri || redirectUri !== codeRecord.redirectUri) {
            logOAuthTokenFailure("redirect_uri_mismatch", {
              grantType,
              clientId: client.clientId,
            });
            return oauthJsonError(res, 400, "invalid_grant", "redirect_uri mismatch", json);
          }
          if (
            !codeRecord.codeChallenge ||
            !isValidPkceChallenge(codeRecord.codeChallenge) ||
            codeRecord.codeChallengeMethod !== "S256"
          ) {
            logOAuthTokenFailure("missing_pkce_requirements", {
              grantType,
              clientId: client.clientId,
            });
            return oauthJsonError(
              res,
              400,
              "invalid_grant",
              "Authorization code is missing PKCE requirements",
              json
            );
          }
          const verifier = typeof payload.code_verifier === "string" ? payload.code_verifier : "";
          if (!verifyPkceCodeVerifier(verifier, codeRecord.codeChallenge, "S256")) {
            logOAuthTokenFailure("invalid_code_verifier", {
              grantType,
              clientId: client.clientId,
            });
            return oauthJsonError(res, 400, "invalid_grant", "Invalid code_verifier", json);
          }

          const accessTokenTtlSeconds = Math.max(300, Number(config.oauthAccessTokenTtlSeconds || 3600));
          const refreshTokenTtlDays = positiveNumber(config.oauthRefreshTokenTtlDays || 30, 30);
          const refreshToken = `hzrft_${crypto.randomBytes(28).toString("hex")}`;
          const refreshTokenId = randomId("oauthrt");
          const refreshFamilyId = randomId("oauthfam");
          const accessToken = createMcpTokenForTenant(codeRecord.tenantId, {
            name: `oauth:${client.clientName || client.clientId}`,
            expiresInSeconds: accessTokenTtlSeconds,
            oauthClientId: client.clientId,
            oauthRefreshTokenId: refreshTokenId,
            oauthTokenFamilyId: refreshFamilyId,
          });

          db.oauthRefreshTokens[refreshTokenId] = {
            refreshTokenId,
            tokenHash: hashToken(refreshToken),
            clientId: client.clientId,
            tenantId: codeRecord.tenantId,
            licenseKey: codeRecord.licenseKey,
            familyId: refreshFamilyId,
            parentRefreshTokenId: null,
            replacedByRefreshTokenId: null,
            scope: codeRecord.scope || "mcp:tools",
            status: "active",
            revokedAt: null,
            replayDetectedAt: null,
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
        });
      }

      const rawRefreshToken = typeof payload.refresh_token === "string" ? payload.refresh_token.trim() : "";
      if (!rawRefreshToken) {
        logOAuthTokenFailure("missing_refresh_token", { grantType });
        return oauthJsonError(res, 400, "invalid_request", "refresh_token is required", json);
      }
      const refreshTokenHash = hashToken(rawRefreshToken);
      return await runSerializedByKey(`oauth:refresh:${refreshTokenHash}`, async () => {
        const refreshRecord = findOAuthRefreshTokenRecord(rawRefreshToken);
        if (!refreshRecord) {
          logOAuthTokenFailure("invalid_refresh_token", { grantType });
          return oauthJsonError(res, 400, "invalid_grant", "Refresh token is invalid", json);
        }
        if (Date.parse(refreshRecord.expiresAt) < Date.now()) {
          refreshRecord.status = "expired";
          refreshRecord.updatedAt = nowIso();
          await persistDb();
          logOAuthTokenFailure("expired_refresh_token", {
            grantType,
            clientId: refreshRecord.clientId,
          });
          return oauthJsonError(res, 400, "invalid_grant", "Refresh token has expired", json);
        }
        if (refreshRecord.status !== "active") {
          if (refreshRecord.status === "rotated") {
            await revokeRefreshTokenFamily(refreshRecord.familyId || refreshRecord.refreshTokenId, "replay");
          }
          logOAuthTokenFailure("inactive_refresh_token", {
            grantType,
            clientId: refreshRecord.clientId,
            refreshStatus: refreshRecord.status,
          });
          return oauthJsonError(res, 400, "invalid_grant", "Refresh token is invalid", json);
        }

        const client = getOAuthClient(refreshRecord.clientId);
        if (!client) {
          logOAuthTokenFailure("missing_client", {
            grantType,
            clientId: refreshRecord.clientId,
          });
          return oauthJsonError(res, 401, "invalid_client", "OAuth client is invalid", json);
        }
        try {
          validateOAuthClientAuthentication({
            req,
            payload,
            client,
            hashToken,
            safeTimingEqual,
            allowedCustomRedirectSchemes: config.oauthAllowedCustomRedirectSchemes,
          });
        } catch (error) {
          if (error instanceof Error && error.message === "invalid_client") {
            logOAuthTokenFailure("invalid_client_auth", {
              grantType,
              clientId: client.clientId,
              authMethod: client.tokenEndpointAuthMethod || "none",
            });
            return oauthJsonError(res, 401, "invalid_client", "Client authentication failed", json);
          }
          logOAuthTokenFailure("invalid_auth_request", {
            grantType,
            clientId: client.clientId,
            authMethod: client.tokenEndpointAuthMethod || "none",
          });
          return oauthJsonError(
            res,
            400,
            "invalid_request",
            error instanceof Error ? error.message : String(error),
            json
          );
        }

        const requestedScope =
          typeof payload.scope === "string" && payload.scope.trim() ? payload.scope.trim() : null;
        const effectiveScope = refreshRecord.scope || "mcp:tools";
        if (requestedScope && requestedScope !== effectiveScope) {
          logOAuthTokenFailure("invalid_scope", {
            grantType,
            clientId: client.clientId,
          });
          return oauthJsonError(
            res,
            400,
            "invalid_scope",
            "scope must match the previously granted scope",
            json
          );
        }

        const accessTokenTtlSeconds = Math.max(300, Number(config.oauthAccessTokenTtlSeconds || 3600));
        const refreshTokenTtlDays = positiveNumber(config.oauthRefreshTokenTtlDays || 30, 30);
        const rotatedRefreshToken = `hzrft_${crypto.randomBytes(28).toString("hex")}`;
        const nextRefreshTokenId = randomId("oauthrt");
        const familyId = refreshRecord.familyId || refreshRecord.refreshTokenId;
        const accessToken = createMcpTokenForTenant(refreshRecord.tenantId, {
          name: `oauth:${client.clientName || client.clientId}`,
          expiresInSeconds: accessTokenTtlSeconds,
          oauthClientId: refreshRecord.clientId,
          oauthRefreshTokenId: nextRefreshTokenId,
          oauthTokenFamilyId: familyId,
        });

        refreshRecord.status = "rotated";
        refreshRecord.updatedAt = nowIso();
        refreshRecord.replacedByRefreshTokenId = nextRefreshTokenId;
        db.oauthRefreshTokens[nextRefreshTokenId] = {
          refreshTokenId: nextRefreshTokenId,
          tokenHash: hashToken(rotatedRefreshToken),
          clientId: refreshRecord.clientId,
          tenantId: refreshRecord.tenantId,
          licenseKey: refreshRecord.licenseKey,
          familyId,
          parentRefreshTokenId: refreshRecord.refreshTokenId,
          replacedByRefreshTokenId: null,
          scope: effectiveScope,
          status: "active",
          revokedAt: null,
          replayDetectedAt: null,
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
          scope: effectiveScope,
        });
      });
    } catch (error) {
      return oauthJsonError(
        res,
        400,
        "invalid_request",
        error instanceof Error ? error.message : String(error),
        json
      );
    }
  }

  return {
    handleOAuthAuthorizationServerMetadata,
    handleOAuthOpenIdConfiguration,
    handleOAuthRegister,
    handleOAuthAuthorizeGet,
    handleOAuthAuthorizePost,
    handleOAuthToken,
  };
}
