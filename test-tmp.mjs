import { resolveTheme } from "./apps/hazify-mcp-remote/src/lib/themeFiles.js";
import { getThemeByIdGraphql } from "./apps/hazify-mcp-remote/src/lib/themeFiles.js";
// Wait, getThemeByIdGraphql is not exported. Let me just console.error the error inside withThemeGraphqlFallback.
const shopifyClient = {
  request: async () => {},
  url: "https://unit-test-shop.myshopify.com/admin/api/2026-01/graphql.json",
  requestConfig: { headers: { "X-Shopify-Access-Token": "shpat_unit_test" } },
  client: { session: { shop: "unit-test-shop.myshopify.com", accessToken: "shpat_unit_test" } }
};
global.fetch = async (url, options) => {
  if (!url.endsWith("/graphql.json")) {
    return new Response("{}", { status: 404 });
  }
  const query = JSON.parse(options.body || "{}").query;
  if (query.includes("query ThemeById")) {
    console.log("Mock Returning ThemeById");
    return new Response(JSON.stringify({ data: { theme: { id: "gid://shopify/OnlineStoreTheme/123", name: "Main Theme", role: "MAIN", processing: false } } }), { status: 200, headers: { "content-type": "application/json" }});
  }
  return new Response("{}", { status: 404 });
};

// overriding console to intercept
const origWith = console.warn;
console.warn = (...args) => origWith(...args);

async function run() {
  try {
    const res = await resolveTheme(shopifyClient, "2026-01", { themeId: 123 });
    console.log("Success:", res);
  } catch (err) {
    console.error("Error from resolveTheme:", err);
  }
}
run();
