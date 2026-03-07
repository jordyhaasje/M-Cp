const DEFAULT_API_VERSION = "2026-01";

const normalizeHeaders = (rawHeaders) => {
  if (!rawHeaders) {
    return new Map();
  }

  if (rawHeaders instanceof Headers) {
    return new Map(Array.from(rawHeaders.entries()).map(([key, value]) => [String(key).toLowerCase(), value]));
  }

  if (Array.isArray(rawHeaders)) {
    return new Map(rawHeaders.map(([key, value]) => [String(key).toLowerCase(), value]));
  }

  if (typeof rawHeaders === "object") {
    return new Map(
      Object.entries(rawHeaders).map(([key, value]) => [String(key).toLowerCase(), value])
    );
  }

  return new Map();
};

const getShopDomainFromClient = (shopifyClient) => {
  const rawUrl = shopifyClient?.url;
  if (!rawUrl || typeof rawUrl !== "string") {
    throw new Error("Shopify client URL ontbreekt; kan theme API endpoint niet bepalen.");
  }

  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch (_error) {
    throw new Error("Shopify client URL is ongeldig; kan theme API endpoint niet bepalen.");
  }

  const domain = String(parsed.hostname || "").trim().toLowerCase();
  if (!domain || !domain.endsWith(".myshopify.com")) {
    throw new Error(`Shopify domein '${domain}' is ongeldig voor Admin API requests.`);
  }
  return domain;
};

const getAccessTokenFromClient = (shopifyClient) => {
  const headers = normalizeHeaders(shopifyClient?.requestConfig?.headers);
  const token = headers.get("x-shopify-access-token");
  if (!token || typeof token !== "string" || !token.trim()) {
    throw new Error("X-Shopify-Access-Token ontbreekt; kan theme API request niet authenticeren.");
  }
  return token.trim();
};

const buildAdminRestUrl = ({ domain, apiVersion, path, query }) => {
  const normalizedVersion = String(apiVersion || DEFAULT_API_VERSION).trim() || DEFAULT_API_VERSION;
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const url = new URL(`https://${domain}/admin/api/${normalizedVersion}${normalizedPath}`);

  if (query && typeof query === "object") {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null) {
        continue;
      }
      url.searchParams.set(key, String(value));
    }
  }

  return url.toString();
};

const buildErrorWithStatus = (message, status) => {
  const error = new Error(message);
  error.status = status;
  return error;
};

const extractErrorMessage = (data, fallbackText) => {
  if (data && typeof data === "object") {
    if (typeof data.errors === "string" && data.errors.trim()) {
      return data.errors.trim();
    }
    if (Array.isArray(data.errors) && data.errors.length > 0) {
      const values = data.errors
        .map((entry) => (typeof entry === "string" ? entry : JSON.stringify(entry)))
        .filter(Boolean);
      if (values.length > 0) {
        return values.join(", ");
      }
    }
  }

  if (typeof fallbackText === "string" && fallbackText.trim()) {
    return fallbackText.trim();
  }

  return "Onbekende fout";
};

const shopifyRestRequest = async (shopifyClient, apiVersion, options) => {
  const { method = "GET", path, query, body, expectedStatuses = [200] } = options;
  const domain = getShopDomainFromClient(shopifyClient);
  const accessToken = getAccessTokenFromClient(shopifyClient);
  const url = buildAdminRestUrl({ domain, apiVersion, path, query });

  const response = await fetch(url, {
    method,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": accessToken,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const responseText = await response.text();
  let data = null;
  if (responseText) {
    try {
      data = JSON.parse(responseText);
    } catch (_error) {
      data = null;
    }
  }

  if (!expectedStatuses.includes(response.status)) {
    const details = extractErrorMessage(data, responseText);
    throw buildErrorWithStatus(
      `Shopify theme API ${method.toUpperCase()} ${path} mislukt (${response.status}): ${details}`,
      response.status
    );
  }

  return {
    status: response.status,
    data: data && typeof data === "object" ? data : {},
  };
};

const normalizeThemeRole = (role) => String(role || "").trim().toLowerCase();

export const listThemes = async (shopifyClient, apiVersion = DEFAULT_API_VERSION) => {
  const response = await shopifyRestRequest(shopifyClient, apiVersion, {
    method: "GET",
    path: "/themes.json",
  });
  return Array.isArray(response.data?.themes) ? response.data.themes : [];
};

export const resolveTheme = async (
  shopifyClient,
  apiVersion = DEFAULT_API_VERSION,
  { themeId, themeRole = "main" } = {}
) => {
  const themes = await listThemes(shopifyClient, apiVersion);

  if (themeId !== undefined && themeId !== null) {
    const normalizedThemeId = Number(themeId);
    if (!Number.isInteger(normalizedThemeId) || normalizedThemeId <= 0) {
      throw new Error(`themeId '${themeId}' is ongeldig. Gebruik een positief numeriek theme ID.`);
    }

    const byId = themes.find((theme) => Number(theme?.id) === normalizedThemeId);
    if (!byId) {
      const knownIds = themes.map((theme) => theme?.id).filter((id) => id !== undefined);
      throw new Error(
        `Theme met ID ${normalizedThemeId} niet gevonden. Beschikbare IDs: ${
          knownIds.length ? knownIds.join(", ") : "geen"
        }.`
      );
    }
    return byId;
  }

  const role = normalizeThemeRole(themeRole) || "main";
  const byRole = themes.find((theme) => normalizeThemeRole(theme?.role) === role);
  if (!byRole) {
    const roles = Array.from(new Set(themes.map((theme) => normalizeThemeRole(theme?.role)).filter(Boolean)));
    throw new Error(
      `Geen theme gevonden met role '${role}'. Beschikbare roles: ${roles.length ? roles.join(", ") : "geen"}.`
    );
  }

  return byRole;
};

export const getThemeFile = async (
  shopifyClient,
  apiVersion = DEFAULT_API_VERSION,
  { themeId, themeRole = "main", key }
) => {
  const theme = await resolveTheme(shopifyClient, apiVersion, { themeId, themeRole });
  const response = await shopifyRestRequest(shopifyClient, apiVersion, {
    method: "GET",
    path: `/themes/${theme.id}/assets.json`,
    query: {
      "asset[key]": key,
    },
  });
  const asset = response.data?.asset;
  if (!asset) {
    throw new Error(`Theme file '${key}' bestaat niet in theme ${theme.id}.`);
  }
  return { theme, asset };
};

export const upsertThemeFile = async (
  shopifyClient,
  apiVersion = DEFAULT_API_VERSION,
  { themeId, themeRole = "main", key, value, attachment, checksum }
) => {
  const theme = await resolveTheme(shopifyClient, apiVersion, { themeId, themeRole });
  const assetInput = {
    key,
  };

  if (value !== undefined) {
    assetInput.value = value;
  }
  if (attachment !== undefined) {
    assetInput.attachment = attachment;
  }
  if (checksum !== undefined) {
    assetInput.checksum = checksum;
  }

  const response = await shopifyRestRequest(shopifyClient, apiVersion, {
    method: "PUT",
    path: `/themes/${theme.id}/assets.json`,
    body: {
      asset: assetInput,
    },
  });

  return {
    theme,
    asset: response.data?.asset || { key },
  };
};

export const deleteThemeFile = async (
  shopifyClient,
  apiVersion = DEFAULT_API_VERSION,
  { themeId, themeRole = "main", key }
) => {
  const theme = await resolveTheme(shopifyClient, apiVersion, { themeId, themeRole });
  await shopifyRestRequest(shopifyClient, apiVersion, {
    method: "DELETE",
    path: `/themes/${theme.id}/assets.json`,
    query: {
      "asset[key]": key,
    },
  });
  return { theme, deletedKey: key };
};
