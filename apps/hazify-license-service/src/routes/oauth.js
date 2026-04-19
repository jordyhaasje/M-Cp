import crypto from "crypto";
import {
  MCP_SCOPE_TOOLS,
  getMcpScopeCapabilities,
  normalizeMcpScopeString,
  parseSpaceSeparatedScopes,
} from "@hazify/mcp-common";

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

  function resolveExpectedOauthResource(req) {
    if (config.mcpPublicUrl) {
      return normalizeBaseUrl(config.mcpPublicUrl);
    }
    return normalizeBaseUrl(`${requestBaseUrl(req)}/mcp`);
  }

  function assertSupportedOauthResource(req, resource) {
    const normalizedResource = normalizeBaseUrl(resource || "");
    if (!normalizedResource) {
      return "";
    }
    const expectedResource = resolveExpectedOauthResource(req);
    if (normalizedResource !== expectedResource) {
      throw new Error("Unsupported resource for this authorization server");
    }
    return normalizedResource;
  }

  function validateOAuthGrantType(grantType) {
    return grantType === "authorization_code" || grantType === "refresh_token";
  }

  const allowedAuxiliaryScopes = new Set(["offline_access"]);

  function normalizeOauthScope(rawScope, fallback = MCP_SCOPE_TOOLS) {
    const tokens = parseSpaceSeparatedScopes(rawScope || "", [fallback]);
    return normalizeMcpScopeString(tokens.join(" "), fallback);
  }

  function normalizeAuthorizeRequestScope(rawScope, fallback = MCP_SCOPE_TOOLS) {
    const rawTokens = parseSpaceSeparatedScopes(rawScope || "", [fallback]);
    const normalizedScope = assertSupportedOauthScope(rawTokens.join(" "), fallback);
    const normalizedTokens = parseSpaceSeparatedScopes(normalizedScope, [fallback]).filter(Boolean);
    const auxiliaryTokens = rawTokens.filter((token) => allowedAuxiliaryScopes.has(token));
    return Array.from(new Set([...normalizedTokens, ...auxiliaryTokens])).join(" ");
  }

  function haveEquivalentOauthScopeAccess(leftScope, rightScope, fallback = MCP_SCOPE_TOOLS) {
    const leftCapabilities = getMcpScopeCapabilities(assertSupportedOauthScope(leftScope, fallback));
    const rightCapabilities = getMcpScopeCapabilities(assertSupportedOauthScope(rightScope, fallback));
    return (
      leftCapabilities.read === rightCapabilities.read &&
      leftCapabilities.write === rightCapabilities.write
    );
  }

  function buildAuthorizeAction(
    pathname = "/oauth/authorize",
    {
      clientId = "",
      redirectUri = "",
      state = "",
      responseType = "code",
      codeChallenge = "",
      codeChallengeMethod = "S256",
      scope = "",
      resource = "",
      shopDomain = "",
    } = {}
  ) {
    const params = new URLSearchParams();
    if (clientId) {
      params.set("client_id", clientId);
    }
    if (redirectUri) {
      params.set("redirect_uri", redirectUri);
    }
    if (responseType) {
      params.set("response_type", responseType);
    }
    if (state) {
      params.set("state", state);
    }
    if (codeChallenge) {
      params.set("code_challenge", codeChallenge);
    }
    if (codeChallengeMethod) {
      params.set("code_challenge_method", codeChallengeMethod);
    }
    if (scope) {
      params.set("scope", scope);
    }
    if (resource) {
      params.set("resource", resource);
    }
    if (shopDomain) {
      params.set("shopDomain", shopDomain);
    }
    const query = params.toString();
    return query ? `${pathname}?${query}` : pathname;
  }

  function assertSupportedOauthScope(rawScope, fallback = MCP_SCOPE_TOOLS) {
    const rawTokens = parseSpaceSeparatedScopes(rawScope || "", [fallback]);
    const normalizedScope = normalizeOauthScope(rawTokens.join(" "), fallback);
    const capabilities = getMcpScopeCapabilities(normalizedScope);
    if (!capabilities.read) {
      throw new Error("Unsupported scope");
    }
    const invalidTokens = rawTokens.filter(
      (token) => !token.startsWith("mcp:") && !allowedAuxiliaryScopes.has(token)
    );
    if (invalidTokens.length > 0) {
      throw new Error("Unsupported scope");
    }
    return normalizedScope;
  }

  function resolveOAuthClientScope(client) {
    return assertSupportedOauthScope(client?.scope || MCP_SCOPE_TOOLS, MCP_SCOPE_TOOLS);
  }

  function resolveRequestedOAuthScope(client, rawScope) {
    const clientScope = resolveOAuthClientScope(client);
    const requestedScope = assertSupportedOauthScope(rawScope, clientScope);
    const requestedCapabilities = getMcpScopeCapabilities(requestedScope);
    const clientCapabilities = getMcpScopeCapabilities(clientScope);
    if (requestedCapabilities.write && !clientCapabilities.write) {
      throw new Error("Requested scope exceeds registered client scope");
    }
    return requestedScope;
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
      let scope;
      try {
        scope = assertSupportedOauthScope(payload.scope, MCP_SCOPE_TOOLS);
      } catch (error) {
        return oauthJsonError(
          res,
          400,
          "invalid_client_metadata",
          error instanceof Error ? error.message : String(error),
          json
        );
      }

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
    renderScope = scope,
    decision,
    licenseKey,
    shopDomain = "",
    targetResource = "",
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
          scope: renderScope,
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
          scope: renderScope,
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
          scope: renderScope,
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
      targetResource: targetResource || null,
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
    const authorizePath = url.pathname || "/oauth/authorize";
    const clientId = url.searchParams.get("client_id") || "";
    const redirectUri = url.searchParams.get("redirect_uri") || "";
    const state = url.searchParams.get("state") || "";
    const responseType = url.searchParams.get("response_type") || "code";
    const codeChallenge = url.searchParams.get("code_challenge") || "";
    const codeChallengeMethod = url.searchParams.get("code_challenge_method") || "S256";
    const requestedScope =
      typeof url.searchParams.get("scope") === "string" && url.searchParams.get("scope").trim()
        ? String(url.searchParams.get("scope")).trim()
        : "";
    const resource =
      typeof url.searchParams.get("resource") === "string" && url.searchParams.get("resource").trim()
        ? String(url.searchParams.get("resource")).trim()
        : "";
    const requestedShopDomain =
      typeof url.searchParams.get("shopDomain") === "string"
        ? String(url.searchParams.get("shopDomain")).trim()
        : "";

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
    let scope = resolveOAuthClientScope(client);
    let authorizeScope = normalizeAuthorizeRequestScope(requestedScope || scope, scope);
    let normalizedResource = "";
    try {
      scope = resolveRequestedOAuthScope(client, requestedScope);
      authorizeScope = normalizeAuthorizeRequestScope(requestedScope || scope, scope);
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
      normalizedResource = assertSupportedOauthResource(req, resource);
      if (resource && !normalizedResource) {
        redirectWithOAuthResult(res, redirectUri, {
          error: "invalid_target",
          error_description: "Unsupported resource",
          state,
        });
        return;
      }
    } catch (error) {
      const authorizeAction = buildAuthorizeAction(authorizePath, {
        clientId,
        redirectUri,
        state,
        responseType,
        codeChallenge,
        codeChallengeMethod,
        scope: authorizeScope,
        resource,
        shopDomain: requestedShopDomain,
      });
      if (error instanceof Error && error.message === "Unsupported resource for this authorization server") {
        redirectWithOAuthResult(res, redirectUri, {
          error: "invalid_target",
          error_description: "Unsupported resource",
          state,
        });
        return;
      }
      res.writeHead(400, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      res.end(
        renderOAuthAuthorizePage({
          error: error instanceof Error ? error.message : String(error),
          clientName: client.clientName,
          clientId,
          authorizeAction,
          redirectUri,
          state,
          responseType,
          codeChallenge,
          codeChallengeMethod,
          scope: authorizeScope,
          resource,
        })
      );
      return;
    }

    const authorizeAction = buildAuthorizeAction(authorizePath, {
      clientId,
      redirectUri,
      state,
      responseType,
      codeChallenge,
      codeChallengeMethod,
      scope: authorizeScope,
      resource: normalizedResource || resource,
      shopDomain: requestedShopDomain,
    });
    const accountSession = resolveAccountSession(req);
    if (!accountSession.account) {
      const next = safeRedirectPath(authorizeAction, "/onboarding");
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
        authorizeAction,
        redirectUri,
        state,
        responseType,
        codeChallenge,
        codeChallengeMethod,
        scope: authorizeScope,
        resource: normalizedResource || resource,
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
      const requestUrl = new URL(req.url || "/oauth/authorize", "http://localhost");
      const queryParams = requestUrl.searchParams;
      const payload = await readJsonOrFormBody(req, readBody);
      const readBodyParam = (field) =>
        typeof payload[field] === "string" && payload[field].trim() ? payload[field].trim() : "";
      const readQueryParam = (field) => {
        const value = queryParams.get(field);
        return typeof value === "string" && value.trim() ? value.trim() : "";
      };
      const readRequestParam = (field, fallback = "", { enforceMatch = false } = {}) => {
        const bodyValue = readBodyParam(field);
        const queryValue = readQueryParam(field);
        if (enforceMatch && bodyValue && queryValue && bodyValue !== queryValue) {
          throw new Error(`${field} mismatch between authorize query and form body`);
        }
        if (bodyValue) {
          return bodyValue;
        }
        if (queryValue) {
          return queryValue;
        }
        return fallback;
      };
      const clientId = readRequestParam("client_id", "", { enforceMatch: true });
      const redirectUri = readRequestParam("redirect_uri", "", { enforceMatch: true });
      const state = readRequestParam("state", "", { enforceMatch: true });
      const responseType =
        readRequestParam("response_type", "code", { enforceMatch: true }) || "code";
      const codeChallenge = readRequestParam("code_challenge", "", { enforceMatch: true });
      const codeChallengeMethod = readRequestParam("code_challenge_method", "S256", { enforceMatch: true }) || "S256";
      const requestedScopeBody = readBodyParam("scope");
      const requestedScopeQuery = readQueryParam("scope");
      const resource = readRequestParam("resource", "", { enforceMatch: true });
      const decision =
        typeof payload.decision === "string" && payload.decision.trim()
          ? payload.decision.trim()
          : typeof queryParams.get("decision") === "string" && queryParams.get("decision").trim()
          ? queryParams.get("decision").trim()
          : "deny";
      const authorizePath = requestUrl.pathname || "/oauth/authorize";
      const requestedShopDomain = readRequestParam("shopDomain");

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
      const clientScope = resolveOAuthClientScope(client);
      const normalizedBodyScope = requestedScopeBody
        ? normalizeAuthorizeRequestScope(requestedScopeBody, clientScope)
        : "";
      const normalizedQueryScope = requestedScopeQuery
        ? normalizeAuthorizeRequestScope(requestedScopeQuery, clientScope)
        : "";
      if (normalizedBodyScope && normalizedQueryScope && normalizedBodyScope !== normalizedQueryScope) {
        throw new Error("scope mismatch between authorize query and form body");
      }
      const requestedScope = normalizedBodyScope || normalizedQueryScope || "";
      const scope = resolveRequestedOAuthScope(client, requestedScope);
      const authorizeScope = normalizeAuthorizeRequestScope(requestedScope || scope, clientScope);
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
      const normalizedResource = assertSupportedOauthResource(req, resource);
      if (resource && !normalizedResource) {
        redirectWithOAuthResult(res, redirectUri, {
          error: "invalid_target",
          error_description: "Unsupported resource",
          state,
        });
        return;
      }
      const authorizeAction = buildAuthorizeAction(authorizePath, {
        clientId,
        redirectUri,
        state,
        responseType,
        codeChallenge,
        codeChallengeMethod,
        scope: authorizeScope,
        resource: normalizedResource || resource,
        shopDomain: requestedShopDomain,
      });

      const accountSession = resolveAccountSession(req);
      if (!accountSession.account) {
        const nextParams = new URLSearchParams();
        nextParams.set("client_id", clientId);
        nextParams.set("redirect_uri", redirectUri);
        nextParams.set("state", state);
        nextParams.set("response_type", responseType);
        nextParams.set("code_challenge", codeChallenge);
        nextParams.set("code_challenge_method", codeChallengeMethod);
        nextParams.set("scope", authorizeScope);
        if (resource) {
          nextParams.set("resource", normalizedResource || resource);
        }
        if (requestedShopDomain) {
          nextParams.set("shopDomain", requestedShopDomain);
        }
        const next = safeRedirectPath(
          `${authorizePath}?${nextParams.toString()}`,
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
        renderScope: authorizeScope,
        decision,
        licenseKey,
        shopDomain: requestedShopDomain,
        targetResource: normalizedResource || "",
        authorizePath: authorizeAction,
      });
    } catch (error) {
      if (error instanceof Error && error.message === "Unsupported resource for this authorization server") {
        return oauthJsonError(res, 400, "invalid_target", "Unsupported resource", json);
      }
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
          const requestedScope =
            typeof payload.scope === "string" && payload.scope.trim()
              ? assertSupportedOauthScope(payload.scope, codeRecord.scope || resolveOAuthClientScope(client))
              : null;
          const effectiveScope = codeRecord.scope || resolveOAuthClientScope(client);
          if (requestedScope && !haveEquivalentOauthScopeAccess(requestedScope, effectiveScope, effectiveScope)) {
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
          const rawRequestedResource =
            typeof payload.resource === "string" && payload.resource.trim() ? payload.resource.trim() : "";
          let requestedResource = "";
          try {
            requestedResource = rawRequestedResource ? assertSupportedOauthResource(req, rawRequestedResource) : "";
          } catch (error) {
            if (error instanceof Error && error.message === "Unsupported resource for this authorization server") {
              return oauthJsonError(res, 400, "invalid_target", "Unsupported resource", json);
            }
            throw error;
          }
          const effectiveTargetResource = normalizeBaseUrl(codeRecord.targetResource || "") || "";
          if (requestedResource && effectiveTargetResource && requestedResource !== effectiveTargetResource) {
            return oauthJsonError(
              res,
              400,
              "invalid_target",
              "resource must match the previously granted resource",
              json
            );
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
            scope: effectiveScope,
            targetResource: effectiveTargetResource || requestedResource || "",
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
            scope: effectiveScope,
            targetResource: effectiveTargetResource || requestedResource || "",
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
            scope: effectiveScope,
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

        const effectiveScope = assertSupportedOauthScope(refreshRecord.scope || MCP_SCOPE_TOOLS, MCP_SCOPE_TOOLS);
        const requestedScope =
          typeof payload.scope === "string" && payload.scope.trim()
            ? assertSupportedOauthScope(payload.scope, effectiveScope)
            : null;
        if (requestedScope && !haveEquivalentOauthScopeAccess(requestedScope, effectiveScope, effectiveScope)) {
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
        const rawRequestedResource =
          typeof payload.resource === "string" && payload.resource.trim() ? payload.resource.trim() : "";
        let requestedResource = "";
        try {
          requestedResource = rawRequestedResource ? assertSupportedOauthResource(req, rawRequestedResource) : "";
        } catch (error) {
          if (error instanceof Error && error.message === "Unsupported resource for this authorization server") {
            return oauthJsonError(res, 400, "invalid_target", "Unsupported resource", json);
          }
          throw error;
        }
        const effectiveTargetResource = normalizeBaseUrl(refreshRecord.targetResource || "") || "";
        if (requestedResource && effectiveTargetResource && requestedResource !== effectiveTargetResource) {
          return oauthJsonError(
            res,
            400,
            "invalid_target",
            "resource must match the previously granted resource",
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
          scope: effectiveScope,
          targetResource: effectiveTargetResource || requestedResource || "",
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
          targetResource: effectiveTargetResource || requestedResource || "",
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
