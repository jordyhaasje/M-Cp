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
    if (token === "mismatch-token") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          active: true,
          tokenId: "mcp_test_token_mismatch",
          tenantId: "tenant_alpha",
          licenseKey: "HZY-TEST",
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
        },
      })
    );
    return;
  }
  if (req.method === "POST" && req.url === "/v1/mcp/token/exchange") {
    let raw = "";
    for await (const chunk of req) {
      raw += chunk.toString();
    }
    const payload = raw ? JSON.parse(raw) : {};
    if (payload.token === "mismatch-token") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          active: true,
          tokenId: "mcp_test_token_mismatch",
          tenantId: "tenant_beta",
          shopify: {
            domain: "unit-test-shop.myshopify.com",
            authMode: "access_token",
            accessToken: "shpat_test_mismatch",
            expiresInSeconds: 3600,
          },
        })
      );
      return;
    }
    if (payload.token !== "valid-token") {
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
        shopify: {
          domain: "unit-test-shop.myshopify.com",
          authMode: "access_token",
          accessToken: "shpat_test",
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
process.env.HAZIFY_MCP_API_KEY = "mcp-test-key";
process.env.HAZIFY_MCP_PUBLIC_URL = `http://127.0.0.1:${mcpPort}`;
process.env.HAZIFY_MCP_ALLOWED_ORIGINS = `http://127.0.0.1:${mcpPort},null`;
process.env.MCP_SESSION_MODE = "stateless";

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

  const compatibilityMetadataResponse = await fetch(
    `http://127.0.0.1:${mcpPort}/mcp/.well-known/oauth-protected-resource`
  );
  assert.equal(
    compatibilityMetadataResponse.status,
    200,
    "path-compatible /mcp/.well-known/oauth-protected-resource should be available"
  );
  const compatibilityMetadataBody = await compatibilityMetadataResponse.json();
  assert.equal(
    compatibilityMetadataBody?.resource,
    `http://127.0.0.1:${mcpPort}/mcp`,
    "compatibility metadata should point to /mcp resource URL"
  );

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

  const opaqueOriginResponse = await fetch(`http://127.0.0.1:${mcpPort}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: "Bearer valid-token",
      origin: "vscode-webview://12345",
    },
    body: JSON.stringify(initializeBody),
  });
  assert.equal(opaqueOriginResponse.status, 200, "allowlist marker 'null' should allow opaque/native origins");

  const statelessGetResponse = await fetch(`http://127.0.0.1:${mcpPort}/mcp`, {
    method: "GET",
    headers: {
      authorization: "Bearer valid-token",
      origin: `http://127.0.0.1:${mcpPort}`,
    },
  });
  assert.equal(statelessGetResponse.status, 405, "stateless mode should advertise GET /mcp as unsupported");
  const statelessGetAllow = statelessGetResponse.headers.get("allow") || "";
  assert.equal(statelessGetAllow, "POST", "stateless mode should publish Allow: POST");
  const statelessGetBody = await statelessGetResponse.json();
  assert.match(statelessGetBody?.error?.message || "", /method not allowed/i);

  const statelessDeleteResponse = await fetch(`http://127.0.0.1:${mcpPort}/mcp`, {
    method: "DELETE",
    headers: {
      authorization: "Bearer valid-token",
      origin: `http://127.0.0.1:${mcpPort}`,
    },
  });
  assert.equal(statelessDeleteResponse.status, 405, "stateless mode should advertise DELETE /mcp as unsupported");
  const statelessDeleteAllow = statelessDeleteResponse.headers.get("allow") || "";
  assert.equal(statelessDeleteAllow, "POST", "stateless mode should publish Allow: POST for DELETE");
  const statelessDeleteBody = await statelessDeleteResponse.json();
  assert.match(statelessDeleteBody?.error?.message || "", /method not allowed/i);

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
  assert.equal(sessionId, null, "stateless mode should not return mcp-session-id");

  const jsonOnlyAcceptResponse = await fetch(`http://127.0.0.1:${mcpPort}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      authorization: "Bearer valid-token",
      origin: `http://127.0.0.1:${mcpPort}`,
    },
    body: JSON.stringify(initializeBody),
  });
  assert.equal(
    jsonOnlyAcceptResponse.status,
    200,
    "JSON-only Accept header should be normalized for client compatibility"
  );

  const wildcardAcceptResponse = await fetch(`http://127.0.0.1:${mcpPort}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "*/*",
      authorization: "Bearer valid-token",
      origin: `http://127.0.0.1:${mcpPort}`,
    },
    body: JSON.stringify(initializeBody),
  });
  assert.equal(
    wildcardAcceptResponse.status,
    200,
    "Wildcard Accept header should be normalized for Streamable HTTP requirements"
  );

  const statelessSessionHeaderResponse = await fetch(`http://127.0.0.1:${mcpPort}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: "Bearer valid-token",
      origin: `http://127.0.0.1:${mcpPort}`,
      "mcp-session-id": "forbidden-in-stateless",
    },
    body: JSON.stringify(initializeBody),
  });
  assert.equal(statelessSessionHeaderResponse.status, 400, "stateless mode should reject mcp-session-id");
  const statelessSessionHeaderBody = await statelessSessionHeaderResponse.json();
  assert.match(
    statelessSessionHeaderBody?.error?.message || "",
    /stateless mode does not accept mcp-session-id/i
  );

  const mismatchInitializeResponse = await fetch(`http://127.0.0.1:${mcpPort}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: "Bearer mismatch-token",
      origin: `http://127.0.0.1:${mcpPort}`,
    },
    body: JSON.stringify(initializeBody),
  });
  assert.equal(
    mismatchInitializeResponse.status,
    200,
    "initialize should remain exchange-lazy and not fail before a Shopify-scoped tool call"
  );

  const mismatchToolResponse = await fetch(`http://127.0.0.1:${mcpPort}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: "Bearer mismatch-token",
      origin: `http://127.0.0.1:${mcpPort}`,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 90,
      method: "tools/call",
      params: {
        name: "get-theme-file",
        arguments: { themeId: 123, key: "sections/demo.liquid", includeContent: false },
      },
    }),
  });
  const mismatchToolBody = await mismatchToolResponse.json();
  const mismatchMessage =
    mismatchToolBody?.error?.message ||
    mismatchToolBody?.result?.content?.map?.((entry) => entry?.text).join(" ") ||
    "";
  assert.match(mismatchMessage, /Token exchange tenant mismatch/i);

  const toolsListResponse = await fetch(`http://127.0.0.1:${mcpPort}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: "Bearer valid-token",
      origin: `http://127.0.0.1:${mcpPort}`,
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
  const tools = Array.isArray(toolsListBody?.result?.tools)
    ? toolsListBody.result.tools
    : [];
  const toolNames = Array.isArray(toolsListBody?.result?.tools)
    ? toolsListBody.result.tools.map((tool) => String(tool?.name || ""))
    : [];
  for (const expectedTool of [
    "get-products",
    "create-theme-section",
    "patch-theme-file",
    "refund-order",
    "get-theme-files",
    "read-theme-file",
    "draft-theme-artifact",
    "verify-theme-files",
  ]) {
    assert.equal(toolNames.includes(expectedTool), true, `tools/list should expose ${expectedTool}`);
  }

  const planThemeEditDefinition = tools.find((tool) => tool?.name === "plan-theme-edit");
  assert.ok(planThemeEditDefinition, "tools/list should expose plan-theme-edit");
  assert.notEqual(
    planThemeEditDefinition.inputSchema?.additionalProperties,
    true,
    "plan-theme-edit should not emit an open additionalProperties=true schema"
  );
  assert.equal(
    Array.isArray(planThemeEditDefinition.inputSchema?.required) &&
      planThemeEditDefinition.inputSchema.required.includes("intent"),
    false,
    "plan-theme-edit should not hard-require intent in emitted JSON schema"
  );
  assert.equal(
    Boolean(planThemeEditDefinition.inputSchema?.properties?._tool_input_summary),
    true,
    "plan-theme-edit should expose _tool_input_summary in emitted JSON schema"
  );
  assert.equal(
    Boolean(planThemeEditDefinition.inputSchema?.properties?.targetFiles),
    true,
    "plan-theme-edit should expose compat targetFiles in emitted JSON schema"
  );
  assert.equal(
    Number(planThemeEditDefinition.inputSchema?.properties?.query?.maxLength || 0) > 240,
    true,
    "plan-theme-edit should expose a query maxLength above the internal 240-char planner budget"
  );

  const draftThemeArtifactDefinition = tools.find((tool) => tool?.name === "draft-theme-artifact");
  assert.ok(draftThemeArtifactDefinition, "tools/list should expose draft-theme-artifact");
  assert.notEqual(
    draftThemeArtifactDefinition.inputSchema?.additionalProperties,
    true,
    "draft-theme-artifact should not emit an open additionalProperties=true schema"
  );
  assert.equal(
    Array.isArray(draftThemeArtifactDefinition.inputSchema?.required) &&
      draftThemeArtifactDefinition.inputSchema.required.includes("files"),
    false,
    "draft-theme-artifact should not hard-require files in emitted JSON schema"
  );
  assert.equal(
    Boolean(draftThemeArtifactDefinition.inputSchema?.properties?.content),
    true,
    "draft-theme-artifact should expose content as a compat alias in emitted JSON schema"
  );
  assert.equal(
    Boolean(draftThemeArtifactDefinition.inputSchema?.properties?._tool_input_summary),
    true,
    "draft-theme-artifact should expose _tool_input_summary in emitted JSON schema"
  );

  const createThemeSectionDefinition = tools.find((tool) => tool?.name === "create-theme-section");
  assert.ok(createThemeSectionDefinition, "tools/list should expose create-theme-section");
  assert.equal(
    Boolean(createThemeSectionDefinition.inputSchema?.properties?.handle),
    true,
    "create-theme-section should expose handle shorthand in emitted JSON schema"
  );
  assert.equal(
    Boolean(createThemeSectionDefinition.inputSchema?.properties?.content),
    true,
    "create-theme-section should expose content as a compat alias in emitted JSON schema"
  );

  const patchThemeFileDefinition = tools.find((tool) => tool?.name === "patch-theme-file");
  assert.ok(patchThemeFileDefinition, "tools/list should expose patch-theme-file");
  assert.equal(
    Boolean(patchThemeFileDefinition.inputSchema?.properties?._tool_input_summary),
    true,
    "patch-theme-file should expose _tool_input_summary in emitted JSON schema"
  );
  assert.equal(
    Array.isArray(patchThemeFileDefinition.inputSchema?.required) &&
      patchThemeFileDefinition.inputSchema.required.includes("key"),
    false,
    "patch-theme-file should not hard-require key in emitted JSON schema when a repairable compat flow is possible"
  );

  const getThemeFilesDefinition = tools.find((tool) => tool?.name === "get-theme-files");
  assert.ok(getThemeFilesDefinition, "tools/list should expose get-theme-files");
  assert.equal(
    Boolean(getThemeFilesDefinition.inputSchema?.properties?.role),
    true,
    "get-theme-files should expose role as a compat alias in emitted JSON schema"
  );
  assert.equal(
    Boolean(getThemeFilesDefinition.inputSchema?.properties?.filenames),
    true,
    "get-theme-files should expose filenames as a compat alias in emitted JSON schema"
  );

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
