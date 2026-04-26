import assert from "assert";
import http from "http";
import net from "net";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";

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
        reject(new Error("Failed to determine free port"));
      });
    });
    server.on("error", reject);
  });
}

async function waitFor(url, timeoutMs = 10000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url, {
        method: "GET",
        headers: {
          authorization: "Bearer read-token",
          "mcp-session-id": "missing",
        },
      });
      if (response.status > 0) {
        return;
      }
    } catch {
      // retry
    }
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

const introspectionPort = await getFreePort();
const mcpPort = await getFreePort();
const testDir = path.dirname(fileURLToPath(import.meta.url));
let exchangeCalls = 0;

const introspectionServer = http.createServer(async (req, res) => {
  if (req.method === "POST" && req.url === "/v1/mcp/token/introspect") {
    let raw = "";
    for await (const chunk of req) {
      raw += chunk.toString();
    }
    const payload = raw ? JSON.parse(raw) : {};
    if (payload.token === "entitlement-token") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          active: true,
          tokenId: "mcp_entitlement",
          tenantId: "tenant_scope",
          licenseKey: "HZY-SCOPE",
          scope: "mcp:tools",
          license: {
            status: "active",
            entitlements: { mutations: true, tools: { "set-order-tracking": false } },
          },
          shopify: {
            domain: "unit-test-shop.myshopify.com",
            authMode: "access_token",
          },
        })
      );
      return;
    }
    if (payload.token !== "read-token") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ active: false }));
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        active: true,
        tokenId: "mcp_read_only",
        tenantId: "tenant_scope",
        licenseKey: "HZY-SCOPE",
        scope: "mcp:tools:read",
        license: {
          status: "active",
          entitlements: { mutations: true, tools: {} },
        },
        shopify: {
          domain: "unit-test-shop.myshopify.com",
          authMode: "access_token",
        },
      })
    );
    return;
  }
  if (req.method === "POST" && req.url === "/v1/mcp/token/exchange") {
    exchangeCalls += 1;
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        active: true,
        tokenId: "mcp_read_only",
        tenantId: "tenant_scope",
        shopify: {
          domain: "unit-test-shop.myshopify.com",
          authMode: "access_token",
          accessToken: "shpat_should_not_be_used",
          expiresInSeconds: 3600,
        },
      })
    );
    return;
  }
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "not_found" }));
});

await new Promise((resolve) => introspectionServer.listen(introspectionPort, "127.0.0.1", resolve));

const previousEnv = {
  HAZIFY_MCP_HTTP_HOST: process.env.HAZIFY_MCP_HTTP_HOST,
  PORT: process.env.PORT,
  HAZIFY_MCP_INTROSPECTION_URL: process.env.HAZIFY_MCP_INTROSPECTION_URL,
  HAZIFY_MCP_API_KEY: process.env.HAZIFY_MCP_API_KEY,
  HAZIFY_MCP_PUBLIC_URL: process.env.HAZIFY_MCP_PUBLIC_URL,
  HAZIFY_MCP_ALLOWED_ORIGINS: process.env.HAZIFY_MCP_ALLOWED_ORIGINS,
  MCP_SESSION_MODE: process.env.MCP_SESSION_MODE,
};

process.env.HAZIFY_MCP_HTTP_HOST = "127.0.0.1";
process.env.PORT = String(mcpPort);
process.env.HAZIFY_MCP_INTROSPECTION_URL = `http://127.0.0.1:${introspectionPort}`;
process.env.HAZIFY_MCP_API_KEY = "mcp-scope-key";
process.env.HAZIFY_MCP_PUBLIC_URL = `http://127.0.0.1:${mcpPort}`;
process.env.HAZIFY_MCP_ALLOWED_ORIGINS = `http://127.0.0.1:${mcpPort},null`;
process.env.MCP_SESSION_MODE = "stateless";

const mcpModuleUrl = `${pathToFileURL(path.resolve(testDir, "../src/index.js")).href}?scope=${Date.now()}`;
const mcpModule = await import(mcpModuleUrl);
const mcpServer = mcpModule.httpServer;

  const headers = {
    authorization: "Bearer read-token",
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
  };
  const entitlementHeaders = {
    ...headers,
    authorization: "Bearer entitlement-token",
  };

try {
  await waitFor(`http://127.0.0.1:${mcpPort}/mcp`);

  const initializeResponse = await fetch(`http://127.0.0.1:${mcpPort}/mcp`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-11-05",
        capabilities: {},
        clientInfo: { name: "scope-test", version: "1.0.0" },
      },
    }),
  });
  assert.equal(initializeResponse.status, 200, "initialize should be allowed with read scope");

  const toolsListResponse = await fetch(`http://127.0.0.1:${mcpPort}/mcp`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
      params: {},
    }),
  });
  assert.equal(toolsListResponse.status, 200, "tools/list should be allowed with read scope");

  const deniedMutationResponse = await fetch(`http://127.0.0.1:${mcpPort}/mcp`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "set-order-tracking",
        arguments: {
          order: "#1001",
          trackingCode: "TRACK-READ-ONLY",
        },
      },
    }),
  });
  assert.equal(deniedMutationResponse.status, 403, "write tool should be rejected with read-only scope");
  const deniedAuthHeader = deniedMutationResponse.headers.get("www-authenticate") || "";
  assert.match(deniedAuthHeader, /insufficient_scope/, "WWW-Authenticate should flag insufficient_scope");
  assert.match(deniedAuthHeader, /mcp:tools:write/, "WWW-Authenticate should advertise required write scope");
  assert.equal(exchangeCalls, 0, "scope enforcement should happen before Shopify token exchange");

  const deniedAliasEntitlementResponse = await fetch(`http://127.0.0.1:${mcpPort}/mcp`, {
    method: "POST",
    headers: entitlementHeaders,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: {
        name: "add-tracking-to-order",
        arguments: {
          order: "#1001",
          trackingCode: "TRACK-CANONICAL-BLOCK",
        },
      },
    }),
  });
  assert.ok(
    [200, 500].includes(deniedAliasEntitlementResponse.status),
    "alias tool should return a JSON-RPC/tool error when its canonical tool entitlement is disabled"
  );
  const deniedAliasEntitlementBody = await deniedAliasEntitlementResponse.json();
  assert.match(
    deniedAliasEntitlementBody?.error?.message ||
      deniedAliasEntitlementBody?.result?.content?.map?.((entry) => entry?.text).join(" ") ||
      "",
    /set-order-tracking.*disabled by license entitlements/i,
    "canonical entitlement failure should mention the disabled canonical tool"
  );
  assert.equal(exchangeCalls, 0, "canonical entitlement enforcement should happen before Shopify token exchange");
} finally {
  await new Promise((resolve) => introspectionServer.close(resolve));
  await new Promise((resolve) => mcpServer.close(resolve));

  for (const [key, value] of Object.entries(previousEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}
