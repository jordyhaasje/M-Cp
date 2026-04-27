import test from "node:test";
import assert from "node:assert";
import crypto from "node:crypto";
import { applyThemeDraft } from "../src/tools/applyThemeDraft.js";
import { draftThemeArtifact } from "../src/tools/draftThemeArtifact.js";
import { getThemeFilesTool } from "../src/tools/getThemeFiles.js";
import { createThemeDraftRecord } from "../src/lib/db.js";
import {
  clearThemeEditMemory,
  rememberThemePlan,
} from "../src/lib/themeEditMemory.js";
import { createThemeDraftDbHarness } from "./helpers/themeDraftDbHarness.mjs";

process.env.NODE_ENV = "test";

const execute = draftThemeArtifact.execute;
const themeDraftDb = createThemeDraftDbHarness();

test.after(async () => {
  await themeDraftDb.cleanup();
});

test.afterEach(() => {
  clearThemeEditMemory();
});
const goodSectionLiquid = `
<style>
  #shopify-section-{{ section.id }} .card {
    display: grid;
    padding: 24px;
    border-radius: 18px;
  }

  @media screen and (max-width: 749px) {
    #shopify-section-{{ section.id }} .card {
      padding: 16px;
    }
  }
</style>

<div class="card">{{ section.settings.heading }}</div>

{% schema %}
{
  "name": "Test section",
  "settings": [
    { "type": "text", "id": "heading", "label": "Heading", "default": "Hello" },
    { "type": "range", "id": "gap", "label": "Gap", "min": 0, "max": 40, "step": 4, "default": 16 },
    { "type": "color", "id": "accent", "label": "Accent", "default": "#111111" }
  ],
  "presets": [{ "name": "Test section" }]
}
{% endschema %}
`;

const goodSectionLiquidTrimmedSchema = `
<style>
  #shopify-section-{{ section.id }} .card {
    display: grid;
    padding: 24px;
    border-radius: 18px;
  }

  @media screen and (max-width: 749px) {
    #shopify-section-{{ section.id }} .card {
      padding: 16px;
    }
  }
</style>

<div class="card">{{ section.settings.heading }}</div>

{%- schema -%}
{
  "name": "Trimmed schema section",
  "settings": [
    { "type": "text", "id": "heading", "label": "Heading", "default": "Hello" },
    { "type": "range", "id": "gap", "label": "Gap", "min": 0, "max": 40, "step": 4, "default": 16 },
    { "type": "color", "id": "accent", "label": "Accent", "default": "#111111" }
  ],
  "presets": [{ "name": "Trimmed schema section" }]
}
{%- endschema -%}
`;

function checksumMd5Base64(value) {
  return crypto.createHash("md5").update(Buffer.from(value, "utf8")).digest("base64");
}

function jsonGraphqlResponse(payload) {
  return {
    ok: true,
    status: 200,
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  };
}

function createThemeFileFetchMock({
  key = "sections/main-product.liquid",
  initialValue,
  themeIdFallback = 111,
  existing = true,
  verifyValueOverride,
}) {
  let storedValue = initialValue;
  let storedExists = Boolean(existing);

  return {
    getValue: () => storedValue,
    handler: async (_url, options = {}) => {
      const stringUrl = String(_url || "");
      const restThemeMatch = stringUrl.match(/\/themes\/(\d+)\.json$/);
      if (restThemeMatch) {
        const numericThemeId = Number(restThemeMatch[1] || themeIdFallback);
        const restPayload = {
          theme: {
            id: numericThemeId,
            name: "Dev Theme",
            role: "development",
          },
        };
        return jsonGraphqlResponse(restPayload);
      }

      const payload = options.body ? JSON.parse(String(options.body)) : {};
      const query = String(payload.query || "");
      const themeId = String(payload.variables?.themeId || "");
      const numericThemeId = Number(themeId.match(/\/(\d+)$/)?.[1] || themeIdFallback);
      const theme = {
        id: `gid://shopify/OnlineStoreTheme/${numericThemeId}`,
        name: "Dev Theme",
        role: "DEVELOPMENT",
        processing: false,
        createdAt: "2026-04-02T00:00:00Z",
        updatedAt: "2026-04-02T00:00:00Z",
      };

      const fileNode = (includeContent) => {
        const value = !includeContent && verifyValueOverride !== undefined
          ? verifyValueOverride
          : storedValue;
        return {
          filename: key,
          checksumMd5: checksumMd5Base64(value),
          contentType: "application/x-liquid",
          createdAt: "2026-04-02T00:00:00Z",
          updatedAt: "2026-04-02T00:00:00Z",
          size: Buffer.byteLength(value, "utf8"),
          ...(includeContent ? { body: { content: storedValue } } : {}),
        };
      };

      if (query.includes("ThemeById")) {
        return jsonGraphqlResponse({ data: { theme } });
      }

      if (query.includes("ThemeFilesByIdWithContent") || query.includes("ThemeFileById")) {
        return jsonGraphqlResponse({
          data: {
            theme: {
              ...theme,
              files: {
                nodes: storedExists ? [fileNode(true)] : [],
                userErrors: [],
              },
            },
          },
        });
      }

      if (query.includes("ThemeFilesByIdMetadata")) {
        return jsonGraphqlResponse({
          data: {
            theme: {
              ...theme,
              files: {
                nodes: storedExists ? [fileNode(false)] : [],
                userErrors: [],
              },
            },
          },
        });
      }

      if (query.includes("ThemeFilesUpsert")) {
        storedValue = payload.variables.files[0].body.value;
        storedExists = true;
        return jsonGraphqlResponse({
          data: {
            themeFilesUpsert: {
              upsertedThemeFiles: [{ filename: key }],
              job: { id: "gid://shopify/Job/1" },
              userErrors: [],
            },
          },
        });
      }

      throw new Error(`Unexpected GraphQL query in theme fetch mock: ${query}`);
    },
  };
}

function createThemeFilesFetchMock({
  files = {},
  themeIdFallback = 111,
} = {}) {
  const storedFiles = new Map(
    Object.entries(files).map(([key, value]) => [key, value])
  );

  const buildNodes = (filenames, includeContent) =>
    filenames
      .filter((filename) => storedFiles.has(filename))
      .map((filename) => {
        const value = storedFiles.get(filename);
        return {
          filename,
          checksumMd5: checksumMd5Base64(value),
          contentType: "application/x-liquid",
          createdAt: "2026-04-02T00:00:00Z",
          updatedAt: "2026-04-02T00:00:00Z",
          size: Buffer.byteLength(value, "utf8"),
          ...(includeContent ? { body: { content: value } } : {}),
        };
      });

  return async (_url, options = {}) => {
    const stringUrl = String(_url || "");
    const restThemeMatch = stringUrl.match(/\/themes\/(\d+)\.json$/);
    if (restThemeMatch) {
      const numericThemeId = Number(restThemeMatch[1] || themeIdFallback);
      return jsonGraphqlResponse({
        theme: {
          id: numericThemeId,
          name: "Dev Theme",
          role: "development",
        },
      });
    }

    const payload = options.body ? JSON.parse(String(options.body)) : {};
    const query = String(payload.query || "");
    const themeId = String(payload.variables?.themeId || "");
    const numericThemeId = Number(themeId.match(/\/(\d+)$/)?.[1] || themeIdFallback);
    const theme = {
      id: `gid://shopify/OnlineStoreTheme/${numericThemeId}`,
      name: "Dev Theme",
      role: "DEVELOPMENT",
      processing: false,
      createdAt: "2026-04-02T00:00:00Z",
      updatedAt: "2026-04-02T00:00:00Z",
    };
    const filenames = Array.isArray(payload.variables?.filenames)
      ? payload.variables.filenames
      : [];

    if (query.includes("ThemeById")) {
      return jsonGraphqlResponse({ data: { theme } });
    }

    if (query.includes("ThemeFilesByIdWithContent") || query.includes("ThemeFileById")) {
      return jsonGraphqlResponse({
        data: {
          theme: {
            ...theme,
            files: {
              nodes: buildNodes(filenames, true),
              userErrors: [],
            },
          },
        },
      });
    }

    if (query.includes("ThemeFilesByIdMetadata")) {
      return jsonGraphqlResponse({
        data: {
          theme: {
            ...theme,
            files: {
              nodes: buildNodes(filenames, false),
              userErrors: [],
            },
          },
        },
      });
    }

    if (query.includes("ThemeFilesUpsert")) {
      const upsertedFiles = Array.isArray(payload.variables?.files)
        ? payload.variables.files
        : [];
      for (const file of upsertedFiles) {
        storedFiles.set(file.filename, file.body?.value || "");
      }
      return jsonGraphqlResponse({
        data: {
          themeFilesUpsert: {
            upsertedThemeFiles: upsertedFiles.map((file) => ({
              filename: file.filename,
            })),
            job: { id: "gid://shopify/Job/1" },
            userErrors: [],
          },
        },
      });
    }

    throw new Error(`Unexpected GraphQL query in theme files fetch mock: ${query}`);
  };
}

const demoCdnImageUrl =
  "https://cdn.shopify.com/s/files/1/0000/0001/files/reference-hero-1.jpg?v=1";

function buildExactMediaFirstHeroBlueprint(overrides = {}) {
  const referenceSignals = {
    exactReplicaRequested: true,
    previewMediaPolicy: "best_effort_demo_media",
    hasScreenshotLikeReference: true,
    hasDesktopMobileReferences: true,
    hasExplicitMediaSources: false,
    heroShellFamily: "media_first_unboxed",
    prefersRenderablePreviewMedia: true,
    requiresRenderablePreviewMedia: false,
    allowStylizedPreviewFallbacks: true,
    requiresResponsiveViewportParity: true,
    requiresDecorativeMediaAnchors: false,
    requiresDecorativeBadgeAnchors: false,
    requiresRatingStars: false,
    requiresComparisonIconography: false,
    requiresTitleAccent: false,
    requiresNavButtons: false,
    requiresThemeEditorLifecycleHooks: false,
    requiresThemeWrapperMirror: false,
    requiresOverlayTreatment: true,
  };

  return {
    qualityTarget: "exact_match",
    archetype: "hero_full_bleed_media",
    layoutContract: {
      outerShell: "full_bleed",
      contentWidthStrategy: "inner_content_wrapper",
      mediaPlacement: "background_layer",
      contentPlacement: "overlay_layer",
      overlayRequired: true,
      fallbackMediaStrategy: "shared_primary_slot",
      sharedMediaSlotRequired: true,
      requiresBackgroundMediaArchitecture: true,
      avoidOuterContainer: true,
      avoidSplitLayoutAssumption: true,
      allowOuterContainer: false,
      outerShellOwnsMediaBounds: true,
      allowInnerContentWidthMirror: true,
      forbidOuterThemeWrapperMirror: true,
    },
    themeWrapperStrategy: {
      mirrorThemeSpacingSettings: true,
      mirrorThemeHelpers: true,
      usesPageWidth: true,
      usesSectionPropertiesWrapper: false,
      preferredContentWidthLayer: "inner_content",
      preferredHelperPlacement: "inner_content_or_spacing_layer",
      allowOuterThemeContainer: false,
      allowInnerContentWidthMirror: true,
      forbidOuterThemeWrapperMirror: true,
    },
    referenceSignals: {
      ...referenceSignals,
      ...(overrides.referenceSignals || {}),
    },
    ...(overrides.layoutContract ? { layoutContract: overrides.layoutContract } : {}),
    ...(overrides.themeWrapperStrategy
      ? { themeWrapperStrategy: overrides.themeWrapperStrategy }
      : {}),
    ...Object.fromEntries(
      Object.entries(overrides).filter(
        ([key]) => !["referenceSignals", "layoutContract", "themeWrapperStrategy"].includes(key)
      )
    ),
  };
}

test("draftThemeArtifact - rejects context placeholders for existing full rewrites with explicit repair hints", async () => {
  const mockShopifyClient = {
    url: "https://unit-test.myshopify.com/admin/api/2026-01/graphql.json",
    requestConfig: {
      headers: new Headers({ "x-shopify-access-token": "fake-token" })
    },
    session: { shop: "unit-test.myshopify.com" },
    request: async () => {}
  };

  const themeMock = createThemeFileFetchMock({
    key: "sections/bon-hero.liquid",
    initialValue: goodSectionLiquid,
  });
  const previousFetch = global.fetch;
  global.fetch = themeMock.handler;

  try {
    const plannerHandoff = {
      brief: "Maak de bestaande bon-hero section compacter en behoud dezelfde compositie.",
      intent: "existing_edit",
      targetFile: "sections/bon-hero.liquid",
      themeTarget: { themeId: 111, themeRole: null },
    };
    const result = await execute(
      draftThemeArtifact.schema.parse({
        mode: "edit",
        themeId: 111,
        plannerHandoff,
        files: [
          {
            key: "sections/bon-hero.liquid",
            value: "REWRITE_ALREADY_APPLIED_IN_CONTEXT",
          },
        ],
      }),
      { shopifyClient: mockShopifyClient }
    );

    assert.equal(result.success, false);
    assert.equal(result.status, "inspection_failed");
    assert.equal(result.errorCode, "inspection_failed_context_placeholder");
    assert.equal(
      result.nextArgsTemplate?.files?.[0]?.value,
      "<full rewritten current file content after deterministic preserve-on-edit transformation>"
    );
    assert.equal(
      result.alternativeNextArgsTemplates?.patchExisting?.files?.[0]?.patch?.searchString,
      "<exact literal anchor from the current file>"
    );
    assert.equal(result.plannerHandoff?.targetFile, "sections/bon-hero.liquid");
    assert.ok(
      result.suggestedFixes?.some((entry) =>
        entry.includes("create-theme-section niet opnieuw")
      ),
      "the placeholder failure should steer the client away from create-theme-section for existing files"
    );
  } finally {
    global.fetch = previousFetch;
  }
});

test("draftThemeArtifact - keeps generic truncation guard for short real rewrites", async () => {
  const mockShopifyClient = {
    url: "https://unit-test.myshopify.com/admin/api/2026-01/graphql.json",
    requestConfig: {
      headers: new Headers({ "x-shopify-access-token": "fake-token" })
    },
    session: { shop: "unit-test.myshopify.com" },
    request: async () => {}
  };

  const themeMock = createThemeFileFetchMock({
    key: "sections/bon-hero.liquid",
    initialValue: goodSectionLiquid,
  });
  const previousFetch = global.fetch;
  global.fetch = themeMock.handler;

  try {
    const result = await execute(
      draftThemeArtifact.schema.parse({
        mode: "edit",
        themeId: 111,
        files: [
          {
            key: "sections/bon-hero.liquid",
            value: "<div>Te kort</div>",
          },
        ],
      }),
      { shopifyClient: mockShopifyClient }
    );

    assert.equal(result.success, false);
    assert.equal(result.status, "inspection_failed");
    assert.equal(result.errorCode, "inspection_failed_truncated");
    assert.equal(result.nextArgsTemplate?.mode, "edit");
    assert.equal(
      result.alternativeNextArgsTemplates?.patchExisting?.files?.[0]?.patch?.replaceString,
      "<updated markup/liquid>"
    );
  } finally {
    global.fetch = previousFetch;
  }
});

test("draftThemeArtifact - rejects lossy preserve-on-edit full rewrites before preview upload", async () => {
  const mockShopifyClient = {
    url: "https://unit-test.myshopify.com/admin/api/2026-01/graphql.json",
    requestConfig: {
      headers: new Headers({ "x-shopify-access-token": "fake-token" })
    },
    session: { shop: "unit-test.myshopify.com" },
    request: async () => {}
  };

  const originalSection = `
{% render 'section-spacing-collapsing' %}
<style>
  #shopify-section-{{ section.id }} .reviews { display: grid; gap: 24px; padding-block: {{ section.settings.padding_top }}px {{ section.settings.padding_bottom }}px; color: {{ section.settings.text_color }}; }
  #shopify-section-{{ section.id }} .reviews__track { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 18px; }
  #shopify-section-{{ section.id }} .reviews__card { border-radius: 18px; padding: 22px; background: #fff; }
  #shopify-section-{{ section.id }} .reviews__stars { color: {{ section.settings.star_color }}; }
  #shopify-section-{{ section.id }} .reviews__avatar { width: 44px; height: 44px; border-radius: 999px; overflow: hidden; }
  #shopify-section-{{ section.id }} .reviews__spacer { min-height: 16px; }
  @media screen and (max-width: 749px) {
    #shopify-section-{{ section.id }} .reviews__track { grid-template-columns: 1fr; }
  }
</style>
<section class="reviews">
  <div {% render 'section-properties', tight: true %}>
    <div class="reviews__track">
      {% for block in section.blocks %}
        <article class="reviews__card" {{ block.shopify_attributes }}>
          <div class="reviews__stars" aria-label="{{ section.settings.rating }} star rating">★★★★★</div>
          {% if block.settings.avatar != blank %}
            {{ block.settings.avatar | image_url: width: 88 | image_tag: alt: block.settings.initials }}
          {% else %}
            <span class="reviews__avatar">{{ block.settings.initials }}</span>
          {% endif %}
          <p>{{ block.settings.quote }}</p>
        </article>
      {% endfor %}
    </div>
  </div>
</section>
{% schema %}
{
  "name": "Review cards",
  "settings": [
    { "type": "range", "id": "rating", "label": "Rating", "min": 1, "max": 5, "step": 1, "default": 5 },
    { "type": "text", "id": "review_count", "label": "Review count", "default": "1,200+" },
    { "type": "range", "id": "margin_top", "label": "Margin top", "min": 0, "max": 80, "step": 4, "default": 24 },
    { "type": "range", "id": "margin_bottom", "label": "Margin bottom", "min": 0, "max": 80, "step": 4, "default": 24 },
    { "type": "range", "id": "padding_top", "label": "Padding top", "min": 0, "max": 80, "step": 4, "default": 36 },
    { "type": "range", "id": "padding_bottom", "label": "Padding bottom", "min": 0, "max": 80, "step": 4, "default": 36 },
    { "type": "color", "id": "star_color", "label": "Star color", "default": "#00b67a" },
    { "type": "color", "id": "empty_star_color", "label": "Empty star color", "default": "#d8d8d8" },
    { "type": "color", "id": "text_color", "label": "Text color", "default": "#111111" }
  ],
  "blocks": [
    {
      "type": "review",
      "name": "Review",
      "settings": [
        { "type": "image_picker", "id": "avatar", "label": "Avatar" },
        { "type": "text", "id": "initials", "label": "Initials", "default": "JD" },
        { "type": "textarea", "id": "quote", "label": "Quote", "default": "Great service." }
      ]
    }
  ],
  "presets": [{ "name": "Review cards", "blocks": [{ "type": "review" }] }]
}
{% endschema %}
`;

  const lossyRewrite = `
{% render 'section-spacing-collapsing' %}
<style>
  #shopify-section-{{ section.id }} .reviews { display: grid; gap: 20px; padding-block: {{ section.settings.padding_top }}px {{ section.settings.padding_bottom }}px; color: {{ section.settings.text_color }}; }
  #shopify-section-{{ section.id }} .reviews__track { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
  #shopify-section-{{ section.id }} .reviews__card { display: grid; gap: 12px; padding: 20px; border-radius: 18px; background: #fff; }
  #shopify-section-{{ section.id }} .reviews__summary { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
  #shopify-section-{{ section.id }} .reviews__eyebrow { font-size: 0.875rem; text-transform: uppercase; letter-spacing: 0.08em; }
  #shopify-section-{{ section.id }} .reviews__quote { margin: 0; line-height: 1.55; }
  @media screen and (max-width: 749px) {
    #shopify-section-{{ section.id }} .reviews__track { grid-template-columns: 1fr; }
    #shopify-section-{{ section.id }} .reviews__summary { align-items: flex-start; flex-direction: column; }
  }
</style>
<section class="reviews">
  <div {% render 'section-properties', tight: true %}>
    <div class="reviews__summary">
      <p class="reviews__eyebrow">Verified reviews</p>
      <p>Trusted by customers</p>
    </div>
    <div class="reviews__track">
      {% for block in section.blocks %}
        <article class="reviews__card" {{ block.shopify_attributes }}>
          <p class="reviews__quote">{{ block.settings.quote }}</p>
        </article>
      {% endfor %}
    </div>
  </div>
</section>
{% schema %}
{
  "name": "Review cards",
  "settings": [
    { "type": "range", "id": "padding_top", "label": "Padding top", "min": 0, "max": 80, "step": 4, "default": 36 },
    { "type": "range", "id": "padding_bottom", "label": "Padding bottom", "min": 0, "max": 80, "step": 4, "default": 36 },
    { "type": "color", "id": "text_color", "label": "Text color", "default": "#111111" }
  ],
  "blocks": [
    {
      "type": "review",
      "name": "Review",
      "settings": [
        { "type": "textarea", "id": "quote", "label": "Quote", "default": "Great service." }
      ]
    }
  ],
  "presets": [{ "name": "Review cards", "blocks": [{ "type": "review" }] }]
}
{% endschema %}
`;

  assert.ok(
    Buffer.byteLength(lossyRewrite, "utf8") >
      Buffer.byteLength(originalSection, "utf8") * 0.5,
    "fixture should exercise the lossy guard, not the generic truncation guard"
  );
  assert.ok(
    Buffer.byteLength(lossyRewrite, "utf8") <
      Buffer.byteLength(originalSection, "utf8") * 0.75,
    "fixture should be small enough to look lossy"
  );

  const themeMock = createThemeFileFetchMock({
    key: "sections/review-cards.liquid",
    initialValue: originalSection,
  });
  const previousFetch = global.fetch;
  global.fetch = themeMock.handler;

  try {
    const result = await execute(
      draftThemeArtifact.schema.parse({
        mode: "edit",
        themeId: 111,
        files: [
          {
            key: "sections/review-cards.liquid",
            value: lossyRewrite,
          },
        ],
      }),
      { shopifyClient: mockShopifyClient }
    );

    assert.equal(result.success, false);
    assert.equal(result.status, "inspection_failed");
    assert.equal(result.errorCode, "inspection_failed_lossy_rewrite");
    assert.equal(result.nextTool, "get-theme-file");
    assert.equal(result.nextArgsTemplate?.includeContent, true);
    assert.equal(result.writeApplied, false);
    assert.equal(result.liveFileUnchanged, true);
    assert.ok(
      result.errors?.some((issue) =>
        String(issue.problem || "").includes("margin_top")
      ),
      "schema setting loss should be reported"
    );
    assert.equal(themeMock.getValue(), originalSection);
  } finally {
    global.fetch = previousFetch;
  }
});

test("draftThemeArtifact - a truncated rewrite does not poison a later CSS patch on the same existing section", async () => {
  const mockShopifyClient = {
    url: "https://unit-test.myshopify.com/admin/api/2026-01/graphql.json",
    requestConfig: {
      headers: new Headers({ "x-shopify-access-token": "fake-token" })
    },
    session: { shop: "unit-test.myshopify.com" },
    request: async () => {}
  };

  const animatedHeroSection = `
<style>
  .hero-v1__rating-wrap { justify-content: center; }
  @keyframes heroRatingPulse{0%{transform:translateY(0)}50%{transform:translateY(-4px)}100%{transform:translateY(0)}}
  .hero-v1__rating-card { animation: heroRatingPulse 2.4s ease-in-out infinite; }
</style>

<div class="hero-v1__content">
  <div class="hero-v1__rating-wrap">
    <span class="hero-v1__rating-card">{{ section.settings.rating_text }}</span>
  </div>
  <h2>{{ section.settings.heading }}</h2>
</div>

{% schema %}
{
  "name": "Hero V1",
  "settings": [
    { "type": "text", "id": "heading", "label": "Heading", "default": "Hero" },
    { "type": "text", "id": "rating_text", "label": "Rating text", "default": "4.9/5" }
  ],
  "presets": [{ "name": "Hero V1" }]
}
{% endschema %}
`;

  const themeMock = createThemeFileFetchMock({
    key: "sections/hero-v1.liquid",
    initialValue: animatedHeroSection,
  });
  const previousFetch = global.fetch;
  global.fetch = themeMock.handler;

  try {
    const truncatedResult = await execute(
      draftThemeArtifact.schema.parse({
        mode: "edit",
        themeId: 111,
        files: [
          {
            key: "sections/hero-v1.liquid",
            value: "<div>Te kort</div>",
          },
        ],
      }),
      { shopifyClient: mockShopifyClient }
    );

    assert.equal(truncatedResult.success, false);
    assert.equal(truncatedResult.errorCode, "inspection_failed_truncated");

    const patchResult = await execute(
      draftThemeArtifact.schema.parse({
        mode: "edit",
        themeId: 111,
        files: [
          {
            key: "sections/hero-v1.liquid",
            patch: {
              searchString: ".hero-v1__rating-wrap { justify-content: center; }",
              replaceString:
                ".hero-v1__rating-wrap { justify-content: center; order: -1; margin-bottom: 12px; }",
            },
          },
        ],
      }),
      { shopifyClient: mockShopifyClient }
    );

    assert.equal(patchResult.success, true);
    assert.equal(patchResult.status, "preview_ready");
    assert.match(themeMock.getValue(), /order:\s*-1/);
    assert.match(themeMock.getValue(), /margin-bottom:\s*12px/);
  } finally {
    global.fetch = previousFetch;
  }
});

test("draftThemeArtifact - fails when linter finds issues", async (t) => {
  const mockShopifyClient = {
    url: "https://unit-test.myshopify.com/admin/api/2026-01/graphql.json",
    requestConfig: {
      headers: new Headers({ "x-shopify-access-token": "fake-token" })
    },
    session: { shop: "unit-test.myshopify.com" },
    request: async () => {}
  };

  const input = {
    mode: "create",
    themeId: 111,
    files: [
      {
        key: "sections/bad-file.liquid",
        value: goodSectionLiquid.replace("{{ section.settings.heading }}", "{{ section.settings.heading ")
      }
    ]
  };

  const result = await execute(draftThemeArtifact.schema.parse(input), { shopifyClient: mockShopifyClient });

  assert.strictEqual(result.success, false);
  assert.strictEqual(result.status, "inspection_failed");
  assert.strictEqual(result.errorCode, "inspection_failed_multiple");
  assert.ok(result.errors.length > 0, "Should return linter errors");
  assert.ok(
    result.errors.some((issue) => issue.issueCode === "inspection_failed_liquid_delimiter_balance"),
    "Should surface the local Liquid delimiter failure before theme-check upload"
  );
  assert.ok(
    result.errors.some((issue) => issue.issueCode === "lint_failed_liquid_syntax"),
    "Should keep the downstream theme-check syntax issue in the aggregated response"
  );
  assert.strictEqual(result.lintIssues?.[0]?.check, "LiquidHTMLSyntaxError");
  assert.ok(Number.isInteger(result.lintIssues?.[0]?.line));
});

test("draftThemeArtifact - rejects raw img tags without reliable dimensions before lint upload", async () => {
  const mockShopifyClient = {
    url: "https://unit-test.myshopify.com/admin/api/2026-01/graphql.json",
    requestConfig: {
      headers: new Headers({ "x-shopify-access-token": "fake-token" })
    },
    session: { shop: "unit-test.myshopify.com" },
    request: async () => {}
  };

  const result = await execute(
    draftThemeArtifact.schema.parse({
      mode: "create",
      themeId: 111,
      files: [
        {
          key: "sections/raw-img.liquid",
          value: `
<style>
  #shopify-section-{{ section.id }} .card { display: grid; padding: 24px; border-radius: 18px; }
  @media screen and (max-width: 749px) {
    #shopify-section-{{ section.id }} .card { padding: 16px; }
  }
</style>
<div class="card">
  <img src="{{ section.settings.image | image_url: width: 1200 }}" alt="{{ section.settings.heading }}">
</div>
{% schema %}
{
  "name": "Raw image demo",
  "settings": [
    { "type": "text", "id": "heading", "label": "Heading", "default": "Hello" },
    { "type": "image_picker", "id": "image", "label": "Image" },
    { "type": "range", "id": "gap", "label": "Gap", "min": 0, "max": 40, "step": 4, "default": 16 },
    { "type": "color", "id": "accent", "label": "Accent", "default": "#111111" }
  ],
  "presets": [{ "name": "Raw image demo" }]
}
{% endschema %}
`,
        },
      ],
    }),
    { shopifyClient: mockShopifyClient }
  );

  assert.equal(result.success, false);
  assert.equal(result.status, "inspection_failed");
  assert.equal(result.errorCode, "inspection_failed_multiple");
  assert.ok(
    result.errors?.some((issue) => issue.issueCode === "inspection_failed_media"),
    "raw img inspection issue should remain present"
  );
  assert.ok(
    result.lintIssues?.some((issue) => issue.issueCode === "lint_failed_img_dimensions"),
    "theme-check image dimension lint should be exposed in the same preflight response"
  );
  assert.ok(
    result.suggestedFixes.some((entry) => entry.includes("image_tag")),
    "media failures should steer the model toward Shopify image_tag rendering"
  );
});

test("draftThemeArtifact - rejects raw Shopify-media img tags even when width and height are present", async () => {
  const mockShopifyClient = {
    url: "https://unit-test.myshopify.com/admin/api/2026-01/graphql.json",
    requestConfig: {
      headers: new Headers({ "x-shopify-access-token": "fake-token" })
    },
    session: { shop: "unit-test.myshopify.com" },
    request: async () => {}
  };

  const result = await execute(
    draftThemeArtifact.schema.parse({
      mode: "create",
      themeId: 111,
      files: [
        {
          key: "sections/raw-shopify-img-dimensions.liquid",
          value: `
<style>
  #shopify-section-{{ section.id }} .card {
    display: grid;
    padding: 24px;
    border-radius: 18px;
  }

  @media screen and (max-width: 749px) {
    #shopify-section-{{ section.id }} .card {
      padding: 16px;
    }
  }
</style>
<div class="card">
  <img
    src="{{ section.settings.image | image_url: width: 1200 }}"
    width="1200"
    height="675"
    alt="{{ section.settings.heading }}"
  >
</div>
{% schema %}
{
  "name": "Raw Shopify image dimensions",
  "settings": [
    { "type": "text", "id": "heading", "label": "Heading", "default": "Hello" },
    { "type": "image_picker", "id": "image", "label": "Image" },
    { "type": "range", "id": "gap", "label": "Gap", "min": 0, "max": 40, "step": 4, "default": 16 },
    { "type": "color", "id": "accent", "label": "Accent", "default": "#111111" }
  ],
  "presets": [{ "name": "Raw Shopify image dimensions" }]
}
{% endschema %}
`,
        },
      ],
    }),
    { shopifyClient: mockShopifyClient }
  );

  assert.equal(result.success, false);
  assert.equal(result.status, "inspection_failed");
  assert.ok(
    result.errors?.some((issue) => issue.issueCode === "inspection_failed_shopify_raw_img")
  );
});

test("draftThemeArtifact - allows hardcoded demo CDN img fallbacks when dimensions are present", async () => {
  const mockShopifyClient = {
    url: "https://unit-test.myshopify.com/admin/api/2026-01/graphql.json",
    requestConfig: {
      headers: new Headers({ "x-shopify-access-token": "fake-token" })
    },
    session: { shop: "unit-test.myshopify.com" },
    request: async () => {}
  };

  const themeMock = createThemeFileFetchMock({
    key: "sections/demo-cdn-image.liquid",
    initialValue: "",
    existing: false,
  });
  const previousFetch = global.fetch;
  global.fetch = themeMock.handler;

  try {
    const result = await execute(
      draftThemeArtifact.schema.parse({
        mode: "create",
        themeId: 111,
        files: [
          {
            key: "sections/demo-cdn-image.liquid",
            value: `
<style>
  #shopify-section-{{ section.id }} .demo-image {
    display: grid;
    gap: 16px;
    padding: 24px;
    border-radius: 18px;
  }

  @media screen and (max-width: 749px) {
    #shopify-section-{{ section.id }} .demo-image {
      padding: 16px;
    }
  }
</style>
<section class="demo-image">
  <img src="${demoCdnImageUrl}" width="1200" height="675" alt="Demo hero image">
  <h2>{{ section.settings.heading }}</h2>
</section>
{% schema %}
{
  "name": "Demo CDN image",
  "settings": [
    { "type": "text", "id": "heading", "label": "Heading", "default": "Demo hero" },
    { "type": "range", "id": "gap", "label": "Gap", "min": 0, "max": 40, "step": 4, "default": 16 },
    { "type": "color", "id": "accent", "label": "Accent", "default": "#111111" }
  ],
  "presets": [{ "name": "Demo CDN image" }]
}
{% endschema %}
`,
          },
        ],
      }),
      { shopifyClient: mockShopifyClient }
    );

    assert.equal(result.success, true);
    assert.equal(result.status, "preview_ready");
  } finally {
    global.fetch = previousFetch;
  }
});

test("draftThemeArtifact - rejects placeholder media when exact-match replica requires explicit renderable media", async () => {
  const mockShopifyClient = {
    url: "https://unit-test.myshopify.com/admin/api/2026-01/graphql.json",
    requestConfig: {
      headers: new Headers({ "x-shopify-access-token": "fake-token" })
    },
    session: { shop: "unit-test.myshopify.com" },
    request: async () => {}
  };

  const result = await execute(
    draftThemeArtifact.schema.parse({
      mode: "create",
      themeId: 111,
      files: [
        {
          key: "sections/collections-slider.liquid",
          value: `
<style>
  #shopify-section-{{ section.id }} .collections-slider {
    display: grid;
    gap: 24px;
  }

  @media screen and (max-width: 749px) {
    #shopify-section-{{ section.id }} .collections-slider {
      gap: 16px;
    }
  }
</style>
<section class="collections-slider page-width">
  <div class="collections-slider__card">
    {{ 'collection-1' | placeholder_svg_tag }}
  </div>
</section>
{% schema %}
{
  "name": "Collections slider",
  "settings": [
    { "type": "image_picker", "id": "image", "label": "Image" },
    { "type": "text", "id": "heading", "label": "Heading", "default": "Ontdek onze" },
    { "type": "text", "id": "heading_accent", "label": "Accent", "default": "collecties" }
  ],
  "presets": [{ "name": "Collections slider" }]
}
{% endschema %}
`,
        },
      ],
    }),
    {
      shopifyClient: mockShopifyClient,
      sectionBlueprint: {
        qualityTarget: "exact_match",
        referenceSignals: {
          exactReplicaRequested: true,
          previewMediaPolicy: "strict_renderable_media",
          hasScreenshotLikeReference: true,
          hasExplicitMediaSources: true,
          prefersRenderablePreviewMedia: true,
          requiresRenderablePreviewMedia: true,
          allowStylizedPreviewFallbacks: false,
          requiresTitleAccent: false,
          requiresNavButtons: false,
          requiresThemeEditorLifecycleHooks: false,
          requiresThemeWrapperMirror: true,
        },
      },
      themeSectionContext: {
        usesPageWidth: true,
      },
    }
  );

  assert.equal(result.success, false);
  assert.equal(result.errorCode, "exact_match_placeholder_media");
});

test("draftThemeArtifact - allows screenshot-only exact-match placeholders with a best-effort warning", async () => {
  const mockShopifyClient = {
    url: "https://unit-test.myshopify.com/admin/api/2026-01/graphql.json",
    requestConfig: {
      headers: new Headers({ "x-shopify-access-token": "fake-token" })
    },
    session: { shop: "unit-test.myshopify.com" },
    request: async () => {}
  };

  const themeMock = createThemeFileFetchMock({
    key: "sections/collections-slider.liquid",
    initialValue: "",
    existing: false,
  });
  const previousFetch = global.fetch;
  global.fetch = themeMock.handler;

  try {
    const result = await execute(
      draftThemeArtifact.schema.parse({
        mode: "create",
        themeId: 111,
        files: [
          {
            key: "sections/collections-slider.liquid",
            value: `
<style>
  #shopify-section-{{ section.id }} .collections-slider {
    display: grid;
    gap: 24px;
  }

  @media screen and (max-width: 749px) {
    #shopify-section-{{ section.id }} .collections-slider {
      gap: 16px;
    }
  }
</style>
<section class="collections-slider page-width">
  <div class="collections-slider__card">
    {{ 'collection-1' | placeholder_svg_tag }}
  </div>
</section>
{% schema %}
{
  "name": "Collections slider",
  "settings": [
    { "type": "image_picker", "id": "image", "label": "Image" },
    { "type": "text", "id": "heading", "label": "Heading", "default": "Ontdek onze" },
    { "type": "text", "id": "heading_accent", "label": "Accent", "default": "collecties" }
  ],
  "presets": [{ "name": "Collections slider" }]
}
{% endschema %}
`,
          },
        ],
      }),
      {
        shopifyClient: mockShopifyClient,
        sectionBlueprint: {
          qualityTarget: "exact_match",
          referenceSignals: {
            exactReplicaRequested: true,
            previewMediaPolicy: "best_effort_demo_media",
            hasScreenshotLikeReference: true,
            hasExplicitMediaSources: false,
            prefersRenderablePreviewMedia: true,
            requiresRenderablePreviewMedia: false,
            allowStylizedPreviewFallbacks: true,
            requiresTitleAccent: false,
            requiresNavButtons: false,
            requiresThemeEditorLifecycleHooks: false,
            requiresThemeWrapperMirror: true,
          },
        },
        themeSectionContext: {
          usesPageWidth: true,
        },
      }
    );

    assert.equal(result.success, true);
    assert.equal(result.status, "preview_ready");
    assert.ok(
      result.warnings?.some((warning) => warning.includes("demo-media fallback") || warning.includes("screenshot-gedreven")),
      "screenshot-only exact replicas should warn about best-effort preview media instead of hard failing"
    );
  } finally {
    global.fetch = previousFetch;
  }
});

test("draftThemeArtifact - rejects generic comparison replicas that drop decorative anchors or build a double shell", async () => {
  const mockShopifyClient = {
    url: "https://unit-test.myshopify.com/admin/api/2026-01/graphql.json",
    requestConfig: {
      headers: new Headers({ "x-shopify-access-token": "fake-token" })
    },
    session: { shop: "unit-test.myshopify.com" },
    request: async () => {}
  };

  const themeMock = createThemeFileFetchMock({
    key: "sections/comparison-why-us.liquid",
    initialValue: "",
    existing: false,
  });
  const previousFetch = global.fetch;
  global.fetch = themeMock.handler;

  try {
    const result = await execute(
      draftThemeArtifact.schema.parse({
        mode: "create",
        themeId: 111,
        files: [
          {
            key: "sections/comparison-why-us.liquid",
            value: `
<style>
  #shopify-section-{{ section.id }} .why {
    background: rgb(var(--bg));
  }

  #shopify-section-{{ section.id }} .why__grid {
    display: grid;
    gap: 40px;
  }

  #shopify-section-{{ section.id }} .why__table {
    background: rgb(var(--card));
    border-radius: 20px;
  }

  @media (min-width: 900px) {
    #shopify-section-{{ section.id }} .why__grid {
      grid-template-columns: 1fr 1fr;
    }
  }
</style>

<section class="why">
  <div {% render 'section-properties', background: section.settings.background %}>
    <div class="page-width why__grid">
      <div class="why__left">
        <h2>{{ section.settings.heading }}</h2>
        <div class="why__text rte">{{ section.settings.text }}</div>
      </div>

      <div class="why__table">
        <div class="why__row why__head">
          <div></div>
          <div>{{ section.settings.col_1 }}</div>
          <div>{{ section.settings.col_2 }}</div>
        </div>
        {% for block in section.blocks %}
          <div class="why__row" {{ block.shopify_attributes }}>
            <div>{{ block.settings.label }}</div>
            <div class="check ok">✔</div>
            <div class="check no">✖</div>
          </div>
        {% endfor %}
      </div>
    </div>
  </div>
</section>

{% schema %}
{
  "name": "Why us comparison",
  "settings": [
    { "type": "text", "id": "heading", "label": "Heading", "default": "This is what sets us apart." },
    { "type": "richtext", "id": "text", "label": "Text", "default": "<p>Few supplements cater to women.</p>" },
    { "type": "text", "id": "col_1", "label": "Column 1", "default": "Our Brand" },
    { "type": "text", "id": "col_2", "label": "Column 2", "default": "Others" },
    { "type": "color", "id": "background", "label": "Background", "default": "#E6D8AA" },
    { "type": "color", "id": "card_background", "label": "Card background", "default": "#FFFFFF" }
  ],
  "blocks": [
    {
      "type": "row",
      "name": "Row",
      "settings": [
        { "type": "text", "id": "label", "label": "Label", "default": "Formulated for Women" }
      ]
    }
  ],
  "presets": [{ "name": "Why us comparison" }]
}
{% endschema %}
`,
          },
        ],
      }),
      {
        shopifyClient: mockShopifyClient,
        sectionBlueprint: {
          qualityTarget: "exact_match",
          archetype: "comparison_table",
          referenceSignals: {
            exactReplicaRequested: true,
            previewMediaPolicy: "best_effort_demo_media",
            hasScreenshotLikeReference: true,
            hasDesktopMobileReferences: true,
            hasExplicitMediaSources: false,
            prefersRenderablePreviewMedia: true,
            requiresRenderablePreviewMedia: false,
            allowStylizedPreviewFallbacks: true,
            requiresResponsiveViewportParity: true,
            requiresDecorativeMediaAnchors: true,
            requiresDecorativeBadgeAnchors: true,
            requiresRatingStars: true,
            requiresComparisonIconography: true,
            requestedDecorativeMediaAnchors: ["floating_product_media"],
            requestedDecorativeBadgeAnchors: ["gluten_free_badge"],
            requiresTitleAccent: false,
            requiresNavButtons: false,
            requiresThemeEditorLifecycleHooks: false,
            requiresThemeWrapperMirror: true,
            requiresTwoSurfaceComposition: true,
            requiresDedicatedInnerCard: true,
            avoidDoubleSectionShell: true,
          },
        },
        themeSectionContext: {
          usesPageWidth: true,
        },
      }
    );

    assert.equal(result.success, false);
    assert.equal(result.status, "inspection_failed");
    assert.ok(
      result.errors?.some((issue) => issue.issueCode === "exact_match_missing_reference_media_anchor")
    );
    assert.ok(
      result.errors?.some((issue) => issue.issueCode === "exact_match_missing_reference_badge_anchor")
    );
    assert.ok(
      result.errors?.some((issue) => issue.issueCode === "exact_match_missing_rating_stars")
    );
    assert.ok(
      result.errors?.some((issue) => issue.issueCode === "exact_match_double_background_shell")
    );
  } finally {
    global.fetch = previousFetch;
  }
});

test("draftThemeArtifact - rejects exact comparison replicas that replace stars and icons with generic shapes", async () => {
  const mockShopifyClient = {
    url: "https://unit-test.myshopify.com/admin/api/2026-01/graphql.json",
    requestConfig: {
      headers: new Headers({ "x-shopify-access-token": "fake-token" })
    },
    session: { shop: "unit-test.myshopify.com" },
    request: async () => {}
  };

  const previousFetch = global.fetch;
  global.fetch = createThemeFileFetchMock({
    key: "sections/comparison-generic-shapes.liquid",
    initialValue: "",
    existing: false,
  }).handler;

  try {
    const result = await execute(
      draftThemeArtifact.schema.parse({
        themeId: 111,
        mode: "create",
        files: [
          {
            key: "sections/comparison-generic-shapes.liquid",
            value: `
<style>
  .comparison-generic {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 48px;
    padding: 40px;
    background: #e7ddb7;
  }
  .comparison-generic__rating {
    display: flex;
    gap: 8px;
    margin-top: 24px;
  }
  .comparison-generic__rating span {
    width: 20px;
    height: 20px;
    display: inline-block;
    background: #17be75;
  }
  .comparison-generic__card {
    background: #fff;
    border-radius: 32px;
    overflow: hidden;
  }
  .comparison-generic__shape {
    width: 44px;
    height: 44px;
    display: inline-block;
    background: #4b352c;
    border-radius: 999px;
  }
  .comparison-generic__shape--other {
    background: transparent;
    border: 4px solid #b7b7b7;
    border-radius: 0;
  }
  @media (max-width: 749px) {
    .comparison-generic {
      grid-template-columns: 1fr;
    }
  }
</style>
<section class="comparison-generic page-width">
  <div>
    <h2>{{ section.settings.heading }}</h2>
    <div class="comparison-generic__rating" aria-label="rating strip">
      <span aria-hidden="true"></span>
      <span aria-hidden="true"></span>
      <span aria-hidden="true"></span>
      <span aria-hidden="true"></span>
      <span aria-hidden="true"></span>
    </div>
  </div>
  <div class="comparison-generic__card">
    {% for block in section.blocks %}
      <div class="comparison-generic__row" {{ block.shopify_attributes }}>
        <span>{{ block.settings.label }}</span>
        <span class="comparison-generic__shape" aria-hidden="true"></span>
        <span class="comparison-generic__shape comparison-generic__shape--other" aria-hidden="true"></span>
      </div>
    {% endfor %}
  </div>
</section>
{% schema %}
{
  "name": "Comparison generic shapes",
  "settings": [
    { "type": "text", "id": "heading", "label": "Heading", "default": "This is what sets us apart." }
  ],
  "blocks": [
    {
      "type": "row",
      "name": "Row",
      "settings": [
        { "type": "text", "id": "label", "label": "Label", "default": "Formulated for Women" }
      ]
    }
  ],
  "presets": [{ "name": "Comparison generic shapes" }]
}
{% endschema %}
`,
          },
        ],
      }),
      {
        shopifyClient: mockShopifyClient,
        sectionBlueprint: {
          qualityTarget: "exact_match",
          archetype: "comparison_table",
          referenceSignals: {
            exactReplicaRequested: true,
            previewMediaPolicy: "best_effort_demo_media",
            hasScreenshotLikeReference: true,
            hasDesktopMobileReferences: true,
            hasExplicitMediaSources: false,
            prefersRenderablePreviewMedia: true,
            requiresRenderablePreviewMedia: false,
            allowStylizedPreviewFallbacks: true,
            requiresResponsiveViewportParity: true,
            requiresDecorativeMediaAnchors: false,
            requiresDecorativeBadgeAnchors: false,
            requiresRatingStars: true,
            requiresComparisonIconography: true,
            requestedDecorativeMediaAnchors: [],
            requestedDecorativeBadgeAnchors: [],
            requiresTitleAccent: false,
            requiresNavButtons: false,
            requiresThemeEditorLifecycleHooks: false,
            requiresThemeWrapperMirror: true,
            requiresTwoSurfaceComposition: true,
            requiresDedicatedInnerCard: true,
            avoidDoubleSectionShell: false,
          },
        },
        themeSectionContext: {
          usesPageWidth: true,
        },
      }
    );

    assert.equal(result.success, false);
    assert.ok(
      result.errors?.some((issue) => issue.issueCode === "exact_match_missing_rating_stars")
    );
    assert.ok(
      result.errors?.some((issue) => issue.issueCode === "exact_match_missing_comparison_iconography")
    );
  } finally {
    global.fetch = previousFetch;
  }
});

test("draftThemeArtifact - rejects exact comparison replicas that miss the inner card surface", async () => {
  const mockShopifyClient = {
    url: "https://unit-test.myshopify.com/admin/api/2026-01/graphql.json",
    requestConfig: {
      headers: new Headers({ "x-shopify-access-token": "fake-token" })
    },
    session: { shop: "unit-test.myshopify.com" },
    request: async () => {}
  };

  const previousFetch = global.fetch;
  global.fetch = createThemeFileFetchMock({
    key: "sections/comparison-no-inner-card.liquid",
    initialValue: "",
    existing: false,
  }).handler;

  try {
    const result = await execute(
      draftThemeArtifact.schema.parse({
        themeId: 111,
        mode: "create",
        files: [
          {
            key: "sections/comparison-no-inner-card.liquid",
            value: `
<style>
  .comparison-shell {
    max-width: 1200px;
    margin: 0 auto;
    display: grid;
    gap: 32px;
    padding: 32px;
  }

  @media (min-width: 750px) {
    .comparison-shell {
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    }
  }
</style>
<section class="comparison-shell page-width">
  <div>
    <div aria-label="5 star rating">★★★★★</div>
    <h2>{{ section.settings.heading }}</h2>
  </div>
  <div>
    {% for block in section.blocks %}
      <div {{ block.shopify_attributes }}>
        <span>{{ block.settings.label }}</span>
        <span aria-hidden="true">✓</span>
        <span aria-hidden="true">✕</span>
      </div>
    {% endfor %}
  </div>
</section>
{% schema %}
{
  "name": "Comparison no inner card",
  "settings": [
    { "type": "text", "id": "heading", "label": "Heading", "default": "Why choose us" }
  ],
  "blocks": [
    {
      "type": "row",
      "name": "Row",
      "settings": [
        { "type": "text", "id": "label", "label": "Label", "default": "Clinically backed" }
      ]
    }
  ],
  "presets": [{ "name": "Comparison no inner card" }]
}
{% endschema %}
`,
          },
        ],
      }),
      {
        shopifyClient: mockShopifyClient,
        sectionBlueprint: {
          qualityTarget: "exact_match",
          archetype: "comparison_table",
          referenceSignals: {
            exactReplicaRequested: true,
            previewMediaPolicy: "best_effort_demo_media",
            hasScreenshotLikeReference: true,
            hasDesktopMobileReferences: true,
            hasExplicitMediaSources: false,
            prefersRenderablePreviewMedia: true,
            requiresRenderablePreviewMedia: false,
            allowStylizedPreviewFallbacks: true,
            requiresResponsiveViewportParity: true,
            requiresDecorativeMediaAnchors: false,
            requiresDecorativeBadgeAnchors: false,
            requiresRatingStars: true,
            requiresComparisonIconography: true,
            requestedDecorativeMediaAnchors: [],
            requestedDecorativeBadgeAnchors: [],
            requiresTitleAccent: false,
            requiresNavButtons: false,
            requiresThemeEditorLifecycleHooks: false,
            requiresThemeWrapperMirror: true,
            requiresTwoSurfaceComposition: true,
            requiresDedicatedInnerCard: true,
            avoidDoubleSectionShell: false,
            sectionShellFamily: "bounded_card_shell",
          },
          layoutContract: {
            sectionShellFamily: "bounded_card_shell",
            preferBoundedShell: true,
            requiresDedicatedInnerCard: true,
          },
          themeWrapperStrategy: {
            sectionShellFamily: "bounded_card_shell",
            allowOuterThemeContainer: true,
          },
        },
        themeSectionContext: {
          usesPageWidth: true,
        },
      }
    );

    assert.equal(result.success, false);
    assert.ok(
      result.errors?.some(
        (issue) => issue.issueCode === "exact_match_missing_inner_card_surface"
      )
    );
  } finally {
    global.fetch = previousFetch;
  }
});

test("draftThemeArtifact - rejects exact review replicas that drop the bounded shell", async () => {
  const mockShopifyClient = {
    url: "https://unit-test.myshopify.com/admin/api/2026-01/graphql.json",
    requestConfig: {
      headers: new Headers({ "x-shopify-access-token": "fake-token" })
    },
    session: { shop: "unit-test.myshopify.com" },
    request: async () => {}
  };

  const previousFetch = global.fetch;
  global.fetch = createThemeFileFetchMock({
    key: "sections/review-slider-no-bounded-shell.liquid",
    initialValue: "",
    existing: false,
  }).handler;

  try {
    const result = await execute(
      draftThemeArtifact.schema.parse({
        themeId: 111,
        mode: "create",
        files: [
          {
            key: "sections/review-slider-no-bounded-shell.liquid",
            value: `
<style>
  .review-slider {
    display: grid;
    gap: 24px;
    padding: 32px;
  }

  .review-slider__card {
    background: #ffffff;
    border-radius: 24px;
    padding: 24px;
  }
</style>
<section class="review-slider">
  <button type="button" aria-label="Previous review">Prev</button>
  <article class="review-slider__card">
    <div aria-label="5 star rating">★★★★★</div>
    <p>{{ section.settings.quote }}</p>
  </article>
  <button type="button" aria-label="Next review">Next</button>
</section>
{% schema %}
{
  "name": "Review slider no bounded shell",
  "settings": [
    { "type": "text", "id": "quote", "label": "Quote", "default": "Snelle levering en top service." }
  ],
  "presets": [{ "name": "Review slider no bounded shell" }]
}
{% endschema %}
`,
          },
        ],
      }),
      {
        shopifyClient: mockShopifyClient,
        sectionBlueprint: {
          qualityTarget: "exact_match",
          archetype: "review_slider",
          referenceSignals: {
            exactReplicaRequested: true,
            previewMediaPolicy: "best_effort_demo_media",
            hasScreenshotLikeReference: true,
            hasDesktopMobileReferences: true,
            hasExplicitMediaSources: false,
            prefersRenderablePreviewMedia: true,
            requiresRenderablePreviewMedia: false,
            allowStylizedPreviewFallbacks: true,
            requiresResponsiveViewportParity: true,
            requiresDecorativeMediaAnchors: false,
            requiresDecorativeBadgeAnchors: false,
            requiresRatingStars: true,
            requiresComparisonIconography: false,
            requestedDecorativeMediaAnchors: [],
            requestedDecorativeBadgeAnchors: [],
            requiresTitleAccent: false,
            requiresNavButtons: true,
            requiresThemeEditorLifecycleHooks: false,
            requiresThemeWrapperMirror: true,
            requiresTwoSurfaceComposition: true,
            requiresDedicatedInnerCard: true,
            avoidDoubleSectionShell: false,
            sectionShellFamily: "bounded_card_shell",
          },
          layoutContract: {
            sectionShellFamily: "bounded_card_shell",
            preferBoundedShell: true,
            requiresDedicatedInnerCard: true,
          },
          themeWrapperStrategy: {
            sectionShellFamily: "bounded_card_shell",
            allowOuterThemeContainer: true,
          },
        },
        themeSectionContext: {
          usesPageWidth: true,
        },
      }
    );

    assert.equal(result.success, false);
    assert.ok(
      result.errors?.some((issue) => issue.issueCode === "exact_match_missing_bounded_shell")
    );
  } finally {
    global.fetch = previousFetch;
  }
});

test("draftThemeArtifact - flags missing viewport parity on exact replicas with explicit desktop/mobile references", async () => {
  const mockShopifyClient = {
    url: "https://unit-test.myshopify.com/admin/api/2026-01/graphql.json",
    requestConfig: {
      headers: new Headers({ "x-shopify-access-token": "fake-token" }),
    },
    session: { shop: "unit-test.myshopify.com" },
    request: async () => {},
  };

  const previousFetch = global.fetch;
  global.fetch = createThemeFileFetchMock({
    key: "sections/exact-replica-no-breakpoints.liquid",
    initialValue: "",
    existing: false,
  }).handler;

  try {
    const result = await execute(
      draftThemeArtifact.schema.parse({
        themeId: 111,
        mode: "create",
        files: [
          {
            key: "sections/exact-replica-no-breakpoints.liquid",
            value: `
<style>
  .exact-replica {
    display: grid;
    gap: 32px;
    padding: 32px;
  }
</style>
<section class="exact-replica page-width">
  <div>
    <h2>{{ section.settings.heading }}</h2>
    <div class="rte">{{ section.settings.body }}</div>
  </div>
</section>
{% schema %}
{
  "name": "Exact replica no breakpoints",
  "settings": [
    { "type": "text", "id": "heading", "label": "Heading", "default": "Match the reference" },
    { "type": "richtext", "id": "body", "label": "Body", "default": "<p>Desktop and mobile were both provided.</p>" }
  ],
  "presets": [{ "name": "Exact replica no breakpoints" }]
}
{% endschema %}
`,
          },
        ],
      }),
      {
        shopifyClient: mockShopifyClient,
        sectionBlueprint: {
          qualityTarget: "exact_match",
          referenceSignals: {
            exactReplicaRequested: true,
            hasDesktopMobileReferences: true,
            requiresResponsiveViewportParity: true,
            previewMediaPolicy: "best_effort_demo_media",
            hasExplicitMediaSources: false,
            prefersRenderablePreviewMedia: true,
            requiresRenderablePreviewMedia: false,
            allowStylizedPreviewFallbacks: true,
            requiresTitleAccent: false,
            requiresNavButtons: false,
            requiresThemeEditorLifecycleHooks: false,
            requiresThemeWrapperMirror: true,
          },
        },
        themeSectionContext: {
          usesPageWidth: true,
        },
      }
    );

    assert.equal(result.success, false);
    assert.ok(
      result.errors?.some((issue) => issue.issueCode === "exact_match_missing_viewport_parity")
    );
  } finally {
    global.fetch = previousFetch;
  }
});

test("draftThemeArtifact - flags missing nav buttons on exact replicas that require explicit controls", async () => {
  const mockShopifyClient = {
    url: "https://unit-test.myshopify.com/admin/api/2026-01/graphql.json",
    requestConfig: {
      headers: new Headers({ "x-shopify-access-token": "fake-token" }),
    },
    session: { shop: "unit-test.myshopify.com" },
    request: async () => {},
  };

  const previousFetch = global.fetch;
  global.fetch = createThemeFileFetchMock({
    key: "sections/exact-replica-no-nav-buttons.liquid",
    initialValue: "",
    existing: false,
  }).handler;

  try {
    const result = await execute(
      draftThemeArtifact.schema.parse({
        themeId: 111,
        mode: "create",
        files: [
          {
            key: "sections/exact-replica-no-nav-buttons.liquid",
            value: `
<style>
  .exact-navless {
    display: grid;
    gap: 24px;
  }

  @media (max-width: 749px) {
    .exact-navless {
      gap: 16px;
    }
  }
</style>
<section class="exact-navless page-width">
  <div class="exact-navless__track">
    <article>{{ section.settings.heading }}</article>
  </div>
</section>
{% schema %}
{
  "name": "Exact replica no nav buttons",
  "settings": [
    { "type": "text", "id": "heading", "label": "Heading", "default": "Carousel cards" }
  ],
  "presets": [{ "name": "Exact replica no nav buttons" }]
}
{% endschema %}
`,
          },
        ],
      }),
      {
        shopifyClient: mockShopifyClient,
        sectionBlueprint: {
          qualityTarget: "exact_match",
          referenceSignals: {
            exactReplicaRequested: true,
            requiresResponsiveViewportParity: true,
            requiresNavButtons: true,
            previewMediaPolicy: "best_effort_demo_media",
            hasExplicitMediaSources: false,
            prefersRenderablePreviewMedia: true,
            requiresRenderablePreviewMedia: false,
            allowStylizedPreviewFallbacks: true,
            requiresTitleAccent: false,
            requiresThemeEditorLifecycleHooks: false,
            requiresThemeWrapperMirror: true,
          },
        },
        themeSectionContext: {
          usesPageWidth: true,
        },
      }
    );

    assert.equal(result.success, false);
    assert.ok(
      result.errors?.some((issue) => issue.issueCode === "exact_match_missing_nav_buttons")
    );
  } finally {
    global.fetch = previousFetch;
  }
});

test("draftThemeArtifact - flags missing Theme Editor lifecycle hooks on interactive exact replicas", async () => {
  const mockShopifyClient = {
    url: "https://unit-test.myshopify.com/admin/api/2026-01/graphql.json",
    requestConfig: {
      headers: new Headers({ "x-shopify-access-token": "fake-token" }),
    },
    session: { shop: "unit-test.myshopify.com" },
    request: async () => {},
  };

  const previousFetch = global.fetch;
  global.fetch = createThemeFileFetchMock({
    key: "sections/exact-replica-no-editor-hooks.liquid",
    initialValue: "",
    existing: false,
  }).handler;

  try {
    const result = await execute(
      draftThemeArtifact.schema.parse({
        themeId: 111,
        mode: "create",
        files: [
          {
            key: "sections/exact-replica-no-editor-hooks.liquid",
            value: `
<style>
  .exact-slider {
    display: grid;
    gap: 24px;
  }
</style>
<section class="exact-slider page-width" data-section-id="{{ section.id }}">
  <button type="button" aria-label="Previous slide">Prev</button>
  <div class="exact-slider__track">{{ section.settings.heading }}</div>
  <button type="button" aria-label="Next slide">Next</button>
</section>
<script>
  document.addEventListener('DOMContentLoaded', () => {
    const root = document.querySelector('[data-section-id="{{ section.id }}"]');
    const track = root?.querySelector('.exact-slider__track');
    root?.querySelector('[aria-label="Previous slide"]')?.addEventListener('click', () => {
      track?.scrollBy({ left: -320, behavior: 'smooth' });
    });
    root?.querySelector('[aria-label="Next slide"]')?.addEventListener('click', () => {
      track?.scrollBy({ left: 320, behavior: 'smooth' });
    });
  });
</script>
{% schema %}
{
  "name": "Exact replica no editor hooks",
  "settings": [
    { "type": "text", "id": "heading", "label": "Heading", "default": "Interactive slider" }
  ],
  "presets": [{ "name": "Exact replica no editor hooks" }]
}
{% endschema %}
`,
          },
        ],
      }),
      {
        shopifyClient: mockShopifyClient,
        sectionBlueprint: {
          qualityTarget: "exact_match",
          referenceSignals: {
            exactReplicaRequested: true,
            requiresResponsiveViewportParity: false,
            requiresNavButtons: true,
            requiresThemeEditorLifecycleHooks: true,
            previewMediaPolicy: "best_effort_demo_media",
            hasExplicitMediaSources: false,
            prefersRenderablePreviewMedia: true,
            requiresRenderablePreviewMedia: false,
            allowStylizedPreviewFallbacks: true,
            requiresTitleAccent: false,
            requiresThemeWrapperMirror: true,
          },
        },
        themeSectionContext: {
          usesPageWidth: true,
        },
      }
    );

    assert.equal(result.success, false);
    assert.ok(
      result.errors?.some((issue) => issue.issueCode === "exact_match_missing_theme_editor_hooks")
    );
  } finally {
    global.fetch = previousFetch;
  }
});

test("draftThemeArtifact - flags missing theme wrapper mirroring on exact replicas", async () => {
  const mockShopifyClient = {
    url: "https://unit-test.myshopify.com/admin/api/2026-01/graphql.json",
    requestConfig: {
      headers: new Headers({ "x-shopify-access-token": "fake-token" }),
    },
    session: { shop: "unit-test.myshopify.com" },
    request: async () => {},
  };

  const previousFetch = global.fetch;
  global.fetch = createThemeFileFetchMock({
    key: "sections/exact-replica-no-wrapper.liquid",
    initialValue: "",
    existing: false,
  }).handler;

  try {
    const result = await execute(
      draftThemeArtifact.schema.parse({
        themeId: 111,
        mode: "create",
        files: [
          {
            key: "sections/exact-replica-no-wrapper.liquid",
            value: `
<style>
  .exact-no-wrapper {
    display: grid;
    gap: 24px;
    padding: 32px;
  }
</style>
<section class="exact-no-wrapper">
  <h2>{{ section.settings.heading }}</h2>
</section>
{% schema %}
{
  "name": "Exact replica no wrapper",
  "settings": [
    { "type": "text", "id": "heading", "label": "Heading", "default": "Mirror the theme shell" }
  ],
  "presets": [{ "name": "Exact replica no wrapper" }]
}
{% endschema %}
`,
          },
        ],
      }),
      {
        shopifyClient: mockShopifyClient,
        sectionBlueprint: {
          qualityTarget: "exact_match",
          referenceSignals: {
            exactReplicaRequested: true,
            requiresResponsiveViewportParity: false,
            requiresNavButtons: false,
            requiresThemeEditorLifecycleHooks: false,
            previewMediaPolicy: "best_effort_demo_media",
            hasExplicitMediaSources: false,
            prefersRenderablePreviewMedia: true,
            requiresRenderablePreviewMedia: false,
            allowStylizedPreviewFallbacks: true,
            requiresTitleAccent: false,
            requiresThemeWrapperMirror: true,
          },
        },
        themeSectionContext: {
          usesPageWidth: true,
        },
      }
    );

    assert.equal(result.success, false);
    assert.ok(
      result.errors?.some((issue) => issue.issueCode === "exact_match_missing_theme_wrapper")
    );
  } finally {
    global.fetch = previousFetch;
  }
});

test("draftThemeArtifact - rejects media-first exact heroes that box the outer shell with page-width/container", async () => {
  const mockShopifyClient = {
    url: "https://unit-test.myshopify.com/admin/api/2026-01/graphql.json",
    requestConfig: {
      headers: new Headers({ "x-shopify-access-token": "fake-token" }),
    },
    session: { shop: "unit-test.myshopify.com" },
    request: async () => {},
  };

  const result = await execute(
    draftThemeArtifact.schema.parse({
      themeId: 111,
      mode: "create",
      files: [
        {
          key: "sections/media-first-boxed-outer-shell.liquid",
          value: `
<style>
  .hero {
    position: relative;
    min-height: 360px;
    overflow: hidden;
  }

  .hero__media,
  .hero__overlay {
    position: absolute;
    inset: 0;
  }

  .hero__content {
    position: relative;
    z-index: 1;
    padding: 48px;
    max-width: 640px;
  }

  .hero__overlay {
    background: linear-gradient(90deg, rgba(24, 18, 16, 0.72) 0%, rgba(24, 18, 16, 0.12) 72%);
  }

  @media screen and (max-width: 749px) {
    .hero {
      min-height: 320px;
    }

    .hero__content {
      padding: 32px 20px;
      max-width: 100%;
    }
  }
</style>
<section class="hero page-width container">
  <div class="hero__media">
    {% if section.settings.image != blank %}
      {{ section.settings.image | image_url: width: 1600 | image_tag: alt: section.settings.heading }}
    {% else %}
      <img src="${demoCdnImageUrl}" width="1600" height="900" alt="Demo hero">
    {% endif %}
  </div>
  <div class="hero__overlay"></div>
  <div class="hero__content">
    <h2>{{ section.settings.heading }}</h2>
  </div>
</section>
{% schema %}
{
  "name": "Media first boxed outer shell",
  "settings": [
    { "type": "text", "id": "heading", "label": "Heading", "default": "Glow from the first sip" },
    { "type": "image_picker", "id": "image", "label": "Image" }
  ],
  "presets": [{ "name": "Media first boxed outer shell" }]
}
{% endschema %}
`,
        },
      ],
    }),
    {
      shopifyClient: mockShopifyClient,
      sectionBlueprint: buildExactMediaFirstHeroBlueprint(),
      themeSectionContext: {
        usesPageWidth: true,
      },
    }
  );

  assert.equal(result.success, false);
  assert.ok(
    result.errors?.some((issue) => issue.issueCode === "exact_match_hero_outer_container")
  );
});

test("draftThemeArtifact - rejects media-first exact heroes whose media shell is boxed by an inner theme wrapper", async () => {
  const mockShopifyClient = {
    url: "https://unit-test.myshopify.com/admin/api/2026-01/graphql.json",
    requestConfig: {
      headers: new Headers({ "x-shopify-access-token": "fake-token" }),
    },
    session: { shop: "unit-test.myshopify.com" },
    request: async () => {},
  };

  const result = await execute(
    draftThemeArtifact.schema.parse({
      themeId: 111,
      mode: "create",
      files: [
        {
          key: "sections/media-first-boxed-media-shell.liquid",
          value: `
<style>
  .hero {
    position: relative;
    min-height: 640px;
    overflow: hidden;
  }

  .hero__media,
  .hero__overlay {
    position: absolute;
    inset: 0;
  }

  .hero__content {
    position: relative;
    z-index: 1;
    padding: 48px;
    max-width: 640px;
  }

  .hero__overlay {
    background: linear-gradient(90deg, rgba(24, 18, 16, 0.72) 0%, rgba(24, 18, 16, 0.12) 72%);
  }
</style>
<section class="hero">
  <div class="page-width section-properties">
    <div class="hero__media">
      {% if section.settings.image != blank %}
        {{ section.settings.image | image_url: width: 1600 | image_tag: alt: section.settings.heading }}
      {% else %}
        <img src="${demoCdnImageUrl}" width="1600" height="900" alt="Demo hero">
      {% endif %}
    </div>
    <div class="hero__overlay"></div>
  </div>
  <div class="page-width hero__content">
    <h2>{{ section.settings.heading }}</h2>
  </div>
</section>
{% schema %}
{
  "name": "Media first boxed media shell",
  "settings": [
    { "type": "text", "id": "heading", "label": "Heading", "default": "Glow from the first sip" },
    { "type": "image_picker", "id": "image", "label": "Image" }
  ],
  "presets": [{ "name": "Media first boxed media shell" }]
}
{% endschema %}
`,
        },
      ],
    }),
    {
      shopifyClient: mockShopifyClient,
      sectionBlueprint: buildExactMediaFirstHeroBlueprint(),
      themeSectionContext: {
        usesPageWidth: true,
        usesSectionPropertiesWrapper: true,
      },
    }
  );

  assert.equal(result.success, false);
  assert.ok(
    result.errors?.some(
      (issue) => issue.issueCode === "exact_match_media_shell_boxed_by_wrapper"
    )
  );
});

test("draftThemeArtifact - does not flag wrapper errors when media-first heroes keep page-width only on an inner content layer", async () => {
  const mockShopifyClient = {
    url: "https://unit-test.myshopify.com/admin/api/2026-01/graphql.json",
    requestConfig: {
      headers: new Headers({ "x-shopify-access-token": "fake-token" }),
    },
    session: { shop: "unit-test.myshopify.com" },
    request: async () => {},
  };

  const previousFetch = global.fetch;
  global.fetch = createThemeFileFetchMock({
    key: "sections/media-first-inner-content-wrapper.liquid",
    initialValue: "",
    existing: false,
  }).handler;

  try {
    const result = await execute(
      draftThemeArtifact.schema.parse({
        themeId: 111,
        mode: "create",
        files: [
          {
            key: "sections/media-first-inner-content-wrapper.liquid",
            value: `
<style>
  .hero {
    position: relative;
    min-height: 640px;
    overflow: hidden;
  }

  .hero__media,
  .hero__overlay {
    position: absolute;
    inset: 0;
  }

  .hero__content-shell {
    position: relative;
    z-index: 1;
  }

  .hero__content {
    padding: 48px;
    max-width: 640px;
  }

  .hero__overlay {
    background: linear-gradient(90deg, rgba(24, 18, 16, 0.72) 0%, rgba(24, 18, 16, 0.12) 72%);
  }
</style>
<section class="hero">
  <div class="hero__media">
    {% if section.settings.image != blank %}
      {{ section.settings.image | image_url: width: 1600 | image_tag: alt: section.settings.heading }}
    {% else %}
      <img src="${demoCdnImageUrl}" width="1600" height="900" alt="Demo hero">
    {% endif %}
  </div>
  <div class="hero__overlay"></div>
  <div class="page-width hero__content-shell">
    <div class="hero__content">
      <h2>{{ section.settings.heading }}</h2>
    </div>
  </div>
</section>
{% schema %}
{
  "name": "Media first hero",
  "settings": [
    { "type": "text", "id": "heading", "label": "Heading", "default": "Glow from the first sip" },
    { "type": "image_picker", "id": "image", "label": "Image" }
  ],
  "presets": [{ "name": "Media first inner content wrapper" }]
}
{% endschema %}
`,
          },
        ],
      }),
      {
        shopifyClient: mockShopifyClient,
        sectionBlueprint: buildExactMediaFirstHeroBlueprint(),
        themeSectionContext: {
          usesPageWidth: true,
        },
      }
    );

    assert.ok(
      !result.errors?.some((issue) => issue.issueCode === "exact_match_missing_theme_wrapper")
    );
    assert.ok(
      !result.errors?.some((issue) => issue.issueCode === "exact_match_hero_outer_container")
    );
    assert.ok(
      !result.errors?.some(
        (issue) => issue.issueCode === "exact_match_media_shell_boxed_by_wrapper"
      )
    );
  } finally {
    global.fetch = previousFetch;
  }
});

test("draftThemeArtifact - rejects media-first exact heroes that degrade into split layouts", async () => {
  const mockShopifyClient = {
    url: "https://unit-test.myshopify.com/admin/api/2026-01/graphql.json",
    requestConfig: {
      headers: new Headers({ "x-shopify-access-token": "fake-token" }),
    },
    session: { shop: "unit-test.myshopify.com" },
    request: async () => {},
  };

  const result = await execute(
    draftThemeArtifact.schema.parse({
      themeId: 111,
      mode: "create",
      files: [
        {
          key: "sections/media-first-split-mismatch.liquid",
          value: `
<style>
  .hero {
    display: grid;
    grid-template-columns: minmax(0, 0.9fr) minmax(0, 1.1fr);
    gap: 40px;
    align-items: center;
  }

  .hero__content {
    padding: 32px;
  }

  .hero__image-column img {
    width: 100%;
    height: auto;
    display: block;
  }
</style>
<section class="hero split-layout">
  <div class="hero__content">
    <h2>{{ section.settings.heading }}</h2>
  </div>
  <div class="hero__image-column">
    {% if section.settings.image != blank %}
      {{ section.settings.image | image_url: width: 1400 | image_tag: alt: section.settings.heading }}
    {% else %}
      <img src="${demoCdnImageUrl}" width="1400" height="900" alt="Demo hero">
    {% endif %}
  </div>
</section>
{% schema %}
{
  "name": "Media first split mismatch",
  "settings": [
    { "type": "text", "id": "heading", "label": "Heading", "default": "Glow from the first sip" },
    { "type": "image_picker", "id": "image", "label": "Image" }
  ],
  "presets": [{ "name": "Media first split mismatch" }]
}
{% endschema %}
`,
        },
      ],
    }),
    {
      shopifyClient: mockShopifyClient,
      sectionBlueprint: buildExactMediaFirstHeroBlueprint(),
      themeSectionContext: {
        usesPageWidth: true,
      },
    }
  );

  assert.equal(result.success, false);
  assert.ok(
    result.errors?.some(
      (issue) => issue.issueCode === "exact_match_media_first_split_mismatch"
    )
  );
});

test("draftThemeArtifact - rejects media-first exact heroes whose fallback and uploaded media use different slots", async () => {
  const mockShopifyClient = {
    url: "https://unit-test.myshopify.com/admin/api/2026-01/graphql.json",
    requestConfig: {
      headers: new Headers({ "x-shopify-access-token": "fake-token" }),
    },
    session: { shop: "unit-test.myshopify.com" },
    request: async () => {},
  };

  const result = await execute(
    draftThemeArtifact.schema.parse({
      themeId: 111,
      mode: "create",
      files: [
        {
          key: "sections/media-first-slot-mismatch.liquid",
          value: `
<style>
  .hero {
    position: relative;
    min-height: 640px;
    overflow: hidden;
  }

  .hero__overlay {
    position: absolute;
    inset: 0;
    background: linear-gradient(90deg, rgba(24, 18, 16, 0.72) 0%, rgba(24, 18, 16, 0.12) 72%);
  }

  .hero__content {
    position: relative;
    z-index: 1;
    padding: 48px;
    max-width: 640px;
  }
</style>
<section class="hero">
  {% if section.settings.image != blank %}
    <div class="hero__uploaded-media">
      {{ section.settings.image | image_url: width: 1600 | image_tag: alt: section.settings.heading }}
    </div>
  {% else %}
    <div class="hero__fallback-media">
      <img src="${demoCdnImageUrl}" width="1600" height="900" alt="Demo hero">
    </div>
  {% endif %}
  <div class="hero__overlay"></div>
  <div class="hero__content">
    <h2>{{ section.settings.heading }}</h2>
  </div>
</section>
{% schema %}
{
  "name": "Media first slot mismatch",
  "settings": [
    { "type": "text", "id": "heading", "label": "Heading", "default": "Glow from the first sip" },
    { "type": "image_picker", "id": "image", "label": "Image" }
  ],
  "presets": [{ "name": "Media first slot mismatch" }]
}
{% endschema %}
`,
        },
      ],
    }),
    {
      shopifyClient: mockShopifyClient,
      sectionBlueprint: buildExactMediaFirstHeroBlueprint(),
      themeSectionContext: {
        usesPageWidth: true,
      },
    }
  );

  assert.equal(result.success, false);
  assert.ok(
    result.errors?.some((issue) => issue.issueCode === "exact_match_media_slot_mismatch")
  );
});

test("draftThemeArtifact - rejects exact review-wall replicas that combine section-properties with a root background shell", async () => {
  const mockShopifyClient = {
    url: "https://unit-test.myshopify.com/admin/api/2026-01/graphql.json",
    requestConfig: {
      headers: new Headers({ "x-shopify-access-token": "fake-token" }),
    },
    session: { shop: "unit-test.myshopify.com" },
    request: async () => {},
  };

  const previousFetch = global.fetch;
  global.fetch = createThemeFileFetchMock({
    key: "sections/trustpilot-review-wall.liquid",
    initialValue: "",
    existing: false,
  }).handler;

  try {
    const result = await execute(
      draftThemeArtifact.schema.parse({
        themeId: 111,
        mode: "create",
        files: [
          {
            key: "sections/trustpilot-review-wall.liquid",
            value: `
<style>
  .trustpilot-review-wall {
    background: #eae6db;
    padding: 32px;
  }

  .trustpilot-review-wall__inner {
    display: grid;
    gap: 24px;
  }

  .trustpilot-review-wall__card {
    background: #ffffff;
    border-radius: 28px;
    padding: 24px;
  }

  .trustpilot-review-wall__rating {
    display: flex;
    gap: 8px;
  }

  @media (min-width: 900px) {
    .trustpilot-review-wall__inner {
      grid-template-columns: minmax(0, 0.9fr) minmax(0, 1.1fr);
    }
  }
</style>
<section class="trustpilot-review-wall">
  <div {% render 'section-properties', background: section.settings.background %}>
    <div class="trustpilot-review-wall__inner page-width">
      <div>
        <div class="trustpilot-review-wall__rating" aria-label="Trustpilot rating">
          <span aria-hidden="true">★</span>
          <span aria-hidden="true">★</span>
          <span aria-hidden="true">★</span>
          <span aria-hidden="true">★</span>
          <span aria-hidden="true">★</span>
        </div>
        <h2>{{ section.settings.heading }}</h2>
      </div>
      <article class="trustpilot-review-wall__card">
        <svg aria-hidden="true" viewBox="0 0 32 32"><path d="M8 8h8v8H8z"></path></svg>
        <h3>{{ section.settings.card_title }}</h3>
        <p>{{ section.settings.card_copy }}</p>
      </article>
    </div>
  </div>
</section>
{% schema %}
{
  "name": "Trustpilot review wall",
  "settings": [
    { "type": "text", "id": "heading", "label": "Heading", "default": "Wat zeggen klanten?" },
    { "type": "text", "id": "card_title", "label": "Card title", "default": "Prima bedrijf" },
    { "type": "textarea", "id": "card_copy", "label": "Card copy", "default": "Goede communicatie en snelle levering." },
    { "type": "color", "id": "background", "label": "Background", "default": "#EAE6DB" }
  ],
  "presets": [{ "name": "Trustpilot review wall" }]
}
{% endschema %}
`,
          },
        ],
      }),
      {
        shopifyClient: mockShopifyClient,
        sectionBlueprint: {
          qualityTarget: "exact_match",
          archetype: "review_slider",
          referenceSignals: {
            exactReplicaRequested: true,
            previewMediaPolicy: "best_effort_demo_media",
            hasScreenshotLikeReference: true,
            hasDesktopMobileReferences: true,
            hasExplicitMediaSources: false,
            prefersRenderablePreviewMedia: true,
            requiresRenderablePreviewMedia: false,
            allowStylizedPreviewFallbacks: true,
            requiresResponsiveViewportParity: false,
            requiresDecorativeMediaAnchors: false,
            requiresDecorativeBadgeAnchors: false,
            requiresRatingStars: true,
            requiresComparisonIconography: false,
            requestedDecorativeMediaAnchors: [],
            requestedDecorativeBadgeAnchors: [],
            requiresTitleAccent: false,
            requiresNavButtons: false,
            requiresThemeEditorLifecycleHooks: false,
            requiresThemeWrapperMirror: true,
            requiresTwoSurfaceComposition: true,
            requiresDedicatedInnerCard: true,
            avoidDoubleSectionShell: true,
          },
        },
        themeSectionContext: {
          usesPageWidth: true,
          usesSectionPropertiesWrapper: true,
        },
      }
    );

    assert.equal(result.success, false);
    assert.ok(
      result.errors?.some((issue) => issue.issueCode === "exact_match_double_background_shell")
    );
    assert.ok(
      !result.errors?.some(
        (issue) => issue.issueCode === "exact_match_missing_reference_media_anchor"
      )
    );
    assert.ok(
      !result.errors?.some(
        (issue) => issue.issueCode === "exact_match_missing_reference_badge_anchor"
      )
    );
    assert.ok(
      !result.errors?.some((issue) => issue.issueCode === "exact_match_missing_rating_stars")
    );
    assert.ok(
      !result.warnings?.some((warning) => warning.includes("image_picker")),
      "decorative inline SVG and star glyphs should not trigger a merchant media warning"
    );
  } finally {
    global.fetch = previousFetch;
  }
});

test("draftThemeArtifact - flags missing schema labels during local inspection before relying only on theme-check", async () => {
  const mockShopifyClient = {
    url: "https://unit-test.myshopify.com/admin/api/2026-01/graphql.json",
    requestConfig: {
      headers: new Headers({ "x-shopify-access-token": "fake-token" })
    },
    session: { shop: "unit-test.myshopify.com" },
    request: async () => {}
  };

  const result = await execute(
    draftThemeArtifact.schema.parse({
      mode: "create",
      themeId: 111,
      files: [
        {
          key: "sections/missing-labels.liquid",
          value: `
<style>
  #shopify-section-{{ section.id }} .card { display: grid; gap: 16px; }
</style>
<section class="card">{{ section.settings.heading }}</section>
{% schema %}
{
  "name": "Missing labels",
  "settings": [
    { "type": "text", "id": "heading", "default": "Hello" }
  ],
  "presets": [{ "name": "Missing labels" }]
}
{% endschema %}
`,
        },
      ],
    }),
    { shopifyClient: mockShopifyClient }
  );

  assert.equal(result.success, false);
  assert.equal(result.status, "inspection_failed");
  assert.ok(
    result.errors?.some(
      (issue) =>
        issue.issueCode === "inspection_failed_schema" &&
        Array.isArray(issue.path) &&
        issue.path.includes("label")
    ),
    "missing labels should be surfaced by local inspection with a schema-focused path"
  );
  assert.ok(
    result.suggestedFixes?.some((entry) => entry.includes("Voeg een label toe")),
    "local inspection should provide an immediate label repair hint"
  );
});

test("draftThemeArtifact - rejects multiple schema blocks during local inspection", async () => {
  const mockShopifyClient = {
    url: "https://unit-test.myshopify.com/admin/api/2026-01/graphql.json",
    requestConfig: {
      headers: new Headers({ "x-shopify-access-token": "fake-token" })
    },
    session: { shop: "unit-test.myshopify.com" },
    request: async () => {}
  };

  const result = await execute(
    draftThemeArtifact.schema.parse({
      mode: "create",
      themeId: 111,
      files: [
        {
          key: "sections/duplicate-schema.liquid",
          value: `
<section>{{ section.settings.heading }}</section>
{% schema %}
{
  "name": "Duplicate schema",
  "settings": [
    { "type": "text", "id": "heading", "label": "Heading", "default": "Hello" }
  ],
  "presets": [{ "name": "Duplicate schema" }]
}
{% endschema %}
{% schema %}
{
  "name": "Duplicate schema again",
  "settings": [],
  "presets": [{ "name": "Duplicate schema again" }]
}
{% endschema %}
`,
        },
      ],
    }),
    { shopifyClient: mockShopifyClient }
  );

  assert.equal(result.success, false);
  assert.equal(result.status, "inspection_failed");
  assert.ok(
    result.errors?.some(
      (issue) =>
        issue.issueCode === "inspection_failed_schema" &&
        String(issue.suggestedReplacement || "").includes("Multiple {% schema %} blocks")
    ),
    "multiple schema blocks should fail during local inspection before preview write"
  );
});

test("draftThemeArtifact - catches unclosed liquid delimiters before theme-check is the first syntax detector", async () => {
  const mockShopifyClient = {
    url: "https://unit-test.myshopify.com/admin/api/2026-01/graphql.json",
    requestConfig: {
      headers: new Headers({ "x-shopify-access-token": "fake-token" })
    },
    session: { shop: "unit-test.myshopify.com" },
    request: async () => {}
  };

  const result = await execute(
    draftThemeArtifact.schema.parse({
      mode: "create",
      themeId: 111,
      files: [
        {
          key: "sections/broken-delimiters.liquid",
          value: `
<section class="broken-delimiters">
  <h2>{{ section.settings.heading }</h2>
</section>
{% schema %}
{
  "name": "Broken delimiters",
  "settings": [
    { "type": "text", "id": "heading", "label": "Heading", "default": "Hello" }
  ],
  "presets": [{ "name": "Broken delimiters" }]
}
{% endschema %}
`,
        },
      ],
    }),
    { shopifyClient: mockShopifyClient }
  );

  assert.equal(result.success, false);
  assert.equal(result.status, "inspection_failed");
  assert.ok(
    result.errors?.some((issue) => issue.issueCode === "inspection_failed_liquid_delimiter_balance"),
    "unclosed Liquid delimiters should be surfaced during local inspection"
  );
});

test("draftThemeArtifact - still catches an unclosed Liquid output inside inline style blocks", async () => {
  const mockShopifyClient = {
    url: "https://unit-test.myshopify.com/admin/api/2026-01/graphql.json",
    requestConfig: {
      headers: new Headers({ "x-shopify-access-token": "fake-token" })
    },
    session: { shop: "unit-test.myshopify.com" },
    request: async () => {}
  };

  const result = await execute(
    draftThemeArtifact.schema.parse({
      mode: "create",
      themeId: 111,
      files: [
        {
          key: "sections/broken-style-delimiters.liquid",
          value: `
<style>
  @keyframes heroRatingPulse{0%{transform:translateY(0)}50%{transform:translateY(-4px)}100%{transform:translateY(0)}}
  #shopify-section-{{ section.id } .card { padding: 24px; }
</style>
<div class="card">{{ section.settings.heading }}</div>
{% schema %}
{
  "name": "Broken style delimiters",
  "settings": [
    { "type": "text", "id": "heading", "label": "Heading", "default": "Hello" }
  ],
  "presets": [{ "name": "Broken style delimiters" }]
}
{% endschema %}
`,
        },
      ],
    }),
    { shopifyClient: mockShopifyClient }
  );

  assert.equal(result.success, false);
  assert.equal(result.status, "inspection_failed");
  assert.ok(
    result.errors?.some((issue) => issue.issueCode === "inspection_failed_liquid_delimiter_balance"),
    "a real unclosed Liquid opening inside inline style should still fail local inspection"
  );
});

test("draftThemeArtifact - rejects unguarded optional block images in create mode", async () => {
  const mockShopifyClient = {
    url: "https://unit-test.myshopify.com/admin/api/2026-01/graphql.json",
    requestConfig: {
      headers: new Headers({ "x-shopify-access-token": "fake-token" })
    },
    session: { shop: "unit-test.myshopify.com" },
    request: async () => {}
  };

  const result = await execute(
    draftThemeArtifact.schema.parse({
      mode: "create",
      themeId: 111,
      files: [
        {
          key: "sections/unsafe-carousel.liquid",
          value: `
<style>
  #shopify-section-{{ section.id }} .cards { display: grid; gap: 16px; }
</style>
<div class="cards">
  {% for block in section.blocks %}
    <article class="card" {{ block.shopify_attributes }}>
      {{ block.settings.image | image_url: width: 900 | image_tag }}
    </article>
  {% endfor %}
</div>
{% schema %}
{
  "name": "Unsafe carousel",
  "blocks": [
    {
      "type": "card",
      "name": "Card",
      "settings": [
        { "type": "image_picker", "id": "image", "label": "Image" }
      ]
    }
  ],
  "presets": [
    {
      "name": "Unsafe carousel",
      "blocks": [
        { "type": "card" }
      ]
    }
  ]
}
{% endschema %}
`,
        },
      ],
    }),
    { shopifyClient: mockShopifyClient }
  );

  assert.equal(result.success, false);
  assert.equal(result.status, "inspection_failed");
  assert.ok(
    result.errors?.some(
      (issue) => issue.issueCode === "inspection_failed_unguarded_optional_resource"
    )
  );
  assert.ok(
    result.errors?.some(
      (issue) => issue.issueCode === "inspection_failed_unrenderable_preset"
    )
  );
});

test("draftThemeArtifact - accepts guarded optional block images with fallback in create mode", async () => {
  const mockShopifyClient = {
    url: "https://unit-test.myshopify.com/admin/api/2026-01/graphql.json",
    requestConfig: {
      headers: new Headers({ "x-shopify-access-token": "fake-token" })
    },
    session: { shop: "unit-test.myshopify.com" },
    request: async () => {}
  };

  const themeMock = createThemeFileFetchMock({
    key: "sections/safe-carousel.liquid",
    initialValue: "",
    existing: false,
  });
  const previousFetch = global.fetch;
  global.fetch = themeMock.handler;

  try {
    const result = await execute(
      draftThemeArtifact.schema.parse({
        mode: "create",
        themeId: 111,
        files: [
          {
            key: "sections/safe-carousel.liquid",
            value: `
<style>
  #shopify-section-{{ section.id }} .cards {
    display: grid;
    gap: 16px;
  }
</style>
<div class="cards">
  {% for block in section.blocks %}
    <article class="card" {{ block.shopify_attributes }}>
      {% if block.settings.image != blank %}
        {{ block.settings.image | image_url: width: 900 | image_tag }}
      {% else %}
        <div class="card__placeholder" aria-hidden="true"></div>
      {% endif %}
    </article>
  {% endfor %}
</div>
{% schema %}
{
  "name": "Safe carousel",
  "blocks": [
    {
      "type": "card",
      "name": "Card",
      "settings": [
        { "type": "image_picker", "id": "image", "label": "Image" }
      ]
    }
  ],
  "presets": [
    {
      "name": "Safe carousel",
      "blocks": [
        { "type": "card" }
      ]
    }
  ]
}
{% endschema %}
`,
          },
        ],
      }),
      {
        shopifyClient: mockShopifyClient,
        tokenHash: "draft-handoff-only-read-enforcement",
      }
    );

    assert.equal(result.success, true);
    assert.equal(result.status, "preview_ready");
  } finally {
    global.fetch = previousFetch;
  }
});

test("draftThemeArtifact - rejects section block loops without block.shopify_attributes", async () => {
  const mockShopifyClient = {
    url: "https://unit-test.myshopify.com/admin/api/2026-01/graphql.json",
    requestConfig: {
      headers: new Headers({ "x-shopify-access-token": "fake-token" })
    },
    session: { shop: "unit-test.myshopify.com" },
    request: async () => {}
  };

  const result = await execute(
    draftThemeArtifact.schema.parse({
      mode: "create",
      themeId: 111,
      files: [
        {
          key: "sections/missing-block-attrs.liquid",
          value: `
<style>
  #shopify-section-{{ section.id }} .cards {
    display: grid;
    gap: 16px;
  }
</style>
<div class="cards">
  {% for block in section.blocks %}
    <article class="card">
      <h3>{{ block.settings.title }}</h3>
    </article>
  {% endfor %}
</div>
{% schema %}
{
  "name": "Missing block attrs",
  "settings": [
    { "type": "color", "id": "accent", "label": "Accent", "default": "#111111" }
  ],
  "blocks": [
    {
      "type": "card",
      "name": "Card",
      "settings": [
        { "type": "text", "id": "title", "label": "Title", "default": "Card title" }
      ]
    }
  ],
  "presets": [
    {
      "name": "Missing block attrs",
      "blocks": [
        { "type": "card" }
      ]
    }
  ]
}
{% endschema %}
`,
        },
      ],
    }),
    { shopifyClient: mockShopifyClient }
  );

  assert.equal(result.success, false);
  assert.equal(result.status, "inspection_failed");
  assert.ok(
    result.errors?.some(
      (issue) => issue.issueCode === "inspection_failed_block_shopify_attributes"
    )
  );
});

test("draftThemeArtifact - requires block.shopify_attributes inside the actual section.blocks loop", async () => {
  const mockShopifyClient = {
    url: "https://unit-test.myshopify.com/admin/api/2026-01/graphql.json",
    requestConfig: {
      headers: new Headers({ "x-shopify-access-token": "fake-token" })
    },
    session: { shop: "unit-test.myshopify.com" },
    request: async () => {}
  };

  const result = await execute(
    draftThemeArtifact.schema.parse({
      mode: "create",
      themeId: 111,
      files: [
        {
          key: "sections/block-attrs-outside-loop.liquid",
          value: `
<style>
  #shopify-section-{{ section.id }} .cards {
    display: grid;
    gap: 16px;
    padding: 24px;
    border-radius: 18px;
  }
  @media screen and (max-width: 749px) {
    #shopify-section-{{ section.id }} .cards { padding: 16px; }
  }
</style>
<div class="cards">
  <span class="cards__editor-anchor" {{ block.shopify_attributes }}></span>
  {% for block in section.blocks %}
    <article class="card">
      <h3>{{ block.settings.title }}</h3>
    </article>
  {% endfor %}
</div>
{% schema %}
{
  "name": "Attrs outside loop",
  "settings": [
    { "type": "color", "id": "accent", "label": "Accent", "default": "#111111" }
  ],
  "blocks": [
    {
      "type": "card",
      "name": "Card",
      "settings": [
        { "type": "text", "id": "title", "label": "Title", "default": "Card title" }
      ]
    }
  ],
  "presets": [{ "name": "Attrs outside loop", "blocks": [{ "type": "card" }] }]
}
{% endschema %}
`,
        },
      ],
    }),
    { shopifyClient: mockShopifyClient }
  );

  assert.equal(result.success, false);
  assert.equal(result.status, "inspection_failed");
  assert.ok(
    result.errors?.some(
      (issue) => issue.issueCode === "inspection_failed_block_shopify_attributes"
    ),
    "an attribute outside the loop must not satisfy the block wrapper contract"
  );
  assert.match(result.message, /binnen de loop-body|section\.blocks/i);
});

test("draftThemeArtifact - allows unrelated legacy patch edits when optional resource issues already existed", async () => {
  const mockShopifyClient = {
    url: "https://unit-test.myshopify.com/admin/api/2026-01/graphql.json",
    requestConfig: {
      headers: new Headers({ "x-shopify-access-token": "fake-token" })
    },
    session: { shop: "unit-test.myshopify.com" },
    request: async () => {}
  };

  const originalSection = `
<section class="legacy-hero">
  {{ section.settings.image | image_url: width: 1200 | image_tag }}
  <h2>{{ section.settings.heading }}</h2>
</section>

{% schema %}
{
  "name": "Legacy hero",
  "settings": [
    { "type": "image_picker", "id": "image", "label": "Image" },
    { "type": "text", "id": "heading", "label": "Heading", "default": "Hello" }
  ],
  "presets": [{ "name": "Legacy hero" }]
}
{% endschema %}
`;

  const themeMock = createThemeFileFetchMock({
    key: "sections/legacy-hero.liquid",
    initialValue: originalSection,
  });
  const previousFetch = global.fetch;
  global.fetch = themeMock.handler;

  try {
    const result = await execute(
      draftThemeArtifact.schema.parse({
        mode: "edit",
        themeId: 111,
        files: [
          {
            key: "sections/legacy-hero.liquid",
            patch: {
              searchString: "\"default\": \"Hello\"",
              replaceString: "\"default\": \"Hallo\"",
            },
          },
        ],
      }),
      { shopifyClient: mockShopifyClient }
    );

    assert.equal(result.success, true);
    assert.equal(result.status, "preview_ready");
    assert.match(themeMock.getValue(), /"default": "Hallo"/);
  } finally {
    global.fetch = previousFetch;
  }
});

test("draftThemeArtifact - accepts long guarded optional media branches in create mode", async () => {
  const mockShopifyClient = {
    url: "https://unit-test.myshopify.com/admin/api/2026-01/graphql.json",
    requestConfig: {
      headers: new Headers({ "x-shopify-access-token": "fake-token" })
    },
    session: { shop: "unit-test.myshopify.com" },
    request: async () => {}
  };

  const filler = "guarded branch copy ".repeat(90);
  const themeMock = createThemeFileFetchMock({
    key: "sections/long-guard-carousel.liquid",
    initialValue: "",
    existing: false,
  });
  const previousFetch = global.fetch;
  global.fetch = themeMock.handler;

  try {
    const result = await execute(
      draftThemeArtifact.schema.parse({
        mode: "create",
        themeId: 111,
        files: [
          {
            key: "sections/long-guard-carousel.liquid",
            value: `
<style>
  #shopify-section-{{ section.id }} .cards {
    display: grid;
    gap: 16px;
  }
</style>
<div class="cards">
  {% for block in section.blocks %}
    <article class="card" {{ block.shopify_attributes }}>
      {% if block.settings.image != blank %}
        <div class="card__copy">${filler}</div>
        {{ block.settings.image | image_url: width: 900 | image_tag }}
      {% else %}
        <div class="card__placeholder" aria-hidden="true"></div>
      {% endif %}
    </article>
  {% endfor %}
</div>
{% schema %}
{
  "name": "Long guard carousel",
  "blocks": [
    {
      "type": "card",
      "name": "Card",
      "settings": [
        { "type": "image_picker", "id": "image", "label": "Image" }
      ]
    }
  ],
  "presets": [
    {
      "name": "Long guard carousel",
      "blocks": [{ "type": "card" }]
    }
  ]
}
{% endschema %}
`,
          },
        ],
      }),
      { shopifyClient: mockShopifyClient }
    );

    assert.equal(result.success, true);
    assert.equal(result.status, "preview_ready");
  } finally {
    global.fetch = previousFetch;
  }
});

test("draftThemeArtifact - rejects aliased optional section images without a guard", async () => {
  const mockShopifyClient = {
    url: "https://unit-test.myshopify.com/admin/api/2026-01/graphql.json",
    requestConfig: {
      headers: new Headers({ "x-shopify-access-token": "fake-token" })
    },
    session: { shop: "unit-test.myshopify.com" },
    request: async () => {}
  };

  const result = await execute(
    draftThemeArtifact.schema.parse({
      mode: "create",
      themeId: 111,
      files: [
        {
          key: "sections/aliased-unsafe-image.liquid",
          value: `
<section class="hero">
  {% assign hero_image = section.settings.image %}
  {{ hero_image | image_url: width: 1200 | image_tag }}
</section>
{% schema %}
{
  "name": "Aliased unsafe image",
  "settings": [
    { "type": "image_picker", "id": "image", "label": "Image" }
  ],
  "presets": [{ "name": "Aliased unsafe image" }]
}
{% endschema %}
`,
        },
      ],
    }),
    { shopifyClient: mockShopifyClient }
  );

  assert.equal(result.success, false);
  assert.equal(result.status, "inspection_failed");
  assert.ok(
    result.errors?.some(
      (issue) => issue.issueCode === "inspection_failed_unguarded_optional_resource"
    )
  );
});

test("draftThemeArtifact - accepts aliased optional section images when guarded", async () => {
  const mockShopifyClient = {
    url: "https://unit-test.myshopify.com/admin/api/2026-01/graphql.json",
    requestConfig: {
      headers: new Headers({ "x-shopify-access-token": "fake-token" })
    },
    session: { shop: "unit-test.myshopify.com" },
    request: async () => {}
  };

  const themeMock = createThemeFileFetchMock({
    key: "sections/aliased-safe-image.liquid",
    initialValue: "",
    existing: false,
  });
  const previousFetch = global.fetch;
  global.fetch = themeMock.handler;

  try {
    const result = await execute(
      draftThemeArtifact.schema.parse({
        mode: "create",
        themeId: 111,
        files: [
          {
            key: "sections/aliased-safe-image.liquid",
            value: `
<section class="hero">
  {% assign hero_image = section.settings.image %}
  {% if hero_image != blank %}
    {{ hero_image | image_url: width: 1200 | image_tag }}
  {% else %}
    <div class="hero__placeholder" aria-hidden="true"></div>
  {% endif %}
</section>
{% schema %}
{
  "name": "Aliased safe image",
  "settings": [
    { "type": "image_picker", "id": "image", "label": "Image" }
  ],
  "presets": [{ "name": "Aliased safe image" }]
}
{% endschema %}
`,
          },
        ],
      }),
      { shopifyClient: mockShopifyClient }
    );

    assert.equal(result.success, true);
    assert.equal(result.status, "preview_ready");
  } finally {
    global.fetch = previousFetch;
  }
});

test("draftThemeArtifact - rejects unguarded optional section images in edit mode", async () => {
  const mockShopifyClient = {
    url: "https://unit-test.myshopify.com/admin/api/2026-01/graphql.json",
    requestConfig: {
      headers: new Headers({ "x-shopify-access-token": "fake-token" })
    },
    session: { shop: "unit-test.myshopify.com" },
    request: async () => {}
  };

  const originalHero = `
<style>
  #shopify-section-{{ section.id }} .hero {
    display: grid;
    gap: 24px;
  }
</style>
<section class="hero">
  {% if section.settings.image != blank %}
    {{ section.settings.image | image_url: width: 1200 | image_tag }}
  {% endif %}
</section>
{% schema %}
{
  "name": "Hero",
  "settings": [
    { "type": "image_picker", "id": "image", "label": "Image" }
  ],
  "presets": [{ "name": "Hero" }]
}
{% endschema %}
`;

  const themeMock = createThemeFileFetchMock({
    key: "sections/hero.liquid",
    initialValue: originalHero,
  });
  const previousFetch = global.fetch;
  global.fetch = themeMock.handler;

  try {
    const result = await execute(
      draftThemeArtifact.schema.parse({
        mode: "edit",
        themeId: 111,
        files: [
          {
            key: "sections/hero.liquid",
            value: `
<style>
  #shopify-section-{{ section.id }} .hero {
    display: grid;
    gap: 24px;
  }
</style>
<section class="hero">
  {{ section.settings.image | image_url: width: 1200 | image_tag }}
</section>
{% schema %}
{
  "name": "Hero",
  "settings": [
    { "type": "image_picker", "id": "image", "label": "Image" }
  ],
  "presets": [{ "name": "Hero" }]
}
{% endschema %}
`,
          },
        ],
      }),
      { shopifyClient: mockShopifyClient }
    );

    assert.equal(result.success, false);
    assert.equal(result.status, "inspection_failed");
    assert.ok(
      result.errors?.some(
        (issue) => issue.issueCode === "inspection_failed_unguarded_optional_resource"
      )
    );
  } finally {
    global.fetch = previousFetch;
  }
});

test("draftThemeArtifact - rejects unguarded optional media in theme blocks", async () => {
  const mockShopifyClient = {
    url: "https://unit-test.myshopify.com/admin/api/2026-01/graphql.json",
    requestConfig: {
      headers: new Headers({ "x-shopify-access-token": "fake-token" })
    },
    session: { shop: "unit-test.myshopify.com" },
    request: async () => {}
  };

  const result = await execute(
    draftThemeArtifact.schema.parse({
      mode: "create",
      themeId: 111,
      files: [
        {
          key: "blocks/media-card.liquid",
          value: `
{% doc %}
  @param {image} image
{% enddoc %}
<article class="media-card">
  {{ block.settings.image | image_url: width: 900 | image_tag }}
</article>
{% schema %}
{
  "name": "Media card",
  "settings": [
    { "type": "image_picker", "id": "image", "label": "Image" }
  ]
}
{% endschema %}
`,
        },
      ],
    }),
    { shopifyClient: mockShopifyClient }
  );

  assert.equal(result.success, false);
  assert.equal(result.status, "inspection_failed");
  assert.ok(
    result.errors?.some(
      (issue) => issue.issueCode === "inspection_failed_unguarded_optional_resource"
    )
  );
});

test("draftThemeArtifact - rejects theme blocks without block.shopify_attributes on the block wrapper", async () => {
  const mockShopifyClient = {
    url: "https://unit-test.myshopify.com/admin/api/2026-01/graphql.json",
    requestConfig: {
      headers: new Headers({ "x-shopify-access-token": "fake-token" })
    },
    session: { shop: "unit-test.myshopify.com" },
    request: async () => {}
  };

  const result = await execute(
    draftThemeArtifact.schema.parse({
      mode: "create",
      themeId: 111,
      files: [
        {
          key: "blocks/review-badge.liquid",
          value: `
{% doc %}
  @param {string} label
{% enddoc %}
<div class="review-badge">
  {{ block.settings.label }}
</div>
{% schema %}
{
  "name": "Review badge",
  "settings": [
    { "type": "text", "id": "label", "label": "Label", "default": "4.9/5 verified" }
  ]
}
{% endschema %}
`,
        },
      ],
    }),
    { shopifyClient: mockShopifyClient }
  );

  assert.equal(result.success, false);
  assert.ok(
    result.errors?.some(
      (issue) => issue.issueCode === "inspection_failed_block_shopify_attributes"
    )
  );
});

test("draftThemeArtifact - rejects incomplete theme blocks without renderable block markup", async () => {
  const mockShopifyClient = {
    url: "https://unit-test.myshopify.com/admin/api/2026-01/graphql.json",
    requestConfig: {
      headers: new Headers({ "x-shopify-access-token": "fake-token" })
    },
    session: { shop: "unit-test.myshopify.com" },
    request: async () => {}
  };

  const result = await execute(
    draftThemeArtifact.schema.parse({
      mode: "create",
      themeId: 111,
      files: [
        {
          key: "blocks/review-badge-empty.liquid",
          value: `
{% doc %}
  @param {string} label
{% enddoc %}
{% schema %}
{
  "name": "Review badge empty",
  "settings": [
    { "type": "text", "id": "label", "label": "Label", "default": "4.9/5 verified" }
  ]
}
{% endschema %}
`,
        },
      ],
    }),
    { shopifyClient: mockShopifyClient }
  );

  assert.equal(result.success, false);
  assert.ok(
    result.errors?.some((issue) => issue.issueCode === "inspection_failed_incomplete_block")
  );
});

test("draftThemeArtifact - rejects sections without presets", async () => {
  const mockShopifyClient = {
    url: "https://unit-test.myshopify.com/admin/api/2026-01/graphql.json",
    requestConfig: {
      headers: new Headers({ "x-shopify-access-token": "fake-token" })
    },
    session: { shop: "unit-test.myshopify.com" },
    request: async () => {}
  };

  const result = await execute(
    draftThemeArtifact.schema.parse({
      mode: "create",
      themeId: 111,
      files: [
        {
          key: "sections/no-presets.liquid",
          value: `
<style>
  #shopify-section-{{ section.id }} .demo {
    display: grid;
    gap: 24px;
  }

  @media screen and (max-width: 749px) {
    #shopify-section-{{ section.id }} .demo {
      gap: 16px;
    }
  }
</style>
<div class="demo">{{ section.settings.heading }}</div>
{% schema %}
{
  "name": "No presets",
  "settings": [
    { "type": "text", "id": "heading", "label": "Heading", "default": "Hello" },
    { "type": "range", "id": "gap", "label": "Gap", "min": 0, "max": 40, "step": 4, "default": 16 },
    { "type": "color", "id": "accent", "label": "Accent", "default": "#111111" }
  ]
}
{% endschema %}
`,
        },
      ],
    }),
    { shopifyClient: mockShopifyClient }
  );

  assert.equal(result.success, false);
  assert.equal(result.errorCode, "inspection_failed_schema");
  assert.ok(result.suggestedFixes.some((entry) => entry.includes("preset")));
});

test("draftThemeArtifact - blocks create mode when the target key already exists and suggests alternates", async () => {
  const mockShopifyClient = {
    url: "https://unit-test.myshopify.com/admin/api/2026-01/graphql.json",
    requestConfig: {
      headers: new Headers({ "x-shopify-access-token": "fake-token" })
    },
    session: { shop: "unit-test.myshopify.com" },
    request: async () => {}
  };

  const themeMock = createThemeFileFetchMock({
    key: "sections/existing-section.liquid",
    initialValue: goodSectionLiquid,
  });
  const previousFetch = global.fetch;
  global.fetch = themeMock.handler;

  try {
    const result = await execute(
      draftThemeArtifact.schema.parse({
        themeId: 111,
        mode: "create",
        files: [
          {
            key: "sections/existing-section.liquid",
            value: goodSectionLiquid.replace("Test section", "Replacement section"),
          },
        ],
      }),
      { shopifyClient: mockShopifyClient }
    );

    assert.equal(result.success, false);
    assert.equal(result.status, "inspection_failed");
    assert.equal(result.errorCode, "existing_create_key_conflict");
    assert.equal(result.nextAction, "choose_edit_or_new_key");
    assert.ok(
      result.newFileSuggestions?.includes("sections/existing-section-v2.liquid"),
      "create conflicts should suggest an alternate file key"
    );
    assert.equal(
      result.nextArgsTemplate?.files?.[0]?.key,
      "sections/existing-section-v2.liquid"
    );
  } finally {
    global.fetch = previousFetch;
  }
});

test("draftThemeArtifact - aggregates multiple local create validation issues in one response", async () => {
  const mockShopifyClient = {
    url: "https://unit-test.myshopify.com/admin/api/2026-01/graphql.json",
    requestConfig: {
      headers: new Headers({ "x-shopify-access-token": "fake-token" })
    },
    session: { shop: "unit-test.myshopify.com" },
    request: async () => {}
  };

  const result = await execute(
    draftThemeArtifact.schema.parse({
      mode: "create",
      themeId: 111,
      files: [
        {
          key: "sections/multi-issue-section.liquid",
          value: `
{% schema %}
{
  "name": "Multi issue section",
  "settings": [
    { "type": "range", "id": "card_height", "label": "Card height", "min": 0, "max": 220, "step": 2, "default": 6 },
    { "type": "range", "id": "visible_cards_mobile", "label": "Visible cards mobile", "min": 1, "max": 2, "step": 1, "default": 1 }
  ]
}
{% endschema %}
`,
        },
      ],
    }),
    { shopifyClient: mockShopifyClient }
  );

  assert.equal(result.success, false);
  assert.equal(result.errorCode, "inspection_failed_multiple");
  assert.ok(Array.isArray(result.errors) && result.errors.length >= 3);
  assert.ok(
    result.errors.some((issue) => issue.problem.includes("presets")),
    "aggregated inspection should include the missing presets failure"
  );
  assert.ok(
    result.errors.some((issue) => issue.problem.includes("renderbare markup")),
    "aggregated inspection should include the missing renderable markup failure"
  );
  assert.ok(
    result.errors.some((issue) => issue.problem.includes("card_height")),
    "aggregated inspection should include the oversized range failure"
  );
  assert.ok(
    result.preferSelectFor?.some((entry) => JSON.stringify(entry.path).includes("visible_cards_mobile")),
    "aggregated inspection should flag tiny discrete ranges for select conversion"
  );
  assert.ok(
    result.suggestedSchemaRewrites?.some((entry) => entry.suggestedType === "select"),
    "aggregated inspection should include schema rewrite suggestions"
  );
});

test("draftThemeArtifact - rejects blocks without a schema block in create mode", async () => {
  const mockShopifyClient = {
    url: "https://unit-test.myshopify.com/admin/api/2026-01/graphql.json",
    requestConfig: {
      headers: new Headers({ "x-shopify-access-token": "fake-token" })
    },
    session: { shop: "unit-test.myshopify.com" },
    request: async () => {}
  };

  const result = await execute(
    draftThemeArtifact.schema.parse({
      themeId: 111,
      mode: "create",
      files: [
        {
          key: "blocks/stock-pulse.liquid",
          value: `<div class="stock-pulse">In stock</div>`,
        },
      ],
    }),
    { shopifyClient: mockShopifyClient }
  );

  assert.equal(result.success, false);
  assert.equal(result.errorCode, "inspection_failed_schema");
  assert.match(result.message, /blocks\/\*\.liquid/i);
});

test("draftThemeArtifact - allows @app section blocks without a name during native block edits", async () => {
  const mockShopifyClient = {
    url: "https://unit-test.myshopify.com/admin/api/2026-01/graphql.json",
    requestConfig: {
      headers: new Headers({ "x-shopify-access-token": "fake-token" })
    },
    session: { shop: "unit-test.myshopify.com" },
    request: async () => {}
  };

  const previousFetch = global.fetch;
  global.fetch = createThemeFilesFetchMock({
    files: {
      "sections/main-product.liquid": `
{% render 'product-info', product: product, section: section %}
{% schema %}
{
  "name": "Main product",
  "blocks": [
    { "type": "text", "name": "Text" },
    { "type": "buy_buttons", "name": "Buy buttons" },
    { "type": "@app" }
  ]
}
{% endschema %}
`,
      "snippets/product-info.liquid": `
{% for block in section.blocks %}
  <div class="product-info__block" {{ block.shopify_attributes }}>
    {% case block.type %}
      {% when 'text' %}
        <p>{{ product.title }}</p>
      {% when 'buy_buttons' %}
        <button>Add to cart</button>
      {% when 'review_badge' %}
        <div class="review-badge">{{ block.settings.label }}</div>
    {% endcase %}
  </div>
{% endfor %}
`,
    },
  });

  try {
    const result = await execute(
      draftThemeArtifact.schema.parse({
        themeId: 111,
        mode: "edit",
        plannerHandoff: {
          intent: "native_block",
          themeTarget: { themeId: 111, themeRole: null },
          requiredReadKeys: ["sections/main-product.liquid", "snippets/product-info.liquid"],
          nextWriteKeys: ["sections/main-product.liquid", "snippets/product-info.liquid"],
          architecture: {
            primarySectionFile: "sections/main-product.liquid",
            usesThemeBlocks: false,
            snippetRendererKeys: ["snippets/product-info.liquid"],
            hasBlockShopifyAttributes: true,
          },
        },
        files: [
          {
            key: "sections/main-product.liquid",
            value: `
{% render 'product-info', product: product, section: section %}
{% schema %}
{
  "name": "Main product",
  "blocks": [
    { "type": "text", "name": "Text" },
    { "type": "buy_buttons", "name": "Buy buttons" },
    {
      "type": "review_badge",
      "name": "Review badge",
      "settings": [
        { "type": "text", "id": "label", "label": "Label", "default": "4.9/5 verified" }
      ]
    },
    { "type": "@app" }
  ]
}
{% endschema %}
`,
          },
          {
            key: "snippets/product-info.liquid",
            value: `
{% for block in section.blocks %}
  <div class="product-info__block" {{ block.shopify_attributes }}>
    {% case block.type %}
      {% when 'text' %}
        <p>{{ product.title }}</p>
      {% when 'buy_buttons' %}
        <button>Add to cart</button>
      {% when 'review_badge' %}
        <div class="review-badge">{{ block.settings.label }}</div>
    {% endcase %}
  </div>
{% endfor %}
`,
          },
        ],
      }),
      { shopifyClient: mockShopifyClient, tokenHash: "native-block-app-blocks" }
    );

    assert.equal(result.success, true);
    assert.equal(result.status, "preview_ready");
  } finally {
    global.fetch = previousFetch;
  }
});

test("draftThemeArtifact - rejects range settings whose default falls outside min/max before preview upload", async () => {
  const mockShopifyClient = {
    url: "https://unit-test.myshopify.com/admin/api/2026-01/graphql.json",
    requestConfig: {
      headers: new Headers({ "x-shopify-access-token": "fake-token" })
    },
    session: { shop: "unit-test.myshopify.com" },
    request: async () => {}
  };

  const result = await execute(
    draftThemeArtifact.schema.parse({
      mode: "create",
      themeId: 111,
      files: [
        {
          key: "sections/invalid-range.liquid",
          value: `
<style>
  #shopify-section-{{ section.id }} .demo {
    display: grid;
    gap: 24px;
  }

  @media screen and (max-width: 749px) {
    #shopify-section-{{ section.id }} .demo {
      gap: 16px;
    }
  }
</style>
<div class="demo">{{ section.settings.heading }}</div>
{% schema %}
{
  "name": "Invalid range",
  "settings": [
    { "type": "text", "id": "heading", "label": "Heading", "default": "Hello" },
    { "type": "range", "id": "padding_top", "label": "Padding top", "min": 40, "max": 180, "step": 4, "default": 36 },
    { "type": "color", "id": "accent", "label": "Accent", "default": "#111111" }
  ],
  "presets": [{ "name": "Invalid range" }]
}
{% endschema %}
`,
        },
      ],
    }),
    { shopifyClient: mockShopifyClient }
  );

  assert.equal(result.success, false);
  assert.equal(result.errorCode, "inspection_failed_schema_range");
  assert.match(result.message, /default 36/i);
  assert.match(result.message, /min 40/i);
});

test("draftThemeArtifact - rejects range settings whose default is not aligned to the declared step", async () => {
  const mockShopifyClient = {
    url: "https://unit-test.myshopify.com/admin/api/2026-01/graphql.json",
    requestConfig: {
      headers: new Headers({ "x-shopify-access-token": "fake-token" })
    },
    session: { shop: "unit-test.myshopify.com" },
    request: async () => {}
  };

  const result = await execute(
    draftThemeArtifact.schema.parse({
      mode: "create",
      themeId: 111,
      files: [
        {
          key: "sections/invalid-step-grid.liquid",
          value: `
<style>
  #shopify-section-{{ section.id }} .demo {
    display: grid;
    gap: 24px;
  }

  @media screen and (max-width: 749px) {
    #shopify-section-{{ section.id }} .demo {
      gap: 16px;
    }
  }
</style>
<div class="demo">{{ section.settings.heading }}</div>
{% schema %}
{
  "name": "Invalid step grid",
  "settings": [
    { "type": "text", "id": "heading", "label": "Heading", "default": "Hello" },
    { "type": "range", "id": "padding_top", "label": "Padding top", "min": 0, "max": 100, "step": 8, "default": 10 },
    { "type": "color", "id": "accent", "label": "Accent", "default": "#111111" }
  ],
  "presets": [{ "name": "Invalid step grid" }]
}
{% endschema %}
`,
        },
      ],
    }),
    { shopifyClient: mockShopifyClient }
  );

  assert.equal(result.success, false);
  assert.equal(result.errorCode, "inspection_failed_schema_range");
  assert.match(result.message, /step/i);
  assert.match(result.message, /padding_top/i);
  assert.equal(result.errors?.[0]?.suggestedReplacement?.default, 8);
  assert.deepEqual(result.errors?.[0]?.suggestedReplacement?.validDefaultCandidates, [8, 16]);
});

test("draftThemeArtifact - bundles local range issues and liquid lint errors into one preflight response", async () => {
  const mockShopifyClient = {
    url: "https://unit-test.myshopify.com/admin/api/2026-01/graphql.json",
    requestConfig: {
      headers: new Headers({ "x-shopify-access-token": "fake-token" })
    },
    session: { shop: "unit-test.myshopify.com" },
    request: async () => {}
  };

  const result = await execute(
    draftThemeArtifact.schema.parse({
      mode: "create",
      themeId: 111,
      files: [
        {
          key: "sections/combined-preflight-failure.liquid",
          value: `
<div class="demo">{{ section.settings.heading </div>
{% schema %}
{
  "name": "Combined preflight failure",
  "settings": [
    { "type": "text", "id": "heading", "label": "Heading", "default": "Hello" },
    { "type": "range", "id": "padding_top", "label": "Padding top", "min": 40, "max": 180, "step": 4, "default": 90 },
    { "type": "color", "id": "accent", "label": "Accent", "default": "#111111" }
  ],
  "presets": [{ "name": "Combined preflight failure" }]
}
{% endschema %}
`,
        },
      ],
    }),
    { shopifyClient: mockShopifyClient }
  );

  assert.equal(result.success, false);
  assert.equal(result.status, "inspection_failed");
  assert.equal(result.errorCode, "inspection_failed_multiple");
  assert.equal(result.nextAction, "fix_local_preflight");
  assert.ok(
    result.errors?.some((issue) => issue.issueCode === "inspection_failed_schema_range"),
    "range inspection issue should be present"
  );
  assert.ok(
    result.errors?.some((issue) => issue.issueCode === "lint_failed_liquid_syntax"),
    "lint syntax issue should be present in the same preflight response"
  );
  assert.ok(
    result.lintIssues?.some((issue) => issue.check === "LiquidHTMLSyntaxError"),
    "typed lint issues should be exposed separately"
  );
});

test("draftThemeArtifact - rejects hero-scale typography when theme context says the section should stay content-sized", async () => {
  const mockShopifyClient = {
    url: "https://unit-test.myshopify.com/admin/api/2026-01/graphql.json",
    requestConfig: {
      headers: new Headers({ "x-shopify-access-token": "fake-token" }),
    },
    session: { shop: "unit-test.myshopify.com" },
    request: async () => {},
  };

  const result = await execute(
    draftThemeArtifact.schema.parse({
      mode: "create",
      themeId: 111,
      files: [
        {
          key: "sections/oversized-content-section.liquid",
          value: `
<style>
  .oversized-content .title {
    font-size: 5.6rem;
  }

  .oversized-content .card {
    display: grid;
    gap: 24px;
    padding: 32px;
  }
</style>
<section class="oversized-content">
  <div class="card">
    <h2 class="title">{{ section.settings.heading }}</h2>
  </div>
</section>
{% schema %}
{
  "name": "Oversized content section",
  "settings": [
    { "type": "text", "id": "heading", "label": "Heading", "default": "Hello" }
  ],
  "presets": [{ "name": "Oversized content section" }]
}
{% endschema %}
`,
        },
      ],
    }),
    {
      shopifyClient: mockShopifyClient,
      themeSectionContext: {
        representativeSection: {
          key: "sections/testimonials.liquid",
          type: "testimonials",
        },
        usesPageWidth: true,
        usesRte: false,
        scaleGuide: {
          maxExplicitFontSizePx: 40,
          maxExplicitPaddingYPx: 64,
          maxGapPx: 24,
          maxMinHeightPx: null,
          maxSpacingSettingDefaultPx: 36,
        },
        spacingSettings: [
          {
            id: "padding_top",
            type: "range",
            default: 36,
            min: 0,
            max: 80,
            step: 4,
          },
        ],
        guardrails: [
          "Gebruik de page-width wrapper van het doeltheme voor gewone content sections.",
        ],
      },
    }
  );

  assert.equal(result.success, false);
  assert.ok(
    ["inspection_failed_theme_scale", "inspection_failed_multiple"].includes(
      result.errorCode
    )
  );
  assert.ok(
    result.errors?.some((issue) => issue.issueCode === "inspection_failed_theme_scale"),
    "theme-scale diagnostics should be returned when the generated section is much larger than the target theme convention"
  );
  assert.equal(
    result.themeContext?.representativeSection?.key,
    "sections/testimonials.liquid"
  );
});

test("draftThemeArtifact - rejects content sections whose combined scale pressure is too large for the theme", async () => {
  const mockShopifyClient = {
    url: "https://unit-test.myshopify.com/admin/api/2026-01/graphql.json",
    requestConfig: {
      headers: new Headers({ "x-shopify-access-token": "fake-token" }),
    },
    session: { shop: "unit-test.myshopify.com" },
    request: async () => {},
  };

  const result = await execute(
    draftThemeArtifact.schema.parse({
      mode: "create",
      themeId: 111,
      files: [
        {
          key: "sections/review-wall-composite-scale.liquid",
          value: `
<style>
  .review-wall-composite {
    display: grid;
    gap: 52px;
    padding: 84px 32px;
  }

  .review-wall-composite__intro {
    position: sticky;
    top: 40px;
  }

  .review-wall-composite__title {
    font-size: 56px;
    line-height: 0.98;
  }

  .review-wall-composite__card {
    display: grid;
    gap: 28px;
    padding: 42px;
    border-radius: 30px;
    background: #ffffff;
  }
</style>
<section class="review-wall-composite">
  <div class="review-wall-composite__intro">
    <h2 class="review-wall-composite__title">{{ section.settings.heading }}</h2>
  </div>
  <article class="review-wall-composite__card">
    <p>{{ section.settings.body }}</p>
  </article>
</section>
{% schema %}
{
  "name": "Review wall composite scale",
  "settings": [
    { "type": "text", "id": "heading", "label": "Heading", "default": "Wat zeggen klanten?" },
    { "type": "textarea", "id": "body", "label": "Body", "default": "Goede communicatie en snelle levering." }
  ],
  "presets": [{ "name": "Review wall composite scale" }]
}
{% endschema %}
`,
        },
      ],
    }),
    {
      shopifyClient: mockShopifyClient,
      themeSectionContext: {
        representativeSection: {
          key: "sections/testimonials.liquid",
          type: "testimonials",
        },
        usesPageWidth: true,
        usesSectionPropertiesWrapper: true,
        usesRte: false,
        scaleGuide: {
          maxExplicitFontSizePx: 42,
          maxExplicitPaddingYPx: 48,
          maxGapPx: 28,
          maxMinHeightPx: null,
          maxSpacingSettingDefaultPx: 36,
        },
        spacingSettings: [
          {
            id: "padding_top",
            type: "range",
            default: 36,
            min: 0,
            max: 80,
            step: 4,
          },
        ],
        guardrails: [
          "Gebruik de page-width wrapper van het doeltheme voor gewone content sections.",
        ],
      },
    }
  );

  assert.equal(result.success, false);
  assert.ok(
    ["inspection_failed_theme_scale", "inspection_failed_multiple"].includes(
      result.errorCode
    )
  );
  assert.ok(
    result.errors?.some(
      (issue) =>
        issue.issueCode === "inspection_failed_theme_scale" &&
        issue.problem.includes("stapelt meerdere middelgrote schaalafwijkingen")
    ),
    "composite scale pressure should fail even when no single metric crosses the old hard limit"
  );
  assert.ok(
    result.warnings?.some((warning) => warning.includes("page-width wrapper")),
    "missing wrapper mirroring should still surface as a warning alongside the composite scale failure"
  );
  assert.ok(
    result.suggestedFixes?.some((entry) => entry.includes("wrapper/surface-strategie")),
    "composite scale diagnostics should explain how to reduce the overall visual mass"
  );
  assert.equal(
    result.themeContext?.representativeSection?.key,
    "sections/testimonials.liquid"
  );
});

test("draftThemeArtifact - rejects JS template interpolation that mixes Liquid and JavaScript", async () => {
  const mockShopifyClient = {
    url: "https://unit-test.myshopify.com/admin/api/2026-01/graphql.json",
    requestConfig: {
      headers: new Headers({ "x-shopify-access-token": "fake-token" }),
    },
    session: { shop: "unit-test.myshopify.com" },
    request: async () => {},
  };

  const result = await execute(
    draftThemeArtifact.schema.parse({
      mode: "create",
      themeId: 111,
      files: [
        {
          key: "sections/testimonial-slider-v2.liquid",
          value: `
<style>
  #shopify-section-{{ section.id }} .slider {
    display: grid;
  }
</style>
<section class="slider" data-section-id="{{ section.id }}">
  <div class="track">{{ section.settings.heading }}</div>
</section>
<script>
  const i = 1;
  const track = document.getElementById('shopify-section-{{ section.id }}');
  track.style.transform = \`translateX(-\${i{{ section.id }} * 340}px)\`;
</script>
{% schema %}
{
  "name": "Testimonial slider",
  "settings": [
    { "type": "text", "id": "heading", "label": "Heading", "default": "Hello" }
  ],
  "presets": [{ "name": "Testimonial slider" }]
}
{% endschema %}
`,
        },
      ],
    }),
    { shopifyClient: mockShopifyClient }
  );

  assert.equal(result.success, false);
  assert.equal(result.status, "inspection_failed");
  assert.ok(
    result.errors?.some(
      (issue) => issue.issueCode === "inspection_failed_js_liquid_interpolation"
    ),
    "parser-unsafe JS/Liquid interpolation should be caught in local preflight"
  );
  assert.equal(result.nextAction, "fix_local_validation");
});

test("draftThemeArtifact - rejects interactive JS that is not scoped per section instance", async () => {
  const mockShopifyClient = {
    url: "https://unit-test.myshopify.com/admin/api/2026-01/graphql.json",
    requestConfig: {
      headers: new Headers({ "x-shopify-access-token": "fake-token" }),
    },
    session: { shop: "unit-test.myshopify.com" },
    request: async () => {},
  };

  const result = await execute(
    draftThemeArtifact.schema.parse({
      mode: "create",
      themeId: 111,
      files: [
        {
          key: "sections/logo-carousel.liquid",
          value: `
<style>
  .logo-carousel {
    display: flex;
    gap: 24px;
  }
</style>
<section class="logo-carousel">
  <div class="logo-carousel__track">{{ section.settings.heading }}</div>
</section>
<script>
  const track = document.querySelector('.logo-carousel__track');
  track.classList.add('is-ready');
</script>
{% schema %}
{
  "name": "Logo carousel",
  "settings": [
    { "type": "text", "id": "heading", "label": "Heading", "default": "Trusted by" }
  ],
  "presets": [{ "name": "Logo carousel" }]
}
{% endschema %}
`,
        },
      ],
    }),
    { shopifyClient: mockShopifyClient }
  );

  assert.equal(result.success, false);
  assert.ok(
    result.errors?.some((issue) => issue.issueCode === "inspection_failed_unscoped_js"),
    "interactive sections should fail fast when global selectors are not scoped to the section"
  );
});

test("draftThemeArtifact - keeps hero-sized hero sections as warnings instead of theme-scale hard failures", async (t) => {
  const originalFetch = global.fetch;
  const fetchMock = createThemeFileFetchMock({
    key: "sections/hero-video.liquid",
    initialValue: goodSectionLiquid,
    existing: false,
  });
  global.fetch = fetchMock.handler;
  t.after(() => {
    global.fetch = originalFetch;
  });

  const mockShopifyClient = {
    url: "https://unit-test.myshopify.com/admin/api/2026-01/graphql.json",
    requestConfig: {
      headers: new Headers({ "x-shopify-access-token": "fake-token" }),
    },
    session: { shop: "unit-test.myshopify.com" },
    request: async () => {},
  };

  const result = await execute(
    draftThemeArtifact.schema.parse({
      mode: "create",
      themeId: 111,
      files: [
        {
          key: "sections/hero-video.liquid",
          value: `
<style>
  .hero-video .title {
    font-size: 5.6rem;
  }

  .hero-video {
    min-height: 720px;
    display: grid;
    gap: 32px;
  }
</style>
<section class="hero-video">
  <h2 class="title">{{ section.settings.heading }}</h2>
</section>
{% schema %}
{
  "name": "Hero video",
  "settings": [
    { "type": "text", "id": "heading", "label": "Heading", "default": "Hero headline" },
    { "type": "video", "id": "background_video", "label": "Background video" }
  ],
  "presets": [{ "name": "Hero video" }]
}
{% endschema %}
`,
        },
      ],
    }),
    {
      shopifyClient: mockShopifyClient,
      themeSectionContext: {
        representativeSection: {
          key: "sections/testimonials.liquid",
          type: "testimonials",
        },
        usesPageWidth: true,
        usesRte: false,
        scaleGuide: {
          maxExplicitFontSizePx: 40,
          maxExplicitPaddingYPx: 64,
          maxGapPx: 24,
          maxMinHeightPx: null,
          maxSpacingSettingDefaultPx: 36,
        },
        spacingSettings: [
          {
            id: "padding_top",
            type: "range",
            default: 36,
            min: 0,
            max: 80,
            step: 4,
          },
        ],
        guardrails: [
          "Gebruik de page-width wrapper van het doeltheme voor gewone content sections.",
        ],
      },
    }
  );

  assert.equal(result.success, true);
  assert.equal(result.status, "preview_ready");
  assert.ok(
    result.warnings?.some((entry) => entry.includes("hero-achtig")),
    "hero-like sections should downgrade oversizing to warnings instead of hard failures"
  );
});

test("draftThemeArtifact - rejects hosted video markup when schema only exposes video_url", async () => {
  const mockShopifyClient = {
    url: "https://unit-test.myshopify.com/admin/api/2026-01/graphql.json",
    requestConfig: {
      headers: new Headers({ "x-shopify-access-token": "fake-token" })
    },
    session: { shop: "unit-test.myshopify.com" },
    request: async () => {}
  };

  const result = await execute(
    draftThemeArtifact.schema.parse({
      mode: "create",
      themeId: 111,
      files: [
        {
          key: "sections/video-url-hosted-mismatch.liquid",
          value: `
<style>
  .hero-video {
    display: grid;
    gap: 24px;
  }
</style>
<section class="hero-video">
  <video class="hero-video__media" controls muted playsinline></video>
  <h2>{{ section.settings.heading }}</h2>
</section>
{% schema %}
{
  "name": "Video URL hosted mismatch",
  "settings": [
    { "type": "text", "id": "heading", "label": "Heading", "default": "Hero headline" },
    {
      "type": "video_url",
      "id": "video_url",
      "label": "External video",
      "accept": ["youtube", "vimeo"]
    }
  ],
  "presets": [{ "name": "Video URL hosted mismatch" }]
}
{% endschema %}
`,
        },
      ],
    }),
    { shopifyClient: mockShopifyClient }
  );

  assert.equal(result.success, false);
  assert.equal(result.status, "inspection_failed");
  assert.ok(
    result.errors?.some(
      (issue) => issue.issueCode === "inspection_failed_video_setting_mismatch"
    )
  );
});

test("draftThemeArtifact - allows external video_url embeds when no hosted video markup is used", async () => {
  const mockShopifyClient = {
    url: "https://unit-test.myshopify.com/admin/api/2026-01/graphql.json",
    requestConfig: {
      headers: new Headers({ "x-shopify-access-token": "fake-token" })
    },
    session: { shop: "unit-test.myshopify.com" },
    request: async () => {}
  };

  const themeMock = createThemeFileFetchMock({
    key: "sections/external-video-embed.liquid",
    initialValue: "",
    existing: false,
  });
  const previousFetch = global.fetch;
  global.fetch = themeMock.handler;

  try {
    const result = await execute(
      draftThemeArtifact.schema.parse({
        mode: "create",
        themeId: 111,
        files: [
          {
            key: "sections/external-video-embed.liquid",
            value: `
<style>
  .external-video {
    display: grid;
    gap: 24px;
  }
</style>
<section class="external-video">
  {% if section.settings.video_url != blank %}
    <iframe
      class="external-video__frame"
      src="https://www.youtube.com/embed/{{ section.settings.video_url.id }}"
      title="{{ section.settings.heading }}"
      loading="lazy"
      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
      allowfullscreen
    ></iframe>
  {% else %}
    <div class="external-video__placeholder" aria-hidden="true"></div>
  {% endif %}
  <h2>{{ section.settings.heading }}</h2>
</section>
{% schema %}
{
  "name": "External video embed",
  "settings": [
    { "type": "text", "id": "heading", "label": "Heading", "default": "Hero headline" },
    {
      "type": "video_url",
      "id": "video_url",
      "label": "External video",
      "accept": ["youtube", "vimeo"]
    }
  ],
  "presets": [{ "name": "External video embed" }]
}
{% endschema %}
`,
          },
        ],
      }),
      { shopifyClient: mockShopifyClient }
    );

    assert.equal(result.success, true);
    assert.equal(result.status, "preview_ready");
  } finally {
    global.fetch = previousFetch;
  }
});

test("draftThemeArtifact - rejects external video embeds in video sections without a video_url setting", async () => {
  const mockShopifyClient = {
    url: "https://unit-test.myshopify.com/admin/api/2026-01/graphql.json",
    requestConfig: {
      headers: new Headers({ "x-shopify-access-token": "fake-token" })
    },
    session: { shop: "unit-test.myshopify.com" },
    request: async () => {}
  };

  const result = await execute(
    draftThemeArtifact.schema.parse({
      mode: "create",
      themeId: 111,
      files: [
        {
          key: "sections/video-embed-mismatch.liquid",
          value: `
<section class="video-section">
  {% if section.settings.video != blank %}
    {{
      section.settings.video
      | external_video_url
      | external_video_tag: class: 'video-section__embed'
    }}
  {% endif %}
</section>
{% schema %}
{
  "name": "Video embed mismatch",
  "settings": [
    { "type": "video", "id": "video", "label": "Hosted video" }
  ],
  "presets": [{ "name": "Video embed mismatch" }]
}
{% endschema %}
`,
        },
      ],
    }),
    {
      shopifyClient: mockShopifyClient,
      sectionBlueprint: {
        archetype: "video_section",
      },
    }
  );

  assert.equal(result.success, false);
  assert.equal(result.status, "inspection_failed");
  assert.ok(
    result.errors?.some(
      (issue) => issue.issueCode === "inspection_failed_video_embed_setting_mismatch"
    )
  );
});

test("draftThemeArtifact - rejects range settings that exceed Shopify's step-count limit", async () => {
  const mockShopifyClient = {
    url: "https://unit-test.myshopify.com/admin/api/2026-01/graphql.json",
    requestConfig: {
      headers: new Headers({ "x-shopify-access-token": "fake-token" })
    },
    session: { shop: "unit-test.myshopify.com" },
    request: async () => {}
  };

  const result = await execute(
    draftThemeArtifact.schema.parse({
      mode: "create",
      themeId: 111,
      files: [
        {
          key: "sections/too-many-range-steps.liquid",
          value: `
<style>
  #shopify-section-{{ section.id }} .demo {
    display: grid;
    gap: 24px;
  }

  @media screen and (max-width: 749px) {
    #shopify-section-{{ section.id }} .demo {
      gap: 16px;
    }
  }
</style>
<div class="demo">{{ section.settings.heading }}</div>
{% schema %}
{
  "name": "Too many range steps",
  "settings": [
    { "type": "text", "id": "heading", "label": "Heading", "default": "Hello" },
    { "type": "range", "id": "card_offset_right", "label": "Card offset", "min": 0, "max": 220, "step": 2, "default": 22 },
    { "type": "color", "id": "accent", "label": "Accent", "default": "#111111" }
  ],
  "presets": [{ "name": "Too many range steps" }]
}
{% endschema %}
`,
        },
      ],
    }),
    { shopifyClient: mockShopifyClient }
  );

  assert.equal(result.success, false);
  assert.equal(result.errorCode, "inspection_failed_schema_range");
  assert.match(result.message, /101 stappen/i);
  assert.match(result.message, /card_offset_right/i);
});

test("draftThemeArtifact - advises select for ranges with too few discrete values", async () => {
  const mockShopifyClient = {
    url: "https://unit-test.myshopify.com/admin/api/2026-01/graphql.json",
    requestConfig: {
      headers: new Headers({ "x-shopify-access-token": "fake-token" })
    },
    session: { shop: "unit-test.myshopify.com" },
    request: async () => {}
  };

  const result = await execute(
    draftThemeArtifact.schema.parse({
      mode: "create",
      themeId: 111,
      files: [
        {
          key: "sections/tiny-range.liquid",
          value: `
<div class="demo">{{ section.settings.heading }}</div>
{% schema %}
{
  "name": "Tiny range",
  "settings": [
    { "type": "text", "id": "heading", "label": "Heading", "default": "Hello" },
    { "type": "range", "id": "visible_cards_mobile", "label": "Visible cards mobile", "min": 1, "max": 2, "step": 1, "default": 1 },
    { "type": "color", "id": "accent", "label": "Accent", "default": "#111111" }
  ],
  "presets": [{ "name": "Tiny range" }]
}
{% endschema %}
`,
        },
      ],
    }),
    { shopifyClient: mockShopifyClient }
  );

  assert.equal(result.success, false);
  assert.equal(result.errorCode, "inspection_failed_schema_range");
  assert.ok(
    result.preferSelectFor?.some((entry) => JSON.stringify(entry.path).includes("visible_cards_mobile")),
    "tiny discrete ranges should return preferSelectFor guidance"
  );
  assert.ok(
    result.suggestedSchemaRewrites?.some((entry) => entry.suggestedType === "select"),
    "tiny discrete ranges should suggest converting the schema to select"
  );
});

test("draftThemeArtifact - rejects select defaults that are not present in options", async () => {
  const mockShopifyClient = {
    url: "https://unit-test.myshopify.com/admin/api/2026-01/graphql.json",
    requestConfig: {
      headers: new Headers({ "x-shopify-access-token": "fake-token" })
    },
    session: { shop: "unit-test.myshopify.com" },
    request: async () => {}
  };

  const result = await execute(
    draftThemeArtifact.schema.parse({
      mode: "create",
      themeId: 111,
      files: [
        {
          key: "sections/invalid-select-default.liquid",
          value: `
<style>
  #shopify-section-{{ section.id }} .select-demo {
    display: grid;
    gap: 16px;
    padding: 24px;
    border-radius: 18px;
  }
  @media screen and (max-width: 749px) {
    #shopify-section-{{ section.id }} .select-demo { padding: 16px; }
  }
</style>
<section class="select-demo">{{ section.settings.heading }}</section>
{% schema %}
{
  "name": "Invalid select default",
  "settings": [
    { "type": "text", "id": "heading", "label": "Heading", "default": "Hello" },
    {
      "type": "select",
      "id": "layout",
      "label": "Layout",
      "options": [
        { "value": "grid", "label": "Grid" },
        { "value": "stack", "label": "Stack" }
      ],
      "default": "carousel"
    },
    { "type": "color", "id": "accent", "label": "Accent", "default": "#111111" }
  ],
  "presets": [{ "name": "Invalid select default" }]
}
{% endschema %}
`,
        },
      ],
    }),
    { shopifyClient: mockShopifyClient }
  );

  assert.equal(result.success, false);
  assert.equal(result.status, "inspection_failed");
  assert.ok(
    result.errors?.some(
      (issue) => issue.issueCode === "inspection_failed_schema_select"
    ),
    "select default should be validated locally"
  );
  assert.match(result.message, /carousel|options/i);
});

test("draftThemeArtifact - rejects schema-only section stubs in create mode", async () => {
  const mockShopifyClient = {
    url: "https://unit-test.myshopify.com/admin/api/2026-01/graphql.json",
    requestConfig: {
      headers: new Headers({ "x-shopify-access-token": "fake-token" })
    },
    session: { shop: "unit-test.myshopify.com" },
    request: async () => {}
  };

  const result = await execute(
    draftThemeArtifact.schema.parse({
      mode: "create",
      themeId: 111,
      files: [
        {
          key: "sections/schema-only-stub.liquid",
          value: `
{% schema %}
{
  "name": "Schema only stub",
  "settings": [],
  "presets": [{ "name": "Schema only stub" }]
}
{% endschema %}
`,
        },
      ],
    }),
    { shopifyClient: mockShopifyClient }
  );

  assert.equal(result.success, false);
  assert.equal(result.errorCode, "inspection_failed_incomplete_section");
  assert.match(result.message, /schema-only|renderbare markup/i);
});

test("draftThemeArtifact - classifies standalone sections with only minimal local CSS explicitly", async () => {
  const mockShopifyClient = {
    url: "https://unit-test.myshopify.com/admin/api/2026-01/graphql.json",
    requestConfig: {
      headers: new Headers({ "x-shopify-access-token": "fake-token" })
    },
    session: { shop: "unit-test.myshopify.com" },
    request: async () => {}
  };

  const result = await execute(
    draftThemeArtifact.schema.parse({
      mode: "create",
      themeId: 111,
      files: [
        {
          key: "sections/minimal-css-only.liquid",
          value: `
<style>
  #shopify-section-{{ section.id }} .demo {
    color: {{ section.settings.text_color }};
  }
</style>
<div class="demo">{{ section.settings.heading }}</div>
{% schema %}
{
  "name": "Minimal css only",
  "settings": [
    { "type": "text", "id": "heading", "label": "Heading", "default": "Hello" },
    { "type": "color", "id": "text_color", "label": "Text color", "default": "#111111" }
  ],
  "presets": [{ "name": "Minimal css only" }]
}
{% endschema %}
`,
        },
      ],
    }),
    { shopifyClient: mockShopifyClient }
  );

  assert.equal(result.success, false);
  assert.equal(result.errorCode, "standalone_section_too_minimal");
  assert.match(result.message, /te minimaal|premium standalone section/i);
});

test("draftThemeArtifact - rejects Impact-like sections without theme wrapper conventions and scoped CSS", async () => {
  const mockShopifyClient = {
    url: "https://unit-test.myshopify.com/admin/api/2026-01/graphql.json",
    requestConfig: {
      headers: new Headers({ "x-shopify-access-token": "fake-token" })
    },
    session: { shop: "unit-test.myshopify.com" },
    request: async () => {}
  };

  const result = await execute(
    draftThemeArtifact.schema.parse({
      mode: "create",
      themeId: 111,
      files: [
        {
          key: "sections/impact-no-wrapper.liquid",
          value: `
<style>
  .impact-no-wrapper {
    display: grid;
    gap: 24px;
    padding: 32px;
    border-radius: 18px;
    background: #ffffff;
  }
  @media screen and (max-width: 749px) {
    .impact-no-wrapper {
      padding: 20px;
    }
  }
</style>
<section class="impact-no-wrapper">
  <h2>{{ section.settings.heading }}</h2>
</section>
{% schema %}
{
  "name": "Impact no wrapper",
  "settings": [
    { "type": "text", "id": "heading", "label": "Heading", "default": "Hello" },
    { "type": "color", "id": "accent", "label": "Accent", "default": "#111111" }
  ],
  "presets": [{ "name": "Impact no wrapper" }]
}
{% endschema %}
`,
        },
      ],
    }),
    {
      shopifyClient: mockShopifyClient,
      themeSectionContext: {
        usesImpactSectionConventions: true,
        usesSectionPropertiesWrapper: true,
        usesPageWidth: true,
      },
    }
  );

  assert.equal(result.success, false);
  assert.equal(result.status, "inspection_failed");
  assert.ok(
    result.errors?.some((issue) => issue.issueCode === "inspection_failed_impact_wrapper"),
    "Impact-like themes should require their section wrapper convention"
  );
  assert.ok(
    result.errors?.some((issue) => issue.issueCode === "inspection_failed_unscoped_css"),
    "Impact-like sections should reject unscoped local CSS"
  );
});

test("draftThemeArtifact - does not apply Impact wrapper rules to generic OS 2.0 themes", async () => {
  const mockShopifyClient = {
    url: "https://unit-test.myshopify.com/admin/api/2026-01/graphql.json",
    requestConfig: {
      headers: new Headers({ "x-shopify-access-token": "fake-token" })
    },
    session: { shop: "unit-test.myshopify.com" },
    request: async () => {}
  };
  const themeMock = createThemeFileFetchMock({
    key: "sections/generic-card.liquid",
    initialValue: "",
    existing: false,
  });
  const previousFetch = global.fetch;
  global.fetch = themeMock.handler;

  try {
    const result = await execute(
      draftThemeArtifact.schema.parse({
        mode: "create",
        themeId: 111,
        files: [
          {
            key: "sections/generic-card.liquid",
            value: goodSectionLiquid.replace("Test section", "Generic card"),
          },
        ],
      }),
      {
        shopifyClient: mockShopifyClient,
        themeSectionContext: {
          usesPageWidth: false,
          usesSectionPropertiesWrapper: false,
          relevantHelpers: [],
        },
        sectionBlueprint: {
          category: "static",
          themeWrapperStrategy: {
            usesImpactSectionConventions: false,
          },
        },
      }
    );

    assert.equal(result.success, true);
    assert.equal(result.status, "preview_ready");
    assert.ok(!result.errors?.some((issue) => issue.issueCode === "inspection_failed_impact_wrapper"));
    assert.ok(themeMock.getValue().includes("Generic card"));
  } finally {
    global.fetch = previousFetch;
  }
});

test("draftThemeArtifact - rejects invalid range schemas in edit mode before preview upload", async () => {
  const mockShopifyClient = {
    url: "https://unit-test.myshopify.com/admin/api/2026-01/graphql.json",
    requestConfig: {
      headers: new Headers({ "x-shopify-access-token": "fake-token" })
    },
    session: { shop: "unit-test.myshopify.com" },
    request: async () => {}
  };

  const originalFetch = global.fetch;
  const themeFileMock = createThemeFileFetchMock({
    key: "sections/good-file.liquid",
    initialValue: goodSectionLiquid,
  });
  global.fetch = themeFileMock.handler;

  try {
    const result = await execute(
      draftThemeArtifact.schema.parse({
        themeId: 111,
        mode: "edit",
        files: [
          {
            key: "sections/good-file.liquid",
            value: goodSectionLiquid.replace('"step": 4, "default": 16', '"step": 8, "default": 10'),
          },
        ],
      }),
      {
        shopifyClient: mockShopifyClient,
        tokenHash: "draft-handoff-only-read-enforcement",
      }
    );

    assert.equal(result.success, false);
    assert.equal(result.errorCode, "inspection_failed_schema_range");
    assert.match(result.message, /step/i);
    assert.match(result.message, /good-file\.liquid|gap/i);
  } finally {
    global.fetch = originalFetch;
  }
});

test("draftThemeArtifact - accepts schema blocks that use Liquid whitespace control", async () => {
  const mockShopifyClient = {
    url: "https://unit-test.myshopify.com/admin/api/2026-01/graphql.json",
    requestConfig: {
      headers: new Headers({ "x-shopify-access-token": "fake-token" })
    },
    session: { shop: "unit-test.myshopify.com" },
    request: async () => {}
  };

  const result = await execute(
    draftThemeArtifact.schema.parse({
      mode: "create",
      themeId: 111,
      files: [
        {
          key: "sections/trimmed-schema.liquid",
          value: goodSectionLiquidTrimmedSchema,
        },
      ],
    }),
    { shopifyClient: mockShopifyClient }
  );

  assert.notEqual(
    result.errorCode,
    "inspection_failed_schema",
    "trimmed schema tags should no longer be misclassified as missing schema"
  );
  assert.ok(result.draftId, "once schema parsing succeeds, the pipeline should advance beyond inspection");
});

test("draftThemeArtifact - distinguishes empty schema blocks from missing schema blocks", async () => {
  const mockShopifyClient = {
    url: "https://unit-test.myshopify.com/admin/api/2026-01/graphql.json",
    requestConfig: {
      headers: new Headers({ "x-shopify-access-token": "fake-token" })
    },
    session: { shop: "unit-test.myshopify.com" },
    request: async () => {}
  };

  const result = await execute(
    draftThemeArtifact.schema.parse({
      mode: "create",
      themeId: 111,
      files: [
        {
          key: "sections/empty-schema.liquid",
          value: `
<div class="card">Hello</div>
{% schema %}
{% endschema %}
`,
        },
      ],
    }),
    { shopifyClient: mockShopifyClient }
  );

  assert.equal(result.success, false);
  assert.equal(result.errorCode, "inspection_failed_schema");
  assert.ok(result.suggestedFixes.includes("Empty {% schema %} block."));
});

test("draftThemeArtifact - hydrates locale context before running theme-check on translation keys", async () => {
  const mockShopifyClient = {
    url: "https://unit-test.myshopify.com/admin/api/2026-01/graphql.json",
    requestConfig: {
      headers: new Headers({ "x-shopify-access-token": "fake-token" })
    },
    session: { shop: "unit-test.myshopify.com" },
    request: async () => {}
  };

  const originalFetch = global.fetch;
  const storedFiles = new Map();
  const localeValue = JSON.stringify({
    custom: {
      social_proof: "Davie and 1500+ others love our products!"
    }
  });

  global.fetch = async (_url, options = {}) => {
    const payload = options.body ? JSON.parse(String(options.body)) : {};
    const query = String(payload.query || "");
    const variables = payload.variables || {};
    const themeId = String(variables.themeId || "");
    const numericThemeId = Number(themeId.match(/\/(\d+)$/)?.[1] || 111);

    if (query.includes("ThemeById")) {
      const resPayload = {
        data: {
          theme: {
            id: `gid://shopify/OnlineStoreTheme/${numericThemeId}`,
            name: "Dev Theme",
            role: "DEVELOPMENT",
            processing: false,
            createdAt: "2026-04-02T00:00:00Z",
            updatedAt: "2026-04-02T00:00:00Z"
          }
        }
      };
      return {
        ok: true,
        status: 200,
        json: async () => resPayload,
        text: async () => JSON.stringify(resPayload)
      };
    }

    if (query.includes("ThemeFilesByIdWithContent")) {
      const requested = Array.isArray(variables.filenames) ? variables.filenames : [];
      const nodes = [];

      if (requested.includes("locales/*.default.json")) {
        nodes.push({
          filename: "locales/en.default.json",
          checksumMd5: checksumMd5Base64(localeValue),
          contentType: "application/json",
          createdAt: "2026-04-02T00:00:00Z",
          updatedAt: "2026-04-02T00:00:00Z",
          size: Buffer.byteLength(localeValue, "utf8"),
          body: { content: localeValue }
        });
      }

      for (const filename of requested) {
        const value = storedFiles.get(filename);
        if (!value) {
          continue;
        }
        nodes.push({
          filename,
          checksumMd5: checksumMd5Base64(value),
          contentType: "application/x-liquid",
          createdAt: "2026-04-02T00:00:00Z",
          updatedAt: "2026-04-02T00:00:00Z",
          size: Buffer.byteLength(value, "utf8"),
          body: { content: value }
        });
      }

      const resPayload = {
        data: {
          theme: {
            id: `gid://shopify/OnlineStoreTheme/${numericThemeId}`,
            name: "Dev Theme",
            role: "DEVELOPMENT",
            processing: false,
            createdAt: "2026-04-02T00:00:00Z",
            updatedAt: "2026-04-02T00:00:00Z",
            files: {
              nodes,
              userErrors: []
            }
          }
        }
      };
      return {
        ok: true,
        status: 200,
        json: async () => resPayload,
        text: async () => JSON.stringify(resPayload)
      };
    }

    if (query.includes("ThemeFilesByIdMetadata")) {
      const requested = Array.isArray(variables.filenames) ? variables.filenames : [];
      const nodes = requested.flatMap((filename) => {
        const value = storedFiles.get(filename);
        if (!value) {
          return [];
        }
        return [
          {
            filename,
            checksumMd5: checksumMd5Base64(value),
            contentType: "application/x-liquid",
            createdAt: "2026-04-02T00:00:00Z",
            updatedAt: "2026-04-02T00:00:00Z",
            size: Buffer.byteLength(value, "utf8")
          },
        ];
      });
      const resPayload = {
        data: {
          theme: {
            id: `gid://shopify/OnlineStoreTheme/${numericThemeId}`,
            name: "Dev Theme",
            role: "DEVELOPMENT",
            processing: false,
            createdAt: "2026-04-02T00:00:00Z",
            updatedAt: "2026-04-02T00:00:00Z",
            files: {
              nodes,
              userErrors: []
            }
          }
        }
      };
      return {
        ok: true,
        status: 200,
        json: async () => resPayload,
        text: async () => JSON.stringify(resPayload)
      };
    }

    if (query.includes("ThemeFilesUpsert")) {
      const files = Array.isArray(variables.files) ? variables.files : [];
      for (const file of files) {
        if (file?.filename && typeof file?.body?.value === "string") {
          storedFiles.set(file.filename, file.body.value);
        }
      }

      const resPayload = {
        data: {
          themeFilesUpsert: {
            upsertedThemeFiles: files.map((file) => ({ filename: file.filename })),
            job: { id: "gid://shopify/Job/1" },
            userErrors: []
          }
        }
      };
      return {
        ok: true,
        status: 200,
        json: async () => resPayload,
        text: async () => JSON.stringify(resPayload)
      };
    }

    throw new Error(`Unexpected GraphQL query in locale hydration test: ${query}`);
  };

  try {
    const result = await execute(
      draftThemeArtifact.schema.parse({
        themeId: 111,
        files: [
          {
            key: "sections/translatable-social-proof.liquid",
            value: `
<style>
  #shopify-section-{{ section.id }} .card {
    display: grid;
    gap: 12px;
    padding: 24px;
    border-radius: 18px;
    background: {{ section.settings.background }};
  }

  @media screen and (max-width: 749px) {
    #shopify-section-{{ section.id }} .card {
      padding: 16px;
    }
  }
</style>

<div class="card">{{ 'custom.social_proof' | t }}</div>

{% schema %}
{
  "name": "Translatable social proof",
  "settings": [
    { "type": "color", "id": "background", "label": "Background", "default": "#ffffff" },
    { "type": "range", "id": "spacing", "label": "Spacing", "min": 0, "max": 40, "step": 4, "default": 16 }
  ],
  "presets": [{ "name": "Translatable social proof" }]
}
{% endschema %}
`,
          },
        ],
      }),
      {
        shopifyClient: mockShopifyClient,
        tokenHash: "draft-handoff-only-read-enforcement",
      }
    );

    assert.equal(result.success, true);
    assert.equal(result.status, "preview_ready");
    assert.ok(
      result.verify?.results?.some((entry) => entry.key === "sections/translatable-social-proof.liquid"),
      "successful preview writes should still verify the translated section file"
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test("draftThemeArtifact - rejects color_scheme sections when the target theme has no global color schemes", async () => {
  const mockShopifyClient = {
    url: "https://unit-test.myshopify.com/admin/api/2026-01/graphql.json",
    requestConfig: {
      headers: new Headers({ "x-shopify-access-token": "fake-token" })
    },
    session: { shop: "unit-test.myshopify.com" },
    request: async () => {}
  };

  const originalFetch = global.fetch;
  global.fetch = async (_url, options = {}) => {
    const payload = options.body ? JSON.parse(String(options.body)) : {};
    const query = String(payload.query || "");
    const themeId = String(payload.variables?.themeId || "");
    const numericThemeId = Number(themeId.match(/\/(\d+)$/)?.[1] || 111);

    if (query.includes("ThemeById")) {
      const resPayload = {
        data: {
          theme: {
            id: `gid://shopify/OnlineStoreTheme/${numericThemeId}`,
            name: "Dev Theme",
            role: "DEVELOPMENT",
            processing: false,
            createdAt: "2026-04-02T00:00:00Z",
            updatedAt: "2026-04-02T00:00:00Z"
          }
        }
      };
      return {
        ok: true,
        status: 200,
        json: async () => resPayload,
        text: async () => JSON.stringify(resPayload)
      };
    }

    if (query.includes("ThemeFilesByIdWithContent")) {
      const settingsSchemaValue = JSON.stringify([
        {
          name: "Theme settings",
          settings: [
            { type: "color", id: "accent", label: "Accent" }
          ]
        }
      ]);
      const settingsDataValue = JSON.stringify({
        current: {
          accent: "#111111"
        }
      });
      const resPayload = {
        data: {
          theme: {
            id: `gid://shopify/OnlineStoreTheme/${numericThemeId}`,
            name: "Dev Theme",
            role: "DEVELOPMENT",
            processing: false,
            createdAt: "2026-04-02T00:00:00Z",
            updatedAt: "2026-04-02T00:00:00Z",
            files: {
              nodes: [
                {
                  filename: "config/settings_schema.json",
                  checksumMd5: checksumMd5Base64(settingsSchemaValue),
                  contentType: "application/json",
                  createdAt: "2026-04-02T00:00:00Z",
                  updatedAt: "2026-04-02T00:00:00Z",
                  size: Buffer.byteLength(settingsSchemaValue, "utf8"),
                  body: { content: settingsSchemaValue }
                },
                {
                  filename: "config/settings_data.json",
                  checksumMd5: checksumMd5Base64(settingsDataValue),
                  contentType: "application/json",
                  createdAt: "2026-04-02T00:00:00Z",
                  updatedAt: "2026-04-02T00:00:00Z",
                  size: Buffer.byteLength(settingsDataValue, "utf8"),
                  body: { content: settingsDataValue }
                }
              ],
              userErrors: []
            }
          }
        }
      };
      return {
        ok: true,
        status: 200,
        json: async () => resPayload,
        text: async () => JSON.stringify(resPayload)
      };
    }

    throw new Error(`Unexpected GraphQL query in color_scheme compatibility test: ${query}`);
  };

  try {
    const result = await execute(
      draftThemeArtifact.schema.parse({
        themeId: 111,
        files: [
          {
            key: "sections/video-header.liquid",
            value: `
<style>
  #shopify-section-{{ section.id }} .hero {
    display: grid;
    padding: 24px;
    border-radius: 18px;
    background: var(--hero-background);
  }

  @media screen and (max-width: 749px) {
    #shopify-section-{{ section.id }} .hero {
      padding: 16px;
    }
  }
</style>

<section class="hero" style="--hero-background: {{ section.settings.color_scheme.settings.background }}">
  {{ section.settings.heading }}
</section>

{% schema %}
{
  "name": "Video header",
  "settings": [
    { "type": "text", "id": "heading", "label": "Heading", "default": "Hello" },
    { "type": "color_scheme", "id": "color_scheme", "label": "Color scheme" },
    { "type": "video", "id": "background_video", "label": "Background video" }
  ],
  "presets": [{ "name": "Video header" }]
}
{% endschema %}
`,
          },
        ],
      }),
      { shopifyClient: mockShopifyClient }
    );

    assert.equal(result.success, false);
    assert.equal(result.errorCode, "inspection_failed_color_scheme_theme_support");
    assert.match(result.message, /color_scheme/i);
    assert.ok(
      result.suggestedFixes.some((entry) => entry.includes("settings_schema.json")),
      "color scheme compatibility failures should point to the global theme config"
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test("draftThemeArtifact - blocks template/config writes in create mode", async () => {
  const mockShopifyClient = {
    url: "https://unit-test.myshopify.com/admin/api/2026-01/graphql.json",
    requestConfig: {
      headers: new Headers({ "x-shopify-access-token": "fake-token" })
    },
    session: { shop: "unit-test.myshopify.com" },
    request: async () => {}
  };

  const result = await execute(
    draftThemeArtifact.schema.parse({
      mode: "create",
      themeId: 111,
      files: [
        {
          key: "templates/index.json",
          value: "{}"
        }
      ]
    }),
    { shopifyClient: mockShopifyClient }
  );

  assert.equal(result.success, false);
  assert.equal(result.status, "inspection_failed");
  assert.equal(result.errorCode, "inspection_failed_schema");
  assert.equal(result.shouldNarrowScope, true);
});

test("draftThemeArtifact - requires themeId or themeRole", async () => {
  const mockShopifyClient = {
    url: "https://unit-test.myshopify.com/admin/api/2026-01/graphql.json",
    requestConfig: {
      headers: new Headers({ "x-shopify-access-token": "fake-token" })
    },
    session: { shop: "unit-test.myshopify.com" },
    request: async () => {}
  };

  const result = await execute(
    // Hier slaan we Zod parsing gedeeltelijk over of we passeren alleen files, 
    // want schema() staat themeRole.optional() toe, maar execute() blockt als het ontbreekt.
    {
      files: [{ key: "sections/some-file.liquid", value: "hello" }],
    },
    { shopifyClient: mockShopifyClient }
  );

  assert.equal(result.success, false);
  assert.equal(result.errorCode, "missing_theme_target");
});

test("draftThemeArtifact - rejects duplicate file keys with a structured failure", async () => {
  const mockShopifyClient = {
    url: "https://unit-test.myshopify.com/admin/api/2026-01/graphql.json",
    requestConfig: {
      headers: new Headers({ "x-shopify-access-token": "fake-token" })
    },
    session: { shop: "unit-test.myshopify.com" },
    request: async () => {
      throw new Error("duplicate key validation should fail before Shopify reads");
    }
  };

  const result = await execute(
    draftThemeArtifact.schema.parse({
      themeId: 111,
      mode: "edit",
      files: [
        {
          key: "sections/main-product.liquid",
          patch: {
            searchString: "{{ section.settings.heading }}",
            replaceString: "<span>Heading</span>",
          },
        },
        {
          key: "sections/main-product.liquid",
          patch: {
            searchString: "\"type\": \"promo\"",
            replaceString: "\"type\": \"review_badge_exact\"",
          },
        },
      ],
    }),
    { shopifyClient: mockShopifyClient }
  );

  assert.equal(result.success, false);
  assert.equal(result.errorCode, "inspection_failed_duplicate_key");
  assert.match(result.message, /files\[\]\.key moet uniek/i);
  assert.ok(
    result.suggestedFixes.some((entry) => entry.includes("patches")),
    "duplicate-key errors should direct callers to patches[]"
  );
});

test("draftThemeArtifact - applies patches[] sequentially within one file", async () => {
  const mockShopifyClient = {
    url: "https://unit-test.myshopify.com/admin/api/2026-01/graphql.json",
    requestConfig: {
      headers: new Headers({ "x-shopify-access-token": "fake-token" })
    },
    session: { shop: "unit-test.myshopify.com" },
    request: async () => {}
  };

  const originalSection = `
<style>
  #shopify-section-{{ section.id }} .demo {
    display: grid;
    padding: 24px;
    border-radius: 18px;
  }
</style>

<div class="demo">
  <span class="eyebrow">Old badge</span>
  {{ section.settings.heading }}
</div>

{% schema %}
{
  "name": "Patch demo",
  "settings": [
    { "type": "text", "id": "heading", "label": "Heading", "default": "Hello" }
  ],
  "blocks": [
    { "type": "promo", "name": "Promo" }
  ],
  "presets": [{ "name": "Patch demo" }]
}
{% endschema %}
`;

  let storedSection = originalSection;
  const originalFetch = global.fetch;
  global.fetch = async (_url, options = {}) => {
    const payload = options.body ? JSON.parse(String(options.body)) : {};
    const query = String(payload.query || "");
    const themeId = String(payload.variables?.themeId || "");
    const numericThemeId = Number(themeId.match(/\/(\d+)$/)?.[1] || 111);

    if (query.includes("ThemeById")) {
      const resPayload = {
        data: {
          theme: {
            id: `gid://shopify/OnlineStoreTheme/${numericThemeId}`,
            name: "Dev Theme",
            role: "DEVELOPMENT",
            processing: false,
            createdAt: "2026-04-02T00:00:00Z",
            updatedAt: "2026-04-02T00:00:00Z"
          }
        }
      };
      return {
        ok: true,
        status: 200,
        json: async () => resPayload,
        text: async () => JSON.stringify(resPayload)
      };
    }

    if (query.includes("ThemeFilesByIdWithContent")) {
      const resPayload = {
        data: {
          theme: {
            id: `gid://shopify/OnlineStoreTheme/${numericThemeId}`,
            name: "Dev Theme",
            role: "DEVELOPMENT",
            processing: false,
            createdAt: "2026-04-02T00:00:00Z",
            updatedAt: "2026-04-02T00:00:00Z",
            files: {
              nodes: [
                {
                  filename: "sections/main-product.liquid",
                  checksumMd5: checksumMd5Base64(storedSection),
                  contentType: "application/x-liquid",
                  createdAt: "2026-04-02T00:00:00Z",
                  updatedAt: "2026-04-02T00:00:00Z",
                  size: Buffer.byteLength(storedSection, "utf8"),
                  body: { content: storedSection }
                }
              ],
              userErrors: []
            }
          }
        }
      };
      return {
        ok: true,
        status: 200,
        json: async () => resPayload,
        text: async () => JSON.stringify(resPayload)
      };
    }

    if (query.includes("ThemeFileById")) {
      const resPayload = {
        data: {
          theme: {
            id: `gid://shopify/OnlineStoreTheme/${numericThemeId}`,
            name: "Dev Theme",
            role: "DEVELOPMENT",
            processing: false,
            createdAt: "2026-04-02T00:00:00Z",
            updatedAt: "2026-04-02T00:00:00Z",
            files: {
              nodes: [
                {
                  filename: "sections/main-product.liquid",
                  checksumMd5: checksumMd5Base64(storedSection),
                  contentType: "application/x-liquid",
                  createdAt: "2026-04-02T00:00:00Z",
                  updatedAt: "2026-04-02T00:00:00Z",
                  size: Buffer.byteLength(storedSection, "utf8"),
                  body: { content: storedSection }
                }
              ],
              userErrors: []
            }
          }
        }
      };
      return {
        ok: true,
        status: 200,
        json: async () => resPayload,
        text: async () => JSON.stringify(resPayload)
      };
    }

    if (query.includes("ThemeFilesByIdMetadata")) {
      const resPayload = {
        data: {
          theme: {
            id: `gid://shopify/OnlineStoreTheme/${numericThemeId}`,
            name: "Dev Theme",
            role: "DEVELOPMENT",
            processing: false,
            createdAt: "2026-04-02T00:00:00Z",
            updatedAt: "2026-04-02T00:00:00Z",
            files: {
              nodes: [
                {
                  filename: "sections/main-product.liquid",
                  checksumMd5: checksumMd5Base64(storedSection),
                  contentType: "application/x-liquid",
                  createdAt: "2026-04-02T00:00:00Z",
                  updatedAt: "2026-04-02T00:00:00Z",
                  size: Buffer.byteLength(storedSection, "utf8")
                }
              ],
              userErrors: []
            }
          }
        }
      };
      return {
        ok: true,
        status: 200,
        json: async () => resPayload,
        text: async () => JSON.stringify(resPayload)
      };
    }

    if (query.includes("ThemeFilesUpsert")) {
      storedSection = payload.variables.files[0].body.value;
      const resPayload = {
        data: {
          themeFilesUpsert: {
            upsertedThemeFiles: [{ filename: "sections/main-product.liquid" }],
            job: { id: "gid://shopify/Job/1" },
            userErrors: []
          }
        }
      };
      return {
        ok: true,
        status: 200,
        json: async () => resPayload,
        text: async () => JSON.stringify(resPayload)
      };
    }

    throw new Error(`Unexpected GraphQL query in patches[] test: ${query}`);
  };

  try {
    const result = await execute(
      draftThemeArtifact.schema.parse({
        themeId: 111,
        mode: "edit",
        files: [
          {
            key: "sections/main-product.liquid",
            baseChecksumMd5: checksumMd5Base64(originalSection),
            patches: [
              {
                searchString: "<span class=\"eyebrow\">Old badge</span>",
                replaceString: "<span class=\"eyebrow\">Review badge</span>",
              },
              {
                searchString: "\"type\": \"promo\", \"name\": \"Promo\"",
                replaceString: "\"type\": \"review_badge_exact\", \"name\": \"Review badge\" },\n    { \"type\": \"promo\", \"name\": \"Promo\"",
              },
            ],
          },
        ],
      }),
      { shopifyClient: mockShopifyClient }
    );

    assert.equal(result.success, true);
    assert.equal(result.status, "preview_ready");
    assert.match(storedSection, /Review badge/);
    assert.match(storedSection, /review_badge_exact/);
    assert.ok(result.verify.summary.match >= 1);
  } finally {
    global.fetch = originalFetch;
  }
});

test("draftThemeArtifact - infers edit mode and accepts a single patch", async () => {
  const mockShopifyClient = {
    url: "https://unit-test.myshopify.com/admin/api/2026-01/graphql.json",
    requestConfig: {
      headers: new Headers({ "x-shopify-access-token": "fake-token" })
    },
    session: { shop: "unit-test.myshopify.com" },
    request: async () => {}
  };

  const originalSection = `
<div class="demo">
  <span class="eyebrow">Old badge</span>
  {{ section.settings.heading }}
</div>

{% schema %}
{
  "name": "Patch demo",
  "settings": [
    { "type": "text", "id": "heading", "label": "Heading", "default": "Hello" }
  ],
  "presets": [{ "name": "Patch demo" }]
}
{% endschema %}
`;

  const themeMock = createThemeFileFetchMock({
    key: "sections/main-product.liquid",
    initialValue: originalSection,
  });
  const previousFetch = global.fetch;
  global.fetch = themeMock.handler;

  try {
    const result = await execute(
      draftThemeArtifact.schema.parse({
        themeId: 111,
        files: [
          {
            key: "sections/main-product.liquid",
            patch: {
              searchString: "<span class=\"eyebrow\">Old badge</span>",
              replaceString: "<span class=\"eyebrow\">Review badge</span>",
            },
          },
        ],
      }),
      { shopifyClient: mockShopifyClient }
    );

    assert.equal(result.success, true);
    assert.equal(result.status, "preview_ready");
    assert.match(themeMock.getValue(), /Review badge/);
    assert.ok(
      result.warnings.some((entry) => entry.includes("top-level mode")),
      "single-patch requests without mode should explain the inferred edit mode"
    );
  } finally {
    global.fetch = previousFetch;
  }
});

test("draftThemeArtifact - infers edit mode for value-only writes when the target file already exists", async () => {
  const originalSection = `
<div class="demo">{{ section.settings.heading }}</div>

{% schema %}
{
  "name": "Value edit demo",
  "settings": [
    { "type": "text", "id": "heading", "label": "Heading", "default": "Hello" }
  ],
  "presets": [{ "name": "Value edit demo" }]
}
{% endschema %}
`;

  const updatedSection = `
<div class="demo demo--updated">{{ section.settings.heading }}</div>

{% schema %}
{
  "name": "Value edit demo",
  "settings": [
    { "type": "text", "id": "heading", "label": "Heading", "default": "Hello" }
  ],
  "presets": [{ "name": "Value edit demo" }]
}
{% endschema %}
`;

  let storedValue = originalSection;
  const mockShopifyClient = {
    url: "https://unit-test.myshopify.com/admin/api/2026-01/graphql.json",
    requestConfig: {
      headers: new Headers({ "x-shopify-access-token": "fake-token" })
    },
    session: { shop: "unit-test.myshopify.com" },
    request: async (query, variables = {}) => {
      const queryText = String(query || "");
      const themeId = String(variables?.themeId || "");
      const numericThemeId = Number(themeId.match(/\/(\d+)$/)?.[1] || 111);
      const theme = {
        id: `gid://shopify/OnlineStoreTheme/${numericThemeId}`,
        name: "Dev Theme",
        role: "DEVELOPMENT",
        processing: false,
        createdAt: "2026-04-02T00:00:00Z",
        updatedAt: "2026-04-02T00:00:00Z",
      };

      if (queryText.includes("ThemeById")) {
        return { theme };
      }

      if (queryText.includes("ThemeFilesByIdWithContent") || queryText.includes("ThemeFileById")) {
        return {
          theme: {
            ...theme,
            files: {
              nodes: [
                {
                  filename: "sections/main-product.liquid",
                  checksumMd5: checksumMd5Base64(storedValue),
                  contentType: "application/x-liquid",
                  createdAt: "2026-04-02T00:00:00Z",
                  updatedAt: "2026-04-02T00:00:00Z",
                  size: Buffer.byteLength(storedValue, "utf8"),
                  body: { content: storedValue },
                },
              ],
              userErrors: [],
            },
          },
        };
      }

      if (queryText.includes("ThemeFilesByIdMetadata")) {
        return {
          theme: {
            ...theme,
            files: {
              nodes: [
                {
                  filename: "sections/main-product.liquid",
                  checksumMd5: checksumMd5Base64(storedValue),
                  contentType: "application/x-liquid",
                  createdAt: "2026-04-02T00:00:00Z",
                  updatedAt: "2026-04-02T00:00:00Z",
                  size: Buffer.byteLength(storedValue, "utf8"),
                },
              ],
              userErrors: [],
            },
          },
        };
      }

      if (queryText.includes("ThemeFilesUpsert")) {
        storedValue = variables?.files?.[0]?.body?.value || storedValue;
        return {
          themeFilesUpsert: {
            upsertedThemeFiles: [{ filename: "sections/main-product.liquid" }],
            job: { id: "gid://shopify/Job/1" },
            userErrors: [],
          },
        };
      }

      throw new Error(`Unexpected GraphQL query in value-only edit inference test: ${queryText}`);
    }
  };
  const previousFetch = global.fetch;
  global.fetch = async (url, options = {}) => {
    const stringUrl = String(url || "");
    const restThemeMatch = stringUrl.match(/\/themes\/(\d+)\.json$/);
    if (restThemeMatch) {
      return jsonGraphqlResponse({
        theme: {
          id: Number(restThemeMatch[1]),
          name: "Dev Theme",
          role: "development",
        },
      });
    }

    if (stringUrl.endsWith("/graphql.json")) {
      const payload = options.body ? JSON.parse(String(options.body)) : {};
      const query = String(payload.query || "");
      const themeId = String(payload.variables?.themeId || "");
      const numericThemeId = Number(themeId.match(/\/(\d+)$/)?.[1] || 111);
      const theme = {
        id: `gid://shopify/OnlineStoreTheme/${numericThemeId}`,
        name: "Dev Theme",
        role: "DEVELOPMENT",
        processing: false,
        createdAt: "2026-04-02T00:00:00Z",
        updatedAt: "2026-04-02T00:00:00Z",
      };

      if (query.includes("ThemeById")) {
        return jsonGraphqlResponse({ data: { theme } });
      }

      if (query.includes("ThemeFilesByIdWithContent") || query.includes("ThemeFileById")) {
        return jsonGraphqlResponse({
          data: {
            theme: {
              ...theme,
              files: {
                nodes: [
                  {
                    filename: "sections/main-product.liquid",
                    checksumMd5: checksumMd5Base64(storedValue),
                    contentType: "application/x-liquid",
                    createdAt: "2026-04-02T00:00:00Z",
                    updatedAt: "2026-04-02T00:00:00Z",
                    size: Buffer.byteLength(storedValue, "utf8"),
                    body: { content: storedValue },
                  },
                ],
                userErrors: [],
              },
            },
          },
        });
      }

      if (query.includes("ThemeFilesByIdMetadata")) {
        return jsonGraphqlResponse({
          data: {
            theme: {
              ...theme,
              files: {
                nodes: [
                  {
                    filename: "sections/main-product.liquid",
                    checksumMd5: checksumMd5Base64(storedValue),
                    contentType: "application/x-liquid",
                    createdAt: "2026-04-02T00:00:00Z",
                    updatedAt: "2026-04-02T00:00:00Z",
                    size: Buffer.byteLength(storedValue, "utf8"),
                  },
                ],
                userErrors: [],
              },
            },
          },
        });
      }

      if (query.includes("ThemeFilesUpsert")) {
        storedValue = payload.variables?.files?.[0]?.body?.value || storedValue;
        return jsonGraphqlResponse({
          data: {
            themeFilesUpsert: {
              upsertedThemeFiles: [{ filename: "sections/main-product.liquid" }],
              job: { id: "gid://shopify/Job/1" },
              userErrors: [],
            },
          },
        });
      }
    }

    throw new Error(`Unexpected fetch in value-only edit inference test: ${stringUrl}`);
  };

  try {
    const result = await execute(
      draftThemeArtifact.schema.parse({
        themeId: 111,
        files: [
          {
            key: "sections/main-product.liquid",
            value: updatedSection,
          },
        ],
      }),
      { shopifyClient: mockShopifyClient }
    );

    assert.equal(result.success, true);
    assert.equal(result.status, "preview_ready");
    assert.match(storedValue, /demo--updated/);
    assert.ok(
      result.warnings.some((entry) => entry.includes("alle doelbestanden al bestaan")),
      "value-only requests without mode should explain the inferred edit mode when the target already exists"
    );
  } finally {
    global.fetch = previousFetch;
  }
});

test("draftThemeArtifact - normalizes single-file top-level aliases into files[]", async () => {
  const parsed = draftThemeArtifact.schema.parse({
    themeRole: "main",
    key: "sections/alias-demo.liquid",
    searchString: "<div>Old</div>",
    replaceString: "<div>New</div>",
  });

  assert.equal(parsed.files.length, 1);
  assert.equal(parsed.files[0].key, "sections/alias-demo.liquid");
  assert.deepEqual(parsed.files[0].patch, {
    searchString: "<div>Old</div>",
    replaceString: "<div>New</div>",
  });
});

test("draftThemeArtifact - normalizes files[] content/liquid aliases into canonical value writes", async () => {
  const contentParsed = draftThemeArtifact.schema.parse({
    themeRole: "main",
    mode: "create",
    files: [
      {
        key: "sections/content-alias-demo.liquid",
        content: `
<div>Content alias</div>
{% schema %}
{
  "name": "Content alias",
  "settings": [],
  "presets": [{ "name": "Content alias" }]
}
{% endschema %}
`,
      },
    ],
  });

  assert.equal(contentParsed.files[0].value.includes("Content alias"), true);

  const liquidParsed = draftThemeArtifact.schema.parse({
    themeRole: "main",
    mode: "create",
    files: [
      {
        key: "sections/liquid-alias-demo.liquid",
        liquid: `
<div>Liquid alias</div>
{% schema %}
{
  "name": "Liquid alias",
  "settings": [],
  "presets": [{ "name": "Liquid alias" }]
}
{% endschema %}
`,
      },
    ],
  });

  assert.equal(liquidParsed.files[0].value.includes("Liquid alias"), true);
});

test("draftThemeArtifact - oversized patch batches steer toward a full rewrite", async () => {
  const result = await draftThemeArtifact.execute({
    themeRole: "main",
    mode: "edit",
    files: [
      {
        key: "sections/hero-bubble-tea.liquid",
        patches: Array.from({ length: 11 }, (_, index) => ({
          searchString: `old-${index}`,
          replaceString: `new-${index}`,
        })),
      },
    ],
  });

  assert.equal(result.success, false);
  assert.equal(result.errorCode, "invalid_draft_theme_artifact_input");
  assert.equal(result.nextAction, "rewrite_with_full_value");
  assert.equal(result.retryMode, "same_request_with_full_rewrite");
  assert.equal(result.nextArgsTemplate?.files?.[0]?.key, "sections/hero-bubble-tea.liquid");
  assert.equal(result.errors?.[0]?.issueCode, "patch_batch_too_large");
});

test("draftThemeArtifact - infers theme target and file path from summary-compatible input", async () => {
  const parsed = draftThemeArtifact.schema.parse({
    _tool_input_summary: "Schrijf sections/stock-pulse.liquid naar het live theme",
    value: `
<div>Stock pulse</div>
{% schema %}
{
  "name": "Stock pulse",
  "settings": [],
  "presets": [{ "name": "Stock pulse" }]
}
{% endschema %}
`,
  });

  assert.equal(parsed.themeRole, "main");
  assert.equal(parsed.files.length, 1);
  assert.equal(parsed.files[0].key, "sections/stock-pulse.liquid");
});

test("draftThemeArtifact - rejects ambiguous patch anchors before replacing multiple matches", async () => {
  const mockShopifyClient = {
    url: "https://unit-test.myshopify.com/admin/api/2026-01/graphql.json",
    requestConfig: {
      headers: new Headers({ "x-shopify-access-token": "fake-token" })
    },
    session: { shop: "unit-test.myshopify.com" },
    request: async () => {}
  };

  const originalSection = `
<div class="demo">Promo</div>

{% schema %}
{
  "name": "Promo",
  "settings": [
    { "type": "text", "id": "heading", "label": "Heading", "default": "Promo" }
  ],
  "presets": [{ "name": "Promo" }]
}
{% endschema %}
`;

  const themeMock = createThemeFileFetchMock({
    key: "sections/main-product.liquid",
    initialValue: originalSection,
  });
  const previousFetch = global.fetch;
  global.fetch = themeMock.handler;

  try {
    const result = await execute(
      draftThemeArtifact.schema.parse({
        themeId: 111,
        mode: "edit",
        files: [
          {
            key: "sections/main-product.liquid",
            patch: {
              searchString: "Promo",
              replaceString: "Review badge",
            },
          },
        ],
      }),
      { shopifyClient: mockShopifyClient }
    );

    assert.equal(result.success, false);
    assert.equal(result.errorCode, "patch_failed_ambiguous_match");
    assert.equal(result.changeScope, "micro_patch");
    assert.equal(result.preferredWriteMode, "patch");
    assert.equal(
      result.diagnosticTargets?.[0]?.fileKey,
      "sections/main-product.liquid"
    );
    assert.equal(result.diagnosticTargets?.[0]?.searchString, "Promo");
    assert.ok(
      Array.isArray(result.diagnosticTargets?.[0]?.anchorCandidates) &&
        result.diagnosticTargets[0].anchorCandidates.length > 0
    );
    assert.match(result.message, /matchte 4 keer/i);
    assert.match(themeMock.getValue(), /<div class="demo">Promo<\/div>/);
  } finally {
    global.fetch = previousFetch;
  }
});

test("draftThemeArtifact - auto-hydrates planner reads before an edit write continues", async () => {
  const mockShopifyClient = {
    url: "https://unit-test.myshopify.com/admin/api/2026-01/graphql.json",
    requestConfig: {
      headers: new Headers({ "x-shopify-access-token": "fake-token" })
    },
    session: { shop: "unit-test.myshopify.com" },
    request: async () => {}
  };

  const context = {
    shopifyClient: mockShopifyClient,
    tokenHash: "draft-read-enforcement",
  };

  rememberThemePlan(context, {
    themeId: 111,
    intent: "native_block",
    template: "product",
    nextReadKeys: ["sections/main-product.liquid", "snippets/product-info.liquid"],
    nextWriteKeys: ["sections/main-product.liquid", "snippets/product-info.liquid"],
    immediateNextTool: "get-theme-files",
    writeTool: "draft-theme-artifact",
  });

  const previousFetch = global.fetch;
  global.fetch = createThemeFilesFetchMock({
    files: {
      "sections/main-product.liquid": `
<section class="main-product">
  {% render 'product-info', product: product, section: section %}
</section>
{% schema %}
{
  "name": "Main product",
  "blocks": [
    {
      "type": "review_badge",
      "name": "Review badge",
      "settings": [
        { "type": "text", "id": "badge_label", "label": "Badge label", "default": "Verified" }
      ]
    }
  ]
}
{% endschema %}
`,
      "snippets/product-info.liquid": `
{% doc %}
  @param {object} section
  @param {object} product
{% enddoc %}
{% for block in section.blocks %}
  <div class="product-info__block" {{ block.shopify_attributes }}>
    {% case block.type %}
      {% when 'review_badge' %}
        <div>Existing review block</div>
    {% endcase %}
  </div>
{% endfor %}
`,
    },
    themeIdFallback: 111,
  });

  try {
    const result = await execute(
      draftThemeArtifact.schema.parse({
        themeId: 111,
        mode: "edit",
        files: [
          {
            key: "sections/main-product.liquid",
            value: `
<section class="main-product">
  {% render 'product-info', product: product, section: section %}
</section>
{% schema %}
{
  "name": "Main product",
  "blocks": [
    {
      "type": "review_badge",
      "name": "Review badge",
      "settings": [
        { "type": "text", "id": "badge_label", "label": "Badge label", "default": "Verified" }
      ]
    }
  ]
}
{% endschema %}
`,
          },
          {
            key: "snippets/product-info.liquid",
            value: `
{% doc %}
  @param {object} section
  @param {object} product
{% enddoc %}
{% for block in section.blocks %}
  <div class="product-info__block" {{ block.shopify_attributes }}>
    {% case block.type %}
      {% when 'review_badge' %}
        <div>Review block</div>
    {% endcase %}
  </div>
{% endfor %}
`,
          },
        ],
      }),
      context
    );

    assert.equal(result.success, true);
    assert.ok(
      result.warnings?.some((warning) =>
        warning.includes("Planner-required theme-context reads zijn automatisch opgehaald")
      ),
      "draft-theme-artifact should auto-hydrate exact planner reads before continuing"
    );
  } finally {
    global.fetch = previousFetch;
  }
});

test("draftThemeArtifact - auto-hydrates planner reads from plannerHandoff when session memory is absent", async () => {
  const mockShopifyClient = {
    url: "https://unit-test.myshopify.com/admin/api/2026-01/graphql.json",
    requestConfig: {
      headers: new Headers({ "x-shopify-access-token": "fake-token" })
    },
    session: { shop: "unit-test.myshopify.com" },
    request: async () => {}
  };

  const previousFetch = global.fetch;
  global.fetch = createThemeFilesFetchMock({
    files: {
      "sections/main-product.liquid": `
<section class="main-product">
  {% render 'product-info', product: product, section: section %}
</section>
{% schema %}
{
  "name": "Main product",
  "blocks": [
    {
      "type": "review_badge",
      "name": "Review badge",
      "settings": [
        { "type": "text", "id": "badge_label", "label": "Badge label", "default": "Verified" }
      ]
    }
  ]
}
{% endschema %}
`,
      "snippets/product-info.liquid": `
{% doc %}
  @param {object} section
  @param {object} product
{% enddoc %}
{% for block in section.blocks %}
  <div class="product-info__block" {{ block.shopify_attributes }}>
    {% case block.type %}
      {% when 'review_badge' %}
        <div>Existing review block</div>
    {% endcase %}
  </div>
{% endfor %}
`,
    },
    themeIdFallback: 111,
  });

  try {
    const result = await execute(
      draftThemeArtifact.schema.parse({
        themeId: 111,
        mode: "edit",
        plannerHandoff: {
          brief: "Voeg een review block toe aan de bestaande product sectie",
          intent: "native_block",
          themeTarget: {
            themeId: 111,
            themeRole: null,
          },
          requiredReadKeys: [
            "sections/main-product.liquid",
            "snippets/product-info.liquid",
          ],
          nextWriteKeys: [
            "sections/main-product.liquid",
            "snippets/product-info.liquid",
          ],
        },
        files: [
          {
            key: "sections/main-product.liquid",
            value: `
<section class="main-product">
  {% render 'product-info', product: product, section: section %}
</section>
{% schema %}
{
  "name": "Main product",
  "blocks": [
    {
      "type": "review_badge",
      "name": "Review badge",
      "settings": [
        { "type": "text", "id": "badge_label", "label": "Badge label", "default": "Verified" }
      ]
    }
  ]
}
{% endschema %}
`,
          },
          {
            key: "snippets/product-info.liquid",
            value: `
{% doc %}
  @param {object} section
  @param {object} product
{% enddoc %}
{% for block in section.blocks %}
  <div class="product-info__block" {{ block.shopify_attributes }}>
    {% case block.type %}
      {% when 'review_badge' %}
        <div>Review block</div>
    {% endcase %}
  </div>
{% endfor %}
`,
          },
        ],
      }),
      {
        shopifyClient: mockShopifyClient,
        tokenHash: "draft-handoff-only-read-enforcement",
      }
    );

    assert.equal(result.success, true);
    assert.ok(
      result.warnings?.some((warning) =>
        warning.includes("Planner-required theme-context reads zijn automatisch opgehaald")
      ),
      "draft-theme-artifact should hydrate exact planner reads from plannerHandoff without relying on session memory"
    );
  } finally {
    global.fetch = previousFetch;
  }
});

test("draftThemeArtifact - auto-hydrates planner reads before a create write continues when a new-section plan exists", async () => {
  const mockShopifyClient = {
    url: "https://unit-test.myshopify.com/admin/api/2026-01/graphql.json",
    requestConfig: {
      headers: new Headers({ "x-shopify-access-token": "fake-token" })
    },
    session: { shop: "unit-test.myshopify.com" },
    request: async () => {}
  };

  const context = {
    shopifyClient: mockShopifyClient,
    tokenHash: "draft-create-read-enforcement",
  };

  rememberThemePlan(context, {
    themeId: 111,
    intent: "new_section",
    template: "homepage",
    nextReadKeys: ["sections/testimonials.liquid", "snippets/section-properties.liquid"],
    nextWriteKeys: [],
    immediateNextTool: "get-theme-files",
    writeTool: "create-theme-section",
    plannerHandoff: {
      brief: "Maak een review slider exact na van de screenshot",
      qualityTarget: "exact_match",
    },
  });

  const previousFetch = global.fetch;
  global.fetch = createThemeFilesFetchMock({
    files: {
      "sections/testimonials.liquid": goodSectionLiquid,
      "snippets/section-properties.liquid": `<div data-section-id="{{ section.id }}"></div>`,
    },
    themeIdFallback: 111,
  });

  try {
    const result = await execute(
      draftThemeArtifact.schema.parse({
        themeId: 111,
        mode: "create",
        files: [
          {
            key: "sections/review-slider.liquid",
            value: goodSectionLiquid,
          },
        ],
      }),
      context
    );

    assert.equal(result.success, true);
    assert.ok(
      result.warnings?.some((warning) =>
        warning.includes("Planner-required theme-context reads zijn automatisch opgehaald")
      ),
      "draft-theme-artifact create mode should auto-hydrate exact planner reads before continuing"
    );
  } finally {
    global.fetch = previousFetch;
  }
});

test("draftThemeArtifact - missing batch-read files do not satisfy required read context", async () => {
  const mockShopifyClient = {
    url: "https://unit-test.myshopify.com/admin/api/2026-01/graphql.json",
    requestConfig: {
      headers: new Headers({ "x-shopify-access-token": "fake-token" })
    },
    session: { shop: "unit-test.myshopify.com" },
    request: async (query, variables = {}) => {
      const queryText = String(query || "");
      const themeId = String(variables?.themeId || "");
      const numericThemeId = Number(themeId.match(/\/(\d+)$/)?.[1] || 111);
      const theme = {
        id: `gid://shopify/OnlineStoreTheme/${numericThemeId}`,
        name: "Dev Theme",
        role: "DEVELOPMENT",
        processing: false,
        createdAt: "2026-04-02T00:00:00Z",
        updatedAt: "2026-04-02T00:00:00Z",
      };

      if (queryText.includes("ThemeById")) {
        return { theme };
      }

      if (queryText.includes("ThemeFilesByIdWithContent")) {
        return {
          theme: {
            ...theme,
            files: {
              nodes: [
                {
                  filename: "sections/main-product.liquid",
                  checksumMd5: checksumMd5Base64(goodSectionLiquid),
                  contentType: "application/x-liquid",
                  createdAt: "2026-04-02T00:00:00Z",
                  updatedAt: "2026-04-02T00:00:00Z",
                  size: Buffer.byteLength(goodSectionLiquid, "utf8"),
                  body: { content: goodSectionLiquid },
                },
              ],
              userErrors: [],
            },
          },
        };
      }

      if (queryText.includes("ThemeFilesByIdMetadata")) {
        return {
          theme: {
            ...theme,
            files: {
              nodes: [
                {
                  filename: "sections/main-product.liquid",
                  checksumMd5: checksumMd5Base64(goodSectionLiquid),
                  contentType: "application/x-liquid",
                  createdAt: "2026-04-02T00:00:00Z",
                  updatedAt: "2026-04-02T00:00:00Z",
                  size: Buffer.byteLength(goodSectionLiquid, "utf8"),
                },
              ],
              userErrors: [],
            },
          },
        };
      }

      if (queryText.includes("ThemeFilesUpsert")) {
        throw new Error("ThemeFilesUpsert should not run when required planner reads are still missing");
      }

      throw new Error(`Unexpected GraphQL query in missing batch-read context test: ${queryText}`);
    }
  };

  const previousFetch = global.fetch;
  global.fetch = async (_url, options = {}) => {
    const stringUrl = String(_url || "");
    const restThemeMatch = stringUrl.match(/\/themes\/(\d+)\.json$/);
    if (restThemeMatch) {
      return jsonGraphqlResponse({
        theme: {
          id: Number(restThemeMatch[1]),
          name: "Dev Theme",
          role: "development",
        },
      });
    }

    if (stringUrl.endsWith("/graphql.json")) {
      const payload = options.body ? JSON.parse(String(options.body)) : {};
      const query = String(payload.query || "");
      const themeId = String(payload.variables?.themeId || "");
      const numericThemeId = Number(themeId.match(/\/(\d+)$/)?.[1] || 111);
      const theme = {
        id: `gid://shopify/OnlineStoreTheme/${numericThemeId}`,
        name: "Dev Theme",
        role: "DEVELOPMENT",
        processing: false,
        createdAt: "2026-04-02T00:00:00Z",
        updatedAt: "2026-04-02T00:00:00Z",
      };

      if (query.includes("ThemeById")) {
        return jsonGraphqlResponse({ data: { theme } });
      }

      if (query.includes("ThemeFilesByIdWithContent")) {
        return jsonGraphqlResponse({
          data: {
            theme: {
              ...theme,
              files: {
                nodes: [
                  {
                    filename: "sections/main-product.liquid",
                    checksumMd5: checksumMd5Base64(goodSectionLiquid),
                    contentType: "application/x-liquid",
                    createdAt: "2026-04-02T00:00:00Z",
                    updatedAt: "2026-04-02T00:00:00Z",
                    size: Buffer.byteLength(goodSectionLiquid, "utf8"),
                    body: { content: goodSectionLiquid },
                  },
                ],
                userErrors: [],
              },
            },
          },
        });
      }

      if (query.includes("ThemeFilesByIdMetadata")) {
        return jsonGraphqlResponse({
          data: {
            theme: {
              ...theme,
              files: {
                nodes: [
                  {
                    filename: "sections/main-product.liquid",
                    checksumMd5: checksumMd5Base64(goodSectionLiquid),
                    contentType: "application/x-liquid",
                    createdAt: "2026-04-02T00:00:00Z",
                    updatedAt: "2026-04-02T00:00:00Z",
                    size: Buffer.byteLength(goodSectionLiquid, "utf8"),
                  },
                ],
                userErrors: [],
              },
            },
          },
        });
      }
    }

    throw new Error(`Unexpected fetch in missing batch-read context test: ${stringUrl}`);
  };

  const context = {
    shopifyClient: mockShopifyClient,
    tokenHash: "draft-missing-batch-context",
  };

  rememberThemePlan(context, {
    themeId: 111,
    intent: "native_block",
    template: "product",
    nextReadKeys: ["sections/main-product.liquid", "snippets/product-info.liquid"],
    nextWriteKeys: ["sections/main-product.liquid", "snippets/product-info.liquid"],
    immediateNextTool: "get-theme-files",
    writeTool: "draft-theme-artifact",
  });

  try {
    const readResult = await getThemeFilesTool.execute(
      {
        themeId: 111,
        keys: ["sections/main-product.liquid", "snippets/product-info.liquid"],
        includeContent: true,
      },
      context
    );

    assert.ok(
      readResult.missingKeys?.includes("snippets/product-info.liquid"),
      "the batch read should surface missing keys back to the client"
    );

    const result = await execute(
      draftThemeArtifact.schema.parse({
        themeId: 111,
        mode: "edit",
        files: [
          {
            key: "sections/main-product.liquid",
            value: goodSectionLiquid,
          },
          {
            key: "snippets/product-info.liquid",
            value: "{% doc %}{% enddoc %}<div>Review block</div>",
          },
        ],
      }),
      context
    );

    assert.equal(result.success, false);
    assert.equal(result.errorCode, "missing_theme_context_reads");
    assert.ok(
      result.nextArgsTemplate?.key === "snippets/product-info.liquid" ||
        result.nextArgsTemplate?.keys?.includes("snippets/product-info.liquid"),
      "missing files from a batch read should not count as completed planner context"
    );
  } finally {
    global.fetch = previousFetch;
  }
});

test("draftThemeArtifact - rejects prompt-only review sections that degrade to generic content", async () => {
  const key = "sections/review-cards.liquid";
  const mockShopifyClient = {
    url: "https://unit-test.myshopify.com/admin/api/2026-01/graphql.json",
    requestConfig: {
      headers: new Headers({ "x-shopify-access-token": "fake-token" })
    },
    session: { shop: "unit-test.myshopify.com" },
    request: async () => {}
  };
  const themeMock = createThemeFileFetchMock({
    key,
    initialValue: "",
    existing: false,
  });
  const previousFetch = global.fetch;
  global.fetch = themeMock.handler;

  try {
    const result = await execute(
      draftThemeArtifact.schema.parse({
        themeId: 111,
        mode: "create",
        plannerHandoff: {
          intent: "new_section",
          themeTarget: { themeId: 111, themeRole: null },
          sectionBlueprint: {
            archetype: "review_section",
            category: "static",
            qualityTarget: "theme_consistent",
            promptContract: {
              promptOnly: true,
              requiresReviewContentSignals: true,
              requiresReviewCardSurface: true,
              requiresBlockBasedCards: true,
              requiresRatingOrQuoteSignal: true,
            },
          },
        },
        files: [
          {
            key,
            value: `
<style>
  #shopify-section-{{ section.id }} .review-cards {
    display: grid;
    gap: 20px;
    padding: 24px;
  }
</style>
<section class="review-cards page-width">
  <h2>{{ section.settings.heading }}</h2>
  <div class="rte">{{ section.settings.body }}</div>
</section>
{% schema %}
{
  "name": "Review cards",
  "settings": [
    { "type": "text", "id": "heading", "label": "Heading", "default": "Loved by customers" },
    { "type": "textarea", "id": "body", "label": "Body", "default": "A generic content section." }
  ],
  "presets": [{ "name": "Review cards" }]
}
{% endschema %}
`,
          },
        ],
      }),
      { shopifyClient: mockShopifyClient }
    );

    assert.equal(result.success, false);
    assert.equal(result.status, "inspection_failed");
    assert.equal(
      result.message?.startsWith("Building Inspection Failed: Building Inspection Failed:"),
      false,
      "aggregated inspection failures should not duplicate the Building Inspection prefix"
    );
    assert.ok(
      result.errors?.some((issue) => issue.issueCode === "prompt_review_missing_block_cards")
    );
    assert.ok(
      result.errors?.some((issue) => issue.issueCode === "prompt_review_missing_card_surface")
    );
  } finally {
    global.fetch = previousFetch;
  }
});

test("draftThemeArtifact - rejects prompt-only FAQ sections that render as static mock content", async () => {
  const key = "sections/prompt-faq.liquid";
  const mockShopifyClient = {
    url: "https://unit-test.myshopify.com/admin/api/2026-01/graphql.json",
    requestConfig: {
      headers: new Headers({ "x-shopify-access-token": "fake-token" })
    },
    session: { shop: "unit-test.myshopify.com" },
    request: async () => {}
  };
  const themeMock = createThemeFileFetchMock({
    key,
    initialValue: "",
    existing: false,
  });
  const previousFetch = global.fetch;
  global.fetch = themeMock.handler;

  try {
    const result = await execute(
      draftThemeArtifact.schema.parse({
        themeId: 111,
        mode: "create",
        plannerHandoff: {
          intent: "new_section",
          themeTarget: { themeId: 111, themeRole: null },
          sectionBlueprint: {
            archetype: "faq_collapsible",
            category: "interactive",
            qualityTarget: "theme_consistent",
            promptContract: {
              promptOnly: true,
              interactionPattern: "accordion",
              requiresInteractiveBehavior: true,
              requiresThemeEditorSafeInteractivity: true,
            },
          },
        },
        files: [
          {
            key,
            value: `
<style>
  #shopify-section-{{ section.id }} .prompt-faq {
    display: grid;
    gap: 16px;
    padding: 32px 0;
  }
</style>
<section class="prompt-faq page-width">
  <h2>{{ section.settings.heading }}</h2>
  <div class="prompt-faq__item">
    <h3>{{ section.settings.question }}</h3>
    <p>{{ section.settings.answer }}</p>
  </div>
</section>
{% schema %}
{
  "name": "Prompt FAQ",
  "settings": [
    { "type": "text", "id": "heading", "label": "Heading", "default": "Frequently asked questions" },
    { "type": "text", "id": "question", "label": "Question", "default": "How long is shipping?" },
    { "type": "richtext", "id": "answer", "label": "Answer", "default": "<p>Shipping takes 2-4 business days.</p>" }
  ],
  "presets": [{ "name": "Prompt FAQ" }]
}
{% endschema %}
`,
          },
        ],
      }),
      { shopifyClient: mockShopifyClient }
    );

    assert.equal(result.success, false);
    assert.equal(result.status, "inspection_failed");
    assert.ok(
      result.errors?.some((issue) => issue.issueCode === "prompt_interaction_missing_behavior")
    );
  } finally {
    global.fetch = previousFetch;
  }
});

test("draftThemeArtifact - rejects slider-like generated sections without editable slide blocks", async () => {
  const key = "sections/hero-slider.liquid";
  const mockShopifyClient = {
    url: "https://unit-test.myshopify.com/admin/api/2026-01/graphql.json",
    requestConfig: {
      headers: new Headers({ "x-shopify-access-token": "fake-token" })
    },
    session: { shop: "unit-test.myshopify.com" },
    request: async () => {}
  };
  const themeMock = createThemeFileFetchMock({
    key,
    initialValue: "",
    existing: false,
  });
  const previousFetch = global.fetch;
  global.fetch = themeMock.handler;

  try {
    const result = await execute(
      draftThemeArtifact.schema.parse({
        themeId: 111,
        mode: "create",
        plannerHandoff: {
          intent: "new_section",
          themeTarget: { themeId: 111, themeRole: null },
          sectionBlueprint: {
            archetype: "media_carousel",
            category: "hybrid",
            qualityTarget: "theme_consistent",
            promptContract: {
              promptOnly: true,
              interactionPattern: "carousel",
              requiresSliderControls: true,
              requiresSliderBehavior: true,
              requiresInteractiveBehavior: true,
              requiresThemeEditorSafeInteractivity: true,
            },
          },
        },
        files: [
          {
            key,
            value: `
<style>
  #shopify-section-{{ section.id }} .hero-slider {
    display: grid;
    gap: 20px;
    padding: 32px 0;
  }

  #shopify-section-{{ section.id }} .hero-slider__track {
    display: grid;
    grid-auto-flow: column;
    grid-auto-columns: 100%;
    gap: 16px;
    overflow-x: auto;
    scroll-snap-type: x mandatory;
  }

  #shopify-section-{{ section.id }} .hero-slider__slide {
    scroll-snap-align: start;
    border-radius: 20px;
    padding: 32px;
    background: #f7f3ec;
  }

  @media screen and (max-width: 749px) {
    #shopify-section-{{ section.id }} .hero-slider__slide {
      padding: 20px;
    }
  }
</style>
<section class="hero-slider page-width">
  <h2>{{ section.settings.heading }}</h2>
  <div class="hero-slider__track" data-slider>
    <article class="hero-slider__slide">
      <h3>{{ section.settings.slide_heading }}</h3>
      <p>{{ section.settings.slide_text }}</p>
    </article>
    <article class="hero-slider__slide">
      <h3>{{ section.settings.slide_heading_2 }}</h3>
      <p>{{ section.settings.slide_text_2 }}</p>
    </article>
  </div>
</section>
{% schema %}
{
  "name": "Hero slider",
  "settings": [
    { "type": "text", "id": "heading", "label": "Heading", "default": "Featured stories" },
    { "type": "text", "id": "slide_heading", "label": "Slide heading", "default": "First slide" },
    { "type": "textarea", "id": "slide_text", "label": "Slide text", "default": "Static slide copy." },
    { "type": "text", "id": "slide_heading_2", "label": "Second slide heading", "default": "Second slide" },
    { "type": "textarea", "id": "slide_text_2", "label": "Second slide text", "default": "Static slide copy." }
  ],
  "presets": [{ "name": "Hero slider" }]
}
{% endschema %}
`,
          },
        ],
      }),
      { shopifyClient: mockShopifyClient }
    );

    assert.equal(result.success, false);
    assert.equal(result.status, "inspection_failed");
    assert.ok(
      result.errors?.some((issue) => issue.issueCode === "section_contract_carousel_missing_editable_blocks"),
      "slider-looking generated sections should require schema.blocks plus section.blocks rendering"
    );
    assert.ok(
      result.errors?.some((issue) => issue.issueCode === "section_contract_carousel_missing_preset_blocks"),
      "slider contracts should also require preset slide blocks so the editor opens with editable content"
    );
  } finally {
    global.fetch = previousFetch;
  }
});

test("draftThemeArtifact - accepts slider sections with editable slide blocks and responsive behavior", async () => {
  const key = "sections/hero-slider.liquid";
  const mockShopifyClient = {
    url: "https://unit-test.myshopify.com/admin/api/2026-01/graphql.json",
    requestConfig: {
      headers: new Headers({ "x-shopify-access-token": "fake-token" })
    },
    session: { shop: "unit-test.myshopify.com" },
    request: async () => {}
  };
  const themeMock = createThemeFileFetchMock({
    key,
    initialValue: "",
    existing: false,
  });
  const previousFetch = global.fetch;
  global.fetch = themeMock.handler;

  try {
    const result = await execute(
      draftThemeArtifact.schema.parse({
        themeId: 111,
        mode: "create",
        plannerHandoff: {
          intent: "new_section",
          themeTarget: { themeId: 111, themeRole: null },
          sectionBlueprint: {
            archetype: "media_carousel",
            category: "hybrid",
            qualityTarget: "theme_consistent",
            promptContract: {
              promptOnly: true,
              interactionPattern: "carousel",
              requiresSliderControls: true,
              requiresSliderBehavior: true,
              requiresInteractiveBehavior: true,
              requiresThemeEditorSafeInteractivity: true,
            },
          },
        },
        files: [
          {
            key,
            value: `
<style>
  #shopify-section-{{ section.id }} .hero-slider {
    display: grid;
    gap: 20px;
    padding: 32px 0;
  }

  #shopify-section-{{ section.id }} .hero-slider__track {
    display: grid;
    grid-auto-flow: column;
    grid-auto-columns: 82%;
    gap: 16px;
    overflow-x: auto;
    scroll-snap-type: x mandatory;
  }

  #shopify-section-{{ section.id }} .hero-slider__slide {
    scroll-snap-align: start;
    border-radius: 20px;
    padding: 32px;
    background: #f7f3ec;
  }

  @media screen and (min-width: 750px) {
    #shopify-section-{{ section.id }} .hero-slider__track {
      grid-auto-columns: minmax(0, 48%);
    }
  }

  @media screen and (max-width: 749px) {
    #shopify-section-{{ section.id }} .hero-slider__slide {
      padding: 20px;
    }
  }
</style>
<section class="hero-slider page-width">
  <h2>{{ section.settings.heading }}</h2>
  <div class="hero-slider__track" data-slider>
    {% for block in section.blocks %}
      <article class="hero-slider__slide" {{ block.shopify_attributes }}>
        <h3>{{ block.settings.heading }}</h3>
        <p>{{ block.settings.text }}</p>
      </article>
    {% endfor %}
  </div>
</section>
{% schema %}
{
  "name": "Hero slider",
  "settings": [
    { "type": "text", "id": "heading", "label": "Heading", "default": "Featured stories" }
  ],
  "blocks": [
    {
      "type": "slide",
      "name": "Slide",
      "settings": [
        { "type": "text", "id": "heading", "label": "Heading", "default": "Slide heading" },
        { "type": "textarea", "id": "text", "label": "Text", "default": "Slide copy." }
      ]
    }
  ],
  "presets": [
    { "name": "Hero slider", "blocks": [{ "type": "slide" }, { "type": "slide" }] }
  ]
}
{% endschema %}
`,
          },
        ],
      }),
      { shopifyClient: mockShopifyClient }
    );

    assert.equal(result.success, true);
    assert.equal(result.status, "preview_ready");
  } finally {
    global.fetch = previousFetch;
  }
});

test("draftThemeArtifact - accepts intrinsically responsive generated sections without media queries", async () => {
  const key = "sections/flex-wrap-features.liquid";
  const mockShopifyClient = {
    url: "https://unit-test.myshopify.com/admin/api/2026-01/graphql.json",
    requestConfig: {
      headers: new Headers({ "x-shopify-access-token": "fake-token" })
    },
    session: { shop: "unit-test.myshopify.com" },
    request: async () => {}
  };
  const themeMock = createThemeFileFetchMock({
    key,
    initialValue: "",
    existing: false,
  });
  const previousFetch = global.fetch;
  global.fetch = themeMock.handler;

  try {
    const result = await execute(
      draftThemeArtifact.schema.parse({
        themeId: 111,
        mode: "create",
        plannerHandoff: {
          intent: "new_section",
          themeTarget: { themeId: 111, themeRole: null },
          sectionBlueprint: {
            archetype: "content_section",
            category: "static",
            qualityTarget: "theme_consistent",
            promptContract: { promptOnly: true },
          },
        },
        files: [
          {
            key,
            value: `
<style>
  #shopify-section-{{ section.id }} .flex-wrap-features {
    display: flex;
    flex-wrap: wrap;
    gap: 16px;
    padding: 32px 0;
  }

  #shopify-section-{{ section.id }} .flex-wrap-features__item {
    flex: 1 1 14rem;
    border-radius: 16px;
    background: #ffffff;
    padding: 18px;
  }
</style>
<section class="flex-wrap-features page-width">
  <article class="flex-wrap-features__item">{{ section.settings.first }}</article>
  <article class="flex-wrap-features__item">{{ section.settings.second }}</article>
</section>
{% schema %}
{
  "name": "Flex wrap features",
  "settings": [
    { "type": "text", "id": "first", "label": "First item", "default": "Fast setup" },
    { "type": "text", "id": "second", "label": "Second item", "default": "Mobile friendly" }
  ],
  "presets": [{ "name": "Flex wrap features" }]
}
{% endschema %}
`,
          },
        ],
      }),
      { shopifyClient: mockShopifyClient }
    );

    assert.equal(result.success, true);
    assert.equal(result.status, "preview_ready");
  } finally {
    global.fetch = previousFetch;
  }
});

test("draftThemeArtifact - rejects generated sections without explicit mobile behavior", async () => {
  const key = "sections/responsive-contract.liquid";
  const mockShopifyClient = {
    url: "https://unit-test.myshopify.com/admin/api/2026-01/graphql.json",
    requestConfig: {
      headers: new Headers({ "x-shopify-access-token": "fake-token" })
    },
    session: { shop: "unit-test.myshopify.com" },
    request: async () => {}
  };
  const themeMock = createThemeFileFetchMock({
    key,
    initialValue: "",
    existing: false,
  });
  const previousFetch = global.fetch;
  global.fetch = themeMock.handler;

  try {
    const result = await execute(
      draftThemeArtifact.schema.parse({
        themeId: 111,
        mode: "create",
        plannerHandoff: {
          intent: "new_section",
          themeTarget: { themeId: 111, themeRole: null },
          sectionBlueprint: {
            archetype: "content_section",
            category: "static",
            qualityTarget: "theme_consistent",
            promptContract: { promptOnly: true },
          },
        },
        files: [
          {
            key,
            value: `
<style>
  #shopify-section-{{ section.id }} .responsive-contract {
    display: grid;
    gap: 24px;
    padding: 40px;
    border-radius: 20px;
    background: #ffffff;
  }
</style>
<section class="responsive-contract page-width">
  <h2>{{ section.settings.heading }}</h2>
  <p>{{ section.settings.copy }}</p>
</section>
{% schema %}
{
  "name": "Responsive contract",
  "settings": [
    { "type": "text", "id": "heading", "label": "Heading", "default": "Desktop only" },
    { "type": "textarea", "id": "copy", "label": "Copy", "default": "This section has no mobile behavior." }
  ],
  "presets": [{ "name": "Responsive contract" }]
}
{% endschema %}
`,
          },
        ],
      }),
      { shopifyClient: mockShopifyClient }
    );

    assert.equal(result.success, false);
    assert.equal(result.status, "inspection_failed");
    assert.ok(
      result.errors?.some((issue) => issue.issueCode === "section_contract_missing_responsive_behavior")
    );
  } finally {
    global.fetch = previousFetch;
  }
});

test("draftThemeArtifact - does not apply generated-section contracts to edit-mode rewrites", async () => {
  const key = "sections/existing-static.liquid";
  const existingLiquid = `
<style>
  #shopify-section-{{ section.id }} .existing-static {
    display: grid;
    gap: 24px;
    padding: 40px;
    border-radius: 20px;
    background: #ffffff;
  }
</style>
<section class="existing-static page-width">
  <h2>{{ section.settings.heading }}</h2>
</section>
{% schema %}
{
  "name": "Existing static",
  "settings": [
    { "type": "text", "id": "heading", "label": "Heading", "default": "Existing" }
  ],
  "presets": [{ "name": "Existing static" }]
}
{% endschema %}
`;
  const mockShopifyClient = {
    url: "https://unit-test.myshopify.com/admin/api/2026-01/graphql.json",
    requestConfig: {
      headers: new Headers({ "x-shopify-access-token": "fake-token" })
    },
    session: { shop: "unit-test.myshopify.com" },
    request: async () => {}
  };
  const themeMock = createThemeFileFetchMock({
    key,
    initialValue: existingLiquid,
    existing: true,
  });
  const previousFetch = global.fetch;
  global.fetch = themeMock.handler;

  try {
    const result = await execute(
      draftThemeArtifact.schema.parse({
        themeId: 111,
        mode: "edit",
        plannerHandoff: {
          intent: "existing_edit",
          targetFile: key,
          themeTarget: { themeId: 111, themeRole: null },
          sectionBlueprint: {
            archetype: "content_section",
            category: "static",
            qualityTarget: "theme_consistent",
            promptContract: { promptOnly: true },
          },
        },
        files: [
          {
            key,
            value: existingLiquid,
          },
        ],
      }),
      { shopifyClient: mockShopifyClient }
    );

    assert.equal(result.success, true);
    assert.equal(result.status, "preview_ready");
    assert.ok(
      !result.errors?.some((issue) => issue.issueCode === "section_contract_missing_responsive_behavior")
    );
  } finally {
    global.fetch = previousFetch;
  }
});

test("draftThemeArtifact - accepts single testimonial sections that use settings instead of repeatable blocks", async () => {
  const key = "sections/single-testimonial.liquid";
  const mockShopifyClient = {
    url: "https://unit-test.myshopify.com/admin/api/2026-01/graphql.json",
    requestConfig: {
      headers: new Headers({ "x-shopify-access-token": "fake-token" })
    },
    session: { shop: "unit-test.myshopify.com" },
    request: async () => {}
  };
  const themeMock = createThemeFileFetchMock({
    key,
    initialValue: "",
    existing: false,
  });
  const previousFetch = global.fetch;
  global.fetch = themeMock.handler;

  try {
    const result = await execute(
      draftThemeArtifact.schema.parse({
        themeId: 111,
        mode: "create",
        plannerHandoff: {
          intent: "new_section",
          themeTarget: { themeId: 111, themeRole: null },
          sectionBlueprint: {
            archetype: "review_section",
            category: "static",
            qualityTarget: "theme_consistent",
            promptContract: {
              promptOnly: true,
              requiresReviewContentSignals: true,
              requiresReviewCardSurface: true,
              requiresBlockBasedCards: false,
              requiresRatingOrQuoteSignal: true,
            },
          },
        },
        files: [
          {
            key,
            value: `
<style>
  #shopify-section-{{ section.id }} .single-testimonial {
    display: flex;
    flex-wrap: wrap;
    gap: 16px;
    padding: 32px 0;
  }

  #shopify-section-{{ section.id }} .single-testimonial__card {
    flex: 1 1 18rem;
    border-radius: 18px;
    background: #ffffff;
    padding: 24px;
  }
</style>
<section class="single-testimonial page-width">
  <article class="single-testimonial__card">
    <p class="single-testimonial__rating">{{ section.settings.rating }}</p>
    <blockquote>{{ section.settings.quote }}</blockquote>
    <p>{{ section.settings.author }}</p>
  </article>
</section>
{% schema %}
{
  "name": "Single testimonial",
  "settings": [
    { "type": "text", "id": "rating", "label": "Rating", "default": "★★★★★" },
    { "type": "textarea", "id": "quote", "label": "Quote", "default": "This changed our routine." },
    { "type": "text", "id": "author", "label": "Author", "default": "Mila" }
  ],
  "presets": [{ "name": "Single testimonial" }]
}
{% endschema %}
`,
          },
        ],
      }),
      { shopifyClient: mockShopifyClient }
    );

    assert.equal(result.success, true);
    assert.equal(result.status, "preview_ready");
  } finally {
    global.fetch = previousFetch;
  }
});

test("draftThemeArtifact - accepts prompt-only FAQ sections with native disclosure behavior", async () => {
  const key = "sections/prompt-faq.liquid";
  const mockShopifyClient = {
    url: "https://unit-test.myshopify.com/admin/api/2026-01/graphql.json",
    requestConfig: {
      headers: new Headers({ "x-shopify-access-token": "fake-token" })
    },
    session: { shop: "unit-test.myshopify.com" },
    request: async () => {}
  };
  const themeMock = createThemeFileFetchMock({
    key,
    initialValue: "",
    existing: false,
  });
  const previousFetch = global.fetch;
  global.fetch = themeMock.handler;

  try {
    const result = await execute(
      draftThemeArtifact.schema.parse({
        themeId: 111,
        mode: "create",
        plannerHandoff: {
          intent: "new_section",
          themeTarget: { themeId: 111, themeRole: null },
          sectionBlueprint: {
            archetype: "faq_collapsible",
            category: "interactive",
            qualityTarget: "theme_consistent",
            promptContract: {
              promptOnly: true,
              interactionPattern: "accordion",
              requiresInteractiveBehavior: true,
              requiresThemeEditorSafeInteractivity: true,
            },
          },
        },
        files: [
          {
            key,
            value: `
<style>
  #shopify-section-{{ section.id }} .prompt-faq {
    display: grid;
    gap: 16px;
    padding: 32px 0;
  }

  #shopify-section-{{ section.id }} .prompt-faq__item {
    border-bottom: 1px solid rgba(0, 0, 0, 0.12);
    padding-bottom: 16px;
  }

  @media screen and (max-width: 749px) {
    #shopify-section-{{ section.id }} .prompt-faq {
      gap: 12px;
      padding-inline: 16px;
    }
  }
</style>
<section class="prompt-faq page-width">
  <h2>{{ section.settings.heading }}</h2>
  {% for block in section.blocks %}
    <details class="prompt-faq__item" {{ block.shopify_attributes }}>
      <summary>{{ block.settings.question }}</summary>
      <div class="prompt-faq__answer rte">{{ block.settings.answer }}</div>
    </details>
  {% endfor %}
</section>
{% schema %}
{
  "name": "Prompt FAQ",
  "blocks": [
    {
      "type": "item",
      "name": "Item",
      "settings": [
        { "type": "text", "id": "question", "label": "Question", "default": "How long is shipping?" },
        { "type": "richtext", "id": "answer", "label": "Answer", "default": "<p>Shipping takes 2-4 business days.</p>" }
      ]
    }
  ],
  "settings": [
    { "type": "text", "id": "heading", "label": "Heading", "default": "Frequently asked questions" }
  ],
  "presets": [{ "name": "Prompt FAQ", "blocks": [{ "type": "item" }, { "type": "item" }] }]
}
{% endschema %}
`,
          },
        ],
      }),
      { shopifyClient: mockShopifyClient }
    );

    assert.equal(result.success, true);
    assert.equal(result.status, "preview_ready");
  } finally {
    global.fetch = previousFetch;
  }
});

test("draftThemeArtifact - rejects prompt-only video sections without a video source and render path", async () => {
  const key = "sections/prompt-video.liquid";
  const mockShopifyClient = {
    url: "https://unit-test.myshopify.com/admin/api/2026-01/graphql.json",
    requestConfig: {
      headers: new Headers({ "x-shopify-access-token": "fake-token" })
    },
    session: { shop: "unit-test.myshopify.com" },
    request: async () => {}
  };
  const themeMock = createThemeFileFetchMock({
    key,
    initialValue: "",
    existing: false,
  });
  const previousFetch = global.fetch;
  global.fetch = themeMock.handler;

  try {
    const result = await execute(
      draftThemeArtifact.schema.parse({
        themeId: 111,
        mode: "create",
        plannerHandoff: {
          intent: "new_section",
          themeTarget: { themeId: 111, themeRole: null },
          sectionBlueprint: {
            archetype: "video_section",
            category: "media",
            qualityTarget: "theme_consistent",
            promptContract: {
              promptOnly: true,
              requiresVideoSourceSetting: true,
              requiresVideoRenderablePath: true,
            },
          },
        },
        files: [
          {
            key,
            value: `
<style>
  #shopify-section-{{ section.id }} .prompt-video {
    display: grid;
    gap: 24px;
    padding: 32px;
  }
</style>
<section class="prompt-video page-width">
  <h2>{{ section.settings.heading }}</h2>
  <p>{{ section.settings.copy }}</p>
</section>
{% schema %}
{
  "name": "Prompt video",
  "settings": [
    { "type": "text", "id": "heading", "label": "Heading", "default": "Watch the story" },
    { "type": "text", "id": "copy", "label": "Copy", "default": "A text-only baseline." }
  ],
  "presets": [{ "name": "Prompt video" }]
}
{% endschema %}
`,
          },
        ],
      }),
      { shopifyClient: mockShopifyClient }
    );

    assert.equal(result.success, false);
    assert.equal(result.status, "inspection_failed");
    assert.ok(
      result.errors?.some((issue) => issue.issueCode === "prompt_video_missing_source_setting")
    );
    assert.ok(
      result.errors?.some((issue) => issue.issueCode === "prompt_video_missing_render_path")
    );
  } finally {
    global.fetch = previousFetch;
  }
});

test("draftThemeArtifact - rejects prompt-only PDP sections without product context", async () => {
  const key = "sections/pdp-conversion.liquid";
  const mockShopifyClient = {
    url: "https://unit-test.myshopify.com/admin/api/2026-01/graphql.json",
    requestConfig: {
      headers: new Headers({ "x-shopify-access-token": "fake-token" })
    },
    session: { shop: "unit-test.myshopify.com" },
    request: async () => {}
  };
  const themeMock = createThemeFileFetchMock({
    key,
    initialValue: "",
    existing: false,
  });
  const previousFetch = global.fetch;
  global.fetch = themeMock.handler;

  try {
    const result = await execute(
      draftThemeArtifact.schema.parse({
        themeId: 111,
        mode: "create",
        plannerHandoff: {
          intent: "new_section",
          template: "product",
          themeTarget: { themeId: 111, themeRole: null },
          sectionBlueprint: {
            archetype: "pdp_section",
            category: "commerce",
            qualityTarget: "theme_consistent",
            promptContract: {
              promptOnly: true,
              requiresProductContextOrSetting: true,
              requiresCommerceActionSignal: true,
            },
          },
        },
        files: [
          {
            key,
            value: `
<style>
  #shopify-section-{{ section.id }} .pdp-conversion {
    display: grid;
    gap: 24px;
    padding: 32px;
    border-radius: 20px;
    background: #ffffff;
  }
</style>
<section class="pdp-conversion page-width">
  <h2>{{ section.settings.heading }}</h2>
  <p class="pdp-conversion__price">$49.00</p>
  <button type="button">Add to cart</button>
</section>
{% schema %}
{
  "name": "PDP conversion",
  "settings": [
    { "type": "text", "id": "heading", "label": "Heading", "default": "Complete your routine" }
  ],
  "presets": [{ "name": "PDP conversion" }]
}
{% endschema %}
`,
          },
        ],
      }),
      { shopifyClient: mockShopifyClient }
    );

    assert.equal(result.success, false);
    assert.equal(result.status, "inspection_failed");
    assert.ok(
      result.errors?.some((issue) => issue.issueCode === "prompt_pdp_missing_product_source")
    );
  } finally {
    global.fetch = previousFetch;
  }
});

test("draftThemeArtifact - rejects featured product sections that use static product markup", async () => {
  const key = "sections/featured-product-static.liquid";
  const mockShopifyClient = {
    url: "https://unit-test.myshopify.com/admin/api/2026-01/graphql.json",
    requestConfig: {
      headers: new Headers({ "x-shopify-access-token": "fake-token" })
    },
    session: { shop: "unit-test.myshopify.com" },
    request: async () => {}
  };
  const themeMock = createThemeFileFetchMock({
    key,
    initialValue: "",
    existing: false,
  });
  const previousFetch = global.fetch;
  global.fetch = themeMock.handler;

  try {
    const result = await execute(
      draftThemeArtifact.schema.parse({
        themeId: 111,
        mode: "create",
        plannerHandoff: {
          intent: "new_section",
          themeTarget: { themeId: 111, themeRole: null },
          sectionBlueprint: {
            archetype: "featured_product_section",
            category: "commerce",
            qualityTarget: "theme_consistent",
            promptContract: {
              promptOnly: true,
              requiresProductContextOrSetting: true,
              requiresCommerceActionSignal: true,
            },
          },
        },
        files: [
          {
            key,
            value: `
<style>
  #shopify-section-{{ section.id }} .featured-product-static {
    display: grid;
    gap: 20px;
    padding: 32px;
    border-radius: 20px;
    background: #ffffff;
  }

  @media screen and (max-width: 749px) {
    #shopify-section-{{ section.id }} .featured-product-static {
      padding: 20px;
    }
  }
</style>
<section class="featured-product-static page-width">
  <h2>{{ section.settings.heading }}</h2>
  <p class="featured-product-static__title">Hydrating serum</p>
  <p class="featured-product-static__price">$49.00</p>
  <button type="button">Add to cart</button>
</section>
{% schema %}
{
  "name": "Featured product static",
  "settings": [
    { "type": "text", "id": "heading", "label": "Heading", "default": "Featured product" }
  ],
  "presets": [{ "name": "Featured product static" }]
}
{% endschema %}
`,
          },
        ],
      }),
      { shopifyClient: mockShopifyClient }
    );

    assert.equal(result.success, false);
    assert.equal(result.status, "inspection_failed");
    assert.ok(
      result.errors?.some((issue) => issue.issueCode === "section_contract_missing_product_source")
    );
  } finally {
    global.fetch = previousFetch;
  }
});

test("draftThemeArtifact - rejects featured product sections that ignore their product setting for fake commerce", async () => {
  const key = "sections/featured-product-fake.liquid";
  const mockShopifyClient = {
    url: "https://unit-test.myshopify.com/admin/api/2026-01/graphql.json",
    requestConfig: {
      headers: new Headers({ "x-shopify-access-token": "fake-token" })
    },
    session: { shop: "unit-test.myshopify.com" },
    request: async () => {}
  };
  const themeMock = createThemeFileFetchMock({
    key,
    initialValue: "",
    existing: false,
  });
  const previousFetch = global.fetch;
  global.fetch = themeMock.handler;

  try {
    const result = await execute(
      draftThemeArtifact.schema.parse({
        themeId: 111,
        mode: "create",
        plannerHandoff: {
          intent: "new_section",
          themeTarget: { themeId: 111, themeRole: null },
          sectionBlueprint: {
            archetype: "featured_product_section",
            category: "commerce",
            qualityTarget: "theme_consistent",
            promptContract: {
              promptOnly: true,
              requiresProductContextOrSetting: true,
              requiresCommerceActionSignal: true,
            },
          },
        },
        files: [
          {
            key,
            value: `
<style>
  #shopify-section-{{ section.id }} .featured-product-fake {
    display: flex;
    flex-wrap: wrap;
    gap: 20px;
    padding: 32px;
    border-radius: 20px;
    background: #ffffff;
  }
</style>
<section class="featured-product-fake page-width">
  {% if section.settings.product == blank %}
    <p>Select a product in the theme editor.</p>
  {% endif %}
  <div class="featured-product-fake__product-card">
    <h2>Hydrating serum</h2>
    <p class="featured-product-fake__price">$49.00</p>
    <button type="button">Add to cart</button>
  </div>
</section>
{% schema %}
{
  "name": "Featured product fake",
  "settings": [
    { "type": "product", "id": "product", "label": "Product" }
  ],
  "presets": [{ "name": "Featured product fake" }]
}
{% endschema %}
`,
          },
        ],
      }),
      { shopifyClient: mockShopifyClient }
    );

    assert.equal(result.success, false);
    assert.equal(result.status, "inspection_failed");
    assert.ok(
      result.errors?.some((issue) => issue.issueCode === "section_contract_static_product_markup")
    );
  } finally {
    global.fetch = previousFetch;
  }
});

test("draftThemeArtifact - accepts featured product sections with real source rendering and safe empty state", async () => {
  const key = "sections/featured-product-source.liquid";
  const mockShopifyClient = {
    url: "https://unit-test.myshopify.com/admin/api/2026-01/graphql.json",
    requestConfig: {
      headers: new Headers({ "x-shopify-access-token": "fake-token" })
    },
    session: { shop: "unit-test.myshopify.com" },
    request: async () => {}
  };
  const themeMock = createThemeFileFetchMock({
    key,
    initialValue: "",
    existing: false,
  });
  const previousFetch = global.fetch;
  global.fetch = themeMock.handler;

  try {
    const result = await execute(
      draftThemeArtifact.schema.parse({
        themeId: 111,
        mode: "create",
        plannerHandoff: {
          intent: "new_section",
          themeTarget: { themeId: 111, themeRole: null },
          sectionBlueprint: {
            archetype: "featured_product_section",
            category: "commerce",
            qualityTarget: "theme_consistent",
            promptContract: {
              promptOnly: true,
              requiresProductContextOrSetting: true,
              requiresCommerceActionSignal: true,
            },
          },
        },
        files: [
          {
            key,
            value: `
<style>
  #shopify-section-{{ section.id }} .featured-product-source {
    display: flex;
    flex-wrap: wrap;
    gap: 20px;
    padding: 32px;
    border-radius: 20px;
    background: #ffffff;
  }
</style>
{% assign featured_product = section.settings.product %}
<section class="featured-product-source page-width">
  {% if featured_product != blank %}
    <h2>{{ featured_product.title }}</h2>
    <p>{{ featured_product.price | money }}</p>
    {% form 'product', featured_product %}
      <input type="hidden" name="id" value="{{ featured_product.selected_or_first_available_variant.id }}">
      <button type="submit">{{ section.settings.button_label }}</button>
    {% endform %}
  {% else %}
    <p>Select a product in the theme editor.</p>
  {% endif %}
</section>
{% schema %}
{
  "name": "Featured product source",
  "settings": [
    { "type": "product", "id": "product", "label": "Product" },
    { "type": "text", "id": "button_label", "label": "Button label", "default": "Add to cart" }
  ],
  "presets": [{ "name": "Featured product source" }]
}
{% endschema %}
`,
          },
        ],
      }),
      { shopifyClient: mockShopifyClient }
    );

    assert.equal(result.success, true);
    assert.equal(result.status, "preview_ready");
  } finally {
    global.fetch = previousFetch;
  }
});

test("draftThemeArtifact - rejects featured collection sections that ignore their collection setting", async () => {
  const key = "sections/featured-collection-fake.liquid";
  const mockShopifyClient = {
    url: "https://unit-test.myshopify.com/admin/api/2026-01/graphql.json",
    requestConfig: {
      headers: new Headers({ "x-shopify-access-token": "fake-token" })
    },
    session: { shop: "unit-test.myshopify.com" },
    request: async () => {}
  };
  const themeMock = createThemeFileFetchMock({
    key,
    initialValue: "",
    existing: false,
  });
  const previousFetch = global.fetch;
  global.fetch = themeMock.handler;

  try {
    const result = await execute(
      draftThemeArtifact.schema.parse({
        themeId: 111,
        mode: "create",
        plannerHandoff: {
          intent: "new_section",
          themeTarget: { themeId: 111, themeRole: null },
          sectionBlueprint: {
            archetype: "featured_collection_section",
            category: "media",
            qualityTarget: "theme_consistent",
            promptContract: {
              promptOnly: true,
              requiresCollectionContextOrSetting: true,
            },
          },
        },
        files: [
          {
            key,
            value: `
<style>
  #shopify-section-{{ section.id }} .featured-collection-fake {
    display: flex;
    flex-wrap: wrap;
    gap: 16px;
    padding: 32px;
  }
</style>
<section class="featured-collection-fake page-width">
  {% if section.settings.collection == blank %}
    <p>Select a collection in the theme editor.</p>
  {% endif %}
  <article class="featured-collection-fake__product-card">
    <h2>Hydrating serum</h2>
    <p>$49.00</p>
  </article>
</section>
{% schema %}
{
  "name": "Featured collection fake",
  "settings": [
    { "type": "collection", "id": "collection", "label": "Collection" }
  ],
  "presets": [{ "name": "Featured collection fake" }]
}
{% endschema %}
`,
          },
        ],
      }),
      { shopifyClient: mockShopifyClient }
    );

    assert.equal(result.success, false);
    assert.equal(result.status, "inspection_failed");
    assert.ok(
      result.errors?.some((issue) => issue.issueCode === "section_contract_static_collection_markup")
    );
  } finally {
    global.fetch = previousFetch;
  }
});

test("draftThemeArtifact - accepts featured collection sections with real source rendering and safe empty state", async () => {
  const key = "sections/featured-collection-source.liquid";
  const mockShopifyClient = {
    url: "https://unit-test.myshopify.com/admin/api/2026-01/graphql.json",
    requestConfig: {
      headers: new Headers({ "x-shopify-access-token": "fake-token" })
    },
    session: { shop: "unit-test.myshopify.com" },
    request: async () => {}
  };
  const themeMock = createThemeFileFetchMock({
    key,
    initialValue: "",
    existing: false,
  });
  const previousFetch = global.fetch;
  global.fetch = themeMock.handler;

  try {
    const result = await execute(
      draftThemeArtifact.schema.parse({
        themeId: 111,
        mode: "create",
        plannerHandoff: {
          intent: "new_section",
          themeTarget: { themeId: 111, themeRole: null },
          sectionBlueprint: {
            archetype: "featured_collection_section",
            category: "media",
            qualityTarget: "theme_consistent",
            promptContract: {
              promptOnly: true,
              requiresCollectionContextOrSetting: true,
            },
          },
        },
        files: [
          {
            key,
            value: `
<style>
  #shopify-section-{{ section.id }} .featured-collection-source {
    display: flex;
    flex-wrap: wrap;
    gap: 16px;
    padding: 32px;
  }

  #shopify-section-{{ section.id }} .featured-collection-source__card {
    flex: 1 1 14rem;
    border-radius: 16px;
    background: #ffffff;
    padding: 18px;
  }
</style>
{% assign featured_collection = section.settings.collection %}
<section class="featured-collection-source page-width">
  {% if featured_collection != blank %}
    <h2>{{ featured_collection.title }}</h2>
    {% for product in featured_collection.products limit: 3 %}
      <article class="featured-collection-source__card">
        <h3>{{ product.title }}</h3>
      </article>
    {% endfor %}
  {% else %}
    <p>Select a collection in the theme editor.</p>
  {% endif %}
</section>
{% schema %}
{
  "name": "Collection source",
  "settings": [
    { "type": "collection", "id": "collection", "label": "Collection" }
  ],
  "presets": [{ "name": "Collection source" }]
}
{% endschema %}
`,
          },
        ],
      }),
      { shopifyClient: mockShopifyClient }
    );

    assert.equal(result.success, true);
    assert.equal(result.status, "preview_ready");
  } finally {
    global.fetch = previousFetch;
  }
});

test("draftThemeArtifact - accepts prompt-only video sections with blank-safe video source rendering", async () => {
  const key = "sections/prompt-video.liquid";
  const mockShopifyClient = {
    url: "https://unit-test.myshopify.com/admin/api/2026-01/graphql.json",
    requestConfig: {
      headers: new Headers({ "x-shopify-access-token": "fake-token" })
    },
    session: { shop: "unit-test.myshopify.com" },
    request: async () => {}
  };
  const themeMock = createThemeFileFetchMock({
    key,
    initialValue: "",
    existing: false,
  });
  const previousFetch = global.fetch;
  global.fetch = themeMock.handler;

  try {
    const result = await execute(
      draftThemeArtifact.schema.parse({
        themeId: 111,
        mode: "create",
        plannerHandoff: {
          intent: "new_section",
          themeTarget: { themeId: 111, themeRole: null },
          sectionBlueprint: {
            archetype: "video_section",
            category: "media",
            qualityTarget: "theme_consistent",
            promptContract: {
              promptOnly: true,
              requiresVideoSourceSetting: true,
              requiresVideoRenderablePath: true,
            },
          },
        },
        files: [
          {
            key,
            value: `
<style>
  #shopify-section-{{ section.id }} .prompt-video {
    display: grid;
    gap: 24px;
    padding: 32px 0;
  }

  #shopify-section-{{ section.id }} .prompt-video__media {
    border-radius: 20px;
    overflow: hidden;
  }

  @media screen and (max-width: 749px) {
    #shopify-section-{{ section.id }} .prompt-video {
      gap: 16px;
      padding: 20px 16px;
    }
  }
</style>
<section class="prompt-video page-width">
  <h2>{{ section.settings.heading }}</h2>
  <div class="prompt-video__media">
    {% if section.settings.video != blank %}
      {{ section.settings.video | video_tag: controls: true, muted: false, loop: false }}
    {% endif %}
  </div>
</section>
{% schema %}
{
  "name": "Prompt video",
  "settings": [
    { "type": "text", "id": "heading", "label": "Heading", "default": "Watch the story" },
    { "type": "video", "id": "video", "label": "Video" },
    { "type": "range", "id": "padding_top", "label": "Padding top", "min": 0, "max": 80, "step": 4, "default": 32 }
  ],
  "presets": [{ "name": "Prompt video" }]
}
{% endschema %}
`,
          },
        ],
      }),
      { shopifyClient: mockShopifyClient }
    );

    assert.equal(result.success, true);
    assert.equal(result.status, "preview_ready");
    assert.match(themeMock.getValue(), /video_tag/);
  } finally {
    global.fetch = previousFetch;
  }
});

test("draftThemeArtifact - accepts prompt-only PDP sections with product setting and product form", async () => {
  const key = "sections/pdp-conversion.liquid";
  const mockShopifyClient = {
    url: "https://unit-test.myshopify.com/admin/api/2026-01/graphql.json",
    requestConfig: {
      headers: new Headers({ "x-shopify-access-token": "fake-token" })
    },
    session: { shop: "unit-test.myshopify.com" },
    request: async () => {}
  };
  const themeMock = createThemeFileFetchMock({
    key,
    initialValue: "",
    existing: false,
  });
  const previousFetch = global.fetch;
  global.fetch = themeMock.handler;

  try {
    const result = await execute(
      draftThemeArtifact.schema.parse({
        themeId: 111,
        mode: "create",
        plannerHandoff: {
          intent: "new_section",
          template: "product",
          themeTarget: { themeId: 111, themeRole: null },
          sectionBlueprint: {
            archetype: "pdp_section",
            category: "commerce",
            qualityTarget: "theme_consistent",
            promptContract: {
              promptOnly: true,
              requiresProductContextOrSetting: true,
              requiresCommerceActionSignal: true,
            },
          },
        },
        files: [
          {
            key,
            value: `
<style>
  #shopify-section-{{ section.id }} .pdp-conversion {
    display: grid;
    gap: 20px;
    padding: 32px;
    border-radius: 20px;
    background: #ffffff;
  }

  @media screen and (max-width: 749px) {
    #shopify-section-{{ section.id }} .pdp-conversion {
      gap: 14px;
      padding: 20px;
    }
  }
</style>
{% assign featured_product = section.settings.product %}
<section class="pdp-conversion page-width">
  {% if featured_product != blank %}
    <h2>{{ featured_product.title }}</h2>
    <p>{{ featured_product.price | money }}</p>
    {% form 'product', featured_product %}
      <input type="hidden" name="id" value="{{ featured_product.selected_or_first_available_variant.id }}">
      <button type="submit">{{ section.settings.button_label }}</button>
    {% endform %}
  {% endif %}
</section>
{% schema %}
{
  "name": "PDP conversion",
  "settings": [
    { "type": "product", "id": "product", "label": "Product" },
    { "type": "text", "id": "button_label", "label": "Button label", "default": "Add to cart" },
    { "type": "range", "id": "padding_top", "label": "Padding top", "min": 0, "max": 80, "step": 4, "default": 32 }
  ],
  "presets": [{ "name": "PDP conversion" }]
}
{% endschema %}
`,
          },
        ],
      }),
      { shopifyClient: mockShopifyClient }
    );

    assert.equal(result.success, true);
    assert.equal(result.status, "preview_ready");
    assert.match(themeMock.getValue(), /\{% form 'product', featured_product %\}/);
  } finally {
    global.fetch = previousFetch;
  }
});

test("draftThemeArtifact - flags nested Liquid delimiters inside a single output tag", async () => {
  const mockShopifyClient = {
    url: "https://unit-test.myshopify.com/admin/api/2026-01/graphql.json",
    requestConfig: {
      headers: new Headers({ "x-shopify-access-token": "fake-token" })
    },
    session: { shop: "unit-test.myshopify.com" },
    request: async () => {}
  };

  const themeMock = createThemeFileFetchMock({
    key: "snippets/product-info.liquid",
    initialValue: `{% doc %}{% enddoc %}<div>{{ product.title }}</div>`,
  });
  const previousFetch = global.fetch;
  global.fetch = themeMock.handler;

  try {
    const result = await execute(
      draftThemeArtifact.schema.parse({
        themeId: 111,
        mode: "edit",
        files: [
          {
            key: "snippets/product-info.liquid",
            value: `
{% doc %}
  @param {product} product
{% enddoc %}
<div class="review-badge">
  {{ block.settings.image | image_url: width: 96 | image_tag: class: 'review-avatars-{{ block.id }}__avatar-image' }}
</div>
`,
          },
        ],
      }),
      { shopifyClient: mockShopifyClient }
    );

    assert.equal(result.success, false);
    assert.equal(result.status, "inspection_failed");
    assert.ok(
      result.errors?.some(
        (issue) => issue.issueCode === "inspection_failed_liquid_output_nesting"
      )
    );
  } finally {
    global.fetch = previousFetch;
  }
});

test("draftThemeArtifact - flags native block snippet refs that drift away from the related section schema", async () => {
  const mockShopifyClient = {
    url: "https://unit-test.myshopify.com/admin/api/2026-01/graphql.json",
    requestConfig: {
      headers: new Headers({ "x-shopify-access-token": "fake-token" })
    },
    session: { shop: "unit-test.myshopify.com" },
    request: async () => {}
  };

  const context = {
    shopifyClient: mockShopifyClient,
    tokenHash: "snippet-schema-integrity",
  };

  const previousFetch = global.fetch;
  global.fetch = createThemeFilesFetchMock({
    files: {
      "sections/main-product.liquid": `
<section class="main-product">
  {% render 'product-info', product: product, section: section %}
</section>
{% schema %}
{
  "name": "Main product",
  "blocks": [
    { "type": "text", "name": "Text", "settings": [{ "type": "text", "id": "body", "label": "Body", "default": "Hello" }] },
    { "type": "buy_buttons", "name": "Buy buttons" }
  ]
}
{% endschema %}
`,
      "snippets/product-info.liquid": `
{% doc %}
  @param {object} section
  @param {object} product
{% enddoc %}
{% for block in section.blocks %}
  <div class="product-info__block" {{ block.shopify_attributes }}>
    {% case block.type %}
      {% when 'text' %}
        <p>{{ block.settings.body }}</p>
      {% when 'buy_buttons' %}
        <button>Add to cart</button>
    {% endcase %}
  </div>
{% endfor %}
`,
    },
    themeIdFallback: 111,
  });

  rememberThemePlan(context, {
    themeId: 111,
    intent: "native_block",
    nextReadKeys: ["sections/main-product.liquid", "snippets/product-info.liquid"],
    nextWriteKeys: ["sections/main-product.liquid", "snippets/product-info.liquid"],
    plannerHandoff: {
      intent: "native_block",
      themeTarget: { themeId: 111, themeRole: null },
      requiredReadKeys: ["sections/main-product.liquid", "snippets/product-info.liquid"],
      nextWriteKeys: ["sections/main-product.liquid", "snippets/product-info.liquid"],
      architecture: {
        primarySectionFile: "sections/main-product.liquid",
        usesThemeBlocks: false,
        snippetRendererKeys: ["snippets/product-info.liquid"],
        hasBlockShopifyAttributes: true,
      },
    },
  });

  try {
    const result = await execute(
      draftThemeArtifact.schema.parse({
        themeId: 111,
        mode: "edit",
        files: [
          {
            key: "snippets/product-info.liquid",
            value: `
{% doc %}
  @param {object} section
  @param {object} product
{% enddoc %}
{% for block in section.blocks %}
  <div class="product-info__block" {{ block.shopify_attributes }}>
    {% case block.type %}
      {% when 'text' %}
        <p>{{ block.settings.body }}</p>
      {% when 'review_badge' %}
        <p>{{ block.settings.badge_label }}</p>
      {% when 'buy_buttons' %}
        <button>Add to cart</button>
    {% endcase %}
  </div>
{% endfor %}
`,
          },
        ],
      }),
      context
    );

    assert.equal(result.success, false);
    assert.equal(result.status, "inspection_failed");
    assert.ok(
      result.errors?.some((issue) => issue.issueCode === "inspection_failed_unknown_block_type")
    );
    assert.ok(
      result.errors?.some((issue) => issue.issueCode === "inspection_failed_unknown_setting_ref")
    );
  } finally {
    global.fetch = previousFetch;
  }
});

test("draftThemeArtifact - flags new unguarded optional resources inside native block snippets", async () => {
  const mockShopifyClient = {
    url: "https://unit-test.myshopify.com/admin/api/2026-01/graphql.json",
    requestConfig: {
      headers: new Headers({ "x-shopify-access-token": "fake-token" })
    },
    session: { shop: "unit-test.myshopify.com" },
    request: async () => {}
  };

  const context = {
    shopifyClient: mockShopifyClient,
    tokenHash: "snippet-optional-resource",
  };

  const previousFetch = global.fetch;
  global.fetch = createThemeFilesFetchMock({
    files: {
      "sections/main-product.liquid": `
<section class="main-product">
  {% render 'product-info', product: product, section: section %}
</section>
{% schema %}
{
  "name": "Main product",
  "blocks": [
    {
      "type": "review_badge",
      "name": "Review badge",
      "settings": [
        { "type": "image_picker", "id": "badge_image", "label": "Badge image" },
        { "type": "text", "id": "badge_label", "label": "Badge label", "default": "Verified" }
      ]
    }
  ]
}
{% endschema %}
`,
      "snippets/product-info.liquid": `
{% doc %}
  @param {object} section
  @param {object} product
{% enddoc %}
{% for block in section.blocks %}
  <div class="product-info__block" {{ block.shopify_attributes }}>
    {% case block.type %}
      {% when 'review_badge' %}
        <p>{{ block.settings.badge_label }}</p>
    {% endcase %}
  </div>
{% endfor %}
`,
    },
    themeIdFallback: 111,
  });

  rememberThemePlan(context, {
    themeId: 111,
    intent: "native_block",
    nextReadKeys: ["sections/main-product.liquid", "snippets/product-info.liquid"],
    nextWriteKeys: ["sections/main-product.liquid", "snippets/product-info.liquid"],
    plannerHandoff: {
      intent: "native_block",
      themeTarget: { themeId: 111, themeRole: null },
      requiredReadKeys: ["sections/main-product.liquid", "snippets/product-info.liquid"],
      nextWriteKeys: ["sections/main-product.liquid", "snippets/product-info.liquid"],
      architecture: {
        primarySectionFile: "sections/main-product.liquid",
        usesThemeBlocks: false,
        snippetRendererKeys: ["snippets/product-info.liquid"],
        hasBlockShopifyAttributes: true,
      },
    },
  });

  try {
    const result = await execute(
      draftThemeArtifact.schema.parse({
        themeId: 111,
        mode: "edit",
        files: [
          {
            key: "snippets/product-info.liquid",
            value: `
{% doc %}
  @param {object} section
  @param {object} product
{% enddoc %}
{% for block in section.blocks %}
  <div class="product-info__block" {{ block.shopify_attributes }}>
    {% case block.type %}
      {% when 'review_badge' %}
        {{ block.settings.badge_image | image_url: width: 96 | image_tag: class: 'review-badge__image', loading: 'lazy' }}
        <p>{{ block.settings.badge_label }}</p>
    {% endcase %}
  </div>
{% endfor %}
`,
          },
        ],
      }),
      context
    );

    assert.equal(result.success, false);
    assert.equal(result.status, "inspection_failed");
    assert.ok(
      result.errors?.some(
        (issue) => issue.issueCode === "inspection_failed_unguarded_optional_resource"
      )
    );
  } finally {
    global.fetch = previousFetch;
  }
});

test("draftThemeArtifact - rejects native block snippets without block.shopify_attributes on the shared block wrapper", async () => {
  const mockShopifyClient = {
    url: "https://unit-test.myshopify.com/admin/api/2026-01/graphql.json",
    requestConfig: {
      headers: new Headers({ "x-shopify-access-token": "fake-token" })
    },
    session: { shop: "unit-test.myshopify.com" },
    request: async () => {}
  };

  const context = {
    shopifyClient: mockShopifyClient,
    tokenHash: "snippet-block-shopify-attrs",
  };

  const previousFetch = global.fetch;
  global.fetch = createThemeFilesFetchMock({
    files: {
      "sections/main-product.liquid": `
<section class="main-product">
  {% render 'product-info', product: product, section: section %}
</section>
{% schema %}
{
  "name": "Main product",
  "blocks": [
    {
      "type": "review_badge",
      "name": "Review badge",
      "settings": [
        { "type": "text", "id": "badge_label", "label": "Badge label", "default": "Verified" }
      ]
    }
  ]
}
{% endschema %}
`,
      "snippets/product-info.liquid": `
{% doc %}
  @param {object} section
  @param {object} product
{% enddoc %}
{% for block in section.blocks %}
  <div class="product-info__block" {{ block.shopify_attributes }}>
    {% case block.type %}
      {% when 'review_badge' %}
        <p>{{ block.settings.badge_label }}</p>
    {% endcase %}
  </div>
{% endfor %}
`,
    },
    themeIdFallback: 111,
  });

  rememberThemePlan(context, {
    themeId: 111,
    intent: "native_block",
    nextReadKeys: ["sections/main-product.liquid", "snippets/product-info.liquid"],
    nextWriteKeys: ["sections/main-product.liquid", "snippets/product-info.liquid"],
    plannerHandoff: {
      intent: "native_block",
      themeTarget: { themeId: 111, themeRole: null },
      requiredReadKeys: ["sections/main-product.liquid", "snippets/product-info.liquid"],
      nextWriteKeys: ["sections/main-product.liquid", "snippets/product-info.liquid"],
      architecture: {
        primarySectionFile: "sections/main-product.liquid",
        usesThemeBlocks: false,
        snippetRendererKeys: ["snippets/product-info.liquid"],
        hasBlockShopifyAttributes: true,
      },
    },
  });

  try {
    const result = await execute(
      draftThemeArtifact.schema.parse({
        themeId: 111,
        mode: "edit",
        files: [
          {
            key: "snippets/product-info.liquid",
            value: `
{% doc %}
  @param {object} section
  @param {object} product
{% enddoc %}
{% for block in section.blocks %}
  <div class="product-info__block">
    {% case block.type %}
      {% when 'review_badge' %}
        <p>{{ block.settings.badge_label }}</p>
    {% endcase %}
  </div>
{% endfor %}
`,
          },
        ],
      }),
      context
    );

    assert.equal(result.success, false);
    assert.equal(result.status, "inspection_failed");
    assert.ok(
      result.errors?.some(
        (issue) => issue.issueCode === "inspection_failed_block_shopify_attributes"
      )
    );
  } finally {
    global.fetch = previousFetch;
  }
});

test("draftThemeArtifact - native theme-block flows require a blocks file when planner architecture says @theme", async () => {
  const mockShopifyClient = {
    url: "https://unit-test.myshopify.com/admin/api/2026-01/graphql.json",
    requestConfig: {
      headers: new Headers({ "x-shopify-access-token": "fake-token" })
    },
    session: { shop: "unit-test.myshopify.com" },
    request: async () => {}
  };

  const previousFetch = global.fetch;
  global.fetch = createThemeFilesFetchMock({
    files: {
      "sections/main-product.liquid": `
<section class="editor-product">
  {% content_for 'blocks' %}
</section>
{% schema %}
{
  "name": "Main product",
  "blocks": [
    { "type": "@theme" },
    { "type": "@app" }
  ]
}
{% endschema %}
`,
    },
    themeIdFallback: 111,
  });

  try {
    const result = await execute(
      draftThemeArtifact.schema.parse({
        themeId: 111,
        mode: "edit",
        plannerHandoff: {
          intent: "native_block",
          themeTarget: { themeId: 111, themeRole: null },
          requiredReadKeys: ["sections/main-product.liquid"],
          nextWriteKeys: ["sections/main-product.liquid"],
          newFileSuggestions: ["blocks/<new-theme-block>.liquid"],
          architecture: {
            primarySectionFile: "sections/main-product.liquid",
            usesThemeBlocks: true,
            snippetRendererKeys: [],
            hasBlockShopifyAttributes: null,
          },
        },
        files: [
          {
            key: "sections/main-product.liquid",
            value: `
<section class="editor-product">
  {% content_for 'blocks' %}
</section>
{% schema %}
{
  "name": "Main product",
  "blocks": [
    { "type": "@theme" },
    { "type": "@app" }
  ]
}
{% endschema %}
`,
          },
        ],
      }),
      { shopifyClient: mockShopifyClient, tokenHash: "native-theme-block-route" }
    );

    assert.equal(result.success, false);
    assert.equal(result.errorCode, "native_block_requires_theme_block_file");
    assert.equal(
      result.nextArgsTemplate?.files?.some((file) => file.key === "blocks/<new-theme-block>.liquid"),
      true
    );
  } finally {
    global.fetch = previousFetch;
  }
});

test("draftThemeArtifact - fails when checksum precondition blocks the preview write", async () => {
  const mockShopifyClient = {
    url: "https://unit-test.myshopify.com/admin/api/2026-01/graphql.json",
    requestConfig: {
      headers: new Headers({ "x-shopify-access-token": "fake-token" })
    },
    session: { shop: "unit-test.myshopify.com" },
    request: async () => {}
  };

  const originalSection = goodSectionLiquid;
  const changedSection = goodSectionLiquid.replace("Hello", "Changed remotely");
  const originalFetch = global.fetch;
  global.fetch = async (_url, options = {}) => {
    const payload = options.body ? JSON.parse(String(options.body)) : {};
    const query = String(payload.query || "");
    const themeId = String(payload.variables?.themeId || "");
    const numericThemeId = Number(themeId.match(/\/(\d+)$/)?.[1] || 111);

    if (query.includes("ThemeById")) {
      const resPayload = {
        data: {
          theme: {
            id: `gid://shopify/OnlineStoreTheme/${numericThemeId}`,
            name: "Dev Theme",
            role: "DEVELOPMENT",
            processing: false,
            createdAt: "2026-04-02T00:00:00Z",
            updatedAt: "2026-04-02T00:00:00Z"
          }
        }
      };
      return {
        ok: true,
        status: 200,
        json: async () => resPayload,
        text: async () => JSON.stringify(resPayload)
      };
    }

    if (query.includes("ThemeFilesByIdWithContent")) {
      const resPayload = {
        data: {
          theme: {
            id: `gid://shopify/OnlineStoreTheme/${numericThemeId}`,
            name: "Dev Theme",
            role: "DEVELOPMENT",
            processing: false,
            createdAt: "2026-04-02T00:00:00Z",
            updatedAt: "2026-04-02T00:00:00Z",
            files: {
              nodes: [
                {
                  filename: "sections/good-file.liquid",
                  checksumMd5: checksumMd5Base64(changedSection),
                  contentType: "text/plain",
                  createdAt: "2026-04-02T00:00:00Z",
                  updatedAt: "2026-04-02T00:00:00Z",
                  size: Buffer.byteLength(changedSection, "utf8"),
                  body: { content: changedSection }
                }
              ],
              userErrors: []
            }
          }
        }
      };
      return {
        ok: true,
        status: 200,
        json: async () => resPayload,
        text: async () => JSON.stringify(resPayload)
      };
    }

    if (query.includes("ThemeFileById")) {
      const resPayload = {
        data: {
          theme: {
            id: `gid://shopify/OnlineStoreTheme/${numericThemeId}`,
            name: "Dev Theme",
            role: "DEVELOPMENT",
            processing: false,
            createdAt: "2026-04-02T00:00:00Z",
            updatedAt: "2026-04-02T00:00:00Z",
            files: {
              nodes: [
                {
                  filename: "sections/good-file.liquid",
                  checksumMd5: checksumMd5Base64(changedSection),
                  contentType: "text/plain",
                  createdAt: "2026-04-02T00:00:00Z",
                  updatedAt: "2026-04-02T00:00:00Z",
                  size: Buffer.byteLength(changedSection, "utf8"),
                  body: { content: changedSection }
                }
              ],
              userErrors: []
            }
          }
        }
      };
      return {
        ok: true,
        status: 200,
        json: async () => resPayload,
        text: async () => JSON.stringify(resPayload)
      };
    }

    if (query.includes("ThemeFilesByIdMetadata")) {
      const resPayload = {
        data: {
          theme: {
            id: `gid://shopify/OnlineStoreTheme/${numericThemeId}`,
            name: "Dev Theme",
            role: "DEVELOPMENT",
            processing: false,
            createdAt: "2026-04-02T00:00:00Z",
            updatedAt: "2026-04-02T00:00:00Z",
            files: {
              nodes: [
                {
                  filename: "sections/good-file.liquid",
                  checksumMd5: checksumMd5Base64(changedSection),
                  contentType: "text/plain",
                  createdAt: "2026-04-02T00:00:00Z",
                  updatedAt: "2026-04-02T00:00:00Z",
                  size: Buffer.byteLength(changedSection, "utf8")
                }
              ],
              userErrors: []
            }
          }
        }
      };
      return {
        ok: true,
        status: 200,
        json: async () => resPayload,
        text: async () => JSON.stringify(resPayload)
      };
    }

    if (query.includes("ThemeFilesUpsert")) {
      throw new Error("ThemeFilesUpsert should not run when checksum precondition fails");
    }

    throw new Error(`Unexpected GraphQL query in checksum precondition test: ${query}`);
  };

  try {
    const result = await execute(
      draftThemeArtifact.schema.parse({
        themeId: 111,
        mode: "edit",
        files: [
          {
            key: "sections/good-file.liquid",
            value: originalSection.replace("Hello", "Updated locally"),
            baseChecksumMd5: checksumMd5Base64(originalSection)
          }
        ]
      }),
      { shopifyClient: mockShopifyClient }
    );

    assert.equal(result.success, false);
    assert.equal(result.status, "preview_failed");
    assert.equal(result.errorCode, "preview_failed_precondition");
    assert.match(result.message, /conflict-safe write check faalde/i);
  } finally {
    global.fetch = originalFetch;
  }
});

test("draftThemeArtifact - classifies Shopify richtext default tag failures with a specific repair code", async () => {
  const mockShopifyClient = {
    url: "https://unit-test.myshopify.com/admin/api/2026-01/graphql.json",
    requestConfig: {
      headers: new Headers({ "x-shopify-access-token": "fake-token" })
    },
    session: { shop: "unit-test.myshopify.com" },
    request: async () => {}
  };

  const originalFetch = global.fetch;
  global.fetch = async (_url, options = {}) => {
    const payload = options.body ? JSON.parse(String(options.body)) : {};
    const query = String(payload.query || "");
    const themeId = String(payload.variables?.themeId || "");
    const numericThemeId = Number(themeId.match(/\/(\d+)$/)?.[1] || 111);

    if (query.includes("ThemeById")) {
      const resPayload = {
        data: {
          theme: {
            id: `gid://shopify/OnlineStoreTheme/${numericThemeId}`,
            name: "Main Theme",
            role: "MAIN",
            processing: false,
            createdAt: "2026-04-02T00:00:00Z",
            updatedAt: "2026-04-02T00:00:00Z"
          }
        }
      };
      return {
        ok: true,
        status: 200,
        json: async () => resPayload,
        text: async () => JSON.stringify(resPayload)
      };
    }

    if (query.includes("ThemeFilesUpsert")) {
      const resPayload = {
        data: {
          themeFilesUpsert: {
            upsertedThemeFiles: [],
            job: { id: "gid://shopify/Job/77" },
            userErrors: [
              {
                filename: "sections/review-replica.liquid",
                code: "FILE_VALIDATION_ERROR",
                message:
                  "Invalid block 'review': setting with id=\"quote\" default is invalid richtext: Tag '<mark>' is not permitted"
              }
            ]
          }
        }
      };
      return {
        ok: true,
        status: 200,
        json: async () => resPayload,
        text: async () => JSON.stringify(resPayload)
      };
    }

    throw new Error(`Unexpected GraphQL query in richtext failure test: ${query}`);
  };

  try {
    const result = await execute(
      draftThemeArtifact.schema.parse({
        mode: "create",
        themeId: 111,
        files: [{ key: "sections/review-replica.liquid", value: goodSectionLiquid }],
      }),
      { shopifyClient: mockShopifyClient }
    );

    assert.equal(result.success, false);
    assert.equal(result.status, "preview_failed");
    assert.equal(result.errorCode, "richtext_default_forbidden_tag");
    assert.equal(result.nextAction, "fix_richtext_default");
    assert.match(result.message, /<mark>|invalid richtext/i);
    assert.ok(
      result.errors?.some(
        (entry) =>
          Array.isArray(entry.path) &&
          entry.path.includes("quote") &&
          entry.issueCode === "richtext_default_forbidden_tag"
      ),
      "richtext preview failures should return a machine-readable error path and issueCode"
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test("draftThemeArtifact - allows valid json template writes in edit mode", async (t) => {
  const mockShopifyClient = {
    url: "https://unit-test.myshopify.com/admin/api/2026-01/graphql.json",
    requestConfig: {
      headers: new Headers({ "x-shopify-access-token": "fake-token" })
    },
    session: { shop: "unit-test.myshopify.com" },
    request: async () => {}
  };

  // Mock global fetch
  const originalFetch = global.fetch;
  global.fetch = async (url, options = {}) => {
    const payload = options.body ? JSON.parse(String(options.body)) : {};
    const query = String(payload.query || "");
    const themeIdMatch = String(payload.variables?.themeId || "");
    const numericThemeId = Number(themeIdMatch.match(/\/(\d+)$/)?.[1] || 111);

    if (query.includes("ThemeById")) {
      const resPayload = {
        data: {
          theme: {
            id: `gid://shopify/OnlineStoreTheme/${numericThemeId}`,
            name: numericThemeId === 111 ? "Dev Theme" : "Applied Theme",
            role: numericThemeId === 111 ? "DEVELOPMENT" : "MAIN",
            processing: false,
            createdAt: "2026-04-02T00:00:00Z",
            updatedAt: "2026-04-02T00:00:00Z"
          }
        }
      };
      return { ok: true, status: 200, json: async () => resPayload, text: async () => JSON.stringify(resPayload) };
    }
    
    if (query.includes("ThemeFilesUpsert")) {
      const resPayload = {
        data: {
          themeFilesUpsert: {
            upsertedThemeFiles: [{ filename: "templates/index.json" }],
            job: { id: "gid://shopify/Job/1" },
            userErrors: []
          }
        }
      };
      return { ok: true, status: 200, json: async () => resPayload, text: async () => JSON.stringify(resPayload) };
    }

    if (query.includes("ThemeFilesByIdMetadata")) {
      const value = JSON.stringify({ sections: {}, order: [] });
      const resPayload = {
        data: {
          theme: {
            id: `gid://shopify/OnlineStoreTheme/${numericThemeId}`,
            name: numericThemeId === 111 ? "Dev Theme" : "Applied Theme",
            role: numericThemeId === 111 ? "DEVELOPMENT" : "MAIN",
            processing: false,
            createdAt: "2026-04-02T00:00:00Z",
            updatedAt: "2026-04-02T00:00:00Z",
            files: {
              nodes: [
                {
                  filename: "templates/index.json",
                  checksumMd5: checksumMd5Base64(value),
                  contentType: "application/json",
                  createdAt: "2026-04-02T00:00:00Z",
                  updatedAt: "2026-04-02T00:00:00Z",
                  size: Buffer.byteLength(value, "utf8")
                }
              ],
              userErrors: []
            }
          }
        }
      };
      return { ok: true, status: 200, json: async () => resPayload, text: async () => JSON.stringify(resPayload) };
    }

    return { ok: true, status: 200, json: async () => ({}), text: async () => "{}" };
  };

  try {
    const result = await execute(
      draftThemeArtifact.schema.parse({
        themeId: 111,
        mode: "edit",
        files: [
          {
            key: "templates/index.json",
            value: JSON.stringify({ sections: {}, order: [] })
          }
        ]
      }),
      { shopifyClient: mockShopifyClient }
    );

    assert.equal(result.success, true);
    assert.equal(result.status, "preview_ready");
  } finally {
    global.fetch = originalFetch;
  }
});

test("draftThemeArtifact - accepts commented json templates in edit mode", async () => {
  const mockShopifyClient = {
    url: "https://unit-test.myshopify.com/admin/api/2026-01/graphql.json",
    requestConfig: {
      headers: new Headers({ "x-shopify-access-token": "fake-token" })
    },
    session: { shop: "unit-test.myshopify.com" },
    request: async () => {}
  };

  const originalFetch = global.fetch;
  let storedValue = "/* existing */ { \"sections\": {}, \"order\": [] }";
  global.fetch = async (url, options = {}) => {
    const payload = options.body ? JSON.parse(String(options.body)) : {};
    const query = String(payload.query || "");
    const themeIdMatch = String(payload.variables?.themeId || "");
    const numericThemeId = Number(themeIdMatch.match(/\/(\d+)$/)?.[1] || 111);

    if (query.includes("ThemeById")) {
      const resPayload = {
        data: {
          theme: {
            id: `gid://shopify/OnlineStoreTheme/${numericThemeId}`,
            name: "Dev Theme",
            role: "DEVELOPMENT",
            processing: false,
            createdAt: "2026-04-02T00:00:00Z",
            updatedAt: "2026-04-02T00:00:00Z"
          }
        }
      };
      return { ok: true, status: 200, json: async () => resPayload, text: async () => JSON.stringify(resPayload) };
    }

    if (query.includes("ThemeFilesUpsert")) {
      storedValue = payload.variables?.files?.[0]?.body?.value || storedValue;
      const resPayload = {
        data: {
          themeFilesUpsert: {
            upsertedThemeFiles: [{ filename: "templates/product.json" }],
            job: { id: "gid://shopify/Job/1" },
            userErrors: []
          }
        }
      };
      return { ok: true, status: 200, json: async () => resPayload, text: async () => JSON.stringify(resPayload) };
    }

    if (query.includes("ThemeFilesByIdMetadata")) {
      const value = storedValue;
      const resPayload = {
        data: {
          theme: {
            id: `gid://shopify/OnlineStoreTheme/${numericThemeId}`,
            name: "Dev Theme",
            role: "DEVELOPMENT",
            processing: false,
            createdAt: "2026-04-02T00:00:00Z",
            updatedAt: "2026-04-02T00:00:00Z",
            files: {
              nodes: [
                {
                  filename: "templates/product.json",
                  checksumMd5: checksumMd5Base64(value),
                  contentType: "application/json",
                  createdAt: "2026-04-02T00:00:00Z",
                  updatedAt: "2026-04-02T00:00:00Z",
                  size: Buffer.byteLength(value, "utf8")
                }
              ],
              userErrors: []
            }
          }
        }
      };
      return { ok: true, status: 200, json: async () => resPayload, text: async () => JSON.stringify(resPayload) };
    }

    return { ok: true, status: 200, json: async () => ({}), text: async () => "{}" };
  };

  try {
    const result = await execute(
      draftThemeArtifact.schema.parse({
        themeId: 111,
        mode: "edit",
        files: [
          {
            key: "templates/product.json",
            value: `/* product placement */
{
  "sections": {
    "main": { "type": "main-product" }
  },
  "order": ["main",]
}`,
          }
        ]
      }),
      { shopifyClient: mockShopifyClient }
    );

    assert.equal(result.success, true);
    assert.equal(result.status, "preview_ready");
  } finally {
    global.fetch = originalFetch;
  }
});

test("draftThemeArtifact - rejects invalid json template writes in edit mode", async () => {
  const mockShopifyClient = {
    url: "https://unit-test.myshopify.com/admin/api/2026-01/graphql.json",
    requestConfig: {
      headers: new Headers({ "x-shopify-access-token": "fake-token" })
    },
    session: { shop: "unit-test.myshopify.com" },
    request: async () => {}
  };

  const originalFetch = global.fetch;
  global.fetch = async (url, options = {}) => {
    console.log("Mock fetched url:", url);
    if (url.includes("/assets.json")) {
      const jsonValue = {
        asset: {
          key: "templates/index.json",
          value: JSON.stringify({ sections: {}, order: [] }),
          checksum: "mock"
        }
      };
      return {
        ok: true,
        status: 200,
        json: async () => jsonValue,
        text: async () => JSON.stringify(jsonValue)
      };
    }
    
    if (url.includes("/themes/111.json")) {
      const jsonValue = {
        theme: {
          id: 111,
          name: "Dev Theme",
          role: "development"
        }
      };
      return {
        ok: true,
        status: 200,
        json: async () => jsonValue,
        text: async () => JSON.stringify(jsonValue)
      };
    }

    const payload = options.body && typeof options.body === "string" ? JSON.parse(options.body) : {};
    const query = String(payload.query || "");

    if (query.includes("ThemeById")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            theme: {
              id: "gid://shopify/OnlineStoreTheme/111",
              name: "Dev Theme",
              role: "DEVELOPMENT",
            }
          }
        }),
        text: async () => "{}"
      };
    }

    if (query.includes("ThemeFilesById")) {
      const value = JSON.stringify({ sections: {}, order: [] });
      return {
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            theme: {
              id: "gid://shopify/OnlineStoreTheme/111",
              name: "Dev Theme",
              role: "DEVELOPMENT",
              files: {
                nodes: [
                  {
                    filename: "templates/index.json",
                    checksumMd5: "mock-checksum",
                    contentType: "application/json",
                    size: Buffer.byteLength(value, "utf8"),
                    body: { content: value }
                  }
                ],
                userErrors: []
              }
            }
          }
        }),
        text: async () => "{}"
      };
    }
    return { ok: true, status: 200, json: async () => ({}), text: async () => "{}" };
  };

  try {
    const result = await execute(
      draftThemeArtifact.schema.parse({
        themeId: 111,
        mode: "edit",
        files: [
          {
            key: "templates/index.json",
            value: JSON.stringify({ sections: {} }) // missing 'order' array
          }
        ]
      }),
      { shopifyClient: mockShopifyClient }
    );

    assert.equal(result.success, false);
    assert.equal(result.status, "inspection_failed");
    assert.equal(result.errorCode, "inspection_failed_json");
    assert.ok(result.message.includes("'order' array"));
  } finally {
    global.fetch = originalFetch;
  }
});

test("draftThemeArtifact - allows Liquid template placement edits in edit mode", async () => {
  const mockShopifyClient = {
    url: "https://unit-test.myshopify.com/admin/api/2026-01/graphql.json",
    requestConfig: {
      headers: new Headers({ "x-shopify-access-token": "fake-token" })
    },
    session: { shop: "unit-test.myshopify.com" },
    request: async () => {}
  };

  const originalFetch = global.fetch;
  global.fetch = createThemeFilesFetchMock({
    files: {
      "templates/index.liquid": `
{% section 'premium-hero' %}
{% section 'brand-story' %}
`,
    },
  });

  try {
    const result = await execute(
      draftThemeArtifact.schema.parse({
        themeId: 111,
        mode: "edit",
        files: [
          {
            key: "templates/index.liquid",
            value: `
{% section 'premium-hero' %}
{% section 'brand-story' %}
{% section 'matrix-acceptance' %}
`,
          }
        ]
      }),
      { shopifyClient: mockShopifyClient }
    );

    assert.equal(result.success, true);
    assert.equal(result.status, "preview_ready");
    assert.ok(
      result.warnings.some((warning) =>
        warning.includes("Template write (templates/index.liquid)")
      )
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test("draftThemeArtifact - success when linter passes (pushes directly to chosen theme)", async (t) => {
  const mockShopifyClient = {
    url: "https://unit-test.myshopify.com/admin/api/2026-01/graphql.json",
    requestConfig: {
      headers: new Headers({ "x-shopify-access-token": "fake-token" })
    },
    session: { shop: "unit-test.myshopify.com" },
    request: async () => {}
  };

  const originalFetch = global.fetch;
  let storedValue = null;
  global.fetch = async (url, options = {}) => {
    const stringUrl = String(url || "");
    const restThemeMatch = stringUrl.match(/\/themes\/(\d+)\.json$/);
    if (restThemeMatch) {
      const numericThemeId = Number(restThemeMatch[1] || 111);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          theme: {
            id: numericThemeId,
            name: numericThemeId === 111 ? "Dev Theme" : "Applied Theme",
            role: numericThemeId === 111 ? "development" : "main",
          },
        }),
        text: async () => "{}",
      };
    }

    const payload = options.body ? JSON.parse(String(options.body)) : {};
    const query = String(payload.query || "");
    const themeId = String(payload.variables?.themeId || "");
    const numericThemeId = Number(themeId.match(/\/(\d+)$/)?.[1] || 111);

    if (query.includes("ThemeById")) {
      const resPayload = {
        data: {
          theme: {
            id: `gid://shopify/OnlineStoreTheme/${numericThemeId}`,
            name: numericThemeId === 111 ? "Dev Theme" : "Applied Theme",
            role: numericThemeId === 111 ? "DEVELOPMENT" : "MAIN",
            processing: false,
            createdAt: "2026-04-02T00:00:00Z",
            updatedAt: "2026-04-02T00:00:00Z"
          }
        }
      };
      return {
        ok: true,
        status: 200,
        json: async () => resPayload,
        text: async () => JSON.stringify(resPayload)
      };
    }

    if (query.includes("ThemeFilesUpsert")) {
      storedValue = payload.variables?.files?.[0]?.body?.value || goodSectionLiquid;
      const resPayload = {
        data: {
          themeFilesUpsert: {
            upsertedThemeFiles: [{ filename: "sections/good-file.liquid" }],
            job: { id: "gid://shopify/Job/1" },
            userErrors: []
          }
        }
      };
      return {
        ok: true,
        status: 200,
        json: async () => resPayload,
        text: async () => JSON.stringify(resPayload)
      };
    }

    if (query.includes("ThemeFilesByIdMetadata")) {
      const value = storedValue;
      const resPayload = {
        data: {
          theme: {
            id: `gid://shopify/OnlineStoreTheme/${numericThemeId}`,
            name: numericThemeId === 111 ? "Dev Theme" : "Applied Theme",
            role: numericThemeId === 111 ? "DEVELOPMENT" : "MAIN",
            processing: false,
            createdAt: "2026-04-02T00:00:00Z",
            updatedAt: "2026-04-02T00:00:00Z",
            files: {
              nodes: value
                ? [
                    {
                      filename: "sections/good-file.liquid",
                      checksumMd5: checksumMd5Base64(value),
                      contentType: "text/plain",
                      createdAt: "2026-04-02T00:00:00Z",
                      updatedAt: "2026-04-02T00:00:00Z",
                      size: Buffer.byteLength(value, "utf8")
                    }
                  ]
                : [],
              userErrors: []
            }
          }
        }
      };
      return {
        ok: true,
        status: 200,
        json: async () => resPayload,
        text: async () => JSON.stringify(resPayload)
      };
    }

    return {
      ok: true,
      status: 200,
      json: async () => ({}),
      text: async () => "{}"
    };
  };

  try {
    const input = {
      themeId: 111,
      files: [
        {
          key: "sections/good-file.liquid",
          value: goodSectionLiquid
        }
      ]
    };

    const result = await execute(draftThemeArtifact.schema.parse(input), { shopifyClient: mockShopifyClient });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.status, "preview_ready");
    assert.strictEqual(result.themeId, 111);
    assert.ok(result.editorUrl.includes("admin/themes/111/editor"));
    assert.strictEqual(result.target.role, "development");
    assert.ok(result.verify.summary.match >= 1);
    assert.ok(result.draft);
    
  } finally {
    global.fetch = originalFetch;
  }
});

test("draftThemeArtifact - fails preview when verify-after-write does not match", async () => {
  const mockShopifyClient = {
    url: "https://unit-test.myshopify.com/admin/api/2026-01/graphql.json",
    requestConfig: {
      headers: new Headers({ "x-shopify-access-token": "fake-token" }),
    },
    session: { shop: "unit-test.myshopify.com" },
    request: async () => {},
  };

  const originalFetch = global.fetch;
  const themeFileMock = createThemeFileFetchMock({
    key: "sections/verify-mismatch.liquid",
    initialValue: "",
    existing: false,
    verifyValueOverride: goodSectionLiquid.replace("Hello", "Changed after write"),
  });
  global.fetch = themeFileMock.handler;

  try {
    const result = await execute(
      draftThemeArtifact.schema.parse({
        themeId: 111,
        mode: "create",
        files: [
          {
            key: "sections/verify-mismatch.liquid",
            value: goodSectionLiquid,
          },
        ],
      }),
      { shopifyClient: mockShopifyClient }
    );

    assert.equal(result.success, false);
    assert.equal(result.status, "preview_failed");
    assert.equal(result.errorCode, "preview_verify_failed");
    assert.ok(result.draft?.verifySummary?.mismatch >= 1);
    assert.ok(
      result.errors?.some((entry) => entry.key === "sections/verify-mismatch.liquid"),
      "verify failures should be returned as structured errors"
    );
    assert.match(result.message, /verificatie niet overeen/i);
  } finally {
    global.fetch = originalFetch;
  }
});

test("draftThemeArtifact - warns when a valid create payload is likely still a minimal scaffold", async () => {
  const mockShopifyClient = {
    url: "https://unit-test.myshopify.com/admin/api/2026-01/graphql.json",
    requestConfig: {
      headers: new Headers({ "x-shopify-access-token": "fake-token" })
    },
    session: { shop: "unit-test.myshopify.com" },
    request: async () => {}
  };

  const originalFetch = global.fetch;
  const themeFileMock = createThemeFileFetchMock({
    key: "sections/minimal-scaffold.liquid",
    initialValue: `
<div class="demo">{{ section.settings.heading }}</div>
{% schema %}
{
  "name": "Minimal scaffold",
  "settings": [
    { "type": "text", "id": "heading", "label": "Heading", "default": "Hello" }
  ],
  "presets": [{ "name": "Minimal scaffold" }]
}
{% endschema %}
`,
    existing: false,
  });
  global.fetch = themeFileMock.handler;

  try {
    const result = await execute(
      draftThemeArtifact.schema.parse({
        themeId: 111,
        mode: "create",
        files: [
          {
            key: "sections/minimal-scaffold.liquid",
            value: `
<div class="demo">{{ section.settings.heading }}</div>
{% schema %}
{
  "name": "Minimal scaffold",
  "settings": [
    { "type": "text", "id": "heading", "label": "Heading", "default": "Hello" }
  ],
  "presets": [{ "name": "Minimal scaffold" }]
}
{% endschema %}
`,
          },
        ],
      }),
      { shopifyClient: mockShopifyClient }
    );

    assert.equal(result.success, true);
    assert.equal(result.status, "preview_ready");
    assert.ok(
      result.warnings?.some((warning) => warning.includes("likely_minimal_scaffold")),
      "successful minimal stubs should remain deployable but carry a scaffold quality warning"
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test("applyThemeDraft - applies an existing draft to an explicit target theme", async () => {
  const mockShopifyClient = {
    url: "https://unit-test.myshopify.com/admin/api/2026-01/graphql.json",
    requestConfig: {
      headers: new Headers({ "x-shopify-access-token": "fake-token" })
    },
    session: { shop: "unit-test.myshopify.com" },
    request: async () => {}
  };

  const originalFetch = global.fetch;
  const storedValues = new Map();
  global.fetch = async (_url, options = {}) => {
    const stringUrl = String(_url || "");
    const restThemeMatch = stringUrl.match(/\/themes\/(\d+)\.json$/);
    if (restThemeMatch) {
      const numericThemeId = Number(restThemeMatch[1] || 111);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          theme: {
            id: numericThemeId,
            name: numericThemeId === 222 ? "Main Theme" : "Dev Theme",
            role: numericThemeId === 222 ? "main" : "development",
          },
        }),
        text: async () => "{}",
      };
    }

    const payload = options.body ? JSON.parse(String(options.body)) : {};
    const query = String(payload.query || "");
    const themeId = String(payload.variables?.themeId || "");
    const numericThemeId = Number(themeId.match(/\/(\d+)$/)?.[1] || 111);

    if (query.includes("ThemeById")) {
      const resPayload = {
        data: {
          theme: {
            id: `gid://shopify/OnlineStoreTheme/${numericThemeId}`,
            name: numericThemeId === 222 ? "Main Theme" : "Dev Theme",
            role: numericThemeId === 222 ? "MAIN" : "DEVELOPMENT",
            processing: false,
            createdAt: "2026-04-02T00:00:00Z",
            updatedAt: "2026-04-02T00:00:00Z"
          }
        }
      };
      return {
        ok: true,
        status: 200,
        json: async () => resPayload,
        text: async () => JSON.stringify(resPayload)
      };
    }

    if (query.includes("ThemeFilesUpsert")) {
      const nextValue = payload.variables?.files?.[0]?.body?.value || goodSectionLiquid;
      storedValues.set(numericThemeId, nextValue);
      const resPayload = {
        data: {
          themeFilesUpsert: {
            upsertedThemeFiles: [{ filename: "sections/good-file.liquid" }],
            job: { id: "gid://shopify/Job/2" },
            userErrors: []
          }
        }
      };
      return {
        ok: true,
        status: 200,
        json: async () => resPayload,
        text: async () => JSON.stringify(resPayload)
      };
    }

    if (query.includes("ThemeFilesByIdMetadata")) {
      const value = storedValues.get(numericThemeId) || null;
      const resPayload = {
        data: {
          theme: {
            id: `gid://shopify/OnlineStoreTheme/${numericThemeId}`,
            name: numericThemeId === 222 ? "Main Theme" : "Dev Theme",
            role: numericThemeId === 222 ? "MAIN" : "DEVELOPMENT",
            processing: false,
            createdAt: "2026-04-02T00:00:00Z",
            updatedAt: "2026-04-02T00:00:00Z",
            files: {
              nodes: value
                ? [
                    {
                      filename: "sections/good-file.liquid",
                      checksumMd5: checksumMd5Base64(value),
                      contentType: "text/plain",
                      createdAt: "2026-04-02T00:00:00Z",
                      updatedAt: "2026-04-02T00:00:00Z",
                      size: Buffer.byteLength(value, "utf8")
                    }
                  ]
                : [],
              userErrors: []
            }
          }
        }
      };
      return {
        ok: true,
        status: 200,
        json: async () => resPayload,
        text: async () => JSON.stringify(resPayload)
      };
    }

    throw new Error(`Unexpected GraphQL query in applyThemeDraft test: ${query}`);
  };

  try {
    const draftResult = await execute(
      draftThemeArtifact.schema.parse({
        mode: "create",
        themeId: 111,
        files: [{ key: "sections/good-file.liquid", value: goodSectionLiquid }],
      }),
      { shopifyClient: mockShopifyClient }
    );

    const result = await applyThemeDraft.execute(
      applyThemeDraft.schema.parse({
        draftId: draftResult.draftId,
        themeId: 222,
        confirmation: "APPLY_THEME_DRAFT",
        reason: "Promote approved preview to main theme",
      }),
      { shopifyClient: mockShopifyClient }
    );

    assert.equal(result.success, true);
    assert.equal(result.status, "applied");
    assert.equal(result.theme.id, 222);
    assert.equal(result.draft.appliedThemeId, 222);
    assert.ok(result.verify.summary.match >= 1);
  } finally {
    global.fetch = originalFetch;
  }
});

test("applyThemeDraft - rejects drafts from another Shopify shop", async () => {
  const draftRecord = await createThemeDraftRecord({
    shopDomain: "shop-a.myshopify.com",
    status: "preview_applied",
    previewThemeId: 111,
    files: [{ key: "sections/good-file.liquid", value: goodSectionLiquid }],
  });

  const result = await applyThemeDraft.execute(
    applyThemeDraft.schema.parse({
      draftId: draftRecord.id,
      themeId: 222,
      confirmation: "APPLY_THEME_DRAFT",
      reason: "Attempt cross-shop apply",
    }),
    {
      shopifyClient: {
        url: "https://shop-b.myshopify.com/admin/api/2026-01/graphql.json",
        requestConfig: {
          headers: new Headers({ "x-shopify-access-token": "fake-token" }),
        },
        session: { shop: "shop-b.myshopify.com" },
        request: async () => {
          throw new Error("should not call Shopify for cross-shop drafts");
        },
      },
    }
  );

  assert.equal(result.success, false);
  assert.equal(result.status, "draft_shop_mismatch");
  assert.equal(result.errorCode, "theme_draft_shop_mismatch");
  assert.equal(result.retryable, false);
  assert.match(result.errors?.[0]?.problem || "", /shop-a\.myshopify\.com.*shop-b\.myshopify\.com/i);
});

test("applyThemeDraft - requires an explicit target theme", async () => {
  const result = await applyThemeDraft.execute(
    applyThemeDraft.schema.parse({
      draftId: "mock-1",
      confirmation: "APPLY_THEME_DRAFT",
      reason: "Explicit target required",
    }),
    {
      shopifyClient: {
        url: "https://unit-test.myshopify.com/admin/api/2026-01/graphql.json",
        requestConfig: {
          headers: new Headers({ "x-shopify-access-token": "fake-token" }),
        },
        session: { shop: "unit-test.myshopify.com" },
        request: async () => {
          throw new Error("should not reach Shopify without an explicit target");
        },
      },
    }
  );
  assert.equal(result.success, false);
  assert.equal(result.errorCode, "missing_apply_theme_target");
  assert.equal(result.nextTool, "apply-theme-draft");
});

test("applyThemeDraft - fails apply when verify-after-write does not match", async () => {
  const mockShopifyClient = {
    url: "https://unit-test.myshopify.com/admin/api/2026-01/graphql.json",
    requestConfig: {
      headers: new Headers({ "x-shopify-access-token": "fake-token" }),
    },
    session: { shop: "unit-test.myshopify.com" },
    request: async () => {},
  };

  const originalFetch = global.fetch;
  const storedValues = new Map();
  global.fetch = async (_url, options = {}) => {
    const stringUrl = String(_url || "");
    const restThemeMatch = stringUrl.match(/\/themes\/(\d+)\.json$/);
    if (restThemeMatch) {
      const numericThemeId = Number(restThemeMatch[1] || 111);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          theme: {
            id: numericThemeId,
            name: numericThemeId === 222 ? "Main Theme" : "Dev Theme",
            role: numericThemeId === 222 ? "main" : "development",
          },
        }),
        text: async () => "{}",
      };
    }

    const payload = options.body ? JSON.parse(String(options.body)) : {};
    const query = String(payload.query || "");
    const themeId = String(payload.variables?.themeId || "");
    const numericThemeId = Number(themeId.match(/\/(\d+)$/)?.[1] || 111);

    if (query.includes("ThemeById")) {
      const resPayload = {
        data: {
          theme: {
            id: `gid://shopify/OnlineStoreTheme/${numericThemeId}`,
            name: numericThemeId === 222 ? "Main Theme" : "Dev Theme",
            role: numericThemeId === 222 ? "MAIN" : "DEVELOPMENT",
            processing: false,
            createdAt: "2026-04-02T00:00:00Z",
            updatedAt: "2026-04-02T00:00:00Z",
          },
        },
      };
      return jsonGraphqlResponse(resPayload);
    }

    if (query.includes("ThemeFilesUpsert")) {
      const nextValue = payload.variables?.files?.[0]?.body?.value || goodSectionLiquid;
      storedValues.set(numericThemeId, nextValue);
      return jsonGraphqlResponse({
        data: {
          themeFilesUpsert: {
            upsertedThemeFiles: [{ filename: "sections/good-file.liquid" }],
            job: { id: "gid://shopify/Job/4" },
            userErrors: [],
          },
        },
      });
    }

    if (query.includes("ThemeFilesByIdMetadata")) {
      const storedValue = storedValues.get(numericThemeId) || null;
      const value =
        numericThemeId === 222 && storedValue
          ? storedValue.replace("Hello", "Changed after apply")
          : storedValue;
      return jsonGraphqlResponse({
        data: {
          theme: {
            id: `gid://shopify/OnlineStoreTheme/${numericThemeId}`,
            name: numericThemeId === 222 ? "Main Theme" : "Dev Theme",
            role: numericThemeId === 222 ? "MAIN" : "DEVELOPMENT",
            processing: false,
            createdAt: "2026-04-02T00:00:00Z",
            updatedAt: "2026-04-02T00:00:00Z",
            files: {
              nodes: value
                ? [
                    {
                      filename: "sections/good-file.liquid",
                      checksumMd5: checksumMd5Base64(value),
                      contentType: "text/plain",
                      createdAt: "2026-04-02T00:00:00Z",
                      updatedAt: "2026-04-02T00:00:00Z",
                      size: Buffer.byteLength(value, "utf8"),
                    },
                  ]
                : [],
              userErrors: [],
            },
          },
        },
      });
    }

    throw new Error(`Unexpected GraphQL query in applyThemeDraft verify mismatch test: ${query}`);
  };

  try {
    const draftResult = await execute(
      draftThemeArtifact.schema.parse({
        mode: "create",
        themeId: 111,
        files: [{ key: "sections/good-file.liquid", value: goodSectionLiquid }],
      }),
      { shopifyClient: mockShopifyClient }
    );
    assert.equal(draftResult.success, true, "preview draft must be created before apply verify test");

    const result = await applyThemeDraft.execute(
      applyThemeDraft.schema.parse({
        draftId: draftResult.draftId,
        themeId: 222,
        confirmation: "APPLY_THEME_DRAFT",
        reason: "Validate apply verify mismatch",
      }),
      { shopifyClient: mockShopifyClient }
    );

    assert.equal(result.success, false);
    assert.equal(result.status, "apply_failed");
    assert.equal(result.errorCode, "apply_verify_failed");
    assert.ok(result.verify.summary.mismatch >= 1);
    assert.match(result.message, /Verify-after-write/i);
  } finally {
    global.fetch = originalFetch;
  }
});

test("applyThemeDraft - returns a structured failure when Shopify apply does not write files", async () => {
  const mockShopifyClient = {
    url: "https://unit-test.myshopify.com/admin/api/2026-01/graphql.json",
    requestConfig: {
      headers: new Headers({ "x-shopify-access-token": "fake-token" })
    },
    session: { shop: "unit-test.myshopify.com" },
    request: async () => {}
  };

  const originalFetch = global.fetch;
  const storedValues = new Map();
  global.fetch = async (_url, options = {}) => {
    const stringUrl = String(_url || "");
    const restThemeMatch = stringUrl.match(/\/themes\/(\d+)\.json$/);
    if (restThemeMatch) {
      const numericThemeId = Number(restThemeMatch[1] || 111);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          theme: {
            id: numericThemeId,
            name: numericThemeId === 222 ? "Main Theme" : "Dev Theme",
            role: numericThemeId === 222 ? "main" : "development",
          },
        }),
        text: async () => "{}",
      };
    }

    const payload = options.body ? JSON.parse(String(options.body)) : {};
    const query = String(payload.query || "");
    const themeId = String(payload.variables?.themeId || "");
    const numericThemeId = Number(themeId.match(/\/(\d+)$/)?.[1] || 111);

    if (query.includes("ThemeById")) {
      const resPayload = {
        data: {
          theme: {
            id: `gid://shopify/OnlineStoreTheme/${numericThemeId}`,
            name: numericThemeId === 222 ? "Main Theme" : "Dev Theme",
            role: numericThemeId === 222 ? "MAIN" : "DEVELOPMENT",
            processing: false,
            createdAt: "2026-04-02T00:00:00Z",
            updatedAt: "2026-04-02T00:00:00Z"
          }
        }
      };
      return {
        ok: true,
        status: 200,
        json: async () => resPayload,
        text: async () => JSON.stringify(resPayload)
      };
    }

    if (query.includes("ThemeFilesUpsert")) {
      if (numericThemeId !== 222) {
        const nextValue = payload.variables?.files?.[0]?.body?.value || goodSectionLiquid;
        storedValues.set(numericThemeId, nextValue);
      }
      const resPayload = {
        data: {
          themeFilesUpsert: {
            upsertedThemeFiles: [],
            job: { id: "gid://shopify/Job/3" },
            userErrors: [
              {
                filename: "sections/good-file.liquid",
                code: "FILE_VALIDATION_ERROR",
                message: "Simulated apply failure"
              }
            ]
          }
        }
      };
      return {
        ok: true,
        status: 200,
        json: async () => resPayload,
        text: async () => JSON.stringify(resPayload)
      };
    }

    if (query.includes("ThemeFilesByIdMetadata")) {
      const value = storedValues.get(numericThemeId) || null;
      const resPayload = {
        data: {
          theme: {
            id: `gid://shopify/OnlineStoreTheme/${numericThemeId}`,
            name: numericThemeId === 222 ? "Main Theme" : "Dev Theme",
            role: numericThemeId === 222 ? "MAIN" : "DEVELOPMENT",
            processing: false,
            createdAt: "2026-04-02T00:00:00Z",
            updatedAt: "2026-04-02T00:00:00Z",
            files: {
              nodes: value
                ? [
                    {
                      filename: "sections/good-file.liquid",
                      checksumMd5: checksumMd5Base64(value),
                      contentType: "text/plain",
                      createdAt: "2026-04-02T00:00:00Z",
                      updatedAt: "2026-04-02T00:00:00Z",
                      size: Buffer.byteLength(value, "utf8")
                    }
                  ]
                : [],
              userErrors: []
            }
          }
        }
      };
      return {
        ok: true,
        status: 200,
        json: async () => resPayload,
        text: async () => JSON.stringify(resPayload)
      };
    }

    throw new Error(`Unexpected GraphQL query in applyThemeDraft failure test: ${query}`);
  };

  try {
    const draftResult = await execute(
      draftThemeArtifact.schema.parse({
        mode: "create",
        themeId: 111,
        files: [{ key: "sections/good-file.liquid", value: goodSectionLiquid }],
      }),
      { shopifyClient: mockShopifyClient }
    );

    const result = await applyThemeDraft.execute(
      applyThemeDraft.schema.parse({
        draftId: draftResult.draftId,
        themeId: 222,
        confirmation: "APPLY_THEME_DRAFT",
        reason: "Validate failed apply path",
      }),
      { shopifyClient: mockShopifyClient }
    );

    assert.equal(result.success, false);
    assert.equal(result.status, "apply_failed");
    assert.equal(result.errorCode, "apply_failed");
    assert.match(result.message, /Simulated apply failure/);
  } finally {
    global.fetch = originalFetch;
  }
});
