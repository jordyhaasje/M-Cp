import assert from "assert";
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

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(url, headers, timeoutMs = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2025-11-05",
            capabilities: {},
            clientInfo: { name: "runtime-behavior-test", version: "1.0.0" },
          },
        }),
      });
      if (response.status === 200) {
        return;
      }
    } catch {
      // retry
    }
    await delay(120);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

const mcpPort = await getFreePort();
const testDir = path.dirname(fileURLToPath(import.meta.url));
const introspectionBase = "http://license.test.local";
const mcpBaseUrl = `http://127.0.0.1:${mcpPort}`;

const originalFetch = global.fetch;
const counters = {
  introspectCalls: 0,
  exchangeCalls: 0,
  activeReadCalls: 0,
  maxReadCalls: 0,
  activeMutatingCalls: 0,
  maxMutatingCalls: 0,
};

global.fetch = async (url, options = {}) => {
  const stringUrl = String(url);

  if (stringUrl === `${introspectionBase}/v1/mcp/token/introspect`) {
    counters.introspectCalls += 1;
    return new Response(
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
        },
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  }

  if (stringUrl === `${introspectionBase}/v1/mcp/token/exchange`) {
    counters.exchangeCalls += 1;
    return new Response(
      JSON.stringify({
        active: true,
        tokenId: "mcp_test_token",
        tenantId: "tenant_test",
        shopify: {
          domain: "unit-test-shop.myshopify.com",
          authMode: "access_token",
          accessToken: "shpat_test",
          expiresInSeconds: 3600,
        },
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  }

  if (stringUrl === "https://unit-test-shop.myshopify.com/admin/api/2026-01/graphql.json") {
    const payload = JSON.parse(options.body || "{}");
    const query = String(payload.query || "");

    if (query.includes("query ThemeById")) {
      return new Response(
        JSON.stringify({
          data: {
            theme: {
              id: "gid://shopify/OnlineStoreTheme/123",
              name: "Main Theme",
              role: "MAIN",
              processing: false,
              createdAt: "2026-03-15T12:00:00Z",
              updatedAt: "2026-03-15T12:00:00Z",
            },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }

    if (query.includes("query ThemeFileById")) {
      counters.activeReadCalls += 1;
      counters.maxReadCalls = Math.max(counters.maxReadCalls, counters.activeReadCalls);
      await delay(120);
      counters.activeReadCalls -= 1;
      return new Response(
        JSON.stringify({
          data: {
            theme: {
              id: "gid://shopify/OnlineStoreTheme/123",
              name: "Main Theme",
              role: "MAIN",
              processing: false,
              createdAt: "2026-03-15T12:00:00Z",
              updatedAt: "2026-03-15T12:00:00Z",
              files: {
                nodes: [
                  {
                    filename: "sections/demo.liquid",
                    checksumMd5: "checksum",
                    contentType: "text/plain",
                    createdAt: "2026-03-15T12:00:00Z",
                    updatedAt: "2026-03-15T12:00:00Z",
                    size: 12,
                    body: {
                      content: "<div>demo</div>",
                    },
                  },
                ],
                userErrors: [],
              },
            },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }

    if (query.includes("mutation ThemeFilesUpsert")) {
      counters.activeMutatingCalls += 1;
      counters.maxMutatingCalls = Math.max(counters.maxMutatingCalls, counters.activeMutatingCalls);
      await delay(120);
      counters.activeMutatingCalls -= 1;
      const variables = payload.variables || {};
      const files = Array.isArray(variables.files) ? variables.files : [];
      return new Response(
        JSON.stringify({
          data: {
            themeFilesUpsert: {
              upsertedThemeFiles: files.map((entry) => ({ filename: entry.filename })),
              job: { id: "gid://shopify/Job/1" },
              userErrors: [],
            },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }

    if (query.includes("query ThemeList")) {
      return new Response(
        JSON.stringify({
          data: {
            themes: {
              nodes: [],
            },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }

    throw new Error(`Unexpected Shopify GraphQL query: ${query.slice(0, 120)}`);
  }

  return originalFetch(url, options);
};

const previousEnv = {
  HAZIFY_MCP_TRANSPORT: process.env.HAZIFY_MCP_TRANSPORT,
  HAZIFY_MCP_HTTP_HOST: process.env.HAZIFY_MCP_HTTP_HOST,
  PORT: process.env.PORT,
  HAZIFY_MCP_INTROSPECTION_URL: process.env.HAZIFY_MCP_INTROSPECTION_URL,
  HAZIFY_MCP_API_KEY: process.env.HAZIFY_MCP_API_KEY,
  HAZIFY_MCP_PUBLIC_URL: process.env.HAZIFY_MCP_PUBLIC_URL,
  MCP_SESSION_MODE: process.env.MCP_SESSION_MODE,
  HAZIFY_MCP_CONTEXT_TTL_MS: process.env.HAZIFY_MCP_CONTEXT_TTL_MS,
};

process.env.HAZIFY_MCP_TRANSPORT = "http";
process.env.HAZIFY_MCP_HTTP_HOST = "127.0.0.1";
process.env.PORT = String(mcpPort);
process.env.HAZIFY_MCP_INTROSPECTION_URL = introspectionBase;
process.env.HAZIFY_MCP_API_KEY = "mcp-test-key";
process.env.HAZIFY_MCP_PUBLIC_URL = mcpBaseUrl;
process.env.MCP_SESSION_MODE = "stateless";
delete process.env.HAZIFY_MCP_CONTEXT_TTL_MS;

const mcpModuleUrl = `${pathToFileURL(path.resolve(testDir, "../src/index.js")).href}?test=${Date.now()}`;
const mcpModule = await import(mcpModuleUrl);
const mcpServer = mcpModule.httpServer;

const authHeaders = {
  "content-type": "application/json",
  accept: "application/json, text/event-stream",
  authorization: "Bearer valid-token",
  origin: mcpBaseUrl,
};

const postMcp = async (body) => {
  const response = await fetch(`${mcpBaseUrl}/mcp`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify(body),
  });
  assert.equal(response.status, 200, `Expected 200 for method ${body.method}`);
  const payload = await response.json();
  assert.equal(payload.error, undefined, `Unexpected JSON-RPC error for method ${body.method}`);
  return payload;
};

try {
  await waitFor(`${mcpBaseUrl}/mcp`, authHeaders);

  await postMcp({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-11-05",
      capabilities: {},
      clientInfo: { name: "runtime-behavior-test", version: "1.0.0" },
    },
  });

  await postMcp({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/list",
    params: {},
  });

  assert.ok(counters.introspectCalls >= 2, "introspection should still run per request for revocation safety");
  assert.equal(counters.exchangeCalls, 1, "context TTL default should cache token exchange for repeated calls");

  await Promise.all([
    postMcp({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "get-theme-file",
        arguments: { themeId: 123, key: "sections/demo.liquid", includeContent: false },
      },
    }),
    postMcp({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: {
        name: "get-theme-file",
        arguments: { themeId: 123, key: "sections/demo.liquid", includeContent: false },
      },
    }),
  ]);

  assert.ok(counters.maxReadCalls >= 2, "read-only tools should run in parallel");

  await Promise.all([
    postMcp({
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: {
        name: "upsert-theme-file",
        arguments: { themeId: 123, key: "sections/one.liquid", value: "<div>one</div>" },
      },
    }),
    postMcp({
      jsonrpc: "2.0",
      id: 6,
      method: "tools/call",
      params: {
        name: "upsert-theme-file",
        arguments: { themeId: 123, key: "sections/two.liquid", value: "<div>two</div>" },
      },
    }),
  ]);

  assert.equal(counters.maxMutatingCalls, 1, "mutating tools should stay serialized per tenant");

  console.log("runtimeExecutionBehavior.test.mjs passed");
} finally {
  if (mcpServer && mcpServer.listening) {
    await new Promise((resolve) => mcpServer.close(resolve));
  }

  global.fetch = originalFetch;

  for (const [key, value] of Object.entries(previousEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}
