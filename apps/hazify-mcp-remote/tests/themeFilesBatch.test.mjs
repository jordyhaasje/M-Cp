import assert from "assert";
import crypto from "crypto";
import { getThemeFiles, upsertThemeFiles, verifyThemeFiles } from "../src/lib/themeFiles.js";
import { createThemeDraftDbHarness } from "./helpers/themeDraftDbHarness.mjs";

const originalFetch = global.fetch;
const themeDraftDb = createThemeDraftDbHarness();

const themeGraphqlId = "gid://shopify/OnlineStoreTheme/123";
const fixedNow = "2026-03-15T12:00:00Z";

const toChecksumMd5 = (payload, encoding = "utf8") =>
  crypto.createHash("md5").update(Buffer.from(payload, encoding)).digest("base64");

const fileStore = new Map();
const setTextFile = (key, value) => {
  fileStore.set(key, {
    filename: key,
    value,
    checksumMd5: toChecksumMd5(value),
    contentType: "text/plain",
    size: Buffer.byteLength(value, "utf8"),
    createdAt: fixedNow,
    updatedAt: fixedNow,
  });
};

setTextFile("sections/existing.liquid", "<div>Existing</div>");
setTextFile("sections/other.liquid", "<div>Other</div>");

const baseThemeNode = {
  id: themeGraphqlId,
  name: "Main Theme",
  role: "MAIN",
  processing: false,
  createdAt: fixedNow,
  updatedAt: fixedNow,
};

const toGraphqlFileNode = (file, includeContent) => {
  const node = {
    filename: file.filename,
    checksumMd5: file.checksumMd5,
    contentType: file.contentType,
    createdAt: file.createdAt,
    updatedAt: file.updatedAt,
    size: file.size,
  };
  if (includeContent) {
    node.body = { content: file.value };
  }
  return node;
};

global.fetch = async (url, options = {}) => {
  const parsedUrl = new URL(url);
  if (!parsedUrl.pathname.endsWith("/graphql.json")) {
    throw new Error(`Unexpected URL: ${url}`);
  }

  const payload = JSON.parse(options.body || "{}");
  const query = String(payload.query || "");
  const variables = payload.variables || {};

  if (query.includes("query ThemeById")) {
    return new Response(
      JSON.stringify({
        data: {
          theme: baseThemeNode,
        },
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  }

  if (query.includes("query ThemeFileById")) {
    const requested = Array.isArray(variables.filenames) ? variables.filenames : [];
    const nodes = requested
      .map((key) => fileStore.get(key))
      .filter(Boolean)
      .map((file) => toGraphqlFileNode(file, true));
    return new Response(
      JSON.stringify({
        data: {
          theme: {
            ...baseThemeNode,
            files: {
              nodes,
              userErrors: [],
            },
          },
        },
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  }

  if (query.includes("query ThemeFilesByIdMetadata")) {
    const requested = Array.isArray(variables.filenames) ? variables.filenames : [];
    const nodes = requested
      .map((key) => fileStore.get(key))
      .filter(Boolean)
      .map((file) => toGraphqlFileNode(file, false));
    return new Response(
      JSON.stringify({
        data: {
          theme: {
            ...baseThemeNode,
            files: {
              nodes,
              userErrors: [],
            },
          },
        },
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  }

  if (query.includes("query ThemeFilesByIdWithContent")) {
    const requested = Array.isArray(variables.filenames) ? variables.filenames : [];
    const nodes = requested
      .map((key) => fileStore.get(key))
      .filter(Boolean)
      .map((file) => toGraphqlFileNode(file, true));
    return new Response(
      JSON.stringify({
        data: {
          theme: {
            ...baseThemeNode,
            files: {
              nodes,
              userErrors: [],
            },
          },
        },
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  }

  if (query.includes("mutation ThemeFilesUpsert")) {
    const inputFiles = Array.isArray(variables.files) ? variables.files : [];
    const userErrors = [];
    const upsertedThemeFiles = [];

    for (const entry of inputFiles) {
      const key = entry?.filename;
      const body = entry?.body;
      if (!key || !body) {
        continue;
      }
      if (key === "sections/error.liquid") {
        userErrors.push({
          filename: key,
          code: "INVALID",
          message: "Simulated write failure",
        });
        continue;
      }

      const value = String(body.value || "");
      setTextFile(key, value);
      upsertedThemeFiles.push({ filename: key });
    }

    return new Response(
      JSON.stringify({
        data: {
          themeFilesUpsert: {
            upsertedThemeFiles,
            job: { id: "gid://shopify/Job/1" },
            userErrors,
          },
        },
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  }

  throw new Error(`Unexpected GraphQL query: ${query.slice(0, 120)}`);
};

const shopifyClient = {
  request: async () => {
    throw new Error("Direct request() should not be used in themeFiles batch test");
  },
  url: "https://unit-test-shop.myshopify.com/admin/api/2026-01/graphql.json",
  requestConfig: {
    headers: {
      "X-Shopify-Access-Token": "shpat_unit_test",
    },
  },
};

try {
  const metadataResult = await getThemeFiles(shopifyClient, "2026-01", {
    themeId: 123,
    keys: ["sections/existing.liquid", "sections/missing.liquid"],
    includeContent: false,
  });
  assert.equal(metadataResult.files.length, 2);
  const existingMetadata = metadataResult.files.find((file) => file.key === "sections/existing.liquid");
  const missingMetadata = metadataResult.files.find((file) => file.key === "sections/missing.liquid");
  assert.equal(existingMetadata.found, true, "existing file should be marked as found");
  assert.equal("value" in existingMetadata, false, "metadata-only read should not include value");
  assert.equal(missingMetadata.missing, true, "missing file should be marked as missing");

  const withContentResult = await getThemeFiles(shopifyClient, "2026-01", {
    themeId: 123,
    keys: ["sections/existing.liquid"],
    includeContent: true,
  });
  assert.equal(withContentResult.files[0].value, "<div>Existing</div>");

  const verifyResult = await verifyThemeFiles(shopifyClient, "2026-01", {
    themeId: 123,
    expected: [
      {
        key: "sections/existing.liquid",
        size: Buffer.byteLength("<div>Existing</div>", "utf8"),
      },
      {
        key: "sections/existing.liquid-mismatch",
        size: 12,
      },
      {
        key: "sections/other.liquid",
        checksumMd5: "invalid-checksum",
      },
    ],
  });
  assert.equal(verifyResult.summary.total, 3);
  assert.equal(verifyResult.summary.match, 1);
  assert.equal(verifyResult.summary.missing, 1);
  assert.equal(verifyResult.summary.mismatch, 1);

  const upsertResult = await upsertThemeFiles(shopifyClient, "2026-01", {
    themeId: 123,
    verifyAfterWrite: true,
    files: [
      {
        key: "sections/existing.liquid",
        value: "<div>Should fail checksum precondition</div>",
        checksum: "invalid-old-checksum",
      },
      {
        key: "sections/new.liquid",
        value: "<div>Brand new</div>",
      },
      {
        key: "sections/error.liquid",
        value: "<div>Will fail in mutation</div>",
      },
    ],
  });

  assert.equal(upsertResult.summary.total, 3);
  assert.equal(upsertResult.summary.applied, 1);
  assert.equal(upsertResult.summary.failed, 1);
  assert.equal(upsertResult.summary.failedPrecondition, 1);

  const preconditionFailure = upsertResult.results.find((entry) => entry.key === "sections/existing.liquid");
  assert.equal(preconditionFailure.status, "failed_precondition");

  const writeFailure = upsertResult.results.find((entry) => entry.key === "sections/error.liquid");
  assert.equal(writeFailure.status, "failed");

  const applied = upsertResult.results.find((entry) => entry.key === "sections/new.liquid");
  assert.equal(applied.status, "applied");
  assert.equal(applied.verify?.status, "match", "verifyAfterWrite should attach per-file verification");

  const persistedNewFile = fileStore.get("sections/new.liquid");
  assert.equal(persistedNewFile.value, "<div>Brand new</div>");

  console.log("themeFilesBatch.test.mjs passed");
} finally {
  global.fetch = originalFetch;
  await themeDraftDb.cleanup();
}
