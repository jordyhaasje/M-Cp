import test from "node:test";
import assert from "node:assert";
import { createThemeSectionTool } from "../src/tools/createThemeSection.js";
import { getThemeFilesTool } from "../src/tools/getThemeFiles.js";
import { planThemeEditTool } from "../src/tools/planThemeEdit.js";
import { draftThemeArtifact } from "../src/tools/draftThemeArtifact.js";
import { clearThemeEditMemory } from "../src/lib/themeEditMemory.js";

const originalFetch = global.fetch;
const originalDraftExecute = draftThemeArtifact.execute;

const shopifyClient = {
  url: "https://unit-test-shop.myshopify.com/admin/api/2026-01/graphql.json",
  requestConfig: {
    headers: {
      "X-Shopify-Access-Token": "shpat_unit_test",
    },
  },
  session: { shop: "unit-test-shop.myshopify.com" },
  request: async () => {},
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

function createGraphqlFetch(files) {
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

    if (query.includes("ThemeFilesByIdWithContent") || query.includes("ThemeFilesByIdMetadata")) {
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

    throw new Error(`Unexpected GraphQL query in createThemeSection test: ${query.slice(0, 80)}`);
  };
}

const plannerFiles = {
  "templates/index.json": makeTextAsset(
    JSON.stringify({
      sections: {
        hero_1: { type: "hero-banner" },
        testimonials_1: { type: "testimonials" },
      },
      order: ["hero_1", "testimonials_1"],
    })
  ),
  "sections/hero-banner.liquid": makeTextAsset(`
    {% schema %}
    {"name":"Hero banner","presets":[{"name":"Homepage hero"}]}
    {% endschema %}
    <div>{{ section.settings.heading }}</div>
  `),
  "sections/testimonials.liquid": makeTextAsset(`
    <section class="testimonials page-width">
      {% render 'section-properties', section: section %}
      <div class="card-grid rte">{{ section.settings.heading }}</div>
      {% render 'button', label: section.settings.heading %}
    </section>
    {% schema %}
    {
      "name":"Testimonials",
      "settings":[
        { "type":"range","id":"padding_top","label":"Padding top","min":0,"max":80,"step":4,"default":36 },
        { "type":"range","id":"padding_bottom","label":"Padding bottom","min":0,"max":80,"step":4,"default":36 }
      ],
      "presets":[{"name":"Customer quotes"}]
    }
    {% endschema %}
  `),
  "snippets/section-properties.liquid": makeTextAsset(`
    <div class="section-properties" data-section-id="{{ section.id }}"></div>
  `),
  "snippets/button.liquid": makeTextAsset(`
    <button class="button button--primary">{{ label }}</button>
  `),
};

test.afterEach(() => {
  global.fetch = originalFetch;
  draftThemeArtifact.execute = originalDraftExecute;
  clearThemeEditMemory();
});

test("createThemeSection - forwards static section blueprint and theme context from the planner", async () => {
  global.fetch = createGraphqlFetch(plannerFiles);

  let capturedInput = null;
  let capturedContext = null;
  draftThemeArtifact.execute = async (input, context) => {
    capturedInput = input;
    capturedContext = context;
    return {
      success: true,
      status: "preview_ready",
      warnings: [],
    };
  };

  const requestContext = { shopifyClient, tokenHash: "create-theme-static" };
  await getThemeFilesTool.execute(
    {
      themeId: 123,
      keys: [
        "sections/testimonials.liquid",
        "snippets/section-properties.liquid",
        "snippets/button.liquid",
      ],
      includeContent: true,
    },
    requestContext
  );

  const result = await createThemeSectionTool.execute(
    {
      themeId: 123,
      key: "sections/review-replica.liquid",
      liquid: `
<style>
  #shopify-section-{{ section.id }} .review-replica {
    display: grid;
    gap: 24px;
  }
</style>
<section class="review-replica page-width">
  <div class="rte">{{ section.settings.heading }}</div>
</section>
{% schema %}
{
  "name": "Review replica",
  "settings": [
    { "type": "text", "id": "heading", "label": "Heading", "default": "Great reviews" }
  ],
  "presets": [{ "name": "Review replica" }]
}
{% endschema %}
`,
    },
    requestContext
  );

  assert.equal(capturedInput.mode, "create");
  assert.equal(capturedInput.files[0].key, "sections/review-replica.liquid");
  assert.equal(
    capturedContext.themeSectionContext?.representativeSection?.key,
    "sections/testimonials.liquid"
  );
  assert.equal(capturedContext.sectionBlueprint?.category, "static");
  assert.ok(
    capturedContext.sectionBlueprint?.requiredReads?.some(
      (entry) => entry.key === "snippets/section-properties.liquid"
    )
  );
  assert.ok(
    capturedContext.sectionBlueprint?.safeUnitStrategy?.spacing,
    "planner metadata should forward a spacing strategy into the create flow"
  );
  assert.equal(
    result.sectionBlueprint?.category,
    "static",
    "create-theme-section should surface planner metadata back to the client"
  );
});

test("createThemeSection - reuses precision-first planner metadata for exact screenshot replicas", async () => {
  global.fetch = createGraphqlFetch(plannerFiles);

  let capturedContext = null;
  draftThemeArtifact.execute = async (_input, context) => {
    capturedContext = context;
    return {
      success: true,
      status: "preview_ready",
      warnings: [],
    };
  };

  const requestContext = { shopifyClient, tokenHash: "create-theme-exact-match" };
  const planResult = await planThemeEditTool.execute(
    {
      themeId: 123,
      intent: "new_section",
      template: "homepage",
      query: "Maak deze Trustpilot review slider exact na van de screenshot",
    },
    requestContext
  );

  await getThemeFilesTool.execute(planResult.nextArgsTemplate, requestContext);

  const result = await createThemeSectionTool.execute(
    {
      themeId: 123,
      key: "sections/trustpilot-slider.liquid",
      liquid: `
<section class="trustpilot-slider page-width">
  <div class="rte">{{ section.settings.heading }}</div>
</section>
{% schema %}
{
  "name": "Trustpilot slider",
  "settings": [
    { "type": "text", "id": "heading", "label": "Heading", "default": "Loved by customers" }
  ],
  "presets": [{ "name": "Trustpilot slider" }]
}
{% endschema %}
`,
    },
    requestContext
  );

  assert.equal(capturedContext.sectionBlueprint?.qualityTarget, "exact_match");
  assert.equal(capturedContext.sectionBlueprint?.generationMode, "precision_first");
  assert.equal(
    capturedContext.sectionBlueprint?.writeStrategy?.followUpTool,
    "draft-theme-artifact"
  );
  assert.equal(
    capturedContext.sectionBlueprint?.writeStrategy?.disallowPatchBatchRefine,
    true
  );
  assert.equal(result.sectionBlueprint?.qualityTarget, "exact_match");
});

test("createThemeSection - forwards media-oriented blueprint hints for hero/video sections", async () => {
  global.fetch = createGraphqlFetch(plannerFiles);

  let capturedContext = null;
  draftThemeArtifact.execute = async (_input, context) => {
    capturedContext = context;
    return {
      success: true,
      status: "preview_ready",
      warnings: [],
    };
  };

  const requestContext = { shopifyClient, tokenHash: "create-theme-media" };
  await getThemeFilesTool.execute(
    {
      themeId: 123,
      keys: [
        "sections/testimonials.liquid",
        "snippets/section-properties.liquid",
        "snippets/button.liquid",
      ],
      includeContent: true,
    },
    requestContext
  );

  const result = await createThemeSectionTool.execute(
    {
      themeId: 123,
      key: "sections/hero-video.liquid",
      liquid: `
<style>
  #shopify-section-{{ section.id }} .hero-video {
    min-height: 540px;
  }
</style>
<section class="hero-video">
  {{ section.settings.background_video | video_tag: autoplay: true, muted: true, loop: true, playsinline: true }}
</section>
{% schema %}
{
  "name": "Hero video",
  "settings": [
    { "type": "video", "id": "background_video", "label": "Background video" }
  ],
  "presets": [{ "name": "Hero video" }]
}
{% endschema %}
`,
    },
    requestContext
  );

  assert.ok(
    ["media", "hybrid"].includes(capturedContext.sectionBlueprint?.category),
    "hero/video-like sections should get media-oriented planning metadata"
  );
  assert.ok(
    capturedContext.sectionBlueprint?.optionalReads?.some(
      (entry) => entry.key === "layout/theme.liquid"
    ),
    "media sections should advertise optional global-context reads"
  );
  assert.ok(
    result.sectionBlueprint?.forbiddenPatterns?.some((entry) =>
      entry.includes("video_url")
    )
  );
});

test("createThemeSection - blocks overwriting an existing section key", async () => {
  global.fetch = createGraphqlFetch({
    ...plannerFiles,
    "sections/existing-section.liquid": makeTextAsset(`
      <div>Existing</div>
      {% schema %}
      {"name":"Existing","presets":[{"name":"Existing"}]}
      {% endschema %}
    `),
  });

  let draftExecuteCalls = 0;
  draftThemeArtifact.execute = async () => {
    draftExecuteCalls += 1;
    return { success: true, status: "preview_ready" };
  };

  const result = await createThemeSectionTool.execute(
    {
      themeId: 123,
      key: "sections/existing-section.liquid",
      liquid: `
<div>Overwrite attempt</div>
{% schema %}
{"name":"Overwrite attempt","presets":[{"name":"Overwrite attempt"}]}
{% endschema %}
`,
    },
    { shopifyClient, tokenHash: "create-theme-existing" }
  );

  assert.equal(result.success, false);
  assert.equal(result.errorCode, "existing_section_key_conflict");
  assert.equal(result.nextTool, "plan-theme-edit");
  assert.equal(draftExecuteCalls, 0);
});

test("createThemeSection - requires planner reads before writing a new section", async () => {
  global.fetch = createGraphqlFetch(plannerFiles);

  let draftExecuteCalls = 0;
  draftThemeArtifact.execute = async () => {
    draftExecuteCalls += 1;
    return { success: true, status: "preview_ready" };
  };

  const result = await createThemeSectionTool.execute(
    {
      themeId: 123,
      key: "sections/review-replica.liquid",
      liquid: `
<section class="review-replica">
  <div class="rte">{{ section.settings.heading }}</div>
</section>
{% schema %}
{
  "name": "Review replica",
  "settings": [
    { "type": "text", "id": "heading", "label": "Heading", "default": "Great reviews" }
  ],
  "presets": [{ "name": "Review replica" }]
}
{% endschema %}
`,
    },
    { shopifyClient, tokenHash: "create-theme-missing-reads" }
  );

  assert.equal(result.success, false);
  assert.equal(result.errorCode, "missing_theme_context_reads");
  assert.equal(result.nextTool, "get-theme-files");
  assert.equal(result.retryMode, "switch_tool_after_fix");
  assert.equal(draftExecuteCalls, 0);
  assert.ok(
    result.nextArgsTemplate?.keys?.includes("sections/testimonials.liquid"),
    "the repair response should point back to the required representative section read"
  );
});

test("planThemeEdit - keeps the last created section as sticky follow-up target", async () => {
  global.fetch = createGraphqlFetch(plannerFiles);

  draftThemeArtifact.execute = async () => ({
    success: true,
    status: "preview_ready",
    warnings: [],
  });

  const requestContext = { shopifyClient, tokenHash: "sticky-follow-up" };
  await getThemeFilesTool.execute(
    {
      themeId: 123,
      keys: [
        "sections/testimonials.liquid",
        "snippets/section-properties.liquid",
        "snippets/button.liquid",
      ],
      includeContent: true,
    },
    requestContext
  );

  await createThemeSectionTool.execute(
    {
      themeId: 123,
      key: "sections/hero-trustpilot.liquid",
      liquid: `
<section class="hero-trustpilot page-width">
  <div class="rte">{{ section.settings.heading }}</div>
</section>
{% schema %}
{
  "name": "Hero trustpilot",
  "settings": [
    { "type": "text", "id": "heading", "label": "Heading", "default": "Trustpilot hero" }
  ],
  "presets": [{ "name": "Hero trustpilot" }]
}
{% endschema %}
`,
    },
    requestContext
  );

  global.fetch = createGraphqlFetch({
    ...plannerFiles,
    "sections/hero-trustpilot.liquid": makeTextAsset(`
      <section class="hero-trustpilot page-width">
        <div class="rte">{{ section.settings.heading }}</div>
      </section>
      {% schema %}
      {
        "name": "Hero trustpilot",
        "settings": [
          { "type": "text", "id": "heading", "label": "Heading", "default": "Trustpilot hero" }
        ],
        "presets": [{ "name": "Hero trustpilot" }]
      }
      {% endschema %}
    `),
  });

  const planResult = await planThemeEditTool.execute(
    {
      themeId: 123,
      description: "optimaliseer hem naar ecom conversion hero",
    },
    requestContext
  );

  assert.equal(planResult.success, true);
  assert.equal(planResult.intent, "existing_edit");
  assert.equal(planResult.stickyTarget?.targetFile, "sections/hero-trustpilot.liquid");
  assert.equal(planResult.nextTool, "get-theme-file");
  assert.equal(planResult.nextArgsTemplate?.key, "sections/hero-trustpilot.liquid");
  assert.equal(planResult.requiresReadBeforeWrite, true);
  assert.equal(planResult.writeTool, "draft-theme-artifact");
});
