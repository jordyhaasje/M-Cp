import assert from "assert";
import { runSmokeChecks } from "../../../scripts/smoke-prod.mjs";

const requests = [];

function response(status, body = "") {
  return {
    status,
    async text() {
      return body;
    },
  };
}

await runSmokeChecks({
  env: {
    HAZIFY_LICENSE_BASE_URL: "https://license.example.test",
    HAZIFY_MCP_BASE_URL: "https://mcp.example.test",
    ADMIN_API_KEY: "admin-readiness-key",
    STRIPE_SECRET_KEY: "sk_test_123456",
    STRIPE_WEBHOOK_SECRET: "whsec_123456",
    STRIPE_DEFAULT_PRICE_ID: "price_123",
  },
  fetchImpl: async (url, options = {}) => {
    requests.push({
      url: String(url),
      method: options.method || "GET",
      headers: options.headers || {},
    });
    if (String(url).includes("/mcp") && (options.method || "GET") === "POST") {
      return response(401, '{"error":"unauthorized"}');
    }
    return response(200, "{}");
  },
});

assert(
  requests.some((entry) => entry.url.endsWith("/v1/admin/readiness")),
  "smoke checks should include admin readiness when ADMIN_API_KEY is present"
);
assert(
  requests.some((entry) => entry.url.endsWith("/v1/billing/readiness")),
  "smoke checks should include billing readiness when Stripe envs are present"
);
assert(
  requests.some((entry) => entry.url.endsWith("/mcp") && entry.method === "POST"),
  "smoke checks should still validate the MCP initialize handshake"
);

const adminReadinessRequest = requests.find((entry) => entry.url.endsWith("/v1/admin/readiness"));
assert.equal(
  adminReadinessRequest?.headers?.["x-admin-api-key"],
  "admin-readiness-key",
  "admin readiness should send the configured admin key"
);

const authenticatedRequests = [];
await runSmokeChecks({
  env: {
    HAZIFY_LICENSE_BASE_URL: "https://license.example.test",
    HAZIFY_MCP_BASE_URL: "https://mcp.example.test",
    HAZIFY_MCP_SMOKE_TOKEN: "full-smoke-token",
    HAZIFY_MCP_SMOKE_READ_ONLY_TOKEN: "read-only-smoke-token",
    HAZIFY_REQUIRE_AUTHENTICATED_MCP_SMOKE: "true",
  },
  fetchImpl: async (url, options = {}) => {
    authenticatedRequests.push({
      url: String(url),
      method: options.method || "GET",
      headers: options.headers || {},
      body: options.body || "",
    });
    if (String(url).includes("/mcp") && (options.method || "GET") === "POST") {
      const payload = JSON.parse(options.body || "{}");
      if (!options.headers?.authorization) {
        return response(401, '{"error":"unauthorized"}');
      }
      if (payload.method === "initialize") {
        return response(200, JSON.stringify({ jsonrpc: "2.0", id: payload.id, result: { protocolVersion: "2025-11-05" } }));
      }
      if (payload.method === "tools/list") {
        return response(
          200,
          JSON.stringify({
            jsonrpc: "2.0",
            id: payload.id,
            result: {
              tools: [
                { name: "get-license-status" },
                { name: "get-themes" },
                { name: "search-theme-files" },
                { name: "draft-theme-artifact" },
                { name: "apply-theme-draft" },
              ],
            },
          })
        );
      }
      if (payload.method === "tools/call" && payload.params?.name === "get-license-status") {
        return response(
          200,
          JSON.stringify({
            jsonrpc: "2.0",
            id: payload.id,
            result: {
              content: [{ type: "text", text: "{}" }],
              structuredContent: { tenant: { shopDomain: "unit-test-shop.myshopify.com" } },
            },
          })
        );
      }
      if (payload.method === "tools/call" && payload.params?.name === "set-order-tracking") {
        return response(
          200,
          JSON.stringify({
            jsonrpc: "2.0",
            id: payload.id,
            error: { code: -32000, message: "Tool 'set-order-tracking' requires write scope." },
          })
        );
      }
    }
    return response(200, "{}");
  },
});

assert(
  authenticatedRequests.some((entry) => entry.body.includes('"method":"tools/list"')),
  "authenticated smoke should call tools/list"
);
assert(
  authenticatedRequests.some((entry) => entry.body.includes('"name":"get-license-status"')),
  "authenticated smoke should call get-license-status"
);
assert(
  authenticatedRequests.some((entry) => entry.body.includes('"name":"set-order-tracking"')),
  "authenticated smoke should validate write-scope gate"
);

console.log("smoke-prod.test.mjs passed");
