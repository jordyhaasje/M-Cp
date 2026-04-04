import assert from "assert";
import net from "net";
import { startLicenseServiceTestServer } from "./helpers/serviceHarness.mjs";

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

function extractCookie(response) {
  const setCookie = response.headers.get("set-cookie");
  return setCookie ? setCookie.split(";")[0] || "" : "";
}

const port = await getFreePort();
const baseUrl = `http://127.0.0.1:${port}`;

const originalFetch = global.fetch;

global.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === "string" ? input : input.url);
  if (
    url.protocol === "https:" &&
    url.hostname.endsWith(".myshopify.com") &&
    url.pathname === "/admin/oauth/access_scopes.json"
  ) {
    const scopes = [
      "read_products",
      "write_products",
      "read_customers",
      "write_customers",
      "read_orders",
      "write_orders",
      "read_fulfillments",
      "read_inventory",
      "write_merchant_managed_fulfillment_orders",
      "read_themes",
      "write_themes",
    ];
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

let harness;

try {
  harness = await startLicenseServiceTestServer({
    port,
    publicBaseUrl: baseUrl,
    mcpPublicUrl: "https://mcp.example.test/mcp",
    env: {
      HAZIFY_FREE_MODE: "false",
      HAZIFY_AUTO_ACTIVATE_SIGNUP_LICENSES: "true",
      ADMIN_API_KEY: "admin-test-key",
      MCP_API_KEY: "mcp-test-key",
    },
    cacheBuster: `signupactive=${Date.now()}`,
  });

  const signupResponse = await fetch(`${baseUrl}/v1/account/signup`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email: `signup-active-${Date.now()}@example.test`,
      name: "Signup Active",
      password: "SignupActivePass!123",
    }),
  });
  assert.equal(signupResponse.status, 201, "signup should succeed while auto-activation is enabled");
  const signupBody = await signupResponse.json();
  assert.equal(signupBody?.account?.email?.includes("@example.test"), true);

  const meResponse = await fetch(`${baseUrl}/v1/account/me`, {
    headers: {
      Cookie: extractCookie(signupResponse),
    },
  });
  assert.equal(meResponse.status, 200, "session should be active after signup");

  const sessionBootstrapResponse = await fetch(`${baseUrl}/v1/session/bootstrap`, {
    headers: {
      Cookie: extractCookie(signupResponse),
    },
  });
  const sessionBootstrapBody = await sessionBootstrapResponse.json();
  assert.equal(sessionBootstrapBody?.authenticated, true, "signup session should be authenticated");

  const licenseKey = signupBody?.account?.licenseKey;
  assert.ok(licenseKey, "signup should return a license key");

  const licenseResponse = await fetch(`${baseUrl}/v1/admin/license/${encodeURIComponent(licenseKey)}`, {
    headers: {
      "x-admin-api-key": process.env.ADMIN_API_KEY,
    },
  });
  assert.equal(licenseResponse.status, 200, "admin license readback should succeed");
  const licenseBody = await licenseResponse.json();
  assert.equal(licenseBody?.status, "active", "signup license should be active in auto-activation mode");

  const connectResponse = await fetch(`${baseUrl}/v1/onboarding/connect-shopify`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Cookie: extractCookie(signupResponse),
    },
    body: JSON.stringify({
      shopDomain: "signup-active-store.myshopify.com",
      shopAccessToken: "shpat_signup_active",
      label: "Signup Active Store",
    }),
  });
  assert.equal(
    connectResponse.status,
    201,
    "signup with auto-activated license should be able to connect a Shopify store"
  );
} finally {
  global.fetch = originalFetch;
  if (harness) {
    await harness.cleanup();
  }
}
