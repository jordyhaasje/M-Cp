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
let capturedStripeCheckoutBody = null;

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
      "read_merchant_managed_fulfillment_orders",
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

  if (url.href === "https://api.stripe.com/v1/checkout/sessions") {
    const rawBody =
      typeof init.body === "string"
        ? init.body
        : init.body && typeof init.body.toString === "function"
        ? init.body.toString()
        : "";
    capturedStripeCheckoutBody = new URLSearchParams(rawBody);
    return new Response(
      JSON.stringify({
        id: "cs_test_account_binding",
        url: "https://checkout.stripe.test/session/account-binding",
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
      ADMIN_API_KEY: "admin-test-key",
      MCP_API_KEY: "mcp-test-key",
      STRIPE_MODE: "test",
      STRIPE_SECRET_KEY: "sk_test_account_binding",
      STRIPE_WEBHOOK_SECRET: "whsec_account_binding",
      STRIPE_MONTHLY_PRICE_ID: "price_test_monthly",
      CHECKOUT_SUCCESS_URL: `${baseUrl}/onboarding?payment=success`,
      CHECKOUT_CANCEL_URL: `${baseUrl}/onboarding?payment=cancel`,
    },
    cacheBuster: `binding=${Date.now()}`,
  });

  const paidLicenseKey = "HZY-TEST-PAID-LICENSE";
  const createLicenseResponse = await fetch(`${baseUrl}/v1/admin/license/create`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-admin-api-key": process.env.ADMIN_API_KEY,
    },
    body: JSON.stringify({
      licenseKey: paidLicenseKey,
      status: "active",
    }),
  });
  assert.equal(createLicenseResponse.status, 201, "admin should create an active license");

  const signupResponse = await fetch(`${baseUrl}/v1/account/signup`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email: `paid-${Date.now()}@example.test`,
      name: "Paid Signup",
      password: "PaidSignupPass!123",
      licenseKey: paidLicenseKey,
    }),
  });
  assert.equal(signupResponse.status, 201, "signup with a paid license key should succeed");
  const signupBody = await signupResponse.json();
  assert.equal(
    signupBody?.account?.licenseKey,
    paidLicenseKey,
    "signup should bind the provided paid license key"
  );

  const connectResponse = await fetch(`${baseUrl}/v1/onboarding/connect-shopify`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Cookie: extractCookie(signupResponse),
    },
    body: JSON.stringify({
      shopDomain: "paid-signup-store.myshopify.com",
      shopAccessToken: "shpat_paid_signup",
      label: "Paid Signup Store",
    }),
  });
  assert.equal(connectResponse.status, 201, "paid signup account should be allowed to connect a store");

  const email = `license-adopt-${Date.now()}@example.test`;
  const password = "AdoptLoginPass!123";

  const invalidSignupResponse = await fetch(`${baseUrl}/v1/account/signup`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email,
      name: "License Adopt",
      password,
    }),
  });
  assert.equal(invalidSignupResponse.status, 201, "baseline signup should succeed");
  const invalidSignupBody = await invalidSignupResponse.json();
  const originalInvalidLicenseKey = invalidSignupBody?.account?.licenseKey;
  assert.ok(originalInvalidLicenseKey, "baseline signup should create an initial license key");

  const checkoutResponse = await fetch(`${baseUrl}/v1/billing/create-checkout-session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      customerEmail: email,
      plan: "monthly",
    }),
  });
  assert.equal(checkoutResponse.status, 200, "checkout session should be created");
  const checkoutBody = await checkoutResponse.json();
  const checkoutLicenseKey = checkoutBody?.licenseKey;
  assert.ok(checkoutLicenseKey, "checkout should return a license key");
  assert.ok(capturedStripeCheckoutBody, "stripe checkout payload should be captured");
  assert.equal(
    capturedStripeCheckoutBody.get("success_url"),
    `${baseUrl}/onboarding?payment=success&licenseKey=${encodeURIComponent(checkoutLicenseKey)}`,
    "success URL should preserve the license key"
  );
  assert.equal(
    capturedStripeCheckoutBody.get("cancel_url"),
    `${baseUrl}/onboarding?payment=cancel&licenseKey=${encodeURIComponent(checkoutLicenseKey)}`,
    "cancel URL should preserve the license key"
  );

  const activateCheckoutLicenseResponse = await fetch(`${baseUrl}/v1/admin/license/update-status`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-admin-api-key": process.env.ADMIN_API_KEY,
    },
    body: JSON.stringify({
      licenseKey: checkoutLicenseKey,
      status: "active",
    }),
  });
  assert.equal(activateCheckoutLicenseResponse.status, 200, "admin should activate the checkout license");

  const loginResponse = await fetch(`${baseUrl}/v1/account/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email,
      password,
    }),
  });
  assert.equal(loginResponse.status, 200, "login should succeed");
  const loginBody = await loginResponse.json();
  assert.notEqual(
    loginBody?.account?.licenseKey,
    originalInvalidLicenseKey,
    "login should move the account off the original invalid license"
  );
  assert.equal(
    loginBody?.account?.licenseKey,
    checkoutLicenseKey,
    "login should adopt the paid license created for the same email address"
  );
} finally {
  global.fetch = originalFetch;
  if (harness) {
    await harness.cleanup();
  }
}
