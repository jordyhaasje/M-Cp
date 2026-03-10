const DEFAULT_API_VERSION = "2026-01";
const THEME_GRAPHQL_ID_PREFIX = "gid://shopify/OnlineStoreTheme/";

const THEME_LIST_QUERY = `#graphql
  query ThemeList($first: Int!, $roles: [ThemeRole!]) {
    themes(first: $first, roles: $roles) {
      nodes {
        id
        name
        role
        processing
        createdAt
        updatedAt
      }
    }
  }
`;

const THEME_FILE_QUERY = `#graphql
  query ThemeFileById($themeId: ID!, $filenames: [String!]) {
    theme(id: $themeId) {
      id
      name
      role
      processing
      createdAt
      updatedAt
      files(first: 1, filenames: $filenames) {
        nodes {
          filename
          checksumMd5
          contentType
          createdAt
          updatedAt
          size
          body {
            ... on OnlineStoreThemeFileBodyText {
              content
            }
            ... on OnlineStoreThemeFileBodyBase64 {
              contentBase64
            }
            ... on OnlineStoreThemeFileBodyUrl {
              url
            }
          }
        }
        userErrors {
          code
          filename
        }
      }
    }
  }
`;

const THEME_FILES_UPSERT_MUTATION = `#graphql
  mutation ThemeFilesUpsert($themeId: ID!, $files: [OnlineStoreThemeFilesUpsertFileInput!]!) {
    themeFilesUpsert(themeId: $themeId, files: $files) {
      upsertedThemeFiles {
        filename
      }
      job {
        id
      }
      userErrors {
        code
        field
        filename
        message
      }
    }
  }
`;

const THEME_FILES_DELETE_MUTATION = `#graphql
  mutation ThemeFilesDelete($themeId: ID!, $files: [String!]!) {
    themeFilesDelete(themeId: $themeId, files: $files) {
      deletedThemeFiles {
        filename
      }
      userErrors {
        code
        field
        filename
        message
      }
    }
  }
`;

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

const buildAdminGraphqlUrl = ({ domain, apiVersion }) => {
  const normalizedVersion = String(apiVersion || DEFAULT_API_VERSION).trim() || DEFAULT_API_VERSION;
  return `https://${domain}/admin/api/${normalizedVersion}/graphql.json`;
};

const buildErrorWithStatus = (message, status, extras = {}) => {
  const error = new Error(message);
  error.status = status;
  Object.assign(error, extras);
  return error;
};

const extractErrorMessage = (data, fallbackText) => {
  if (data && typeof data === "object") {
    if (typeof data.errors === "string" && data.errors.trim()) {
      return data.errors.trim();
    }
    if (Array.isArray(data.errors) && data.errors.length > 0) {
      const values = data.errors
        .map((entry) => {
          if (typeof entry === "string") {
            return entry;
          }
          if (entry && typeof entry.message === "string") {
            return entry.message;
          }
          return JSON.stringify(entry);
        })
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

const shopifyGraphqlRequest = async (shopifyClient, apiVersion, { query, variables = {}, expectedStatuses = [200] }) => {
  const domain = getShopDomainFromClient(shopifyClient);
  const accessToken = getAccessTokenFromClient(shopifyClient);
  const url = buildAdminGraphqlUrl({ domain, apiVersion });
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": accessToken,
    },
    body: JSON.stringify({ query, variables }),
  });

  const responseText = await response.text();
  let data = null;
  if (responseText) {
    try {
      data = JSON.parse(responseText);
    } catch (_error) {
      throw buildErrorWithStatus(
        `Shopify theme GraphQL response kon niet worden geparsed (${response.status}).`,
        response.status
      );
    }
  }

  if (!expectedStatuses.includes(response.status)) {
    const details = extractErrorMessage(data, responseText);
    throw buildErrorWithStatus(
      `Shopify theme GraphQL request mislukt (${response.status}): ${details}`,
      response.status,
      { graphQLErrors: Array.isArray(data?.errors) ? data.errors : [] }
    );
  }

  if (Array.isArray(data?.errors) && data.errors.length > 0) {
    const details = extractErrorMessage(data, responseText);
    throw buildErrorWithStatus(`Shopify theme GraphQL fout: ${details}`, response.status, {
      graphQLErrors: data.errors,
    });
  }

  return data?.data || {};
};

const normalizeThemeRole = (role) => String(role || "").trim().toLowerCase();

const themeNumericIdToGraphqlId = (themeId) => {
  const numericId = Number(themeId);
  if (!Number.isInteger(numericId) || numericId <= 0) {
    throw new Error(`themeId '${themeId}' is ongeldig. Gebruik een positief numeriek theme ID.`);
  }
  return `${THEME_GRAPHQL_ID_PREFIX}${numericId}`;
};

const themeGraphqlIdToNumericId = (themeId) => {
  const rawId = String(themeId || "").trim();
  const match = rawId.match(/\/(\d+)$/);
  if (!match?.[1]) {
    throw new Error(`Shopify theme GraphQL ID '${rawId}' kon niet naar een numeriek theme ID worden vertaald.`);
  }
  return Number(match[1]);
};

const mapGraphqlTheme = (theme) => ({
  id: themeGraphqlIdToNumericId(theme.id),
  adminGraphqlApiId: theme.id,
  name: theme.name,
  role: normalizeThemeRole(theme.role),
  previewable: null,
  processing: Boolean(theme.processing),
  created_at: theme.createdAt || null,
  updated_at: theme.updatedAt || null,
});

const mapGraphqlThemeFile = (fileNode) => {
  const asset = {
    key: fileNode.filename,
    checksum: fileNode.checksumMd5 || null,
    checksumMd5: fileNode.checksumMd5 || null,
    contentType: fileNode.contentType || null,
    createdAt: fileNode.createdAt || null,
    updatedAt: fileNode.updatedAt || null,
    size: fileNode.size ?? null,
  };

  const body = fileNode.body || {};
  if (typeof body.content === "string") {
    asset.value = body.content;
  }
  if (typeof body.contentBase64 === "string") {
    asset.attachment = body.contentBase64;
  }
  if (typeof body.url === "string") {
    asset.url = body.url;
  }

  return asset;
};

const buildThemeUserError = (context, userErrors) => {
  const details = userErrors
    .map((entry) => entry?.message || entry?.code || entry?.filename || JSON.stringify(entry))
    .filter(Boolean)
    .join(", ");
  return buildErrorWithStatus(`${context}: ${details || "Onbekende fout"}`, 400, { userErrors });
};

const shouldFallbackToRest = (error) => {
  const status = Number(error?.status || 0);
  if ([404, 410, 501].includes(status)) {
    return true;
  }

  const message = String(error?.message || "").toLowerCase();
  return [
    "cannot query field",
    "doesn't exist on type",
    "unknown argument",
    "unknown type",
    "theme graphql response kon niet worden geparsed",
  ].some((fragment) => message.includes(fragment));
};

const withThemeGraphqlFallback = async (graphqlOperation, restOperation) => {
  try {
    return await graphqlOperation();
  } catch (error) {
    if (!shouldFallbackToRest(error)) {
      throw error;
    }
    return restOperation();
  }
};

const listThemesRest = async (shopifyClient, apiVersion = DEFAULT_API_VERSION) => {
  const response = await shopifyRestRequest(shopifyClient, apiVersion, {
    method: "GET",
    path: "/themes.json",
  });
  return Array.isArray(response.data?.themes) ? response.data.themes : [];
};

const getThemeFileRest = async (
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

const upsertThemeFileRest = async (
  shopifyClient,
  apiVersion = DEFAULT_API_VERSION,
  { themeId, themeRole = "main", key, value, attachment, checksum }
) => {
  const theme = await resolveTheme(shopifyClient, apiVersion, { themeId, themeRole });
  const assetInput = { key };

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

const deleteThemeFileRest = async (
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

const assertThemeFileChecksum = async (
  shopifyClient,
  apiVersion = DEFAULT_API_VERSION,
  { themeId, themeRole = "main", key, checksum }
) => {
  try {
    const current = await getThemeFile(shopifyClient, apiVersion, { themeId, themeRole, key });
    const actualChecksum = current?.asset?.checksum || current?.asset?.checksumMd5 || null;
    if (!actualChecksum) {
      throw buildErrorWithStatus(
        `Theme file '${key}' heeft geen bruikbare checksum; conflict-safe write kan niet worden gevalideerd.`,
        409
      );
    }
    if (String(actualChecksum) !== String(checksum)) {
      throw buildErrorWithStatus(
        `Theme file '${key}' is gewijzigd sinds de opgegeven checksum. Verwacht ${checksum}, ontving ${actualChecksum}.`,
        409,
        {
          expectedChecksum: checksum,
          actualChecksum,
        }
      );
    }
  } catch (error) {
    if (Number(error?.status || 0) === 404) {
      throw buildErrorWithStatus(
        `Theme file '${key}' bestaat niet; conflict-safe write kan niet veilig worden uitgevoerd.`,
        409,
        { expectedChecksum: checksum }
      );
    }
    throw error;
  }
};

export const listThemes = async (shopifyClient, apiVersion = DEFAULT_API_VERSION) =>
  withThemeGraphqlFallback(
    async () => {
      const data = await shopifyGraphqlRequest(shopifyClient, apiVersion, {
        query: THEME_LIST_QUERY,
        variables: { first: 50, roles: null },
      });
      const nodes = Array.isArray(data?.themes?.nodes) ? data.themes.nodes : [];
      return nodes.map(mapGraphqlTheme);
    },
    () => listThemesRest(shopifyClient, apiVersion)
  );

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
) =>
  withThemeGraphqlFallback(
    async () => {
      const theme = await resolveTheme(shopifyClient, apiVersion, { themeId, themeRole });
      const data = await shopifyGraphqlRequest(shopifyClient, apiVersion, {
        query: THEME_FILE_QUERY,
        variables: {
          themeId: theme.adminGraphqlApiId || themeNumericIdToGraphqlId(theme.id),
          filenames: [key],
        },
      });

      const fileConnection = data?.theme?.files;
      const userErrors = Array.isArray(fileConnection?.userErrors) ? fileConnection.userErrors : [];
      if (userErrors.length > 0) {
        throw buildThemeUserError(`Shopify theme file '${key}' kon niet worden gelezen`, userErrors);
      }

      const fileNode = Array.isArray(fileConnection?.nodes) ? fileConnection.nodes[0] : null;
      if (!fileNode) {
        throw buildErrorWithStatus(`Theme file '${key}' bestaat niet in theme ${theme.id}.`, 404);
      }

      return {
        theme,
        asset: mapGraphqlThemeFile(fileNode),
      };
    },
    () => getThemeFileRest(shopifyClient, apiVersion, { themeId, themeRole, key })
  );

export const upsertThemeFile = async (
  shopifyClient,
  apiVersion = DEFAULT_API_VERSION,
  { themeId, themeRole = "main", key, value, attachment, checksum }
) => {
  if (checksum !== undefined) {
    await assertThemeFileChecksum(shopifyClient, apiVersion, { themeId, themeRole, key, checksum });
  }

  return withThemeGraphqlFallback(
    async () => {
      const theme = await resolveTheme(shopifyClient, apiVersion, { themeId, themeRole });
      const files = [
        {
          filename: key,
          body: {
            type: typeof attachment === "string" ? "BASE64" : "TEXT",
            value: typeof attachment === "string" ? attachment : value,
          },
        },
      ];
      const data = await shopifyGraphqlRequest(shopifyClient, apiVersion, {
        query: THEME_FILES_UPSERT_MUTATION,
        variables: {
          themeId: theme.adminGraphqlApiId || themeNumericIdToGraphqlId(theme.id),
          files,
        },
      });

      const payload = data?.themeFilesUpsert;
      const userErrors = Array.isArray(payload?.userErrors) ? payload.userErrors : [];
      if (userErrors.length > 0) {
        throw buildThemeUserError(`Shopify theme file '${key}' kon niet worden opgeslagen`, userErrors);
      }

      return {
        theme,
        asset: {
          key,
          value: typeof value === "string" ? value : undefined,
          attachment: typeof attachment === "string" ? attachment : undefined,
          jobId: payload?.job?.id || null,
        },
      };
    },
    () => upsertThemeFileRest(shopifyClient, apiVersion, { themeId, themeRole, key, value, attachment, checksum })
  );
};

export const deleteThemeFile = async (
  shopifyClient,
  apiVersion = DEFAULT_API_VERSION,
  { themeId, themeRole = "main", key }
) =>
  withThemeGraphqlFallback(
    async () => {
      const theme = await resolveTheme(shopifyClient, apiVersion, { themeId, themeRole });
      const data = await shopifyGraphqlRequest(shopifyClient, apiVersion, {
        query: THEME_FILES_DELETE_MUTATION,
        variables: {
          themeId: theme.adminGraphqlApiId || themeNumericIdToGraphqlId(theme.id),
          files: [key],
        },
      });

      const payload = data?.themeFilesDelete;
      const userErrors = Array.isArray(payload?.userErrors) ? payload.userErrors : [];
      if (userErrors.length > 0) {
        throw buildThemeUserError(`Shopify theme file '${key}' kon niet worden verwijderd`, userErrors);
      }

      return { theme, deletedKey: key };
    },
    () => deleteThemeFileRest(shopifyClient, apiVersion, { themeId, themeRole, key })
  );
