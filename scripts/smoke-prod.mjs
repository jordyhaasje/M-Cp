import path from "path";
import { fileURLToPath } from "url";

const DEFAULT_LICENSE_BASE_URL =
  "https://hazify-license-service-production.up.railway.app";
const DEFAULT_MCP_BASE_URL = "https://hazify-mcp-remote-production.up.railway.app";

function toUrl(baseUrl, pathname) {
  return new URL(pathname, baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`).toString();
}

async function expectStatus({ fetchImpl = fetch, method = "GET", url, expectedStatus, expectedStatuses, headers, body }) {
  const response = await fetchImpl(url, { method, headers, body });
  const status = response.status;
  const allowedStatuses = Array.isArray(expectedStatuses)
    ? expectedStatuses
    : [expectedStatus];
  if (!allowedStatuses.includes(status)) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `${method} ${url} returned ${status}, expected ${allowedStatuses.join(" or ")}. Body: ${text.slice(0, 300)}`
    );
  }
  console.log(`${method} ${url} -> ${status}`);
  return response;
}

function hasAnyConfiguredValue(values) {
  return values.some((value) => typeof value === "string" && value.trim());
}

function firstConfiguredValue(values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

async function readJsonResponse(response, label) {
  const text = await response.text().catch(() => "");
  if (!text.trim()) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${label} returned non-JSON body: ${text.slice(0, 300)}`);
  }
}

async function callMcpJsonRpc({
  fetchImpl,
  mcpBaseUrl,
  token,
  id,
  method,
  params = {},
  label = method,
  origin = null,
  sessionId = null,
  expectedStatuses = [200],
}) {
  const headers = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    authorization: `Bearer ${token}`,
  };
  if (origin) {
    headers.origin = origin;
  }
  if (sessionId) {
    headers["mcp-session-id"] = sessionId;
  }

  const response = await fetchImpl(toUrl(mcpBaseUrl, "/mcp"), {
    method: "POST",
    headers,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id,
      method,
      params,
    }),
  });

  const body = await readJsonResponse(response, label);
  if (!expectedStatuses.includes(response.status)) {
    throw new Error(`${label} returned ${response.status}, expected ${expectedStatuses.join(" or ")}. Body: ${JSON.stringify(body)}`);
  }
  return { body, response };
}

function assertJsonRpcResult(callResult, label) {
  const body = callResult?.body || callResult;
  if (!body || typeof body !== "object" || !body.result) {
    throw new Error(`${label} did not return a JSON-RPC result. Body: ${JSON.stringify(body)}`);
  }
  if (body.result.isError) {
    throw new Error(`${label} returned tool-level error: ${JSON.stringify(body.result.content || body.result)}`);
  }
  return body.result;
}

function assertJsonRpcError(callResult, label, pattern) {
  const body = callResult?.body || callResult;
  const message = String(body?.error?.message || body?.result?.content?.[0]?.text || "");
  if (!pattern.test(message)) {
    throw new Error(`${label} did not return expected error ${pattern}. Body: ${JSON.stringify(body)}`);
  }
}

async function runAuthenticatedMcpSmoke({ fetchImpl, env, mcpBaseUrl }) {
  const authToken = firstConfiguredValue([
    env.HAZIFY_MCP_SMOKE_TOKEN,
    env.HAZIFY_PROD_MCP_TOKEN,
    env.MCP_SMOKE_TOKEN,
  ]);
  const readOnlyGateToken = firstConfiguredValue([
    env.HAZIFY_MCP_SMOKE_READ_ONLY_TOKEN,
    env.HAZIFY_PROD_MCP_READ_ONLY_TOKEN,
    env.MCP_SMOKE_READ_ONLY_TOKEN,
    env.HAZIFY_MCP_SMOKE_EXPECT_WRITE_DENIED === "true" ? authToken : "",
  ]);
  const requireAuthenticatedSmoke =
    env.HAZIFY_REQUIRE_AUTHENTICATED_MCP_SMOKE === "true" ||
    env.MCP_SMOKE_REQUIRE_AUTH === "true";
  const requireWriteScopeGate =
    env.HAZIFY_REQUIRE_WRITE_SCOPE_GATE === "true" ||
    env.MCP_SMOKE_REQUIRE_WRITE_SCOPE_GATE === "true";
  const smokeOrigin = firstConfiguredValue([
    env.HAZIFY_MCP_SMOKE_ORIGIN,
    env.MCP_SMOKE_ORIGIN,
  ]);

  if (!authToken) {
    if (requireAuthenticatedSmoke) {
      throw new Error(
        "Authenticated MCP smoke is required, but no HAZIFY_MCP_SMOKE_TOKEN/MCP_SMOKE_TOKEN is configured."
      );
    }
    console.log(
      "Skipping authenticated MCP smoke -> HAZIFY_MCP_SMOKE_TOKEN not configured."
    );
    return;
  }

  const initializeCall = await callMcpJsonRpc({
      fetchImpl,
      mcpBaseUrl,
      token: authToken,
      id: 101,
      method: "initialize",
      params: {
        protocolVersion: "2025-11-05",
        capabilities: {},
        clientInfo: { name: "hazify-authenticated-smoke", version: "1.0.0" },
      },
      origin: smokeOrigin,
      label: "authenticated initialize",
    });
  const initializeResult = assertJsonRpcResult(
    initializeCall,
    "authenticated initialize"
  );
  if (!initializeResult.protocolVersion) {
    throw new Error("authenticated initialize did not return a protocolVersion.");
  }
  const mcpSessionId =
    initializeCall.response?.headers?.get?.("mcp-session-id") ||
    initializeCall.response?.headers?.get?.("Mcp-Session-Id") ||
    null;
  console.log("POST /mcp authenticated initialize -> 200");

  const toolsResult = assertJsonRpcResult(
    await callMcpJsonRpc({
      fetchImpl,
      mcpBaseUrl,
      token: authToken,
      id: 102,
      method: "tools/list",
      label: "authenticated tools/list",
      origin: smokeOrigin,
      sessionId: mcpSessionId,
    }),
    "authenticated tools/list"
  );
  const toolNames = new Set((toolsResult.tools || []).map((tool) => String(tool?.name || "")));
  for (const requiredTool of [
    "get-license-status",
    "get-themes",
    "search-theme-files",
    "draft-theme-artifact",
    "apply-theme-draft",
  ]) {
    if (!toolNames.has(requiredTool)) {
      throw new Error(`authenticated tools/list is missing '${requiredTool}'.`);
    }
  }
  console.log(`POST /mcp authenticated tools/list -> ${toolNames.size} tools`);

  const statusResult = assertJsonRpcResult(
    await callMcpJsonRpc({
      fetchImpl,
      mcpBaseUrl,
      token: authToken,
      id: 103,
      method: "tools/call",
      params: {
        name: "get-license-status",
        arguments: {},
      },
      label: "authenticated get-license-status",
      origin: smokeOrigin,
      sessionId: mcpSessionId,
    }),
    "authenticated get-license-status"
  );
  if (!statusResult.structuredContent?.tenant?.shopDomain) {
    throw new Error("authenticated get-license-status did not return tenant shopDomain.");
  }
  console.log("POST /mcp authenticated get-license-status -> 200");

  if (!readOnlyGateToken) {
    if (requireWriteScopeGate) {
      throw new Error(
        "Authenticated write-scope gate smoke is required, but no read-only smoke token is configured."
      );
    }
    console.log(
      "Skipping authenticated write-scope gate smoke -> HAZIFY_MCP_SMOKE_READ_ONLY_TOKEN not configured."
    );
    return;
  }

  const writeGateCall = await callMcpJsonRpc({
    fetchImpl,
    mcpBaseUrl,
    token: readOnlyGateToken,
    id: 104,
    method: "tools/call",
    params: {
      name: "set-order-tracking",
      arguments: {
        order: "#0",
        trackingCode: "HAZIFY-SMOKE-NOOP",
        notifyCustomer: false,
        },
      },
      label: "authenticated write-scope gate",
      origin: smokeOrigin,
      sessionId: mcpSessionId,
      expectedStatuses: [200, 403],
    });
  assertJsonRpcError(writeGateCall, "authenticated write-scope gate", /requires write scope|insufficient_scope/i);
  console.log("POST /mcp authenticated write-scope gate -> denied before mutation");
}

export async function runSmokeChecks({
  fetchImpl = fetch,
  env = process.env,
} = {}) {
  const licenseBaseUrl = env.HAZIFY_LICENSE_BASE_URL || DEFAULT_LICENSE_BASE_URL;
  const mcpBaseUrl = env.HAZIFY_MCP_BASE_URL || DEFAULT_MCP_BASE_URL;
  const initializePayload = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "hazify-smoke", version: "1.0.0" },
    },
  });

  await expectStatus({
    fetchImpl,
    url: toUrl(licenseBaseUrl, "/health"),
    expectedStatus: 200,
  });

  await expectStatus({
    fetchImpl,
    url: toUrl(licenseBaseUrl, "/ready"),
    expectedStatus: 200,
  });

  await expectStatus({
    fetchImpl,
    url: toUrl(licenseBaseUrl, "/v1/session/bootstrap"),
    expectedStatus: 200,
  });

  if (typeof env.ADMIN_API_KEY === "string" && env.ADMIN_API_KEY.trim()) {
    await expectStatus({
      fetchImpl,
      url: toUrl(licenseBaseUrl, "/v1/admin/readiness"),
      expectedStatus: 200,
      headers: {
        "x-admin-api-key": env.ADMIN_API_KEY.trim(),
      },
    });
  } else {
    console.log("Skipping /v1/admin/readiness -> ADMIN_API_KEY not configured.");
  }

  if (
    hasAnyConfiguredValue([
      env.STRIPE_SECRET_KEY,
      env.STRIPE_WEBHOOK_SECRET,
      env.STRIPE_DEFAULT_PRICE_ID,
      env.STRIPE_MONTHLY_PRICE_ID,
      env.STRIPE_YEARLY_PRICE_ID,
      env.STRIPE_MONTHLY_PAYMENT_LINK,
      env.STRIPE_YEARLY_PAYMENT_LINK,
      env.CHECKOUT_SUCCESS_URL,
      env.CHECKOUT_CANCEL_URL,
      env.PORTAL_RETURN_URL,
    ])
  ) {
    await expectStatus({
      fetchImpl,
      url: toUrl(licenseBaseUrl, "/v1/billing/readiness"),
      expectedStatus: 200,
    });
  } else {
    console.log(
      "Skipping /v1/billing/readiness -> billing envs not configured."
    );
  }

  await expectStatus({
    fetchImpl,
    url: toUrl(mcpBaseUrl, "/.well-known/oauth-protected-resource"),
    expectedStatus: 200,
  });

  await expectStatus({
    fetchImpl,
    url: toUrl(mcpBaseUrl, "/.well-known/oauth-authorization-server"),
    expectedStatus: 200,
  });

  await expectStatus({
    fetchImpl,
    method: "POST",
    url: toUrl(mcpBaseUrl, "/mcp"),
    expectedStatus: 401,
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: initializePayload,
  });

  console.log(
    "Anonymous /mcp check passed."
  );

  await runAuthenticatedMcpSmoke({ fetchImpl, env, mcpBaseUrl });

  console.log("Production smoke checks passed.");
}

function isExecutedDirectly() {
  const entryPath = process.argv[1];
  if (!entryPath) {
    return false;
  }
  return path.resolve(entryPath) === path.resolve(fileURLToPath(import.meta.url));
}

if (isExecutedDirectly()) {
  await runSmokeChecks();
}
