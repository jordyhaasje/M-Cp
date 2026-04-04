import assert from "assert";
import crypto from "crypto";
import net from "net";
import { startLicenseServiceTestServer } from "./helpers/serviceHarness.mjs";

function hashToken(value) {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

function base64UrlEncode(buffer) {
  return Buffer.from(buffer)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function pkceChallenge(verifier) {
  return base64UrlEncode(crypto.createHash("sha256").update(verifier, "utf8").digest());
}

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

const port = await getFreePort();

const accountId = "acct_test_1";
const licenseKey = "HZY-TEST-OAUTH-SECURITY";
const tenantId = "tenant_test_1";
const sessionToken = "hzacct_test_session_token";

const seededState = {
  licenses: {
    [licenseKey]: {
      licenseKey,
      status: "active",
      entitlements: { mutations: true, tools: {} },
      maxActivations: 3,
      boundFingerprints: [],
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      pastDueSince: null,
      canceledAt: null,
      subscription: {
        provider: "stripe",
        status: "active",
        seats: 1,
        metadata: {},
      },
    },
  },
  tenants: {
    [tenantId]: {
      tenantId,
      licenseKey,
      label: "OAuth test tenant",
      shopify: {
        domain: "unit-test-shop.myshopify.com",
        accessToken: "shpat_test",
        clientId: null,
        clientSecret: null,
      },
      subscription: {
        provider: "stripe",
        status: "inactive",
        seats: 1,
        metadata: {},
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  },
  mcpTokens: {},
  oauthClients: {},
  oauthAuthCodes: {},
  oauthRefreshTokens: {},
  accounts: {
    [accountId]: {
      accountId,
      email: "oauth-test@example.test",
      name: "OAuth Test",
      passwordSalt: "unused",
      passwordHash: "unused",
      licenseKey,
      status: "active",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastLoginAt: new Date().toISOString(),
    },
  },
  accountSessions: {
    acctsess_test_1: {
      sessionId: "acctsess_test_1",
      accountId,
      tokenHash: hashToken(sessionToken),
      status: "active",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      lastUsedAt: null,
      userAgent: "test",
      ipHash: null,
    },
  },
};

const baseUrl = `http://127.0.0.1:${port}`;

let harness = null;

try {
  harness = await startLicenseServiceTestServer({
    port,
    publicBaseUrl: baseUrl,
    mcpPublicUrl: `${baseUrl}/mcp`,
    seedState: seededState,
    env: {
      HAZIFY_FREE_MODE: "true",
      ADMIN_API_KEY: "admin-test-key",
      MCP_API_KEY: "mcp-test-key",
      LICENSE_GRACE_HOURS: "0.00003",
      READ_ONLY_GRACE_DAYS: "0.000002",
    },
    cacheBuster: `oauth-security=${Date.now()}`,
  });

  const metadataResponse = await fetch(`${baseUrl}/.well-known/oauth-authorization-server`);
  assert.equal(metadataResponse.status, 200, "metadata endpoint should respond");
  const metadata = await metadataResponse.json();
  assert.deepEqual(
    metadata.code_challenge_methods_supported,
    ["S256"],
    "metadata should advertise S256 only"
  );

  const authorizeCspProbe = await fetch(
    `${baseUrl}/oauth/authorize?client_id=missing-client&redirect_uri=${encodeURIComponent("https://chatgpt.com")}&response_type=code&state=csp-probe&code_challenge=probe&code_challenge_method=S256`,
    {
      method: "GET",
      redirect: "manual",
    }
  );
  const authorizeCsp = authorizeCspProbe.headers.get("content-security-policy") || "";
  assert.match(
    authorizeCsp,
    /form-action[^;]*'self'/,
    "oauth authorize pages should allow same-origin form submissions"
  );
  assert.match(
    authorizeCsp,
    /form-action[^;]*http:\/\/127\.0\.0\.1:\*/,
    "oauth authorize pages should allow loopback callback redirects for native clients"
  );
  assert.match(
    authorizeCsp,
    /form-action[^;]*http:\/\/localhost:\*/,
    "oauth authorize pages should allow localhost callback redirects for native clients"
  );
  assert.match(
    authorizeCsp,
    /form-action[^;]*vscode:/,
    "oauth authorize pages should allow configured custom redirect schemes"
  );
  assert.match(
    authorizeCsp,
    /form-action[^;]*https:\/\/chatgpt\.com/,
    "oauth authorize pages should allow the current https redirect_uri origin for ChatGPT callback redirects"
  );
  assert.match(
    authorizeCsp,
    /frame-ancestors 'self' https:\/\/chatgpt\.com/,
    "oauth authorize pages should explicitly allow trusted LLM hosts as frame ancestors"
  );

  const publicRegisterResponse = await fetch(`${baseUrl}/oauth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: "OAuth Public Default Client",
      redirect_uris: ["http://127.0.0.1:4460/callback"],
      scope: "mcp:tools offline_access",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    }),
  });
  assert.equal(publicRegisterResponse.status, 201, "public DCR registration should succeed");
  const publicClient = await publicRegisterResponse.json();
  assert.equal(
    publicClient.token_endpoint_auth_method,
    "none",
    "DCR should default to public client auth when token_endpoint_auth_method is omitted"
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(publicClient, "client_secret"),
    false,
    "public DCR clients should not receive a client_secret"
  );

  const publicVerifier = "pkce-verifier-public-default-1234567890-pkce-verifier-public-default-1234567890";
  const publicChallenge = pkceChallenge(publicVerifier);
  const publicAuthorize = await fetch(`${baseUrl}/oauth/authorize`, {
    method: "POST",
    redirect: "manual",
    headers: {
      "content-type": "application/json",
      Cookie: `hz_user_session=${sessionToken}`,
    },
    body: JSON.stringify({
      client_id: publicClient.client_id,
      redirect_uri: publicClient.redirect_uris[0],
      response_type: "code",
      state: "public-default-ok",
      decision: "allow",
      shopDomain: "unit-test-shop.myshopify.com",
      code_challenge: publicChallenge,
      code_challenge_method: "S256",
    }),
  });
  assert.equal(publicAuthorize.status, 302, "public authorize with S256 PKCE should succeed");
  const publicLocation = publicAuthorize.headers.get("location") || "";
  const publicLocationUrl = new URL(publicLocation);
  const publicAuthCode = publicLocationUrl.searchParams.get("code");
  assert.ok(publicAuthCode, "public authorization code should be issued");

  const publicToken = await fetch(`${baseUrl}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      grant_type: "authorization_code",
      code: publicAuthCode,
      redirect_uri: publicClient.redirect_uris[0],
      code_verifier: publicVerifier,
      client_id: publicClient.client_id,
    }),
  });
  assert.equal(publicToken.status, 200, "public token exchange without client_secret should succeed");
  const publicTokenBody = await publicToken.json();
  assert.equal(typeof publicTokenBody.access_token, "string");
  assert.equal(typeof publicTokenBody.refresh_token, "string");

  const publicWithSecretVerifier =
    "pkce-verifier-public-with-secret-1234567890-pkce-verifier-public-with-secret-1234567890";
  const publicWithSecretChallenge = pkceChallenge(publicWithSecretVerifier);
  const publicWithSecretAuthorize = await fetch(`${baseUrl}/oauth/authorize`, {
    method: "POST",
    redirect: "manual",
    headers: {
      "content-type": "application/json",
      Cookie: `hz_user_session=${sessionToken}`,
    },
    body: JSON.stringify({
      client_id: publicClient.client_id,
      redirect_uri: publicClient.redirect_uris[0],
      response_type: "code",
      state: "public-default-with-secret-ok",
      decision: "allow",
      shopDomain: "unit-test-shop.myshopify.com",
      code_challenge: publicWithSecretChallenge,
      code_challenge_method: "S256",
    }),
  });
  assert.equal(publicWithSecretAuthorize.status, 302, "public authorize for legacy secret test should succeed");
  const publicWithSecretLocation = publicWithSecretAuthorize.headers.get("location") || "";
  const publicWithSecretAuthCode = new URL(publicWithSecretLocation).searchParams.get("code");
  assert.ok(publicWithSecretAuthCode, "public authorization code should be issued for legacy secret test");

  const publicTokenWithLegacySecret = await fetch(`${baseUrl}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      grant_type: "authorization_code",
      code: publicWithSecretAuthCode,
      redirect_uri: publicClient.redirect_uris[0],
      code_verifier: publicWithSecretVerifier,
      client_id: publicClient.client_id,
      client_secret: "legacy-stored-secret-from-client-cache",
    }),
  });
  assert.equal(
    publicTokenWithLegacySecret.status,
    200,
    "public/native token exchange should stay compatible when client_secret is still sent"
  );
  const publicTokenWithLegacySecretBody = await publicTokenWithLegacySecret.json();
  assert.equal(typeof publicTokenWithLegacySecretBody.access_token, "string");
  assert.equal(typeof publicTokenWithLegacySecretBody.refresh_token, "string");

  const publicRefreshWithLegacySecret = await fetch(`${baseUrl}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      grant_type: "refresh_token",
      refresh_token: publicTokenWithLegacySecretBody.refresh_token,
      client_id: publicClient.client_id,
      client_secret: "legacy-stored-secret-from-client-cache",
    }),
  });
  assert.equal(
    publicRefreshWithLegacySecret.status,
    200,
    "public/native refresh should stay compatible when client_secret is still sent"
  );
  const publicRefreshWithLegacySecretBody = await publicRefreshWithLegacySecret.json();
  assert.equal(typeof publicRefreshWithLegacySecretBody.access_token, "string");

  const registerResponse = await fetch(`${baseUrl}/oauth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: "OAuth Security Test Client",
      redirect_uris: ["http://127.0.0.1:4455/callback"],
      scope: "mcp:tools offline_access",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "client_secret_post",
    }),
  });
  assert.equal(registerResponse.status, 201, "dynamic client registration should succeed");
  const client = await registerResponse.json();
  assert.equal(client.scope, "mcp:tools", "DCR scope should be fixed to mcp:tools");
  assert.equal(typeof client.client_secret, "string", "client_secret should remain string for compatibility");

  const invalidRedirectRegister = await fetch(`${baseUrl}/oauth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: "Invalid Redirect Client",
      redirect_uris: ["javascript:alert('xss')"],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "client_secret_post",
    }),
  });
  assert.equal(
    invalidRedirectRegister.status,
    400,
    "DCR should reject unsupported redirect URI schemes"
  );
  const invalidRedirectBody = await invalidRedirectRegister.json();
  assert.equal(invalidRedirectBody.error, "invalid_client_metadata");

  const invalidRedirectAuthorizePage = await fetch(
    `${baseUrl}/oauth/authorize?client_id=${encodeURIComponent(client.client_id)}&redirect_uri=${encodeURIComponent("https://chatgpt.com")}&response_type=code&state=invalid-redirect&code_challenge=abc123&code_challenge_method=S256`,
    {
      method: "GET",
      headers: {
        Cookie: `hz_user_session=${sessionToken}`,
      },
    }
  );
  assert.equal(
    invalidRedirectAuthorizePage.status,
    400,
    "invalid redirect URI should render validation page"
  );
  const invalidRedirectAuthorizeHtml = await invalidRedirectAuthorizePage.text();
  assert.match(
    invalidRedirectAuthorizeHtml,
    /<form[^>]+id="oauth-authorize-root"[^>]+method="post"/,
    "authorize page should render a POST form for OAuth confirmation"
  );
  assert.match(
    invalidRedirectAuthorizeHtml,
    /action="\/oauth\/authorize\?client_id=/,
    "authorize form action should preserve the original same-origin OAuth request"
  );

  const noPkceAuthorize = await fetch(
    `${baseUrl}/oauth/authorize?client_id=${encodeURIComponent(client.client_id)}&redirect_uri=${encodeURIComponent(client.redirect_uris[0])}&response_type=code&state=no-pkce`,
    {
      method: "GET",
      redirect: "manual",
      headers: {
        Cookie: `hz_user_session=${sessionToken}`,
      },
    }
  );
  assert.equal(noPkceAuthorize.status, 302, "authorize without PKCE should redirect with error");
  const noPkceLocation = noPkceAuthorize.headers.get("location") || "";
  assert.match(noPkceLocation, /error=invalid_request/, "missing PKCE should return invalid_request");

  const getDecisionVerifier =
    "pkce-verifier-get-decision-1234567890-pkce-verifier-get-decision-1234567890";
  const getDecisionChallenge = pkceChallenge(getDecisionVerifier);
  const getDecisionAttempt = await fetch(
    `${baseUrl}/oauth/authorize?client_id=${encodeURIComponent(client.client_id)}&redirect_uri=${encodeURIComponent(
      client.redirect_uris[0]
    )}&response_type=code&state=get-decision-ignored&code_challenge=${encodeURIComponent(
      getDecisionChallenge
    )}&code_challenge_method=S256&decision=allow&shopDomain=${encodeURIComponent(
      "unit-test-shop.myshopify.com"
    )}`,
    {
      method: "GET",
      redirect: "manual",
      headers: {
        Cookie: `hz_user_session=${sessionToken}`,
      },
    }
  );
  assert.equal(getDecisionAttempt.status, 200, "GET decision parameter must not complete authorization");
  assert.equal(getDecisionAttempt.headers.get("location"), null, "GET decision should not redirect with auth code");
  const getDecisionHtml = await getDecisionAttempt.text();
  assert.match(getDecisionHtml, /method="post"/, "authorize page should require POST submission");
  assert.match(
    getDecisionHtml,
    /name="decision" value="allow"/,
    "authorize page should present allow decision as POST form control"
  );

  const resourcefulAuthorizePage = await fetch(
    `${baseUrl}/oauth/authorize?client_id=${encodeURIComponent(client.client_id)}&redirect_uri=${encodeURIComponent(
      client.redirect_uris[0]
    )}&response_type=code&state=resourceful-render&code_challenge=${encodeURIComponent(
      getDecisionChallenge
    )}&code_challenge_method=S256&scope=${encodeURIComponent(
      "mcp:tools"
    )}&resource=${encodeURIComponent(`${baseUrl}/mcp`)}`,
    {
      method: "GET",
      headers: {
        Cookie: `hz_user_session=${sessionToken}`,
      },
    }
  );
  assert.equal(resourcefulAuthorizePage.status, 200, "authorize page with resource should render");
  const resourcefulAuthorizeHtml = await resourcefulAuthorizePage.text();
  assert.match(
    resourcefulAuthorizeHtml,
    /name="resource" value="http:\/\/127\.0\.0\.1:\d+\/mcp"/,
    "authorize page should preserve resource as a hidden field"
  );
  assert.match(
    resourcefulAuthorizeHtml,
    /action="\/oauth\/authorize\?client_id=[^"]+&amp;redirect_uri=[^"]+&amp;response_type=code[^"]*&amp;resource=/,
    "authorize form action should preserve the original query parameters for proxied clients"
  );

  const queryBackedAuthorize = await fetch(
    `${baseUrl}/oauth/authorize?client_id=${encodeURIComponent(client.client_id)}&redirect_uri=${encodeURIComponent(
      client.redirect_uris[0]
    )}&response_type=code&state=query-backed-post&code_challenge=${encodeURIComponent(
      getDecisionChallenge
    )}&code_challenge_method=S256&scope=${encodeURIComponent(
      "mcp:tools"
    )}&resource=${encodeURIComponent(`${baseUrl}/mcp`)}`,
    {
      method: "POST",
      redirect: "manual",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        Cookie: `hz_user_session=${sessionToken}`,
      },
      body: `decision=allow&shopDomain=${encodeURIComponent("unit-test-shop.myshopify.com")}`,
    }
  );
  assert.equal(queryBackedAuthorize.status, 302, "query-preserved authorize POST should succeed");
  const queryBackedLocation = queryBackedAuthorize.headers.get("location") || "";
  const queryBackedLocationUrl = new URL(queryBackedLocation);
  assert.ok(queryBackedLocationUrl.searchParams.get("code"), "query-preserved authorize should issue an auth code");
  assert.equal(
    queryBackedLocationUrl.searchParams.get("state"),
    "query-backed-post",
    "query-preserved authorize should keep the original state"
  );

  const mismatchedQueryAuthorize = await fetch(
    `${baseUrl}/oauth/authorize?client_id=${encodeURIComponent(client.client_id)}&redirect_uri=${encodeURIComponent(
      client.redirect_uris[0]
    )}&response_type=code&state=query-body-mismatch&code_challenge=${encodeURIComponent(
      getDecisionChallenge
    )}&code_challenge_method=S256&scope=${encodeURIComponent(
      "mcp:tools"
    )}&resource=${encodeURIComponent(`${baseUrl}/mcp`)}`,
    {
      method: "POST",
      redirect: "manual",
      headers: {
        "content-type": "application/json",
        Cookie: `hz_user_session=${sessionToken}`,
      },
      body: JSON.stringify({
        client_id: client.client_id,
        redirect_uri: client.redirect_uris[0],
        response_type: "code",
        state: "query-body-mismatch",
        decision: "allow",
        shopDomain: "unit-test-shop.myshopify.com",
        code_challenge: getDecisionChallenge,
        code_challenge_method: "S256",
        scope: "mcp:tools",
        resource: `${baseUrl}/mcp/other`,
      }),
    }
  );
  assert.equal(mismatchedQueryAuthorize.status, 400, "mismatched query/body security fields should be rejected");
  const mismatchedQueryAuthorizeBody = await mismatchedQueryAuthorize.json();
  assert.equal(mismatchedQueryAuthorizeBody.error, "invalid_request");
  assert.match(
    mismatchedQueryAuthorizeBody.error_description || "",
    /resource mismatch between authorize query and form body/,
    "mismatched query/body resource should fail explicitly"
  );

  const plainAuthorize = await fetch(`${baseUrl}/oauth/authorize`, {
    method: "POST",
    redirect: "manual",
    headers: {
      "content-type": "application/json",
      Cookie: `hz_user_session=${sessionToken}`,
    },
    body: JSON.stringify({
      client_id: client.client_id,
      redirect_uri: client.redirect_uris[0],
      response_type: "code",
      state: "plain",
      decision: "allow",
      shopDomain: "unit-test-shop.myshopify.com",
      code_challenge: "plain-challenge",
      code_challenge_method: "plain",
    }),
  });
  assert.equal(plainAuthorize.status, 302, "plain PKCE method should redirect with error");
  const plainLocation = plainAuthorize.headers.get("location") || "";
  assert.match(plainLocation, /error=invalid_request/, "plain PKCE should be rejected");

  const malformedPkceAuthorize = await fetch(`${baseUrl}/oauth/authorize`, {
    method: "POST",
    redirect: "manual",
    headers: {
      "content-type": "application/json",
      Cookie: `hz_user_session=${sessionToken}`,
    },
    body: JSON.stringify({
      client_id: client.client_id,
      redirect_uri: client.redirect_uris[0],
      response_type: "code",
      state: "bad-pkce-format",
      decision: "allow",
      shopDomain: "unit-test-shop.myshopify.com",
      code_challenge: "short",
      code_challenge_method: "S256",
    }),
  });
  assert.equal(malformedPkceAuthorize.status, 302, "malformed PKCE challenge should fail");
  const malformedPkceLocation = malformedPkceAuthorize.headers.get("location") || "";
  assert.match(malformedPkceLocation, /error=invalid_request/, "malformed PKCE should be rejected");

  const verifier = "pkce-verifier-test-1234567890-pkce-verifier-test-1234567890";
  const challenge = pkceChallenge(verifier);
  const allowAuthorize = await fetch(`${baseUrl}/oauth/authorize`, {
    method: "POST",
    redirect: "manual",
    headers: {
      "content-type": "application/json",
      Cookie: `hz_user_session=${sessionToken}`,
    },
    body: JSON.stringify({
      client_id: client.client_id,
      redirect_uri: client.redirect_uris[0],
      response_type: "code",
      state: "ok",
      decision: "allow",
      shopDomain: "unit-test-shop.myshopify.com",
      code_challenge: challenge,
      code_challenge_method: "S256",
    }),
  });
  assert.equal(allowAuthorize.status, 302, "authorize with S256 PKCE should succeed");
  const allowLocation = allowAuthorize.headers.get("location") || "";
  const allowLocationUrl = new URL(allowLocation);
  const authCode = allowLocationUrl.searchParams.get("code");
  assert.ok(authCode, "authorization code should be issued");

  const missingVerifierToken = await fetch(`${baseUrl}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      grant_type: "authorization_code",
      code: authCode,
      redirect_uri: client.redirect_uris[0],
      client_id: client.client_id,
      client_secret: client.client_secret,
    }),
  });
  assert.equal(missingVerifierToken.status, 400, "missing code_verifier should fail");
  const missingVerifierBody = await missingVerifierToken.json();
  assert.equal(missingVerifierBody.error, "invalid_grant");

  const validToken = await fetch(`${baseUrl}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      grant_type: "authorization_code",
      code: authCode,
      redirect_uri: client.redirect_uris[0],
      code_verifier: verifier,
      client_id: client.client_id,
      client_secret: client.client_secret,
    }),
  });
  assert.equal(validToken.status, 200, "valid PKCE token exchange should succeed");
  const tokenBody = await validToken.json();
  assert.equal(tokenBody.scope, "mcp:tools", "token scope should remain fixed");
  assert.equal(typeof tokenBody.access_token, "string");
  assert.equal(typeof tokenBody.refresh_token, "string");

  const legacyVerifier =
    "pkce-verifier-legacy-secretless-1234567890-pkce-verifier-legacy-secretless-1234567890";
  const legacyChallenge = pkceChallenge(legacyVerifier);
  const legacyAuthorize = await fetch(`${baseUrl}/oauth/authorize`, {
    method: "POST",
    redirect: "manual",
    headers: {
      "content-type": "application/json",
      Cookie: `hz_user_session=${sessionToken}`,
    },
    body: JSON.stringify({
      client_id: client.client_id,
      redirect_uri: client.redirect_uris[0],
      response_type: "code",
      state: "legacy-secretless",
      decision: "allow",
      shopDomain: "unit-test-shop.myshopify.com",
      code_challenge: legacyChallenge,
      code_challenge_method: "S256",
    }),
  });
  assert.equal(legacyAuthorize.status, 302, "legacy authorize with S256 PKCE should succeed");
  const legacyLocation = legacyAuthorize.headers.get("location") || "";
  const legacyLocationUrl = new URL(legacyLocation);
  const legacyAuthCode = legacyLocationUrl.searchParams.get("code");
  assert.ok(legacyAuthCode, "legacy authorization code should be issued");

  const legacySecretlessToken = await fetch(`${baseUrl}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      grant_type: "authorization_code",
      code: legacyAuthCode,
      redirect_uri: client.redirect_uris[0],
      code_verifier: legacyVerifier,
      client_id: client.client_id,
    }),
  });
  assert.equal(
    legacySecretlessToken.status,
    200,
    "legacy public/native clients should work without client_secret"
  );
  const legacySecretlessTokenBody = await legacySecretlessToken.json();
  assert.equal(typeof legacySecretlessTokenBody.access_token, "string");
  assert.equal(typeof legacySecretlessTokenBody.refresh_token, "string");

  const legacySecretlessRefresh = await fetch(`${baseUrl}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      grant_type: "refresh_token",
      refresh_token: legacySecretlessTokenBody.refresh_token,
      client_id: client.client_id,
    }),
  });
  assert.equal(
    legacySecretlessRefresh.status,
    200,
    "legacy public/native refresh should succeed without client_secret"
  );
  const legacySecretlessRefreshBody = await legacySecretlessRefresh.json();
  assert.equal(typeof legacySecretlessRefreshBody.access_token, "string");

  const confidentialRegister = await fetch(`${baseUrl}/oauth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: "OAuth Confidential Web Client",
      redirect_uris: ["https://example.com/callback"],
      scope: "mcp:tools offline_access",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "client_secret_post",
    }),
  });
  assert.equal(confidentialRegister.status, 201, "confidential web client registration should succeed");
  const confidentialClient = await confidentialRegister.json();

  const confidentialVerifier =
    "pkce-verifier-confidential-1234567890-pkce-verifier-confidential-1234567890";
  const confidentialChallenge = pkceChallenge(confidentialVerifier);
  const confidentialAuthorize = await fetch(`${baseUrl}/oauth/authorize`, {
    method: "POST",
    redirect: "manual",
    headers: {
      "content-type": "application/json",
      Cookie: `hz_user_session=${sessionToken}`,
    },
    body: JSON.stringify({
      client_id: confidentialClient.client_id,
      redirect_uri: confidentialClient.redirect_uris[0],
      response_type: "code",
      state: "confidential-needs-secret",
      decision: "allow",
      shopDomain: "unit-test-shop.myshopify.com",
      code_challenge: confidentialChallenge,
      code_challenge_method: "S256",
    }),
  });
  assert.equal(confidentialAuthorize.status, 302, "confidential authorize should succeed");
  const confidentialLocation = confidentialAuthorize.headers.get("location") || "";
  const confidentialCode = new URL(confidentialLocation).searchParams.get("code");
  assert.ok(confidentialCode, "confidential authorization code should be issued");

  const confidentialSecretlessToken = await fetch(`${baseUrl}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      grant_type: "authorization_code",
      code: confidentialCode,
      redirect_uri: confidentialClient.redirect_uris[0],
      code_verifier: confidentialVerifier,
      client_id: confidentialClient.client_id,
    }),
  });
  assert.equal(
    confidentialSecretlessToken.status,
    401,
    "confidential HTTPS clients must still provide client_secret"
  );
  const confidentialSecretlessTokenBody = await confidentialSecretlessToken.json();
  assert.equal(confidentialSecretlessTokenBody.error, "invalid_client");

  const introspectActive = await fetch(`${baseUrl}/v1/mcp/token/introspect`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-mcp-api-key": "mcp-test-key",
    },
    body: JSON.stringify({ token: tokenBody.access_token }),
  });
  assert.equal(introspectActive.status, 200, "introspect should respond");
  const introspectActiveBody = await introspectActive.json();
  assert.equal(introspectActiveBody.active, true, "OAuth access token should be active");
  assert.equal(
    Object.prototype.hasOwnProperty.call(introspectActiveBody?.shopify || {}, "accessToken"),
    false,
    "introspection should not expose raw Shopify access tokens"
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(introspectActiveBody?.shopify || {}, "clientSecret"),
    false,
    "introspection should not expose Shopify client secrets"
  );

  const exchangeMissingInternalAuth = await fetch(`${baseUrl}/v1/mcp/token/exchange`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({ token: tokenBody.access_token }),
  });
  assert.equal(
    exchangeMissingInternalAuth.status,
    401,
    "exchange endpoint should require internal x-mcp-api-key auth"
  );

  const exchangeActive = await fetch(`${baseUrl}/v1/mcp/token/exchange`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-mcp-api-key": "mcp-test-key",
    },
    body: JSON.stringify({ token: tokenBody.access_token }),
  });
  assert.equal(exchangeActive.status, 200, "exchange endpoint should respond");
  const exchangeActiveBody = await exchangeActive.json();
  assert.equal(exchangeActiveBody.active, true, "exchange should return active token");
  assert.equal(
    typeof exchangeActiveBody?.shopify?.accessToken,
    "string",
    "exchange should provide Shopify access token for internal service usage"
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(exchangeActiveBody, "license"),
    false,
    "exchange should not include full license payload"
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(exchangeActiveBody?.shopify || {}, "clientSecret"),
    false,
    "exchange should never expose Shopify client secrets"
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(exchangeActiveBody?.shopify || {}, "clientId"),
    false,
    "exchange should not expose Shopify client id when returning access token"
  );

  const updateLicenseStatus = async (status) => {
    const response = await fetch(`${baseUrl}/v1/admin/license/update-status`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-admin-api-key": "admin-test-key",
      },
      body: JSON.stringify({
        licenseKey,
        status,
      }),
    });
    assert.equal(response.status, 200, `admin status update should succeed for ${status}`);
  };

  await updateLicenseStatus("past_due");
  const exchangePastDueWithinGrace = await fetch(`${baseUrl}/v1/mcp/token/exchange`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-mcp-api-key": "mcp-test-key",
    },
    body: JSON.stringify({ token: tokenBody.access_token }),
  });
  assert.equal(exchangePastDueWithinGrace.status, 200, "past_due within grace should allow read token exchange");

  await new Promise((resolve) => setTimeout(resolve, 180));
  const exchangePastDueAfterGrace = await fetch(`${baseUrl}/v1/mcp/token/exchange`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-mcp-api-key": "mcp-test-key",
    },
    body: JSON.stringify({ token: tokenBody.access_token }),
  });
  assert.equal(exchangePastDueAfterGrace.status, 200, "past_due after grace should still allow read token exchange");

  await updateLicenseStatus("active");
  await updateLicenseStatus("canceled");
  const exchangeCanceledWithinGrace = await fetch(`${baseUrl}/v1/mcp/token/exchange`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-mcp-api-key": "mcp-test-key",
    },
    body: JSON.stringify({ token: tokenBody.access_token }),
  });
  assert.equal(
    exchangeCanceledWithinGrace.status,
    200,
    "canceled within read-only grace should allow read token exchange"
  );

  await new Promise((resolve) => setTimeout(resolve, 260));
  const exchangeCanceledAfterGrace = await fetch(`${baseUrl}/v1/mcp/token/exchange`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-mcp-api-key": "mcp-test-key",
    },
    body: JSON.stringify({ token: tokenBody.access_token }),
  });
  assert.equal(exchangeCanceledAfterGrace.status, 403, "canceled after read-only grace should be blocked");
  const exchangeCanceledAfterGraceBody = await exchangeCanceledAfterGrace.json();
  assert.equal(exchangeCanceledAfterGraceBody.error, "license_inactive");
  assert.match(
    exchangeCanceledAfterGraceBody.reason || "",
    /canceled\/unpaid license blocks this operation/,
    "denied canceled exchange should expose machine-readable reason"
  );

  await updateLicenseStatus("active");
  await updateLicenseStatus("unpaid");
  const exchangeUnpaidWithinGrace = await fetch(`${baseUrl}/v1/mcp/token/exchange`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-mcp-api-key": "mcp-test-key",
    },
    body: JSON.stringify({ token: tokenBody.access_token }),
  });
  assert.equal(exchangeUnpaidWithinGrace.status, 200, "unpaid within read-only grace should allow read token exchange");

  await new Promise((resolve) => setTimeout(resolve, 260));
  const exchangeUnpaidAfterGrace = await fetch(`${baseUrl}/v1/mcp/token/exchange`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-mcp-api-key": "mcp-test-key",
    },
    body: JSON.stringify({ token: tokenBody.access_token }),
  });
  assert.equal(exchangeUnpaidAfterGrace.status, 403, "unpaid after read-only grace should be blocked");
  const exchangeUnpaidAfterGraceBody = await exchangeUnpaidAfterGrace.json();
  assert.equal(exchangeUnpaidAfterGraceBody.error, "license_inactive");
  assert.match(
    exchangeUnpaidAfterGraceBody.reason || "",
    /canceled\/unpaid license blocks this operation/,
    "denied unpaid exchange should expose machine-readable reason"
  );

  await updateLicenseStatus("invalid");
  const exchangeInvalid = await fetch(`${baseUrl}/v1/mcp/token/exchange`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-mcp-api-key": "mcp-test-key",
    },
    body: JSON.stringify({ token: tokenBody.access_token }),
  });
  assert.equal(exchangeInvalid.status, 403, "invalid license should block token exchange");
  const exchangeInvalidBody = await exchangeInvalid.json();
  assert.equal(exchangeInvalidBody.error, "license_inactive");
  assert.match(exchangeInvalidBody.reason || "", /invalid license status/);

  await updateLicenseStatus("active");

  const invalidRefreshClient = await fetch(`${baseUrl}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      grant_type: "refresh_token",
      refresh_token: tokenBody.refresh_token,
      client_id: client.client_id,
      client_secret: "invalid-client-secret",
    }),
  });
  assert.equal(invalidRefreshClient.status, 401, "refresh should fail with invalid client credentials");
  const invalidRefreshClientBody = await invalidRefreshClient.json();
  assert.equal(invalidRefreshClientBody.error, "invalid_client");

  const validRefresh = await fetch(`${baseUrl}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      grant_type: "refresh_token",
      refresh_token: tokenBody.refresh_token,
      client_id: client.client_id,
      client_secret: client.client_secret,
    }),
  });
  assert.equal(validRefresh.status, 200, "refresh should succeed with valid client credentials");
  const validRefreshBody = await validRefresh.json();
  assert.equal(validRefreshBody.scope, "mcp:tools");
  assert.equal(typeof validRefreshBody.access_token, "string");

  const replayRefresh = await fetch(`${baseUrl}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      grant_type: "refresh_token",
      refresh_token: tokenBody.refresh_token,
      client_id: client.client_id,
      client_secret: client.client_secret,
    }),
  });
  assert.equal(replayRefresh.status, 400, "reusing old refresh token should fail");
  const replayRefreshBody = await replayRefresh.json();
  assert.equal(replayRefreshBody.error, "invalid_grant");

  const rotatedAfterReplay = await fetch(`${baseUrl}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      grant_type: "refresh_token",
      refresh_token: validRefreshBody.refresh_token,
      client_id: client.client_id,
      client_secret: client.client_secret,
    }),
  });
  assert.equal(
    rotatedAfterReplay.status,
    400,
    "refresh token family should be revoked after replay detection"
  );
  const rotatedAfterReplayBody = await rotatedAfterReplay.json();
  assert.equal(rotatedAfterReplayBody.error, "invalid_grant");

  console.log("oauth-security.test.mjs passed");
} finally {
  if (harness) {
    await harness.cleanup();
  }
}
