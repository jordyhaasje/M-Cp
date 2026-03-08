const DEFAULT_REQUIRED_SCOPES = [
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

export const REQUIRED_SHOPIFY_ADMIN_SCOPES = Object.freeze([...DEFAULT_REQUIRED_SCOPES]);

export function normalizeShopDomain(value) {
  const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!raw) {
    return "";
  }
  const withoutProtocol = raw.replace(/^https?:\/\//, "");
  const withoutPath = withoutProtocol.split("/")[0] || "";
  return withoutPath;
}

export function extractShopifyScopeHandles(payload) {
  const rawScopes = Array.isArray(payload?.access_scopes) ? payload.access_scopes : [];
  return rawScopes
    .map((entry) => {
      if (typeof entry === "string") {
        return entry.trim();
      }
      if (entry && typeof entry.handle === "string") {
        return entry.handle.trim();
      }
      return "";
    })
    .filter(Boolean);
}

export function hasRequiredScope(grantedScopes, requiredScope) {
  if (grantedScopes.has(requiredScope)) {
    return true;
  }
  if (requiredScope === "read_orders" && grantedScopes.has("read_all_orders")) {
    return true;
  }
  return false;
}

export function listMissingRequiredScopes(
  grantedScopes,
  requiredScopes = REQUIRED_SHOPIFY_ADMIN_SCOPES
) {
  return requiredScopes.filter((requiredScope) => !hasRequiredScope(grantedScopes, requiredScope));
}

export async function exchangeShopifyClientCredentials(shopify, signal) {
  const response = await fetch(`https://${shopify.domain}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: shopify.clientId,
      client_secret: shopify.clientSecret,
    }),
    signal,
  });

  const bodyText = await response.text();
  if (!response.ok) {
    if (response.status === 400 && /app_not_installed/i.test(bodyText)) {
      throw new Error(
        `Shopify app is niet geauthoriseerd op ${shopify.domain}. Installeer/autoriseren en probeer opnieuw.`
      );
    }
    throw new Error(
      `Shopify token exchange mislukt (${response.status}). Controleer shopClientId/shopClientSecret.`
    );
  }

  let parsed;
  try {
    parsed = bodyText ? JSON.parse(bodyText) : {};
  } catch (_error) {
    throw new Error("Shopify token exchange gaf geen geldige JSON terug.");
  }

  const token =
    typeof parsed?.access_token === "string" && parsed.access_token.trim()
      ? parsed.access_token.trim()
      : "";
  if (!token) {
    throw new Error("Shopify token exchange gaf geen access_token terug.");
  }

  return {
    accessToken: token,
    expiresInSeconds:
      Number.isFinite(Number(parsed?.expires_in)) && Number(parsed.expires_in) > 0
        ? Number(parsed.expires_in)
        : null,
  };
}

export async function fetchShopifyGrantedScopes(domain, accessToken, signal) {
  const response = await fetch(`https://${domain}/admin/oauth/access_scopes.json`, {
    method: "GET",
    headers: {
      Accept: "application/json",
      "X-Shopify-Access-Token": accessToken,
    },
    signal,
  });

  const bodyText = await response.text();
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new Error(
        `Shopify token heeft geen toegang tot ${domain}. Controleer app-installatie en credentials.`
      );
    }
    throw new Error(`Shopify access scopes ophalen mislukt (${response.status}).`);
  }

  let parsed;
  try {
    parsed = bodyText ? JSON.parse(bodyText) : {};
  } catch (_error) {
    throw new Error("Shopify access scopes endpoint gaf geen geldige JSON terug.");
  }

  return new Set(extractShopifyScopeHandles(parsed));
}

export async function validateShopifyCredentialsLive(shopify, options = {}) {
  const timeoutMs =
    Number.isFinite(Number(options.timeoutMs)) && Number(options.timeoutMs) > 0
      ? Number(options.timeoutMs)
      : 10000;
  const requiredScopes = Array.isArray(options.requiredScopes)
    ? options.requiredScopes
    : REQUIRED_SHOPIFY_ADMIN_SCOPES;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const tokenResult = shopify.accessToken
      ? { accessToken: shopify.accessToken, expiresInSeconds: null }
      : await exchangeShopifyClientCredentials(shopify, controller.signal);

    const grantedScopes = await fetchShopifyGrantedScopes(
      shopify.domain,
      tokenResult.accessToken,
      controller.signal
    );

    const missingScopes = listMissingRequiredScopes(grantedScopes, requiredScopes);
    if (missingScopes.length > 0) {
      throw new Error(
        `Shopify app mist vereiste Admin API scopes: ${missingScopes.join(
          ", "
        )}. Voeg deze scopes toe en installeer de app opnieuw.`
      );
    }

    return {
      accessToken: tokenResult.accessToken,
      expiresInSeconds: tokenResult.expiresInSeconds,
      grantedScopes,
    };
  } catch (error) {
    if (error && error.name === "AbortError") {
      throw new Error("Shopify validatie time-out. Controleer netwerkverbinding en probeer opnieuw.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
