import assert from "assert";
import { getProducts } from "../src/tools/getProducts.js";

function mockProductsPayload(label) {
  return {
    products: {
      edges: [
        {
          node: {
            id: `gid://shopify/Product/${label}`,
            title: `Product ${label}`,
            description: `Description ${label}`,
            handle: `product-${label.toLowerCase()}`,
            status: "DRAFT",
            createdAt: "2026-03-13T00:00:00Z",
            updatedAt: "2026-03-13T00:00:00Z",
            totalInventory: 0,
            priceRangeV2: {
              minVariantPrice: { amount: "1.00", currencyCode: "EUR" },
              maxVariantPrice: { amount: "1.00", currencyCode: "EUR" },
            },
            images: { edges: [] },
            variants: { edges: [] },
          },
        },
      ],
    },
  };
}

const calls = [];
const clientA = {
  request: async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
    calls.push("A");
    return mockProductsPayload("A");
  },
};
const clientB = {
  request: async () => {
    calls.push("B");
    return mockProductsPayload("B");
  },
};

const input = getProducts.schema.parse({ limit: 1 });
const [resultA, resultB] = await Promise.all([
  getProducts.execute(input, { shopifyClient: clientA }),
  getProducts.execute(input, { shopifyClient: clientB }),
]);

assert.equal(resultA.products[0].id, "gid://shopify/Product/A");
assert.equal(resultB.products[0].id, "gid://shopify/Product/B");
assert.deepEqual(calls.sort(), ["A", "B"], "both tenant-scoped clients must be invoked independently");

await assert.rejects(
  () => getProducts.execute(input, {}),
  /Missing Shopify client in execution context/,
  "tools should fail closed when request context lacks a tenant Shopify client"
);

console.log("tenantIsolation.test.mjs passed");
