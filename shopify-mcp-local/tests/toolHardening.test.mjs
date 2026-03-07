import assert from "assert";
import dns from "dns/promises";
import { cloneProductFromUrl } from "../dist/tools/cloneProductFromUrl.js";
import { updateFulfillmentTracking } from "../dist/tools/updateFulfillmentTracking.js";
import { refundOrder } from "../dist/tools/refundOrder.js";

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
  // Keep urlSecurity deterministic and offline-safe during clone tests.
  dns.lookup = async () => [{ address: "93.184.216.34", family: 4 }];

  const parsedCloneInput = cloneProductFromUrl.schema.parse({
    sourceUrl: "https://store.example/products/source-product",
  });
  assert.equal(parsedCloneInput.status, "DRAFT", "clone-product-from-url default status should be DRAFT");

  global.fetch = async () =>
    new Response(JSON.stringify(sourceProductPayload), {
      status: 200,
      headers: { "content-type": "application/json" },
    });

  const cloneRequests = [];
  cloneProductFromUrl.initialize({
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

      throw new Error(`Unexpected clone request: ${queryText.slice(0, 120)}`);
    },
  });

  const cloneInput = cloneProductFromUrl.schema.parse({
    sourceUrl: "https://store.example/products/source-product",
  });
  const cloneResult = await cloneProductFromUrl.execute(cloneInput);
  const createRequest = cloneRequests.find((entry) => entry.queryText.includes("productCreate("));
  assert.ok(createRequest, "productCreate request should be executed");
  assert.equal(
    createRequest.variables?.product?.status,
    "DRAFT",
    "clone-product-from-url should not auto-publish"
  );
  assert.equal(cloneResult.variantMediaMapping.summary.totalVariants, 1);
  assert.equal(cloneResult.variantMediaMapping.summary.verified, 1);

  let rejectedInvalidCarrier = false;
  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    await updateFulfillmentTracking.execute({
      orderId: "gid://shopify/Order/1001",
      trackingNumber: "TRACK-123",
      trackingCompany: "carrier-that-does-not-exist",
      notifyCustomer: false,
    });
  } catch (error) {
    rejectedInvalidCarrier =
      error instanceof Error &&
      error.message.includes("Unsupported carrier 'carrier-that-does-not-exist'");
  } finally {
    console.error = originalConsoleError;
  }
  assert.equal(rejectedInvalidCarrier, true, "invalid carrier should be rejected with explicit error");

  const trackingCalls = [];
  updateFulfillmentTracking.initialize({
    request: async (query, variables) => {
      const queryText = String(query);
      trackingCalls.push({ queryText, variables });
      if (queryText.includes("query getOrderTrackingContext")) {
        return {
          order: {
            id: "gid://shopify/Order/1001",
            name: "#1001",
            fulfillments: {
              nodes: [
                {
                  id: "gid://shopify/Fulfillment/5001",
                  status: "SUCCESS",
                  createdAt: "2026-03-07T08:00:00.000Z",
                  trackingInfo: [],
                },
              ],
            },
            fulfillmentOrders: { nodes: [] },
          },
        };
      }
      if (queryText.includes("mutation fulfillmentTrackingInfoUpdate")) {
        return {
          fulfillmentTrackingInfoUpdate: {
            fulfillment: {
              id: "gid://shopify/Fulfillment/5001",
              status: "SUCCESS",
              trackingInfo: [
                {
                  company: variables?.trackingInfoInput?.company || null,
                  number: variables?.trackingInfoInput?.number || null,
                  url: variables?.trackingInfoInput?.url || null,
                },
              ],
            },
            userErrors: [],
          },
        };
      }
      throw new Error(`Unexpected tracking request: ${queryText.slice(0, 120)}`);
    },
  });

  const trackingResult = await updateFulfillmentTracking.execute({
    orderId: "gid://shopify/Order/1001",
    trackingNumber: "TRACK-ALIAS-1",
    trackingCompany: "dhl",
    notifyCustomer: false,
  });
  assert.equal(trackingResult.carrierResolved, "DHL Express");
  const trackingMutation = trackingCalls.find((entry) =>
    entry.queryText.includes("mutation fulfillmentTrackingInfoUpdate")
  );
  assert.equal(
    trackingMutation?.variables?.trackingInfoInput?.company,
    "DHL Express",
    "carrier alias should resolve to supported carrier"
  );

  const refundWithoutAudit = refundOrder.schema.safeParse({
    orderId: "gid://shopify/Order/1234",
    notify: false,
  });
  assert.equal(refundWithoutAudit.success, false, "refund-order should require audit metadata");

  let capturedRefundInput = null;
  refundOrder.initialize({
    request: async (_query, variables) => {
      capturedRefundInput = variables?.input;
      return {
        refundCreate: {
          refund: {
            id: "gid://shopify/Refund/1",
            createdAt: "2026-03-07T08:00:00.000Z",
            note: capturedRefundInput?.note || null,
            totalRefundedSet: {
              shopMoney: { amount: "19.95", currencyCode: "EUR" },
              presentmentMoney: { amount: "19.95", currencyCode: "EUR" },
            },
          },
          order: {
            id: "gid://shopify/Order/1234",
            name: "#1234",
          },
          userErrors: [],
        },
      };
    },
  });

  const refundResult = await refundOrder.execute({
    orderId: "gid://shopify/Order/1234",
    note: "Handmatige refund",
    audit: {
      amount: "19.95",
      reason: "Klant ontving beschadigd item",
      scope: "partial",
    },
    notify: false,
    transactions: [
      {
        amount: "19.95",
        gateway: "manual",
      },
    ],
  });

  assert.ok(capturedRefundInput?.note?.includes("[Refund audit] amount=19.95; scope=partial"));
  assert.equal(refundResult.audit.scope, "partial");

  console.log("toolHardening.test.mjs passed");
} finally {
  dns.lookup = originalLookup;
  global.fetch = originalFetch;
}
