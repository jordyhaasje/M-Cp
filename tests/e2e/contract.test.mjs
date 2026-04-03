import assert from "assert";
import fs from "fs/promises";
import net from "net";
import os from "os";
import path from "path";
import { pathToFileURL } from "url";

async function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = address && typeof address === "object" ? address.port : null;
      server.close(() => {
        if (port) {
          resolve(port);
          return;
        }
        reject(new Error("Could not resolve free port"));
      });
    });
    server.on("error", reject);
  });
}

async function waitFor(url, timeoutMs = 10000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      // keep retrying
    }
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

function extractCookie(response) {
  const setCookie = response.headers.get("set-cookie");
  if (!setCookie) {
    return "";
  }
  return setCookie.split(";")[0] || "";
}

const repoRoot = process.cwd();
const licenseModulePath = path.resolve(repoRoot, "apps/hazify-license-service/src/server.js");
const mcpModulePath = path.resolve(repoRoot, "apps/hazify-mcp-remote/src/index.js");

const licensePort = await getFreePort();
const mcpPort = await getFreePort();
const licenseBaseUrl = `http://127.0.0.1:${licensePort}`;
const mcpBaseUrl = `http://127.0.0.1:${mcpPort}`;
const tempDbPath = path.join(
  os.tmpdir(),
  `hazify-contract-e2e-${Date.now()}-${Math.random().toString(16).slice(2)}.json`
);

const previousEnv = {
  NODE_ENV: process.env.NODE_ENV,
  PORT: process.env.PORT,
  LICENSE_DB_PATH: process.env.LICENSE_DB_PATH,
  HAZIFY_FREE_MODE: process.env.HAZIFY_FREE_MODE,
  ADMIN_API_KEY: process.env.ADMIN_API_KEY,
  MCP_API_KEY: process.env.MCP_API_KEY,
  PUBLIC_BASE_URL: process.env.PUBLIC_BASE_URL,
  MCP_PUBLIC_URL: process.env.MCP_PUBLIC_URL,
  MAX_BODY_BYTES: process.env.MAX_BODY_BYTES,
  HAZIFY_MCP_TRANSPORT: process.env.HAZIFY_MCP_TRANSPORT,
  HAZIFY_MCP_HTTP_HOST: process.env.HAZIFY_MCP_HTTP_HOST,
  HAZIFY_MCP_HTTP_PORT: process.env.HAZIFY_MCP_HTTP_PORT,
  HAZIFY_MCP_INTROSPECTION_URL: process.env.HAZIFY_MCP_INTROSPECTION_URL,
  HAZIFY_MCP_API_KEY: process.env.HAZIFY_MCP_API_KEY,
  HAZIFY_MCP_PUBLIC_URL: process.env.HAZIFY_MCP_PUBLIC_URL,
  HAZIFY_MCP_AUTH_SERVER_URL: process.env.HAZIFY_MCP_AUTH_SERVER_URL,
  HAZIFY_MCP_ALLOWED_ORIGINS: process.env.HAZIFY_MCP_ALLOWED_ORIGINS,
  MCP_SESSION_MODE: process.env.MCP_SESSION_MODE,
};

const originalFetch = global.fetch;
let scopeMode = "missing";

global.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === "string" ? input : input.url);
  if (
    url.protocol === "https:" &&
    url.hostname.endsWith(".myshopify.com") &&
    url.pathname === "/admin/oauth/access_scopes.json"
  ) {
    const baseScopes = [
      "read_products",
      "write_products",
      "read_customers",
      "write_customers",
      "read_orders",
      "write_orders",
      "read_fulfillments",
      "read_inventory",
      "write_merchant_managed_fulfillment_orders",
    ];

    const scopes =
      scopeMode === "missing"
        ? baseScopes
        : [...baseScopes, "read_themes", "write_themes"];

    return new Response(
      JSON.stringify({
        access_scopes: scopes.map((handle) => ({ handle })),
      }),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      }
    );
  }

  return originalFetch(input, init);
};

let licenseServer;
let mcpServer;

try {
  process.env.NODE_ENV = "test";

  process.env.PORT = String(licensePort);
  process.env.LICENSE_DB_PATH = tempDbPath;
  process.env.HAZIFY_FREE_MODE = "true";
  process.env.ADMIN_API_KEY = "admin-e2e-key";
  process.env.MCP_API_KEY = "mcp-e2e-key";
  process.env.PUBLIC_BASE_URL = licenseBaseUrl;
  process.env.MCP_PUBLIC_URL = `${mcpBaseUrl}/mcp`;
  process.env.MAX_BODY_BYTES = "1048576";

  const licenseModule = await import(`${pathToFileURL(licenseModulePath).href}?contract=${Date.now()}`);
  licenseServer = licenseModule.server;

  await waitFor(`${licenseBaseUrl}/health`);

  process.env.HAZIFY_MCP_TRANSPORT = "http";
  process.env.HAZIFY_MCP_HTTP_HOST = "127.0.0.1";
  process.env.PORT = String(mcpPort);
  process.env.HAZIFY_MCP_HTTP_PORT = String(mcpPort);
  process.env.HAZIFY_MCP_INTROSPECTION_URL = licenseBaseUrl;
  process.env.HAZIFY_MCP_API_KEY = "mcp-e2e-key";
  process.env.HAZIFY_MCP_PUBLIC_URL = `${mcpBaseUrl}/mcp`;
  process.env.HAZIFY_MCP_AUTH_SERVER_URL = licenseBaseUrl;
  process.env.HAZIFY_MCP_ALLOWED_ORIGINS = `${mcpBaseUrl}`;
  process.env.MCP_SESSION_MODE = "stateless";

  const mcpModule = await import(`${pathToFileURL(mcpModulePath).href}?contract=${Date.now()}`);
  mcpServer = mcpModule.httpServer;

  await waitFor(`${mcpBaseUrl}/.well-known/oauth-protected-resource`);

  const protectedResourceResponse = await fetch(`${mcpBaseUrl}/.well-known/oauth-protected-resource`);
  assert.equal(protectedResourceResponse.status, 200, "protected resource metadata should be reachable");
  const protectedResourceMetadata = await protectedResourceResponse.json();
  assert.deepEqual(
    protectedResourceMetadata?.scopes_supported,
    ["mcp:tools", "mcp:tools:read", "mcp:tools:write"],
    "protected resource metadata should advertise compat-first scopes"
  );

  const authorizationMetadataResponse = await fetch(`${mcpBaseUrl}/.well-known/oauth-authorization-server`);
  assert.equal(authorizationMetadataResponse.status, 200, "authorization server metadata should be reachable");
  const authorizationMetadata = await authorizationMetadataResponse.json();
  assert.deepEqual(
    authorizationMetadata?.scopes_supported,
    ["mcp:tools", "mcp:tools:read", "mcp:tools:write"],
    "authorization metadata should advertise compat-first scopes"
  );

  const email = `contract-${Date.now()}@example.test`;
  const password = "ContractPass!123";

  const signupResponse = await fetch(`${licenseBaseUrl}/v1/account/signup`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email,
      name: "Contract Tester",
      password,
    }),
  });
  assert.equal(signupResponse.status, 201, "signup should succeed");
  let sessionCookie = extractCookie(signupResponse);
  assert.ok(sessionCookie.includes("hz_user_session="), "signup should set a session cookie");

  const logoutResponse = await fetch(`${licenseBaseUrl}/v1/account/logout`, {
    method: "POST",
    headers: { Cookie: sessionCookie },
  });
  assert.equal(logoutResponse.status, 200, "logout should succeed");

  const loginResponse = await fetch(`${licenseBaseUrl}/v1/account/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  assert.equal(loginResponse.status, 200, "login should succeed");
  sessionCookie = extractCookie(loginResponse);
  assert.ok(sessionCookie.includes("hz_user_session="), "login should set a session cookie");

  const connectMissingScopesResponse = await fetch(`${licenseBaseUrl}/v1/onboarding/connect-shopify`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Cookie: sessionCookie,
    },
    body: JSON.stringify({
      shopDomain: "contract-shop.myshopify.com",
      shopAccessToken: "shpat_contract",
      label: "Contract Store",
    }),
  });
  assert.equal(
    connectMissingScopesResponse.status,
    400,
    "connect-shopify should fail when theme scopes are missing"
  );
  const missingScopesBody = await connectMissingScopesResponse.json();
  assert.match(
    missingScopesBody?.message || "",
    /read_themes|write_themes/,
    "missing theme scopes should be reported"
  );

  scopeMode = "full";
  const connectResponse = await fetch(`${licenseBaseUrl}/v1/onboarding/connect-shopify`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Cookie: sessionCookie,
    },
    body: JSON.stringify({
      shopDomain: "contract-shop.myshopify.com",
      shopAccessToken: "shpat_contract",
      label: "Contract Store",
    }),
  });
  assert.equal(connectResponse.status, 201, "connect-shopify should succeed with required scopes");
  const connectBody = await connectResponse.json();
  const tenantId = connectBody.tenantId;
  assert.ok(tenantId, "connect-shopify should return tenantId");

  const createTokenResponse = await fetch(`${licenseBaseUrl}/v1/dashboard/mcp-token/create`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Cookie: sessionCookie,
    },
    body: JSON.stringify({ tenantId, name: "e2e-contract" }),
  });
  assert.equal(createTokenResponse.status, 201, "mcp token create should succeed");
  const createTokenBody = await createTokenResponse.json();
  const tokenId = createTokenBody?.created?.tokenId;
  const accessToken = createTokenBody?.created?.accessToken;
  assert.ok(tokenId && accessToken, "token create should return tokenId and accessToken");

  const initializePayload = {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-11-05",
      capabilities: {},
      clientInfo: {
        name: "contract-e2e",
        version: "1.0.0",
      },
    },
  };

  const initializeResponse = await fetch(`${mcpBaseUrl}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${accessToken}`,
      origin: mcpBaseUrl,
    },
    body: JSON.stringify(initializePayload),
  });
  assert.equal(initializeResponse.status, 200, "mcp initialize should succeed");
  const sessionId = initializeResponse.headers.get("mcp-session-id");
  assert.equal(sessionId, null, "stateless mode should not return mcp-session-id");

  const toolsListResponse = await fetch(`${mcpBaseUrl}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${accessToken}`,
      origin: mcpBaseUrl,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
      params: {},
    }),
  });
  assert.equal(toolsListResponse.status, 200, "tools/list should succeed");
  const toolsListBody = await toolsListResponse.json();
  assert.ok(Array.isArray(toolsListBody?.result?.tools), "tools/list should return tool array");
  assert.ok(toolsListBody.result.tools.length > 0, "tools/list should include tools");
  const toolNames = toolsListBody.result.tools.map((tool) => String(tool?.name || ""));
  for (const expectedTool of [
    "get-products",
    "prepare-section-from-reference",
    "refund-order",
    "search-theme-files",
    "get-theme-files",
    "draft-theme-artifact",
    "verify-theme-files",
    "list_theme_import_tools",
  ]) {
    assert.equal(
      toolNames.includes(expectedTool),
      true,
      `tools/list should expose '${expectedTool}'`
    );
  }
  const getOrdersTool = toolsListBody.result.tools.find((tool) => tool?.name === "get-orders");
  assert.ok(getOrdersTool?.inputSchema?.properties?.cursor, "get-orders should expose cursor in tools/list");
  const disallowedOriginResponse = await fetch(`${mcpBaseUrl}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${accessToken}`,
      origin: "https://evil.example",
    },
    body: JSON.stringify(initializePayload),
  });
  assert.equal(disallowedOriginResponse.status, 403, "disallowed origin should fail");

  const revokeTokenResponse = await fetch(`${licenseBaseUrl}/v1/dashboard/mcp-token/revoke`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Cookie: sessionCookie,
    },
    body: JSON.stringify({ tokenId, tenantId }),
  });
  assert.equal(revokeTokenResponse.status, 200, "token revoke should succeed");

  const revokedTokenResponse = await fetch(`${mcpBaseUrl}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${accessToken}`,
      origin: mcpBaseUrl,
    },
    body: JSON.stringify(initializePayload),
  });
  assert.equal(revokedTokenResponse.status, 401, "revoked token should be rejected");

  console.log("contract.test.mjs passed");
} finally {
  if (mcpServer && mcpServer.listening) {
    await new Promise((resolve) => mcpServer.close(resolve));
  }
  if (licenseServer && licenseServer.listening) {
    await new Promise((resolve) => licenseServer.close(resolve));
  }

  global.fetch = originalFetch;

  for (const [key, value] of Object.entries(previousEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  await fs.rm(tempDbPath, { force: true });
}
