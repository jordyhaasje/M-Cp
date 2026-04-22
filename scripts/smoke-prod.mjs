import path from "path";
import { fileURLToPath } from "url";

const DEFAULT_LICENSE_BASE_URL =
  "https://hazify-license-service-production.up.railway.app";
const DEFAULT_MCP_BASE_URL = "https://hazify-mcp-remote-production.up.railway.app";

function toUrl(baseUrl, pathname) {
  return new URL(pathname, baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`).toString();
}

async function expectStatus({ fetchImpl = fetch, method = "GET", url, expectedStatus, headers, body }) {
  const response = await fetchImpl(url, { method, headers, body });
  const status = response.status;
  if (status !== expectedStatus) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `${method} ${url} returned ${status}, expected ${expectedStatus}. Body: ${text.slice(0, 300)}`
    );
  }
  console.log(`${method} ${url} -> ${status}`);
}

function hasAnyConfiguredValue(values) {
  return values.some((value) => typeof value === "string" && value.trim());
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
    "Anonymous /mcp check passed. Authenticated MCP tool smoke still requires an explicit production token."
  );

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
