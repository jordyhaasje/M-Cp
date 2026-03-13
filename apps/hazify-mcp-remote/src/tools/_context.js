function requireShopifyClient(context = {}) {
  const shopifyClient = context?.shopifyClient;
  if (!shopifyClient || typeof shopifyClient.request !== "function") {
    throw new Error("Missing Shopify client in execution context");
  }
  return shopifyClient;
}

export { requireShopifyClient };
