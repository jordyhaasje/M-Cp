const normalizePath = (field) => {
  if (Array.isArray(field)) {
    return field.map((part) => String(part)).filter(Boolean);
  }
  if (typeof field === "string" && field.trim()) {
    return field
      .split(".")
      .map((part) => part.trim())
      .filter(Boolean);
  }
  return [];
};

const formatPath = (path) => (path.length > 0 ? path.join(".") : "General");

const normalizeShopifyUserErrors = (userErrors) => {
  if (!Array.isArray(userErrors)) {
    return [];
  }
  return userErrors
    .map((error) => {
      if (!error || typeof error !== "object") {
        return null;
      }
      const path = normalizePath(error.field);
      const problem =
        typeof error.message === "string" && error.message.trim()
          ? error.message.trim()
          : "Shopify returned a user error without a message.";
      const code =
        typeof error.code === "string" && error.code.trim() ? error.code.trim() : null;
      return {
        path,
        problem,
        ...(code ? { code } : {}),
        fixSuggestion:
          "Pas de tool-input aan op basis van deze Shopify validatiefout en probeer dezelfde tool opnieuw.",
      };
    })
    .filter(Boolean);
};

const buildShopifyUserErrorResponse = (
  userErrors,
  { actionMessage = "Shopify GraphQL user error", operation = null, retryable = true } = {}
) => {
  const errors = normalizeShopifyUserErrors(userErrors);
  if (errors.length === 0) {
    return null;
  }

  const details = errors
    .map((error) => `${formatPath(error.path)}: ${error.problem}`)
    .join(", ");

  return {
    success: false,
    status: "shopify_user_error",
    errorCode: "shopify_user_error",
    message: `${actionMessage}: ${details}`,
    retryable,
    nextAction: "fix_shopify_user_errors",
    retryMode: "same_request_after_fix",
    ...(operation ? { operation } : {}),
    errors,
    suggestedFixes: errors
      .map((error) => error.fixSuggestion)
      .filter((value, index, values) => values.indexOf(value) === index),
  };
};

export {
  buildShopifyUserErrorResponse,
  normalizeShopifyUserErrors,
};
