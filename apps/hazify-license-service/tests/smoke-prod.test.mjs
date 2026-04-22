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

console.log("smoke-prod.test.mjs passed");
