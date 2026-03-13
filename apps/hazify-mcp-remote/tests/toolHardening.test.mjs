import assert from "assert";
import dns from "dns/promises";
import { cloneProductFromUrl } from "../src/tools/cloneProductFromUrl.js";
import { refundOrder } from "../src/tools/refundOrder.js";
import { updateFulfillmentTracking } from "../src/tools/updateFulfillmentTracking.js";
import { upsertThemeFileTool } from "../src/tools/upsertThemeFile.js";
import { listThemeImportTools } from "../src/tools/listThemeImportTools.js";

const originalLookup = dns.lookup;
const originalFetch = global.fetch;

const sourceProductPayload = {
  title: "Source product",
  handle: "source-product",
  vendor: "Hazify",
  description: "Source description",
  options: [{ name: "Color", values: ["Red"] }],
  images: [{ id: 101, src: "https://cdn.example.com/red.jpg", alt: "Red image" }],
  media: [{ media_type: "image", src: "https://cdn.example.com/red.jpg", alt: "Red image" }],
  variants: [
    {
      id: 501,
      title: "Red",
      price: 1995,
      compare_at_price: null,
      taxable: true,
      inventory_management: null,
      sku: "SKU-RED",
      option1: "Red",
      image_id: 101,
    },
  ],
};

try {
  dns.lookup = async () => [{ address: "93.184.216.34", family: 4 }];

  const defaultCloneInput = cloneProductFromUrl.schema.parse({
    sourceUrl: "https://store.example/products/source-product",
  });
  assert.equal(defaultCloneInput.status, "DRAFT", "clone-product-from-url should default to DRAFT");

  global.fetch = async () =>
    new Response(JSON.stringify(sourceProductPayload), {
      status: 200,
      headers: { "content-type": "application/json" },
    });

  const cloneRequests = [];
  const mockShopifyClient = {
    request: async (query, variables) => {
      const queryText = String(query);
      cloneRequests.push({ queryText, variables });

      if (queryText.includes("productCreate(")) {
        return {
          productCreate: {
            product: {
              id: "gid://shopify/Product/9001",
              title: "Source product",
              handle: "source-product",
            },
            userErrors: [],
          },
        };
      }

      if (queryText.includes("productVariantsBulkCreate(")) {
        return {
          productVariantsBulkCreate: {
            productVariants: [
              {
                id: "gid://shopify/ProductVariant/7001",
                title: "Red",
                selectedOptions: [{ name: "Color", value: "Red" }],
              },
            ],
            userErrors: [],
          },
        };
      }

      if (queryText.includes("query VerifyVariantMedia")) {
        return {
          nodes: [
            {
              id: "gid://shopify/ProductVariant/7001",
              image: { url: "https://cdn.example.com/red.jpg" },
            },
          ],
        };
      }

      throw new Error(`Unexpected clone request: ${queryText.slice(0, 80)}`);
    },
  };

  const cloneResult = await cloneProductFromUrl.execute(
    cloneProductFromUrl.schema.parse({
      sourceUrl: "https://store.example/products/source-product",
    }),
    { shopifyClient: mockShopifyClient }
  );
  const createRequest = cloneRequests.find((entry) => entry.queryText.includes("productCreate("));
  assert.ok(createRequest, "clone-product-from-url should call productCreate");
  assert.equal(
    createRequest.variables?.product?.status,
    "DRAFT",
    "clone-product-from-url should not auto-publish"
  );
  assert.equal(cloneResult.variantMediaMapping.summary.totalVariants, 1);
  assert.equal(cloneResult.variantMediaMapping.summary.verified, 1);

  const missingThemePayload = upsertThemeFileTool.schema.safeParse({
    key: "sections/test.liquid",
  });
  assert.equal(missingThemePayload.success, false, "upsert-theme-file should require value or attachment");

  const validThemePayload = upsertThemeFileTool.schema.safeParse({
    key: "sections/test.liquid",
    value: "<div>ok</div>",
  });
  assert.equal(validThemePayload.success, true, "upsert-theme-file should accept textual value");

  const refundResult = await refundOrder.execute(
    refundOrder.schema.parse({
      orderId: "gid://shopify/Order/1",
      audit: {
        amount: "19.95",
        reason: "Damaged item",
        scope: "partial",
      },
      note: "Customer requested refund",
      notify: false,
    }),
    {
      shopifyClient: {
        request: async (_query, variables) => {
          return {
            refundCreate: {
              refund: {
                id: "gid://shopify/Refund/1",
                createdAt: "2026-03-13T12:00:00Z",
                note: variables.input.note,
                totalRefundedSet: {
                  shopMoney: { amount: "19.95", currencyCode: "EUR" },
                  presentmentMoney: { amount: "19.95", currencyCode: "EUR" },
                },
              },
              order: {
                id: "gid://shopify/Order/1",
                name: "#1001",
              },
              userErrors: [],
            },
          };
        },
      },
    }
  );
  assert.match(refundResult.refund.note, /\[Refund audit\]/, "refund note should include audit trace");
  assert.equal(refundResult.audit.scope, "partial");

  await assert.rejects(
    () =>
      updateFulfillmentTracking.execute(
        updateFulfillmentTracking.schema.parse({
          orderId: "gid://shopify/Order/1",
          trackingNumber: "TRACK-123",
          trackingCompany: "Invalid Carrier",
        }),
        {
          shopifyClient: {
            request: async () => {
              throw new Error("request should not run for invalid carrier");
            },
          },
        }
      ),
    /Unsupported carrier 'Invalid Carrier'/
  );

  const registryResult = await listThemeImportTools.execute({});
  assert.ok(Array.isArray(registryResult.tools), "tool registry should return tools array");
  assert.equal(registryResult.tools[0]?.name, "shopify_dev_import_section");
  assert.equal(registryResult.tools[0]?.location, "local_shopify_dev_mcp");

  console.log("toolHardening.test.mjs passed");
} finally {
  dns.lookup = originalLookup;
  global.fetch = originalFetch;
}
