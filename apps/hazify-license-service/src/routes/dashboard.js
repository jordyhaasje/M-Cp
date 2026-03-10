export function createDashboardHandlers({
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
}) {
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
      return json(res, 200, buildDashboardPayload(req, resolved.account, resolved.session, tenantId));
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

  async function handleDashboardRevokeOAuthConnection(req, res) {
    if (!applyRateLimit(req, res)) {
      return;
    }
    const resolved = await requireAccountSession(req, res);
    if (!resolved) {
      return;
    }
    try {
      const { json: payload } = await readBody(req);
      const connectionKey =
        typeof payload?.connectionKey === "string" && payload.connectionKey.trim()
          ? payload.connectionKey.trim()
          : "";
      if (!connectionKey) {
        throw new Error("connectionKey is required");
      }
      const tenant = resolveTenantForAccount(resolved.account, payload?.tenantId || "");
      if (!tenant) {
        return json(res, 404, { error: "tenant_not_found" });
      }

      const now = nowIso();
      const affectedClientIds = new Set();
      if (connectionKey.startsWith("client:")) {
        const keyClientId = connectionKey.slice("client:".length).trim();
        if (keyClientId) {
          affectedClientIds.add(keyClientId);
        }
      }
      let revokedRefreshTokenCount = 0;
      for (const refreshRecord of Object.values(db.oauthRefreshTokens)) {
        if (!refreshRecord || refreshRecord.tenantId !== tenant.tenantId || refreshRecord.status !== "active") {
          continue;
        }
        if (oauthConnectionKeyFromRefreshRecord(refreshRecord) !== connectionKey) {
          continue;
        }
        refreshRecord.status = "revoked";
        refreshRecord.updatedAt = now;
        revokedRefreshTokenCount += 1;
        if (typeof refreshRecord.clientId === "string" && refreshRecord.clientId.trim()) {
          affectedClientIds.add(refreshRecord.clientId.trim());
        }
      }
      if (!revokedRefreshTokenCount) {
        return json(res, 404, { error: "connection_not_found" });
      }

      const candidateTokenNames = new Set();
      for (const clientId of affectedClientIds) {
        candidateTokenNames.add(`oauth:${clientId}`);
        const oauthClient = db.oauthClients[clientId];
        if (oauthClient?.clientName) {
          candidateTokenNames.add(`oauth:${oauthClient.clientName}`);
        }
      }
      let revokedAccessTokenCount = 0;
      if (candidateTokenNames.size > 0) {
        for (const tokenRecord of Object.values(db.mcpTokens)) {
          if (!tokenRecord || tokenRecord.tenantId !== tenant.tenantId || tokenRecord.status !== "active") {
            continue;
          }
          if (!candidateTokenNames.has(tokenRecord.name || "")) {
            continue;
          }
          tokenRecord.status = "revoked";
          tokenRecord.updatedAt = now;
          revokedAccessTokenCount += 1;
        }
      }

      await persistDb();
      return json(res, 200, {
        ok: true,
        tenantId: tenant.tenantId,
        connectionKey,
        revokedRefreshTokenCount,
        revokedAccessTokenCount,
        dashboard: buildDashboardPayload(req, resolved.account, resolved.session, tenant.tenantId),
      });
    } catch (error) {
      return json(res, 400, {
        error: "bad_request",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async function handleDashboardDeleteTenant(req, res) {
    if (!applyRateLimit(req, res)) {
      return;
    }
    const resolved = await requireAccountSession(req, res);
    if (!resolved) {
      return;
    }
    try {
      const { json: payload } = await readBody(req);
      const tenantId =
        typeof payload?.tenantId === "string" && payload.tenantId.trim() ? payload.tenantId.trim() : "";
      if (!tenantId) {
        throw new Error("tenantId is required");
      }
      const tenant = db.tenants[tenantId];
      if (!tenant || tenant.licenseKey !== resolved.account.licenseKey) {
        return json(res, 404, { error: "tenant_not_found" });
      }

      let deletedMcpTokenCount = 0;
      for (const tokenId of Object.keys(db.mcpTokens)) {
        const tokenRecord = db.mcpTokens[tokenId];
        if (!tokenRecord || tokenRecord.tenantId !== tenantId) {
          continue;
        }
        delete db.mcpTokens[tokenId];
        deletedMcpTokenCount += 1;
      }

      let deletedOAuthRefreshTokenCount = 0;
      for (const refreshTokenId of Object.keys(db.oauthRefreshTokens)) {
        const refreshRecord = db.oauthRefreshTokens[refreshTokenId];
        if (!refreshRecord || refreshRecord.tenantId !== tenantId) {
          continue;
        }
        delete db.oauthRefreshTokens[refreshTokenId];
        deletedOAuthRefreshTokenCount += 1;
      }

      let deletedOAuthAuthCodeCount = 0;
      for (const code of Object.keys(db.oauthAuthCodes)) {
        const authCode = db.oauthAuthCodes[code];
        if (!authCode || authCode.tenantId !== tenantId) {
          continue;
        }
        delete db.oauthAuthCodes[code];
        deletedOAuthAuthCodeCount += 1;
      }

      delete db.tenants[tenantId];
      const nextTenantId = listTenantsForAccount(resolved.account)[0]?.tenantId || "";
      await persistDb();

      return json(res, 200, {
        ok: true,
        deletedTenantId: tenantId,
        deletedMcpTokenCount,
        deletedOAuthRefreshTokenCount,
        deletedOAuthAuthCodeCount,
        dashboard: buildDashboardPayload(req, resolved.account, resolved.session, nextTenantId),
      });
    } catch (error) {
      return json(res, 400, {
        error: "bad_request",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    handleDashboardState,
    handleDashboardCreateMcpToken,
    handleDashboardRevokeMcpToken,
    handleDashboardRevokeOAuthConnection,
    handleDashboardDeleteTenant,
  };
}
