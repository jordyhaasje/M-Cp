import assert from "assert";
import net from "net";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { createThemeDraftDbHarness } from "./helpers/themeDraftDbHarness.mjs";

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
const themeDraftDb = createThemeDraftDbHarness();

const originalFetch = global.fetch;
const originalConsoleLog = console.log;
const counters = {
  introspectCalls: 0,
  exchangeCalls: 0,
  activeReadCalls: 0,
  maxReadCalls: 0,
  activeMutatingCalls: 0,
  maxMutatingCalls: 0,
};
const capturedHttpEvents = [];

const validSectionLiquid = `
<style>
  #shopify-section-{{ section.id }} .card {
    display: grid;
    padding: 24px;
    border-radius: 18px;
  }

  @media screen and (max-width: 749px) {
    #shopify-section-{{ section.id }} .card {
      padding: 16px;
    }
  }
</style>

<div class="card">{{ section.settings.heading }}</div>

{% schema %}
{
  "name": "Runtime section",
  "settings": [
    { "type": "text", "id": "heading", "label": "Heading", "default": "Hello" },
    { "type": "range", "id": "gap", "label": "Gap", "min": 0, "max": 40, "step": 4, "default": 16 },
    { "type": "color", "id": "accent", "label": "Accent", "default": "#111111" }
  ],
  "presets": [{ "name": "Runtime section" }]
}
{% endschema %}
`;

global.fetch = async (url, options = {}) => {
  const stringUrl = String(url);

  if (stringUrl === `${introspectionBase}/v1/mcp/token/introspect`) {
    counters.introspectCalls += 1;
    const payload = JSON.parse(options.body || "{}");
    const token = String(payload.token || "");
    const mutationsAllowed = token !== "readonly-token";
    return new Response(
      JSON.stringify({
        active: true,
        tokenId: "mcp_test_token",
        tenantId: "tenant_test",
        licenseKey: "HZY-TEST",
        license: {
          status: "active",
          entitlements: { mutations: mutationsAllowed, tools: {} },
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
      const requested = Array.isArray(payload.variables?.filenames)
        ? payload.variables.filenames.map((entry) => String(entry))
        : [];
      if (requested.includes("sections/throw.liquid")) {
        throw new Error("Simulated read crash");
      }
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

    if (query.includes("query ThemeFilesByIdMetadata")) {
      const requested = Array.isArray(payload.variables?.filenames)
        ? payload.variables.filenames.map((entry) => String(entry))
        : [];
      const existingNodes = requested
        .filter((filename) => filename === "sections/demo.liquid")
        .map((filename) => ({
          filename,
          checksumMd5: "checksum",
          contentType: "text/plain",
          createdAt: "2026-03-15T12:00:00Z",
          updatedAt: "2026-03-15T12:00:00Z",
          size: validSectionLiquid.length,
        }));
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
                nodes: existingNodes,
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
  NODE_ENV: process.env.NODE_ENV,
  HAZIFY_MCP_HTTP_HOST: process.env.HAZIFY_MCP_HTTP_HOST,
  PORT: process.env.PORT,
  HAZIFY_MCP_INTROSPECTION_URL: process.env.HAZIFY_MCP_INTROSPECTION_URL,
  HAZIFY_MCP_API_KEY: process.env.HAZIFY_MCP_API_KEY,
  HAZIFY_MCP_PUBLIC_URL: process.env.HAZIFY_MCP_PUBLIC_URL,
  MCP_SESSION_MODE: process.env.MCP_SESSION_MODE,
  HAZIFY_MCP_CONTEXT_TTL_MS: process.env.HAZIFY_MCP_CONTEXT_TTL_MS,
};

process.env.NODE_ENV = "test";
process.env.HAZIFY_MCP_HTTP_HOST = "127.0.0.1";
process.env.PORT = String(mcpPort);
process.env.HAZIFY_MCP_INTROSPECTION_URL = introspectionBase;
process.env.HAZIFY_MCP_API_KEY = "mcp-test-key";
process.env.HAZIFY_MCP_PUBLIC_URL = mcpBaseUrl;
process.env.MCP_SESSION_MODE = "stateless";
delete process.env.HAZIFY_MCP_CONTEXT_TTL_MS;

console.log = (...args) => {
  const [firstArg] = args;
  if (typeof firstArg === "string") {
    try {
      const parsed = JSON.parse(firstArg);
      if (parsed?.event && String(parsed.event).startsWith("mcp_http_")) {
        capturedHttpEvents.push(parsed);
      }
    } catch {
      // ignore non-JSON logs
    }
  }
  return originalConsoleLog(...args);
};

const mcpModuleUrl = `${pathToFileURL(path.resolve(testDir, "../src/index.js")).href}?test=${Date.now()}`;
const mcpModule = await import(mcpModuleUrl);
const mcpServer = mcpModule.httpServer;

const authHeaders = {
  "content-type": "application/json",
  accept: "application/json, text/event-stream",
  authorization: "Bearer valid-token",
  origin: mcpBaseUrl,
};

const readonlyAuthHeaders = {
  ...authHeaders,
  authorization: "Bearer readonly-token",
};

const postMcpRaw = async (body, headers = authHeaders) => {
  const response = await fetch(`${mcpBaseUrl}/mcp`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  return response;
};

const postMcp = async (body, headers = authHeaders) => {
  const response = await postMcpRaw(body, headers);
  const payload = await response.json();
  if (payload.error) {
    console.error("RPC Error:", JSON.stringify(payload.error));
  }
  if (payload.result?.isError) {
    console.error("RPC Application Error:", JSON.stringify(payload.result.content));
  }
  assert.equal(response.status, 200, `Expected 200 for method ${body.method}`);
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
  assert.equal(counters.exchangeCalls, 0, "initialize/tools/list must not trigger eager token exchange");

  await postMcp({
    jsonrpc: "2.0",
    id: 21,
    method: "tools/call",
    params: {
      name: "get-supported-tracking-companies",
      arguments: {},
    },
  });
  assert.equal(counters.exchangeCalls, 0, "context-free tools should not trigger token exchange");

  const blockedMutationResponse = await postMcpRaw(
    {
      jsonrpc: "2.0",
      id: 22,
      method: "tools/call",
      params: {
        name: "draft-theme-artifact",
        arguments: { themeId: 123, files: [{ key: "sections/blocked.liquid", value: validSectionLiquid }] },
      },
    },
    readonlyAuthHeaders
  );
  const blockedMutationBody = await blockedMutationResponse.json();
  const blockedMessage =
    blockedMutationBody?.error?.message ||
    blockedMutationBody?.result?.content?.map?.((entry) => entry?.text).join(" ") ||
    "";
  assert.match(
    blockedMessage,
    /License gate blocked/i,
    "blocked mutating call should fail license gate before token exchange"
  );
  assert.equal(counters.exchangeCalls, 0, "blocked mutating call should not trigger token exchange");

  await postMcp({
    jsonrpc: "2.0",
    id: 23,
    method: "tools/call",
    params: {
      name: "get-theme-file",
      arguments: { themeId: 123, key: "sections/demo.liquid", includeContent: false },
    },
  });
  assert.equal(counters.exchangeCalls, 1, "first Shopify-scoped tool call should lazily trigger exchange once");

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
        name: "draft-theme-artifact",
        arguments: { themeId: 123, mode: "create", files: [{ key: "sections/one.liquid", value: validSectionLiquid }] },
      },
    }),
    postMcp({
      jsonrpc: "2.0",
      id: 6,
      method: "tools/call",
      params: {
        name: "draft-theme-artifact",
        arguments: { themeId: 123, mode: "create", files: [{ key: "sections/two.liquid", value: validSectionLiquid }] },
      },
    }),
  ]);

  assert.equal(counters.maxMutatingCalls, 1, "mutating tools should stay serialized per tenant");

  const domainFailureStart = capturedHttpEvents.length;
  const domainFailureResponse = await postMcpRaw({
    jsonrpc: "2.0",
    id: 24,
    method: "tools/call",
    params: {
      name: "draft-theme-artifact",
      arguments: {
        themeId: 123,
        mode: "create",
        files: [{ key: "sections/demo.liquid", value: validSectionLiquid }],
      },
    },
  });
  const domainFailureBody = await domainFailureResponse.json();
  assert.equal(domainFailureResponse.status, 200, "tool-level failures should still return a normal MCP response");
  assert.equal(domainFailureBody?.error, undefined, "tool-level failures should not become JSON-RPC exceptions");
  const domainFailureEvent = capturedHttpEvents
    .slice(domainFailureStart)
    .find((entry) => entry?.event === "mcp_http_tool_call_domain_failed");
  assert.ok(domainFailureEvent, "tool-level theme failures should emit a dedicated domain-failed log event");
  assert.equal(domainFailureEvent.toolName, "draft-theme-artifact");
  assert.equal(domainFailureEvent.errorCode, "existing_create_key_conflict");
  assert.equal(
    domainFailureEvent.requestId,
    domainFailureResponse.headers.get("x-request-id"),
    "domain-failure logs should correlate with the HTTP request id"
  );
  assert.equal(
    domainFailureEvent.failureSummary?.primaryIssueCode,
    "existing_create_key_conflict",
    "domain-failure logs should include a compact failure summary"
  );

  const thrownFailureStart = capturedHttpEvents.length;
  const thrownFailureResponse = await postMcpRaw({
    jsonrpc: "2.0",
    id: 25,
    method: "tools/call",
    params: {
      name: "get-theme-file",
      arguments: { themeId: 123, key: "sections/throw.liquid", includeContent: true },
    },
  });
  const thrownFailureBody = await thrownFailureResponse.json();
  assert.ok(
    thrownFailureBody?.error || thrownFailureBody?.result?.isError,
    "thrown tool exceptions should still surface as request-level MCP failures"
  );
  const thrownFailureEvent = capturedHttpEvents
    .slice(thrownFailureStart)
    .find((entry) => entry?.event === "mcp_http_tool_call_failed");
  assert.ok(thrownFailureEvent, "protocol/runtime exceptions should keep using the failed log event");
  assert.equal(thrownFailureEvent.toolName, "get-theme-file");
  assert.match(thrownFailureEvent.error || "", /Simulated read crash/);
  assert.equal(
    thrownFailureEvent.requestId,
    thrownFailureResponse.headers.get("x-request-id"),
    "thrown failures should also carry the same request id as the HTTP response"
  );

  console.log("runtimeExecutionBehavior.test.mjs passed");
} finally {
  if (mcpServer && mcpServer.listening) {
    await new Promise((resolve) => mcpServer.close(resolve));
  }

  global.fetch = originalFetch;
  console.log = originalConsoleLog;
  await themeDraftDb.cleanup();

  for (const [key, value] of Object.entries(previousEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}
