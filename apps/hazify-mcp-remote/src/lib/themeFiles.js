import crypto from "crypto";
import { tryAcquireThemeFileLock } from "./db.js";

const DEFAULT_API_VERSION = "2026-01";
const THEME_GRAPHQL_ID_PREFIX = "gid://shopify/OnlineStoreTheme/";
const MAX_THEME_FILES_PER_REQUEST = 10;
const MAX_UPSERT_FILES_PER_CHUNK = 10;
const MAX_READ_KEYS_PER_CHUNK = 10;

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

const THEME_BY_ID_QUERY = `#graphql
  query ThemeById($themeId: ID!) {
    theme(id: $themeId) {
      id
      name
      role
      processing
      createdAt
      updatedAt
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

const THEME_FILES_WITH_CONTENT_QUERY = `#graphql
  query ThemeFilesByIdWithContent($themeId: ID!, $first: Int!, $filenames: [String!]) {
    theme(id: $themeId) {
      id
      name
      role
      processing
      createdAt
      updatedAt
      files(first: $first, filenames: $filenames) {
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

const THEME_FILES_METADATA_QUERY = `#graphql
  query ThemeFilesByIdMetadata($themeId: ID!, $first: Int!, $filenames: [String!]) {
    theme(id: $themeId) {
      id
      name
      role
      processing
      createdAt
      updatedAt
      files(first: $first, filenames: $filenames) {
        nodes {
          filename
          checksumMd5
          contentType
          createdAt
          updatedAt
          size
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

export const getShopDomainFromClient = (shopifyClient) => {
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

export const getAccessTokenFromClient = (shopifyClient) => {
  const headers = normalizeHeaders(shopifyClient?.requestConfig?.headers);
  const token = headers.get("x-shopify-access-token");
  if (!token || typeof token !== "string" || !token.trim()) {
    throw new Error("X-Shopify-Access-Token ontbreekt; kan theme API request niet authenticeren.");
  }
  return token.trim();
};

export const buildAdminRestUrl = ({ domain, apiVersion, path, query }) => {
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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const shopifyRestRequest = async (shopifyClient, apiVersion, options, retryCount = 0) => {
  const MAX_RETRIES = 3;
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
  
  if (response.status === 429) {
    if (retryCount < MAX_RETRIES) {
      // Typically Shopify uses 'Retry-After' header in seconds for REST
      let delayMs = 2000 * Math.pow(2, retryCount); // Exponential backoff default
      const retryAfterHeader = response.headers.get("retry-after");
      if (retryAfterHeader) {
        const parsed = parseFloat(retryAfterHeader);
        if (!isNaN(parsed) && parsed > 0) {
          delayMs = parsed * 1000;
        }
      }
      console.warn(`[REST Rate Limit] 429 received. Retrying in ${delayMs}ms... (Attempt ${retryCount + 1}/${MAX_RETRIES})`);
      await sleep(delayMs);
      return shopifyRestRequest(shopifyClient, apiVersion, options, retryCount + 1);
    }
  }

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
    throw buildThemeApiError(
      `Shopify theme API ${method.toUpperCase()} ${path} mislukt`,
      [details],
      response.status,
      { responseData: data }
    );
  }

  return {
    status: response.status,
    data: data && typeof data === "object" ? data : {},
  };
};

const shopifyGraphqlRequest = async (shopifyClient, apiVersion, { query, variables = {}, expectedStatuses = [200] }, retryCount = 0) => {
  const MAX_RETRIES = 3;
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
  
  // Handing HTTP 429 for GraphQL (though sometimes it returns 200 with throttled errors)
  if (response.status === 429 && retryCount < MAX_RETRIES) {
    const delayMs = 2000 * Math.pow(2, retryCount);
    console.warn(`[GraphQL Rate Limit] 429 received. Retrying in ${delayMs}ms... (Attempt ${retryCount + 1}/${MAX_RETRIES})`);
    await sleep(delayMs);
    return shopifyGraphqlRequest(shopifyClient, apiVersion, { query, variables, expectedStatuses }, retryCount + 1);
  }

  let data = null;
  if (responseText) {
    try {
      data = JSON.parse(responseText);
    } catch (_error) {
      throw buildErrorWithStatus(
        `Shopify theme GraphQL response kon niet worden geparsed (${response.status}). Response fragment (max 250 tekens): ${responseText.substring(0, 250)}`,
        response.status
      );
    }
  }

  // Handle GraphQL specific throttling if it comes back as 200 but has Throttled errors
  if (data && Array.isArray(data.errors) && data.errors.some(e => e.extensions?.code === "THROTTLED")) {
    if (retryCount < MAX_RETRIES) {
      const delayMs = 2000 * Math.pow(2, retryCount);
      console.warn(`[GraphQL Throttled] Query throttled. Retrying in ${delayMs}ms... (Attempt ${retryCount + 1}/${MAX_RETRIES})`);
      await sleep(delayMs);
      return shopifyGraphqlRequest(shopifyClient, apiVersion, { query, variables, expectedStatuses }, retryCount + 1);
    }
  }

  if (!expectedStatuses.includes(response.status)) {
    const details = extractErrorMessage(data, responseText);
    throw buildThemeApiError("Shopify theme GraphQL request mislukt", [details], response.status, {
      graphQLErrors: Array.isArray(data?.errors) ? data.errors : [],
    });
  }

  if (Array.isArray(data?.errors) && data.errors.length > 0) {
    const details = collectThemeErrorMessages(data.errors);
    throw buildThemeApiError("Shopify theme GraphQL fout", details, response.status, {
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

const mapRestTheme = (theme) => ({
  id: Number(theme?.id),
  adminGraphqlApiId:
    typeof theme?.admin_graphql_api_id === "string" && theme.admin_graphql_api_id
      ? theme.admin_graphql_api_id
      : undefined,
  name: theme?.name || null,
  role: normalizeThemeRole(theme?.role),
  previewable: theme?.previewable ?? null,
  processing: Boolean(theme?.processing),
  created_at: theme?.created_at || null,
  updated_at: theme?.updated_at || null,
});

const mapGraphqlThemeFile = (fileNode) => {
  const asset = {
    key: fileNode.filename,
    found: true,
    missing: false,
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

const mapRestThemeAsset = (asset) => ({
  key: asset?.key || null,
  found: true,
  missing: false,
  checksum: asset?.checksum || null,
  checksumMd5: asset?.checksum || null,
  contentType: asset?.content_type || null,
  createdAt: asset?.created_at || null,
  updatedAt: asset?.updated_at || null,
  size: asset?.size ?? null,
  ...(typeof asset?.value === "string" ? { value: asset.value } : {}),
  ...(typeof asset?.attachment === "string" ? { attachment: asset.attachment } : {}),
  ...(typeof asset?.public_url === "string" ? { url: asset.public_url } : {}),
});

const createMissingThemeAsset = (key) => ({
  key,
  found: false,
  missing: true,
  checksum: null,
  checksumMd5: null,
  contentType: null,
  createdAt: null,
  updatedAt: null,
  size: null,
});

const chunkArray = (items, chunkSize) => {
  const chunks = [];
  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }
  return chunks;
};

const ensureUnique = (values, label) => {
  const seen = new Set();
  for (const value of values) {
    if (seen.has(value)) {
      throw new Error(`${label} bevat dubbele waarde '${value}'.`);
    }
    seen.add(value);
  }
};

const normalizeResultError = (error) => ({
  message: error instanceof Error ? error.message : String(error),
  status: Number(error?.status || 0) || null,
});

const createExpectedSizeFromInputFile = (file) => {
  if (typeof file?.attachment === "string") {
    return Buffer.from(file.attachment, "base64").length;
  }
  return Buffer.byteLength(String(file?.value || ""), "utf8");
};

const createChecksumMd5Base64 = (file) => {
  const payload =
    typeof file?.attachment === "string"
      ? Buffer.from(file.attachment, "base64")
      : Buffer.from(String(file?.value || ""), "utf8");
  return crypto.createHash("md5").update(payload).digest("base64");
};

const collectThemeErrorMessages = (entries) =>
  entries
    .map((entry) => {
      if (!entry) {
        return null;
      }
      const filename = typeof entry.filename === "string" && entry.filename.trim() ? entry.filename.trim() : "";
      const message =
        typeof entry.message === "string" && entry.message.trim()
          ? entry.message.trim()
          : typeof entry.code === "string" && entry.code.trim()
          ? entry.code.trim()
          : JSON.stringify(entry);
      return filename ? `${filename}: ${message}` : message;
    })
    .filter(Boolean);

const buildThemeApiError = (context, messages = [], status = 400, extras = {}) => {
  const details = messages.filter(Boolean).join(", ");
  const normalized = details.toLowerCase();

  if (normalized.includes("write_themes")) {
    return buildErrorWithStatus(
      `${context}: Shopify app mist write_themes scope. Voeg write_themes toe en autoriseer de app opnieuw.`,
      403,
      { ...extras, reason: "missing_write_themes" }
    );
  }

  if (
    normalized.includes("exemption") ||
    normalized.includes("not approved") ||
    normalized.includes("theme app extension")
  ) {
    return buildErrorWithStatus(
      `${context}: Shopify blokkeert deze theme-write zonder geldige exemption of toegestane app-configuratie.`,
      403,
      { ...extras, reason: "theme_write_exemption_required" }
    );
  }

  if (
    normalized.includes("checksum") ||
    normalized.includes("precondition") ||
    normalized.includes("etag") ||
    normalized.includes("conflict")
  ) {
    return buildErrorWithStatus(
      `${context}: checksum/precondition mismatch. Lees het bestand opnieuw en probeer de write daarna opnieuw.`,
      409,
      { ...extras, reason: "checksum_mismatch" }
    );
  }

  if (status === 404 || normalized.includes("not found") || normalized.includes("bestaat niet")) {
    return buildErrorWithStatus(
      `${context}: theme of bestand niet gevonden. Controleer themeId/themeRole en bestandsnaam.`,
      404,
      { ...extras, reason: "theme_or_file_not_found" }
    );
  }

  return buildErrorWithStatus(`${context}: ${details || "Onbekende fout"}`, status, extras);
};

const buildThemeUserError = (context, userErrors) =>
  buildThemeApiError(context, collectThemeErrorMessages(userErrors), 400, { userErrors });

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

const validateCoreFileUpsert = (key, value, attachment) => {
  if (key === "layout/theme.liquid" && typeof value === "string") {
    if (!value.includes("content_for_header") || !value.includes("content_for_layout")) {
      throw buildErrorWithStatus(
        `Veiligheidsblokkade: ${key} moet verplicht '{{ content_for_header }}' en '{{ content_for_layout }}' bevatten. Dit voorkomt dat het hoofdthema stukgaat.`,
        400
      );
    }
  }
};

const validateCoreFileDelete = (key) => {
  if (key === "layout/theme.liquid") {
    throw buildErrorWithStatus(
      `Veiligheidsblokkade: ${key} is een core-bestand en mag NOOIT via deze tool verwijderd worden ter bescherming van de webshop.`,
      400
    );
  }
};

const listThemesRest = async (shopifyClient, apiVersion = DEFAULT_API_VERSION) => {
  const response = await shopifyRestRequest(shopifyClient, apiVersion, {
    method: "GET",
    path: "/themes.json",
  });
  const themes = Array.isArray(response.data?.themes) ? response.data.themes : [];
  return themes.map(mapRestTheme);
};

const getThemeByIdRest = async (shopifyClient, apiVersion = DEFAULT_API_VERSION, themeId) => {
  const response = await shopifyRestRequest(shopifyClient, apiVersion, {
    method: "GET",
    path: `/themes/${themeId}.json`,
  });
  const theme = response.data?.theme;
  if (!theme) {
    throw buildErrorWithStatus(`Theme met ID ${themeId} niet gevonden.`, 404);
  }
  return mapRestTheme(theme);
};

const getThemeFileRestByTheme = async (
  shopifyClient,
  apiVersion = DEFAULT_API_VERSION,
  { theme, key }
) => {
  const response = await shopifyRestRequest(shopifyClient, apiVersion, {
    method: "GET",
    path: `/themes/${theme.id}/assets.json`,
    query: {
      "asset[key]": key,
    },
  });
  const asset = response.data?.asset;
  if (!asset) {
    throw buildErrorWithStatus(`Theme file '${key}' bestaat niet in theme ${theme.id}.`, 404);
  }
  return { theme, asset: mapRestThemeAsset(asset) };
};

const getThemeFileRest = async (
  shopifyClient,
  apiVersion = DEFAULT_API_VERSION,
  { themeId, themeRole = "main", key }
) => {
  const theme = await resolveTheme(shopifyClient, apiVersion, { themeId, themeRole });
  return getThemeFileRestByTheme(shopifyClient, apiVersion, { theme, key });
};

const upsertThemeFileRestByTheme = async (
  shopifyClient,
  apiVersion = DEFAULT_API_VERSION,
  { theme, key, value, attachment, checksum }
) => {
  validateCoreFileUpsert(key, value, attachment);

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
    asset: response.data?.asset ? mapRestThemeAsset(response.data.asset) : { key },
  };
};

const upsertThemeFileRest = async (
  shopifyClient,
  apiVersion = DEFAULT_API_VERSION,
  { themeId, themeRole = "main", key, value, attachment, checksum }
) => {
  const theme = await resolveTheme(shopifyClient, apiVersion, { themeId, themeRole });
  return upsertThemeFileRestByTheme(shopifyClient, apiVersion, { theme, key, value, attachment, checksum });
};

const deleteThemeFileRestByTheme = async (
  shopifyClient,
  apiVersion = DEFAULT_API_VERSION,
  { theme, key }
) => {
  validateCoreFileDelete(key);

  await shopifyRestRequest(shopifyClient, apiVersion, {
    method: "DELETE",
    path: `/themes/${theme.id}/assets.json`,
    query: {
      "asset[key]": key,
    },
  });
  return { theme, deletedKey: key };
};

const deleteThemeFileRest = async (
  shopifyClient,
  apiVersion = DEFAULT_API_VERSION,
  { themeId, themeRole = "main", key }
) => {
  const theme = await resolveTheme(shopifyClient, apiVersion, { themeId, themeRole });
  return deleteThemeFileRestByTheme(shopifyClient, apiVersion, { theme, key });
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

const getThemeByIdGraphql = async (shopifyClient, apiVersion = DEFAULT_API_VERSION, themeId) => {
  const data = await shopifyGraphqlRequest(shopifyClient, apiVersion, {
    query: THEME_BY_ID_QUERY,
    variables: {
      themeId: themeNumericIdToGraphqlId(themeId),
    },
  });

  const themeNode = data?.theme;
  if (!themeNode) {
    throw buildErrorWithStatus(`Theme met ID ${themeId} niet gevonden.`, 404);
  }
  return mapGraphqlTheme(themeNode);
};

const getThemeFilesGraphql = async (
  shopifyClient,
  apiVersion = DEFAULT_API_VERSION,
  { theme, keys, includeContent = false }
) => {
  const resultByKey = new Map();
  for (const keyChunk of chunkArray(keys, MAX_READ_KEYS_PER_CHUNK)) {
    const data = await shopifyGraphqlRequest(shopifyClient, apiVersion, {
      query: includeContent ? THEME_FILES_WITH_CONTENT_QUERY : THEME_FILES_METADATA_QUERY,
      variables: {
        themeId: theme.adminGraphqlApiId || themeNumericIdToGraphqlId(theme.id),
        first: keyChunk.length,
        filenames: keyChunk,
      },
    });
    const fileConnection = data?.theme?.files;
    const userErrors = Array.isArray(fileConnection?.userErrors) ? fileConnection.userErrors : [];
    if (userErrors.length > 0) {
      const blockingUserErrors = [];
      for (const userError of userErrors) {
        const filename = typeof userError?.filename === "string" ? userError.filename : null;
        const code = String(userError?.code || "").toUpperCase();
        const message = String(userError?.message || "");
        const isNotFound =
          filename &&
          (code === "NOT_FOUND" || /not[\s_-]*found|bestaat niet/i.test(message));

        if (isNotFound) {
          resultByKey.set(filename, createMissingThemeAsset(filename));
          continue;
        }

        blockingUserErrors.push(userError);
      }

      if (blockingUserErrors.length > 0) {
        throw buildThemeUserError("Shopify theme files konden niet worden gelezen", blockingUserErrors);
      }
    }

    const nodes = Array.isArray(fileConnection?.nodes) ? fileConnection.nodes : [];
    for (const node of nodes) {
      if (!node?.filename) {
        continue;
      }
      resultByKey.set(node.filename, mapGraphqlThemeFile(node));
    }
  }

  return keys.map((key) => resultByKey.get(key) || createMissingThemeAsset(key));
};

const getThemeFilesRest = async (
  shopifyClient,
  apiVersion = DEFAULT_API_VERSION,
  { theme, keys, includeContent = false }
) => {
  const assets = [];
  for (const key of keys) {
    try {
      const result = await getThemeFileRestByTheme(shopifyClient, apiVersion, { theme, key });
      const asset = { ...result.asset };
      if (!includeContent) {
        delete asset.value;
        delete asset.attachment;
        delete asset.url;
      }
      assets.push(asset);
    } catch (error) {
      if (Number(error?.status || 0) === 404) {
        assets.push(createMissingThemeAsset(key));
        continue;
      }
      throw error;
    }
  }
  return assets;
};

const verifyThemeFilesAgainstExpected = ({ expected, actualAssetsByKey }) => {
  const results = expected.map((entry) => {
    const actual = actualAssetsByKey.get(entry.key) || null;
    if (!actual || actual.missing) {
      return {
        key: entry.key,
        status: "missing",
        expected: {
          size: entry.size ?? null,
          checksumMd5: entry.checksumMd5 ?? null,
        },
        actual: null,
      };
    }

    const mismatches = [];
    if (entry.size !== undefined && Number(actual.size) !== Number(entry.size)) {
      mismatches.push("size");
    }
    if (entry.checksumMd5 !== undefined && String(actual.checksumMd5 || "") !== String(entry.checksumMd5)) {
      mismatches.push("checksumMd5");
    }

    return {
      key: entry.key,
      status: mismatches.length === 0 ? "match" : "mismatch",
      mismatches,
      expected: {
        size: entry.size ?? null,
        checksumMd5: entry.checksumMd5 ?? null,
      },
      actual: {
        size: actual.size ?? null,
        checksumMd5: actual.checksumMd5 ?? null,
        contentType: actual.contentType ?? null,
        updatedAt: actual.updatedAt ?? null,
      },
    };
  });

  const summary = results.reduce(
    (acc, result) => {
      acc.total += 1;
      if (result.status === "match") {
        acc.match += 1;
      } else if (result.status === "mismatch") {
        acc.mismatch += 1;
      } else if (result.status === "missing") {
        acc.missing += 1;
      }
      return acc;
    },
    { total: 0, match: 0, mismatch: 0, missing: 0 }
  );

  return { summary, results };
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
  if (themeId !== undefined && themeId !== null) {
    const normalizedThemeId = Number(themeId);
    if (!Number.isInteger(normalizedThemeId) || normalizedThemeId <= 0) {
      throw new Error(`themeId '${themeId}' is ongeldig. Gebruik een positief numeriek theme ID.`);
    }

    return withThemeGraphqlFallback(
      () => getThemeByIdGraphql(shopifyClient, apiVersion, normalizedThemeId),
      () => getThemeByIdRest(shopifyClient, apiVersion, normalizedThemeId)
    );
  }

  const themes = await listThemes(shopifyClient, apiVersion);
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

export const getThemeFiles = async (
  shopifyClient,
  apiVersion = DEFAULT_API_VERSION,
  { themeId, themeRole = "main", keys = [], includeContent = false }
) => {
  if (!Array.isArray(keys) || keys.length === 0) {
    throw new Error("keys moet minimaal 1 item bevatten.");
  }
  if (keys.length > MAX_THEME_FILES_PER_REQUEST) {
    throw new Error(`Maximaal ${MAX_THEME_FILES_PER_REQUEST} keys toegestaan per request.`);
  }

  const normalizedKeys = keys.map((key) => String(key || "").trim()).filter(Boolean);
  if (normalizedKeys.length !== keys.length) {
    throw new Error("Elke key in keys[] moet een niet-lege string zijn.");
  }
  ensureUnique(normalizedKeys, "keys");

  const theme = await resolveTheme(shopifyClient, apiVersion, { themeId, themeRole });
  const files = await withThemeGraphqlFallback(
    () => getThemeFilesGraphql(shopifyClient, apiVersion, { theme, keys: normalizedKeys, includeContent }),
    () => getThemeFilesRest(shopifyClient, apiVersion, { theme, keys: normalizedKeys, includeContent })
  );

  return { theme, files };
};

export const searchThemeFiles = async (
  shopifyClient,
  apiVersion = DEFAULT_API_VERSION,
  { themeId, themeRole = "main", patterns = [], keys = [], includeContent = false, resultLimit = 20 }
) => {
  const hasPatterns = Array.isArray(patterns) && patterns.length > 0;
  const hasKeys = Array.isArray(keys) && keys.length > 0;
  if (!hasPatterns && !hasKeys) {
    throw new Error("patterns of keys moet minimaal 1 item bevatten.");
  }

  const theme = await resolveTheme(shopifyClient, apiVersion, { themeId, themeRole });
  const cappedLimit = Math.max(1, Math.min(Number(resultLimit || 20), MAX_READ_KEYS_PER_CHUNK));

  if (hasKeys) {
    const normalizedKeys = keys.map((key) => String(key || "").trim()).filter(Boolean);
    if (normalizedKeys.length !== keys.length) {
      throw new Error("Elke key in keys[] moet een niet-lege string zijn.");
    }
    ensureUnique(normalizedKeys, "keys");
    const exactFiles = await withThemeGraphqlFallback(
      () => getThemeFilesGraphql(shopifyClient, apiVersion, { theme, keys: normalizedKeys.slice(0, cappedLimit), includeContent }),
      () => getThemeFilesRest(shopifyClient, apiVersion, { theme, keys: normalizedKeys.slice(0, cappedLimit), includeContent })
    );

    return {
      theme,
      files: exactFiles.filter((file) => file?.found),
      truncated: normalizedKeys.length > cappedLimit,
    };
  }

  const normalizedPatterns = patterns.map((pattern) => String(pattern || "").trim()).filter(Boolean);
  if (normalizedPatterns.length !== patterns.length) {
    throw new Error("Elke pattern in patterns[] moet een niet-lege string zijn.");
  }
  ensureUnique(normalizedPatterns, "patterns");

  const resultByFilename = new Map();
  for (const patternChunk of chunkArray(normalizedPatterns, MAX_READ_KEYS_PER_CHUNK)) {
    if (resultByFilename.size >= cappedLimit) {
      break;
    }
    const data = await shopifyGraphqlRequest(shopifyClient, apiVersion, {
      query: includeContent ? THEME_FILES_WITH_CONTENT_QUERY : THEME_FILES_METADATA_QUERY,
      variables: {
        themeId: theme.adminGraphqlApiId || themeNumericIdToGraphqlId(theme.id),
        first: cappedLimit,
        filenames: patternChunk,
      },
    });
    const fileConnection = data?.theme?.files;
    const userErrors = Array.isArray(fileConnection?.userErrors) ? fileConnection.userErrors : [];
    if (userErrors.length > 0) {
      throw buildThemeUserError("Shopify theme files konden niet worden doorzocht", userErrors);
    }
    const nodes = Array.isArray(fileConnection?.nodes) ? fileConnection.nodes : [];
    for (const node of nodes) {
      if (!node?.filename || resultByFilename.has(node.filename)) {
        continue;
      }
      resultByFilename.set(node.filename, mapGraphqlThemeFile(node));
      if (resultByFilename.size >= cappedLimit) {
        break;
      }
    }
  }
  return {
    theme,
    files: Array.from(resultByFilename.values()),
    truncated: resultByFilename.size >= cappedLimit,
  };
};

export const verifyThemeFiles = async (
  shopifyClient,
  apiVersion = DEFAULT_API_VERSION,
  { themeId, themeRole = "main", expected = [] }
) => {
  if (!Array.isArray(expected) || expected.length === 0) {
    throw new Error("expected moet minimaal 1 item bevatten.");
  }
  if (expected.length > MAX_THEME_FILES_PER_REQUEST) {
    throw new Error(`Maximaal ${MAX_THEME_FILES_PER_REQUEST} expected-items toegestaan per request.`);
  }

  const normalizedExpected = expected.map((entry) => ({
    key: String(entry?.key || "").trim(),
    ...(entry?.size !== undefined ? { size: Number(entry.size) } : {}),
    ...(entry?.checksumMd5 !== undefined ? { checksumMd5: String(entry.checksumMd5) } : {}),
  }));
  if (normalizedExpected.some((entry) => !entry.key)) {
    throw new Error("Elke expected[] entry moet een niet-lege key bevatten.");
  }
  ensureUnique(
    normalizedExpected.map((entry) => entry.key),
    "expected keys"
  );

  const theme = await resolveTheme(shopifyClient, apiVersion, { themeId, themeRole });
  const keys = normalizedExpected.map((entry) => entry.key);
  const actualFiles = await withThemeGraphqlFallback(
    () => getThemeFilesGraphql(shopifyClient, apiVersion, { theme, keys, includeContent: false }),
    () => getThemeFilesRest(shopifyClient, apiVersion, { theme, keys, includeContent: false })
  );
  const actualAssetsByKey = new Map(actualFiles.map((asset) => [asset.key, asset]));
  const verification = verifyThemeFilesAgainstExpected({
    expected: normalizedExpected,
    actualAssetsByKey,
  });

  return {
    theme,
    summary: verification.summary,
    results: verification.results,
  };
};

export const upsertThemeFiles = async (
  shopifyClient,
  apiVersion = DEFAULT_API_VERSION,
  { themeId, themeRole = "main", files = [], verifyAfterWrite = false }
) => {
  if (!Array.isArray(files) || files.length === 0) {
    throw new Error("files moet minimaal 1 item bevatten.");
  }
  if (files.length > MAX_THEME_FILES_PER_REQUEST) {
    throw new Error(`Maximaal ${MAX_THEME_FILES_PER_REQUEST} files toegestaan per request.`);
  }

  const normalizedFiles = files.map((file) => {
    const key = String(file?.key || "").trim();
    const hasValue = typeof file?.value === "string";
    const hasAttachment = typeof file?.attachment === "string";
    if (!key) {
      throw new Error("Elke files[] entry moet een niet-lege key bevatten.");
    }
    if (hasValue === hasAttachment) {
      throw new Error(`File '${key}' moet exact één van 'value' of 'attachment' bevatten.`);
    }

    validateCoreFileUpsert(key, file.value, file.attachment);

    return {
      key,
      ...(hasValue ? { value: file.value } : {}),
      ...(hasAttachment ? { attachment: file.attachment } : {}),
      ...(file?.checksum !== undefined ? { checksum: String(file.checksum) } : {}),
    };
  });

  ensureUnique(
    normalizedFiles.map((file) => file.key),
    "files keys"
  );

  const theme = await resolveTheme(shopifyClient, apiVersion, { themeId, themeRole });
  
  const dbLocks = [];
  for (const file of normalizedFiles) {
    const releaseLock = await tryAcquireThemeFileLock(theme.id, file.key);
    if (!releaseLock) {
      // Revert locks already obtained
      for (const release of dbLocks) await release();
      throw new Error(`File ${file.key} is currently locked by another operation. Try again in a few seconds.`);
    }
    dbLocks.push(releaseLock);
  }

  try {
    const resultsByKey = new Map();
    const filesToApply = [];

    for (const file of normalizedFiles) {
      if (file.checksum === undefined) {
        filesToApply.push(file);
        continue;
      }
      try {
        await assertThemeFileChecksum(shopifyClient, apiVersion, {
          themeId: theme.id,
          key: file.key,
          checksum: file.checksum,
        });
        filesToApply.push(file);
      } catch (error) {
        resultsByKey.set(file.key, {
          key: file.key,
          status: "failed_precondition",
          error: normalizeResultError(error),
        });
      }
    }

    for (const fileChunk of chunkArray(filesToApply, MAX_UPSERT_FILES_PER_CHUNK)) {
      try {
        const chunkResults = await withThemeGraphqlFallback(
          async () => {
            const payloadFiles = fileChunk.map((file) => ({
              filename: file.key,
              body: {
                type: typeof file.attachment === "string" ? "BASE64" : "TEXT",
                value: typeof file.attachment === "string" ? file.attachment : file.value,
              },
            }));
            const data = await shopifyGraphqlRequest(shopifyClient, apiVersion, {
              query: THEME_FILES_UPSERT_MUTATION,
              variables: {
                themeId: theme.adminGraphqlApiId || themeNumericIdToGraphqlId(theme.id),
                files: payloadFiles,
              },
            });
            const payload = data?.themeFilesUpsert;
            const upsertedKeys = new Set(
              Array.isArray(payload?.upsertedThemeFiles)
                ? payload.upsertedThemeFiles.map((entry) => entry?.filename).filter(Boolean)
                : []
            );
            const userErrors = Array.isArray(payload?.userErrors) ? payload.userErrors : [];
            const userErrorsByFilename = new Map();
            for (const userError of userErrors) {
              if (typeof userError?.filename === "string" && userError.filename) {
                userErrorsByFilename.set(userError.filename, userError);
              }
            }

            return fileChunk.map((file) => {
              if (upsertedKeys.has(file.key)) {
                return {
                  key: file.key,
                  status: "applied",
                  jobId: payload?.job?.id || null,
                };
              }

              const error = userErrorsByFilename.get(file.key);
              if (error) {
                return {
                  key: file.key,
                  status: "failed",
                  error: {
                    message: error.message || "Onbekende themeFilesUpsert fout.",
                    code: error.code || null,
                  },
                };
              }

              return {
                key: file.key,
                status: "failed",
                error: {
                  message: userErrors[0]?.message || "Onbekende fout tijdens themeFilesUpsert.",
                  code: userErrors[0]?.code || null,
                },
              };
            });
          },
          async () => {
            const restResults = [];
            for (const file of fileChunk) {
              try {
                const result = await upsertThemeFileRestByTheme(shopifyClient, apiVersion, {
                  theme,
                  key: file.key,
                  value: file.value,
                  attachment: file.attachment,
                  checksum: file.checksum,
                });
                restResults.push({
                  key: file.key,
                  status: "applied",
                  asset: result.asset,
                  jobId: null,
                });
              } catch (error) {
                restResults.push({
                  key: file.key,
                  status: "failed",
                  error: normalizeResultError(error),
                });
              }
            }
            return restResults;
          }
        );

        for (const result of chunkResults) {
          resultsByKey.set(result.key, result);
        }
      } catch (chunkError) {
        const appliedFiles = Array.from(resultsByKey.values())
          .filter((r) => r.status === "applied")
          .map((r) => r.key);
        throw new Error(
          `Batch write abort. Een onverwachte fout is opgetreden bij een chunk. Succesvol geschreven voor deze crash: ${
            appliedFiles.length > 0 ? appliedFiles.join(", ") : "geen"
          }. Foutmelding: ${chunkError.message}`
        );
      }
    }

    let verifySummary = null;
    let verifyError = null;
    if (verifyAfterWrite) {
      const verifyExpected = normalizedFiles
        .filter((file) => resultsByKey.get(file.key)?.status === "applied")
        .map((file) => ({
          key: file.key,
          size: createExpectedSizeFromInputFile(file),
          checksumMd5: createChecksumMd5Base64(file),
        }));

      if (verifyExpected.length > 0) {
        try {
          const verifyResult = await verifyThemeFiles(shopifyClient, apiVersion, {
            themeId: theme.id,
            expected: verifyExpected,
          });
          const verifyByKey = new Map(verifyResult.results.map((result) => [result.key, result]));
          verifySummary = verifyResult.summary;
          for (const file of normalizedFiles) {
            const current = resultsByKey.get(file.key);
            if (!current || current.status !== "applied") {
              continue;
            }
            resultsByKey.set(file.key, {
              ...current,
              verify: verifyByKey.get(file.key) || null,
            });
          }
        } catch (error) {
          verifyError = normalizeResultError(error);
        }
      }
    }

    const results = normalizedFiles.map((file) => {
      return (
        resultsByKey.get(file.key) || {
          key: file.key,
          status: "failed",
          error: { message: "Onbekende upsert status.", status: null },
        }
      );
    });

    const summary = results.reduce(
      (acc, result) => {
        acc.total += 1;
        if (result.status === "applied") {
          acc.applied += 1;
        } else if (result.status === "failed_precondition") {
          acc.failedPrecondition += 1;
        } else {
          acc.failed += 1;
        }
        return acc;
      },
      { total: 0, applied: 0, failed: 0, failedPrecondition: 0 }
    );

    return {
      theme,
      summary,
      results,
      ...(verifyAfterWrite ? { verifySummary } : {}),
      ...(verifyError ? { verifyError } : {}),
    };
  } finally {
    for (const release of dbLocks) {
      await release();
    }
  }
};

export const upsertThemeFile = async (
  shopifyClient,
  apiVersion = DEFAULT_API_VERSION,
  { themeId, themeRole = "main", key, value, attachment, checksum }
) => {
  validateCoreFileUpsert(key, value, attachment);

  const theme = await resolveTheme(shopifyClient, apiVersion, { themeId, themeRole });
  
  const releaseLock = await tryAcquireThemeFileLock(theme.id, key);
  if (!releaseLock) {
    throw new Error(`File ${key} is currently locked by another operation. Try again in a few seconds.`);
  }

  try {
    if (checksum !== undefined) {
      await assertThemeFileChecksum(shopifyClient, apiVersion, { themeId: theme.id, themeRole: theme.role, key, checksum });
    }

    return await withThemeGraphqlFallback(
      async () => {
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
      () => upsertThemeFileRest(shopifyClient, apiVersion, { themeId: theme.id, themeRole: theme.role, key, value, attachment, checksum })
    );
  } finally {
    await releaseLock();
  }
};

export const deleteThemeFile = async (
  shopifyClient,
  apiVersion = DEFAULT_API_VERSION,
  { themeId, themeRole = "main", key }
) =>
  withThemeGraphqlFallback(
    async () => {
      validateCoreFileDelete(key);

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
