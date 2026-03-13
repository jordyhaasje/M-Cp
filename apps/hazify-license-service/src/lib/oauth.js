import crypto from "crypto";
import { URL } from "url";

function isAllowedRedirectUri(uriValue, allowedCustomRedirectSchemes = []) {
  if (typeof uriValue !== "string" || !uriValue.trim()) {
    return false;
  }
  try {
    const url = new URL(uriValue);
    const protocol = String(url.protocol || "").toLowerCase();
    if (protocol === "https:") {
      return true;
    }
    if (protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1")) {
      return true;
    }
    const customScheme = protocol.endsWith(":") ? protocol.slice(0, -1) : "";
    if (customScheme && allowedCustomRedirectSchemes.includes(customScheme)) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

function buildOauthMetadata({ issuer, serviceDocumentation }) {
  return {
    issuer,
    authorization_endpoint: `${issuer}/oauth/authorize`,
    token_endpoint: `${issuer}/oauth/token`,
    registration_endpoint: `${issuer}/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    token_endpoint_auth_methods_supported: ["none", "client_secret_post", "client_secret_basic"],
    code_challenge_methods_supported: ["S256"],
    scopes_supported: ["mcp:tools"],
    service_documentation: serviceDocumentation,
  };
}

function readFormEncodedBody(rawBody) {
  const params = new URLSearchParams(rawBody);
  const payload = {};
  for (const [key, value] of params.entries()) {
    if (Object.prototype.hasOwnProperty.call(payload, key)) {
      const current = payload[key];
      payload[key] = Array.isArray(current) ? [...current, value] : [current, value];
    } else {
      payload[key] = value;
    }
  }
  return payload;
}

async function readJsonOrFormBody(req, readBody) {
  const contentType = String(req.headers["content-type"] || "").toLowerCase();
  const { raw } = await readBody(req, true);
  const text = raw || "";
  if (!text.trim()) {
    return {};
  }
  if (contentType.includes("application/json")) {
    try {
      return JSON.parse(text);
    } catch {
      throw new Error("Invalid JSON body");
    }
  }
  if (contentType.includes("application/x-www-form-urlencoded")) {
    return readFormEncodedBody(text);
  }
  try {
    return JSON.parse(text);
  } catch {
    return readFormEncodedBody(text);
  }
}

function base64UrlEncode(input) {
  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(String(input), "utf8");
  return buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function verifyPkceCodeVerifier(codeVerifier, challenge, method) {
  const verifier = typeof codeVerifier === "string" ? codeVerifier.trim() : "";
  if (!verifier) {
    return false;
  }
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) {
    return false;
  }
  if (typeof challenge !== "string" || !/^[A-Za-z0-9_-]{43,128}$/.test(challenge)) {
    return false;
  }
  const normalizedMethod = typeof method === "string" && method.trim() ? method.trim() : "plain";
  if (normalizedMethod === "S256") {
    const digest = crypto.createHash("sha256").update(verifier, "utf8").digest();
    return base64UrlEncode(digest) === challenge;
  }
  if (normalizedMethod === "plain") {
    return verifier === challenge;
  }
  return false;
}

function appendQueryParamsToUrl(urlValue, params) {
  const url = new URL(urlValue);
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== undefined && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

function parseBasicClientAuth(req) {
  const authHeader = req.headers.authorization;
  if (typeof authHeader !== "string") {
    return null;
  }
  const match = authHeader.match(/^Basic\s+(.+)$/i);
  if (!match?.[1]) {
    return null;
  }
  try {
    const decoded = Buffer.from(match[1], "base64").toString("utf8");
    const separator = decoded.indexOf(":");
    if (separator < 0) {
      return null;
    }
    return {
      clientId: decoded.slice(0, separator),
      clientSecret: decoded.slice(separator + 1),
    };
  } catch {
    return null;
  }
}

function resolveClientCredentials(req, payload) {
  const basic = parseBasicClientAuth(req);
  if (basic?.clientId) {
    return basic;
  }
  return {
    clientId: typeof payload.client_id === "string" ? payload.client_id.trim() : "",
    clientSecret: typeof payload.client_secret === "string" ? payload.client_secret : "",
  };
}

function validateOAuthClientAuthentication({
  req,
  payload,
  client,
  hashToken,
  safeTimingEqual,
}) {
  const method =
    typeof client.tokenEndpointAuthMethod === "string" && client.tokenEndpointAuthMethod
      ? client.tokenEndpointAuthMethod
      : "none";
  const creds = resolveClientCredentials(req, payload);
  if (method === "none") {
    if (!creds.clientId || creds.clientId !== client.clientId) {
      throw new Error("invalid_client");
    }
    if (creds.clientSecret) {
      throw new Error("invalid_client");
    }
    return;
  }
  if (!creds.clientId || !creds.clientSecret) {
    throw new Error("invalid_client");
  }
  if (creds.clientId !== client.clientId) {
    throw new Error("invalid_client");
  }
  if (!client.clientSecretHash || !safeTimingEqual(hashToken(creds.clientSecret), client.clientSecretHash)) {
    throw new Error("invalid_client");
  }
}

function oauthJsonError(res, statusCode, error, description, jsonResponder) {
  return jsonResponder(res, statusCode, {
    error,
    error_description: description,
  });
}

export {
  appendQueryParamsToUrl,
  base64UrlEncode,
  buildOauthMetadata,
  isAllowedRedirectUri,
  oauthJsonError,
  parseBasicClientAuth,
  readFormEncodedBody,
  readJsonOrFormBody,
  resolveClientCredentials,
  validateOAuthClientAuthentication,
  verifyPkceCodeVerifier,
};
