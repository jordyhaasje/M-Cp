import assert from "assert";
import { readThemeFiles } from "../dist/tools/readThemeFiles.js";
import { validateThemeSection } from "../dist/tools/validateThemeSection.js";
import { upsertThemeSection } from "../dist/tools/upsertThemeSection.js";
import { injectSectionIntoTemplate } from "../dist/tools/injectSectionIntoTemplate.js";
import { upsertThemeSectionPack } from "../dist/tools/upsertThemeSectionPack.js";
import {
  MAX_THEME_FILE_BYTES,
  assertAllowedSectionLibraryAssetPath,
  assertAllowedThemeFilePath,
  buildScopedSnippetFilename,
  buildSectionLibraryStylesFilename,
} from "../dist/lib/themeSections.js";

const validSectionLiquid = `
{% schema %}
{
  "name": "Hero section",
  "settings": [],
  "presets": [{ "name": "Hero section" }]
}
{% endschema %}
<section class="hero">Hello world</section>
`;

const basicTemplate = {
  sections: {
    main: {
      type: "main-product",
      settings: {},
    },
  },
  order: ["main"],
};

const validationResult = await validateThemeSection.execute({
  sectionHandle: "hero-banner",
  liquid: validSectionLiquid,
  targetTemplate: "templates/product.json",
});
assert.equal(validationResult.valid, true, "valid section should pass preflight validation");
assert.equal(validationResult.sectionFilename, "sections/hero-banner.liquid");

const missingSchemaResult = await validateThemeSection.execute({
  sectionHandle: "hero-banner",
  liquid: "<section>No schema</section>",
});
assert.equal(missingSchemaResult.valid, false, "missing schema should fail validation");
assert.ok(
  missingSchemaResult.errors.some((message) => message.includes("{% schema %}")),
  "validation should explain missing schema"
);

const tooLargeResult = await validateThemeSection.execute({
  sectionHandle: "hero-banner",
  liquid: "x".repeat(MAX_THEME_FILE_BYTES + 1),
});
assert.equal(tooLargeResult.valid, false, "oversized section should fail validation");
assert.ok(
  tooLargeResult.errors.some((message) => message.includes("exceeds")),
  "oversized validation error should be explicit"
);

assert.throws(
  () => assertAllowedThemeFilePath("../templates/index.json", { allowTemplateJson: true }),
  /Invalid theme filename/
);
assert.equal(
  buildSectionLibraryStylesFilename("hero-banner"),
  "assets/sections-library/hero-banner/styles.css"
);
assert.equal(
  assertAllowedSectionLibraryAssetPath("hero-banner", "icons/check.svg"),
  "assets/sections-library/hero-banner/icons/check.svg"
);
assert.equal(
  buildScopedSnippetFilename("hero-banner", "cta-button"),
  "snippets/hero-banner--cta-button.liquid"
);

const readThemeCalls = [];
readThemeFiles.initialize({
  request: async (query, variables) => {
    const queryText = String(query);
    readThemeCalls.push({ queryText, variables });
    return {
      shop: { myshopifyDomain: "demo-shop.myshopify.com" },
      theme: {
        id: "gid://shopify/OnlineStoreTheme/1",
        name: "Draft",
        role: "UNPUBLISHED",
        files: {
          edges: [
            {
              node: {
                filename: "sections/hero-banner.liquid",
                size: 123,
                contentType: "application/x-liquid",
                checksumMd5: "abc",
                updatedAt: "2026-03-07T10:00:00Z",
                body: { content: "<section>Hero</section>" },
              },
            },
            {
              node: {
                filename: "templates/product.json",
                size: 456,
                contentType: "application/json",
                checksumMd5: "def",
                updatedAt: "2026-03-07T10:00:00Z",
                body: { contentBase64: Buffer.from(JSON.stringify(basicTemplate)).toString("base64") },
              },
            },
          ],
          userErrors: [],
        },
      },
    };
  },
});

const readThemeResult = await readThemeFiles.execute({
  shopDomain: "demo-shop.myshopify.com",
  themeId: "gid://shopify/OnlineStoreTheme/1",
  filenames: ["sections/hero-banner.liquid", "templates/product.json"],
});
assert.equal(readThemeResult.files.length, 2, "read-theme-files should return requested files");
assert.equal(readThemeResult.files[1].body.type, "BASE64");
assert.ok(readThemeCalls[0].queryText.includes("query ReadThemeFiles"));

const upsertCalls = [];
upsertThemeSection.initialize({
  request: async (query, variables) => {
    const queryText = String(query);
    upsertCalls.push({ queryText, variables });
    if (queryText.includes("query ReadThemeMeta")) {
      return {
        shop: { myshopifyDomain: "demo-shop.myshopify.com" },
        theme: {
          id: "gid://shopify/OnlineStoreTheme/99",
          name: "Live",
          role: "MAIN",
        },
      };
    }
    if (queryText.includes("mutation ThemeFilesUpsert")) {
      return {
        themeFilesUpsert: {
          upsertedThemeFiles: [{ filename: variables.files[0].filename }],
          job: { id: "gid://shopify/Job/1", done: true },
          userErrors: [],
        },
      };
    }
    throw new Error(`Unexpected upsert request: ${queryText.slice(0, 100)}`);
  },
});

await assert.rejects(
  () =>
    upsertThemeSection.execute({
      shopDomain: "demo-shop.myshopify.com",
      themeId: "gid://shopify/OnlineStoreTheme/99",
      sectionHandle: "hero-banner",
      liquid: validSectionLiquid,
    }),
  /live/i,
  "live theme writes should require explicit confirmation"
);

const upsertResult = await upsertThemeSection.execute({
  shopDomain: "demo-shop.myshopify.com",
  themeId: "gid://shopify/OnlineStoreTheme/99",
  sectionHandle: "hero-banner",
  liquid: validSectionLiquid,
  liveWrite: true,
  confirm_live_write: true,
  confirmation_reason: "Merchant approved production update",
  change_summary: "Add homepage hero section",
});
assert.equal(upsertResult.file.filename, "sections/hero-banner.liquid");
const upsertMutation = upsertCalls.find((entry) => entry.queryText.includes("mutation ThemeFilesUpsert"));
assert.equal(upsertMutation?.variables?.files?.[0]?.filename, "sections/hero-banner.liquid");

const collisionTemplate = {
  sections: {
    "hero-banner": { type: "hero-banner", settings: {} },
    main: { type: "main-product", settings: {} },
  },
  order: ["hero-banner", "main"],
};

injectSectionIntoTemplate.initialize({
  request: async (query, variables) => {
    const queryText = String(query);
    if (queryText.includes("query ReadTemplateFile")) {
      return {
        shop: { myshopifyDomain: "demo-shop.myshopify.com" },
        theme: {
          id: "gid://shopify/OnlineStoreTheme/99",
          name: "Draft",
          role: "UNPUBLISHED",
          files: {
            edges: [
              {
                node: {
                  filename: "templates/product.json",
                  size: 500,
                  contentType: "application/json",
                  checksumMd5: "xyz",
                  updatedAt: "2026-03-07T10:00:00Z",
                  body: { content: JSON.stringify(collisionTemplate) },
                },
              },
            ],
            userErrors: [],
          },
        },
      };
    }
    if (queryText.includes("mutation ThemeFilesUpsert")) {
      return {
        themeFilesUpsert: {
          upsertedThemeFiles: [{ filename: variables.files[0].filename }],
          job: { id: "gid://shopify/Job/2", done: true },
          userErrors: [],
        },
      };
    }
    throw new Error(`Unexpected inject request: ${queryText.slice(0, 100)}`);
  },
});

await assert.rejects(
  () =>
    injectSectionIntoTemplate.execute({
      shopDomain: "demo-shop.myshopify.com",
      themeId: "gid://shopify/OnlineStoreTheme/99",
      templatePath: "templates/product.json",
      sectionHandle: "hero-banner",
      position: "end",
    }),
  /already contains section id/,
  "inject should block duplicate section ids"
);

let capturedTemplateWrite = null;
injectSectionIntoTemplate.initialize({
  request: async (query, variables) => {
    const queryText = String(query);
    if (queryText.includes("query ReadTemplateFile")) {
      return {
        shop: { myshopifyDomain: "demo-shop.myshopify.com" },
        theme: {
          id: "gid://shopify/OnlineStoreTheme/99",
          name: "Draft",
          role: "UNPUBLISHED",
          files: {
            edges: [
              {
                node: {
                  filename: "templates/product.json",
                  size: 500,
                  contentType: "application/json",
                  checksumMd5: "xyz",
                  updatedAt: "2026-03-07T10:00:00Z",
                  body: { content: JSON.stringify(basicTemplate) },
                },
              },
            ],
            userErrors: [],
          },
        },
      };
    }
    if (queryText.includes("mutation ThemeFilesUpsert")) {
      capturedTemplateWrite = JSON.parse(variables.files[0].body.value);
      return {
        themeFilesUpsert: {
          upsertedThemeFiles: [{ filename: variables.files[0].filename }],
          job: { id: "gid://shopify/Job/3", done: true },
          userErrors: [],
        },
      };
    }
    throw new Error(`Unexpected inject request: ${queryText.slice(0, 100)}`);
  },
});

const injectResult = await injectSectionIntoTemplate.execute({
  shopDomain: "demo-shop.myshopify.com",
  themeId: "gid://shopify/OnlineStoreTheme/99",
  templatePath: "templates/product.json",
  sectionHandle: "hero-banner",
  position: "before",
  referenceSectionId: "main",
});

assert.equal(injectResult.injectedSection.sectionId, "hero-banner");
assert.ok(capturedTemplateWrite?.sections?.["hero-banner"], "template write should include injected section");
assert.deepEqual(capturedTemplateWrite?.order, ["hero-banner", "main"]);

const packCalls = [];
upsertThemeSectionPack.initialize({
  request: async (query, variables) => {
    const queryText = String(query);
    packCalls.push({ queryText, variables });
    if (queryText.includes("query ReadThemeFilesForSectionPack")) {
      return {
        shop: { myshopifyDomain: "demo-shop.myshopify.com" },
        theme: {
          id: "gid://shopify/OnlineStoreTheme/99",
          name: "Draft",
          role: "UNPUBLISHED",
          files: {
            edges: [
              {
                node: {
                  filename: "templates/product.json",
                  size: 500,
                  contentType: "application/json",
                  checksumMd5: "xyz",
                  updatedAt: "2026-03-07T10:00:00Z",
                  body: { content: JSON.stringify(basicTemplate) },
                },
              },
              {
                node: {
                  filename: "sections/hero-banner.liquid",
                  size: 100,
                  contentType: "application/x-liquid",
                  checksumMd5: "existing",
                  updatedAt: "2026-03-07T10:00:00Z",
                  body: { content: validSectionLiquid },
                },
              },
            ],
            userErrors: [],
          },
        },
      };
    }
    if (queryText.includes("mutation ThemeFilesUpsertSectionPack")) {
      return {
        themeFilesUpsert: {
          upsertedThemeFiles: variables.files.map((file) => ({ filename: file.filename })),
          job: { id: "gid://shopify/Job/4", done: true },
          userErrors: [],
        },
      };
    }
    throw new Error(`Unexpected section-pack request: ${queryText.slice(0, 120)}`);
  },
});

await assert.rejects(
  () =>
    upsertThemeSectionPack.execute({
      shopDomain: "demo-shop.myshopify.com",
      themeId: "gid://shopify/OnlineStoreTheme/99",
      sectionId: "hero-banner",
      sectionLiquid: validSectionLiquid,
      stylesCss: ".hero{padding:12px;}",
      installMode: true,
    }),
  /Preflight conflict detected/,
  "section pack should block overwriting merchant files without explicit consent"
);

const packResult = await upsertThemeSectionPack.execute({
  shopDomain: "demo-shop.myshopify.com",
  themeId: "gid://shopify/OnlineStoreTheme/99",
  sectionId: "hero-banner",
  sectionLiquid: validSectionLiquid,
  stylesCss: ".hero{padding:12px;}",
  snippets: [{ name: "cta-button", liquid: "<button>Koop nu</button>" }],
  assets: [{ relativePath: "icons/check.svg", content: "<svg></svg>", contentType: "TEXT" }],
  targetTemplate: "templates/product.json",
  position: "before",
  referenceSectionId: "main",
  installMode: true,
  confirm_overwrite_existing: true,
  overwrite_reason: "Agent update met merchant toestemming",
});

assert.equal(packResult.sectionPack.id, "hero-banner");
assert.equal(packResult.sectionPack.overwrittenExisting, true);
assert.ok(
  packResult.sectionPack.paths.some((entry) => entry.themeFilename === "assets/sections-library/hero-banner/styles.css"),
  "section pack should write required styles.css"
);
const packMutation = packCalls.find((entry) => entry.queryText.includes("mutation ThemeFilesUpsertSectionPack"));
assert.ok(packMutation, "section pack should execute themeFilesUpsert mutation");
assert.ok(
  packMutation.variables.files.some((file) => file.filename === "snippets/hero-banner--cta-button.liquid"),
  "section pack should include scoped snippet file"
);

console.log("themeTools.test.mjs passed");
