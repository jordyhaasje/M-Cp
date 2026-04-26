import assert from "assert";
import crypto from "crypto";
import {
  appendQueryParamsToUrl,
  buildOauthMetadata,
  isAllowedRedirectUri,
  validateOAuthClientAuthentication,
  verifyPkceCodeVerifier,
} from "../src/lib/oauth.js";
import { getMcpScopeCapabilities, normalizeMcpScopeString } from "@hazify/mcp-common";

function hashToken(value) {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

function safeTimingEqual(a, b) {
  const aBuf = Buffer.from(a, "utf8");
  const bBuf = Buffer.from(b, "utf8");
  if (aBuf.length !== bBuf.length) {
    return false;
  }
  return crypto.timingSafeEqual(aBuf, bBuf);
}

assert.equal(isAllowedRedirectUri("https://chatgpt.com/callback"), true, "https should be allowed");
assert.equal(isAllowedRedirectUri("http://127.0.0.1:3333/callback"), true, "loopback should be allowed");
assert.equal(
  isAllowedRedirectUri("cursor://callback", ["cursor", "vscode"]),
  true,
  "configured custom scheme should be allowed"
);
assert.equal(
  isAllowedRedirectUri("javascript:alert(1)", ["cursor", "vscode"]),
  false,
  "unsafe scheme should be rejected"
);

const verifier = "verifier-123456789-verifier-123456789-verifier-123";
const challenge = Buffer.from(crypto.createHash("sha256").update(verifier, "utf8").digest())
  .toString("base64")
  .replace(/\+/g, "-")
  .replace(/\//g, "_")
  .replace(/=+$/g, "");
assert.equal(verifyPkceCodeVerifier(verifier, challenge, "S256"), true, "S256 PKCE should validate");
assert.equal(verifyPkceCodeVerifier("wrong", challenge, "S256"), false, "wrong verifier should fail");

validateOAuthClientAuthentication({
  req: {
    headers: {},
  },
  payload: {
    client_id: "public_client",
  },
  client: {
    clientId: "public_client",
    tokenEndpointAuthMethod: "none",
  },
  hashToken,
  safeTimingEqual,
});

assert.throws(
  () =>
    validateOAuthClientAuthentication({
      req: {
        headers: {},
      },
      payload: {},
      client: {
        clientId: "public_client",
        tokenEndpointAuthMethod: "none",
      },
      hashToken,
      safeTimingEqual,
    }),
  /invalid_client/,
  "public client auth should require client_id"
);

const metadata = buildOauthMetadata({
  issuer: "https://issuer.example",
  serviceDocumentation: "https://issuer.example/onboarding",
});
assert.equal(metadata.authorization_endpoint, "https://issuer.example/oauth/authorize");
assert.equal(metadata.scopes_supported[0], "mcp:tools");
assert.equal(normalizeMcpScopeString("mcp:admin"), "", "unknown MCP scopes must not fall back to full access");
assert.equal(
  getMcpScopeCapabilities("mcp:admin").write,
  false,
  "unknown MCP scopes must fail closed for write access"
);

const urlWithParams = appendQueryParamsToUrl("https://example.com/callback", {
  code: "abc",
  state: "xyz",
});
assert.equal(urlWithParams, "https://example.com/callback?code=abc&state=xyz");

validateOAuthClientAuthentication({
  req: {
    headers: {
      authorization: `Basic ${Buffer.from("client_1:secret_1", "utf8").toString("base64")}`,
    },
  },
  payload: {},
  client: {
    clientId: "client_1",
    clientSecretHash: hashToken("secret_1"),
    tokenEndpointAuthMethod: "client_secret_basic",
  },
  hashToken,
  safeTimingEqual,
});

assert.throws(
  () =>
    validateOAuthClientAuthentication({
      req: {
        headers: {
          authorization: `Basic ${Buffer.from("client_1:wrong", "utf8").toString("base64")}`,
        },
      },
      payload: {},
      client: {
        clientId: "client_1",
        clientSecretHash: hashToken("secret_1"),
        tokenEndpointAuthMethod: "client_secret_basic",
      },
      hashToken,
      safeTimingEqual,
    }),
  /invalid_client/,
  "invalid secret should throw"
);

console.log("oauth-helpers.test.mjs passed");
