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
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(url, {
        method: "GET",
        headers: {
          authorization: "Bearer valid-token",
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

const introspectionServer = http.createServer(async (req, res) => {
  if (req.method === "POST" && req.url === "/v1/mcp/token/introspect") {
    let raw = "";
    for await (const chunk of req) {
      raw += chunk.toString();
    }
    const payload = raw ? JSON.parse(raw) : {};
    const token = payload.token;
    if (token !== "valid-token") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ active: false }));
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        active: true,
        tokenId: "mcp_test_token",
        tenantId: "tenant_test",
        licenseKey: "HZY-TEST",
        license: {
          status: "active",
          entitlements: { mutations: true, tools: {} },
        },
        shopify: {
          domain: "unit-test-shop.myshopify.com",
          authMode: "access_token",
          accessToken: "shpat_test",
          clientId: null,
          clientSecret: null,
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
  HAZIFY_MCP_TRANSPORT: process.env.HAZIFY_MCP_TRANSPORT,
  HAZIFY_MCP_HTTP_HOST: process.env.HAZIFY_MCP_HTTP_HOST,
  PORT: process.env.PORT,
  HAZIFY_MCP_INTROSPECTION_URL: process.env.HAZIFY_MCP_INTROSPECTION_URL,
  HAZIFY_MCP_API_KEY: process.env.HAZIFY_MCP_API_KEY,
  HAZIFY_MCP_PUBLIC_URL: process.env.HAZIFY_MCP_PUBLIC_URL,
};

process.env.HAZIFY_MCP_TRANSPORT = "http";
process.env.HAZIFY_MCP_HTTP_HOST = "127.0.0.1";
process.env.PORT = String(mcpPort);
process.env.HAZIFY_MCP_INTROSPECTION_URL = `http://127.0.0.1:${introspectionPort}`;
process.env.HAZIFY_MCP_API_KEY = "mcp-test-key";
process.env.HAZIFY_MCP_PUBLIC_URL = `http://127.0.0.1:${mcpPort}`;

const mcpModuleUrl = `${pathToFileURL(path.resolve(testDir, "../src/index.js")).href}?test=${Date.now()}`;
const mcpModule = await import(mcpModuleUrl);
const mcpServer = mcpModule.httpServer;

const initializeBody = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-11-05",
    capabilities: {},
    clientInfo: {
      name: "mcp-auth-test",
      version: "1.0.0",
    },
  },
};

try {
  await waitFor(`http://127.0.0.1:${mcpPort}/mcp`);

  const missingTokenResponse = await fetch(`http://127.0.0.1:${mcpPort}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify(initializeBody),
  });
  assert.equal(missingTokenResponse.status, 401, "missing token should be unauthorized");
  const missingTokenAuthHeader = missingTokenResponse.headers.get("www-authenticate") || "";
  assert.match(missingTokenAuthHeader, /resource_metadata=/, "WWW-Authenticate should expose resource metadata");

  const rawAuthResponse = await fetch(`http://127.0.0.1:${mcpPort}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: "valid-token",
    },
    body: JSON.stringify(initializeBody),
  });
  assert.equal(rawAuthResponse.status, 401, "non-Bearer authorization should be rejected");

  const queryTokenResponse = await fetch(`http://127.0.0.1:${mcpPort}/mcp?token=valid-token`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify(initializeBody),
  });
  assert.equal(queryTokenResponse.status, 401, "query token should be rejected");

  const disallowedOriginResponse = await fetch(`http://127.0.0.1:${mcpPort}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: "Bearer valid-token",
      origin: "https://evil.example",
    },
    body: JSON.stringify(initializeBody),
  });
  assert.equal(disallowedOriginResponse.status, 403, "disallowed origin should be blocked");

  const allowedOriginResponse = await fetch(`http://127.0.0.1:${mcpPort}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: "Bearer valid-token",
      origin: `http://127.0.0.1:${mcpPort}`,
    },
    body: JSON.stringify(initializeBody),
  });
  assert.equal(allowedOriginResponse.status, 200, "matching origin should be accepted");
  const sessionId = allowedOriginResponse.headers.get("mcp-session-id");
  assert.ok(sessionId, "initialize should return mcp-session-id");

  const toolsListResponse = await fetch(`http://127.0.0.1:${mcpPort}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: "Bearer valid-token",
      origin: `http://127.0.0.1:${mcpPort}`,
      "mcp-session-id": sessionId,
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
  const toolNames = Array.isArray(toolsListBody?.result?.tools)
    ? toolsListBody.result.tools.map((tool) => String(tool?.name || ""))
    : [];
  for (const expectedTool of [
    "inspect-reference-section",
    "generate-shopify-section-bundle",
    "validate-shopify-section-bundle",
    "import-shopify-section-bundle",
    "replicate-section-from-reference",
  ]) {
    assert.equal(toolNames.includes(expectedTool), true, `tools/list should expose ${expectedTool}`);
  }

  console.log("mcpHttpAuth.test.mjs passed");
} finally {
  if (mcpServer && mcpServer.listening) {
    await new Promise((resolve) => mcpServer.close(resolve));
  }
  await new Promise((resolve) => introspectionServer.close(resolve));

  for (const [key, value] of Object.entries(previousEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}
