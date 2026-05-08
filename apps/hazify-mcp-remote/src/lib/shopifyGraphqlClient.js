const normalizeQuery = (query) => String(query || "").trim();
const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_RETRY_BASE_DELAY_MS = 250;
const MAX_RETRY_DELAY_MS = 2000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const isRetryableStatus = (status) => status === 429 || status >= 500;

const retryDelayMs = (response, attempt, retryBaseDelayMs) => {
  const retryAfter = response?.headers?.get?.("retry-after");
  if (retryAfter) {
    const parsedSeconds = Number(retryAfter);
    if (Number.isFinite(parsedSeconds) && parsedSeconds >= 0) {
      return Math.min(Math.round(parsedSeconds * 1000), MAX_RETRY_DELAY_MS);
    }
    const parsedDate = Date.parse(retryAfter);
    if (Number.isFinite(parsedDate)) {
      return Math.min(Math.max(parsedDate - Date.now(), 0), MAX_RETRY_DELAY_MS);
    }
  }
  return Math.min(retryBaseDelayMs * 2 ** attempt, MAX_RETRY_DELAY_MS);
};

const parseJsonResponse = async (response) => {
  const text = await response.text();
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    const error = new Error("Shopify GraphQL response was not valid JSON");
    error.response = {
      status: response.status,
      body: text,
    };
    throw error;
  }
};

const buildGraphqlError = (message, response, payload = null) => {
  const error = new Error(message);
  error.response = {
    status: response.status,
    headers: Object.fromEntries(response.headers.entries()),
    ...(payload && typeof payload === "object" ? payload : { body: payload }),
  };
  return error;
};

export const gql = (strings, ...values) => {
  if (typeof strings === "string") {
    return strings;
  }

  return strings.reduce(
    (query, part, index) => `${query}${part}${index < values.length ? values[index] : ""}`,
    ""
  );
};

export const createShopifyGraphqlClient = ({
  domain,
  accessToken,
  apiVersion,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxRetries = DEFAULT_MAX_RETRIES,
  retryBaseDelayMs = DEFAULT_RETRY_BASE_DELAY_MS,
}) => {
  const url = `https://${domain}/admin/api/${apiVersion}/graphql.json`;
  const requestConfig = {
    headers: {
      "X-Shopify-Access-Token": accessToken,
      "Content-Type": "application/json",
    },
  };

  return {
    url,
    requestConfig,
    async request(query, variables = {}) {
      const normalizedQuery = normalizeQuery(query);
      if (!normalizedQuery) {
        throw new Error("Shopify GraphQL query is required");
      }

      const safeTimeoutMs =
        Number.isFinite(Number(timeoutMs)) && Number(timeoutMs) > 0
          ? Number(timeoutMs)
          : DEFAULT_TIMEOUT_MS;
      const safeMaxRetries =
        Number.isInteger(Number(maxRetries)) && Number(maxRetries) >= 0
          ? Math.min(Number(maxRetries), 5)
          : DEFAULT_MAX_RETRIES;
      const safeRetryBaseDelayMs =
        Number.isFinite(Number(retryBaseDelayMs)) && Number(retryBaseDelayMs) >= 0
          ? Number(retryBaseDelayMs)
          : DEFAULT_RETRY_BASE_DELAY_MS;

      for (let attempt = 0; attempt <= safeMaxRetries; attempt += 1) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), safeTimeoutMs);
        let response;
        let payload;

        try {
          response = await fetch(url, {
            method: "POST",
            headers: requestConfig.headers,
            body: JSON.stringify({
              query: normalizedQuery,
              variables: variables || {},
            }),
            signal: controller.signal,
          });
          payload = await parseJsonResponse(response);
        } catch (error) {
          if (attempt < safeMaxRetries) {
            await sleep(Math.min(safeRetryBaseDelayMs * 2 ** attempt, MAX_RETRY_DELAY_MS));
            continue;
          }
          if (error?.name === "AbortError") {
            throw new Error(`Shopify GraphQL request timed out after ${safeTimeoutMs}ms`);
          }
          throw error;
        } finally {
          clearTimeout(timeout);
        }

        if (!response.ok) {
          const detail =
            typeof payload?.errors === "string"
              ? payload.errors
              : Array.isArray(payload?.errors)
                ? payload.errors.map((error) => error?.message).filter(Boolean).join(", ")
                : "";
          if (isRetryableStatus(response.status) && attempt < safeMaxRetries) {
            await sleep(retryDelayMs(response, attempt, safeRetryBaseDelayMs));
            continue;
          }
          throw buildGraphqlError(
            detail ? `Shopify GraphQL HTTP ${response.status}: ${detail}` : `Shopify GraphQL HTTP ${response.status}`,
            response,
            payload
          );
        }

        if (Array.isArray(payload?.errors) && payload.errors.length > 0) {
          const detail = payload.errors.map((error) => error?.message).filter(Boolean).join(", ");
          throw buildGraphqlError(
            detail ? `Shopify GraphQL error: ${detail}` : "Shopify GraphQL error",
            response,
            payload
          );
        }

        return payload?.data || {};
      }

      throw new Error("Shopify GraphQL request failed after retries");
    },
  };
};
