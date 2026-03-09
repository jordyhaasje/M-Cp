import assert from "assert";
import dns from "dns/promises";
import { PNG } from "pngjs";
import { cloneProductFromUrl } from "../src/tools/cloneProductFromUrl.js";
import { updateFulfillmentTracking } from "../src/tools/updateFulfillmentTracking.js";
import { refundOrder } from "../src/tools/refundOrder.js";
import { upsertThemeFileTool } from "../src/tools/upsertThemeFile.js";
import { replicateSectionFromReference } from "../src/tools/replicateSectionFromReference.js";
import { __setSectionReplicationV3RuntimeForTests } from "../src/lib/sectionReplicationV3.js";

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

    if (parsedUrl.hostname === "example.com" && method === "GET") {
      const repeated = Array.from({ length: 40 }, () => "<p>Replica Hero V2 fast and deterministic section generation with configurable tabs, headings, images, cta label, and cta url.</p>").join("");
      return new Response(
        `<html><head><title>Replica Hero V2</title></head><body><h2>Replica Hero V2</h2><h3>Fast and deterministic section generation</h3>${repeated}</body></html>`,
        { status: 200, headers: { "content-type": "text/html" } }
      );
    }

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
  replicateSectionFromReference.initialize(themeClient);

  const themeUpsertResult = await upsertThemeFileTool.execute({
    key: "sections/theme-tooling-test.liquid",
    value: "<div>theme tooling test</div>",
  });
  assert.equal(themeUpsertResult.theme.id, 111);
  assert.equal(themeUpsertResult.asset.key, "sections/theme-tooling-test.liquid");

  const solidPng = (hex = "f2eadf") => {
    const png = new PNG({ width: 32, height: 32 });
    const color = hex.length === 6 ? hex : "f2eadf";
    const red = Number.parseInt(color.slice(0, 2), 16);
    const green = Number.parseInt(color.slice(2, 4), 16);
    const blue = Number.parseInt(color.slice(4, 6), 16);
    for (let i = 0; i < png.data.length; i += 4) {
      png.data[i] = red;
      png.data[i + 1] = green;
      png.data[i + 2] = blue;
      png.data[i + 3] = 255;
    }
    return PNG.sync.write(png);
  };

  __setSectionReplicationV3RuntimeForTests({
    captureReference: async () => [
      {
        id: "desktop",
        ok: true,
        statusCode: 200,
        clip: { x: 0, y: 0, width: 320, height: 220 },
        target: {
          selector: "[id*='ss_feature_15']",
          score: 1000,
          heading: "What makes it special?",
          html: `<section><h2>What makes it special?</h2><button>Soft as a cloud</button><button>Optimal support</button><button>Sustainability</button><p>The BENI BED is a pillowy, roll-up bed that you can take anywhere.</p><img src=\"https://cdn.example.com/feature-1.jpg\"></section>`,
          text: "Feature 15 what makes it special soft as a cloud optimal support sustainability",
        },
        mergedText: "Feature 15 what makes it special soft as a cloud optimal support sustainability",
        mergedHtml: "<main><section>Feature #15</section></main>",
      },
      {
        id: "mobile",
        ok: true,
        statusCode: 200,
        clip: { x: 0, y: 0, width: 280, height: 420 },
        target: {
          selector: "[id*='ss_feature_15']",
          score: 900,
          heading: "What makes it special?",
          html: `<section><h2>What makes it special?</h2></section>`,
          text: "Feature 15 mobile",
        },
        mergedText: "Feature 15 mobile",
        mergedHtml: "<main><section>Feature #15 mobile</section></main>",
      },
    ],
    renderCandidateViews: async () => [
      { id: "desktop", ok: true, screenshotBuffer: solidPng("f2eadf"), clip: { x: 0, y: 0, width: 320, height: 220 } },
      { id: "mobile", ok: true, screenshotBuffer: solidPng("f2eadf"), clip: { x: 0, y: 0, width: 280, height: 420 } },
    ],
    compareVisualGate: async ({ attempt }) => {
      if (attempt === 1) {
        return {
          status: "fail",
          perViewport: [
            { id: "desktop", pass: false, mismatchRatio: 0.21, threshold: 0.12, mismatchPixels: 2100, totalPixels: 10000 },
            { id: "mobile", pass: false, mismatchRatio: 0.24, threshold: 0.15, mismatchPixels: 2400, totalPixels: 10000 },
          ],
        };
      }
      return {
        status: "pass",
        perViewport: [
          { id: "desktop", pass: true, mismatchRatio: 0.06, threshold: 0.12, mismatchPixels: 600, totalPixels: 10000 },
          { id: "mobile", pass: true, mismatchRatio: 0.08, threshold: 0.15, mismatchPixels: 800, totalPixels: 10000 },
        ],
      };
    },
  });

  const replicatedSection = await replicateSectionFromReference.execute({
    referenceUrl: "https://section.store/pages/feature-15",
    visionHints: "Feature 15 tabs with heading and right image",
    imageUrls: ["https://cdn.example.com/feature-1.jpg"],
    sectionHandle: "Feature 15 Slider",
    overwriteSection: true,
    addToTemplate: true,
    templateKey: "templates/index.json",
    maxAttempts: 3,
    verify: true,
  });

  assert.equal(replicatedSection.action, "replicate_section_from_reference");
  assert.equal(replicatedSection.status, "pass");
  assert.equal(replicatedSection.archetype, "feature-tabs-media-slider");
  assert.equal(replicatedSection.writes.section.key, "sections/feature-15-slider.liquid");
  assert.ok(
    replicatedSection.writes.additionalFiles.some((entry) => entry.key === "assets/section-feature-15-slider.css"),
    "replicate-section-from-reference should write generated css asset"
  );
  assert.ok(
    replicatedSection.writes.additionalFiles.some((entry) => entry.key === "assets/section-feature-15-slider.js"),
    "replicate-section-from-reference should write generated js asset"
  );
  assert.equal(replicatedSection.attempts.length, 2, "pipeline should retry after visual gate fail");

  const directReplicaWrite = themeRestCalls.find(
    (entry) =>
      entry.method === "PUT" &&
      entry.pathname.endsWith("/themes/111/assets.json") &&
      entry.bodyJson?.asset?.key === "sections/feature-15-slider.liquid"
  );
  assert.ok(directReplicaWrite, "replicate-section-from-reference should write generated section file");

  __setSectionReplicationV3RuntimeForTests({
    captureReference: async () => [
      {
        id: "desktop",
        ok: true,
        statusCode: 200,
        clip: { x: 0, y: 0, width: 320, height: 220 },
        target: {
          selector: "section",
          score: 100,
          heading: "Random section",
          html: "<section><h2>Random</h2></section>",
          text: "random section without known archetype",
        },
        mergedText: "random section without known archetype",
        mergedHtml: "<main>random</main>",
      },
      {
        id: "mobile",
        ok: true,
        statusCode: 200,
        clip: { x: 0, y: 0, width: 280, height: 420 },
        target: {
          selector: "section",
          score: 80,
          heading: "Random section",
          html: "<section><h2>Random</h2></section>",
          text: "random section",
        },
        mergedText: "random section",
        mergedHtml: "<main>random mobile</main>",
      },
    ],
  });

  const unsupportedReplica = await replicateSectionFromReference.execute({
    referenceUrl: "https://example.com/no-known-archetype",
    maxAttempts: 1,
  });
  assert.equal(unsupportedReplica.status, "fail");
  assert.equal(unsupportedReplica.errorCode, "unsupported_archetype");
  assert.equal(unsupportedReplica.writes, null);

  __setSectionReplicationV3RuntimeForTests({
    captureReference: async () => [
      {
        id: "desktop",
        ok: true,
        statusCode: 200,
        clip: { x: 0, y: 0, width: 320, height: 220 },
        target: {
          selector: "[id*='ss_feature_15']",
          score: 1000,
          heading: "What makes it special?",
          html: "<section><h2>What makes it special?</h2></section>",
          text: "feature 15 what makes it special",
        },
        mergedText: "feature 15 what makes it special",
        mergedHtml: "<main>feature 15</main>",
      },
      {
        id: "mobile",
        ok: true,
        statusCode: 200,
        clip: { x: 0, y: 0, width: 280, height: 420 },
        target: {
          selector: "[id*='ss_feature_15']",
          score: 900,
          heading: "What makes it special?",
          html: "<section><h2>What makes it special?</h2></section>",
          text: "feature 15 mobile",
        },
        mergedText: "feature 15 mobile",
        mergedHtml: "<main>feature 15 mobile</main>",
      },
    ],
    renderCandidateViews: async () => [
      { id: "desktop", ok: true, screenshotBuffer: solidPng("f2eadf"), clip: { x: 0, y: 0, width: 320, height: 220 } },
      { id: "mobile", ok: true, screenshotBuffer: solidPng("f2eadf"), clip: { x: 0, y: 0, width: 280, height: 420 } },
    ],
    compareVisualGate: async () => ({
      status: "pass",
      perViewport: [
        { id: "desktop", pass: true, mismatchRatio: 0.03, threshold: 0.12, mismatchPixels: 300, totalPixels: 10000 },
        { id: "mobile", pass: true, mismatchRatio: 0.05, threshold: 0.15, mismatchPixels: 500, totalPixels: 10000 },
      ],
    }),
  });

  const templateFailReplica = await replicateSectionFromReference.execute({
    referenceUrl: "https://section.store/pages/feature-15",
    insertPosition: "before",
    maxAttempts: 1,
  });
  assert.equal(templateFailReplica.status, "fail");
  assert.equal(templateFailReplica.errorCode, "template_insert_invalid");
  assert.equal(templateFailReplica.writes, null);

  __setSectionReplicationV3RuntimeForTests({
    captureReference: async () => [
      { id: "desktop", ok: false, statusCode: null, error: "network timeout" },
      { id: "mobile", ok: false, statusCode: null, error: "network timeout" },
    ],
  });

  const unreachableReplica = await replicateSectionFromReference.execute({
    referenceUrl: "https://preview-unreachable.invalid/feature",
    maxAttempts: 1,
  });
  assert.equal(unreachableReplica.status, "fail");
  assert.equal(unreachableReplica.errorCode, "reference_unreachable");
  assert.equal(unreachableReplica.writes, null);

  __setSectionReplicationV3RuntimeForTests({
    captureReference: async () => [
      {
        id: "desktop",
        ok: true,
        statusCode: 200,
        clip: { x: 0, y: 0, width: 320, height: 220 },
        target: {
          selector: "[id*='ss_feature_15']",
          score: 1000,
          heading: "What makes it special?",
          html: "<section><h2>What makes it special?</h2></section>",
          text: "feature 15 what makes it special",
        },
        mergedText: "feature 15 what makes it special",
        mergedHtml: "<main>feature 15</main>",
      },
      {
        id: "mobile",
        ok: true,
        statusCode: 200,
        clip: { x: 0, y: 0, width: 280, height: 420 },
        target: {
          selector: "[id*='ss_feature_15']",
          score: 900,
          heading: "What makes it special?",
          html: "<section><h2>What makes it special?</h2></section>",
          text: "feature 15 mobile",
        },
        mergedText: "feature 15 mobile",
        mergedHtml: "<main>feature 15 mobile</main>",
      },
    ],
    renderCandidateViews: async () => [
      { id: "desktop", ok: true, screenshotBuffer: solidPng("f2eadf"), clip: { x: 0, y: 0, width: 320, height: 220 } },
      { id: "mobile", ok: true, screenshotBuffer: solidPng("f2eadf"), clip: { x: 0, y: 0, width: 280, height: 420 } },
    ],
    compareVisualGate: async () => ({
      status: "fail",
      perViewport: [
        { id: "desktop", pass: false, mismatchRatio: 0.42, threshold: 0.12, mismatchPixels: 4200, totalPixels: 10000 },
        { id: "mobile", pass: false, mismatchRatio: 0.38, threshold: 0.15, mismatchPixels: 3800, totalPixels: 10000 },
      ],
    }),
  });

  const visualFailReplica = await replicateSectionFromReference.execute({
    referenceUrl: "https://section.store/pages/feature-15",
    maxAttempts: 1,
  });
  assert.equal(visualFailReplica.status, "fail");
  assert.equal(visualFailReplica.errorCode, "visual_gate_fail");
  assert.equal(visualFailReplica.writes, null);

  __setSectionReplicationV3RuntimeForTests(null);

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
