const normalizeQuery = (query) => String(query || "").trim();

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

export const createShopifyGraphqlClient = ({ domain, accessToken, apiVersion }) => {
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

      const response = await fetch(url, {
        method: "POST",
        headers: requestConfig.headers,
        body: JSON.stringify({
          query: normalizedQuery,
          variables: variables || {},
        }),
      });
      const payload = await parseJsonResponse(response);

      if (!response.ok) {
        const detail =
          typeof payload?.errors === "string"
            ? payload.errors
            : Array.isArray(payload?.errors)
              ? payload.errors.map((error) => error?.message).filter(Boolean).join(", ")
              : "";
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
    },
  };
};
