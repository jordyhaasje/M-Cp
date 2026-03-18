const CUSTOMER_GID_PREFIX = "gid://shopify/Customer/";

const extractNumericCustomerIdFromGid = (value) => {
  const match = String(value || "").trim().match(/^gid:\/\/shopify\/Customer\/(\d+)$/);
  return match ? match[1] : null;
};

const normalizeCustomerIdentifier = (inputCustomerId) => {
  const raw = String(inputCustomerId || "").trim();
  if (!raw) {
    throw new Error("Customer ID is required.");
  }

  const numericFromGid = extractNumericCustomerIdFromGid(raw);
  if (numericFromGid) {
    return {
      input: inputCustomerId,
      gid: raw,
      numericId: numericFromGid,
      source: "gid",
    };
  }

  if (/^\d+$/.test(raw)) {
    return {
      input: inputCustomerId,
      gid: `${CUSTOMER_GID_PREFIX}${raw}`,
      numericId: raw,
      source: "numeric",
    };
  }

  throw new Error(`Invalid customer identifier '${inputCustomerId}'. Use numeric ID or gid://shopify/Customer/<id>.`);
};

export { CUSTOMER_GID_PREFIX, extractNumericCustomerIdFromGid, normalizeCustomerIdentifier };
