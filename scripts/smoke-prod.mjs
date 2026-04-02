const licenseBaseUrl =
  process.env.HAZIFY_LICENSE_BASE_URL ||
  "https://hazify-license-service-production.up.railway.app";
const mcpBaseUrl =
  process.env.HAZIFY_MCP_BASE_URL || "https://hazify-mcp-remote-production.up.railway.app";
const visualWorkerBaseUrl = process.env.HAZIFY_VISUAL_WORKER_BASE_URL || "";

function toUrl(baseUrl, pathname) {
  return new URL(pathname, baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`).toString();
}

async function expectStatus({ method = "GET", url, expectedStatus, headers, body }) {
  const response = await fetch(url, { method, headers, body });
  const status = response.status;
  if (status !== expectedStatus) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `${method} ${url} returned ${status}, expected ${expectedStatus}. Body: ${text.slice(0, 300)}`
    );
  }
  console.log(`${method} ${url} -> ${status}`);
}

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
  url: toUrl(licenseBaseUrl, "/health"),
  expectedStatus: 200,
});

await expectStatus({
  url: toUrl(licenseBaseUrl, "/v1/session/bootstrap"),
  expectedStatus: 200,
});

await expectStatus({
  url: toUrl(mcpBaseUrl, "/.well-known/oauth-protected-resource"),
  expectedStatus: 200,
});

await expectStatus({
  url: toUrl(mcpBaseUrl, "/.well-known/oauth-authorization-server"),
  expectedStatus: 200,
});

await expectStatus({
  method: "POST",
  url: toUrl(mcpBaseUrl, "/mcp"),
  expectedStatus: 401,
  headers: {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
  },
  body: initializePayload,
});

if (visualWorkerBaseUrl) {
  await expectStatus({
    url: toUrl(visualWorkerBaseUrl, "/health"),
    expectedStatus: 200,
  });
}

console.log("Production smoke checks passed.");
