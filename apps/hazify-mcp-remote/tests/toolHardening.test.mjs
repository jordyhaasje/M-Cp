import assert from "assert";
import dns from "dns/promises";
import { cloneProductFromUrl } from "../src/tools/cloneProductFromUrl.js";
import { updateFulfillmentTracking } from "../src/tools/updateFulfillmentTracking.js";
import { refundOrder } from "../src/tools/refundOrder.js";
import { upsertThemeFileTool } from "../src/tools/upsertThemeFile.js";
import { importSectionToLiveTheme } from "../src/tools/importSectionToLiveTheme.js";
import { buildThemeSectionBundle } from "../src/tools/buildThemeSectionBundle.js";
import { prepareSectionReplica } from "../src/tools/prepareSectionReplica.js";
import { applySectionReplica } from "../src/tools/applySectionReplica.js";

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

  const invalidThemeUpsert = upsertThemeFileTool.schema.safeParse({
    key: "sections/test.liquid",
  });
  assert.equal(invalidThemeUpsert.success, false, "upsert-theme-file should require value or attachment");

  const themeRestCalls = [];
  const themeAssetStore = new Map([
    ["sections/existing.liquid", "<div>already exists</div>"],
    [
      "templates/index.json",
      JSON.stringify(
        {
          sections: {
            header: { type: "header" },
            main: { type: "main-page" },
          },
          order: ["header", "main"],
        },
        null,
        2
      ),
    ],
  ]);
  global.fetch = async (url, options = {}) => {
    const parsedUrl = new URL(String(url));
    const method = String(options.method || "GET").toUpperCase();
    const bodyText = typeof options.body === "string" ? options.body : "";
    const bodyJson = bodyText ? JSON.parse(bodyText) : null;

    themeRestCalls.push({
      method,
      pathname: parsedUrl.pathname,
      search: parsedUrl.search,
      bodyJson,
    });

    if (parsedUrl.pathname.endsWith("/themes.json") && method === "GET") {
      return new Response(
        JSON.stringify({
          themes: [
            { id: 111, name: "Main Theme", role: "main", previewable: true, processing: false },
            { id: 222, name: "Dev Theme", role: "development", previewable: true, processing: false },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }

    if (parsedUrl.pathname.endsWith("/themes/111/assets.json") && method === "PUT") {
      const asset = bodyJson?.asset || {};
      if (typeof asset.key === "string") {
        if (typeof asset.value === "string") {
          themeAssetStore.set(asset.key, asset.value);
        } else if (typeof asset.attachment === "string") {
          themeAssetStore.set(asset.key, asset.attachment);
        }
      }
      return new Response(
        JSON.stringify({
          asset: {
            key: asset.key,
            checksum: "abc123",
            value: asset.value || null,
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }

    if (parsedUrl.pathname.endsWith("/themes/111/assets.json") && method === "GET") {
      const key = parsedUrl.searchParams.get("asset[key]");
      if (key && themeAssetStore.has(key)) {
        return new Response(
          JSON.stringify({
            asset: {
              key,
              value: themeAssetStore.get(key),
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      return new Response(JSON.stringify({ errors: "Not Found" }), {
        status: 404,
        headers: { "content-type": "application/json" },
      });
    }

    throw new Error(`Unexpected theme REST call: ${method} ${parsedUrl.pathname}${parsedUrl.search}`);
  };

  const themeClient = {
    url: "https://unit-test-shop.myshopify.com/admin/api/2026-01/graphql.json",
    requestConfig: {
      headers: {
        "X-Shopify-Access-Token": "shpat_theme",
      },
    },
  };
  upsertThemeFileTool.initialize(themeClient);
  importSectionToLiveTheme.initialize(themeClient);
  buildThemeSectionBundle.initialize(themeClient);
  prepareSectionReplica.initialize(themeClient);
  applySectionReplica.initialize(themeClient);

  const themeUpsertResult = await upsertThemeFileTool.execute({
    key: "sections/theme-tooling-test.liquid",
    value: "<div>theme tooling test</div>",
  });
  assert.equal(themeUpsertResult.theme.id, 111);
  assert.equal(themeUpsertResult.asset.key, "sections/theme-tooling-test.liquid");

  const validSectionLiquid = `<section>{{ section.settings.title }}</section>
{% schema %}
{
  "name": "Cloudpillo Risk Free",
  "settings": [
    { "type": "text", "id": "title", "label": "Title", "default": "Risk Free" }
  ],
  "presets": [
    { "name": "Cloudpillo Risk Free", "category": "Promotional" }
  ]
}
{% endschema %}`;

  const importResult = await importSectionToLiveTheme.execute({
    sectionHandle: "Cloudpillo Risk Free!",
    liquid: validSectionLiquid,
    overwrite: true,
    addToTemplate: true,
    templateKey: "templates/index.json",
    sectionSettings: {
      title: "Risk Free",
    },
  });
  assert.equal(importResult.section.key, "sections/cloudpillo-risk-free.liquid");
  assert.equal(importResult.deprecation?.status, "deprecated_wrapper");
  const importPutRequest = themeRestCalls.find(
    (entry) =>
      entry.method === "PUT" &&
      entry.pathname.endsWith("/themes/111/assets.json") &&
      entry.bodyJson?.asset?.key === "sections/cloudpillo-risk-free.liquid"
  );
  assert.ok(importPutRequest, "import-section-to-live-theme should upsert normalized section key");
  const templatePutRequest = themeRestCalls.find(
    (entry) =>
      entry.method === "PUT" &&
      entry.pathname.endsWith("/themes/111/assets.json") &&
      entry.bodyJson?.asset?.key === "templates/index.json"
  );
  assert.ok(templatePutRequest, "import-section-to-live-theme should update template JSON when addToTemplate=true");
  const templateJson = JSON.parse(templatePutRequest.bodyJson.asset.value);
  assert.ok(
    Object.values(templateJson.sections || {}).some((section) => section?.type === "cloudpillo-risk-free"),
    "template should include inserted section type"
  );
  assert.ok(
    (templateJson.order || []).some((entry) => String(entry).includes("cloudpillo_risk_free")),
    "template order should include inserted section id"
  );

  let rejectedMissingPresets = false;
  try {
    await importSectionToLiveTheme.execute({
      sectionHandle: "No Preset Section",
      liquid: `<section>no presets</section>
{% schema %}
{ "name": "No Preset Section" }
{% endschema %}`,
      overwrite: true,
      validateSchema: true,
      requirePresets: true,
    });
  } catch (error) {
    rejectedMissingPresets = error instanceof Error && error.message.includes("presets");
  }
  assert.equal(rejectedMissingPresets, true, "schema validation should reject sections without presets");

  let rejectedExistingSection = false;
  try {
    await importSectionToLiveTheme.execute({
      sectionHandle: "existing",
      liquid: validSectionLiquid,
      overwrite: false,
      validateSchema: false,
    });
  } catch (error) {
    rejectedExistingSection =
      error instanceof Error && error.message.includes("bestaat al");
  }
  assert.equal(rejectedExistingSection, true, "overwrite=false should block existing section files");

  const bundleSectionLiquid = `<section class="bundle-nav">{{ section.settings.title }}</section>
{% schema %}
{
  "name": "Bundle Navigation",
  "settings": [
    { "type": "text", "id": "title", "label": "Title", "default": "Bundle Menu" }
  ],
  "presets": [
    { "name": "Bundle Navigation", "category": "Navigation" }
  ]
}
{% endschema %}`;

  const bundleResult = await buildThemeSectionBundle.execute({
    sectionHandle: "Bundle Navigation",
    sectionLiquid: bundleSectionLiquid,
    overwriteSection: true,
    addToTemplate: true,
    templateKey: "templates/index.json",
    sectionSettings: { title: "Bundle Menu" },
    additionalFiles: [
      {
        key: "assets/section-bundle-navigation.css",
        value: ".bundle-nav{display:flex;gap:12px;}",
      },
      {
        key: "snippets/bundle-navigation-item.liquid",
        value: "<a href=\"{{ link }}\">{{ label }}</a>",
      },
    ],
    verify: true,
    referenceUrl: "https://section.store/pages/bubble-navigation",
    designNotes: "Circle menu from reference page",
  });

  assert.equal(bundleResult.action, "built_theme_section_bundle");
  assert.equal(bundleResult.section.key, "sections/bundle-navigation.liquid");
  assert.ok(bundleResult.template?.key === "templates/index.json");
  assert.equal(bundleResult.additionalFiles.length, 2, "bundle should write supporting files");
  assert.equal(bundleResult.deprecation?.status, "deprecated_wrapper");
  assert.ok(
    Array.isArray(bundleResult.docs) &&
      bundleResult.docs.some((doc) => String(doc.url || "").includes("/architecture/sections")),
    "bundle should return Shopify section docs"
  );

  const bundleCssWrite = themeRestCalls.find(
    (entry) =>
      entry.method === "PUT" &&
      entry.pathname.endsWith("/themes/111/assets.json") &&
      entry.bodyJson?.asset?.key === "assets/section-bundle-navigation.css"
  );
  assert.ok(bundleCssWrite, "bundle should write CSS asset");

  let rejectedInvalidAdditionalPath = false;
  try {
    await buildThemeSectionBundle.execute({
      sectionHandle: "Invalid Additional",
      sectionLiquid: bundleSectionLiquid,
      overwriteSection: true,
      addToTemplate: false,
      additionalFiles: [
        {
          key: "templates/product.json",
          value: "{}",
        },
      ],
    });
  } catch (error) {
    rejectedInvalidAdditionalPath =
      error instanceof Error && error.message.includes("additionalFiles key");
  }
  assert.equal(
    rejectedInvalidAdditionalPath,
    true,
    "bundle should reject additionalFiles keys outside allowed prefixes"
  );

  const v2Spec = {
    version: "v2",
    name: "Replica Hero V2",
    tag: "section",
    className: "replica-hero-v2",
    settings: [
      { type: "text", id: "headline", label: "Headline", default: "Replica Hero" },
      { type: "textarea", id: "subline", label: "Subline", default: "Fast and deterministic section generation" },
      { type: "text", id: "cta_label", label: "CTA label", default: "Shop now" },
      { type: "url", id: "cta_url", label: "CTA URL" },
    ],
    blocks: [
      {
        type: "feature",
        name: "Feature",
        settings: [
          { type: "text", id: "title", label: "Title" },
          { type: "textarea", id: "description", label: "Description" },
        ],
      },
    ],
    presets: [
      {
        name: "Replica Hero V2",
        category: "Custom",
        blocks: [{ type: "feature" }],
      },
    ],
    markup: {
      mode: "structured",
      sectionItems: [
        { kind: "heading", settingId: "headline", tag: "h2", className: "replica-hero-v2__headline" },
        { kind: "richtext", settingId: "subline", className: "replica-hero-v2__subline" },
        {
          kind: "button",
          labelSettingId: "cta_label",
          urlSettingId: "cta_url",
          className: "replica-hero-v2__cta",
        },
        { kind: "blocks", className: "replica-hero-v2__features", emptyText: "No features configured yet" },
      ],
      blockLayouts: [
        {
          blockType: "feature",
          className: "replica-hero-v2__feature",
          items: [
            { kind: "heading", settingId: "title", tag: "h3" },
            { kind: "text", settingId: "description", tag: "p" },
          ],
        },
      ],
    },
    mobileRules: [{ breakpointPx: 768, css: ".replica-hero-v2{padding:16px;}" }],
    assets: {
      css: ".replica-hero-v2{padding:48px;} .replica-hero-v2__features{display:grid;gap:16px;}",
      snippets: [{ key: "replica-v2-badge.liquid", content: "<span class=\"replica-badge\">Replica</span>" }],
      files: [],
    },
  };

  const preparedReplica = await prepareSectionReplica.execute({
    referenceUrl: "https://example.com/replica",
    imageUrls: [],
    previewRequired: false,
    sectionHandle: "Replica Hero V2",
    sectionSpec: v2Spec,
    overwriteSection: true,
    addToTemplate: true,
    templateKey: "templates/index.json",
    sectionSettings: {
      headline: "Replica Hero",
    },
    applyOn: "warn",
  });
  assert.equal(preparedReplica.action, "prepared_section_replica");
  assert.ok(typeof preparedReplica.planId === "string" && preparedReplica.planId.startsWith("secplan_"));
  assert.ok(
    preparedReplica.validation?.preflight?.status === "warn" ||
      preparedReplica.validation?.preflight?.status === "pass"
  );
  assert.equal(preparedReplica.filePlan.section.key, "sections/replica-hero-v2.liquid");
  assert.ok(Array.isArray(preparedReplica.previewTargets) && preparedReplica.previewTargets.length === 2);

  const appliedReplica = await applySectionReplica.execute({
    planId: preparedReplica.planId,
    allowWarn: true,
    verify: true,
  });
  assert.equal(appliedReplica.action, "applied_section_replica");
  assert.equal(appliedReplica.section.key, "sections/replica-hero-v2.liquid");
  assert.ok(appliedReplica.template?.key === "templates/index.json");
  assert.ok(
    appliedReplica.additionalFiles.some((entry) => entry.key === "assets/section-replica-hero-v2.css"),
    "apply-section-replica should write generated section css asset"
  );
  assert.ok(
    appliedReplica.additionalFiles.some((entry) => entry.key === "snippets/replica-v2-badge.liquid"),
    "apply-section-replica should write snippet from section spec"
  );

  const directReplicaWrite = themeRestCalls.find(
    (entry) =>
      entry.method === "PUT" &&
      entry.pathname.endsWith("/themes/111/assets.json") &&
      entry.bodyJson?.asset?.key === "sections/replica-hero-v2.liquid"
  );
  assert.ok(directReplicaWrite, "apply-section-replica should write generated section file");

  const failedPreviewPlan = await prepareSectionReplica.execute({
    referenceUrl: "https://example.com/replica",
    imageUrls: [],
    previewRequired: true,
    sectionHandle: "Replica Failing Preview",
    sectionSpec: {
      ...v2Spec,
      name: "Replica Failing Preview",
      presets: [{ name: "Replica Failing Preview" }],
      markup: {
        ...v2Spec.markup,
      },
    },
    overwriteSection: true,
    addToTemplate: false,
    applyOn: "warn",
  });
  assert.equal(failedPreviewPlan.validation?.preflight?.status, "fail");

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
