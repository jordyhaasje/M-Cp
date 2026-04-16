import assert from "assert";
import dns from "dns/promises";
import { cloneProductFromUrl } from "../src/tools/cloneProductFromUrl.js";
import { getCustomerOrders } from "../src/tools/getCustomerOrders.js";
import { refundOrder } from "../src/tools/refundOrder.js";
import { updateCustomer } from "../src/tools/updateCustomer.js";
import { updateFulfillmentTracking } from "../src/tools/updateFulfillmentTracking.js";
import { updateOrder } from "../src/tools/updateOrder.js";
import { getThemeFileTool } from "../src/tools/getThemeFile.js";
import { getThemeFilesTool } from "../src/tools/getThemeFiles.js";
import { verifyThemeFilesTool } from "../src/tools/verifyThemeFiles.js";
import { draftThemeArtifact } from "../src/tools/draftThemeArtifact.js";
import { applyThemeDraft } from "../src/tools/applyThemeDraft.js";
import { patchThemeFileTool } from "../src/tools/patchThemeFile.js";
import { planThemeEditTool } from "../src/tools/planThemeEdit.js";
import { SearchThemeFilesInputSchema } from "../src/tools/searchThemeFiles.js";
import { createThemeDraftDbHarness } from "./helpers/themeDraftDbHarness.mjs";

const originalLookup = dns.lookup;
const originalFetch = global.fetch;
const themeDraftDb = createThemeDraftDbHarness();

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


  const singleThemeReadPayload = getThemeFileTool.schema.safeParse({
    key: "sections/test.liquid",
  });
  assert.equal(singleThemeReadPayload.success, true, "get-theme-file should accept exact keys without forcing a theme target");
  assert.equal(singleThemeReadPayload.data.themeRole, undefined, "get-theme-file should not silently inject main at schema level");

  const metadataBatchReadPayload = getThemeFilesTool.schema.safeParse({
    keys: ["sections/test.liquid"],
  });
  assert.equal(metadataBatchReadPayload.success, true, "get-theme-files should accept key arrays");
  assert.equal(metadataBatchReadPayload.data.includeContent, false, "get-theme-files default includeContent=false");
  assert.equal(metadataBatchReadPayload.data.themeRole, undefined, "get-theme-files should not silently inject main at schema level");

  const verifyBatchPayload = verifyThemeFilesTool.schema.safeParse({
    expected: [{ key: "sections/test.liquid" }],
  });
  assert.equal(verifyBatchPayload.success, true, "verify-theme-files should accept expected metadata");
  assert.equal(verifyBatchPayload.data.themeRole, undefined, "verify-theme-files should not silently inject main at schema level");

  const draftPayload = draftThemeArtifact.schema.parse({
    files: [
      {
        key: "sections/demo.liquid",
        value: `
<style>
  #shopify-section-{{ section.id }} .demo { display: grid; padding: 24px; border-radius: 16px; }
  @media screen and (max-width: 749px) { #shopify-section-{{ section.id }} .demo { padding: 16px; } }
</style>
<div class="demo">{{ section.settings.heading }}</div>
{% schema %}
{
  "name": "Demo",
  "settings": [
    { "type": "text", "id": "heading", "label": "Heading", "default": "Hello" },
    { "type": "range", "id": "gap", "label": "Gap", "min": 0, "max": 40, "step": 4, "default": 16 },
    { "type": "color", "id": "accent", "label": "Accent", "default": "#111111" }
  ],
  "presets": [{ "name": "Demo" }]
}
{% endschema %}
`,
      },
    ],
  });
  assert.equal(draftPayload.themeRole, undefined, "draft-theme-artifact should no longer default to preview-safe development themes");

  const draftPatchesPayload = draftThemeArtifact.schema.safeParse({
    files: [
      {
        key: "sections/demo.liquid",
        patches: [
          {
            searchString: "Demo",
            replaceString: "Updated demo",
          },
        ],
      },
    ],
  });
  assert.equal(draftPatchesPayload.success, true, "draft-theme-artifact should accept patches[] for one file");

  const invalidCreatePatchPayload = draftThemeArtifact.schema.safeParse({
    mode: "create",
    files: [
      {
        key: "sections/demo.liquid",
        patch: {
          searchString: "Demo",
          replaceString: "Updated demo",
        },
      },
    ],
  });
  assert.equal(
    invalidCreatePatchPayload.success,
    true,
    "draft-theme-artifact should expose compat payloads publicly and defer guarded create/edit validation to execution"
  );
  const invalidCreatePatchResult = await draftThemeArtifact.execute(
    invalidCreatePatchPayload.data,
    {}
  );
  assert.equal(invalidCreatePatchResult.success, false);
  assert.equal(invalidCreatePatchResult.errorCode, "invalid_draft_theme_artifact_input");
  assert.equal(invalidCreatePatchResult.nextAction, "fix_input");

  const patchThemeFilePayload = patchThemeFileTool.schema.safeParse({
    key: "snippets/product-info.liquid",
    patch: {
      searchString: "{%- when 'title' -%}",
      replaceString: "{%- when 'title' -%}\n  {%- render 'review-badge-inline', product: product -%}",
    },
  });
  assert.equal(patchThemeFilePayload.success, true, "patch-theme-file should accept a single-file literal patch");

  const planThemeEditPayload = planThemeEditTool.schema.safeParse({
    themeRole: "main",
    intent: "native_block",
    template: "product",
  });
  assert.equal(planThemeEditPayload.success, true, "plan-theme-edit should require an explicit theme target");

  const longPlanQueryPayload = planThemeEditTool.schema.safeParse({
    themeRole: "main",
    intent: "new_section",
    query: "Maak deze section exact na met desktop, mobiel, animaties en merchant-editable instellingen. ".repeat(8),
  });
  assert.equal(longPlanQueryPayload.success, true, "plan-theme-edit should accept longer client prompts");
  assert.equal(
    longPlanQueryPayload.data.query.length <= 240,
    true,
    "plan-theme-edit should compact long prompts into the internal short query budget"
  );

  const planThemeEditSummaryPayload = planThemeEditTool.schema.safeParse({
    _tool_input_summary: "Maak een native block in de productpagina van het live theme",
  });
  assert.equal(planThemeEditSummaryPayload.success, true, "plan-theme-edit should infer required fields from a compatible summary");
  assert.equal(planThemeEditSummaryPayload.data.themeRole, "main");
  assert.equal(planThemeEditSummaryPayload.data.intent, "native_block");
  assert.equal(planThemeEditSummaryPayload.data.template, "product");

  const planThemeEditAliasPayload = planThemeEditTool.schema.safeParse({
    type: "existing_edit",
    themeRole: "development",
    description: "Verklein de ruimte rond de buy button",
    targetFiles: ["sections/main-product.liquid"],
  });
  assert.equal(planThemeEditAliasPayload.success, true, "plan-theme-edit should accept compatibility aliases from report-style payloads");
  assert.equal(planThemeEditAliasPayload.data.intent, "existing_edit");
  assert.equal(planThemeEditAliasPayload.data.query, "Verklein de ruimte rond de buy button");
  assert.equal(planThemeEditAliasPayload.data.targetFile, "sections/main-product.liquid");

  const planThemeEditExistingSectionPayload = planThemeEditTool.schema.safeParse({
    _tool_input_summary: "Bekijk deze section in het live theme en bepaal welk bestaand bestand gepatcht moet worden",
  });
  assert.equal(planThemeEditExistingSectionPayload.success, true, "generic section wording should remain compatible");
  assert.equal(
    planThemeEditExistingSectionPayload.data.intent,
    "existing_edit",
    "generic section summaries should not be over-eagerly coerced into new_section flows"
  );

  const planThemeEditNewSectionPayload = planThemeEditTool.schema.safeParse({
    _tool_input_summary: "Maak een nieuwe section aan in het live theme",
  });
  assert.equal(planThemeEditNewSectionPayload.success, true, "explicit new section wording should still infer new_section");
  assert.equal(planThemeEditNewSectionPayload.data.intent, "new_section");

  const ambiguousPlanPayload = planThemeEditTool.schema.safeParse({
    _tool_input_summary: "Bepaal wat hier aangepast moet worden",
  });
  assert.equal(
    ambiguousPlanPayload.success,
    true,
    "plan-theme-edit should expose ambiguous compat payloads publicly and return a repair response at execution time"
  );
  const ambiguousPlanResult = await planThemeEditTool.execute(
    ambiguousPlanPayload.data,
    {}
  );
  assert.equal(ambiguousPlanResult.success, false);
  assert.equal(ambiguousPlanResult.errorCode, "missing_plan_theme_target");
  assert.equal(ambiguousPlanResult.nextAction, "provide_theme_target");

  const searchThemeFilesSummaryPayload = SearchThemeFilesInputSchema.safeParse({
    _tool_input_summary: "Zoek buy_buttons in de productpagina van het live theme",
  });
  assert.equal(searchThemeFilesSummaryPayload.success, true, "search-theme-files should accept compatible summary-only inputs");
  assert.ok(searchThemeFilesSummaryPayload.data.query.includes("buy_buttons"));
  assert.deepEqual(searchThemeFilesSummaryPayload.data.scope, ["sections", "snippets"]);

  const patchThemeFileSummaryPayload = patchThemeFileTool.schema.safeParse({
    _tool_input_summary: "Patch snippets/product-info.liquid in het live theme",
    searchString: "{%- when 'title' -%}",
    replaceString: "{%- when 'title' -%}\n  <span>Badge</span>",
  });
  assert.equal(patchThemeFileSummaryPayload.success, true, "patch-theme-file should normalize top-level search/replace shorthand");
  assert.equal(patchThemeFileSummaryPayload.data.key, "snippets/product-info.liquid");
  assert.equal(patchThemeFileSummaryPayload.data.themeRole, "main");
  assert.equal(patchThemeFileSummaryPayload.data.patch.searchString, "{%- when 'title' -%}");

  const patchThemeFileVagueSummaryPayload = patchThemeFileTool.schema.safeParse({
    _tool_input_summary: "Patch de product info snippet in het live theme",
    searchString: "{%- when 'title' -%}",
    replaceString: "{%- when 'title' -%}\n  <span>Badge</span>",
  });
  assert.equal(
    patchThemeFileVagueSummaryPayload.success,
    false,
    "patch-theme-file should keep requiring an explicit key when summary text does not contain one exact theme file path"
  );
  assert.ok(
    patchThemeFileVagueSummaryPayload.error.issues.some((issue) => issue.path.join(".") === "key"),
    "vague summaries should fail on the missing key field instead of inventing a best-guess file path"
  );

  const patchThemeFileReplacementsPayload = patchThemeFileTool.schema.safeParse({
    key: "sections/main-product.liquid",
    themeRole: "development",
    replacements: [
      {
        find: "padding-top: 48px;",
        replace: "padding-top: 24px;",
      },
    ],
  });
  assert.equal(patchThemeFileReplacementsPayload.success, true, "patch-theme-file should normalize replacements[{find,replace}] compatibility payloads");
  assert.equal(patchThemeFileReplacementsPayload.data.patches.length, 1);
  assert.equal(patchThemeFileReplacementsPayload.data.patches[0].searchString, "padding-top: 48px;");

  const draftTopLevelAliasPayload = draftThemeArtifact.schema.safeParse({
    themeRole: "main",
    key: "sections/demo-alias.liquid",
    value: `
<div>Demo</div>
{% schema %}
{
  "name": "Demo alias",
  "settings": [],
  "presets": [{ "name": "Demo alias" }]
}
{% endschema %}
`,
  });
  assert.equal(draftTopLevelAliasPayload.success, true, "draft-theme-artifact should accept single-file top-level aliases");
  assert.equal(draftTopLevelAliasPayload.data.files[0].key, "sections/demo-alias.liquid");

  const draftContentAliasPayload = draftThemeArtifact.schema.safeParse({
    themeRole: "main",
    key: "sections/demo-content-alias.liquid",
    content: `
<div>Demo</div>
{% schema %}
{
  "name": "Demo content alias",
  "settings": [],
  "presets": [{ "name": "Demo content alias" }]
}
{% endschema %}
`,
  });
  assert.equal(draftContentAliasPayload.success, true, "draft-theme-artifact should accept content as a compatibility alias for value");
  assert.equal(draftContentAliasPayload.data.files[0].value.includes("Demo content alias"), true);

  const draftSummaryOnlyPayload = draftThemeArtifact.schema.safeParse({
    _tool_input_summary: "Schrijf sections/stock-pulse.liquid naar het live theme",
  });
  assert.equal(
    draftSummaryOnlyPayload.success,
    true,
    "draft-theme-artifact should expose summary-only compat payloads publicly and repair them at execution time"
  );
  const draftSummaryOnlyResult = await draftThemeArtifact.execute(
    draftSummaryOnlyPayload.data,
    {}
  );
  assert.equal(draftSummaryOnlyResult.success, false);
  assert.equal(draftSummaryOnlyResult.errorCode, "missing_draft_files");
  assert.equal(draftSummaryOnlyResult.nextAction, "provide_structured_write_payload");
  assert.ok(
    draftSummaryOnlyResult.errors.some((issue) => issue.path.join(".") === "files"),
    "summary-only draft payloads should fail with a structured repair error on the missing write payload"
  );

  const invalidDraftSchemaPayload = draftThemeArtifact.schema.safeParse({
    files: [
      {
        key: "sections/demo.liquid",
        value: "<div>Demo</div>",
        patch: {
          searchString: "Demo",
          replaceString: "Updated demo",
        },
      },
    ],
  });
  assert.equal(
    invalidDraftSchemaPayload.success,
    false,
    "draft-theme-artifact should reject ambiguous file payloads before execution"
  );

  const invalidDraftResult = await draftThemeArtifact.execute(
    draftThemeArtifact.schema.parse({
      mode: "create",
      themeId: 111,
      files: [
        {
          key: "sections/invalid-stylesheet.liquid",
          value: `
{% stylesheet %}
  #shopify-section-{{ section.id }} .demo { padding: 24px; }
{% endstylesheet %}
<div class="demo">{{ section.settings.heading }}</div>
{% schema %}
{
  "name": "Invalid demo",
  "settings": [
    { "type": "text", "id": "heading", "label": "Heading", "default": "Hello" }
  ],
  "presets": [{ "name": "Invalid demo" }]
}
{% endschema %}
`,
        },
      ],
    }),
    { shopifyClient: mockShopifyClient }
  );
  assert.equal(invalidDraftResult.success, false);
  assert.equal(invalidDraftResult.errorCode, "inspection_failed_multiple");
  assert.ok(
    invalidDraftResult.errors.some((issue) => issue.issueCode === "inspection_failed_css"),
    "aggregated inspection failures should still preserve the css-specific machine-readable issue code"
  );
  assert.ok(
    invalidDraftResult.suggestedFixes.some((entry) => entry.includes("<style>")),
    "draft-theme-artifact should explain how to fix Liquid inside {% stylesheet %}"
  );

  const applyPayload = applyThemeDraft.schema.parse({
    draftId: "mock-1",
    confirmation: "APPLY_THEME_DRAFT",
    reason: "Promote approved preview",
  });
  assert.equal(applyPayload.themeRole, undefined, "apply-theme-draft should require an explicit target instead of defaulting to main");

  const refundResult = await refundOrder.execute(
    refundOrder.schema.parse({
      orderId: "gid://shopify/Order/1",
      confirmation: "REFUND_ORDER",
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

  const customerOrderQueries = [];
  const customerOrderClient = {
    request: async (_query, variables) => {
      customerOrderQueries.push(variables?.query);
      return {
        orders: {
          edges: [],
        },
      };
    },
  };
  await getCustomerOrders.execute(
    getCustomerOrders.schema.parse({ customerId: "123", limit: 5 }),
    { shopifyClient: customerOrderClient }
  );
  await getCustomerOrders.execute(
    getCustomerOrders.schema.parse({ customerId: "gid://shopify/Customer/123", limit: 5 }),
    { shopifyClient: customerOrderClient }
  );
  assert.deepEqual(
    customerOrderQueries,
    ["customer_id:123", "customer_id:123"],
    "get-customer-orders should normalize numeric and GID input to the same query path"
  );

  const updateCustomerIds = [];
  const updateCustomerClient = {
    request: async (_query, variables) => {
      updateCustomerIds.push(variables?.input?.id);
      return {
        customerUpdate: {
          customer: {
            id: variables?.input?.id,
            firstName: "Test",
            lastName: "Customer",
            email: "test@example.com",
            phone: null,
            tags: [],
            note: null,
            taxExempt: false,
            metafields: { edges: [] },
          },
          userErrors: [],
        },
      };
    },
  };
  await updateCustomer.execute(updateCustomer.schema.parse({ id: "123", firstName: "Test" }), {
    shopifyClient: updateCustomerClient,
  });
  await updateCustomer.execute(
    updateCustomer.schema.parse({ id: "gid://shopify/Customer/123", firstName: "Test" }),
    { shopifyClient: updateCustomerClient }
  );
  assert.deepEqual(
    updateCustomerIds,
    ["gid://shopify/Customer/123", "gid://shopify/Customer/123"],
    "update-customer should normalize numeric and GID input to canonical customer GID"
  );

  const resolvedRefundOrderIds = [];
  const refundIdentifierClient = {
    request: async (query, variables) => {
      const queryText = String(query);
      if (queryText.includes("query lookupOrderByReference")) {
        return {
          orders: {
            edges: [
              {
                node: {
                  id: "gid://shopify/Order/1",
                  name: "#1001",
                  createdAt: "2026-03-13T12:00:00Z",
                },
              },
            ],
          },
        };
      }
      if (queryText.includes("mutation RefundOrder")) {
        resolvedRefundOrderIds.push({
          orderId: variables?.input?.orderId,
          transactionOrderId: variables?.input?.transactions?.[0]?.orderId || null,
        });
        return {
          refundCreate: {
            refund: {
              id: "gid://shopify/Refund/2",
              createdAt: "2026-03-13T12:00:00Z",
              note: variables?.input?.note,
              totalRefundedSet: {
                shopMoney: { amount: "10.00", currencyCode: "EUR" },
                presentmentMoney: { amount: "10.00", currencyCode: "EUR" },
              },
            },
            order: {
              id: "gid://shopify/Order/1",
              name: "#1001",
            },
            userErrors: [],
          },
        };
      }
      throw new Error(`Unexpected refund request: ${queryText.slice(0, 80)}`);
    },
  };

  for (const orderInput of ["#1001", "1001", "gid://shopify/Order/1"]) {
    await refundOrder.execute(
      refundOrder.schema.parse({
        orderId: orderInput,
        confirmation: "REFUND_ORDER",
        audit: {
          amount: "10.00",
          reason: "Test matrix",
          scope: "partial",
        },
        transactions: [
          {
            amount: "10.00",
            gateway: "manual",
          },
        ],
      }),
      { shopifyClient: refundIdentifierClient }
    );
  }
  assert.deepEqual(
    resolvedRefundOrderIds,
    [
      { orderId: "gid://shopify/Order/1", transactionOrderId: "gid://shopify/Order/1" },
      { orderId: "gid://shopify/Order/1", transactionOrderId: "gid://shopify/Order/1" },
      { orderId: "gid://shopify/Order/1", transactionOrderId: "gid://shopify/Order/1" },
    ],
    "refund-order should resolve order references to a single canonical order GID before mutation"
  );

  const trackingContextCalls = [];
  const trackingContextClient = {
    request: async (query, variables) => {
      const queryText = String(query);
      if (queryText.includes("query getOrderTrackingContext")) {
        trackingContextCalls.push("context");
        return {
          order: {
            id: "gid://shopify/Order/1",
            name: "#1001",
            customAttributes: [],
            fulfillments: {
              nodes: [
                {
                  id: "gid://shopify/Fulfillment/1",
                  status: "SUCCESS",
                  createdAt: "2026-03-13T12:00:00Z",
                  trackingInfo: [],
                },
              ],
            },
            fulfillmentOrders: {
              nodes: [],
            },
          },
        };
      }
      if (queryText.includes("mutation fulfillmentTrackingInfoUpdate")) {
        return {
          fulfillmentTrackingInfoUpdate: {
            fulfillment: {
              id: "gid://shopify/Fulfillment/1",
              status: "SUCCESS",
              trackingInfo: [
                {
                  company: "UPS",
                  number: variables?.trackingInfoInput?.number,
                  url: variables?.trackingInfoInput?.url || null,
                },
              ],
            },
            userErrors: [],
          },
        };
      }
      if (queryText.includes("mutation orderUpdate")) {
        return {
          orderUpdate: {
            order: {
              id: "gid://shopify/Order/1",
              name: "#1001",
              email: null,
              note: null,
              tags: [],
              customAttributes: [],
              metafields: { edges: [] },
              shippingAddress: null,
            },
            userErrors: [],
          },
        };
      }
      throw new Error(`Unexpected tracking request: ${queryText.slice(0, 80)}`);
    },
  };

  await updateFulfillmentTracking.execute(
    updateFulfillmentTracking.schema.parse({
      orderId: "gid://shopify/Order/1",
      trackingNumber: "TRACK-CONTEXT-1",
      trackingCompany: "UPS",
    }),
    { shopifyClient: trackingContextClient }
  );

  await updateOrder.execute(
    updateOrder.schema.parse({
      id: "gid://shopify/Order/1",
      confirmation: "UPDATE_ORDER",
      reason: "Testing tracking context updates",
      tracking: {
        number: "TRACK-CONTEXT-2",
        company: "UPS",
      },
    }),
    { shopifyClient: trackingContextClient }
  );

  assert.equal(
    trackingContextCalls.length >= 2,
    true,
    "tracking update tools should execute order tracking context fetch in both execution paths"
  );

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

  console.log("toolHardening.test.mjs passed");
} finally {
  dns.lookup = originalLookup;
  global.fetch = originalFetch;
  await themeDraftDb.cleanup();
}
