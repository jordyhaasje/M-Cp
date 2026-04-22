import assert from "assert";
import { cloneProductFromUrl } from "../src/tools/cloneProductFromUrl.js";
import { deleteProduct } from "../src/tools/deleteProduct.js";
import { deleteProductVariants } from "../src/tools/deleteProductVariants.js";
import { getOrderById } from "../src/tools/getOrderById.js";
import { getThemeFileTool } from "../src/tools/getThemeFile.js";
import { getThemeFilesTool } from "../src/tools/getThemeFiles.js";
import { refundOrder } from "../src/tools/refundOrder.js";
import { searchThemeFilesTool } from "../src/tools/searchThemeFiles.js";
import { updateOrder } from "../src/tools/updateOrder.js";
import { updateProduct } from "../src/tools/updateProduct.js";
import { verifyThemeFilesTool } from "../src/tools/verifyThemeFiles.js";
import { clearThemeEditMemory, rememberThemeRead } from "../src/lib/themeEditMemory.js";
import { createThemeDraftDbHarness } from "./helpers/themeDraftDbHarness.mjs";

process.env.NODE_ENV = "test";

const originalFetch = global.fetch;
const themeDraftDb = createThemeDraftDbHarness();

const themeClient = {
  url: "https://unit-test-shop.myshopify.com/admin/api/2026-01/graphql.json",
  requestConfig: {
    headers: {
      "X-Shopify-Access-Token": "shpat_unit_test",
    },
  },
  request: async () => {
    throw new Error("theme remediation test should use fetch-backed theme file helpers");
  },
};

const themeNode = {
  id: "gid://shopify/OnlineStoreTheme/123",
  name: "Main theme",
  role: "MAIN",
  processing: false,
  createdAt: "2026-03-10T10:00:00Z",
  updatedAt: "2026-03-11T10:00:00Z",
};

function makeTextAsset(content, contentType = "TEXT") {
  return {
    checksumMd5: "checksum",
    contentType,
    createdAt: "2026-03-10T10:00:00Z",
    updatedAt: "2026-03-11T10:00:00Z",
    size: Buffer.byteLength(content, "utf8"),
    body: {
      content,
    },
  };
}

function patternMatches(filename, pattern) {
  if (!pattern.includes("*")) {
    return filename === pattern;
  }
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`).test(filename);
}

function createThemeFetch(files) {
  return async (_url, init = {}) => {
    const payload = JSON.parse(init.body || "{}");
    const query = String(payload.query || "");
    const variables = payload.variables || {};

    if (query.includes("query ThemeById")) {
      return new Response(
        JSON.stringify({
          data: {
            theme: themeNode,
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }

    if (query.includes("query ThemeList")) {
      return new Response(
        JSON.stringify({
          data: {
            themes: {
              nodes: [themeNode],
            },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }

    if (
      query.includes("query ThemeFileById") ||
      query.includes("ThemeFilesByIdWithContent") ||
      query.includes("ThemeFilesByIdMetadata")
    ) {
      const filenames = Array.isArray(variables.filenames) ? variables.filenames : [];
      const first = Number(variables.first || filenames.length || 50);
      const matched = Object.entries(files)
        .filter(([filename]) => filenames.some((pattern) => patternMatches(filename, pattern)))
        .slice(0, first)
        .map(([filename, file]) => ({
          filename,
          ...file,
        }));
      return new Response(
        JSON.stringify({
          data: {
            theme: {
              ...themeNode,
              files: {
                nodes: matched,
                userErrors: [],
              },
            },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }

    throw new Error(`Unexpected GraphQL query in remediation test: ${query.slice(0, 80)}`);
  };
}

const themeFiles = {
  "sections/demo.liquid": makeTextAsset("<div>Demo</div>"),
  "sections/main-product.liquid": makeTextAsset("{% render 'product-info', section: section %}"),
  "snippets/product-info.liquid": makeTextAsset(
    "{% for block in section.blocks %}<div {{ block.shopify_attributes }}>{{ block.type }}</div>{% endfor %}"
  ),
};

try {
  global.fetch = createThemeFetch(themeFiles);

  const missingThemeRead = await getThemeFileTool.execute(
    getThemeFileTool.schema.parse({
      key: "sections/demo.liquid",
      includeContent: false,
    }),
    {
      shopifyClient: themeClient,
      tokenHash: "missing-theme-read",
    }
  );
  assert.equal(missingThemeRead.success, false);
  assert.equal(missingThemeRead.errorCode, "explicit_theme_target_required");
  assert.equal(missingThemeRead.nextTool, "get-theme-file");

  const missingThemeSearch = await searchThemeFilesTool.execute(
    searchThemeFilesTool.schema.parse({
      query: "product-info",
      scope: ["sections", "snippets"],
    }),
    {
      shopifyClient: themeClient,
      tokenHash: "missing-theme-search",
    }
  );
  assert.equal(missingThemeSearch.success, false);
  assert.equal(missingThemeSearch.errorCode, "explicit_theme_target_required");
  assert.equal(missingThemeSearch.nextTool, "search-theme-files");

  const missingThemeVerify = await verifyThemeFilesTool.execute(
    verifyThemeFilesTool.schema.parse({
      expected: [{ key: "sections/demo.liquid", checksumMd5: "checksum" }],
    }),
    {
      shopifyClient: themeClient,
      tokenHash: "missing-theme-verify",
    }
  );
  assert.equal(missingThemeVerify.success, false);
  assert.equal(missingThemeVerify.errorCode, "explicit_theme_target_required");

  const stickyContext = {
    shopifyClient: themeClient,
    tokenHash: "sticky-theme-target",
  };
  rememberThemeRead(stickyContext, {
    themeId: 123,
    themeRole: "main",
    files: [],
  });

  const stickyBatchRead = await getThemeFilesTool.execute(
    getThemeFilesTool.schema.parse({
      keys: ["sections/demo.liquid"],
      includeContent: false,
    }),
    stickyContext
  );
  assert.equal(stickyBatchRead.theme.id, 123);
  assert.ok(
    stickyBatchRead.warnings?.some((warning) => warning.includes("Eerder bevestigd theme target")),
    "get-theme-files should reuse the sticky explicit theme target from the same flow"
  );

  const stickySearch = await searchThemeFilesTool.execute(
    searchThemeFilesTool.schema.parse({
      query: "block.shopify_attributes",
      scope: ["snippets"],
    }),
    stickyContext
  );
  assert.equal(stickySearch.theme.id, 123);
  assert.ok(stickySearch.hits.some((hit) => hit.key === "snippets/product-info.liquid"));

  let capturedRefundQuery = null;
  let capturedIdempotencyKeys = [];
  const refundClient = {
    request: async (query, variables) => {
      capturedRefundQuery = String(query);
      capturedIdempotencyKeys.push(variables?.idempotencyKey || null);
      return {
        refundCreate: {
          refund: {
            id: "gid://shopify/Refund/1",
            createdAt: "2026-04-22T08:00:00Z",
            note: variables?.input?.note,
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
  };

  const refundInput = refundOrder.schema.parse({
    orderId: "gid://shopify/Order/1",
    confirmation: "REFUND_ORDER",
    audit: {
      amount: "19.95",
      reason: "Damaged item",
      scope: "partial",
    },
    transactions: [
      {
        amount: "19.95",
        gateway: "manual",
      },
    ],
  });

  const refundResultA = await refundOrder.execute(refundInput, { shopifyClient: refundClient });
  const refundResultB = await refundOrder.execute(refundInput, { shopifyClient: refundClient });
  assert.match(capturedRefundQuery || "", /@idempotent\(key: \$idempotencyKey\)/);
  assert.equal(refundResultA.idempotencyKey, refundResultB.idempotencyKey);
  assert.equal(capturedIdempotencyKeys[0], capturedIdempotencyKeys[1]);

  const explicitRefundResult = await refundOrder.execute(
    refundOrder.schema.parse({
      ...refundInput,
      idempotencyKey: "refund-manual-key-001",
    }),
    { shopifyClient: refundClient }
  );
  assert.equal(explicitRefundResult.idempotencyKey, "refund-manual-key-001");

  assert.equal(
    updateProduct.schema.safeParse({
      id: "gid://shopify/Product/1",
      collectionsToJoin: ["gid://shopify/Collection/1"],
    }).success,
    false,
    "update-product should reject removed collectionsToJoin contract drift"
  );
  assert.equal(
    updateProduct.schema.safeParse({
      id: "gid://shopify/Product/1",
      redirectNewHandle: true,
    }).success,
    false,
    "update-product should reject removed redirectNewHandle contract drift"
  );

  assert.equal(
    cloneProductFromUrl.schema.safeParse({
      sourceUrl: "https://store.example/products/source-product",
      status: "ACTIVE",
    }).success,
    false,
    "clone-product-from-url should reject ACTIVE as a first-pass import status"
  );

  const legacyTrackingResult = await updateOrder.execute(
    updateOrder.schema.parse({
      id: "gid://shopify/Order/1",
      confirmation: "UPDATE_ORDER",
      reason: "Test legacy tracking redirect",
      tracking: {
        number: "TRACK-001",
        company: "UPS",
      },
    }),
    {
      shopifyClient: {
        request: async () => {
          throw new Error("tracking migration should not attempt any Shopify write");
        },
      },
    }
  );
  assert.equal(legacyTrackingResult.success, false);
  assert.equal(legacyTrackingResult.errorCode, "tracking_requires_dedicated_tool");
  assert.equal(legacyTrackingResult.nextTool, "set-order-tracking");

  const fulfillmentTrackingRedirect = await updateOrder.execute(
    updateOrder.schema.parse({
      id: "gid://shopify/Order/1",
      confirmation: "UPDATE_ORDER",
      reason: "Test fulfillment tracking redirect",
      trackingNumber: "TRACK-002",
      fulfillmentId: "gid://shopify/Fulfillment/1",
    }),
    {
      shopifyClient: {
        request: async () => {
          throw new Error("tracking migration should not attempt any Shopify write");
        },
      },
    }
  );
  assert.equal(fulfillmentTrackingRedirect.success, false);
  assert.equal(fulfillmentTrackingRedirect.nextTool, "update-fulfillment-tracking");

  const deleteProductResult = await deleteProduct.execute(
    deleteProduct.schema.parse({
      id: "gid://shopify/Product/1",
      confirmation: "DELETE_PRODUCT",
      reason: "Cleanup obsolete product",
    }),
    {
      shopifyClient: {
        request: async () => ({
          productDelete: {
            deletedProductId: "gid://shopify/Product/1",
            userErrors: [],
          },
        }),
      },
      tenantId: "tenant_remediation",
      requestId: "req_delete_product",
      shopifyDomain: "unit-test-shop.myshopify.com",
    }
  );
  assert.ok(deleteProductResult.audit?.auditLogId, "delete-product should return an audit log id");
  const storedDeleteAudit = await themeDraftDb.pool.query(
    "SELECT * FROM mutation_audit_logs WHERE id = $1",
    [deleteProductResult.audit.auditLogId]
  );
  assert.equal(storedDeleteAudit.rows.length, 1);
  assert.equal(storedDeleteAudit.rows[0].tool_name, "delete-product");
  assert.equal(storedDeleteAudit.rows[0].reason, "Cleanup obsolete product");

  const deleteVariantsResult = await deleteProductVariants.execute(
    deleteProductVariants.schema.parse({
      productId: "gid://shopify/Product/1",
      variantIds: ["gid://shopify/ProductVariant/1", "gid://shopify/ProductVariant/2"],
      confirmation: "DELETE_VARIANTS",
      reason: "Cleanup obsolete variants",
    }),
    {
      shopifyClient: {
        request: async () => ({
          productVariantsBulkDelete: {
            product: {
              id: "gid://shopify/Product/1",
              title: "Demo product",
              variants: {
                edges: [],
              },
            },
            userErrors: [],
          },
        }),
      },
      tenantId: "tenant_remediation",
      requestId: "req_delete_variants",
      shopifyDomain: "unit-test-shop.myshopify.com",
    }
  );
  assert.ok(deleteVariantsResult.audit?.auditLogId, "delete-product-variants should return an audit log id");
  const storedVariantAudit = await themeDraftDb.pool.query(
    "SELECT * FROM mutation_audit_logs WHERE id = $1",
    [deleteVariantsResult.audit.auditLogId]
  );
  assert.equal(storedVariantAudit.rows.length, 1);
  assert.equal(storedVariantAudit.rows[0].tool_name, "delete-product-variants");

  const orderReadResult = await getOrderById.execute(
    getOrderById.schema.parse({
      orderId: "gid://shopify/Order/1",
    }),
    {
      shopifyClient: {
        request: async () => ({
          order: {
            id: "gid://shopify/Order/1",
            name: "#1001",
            createdAt: "2026-04-22T08:00:00Z",
            displayFinancialStatus: "PAID",
            displayFulfillmentStatus: "FULFILLED",
            totalPriceSet: { shopMoney: { amount: "19.95", currencyCode: "EUR" } },
            subtotalPriceSet: { shopMoney: { amount: "15.00", currencyCode: "EUR" } },
            totalShippingPriceSet: { shopMoney: { amount: "4.95", currencyCode: "EUR" } },
            totalTaxSet: { shopMoney: { amount: "0.00", currencyCode: "EUR" } },
            customer: null,
            shippingAddress: null,
            lineItems: { edges: [] },
            fulfillments: {
              nodes: [
                {
                  id: "gid://shopify/Fulfillment/1",
                  status: "SUCCESS",
                  createdAt: "2026-04-22T08:00:00Z",
                  trackingInfo: [
                    {
                      company: "UPS",
                      number: "TRACK-001",
                      url: "https://tracking.example/1",
                    },
                  ],
                },
              ],
            },
            tags: [],
            note: null,
            customAttributes: [{ key: "tracking_number", value: "LEGACY-1" }],
            metafields: {
              edges: [
                {
                  node: {
                    id: "gid://shopify/Metafield/1",
                    namespace: "shipping",
                    key: "carrier",
                    value: "DHL",
                    type: "single_line_text_field",
                  },
                },
              ],
            },
          },
        }),
      },
    }
  );
  assert.equal(orderReadResult.order.tracking.sourceOfTruth, "fulfillments.trackingInfo");
  assert.equal(orderReadResult.order.tracking.legacySignals.deprecated, true);
  assert.equal(orderReadResult.order.tracking.legacySignals.customAttributes.length, 1);

  console.log("remediation.test.mjs passed");
} finally {
  global.fetch = originalFetch;
  clearThemeEditMemory();
  await themeDraftDb.cleanup();
}
