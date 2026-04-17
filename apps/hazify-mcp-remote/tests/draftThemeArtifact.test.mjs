import test from "node:test";
import assert from "node:assert";
import crypto from "node:crypto";
import { applyThemeDraft } from "../src/tools/applyThemeDraft.js";
import { draftThemeArtifact } from "../src/tools/draftThemeArtifact.js";
import { createThemeDraftDbHarness } from "./helpers/themeDraftDbHarness.mjs";

const execute = draftThemeArtifact.execute;
const themeDraftDb = createThemeDraftDbHarness();

test.after(async () => {
  await themeDraftDb.cleanup();
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
}) {
  let storedValue = initialValue;

  return {
    getValue: () => storedValue,
    handler: async (_url, options = {}) => {
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

      const fileNode = (includeContent) => ({
        filename: key,
        checksumMd5: checksumMd5Base64(storedValue),
        contentType: "application/x-liquid",
        createdAt: "2026-04-02T00:00:00Z",
        updatedAt: "2026-04-02T00:00:00Z",
        size: Buffer.byteLength(storedValue, "utf8"),
        ...(includeContent ? { body: { content: storedValue } } : {}),
      });

      if (query.includes("ThemeById")) {
        return jsonGraphqlResponse({ data: { theme } });
      }

      if (query.includes("ThemeFilesByIdWithContent") || query.includes("ThemeFileById")) {
        return jsonGraphqlResponse({
          data: {
            theme: {
              ...theme,
              files: {
                nodes: [fileNode(true)],
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
                nodes: [fileNode(false)],
                userErrors: [],
              },
            },
          },
        });
      }

      if (query.includes("ThemeFilesUpsert")) {
        storedValue = payload.variables.files[0].body.value;
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
  assert.strictEqual(result.status, "lint_failed");
  assert.strictEqual(result.errorCode, "lint_failed_liquid_syntax");
  assert.ok(result.errors.length > 0, "Should return linter errors");
  assert.strictEqual(result.errors[0].severity, "error");
  assert.strictEqual(result.errors[0].issueCode, "lint_failed_liquid_syntax");
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
  assert.equal(result.errorCode, "inspection_failed_theme_scale");
  assert.ok(
    result.errors?.some((issue) => issue.issueCode === "inspection_failed_theme_scale"),
    "theme-scale diagnostics should be returned when the generated section is much larger than the target theme convention"
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
      { shopifyClient: mockShopifyClient }
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
      { shopifyClient: mockShopifyClient }
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
  const mockShopifyClient = {
    url: "https://unit-test.myshopify.com/admin/api/2026-01/graphql.json",
    requestConfig: {
      headers: new Headers({ "x-shopify-access-token": "fake-token" })
    },
    session: { shop: "unit-test.myshopify.com" },
    request: async () => {}
  };

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
            value: updatedSection,
          },
        ],
      }),
      { shopifyClient: mockShopifyClient }
    );

    assert.equal(result.success, true);
    assert.equal(result.status, "preview_ready");
    assert.match(themeMock.getValue(), /demo--updated/);
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
    assert.match(result.message, /matchte 4 keer/i);
    assert.match(themeMock.getValue(), /<div class="demo">Promo<\/div>/);
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
      const value = "/* existing */ { \"sections\": {}, \"order\": [] }";
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
  global.fetch = async (url, options = {}) => {
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
      const value = goodSectionLiquid;
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
                  filename: "sections/good-file.liquid",
                  checksumMd5: checksumMd5Base64(value),
                  contentType: "text/plain",
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
      const value = goodSectionLiquid;
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
              nodes: [
                {
                  filename: "sections/good-file.liquid",
                  checksumMd5: checksumMd5Base64(value),
                  contentType: "text/plain",
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
      const value = goodSectionLiquid;
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
              nodes: [
                {
                  filename: "sections/good-file.liquid",
                  checksumMd5: checksumMd5Base64(value),
                  contentType: "text/plain",
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
