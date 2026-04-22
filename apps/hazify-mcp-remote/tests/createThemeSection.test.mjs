import test from "node:test";
import assert from "node:assert";
import { createThemeSectionTool } from "../src/tools/createThemeSection.js";
import { getThemeFileTool } from "../src/tools/getThemeFile.js";
import { getThemeFilesTool } from "../src/tools/getThemeFiles.js";
import { planThemeEditTool } from "../src/tools/planThemeEdit.js";
import { draftThemeArtifact } from "../src/tools/draftThemeArtifact.js";
import {
  clearThemeEditMemory,
  rememberThemePlan,
  rememberThemeRead,
  rememberThemeWrite,
} from "../src/lib/themeEditMemory.js";

const originalFetch = global.fetch;
const originalDraftExecute = draftThemeArtifact.execute;
const serial = { concurrency: false };

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

    if (
      query.includes("ThemeFilesByIdWithContent") ||
      query.includes("ThemeFilesByIdMetadata") ||
      query.includes("ThemeFileById")
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

test("createThemeSection - forwards static section blueprint and theme context from the planner", serial, async () => {
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

test("createThemeSection - reuses precision-first planner metadata for exact screenshot replicas", serial, async () => {
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
  assert.equal(capturedContext.plannerHandoff?.qualityTarget, "exact_match");
  assert.equal(capturedContext.plannerHandoff?.archetype, "review_slider");
  assert.equal(
    capturedContext.sectionBlueprint?.completionPolicy?.deliveryExpectation,
    "final_reference_match_in_first_write"
  );
  assert.equal(
    capturedContext.sectionBlueprint?.writeStrategy?.followUpTool,
    "draft-theme-artifact"
  );
  assert.equal(
    capturedContext.sectionBlueprint?.writeStrategy?.disallowPatchBatchRefine,
    true
  );
  assert.equal(result.sectionBlueprint?.qualityTarget, "exact_match");
  assert.equal(result.plannerHandoff?.qualityTarget, "exact_match");
  assert.equal(
    result.completionPolicy?.deliveryExpectation,
    "final_reference_match_in_first_write"
  );
  assert.equal(result.completionPolicy?.askBeforeVisualRefinement, false);
  assert.ok(
    Array.isArray(planResult.requiredToolNames) &&
      planResult.requiredToolNames.includes("get-theme-files") &&
      planResult.requiredToolNames.includes("create-theme-section")
  );
  assert.equal(planResult.plannerHandoff?.archetype, "review_slider");
  assert.equal(planResult.plannerHandoff?.qualityTarget, "exact_match");
  assert.equal(planResult.plannerHandoff?.themeTarget?.themeId, 123);
  assert.equal(planResult.plannerHandoff?.sectionBlueprint?.qualityTarget, "exact_match");
});

test("createThemeSection - keeps exact-match planner context even when a compat summary is present", serial, async () => {
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

  const requestContext = { shopifyClient, tokenHash: "create-theme-summary-handoff" };
  const planResult = await planThemeEditTool.execute(
    {
      themeId: 123,
      intent: "new_section",
      template: "homepage",
      query:
        "Maak een review slider exact na van de screenshot met cursieve titel en navigatiepijlen rechtsboven",
    },
    requestContext
  );

  await getThemeFilesTool.execute(planResult.nextArgsTemplate, requestContext);

  const result = await createThemeSectionTool.execute(
    {
      themeId: 123,
      key: "sections/review-slider.liquid",
      liquid: `
<style>
  #shopify-section-{{ section.id }} .review-slider {
    display: grid;
    gap: 24px;
  }
</style>
<section class="review-slider page-width">
  <h2>{{ section.settings.heading }} <em>{{ section.settings.heading_accent }}</em></h2>
</section>
{% schema %}
{
  "name": "Review slider",
  "settings": [
    { "type": "text", "id": "heading", "label": "Heading", "default": "Loved by" },
    { "type": "text", "id": "heading_accent", "label": "Accent", "default": "customers" }
  ],
  "presets": [{ "name": "Review slider" }]
}
{% endschema %}
`,
      _tool_input_summary:
        "Maak een review slider exact na van de screenshot met cursieve titel en navigatiepijlen rechtsboven",
    },
    requestContext
  );

  assert.equal(capturedContext.sectionBlueprint?.qualityTarget, "exact_match");
  assert.equal(capturedContext.plannerHandoff?.brief, planResult.plannerHandoff?.brief);
  assert.equal(result.plannerHandoff?.qualityTarget, "exact_match");
});

test("createThemeSection - can continue from plannerHandoff alone when session memory is absent", serial, async () => {
  global.fetch = createGraphqlFetch({
    "sections/custom-reference.liquid": makeTextAsset(`
      <section class="custom-reference page-width">
        <div class="rte">{{ section.settings.heading }}</div>
      </section>
      {% schema %}
      {
        "name": "Custom reference",
        "settings": [
          { "type": "text", "id": "heading", "label": "Heading", "default": "Reference" }
        ],
        "presets": [{ "name": "Custom reference" }]
      }
      {% endschema %}
    `),
    "snippets/custom-helper.liquid": makeTextAsset(`
      <div class="custom-helper" data-section-id="{{ section.id }}"></div>
    `),
  });

  let capturedContext = null;
  draftThemeArtifact.execute = async (_input, context) => {
    capturedContext = context;
    return {
      success: true,
      status: "preview_ready",
      warnings: [],
    };
  };

  const requestContext = { shopifyClient, tokenHash: "create-theme-handoff-only" };
  const result = await createThemeSectionTool.execute(
    {
      themeId: 123,
      key: "sections/handoff-review.liquid",
      liquid: `
<section class="handoff-review page-width">
  <div class="rte">{{ section.settings.heading }}</div>
</section>
{% schema %}
{
  "name": "Handoff review",
  "settings": [
    { "type": "text", "id": "heading", "label": "Heading", "default": "Portable handoff" }
  ],
  "presets": [{ "name": "Handoff review" }]
}
{% endschema %}
`,
      plannerHandoff: {
        brief: "Maak een review section die de bestaande helper en schaal volgt",
        intent: "new_section",
        themeTarget: {
          themeId: 123,
          themeRole: null,
        },
        themeContext: {
          representativeSection: {
            key: "sections/custom-reference.liquid",
          },
        },
        sectionBlueprint: {
          category: "static",
          qualityTarget: "theme_consistent",
          generationMode: "best_practice",
          completionPolicy: {
            deliveryExpectation: "complete_section",
          },
          requiredReads: [
            { key: "sections/custom-reference.liquid" },
            { key: "snippets/custom-helper.liquid" },
          ],
          relevantHelpers: [
            { key: "snippets/custom-helper.liquid" },
          ],
          safeUnitStrategy: {
            spacing: "mirror_reference_section",
          },
        },
        requiredReadKeys: [
          "sections/custom-reference.liquid",
          "snippets/custom-helper.liquid",
        ],
        nextWriteKeys: [],
      },
    },
    requestContext
  );

  assert.equal(result.success, true);
  assert.equal(
    capturedContext.themeSectionContext?.representativeSection?.key,
    "sections/custom-reference.liquid"
  );
  assert.ok(
    capturedContext.sectionBlueprint?.requiredReads?.some(
      (entry) => entry.key === "snippets/custom-helper.liquid"
    )
  );
  assert.ok(
    result.warnings?.some((warning) =>
      warning.includes("Planner-required theme-context reads zijn automatisch opgehaald")
    ),
    "create-theme-section should hydrate required reads from plannerHandoff even without session memory"
  );
});

test("createThemeSection - forwards media-oriented blueprint hints for hero/video sections", serial, async () => {
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

test("createThemeSection - blocks overwriting an existing section key", serial, async () => {
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

  const requestContext = { shopifyClient, tokenHash: "create-theme-existing" };
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
      key: "sections/existing-section.liquid",
      liquid: `
<div>Overwrite attempt</div>
{% schema %}
{"name":"Overwrite attempt","presets":[{"name":"Overwrite attempt"}]}
{% endschema %}
`,
    },
    requestContext
  );

  assert.equal(result.success, false);
  assert.equal(result.errorCode, "existing_section_key_conflict");
  assert.equal(result.nextAction, "choose_edit_or_alternate_key");
  assert.equal(result.nextTool, "plan-theme-edit");
  assert.equal(result.writeTool, "draft-theme-artifact");
  assert.equal(result.writeArgsTemplate?.mode, "edit");
  assert.equal(
    result.writeArgsTemplate?.files?.[0]?.value,
    "<full rewritten file content>"
  );
  assert.equal(result.plannerHandoff?.intent, "existing_edit");
  assert.equal(result.plannerHandoff?.targetFile, "sections/existing-section.liquid");
  assert.ok(
    result.requiredToolNames?.includes("draft-theme-artifact"),
    "existing-file create conflicts should advertise the correct edit write tool"
  );
  assert.ok(
    Array.isArray(result.repairSequence) && result.repairSequence.length >= 3,
    "create conflict repairs should include an explicit multi-step sequence for stateless clients"
  );
  assert.equal(
    result.nextArgsTemplate?.query,
    "Maak deze Trustpilot review slider exact na van de screenshot",
    "the edit fallback should preserve the original planning query instead of reducing it to just the filename"
  );
  assert.ok(
    result.newFileSuggestions?.includes("sections/existing-section-v2.liquid"),
    "the create repair response should suggest a safe alternate file key"
  );
  assert.equal(
    result.alternativeNextArgsTemplates?.createAlternateSection?.key,
    "sections/existing-section-v2.liquid"
  );
  assert.equal(draftExecuteCalls, 0);
});

test("createThemeSection - auto-hydrates planner reads before writing a new section", serial, async () => {
  global.fetch = createGraphqlFetch(plannerFiles);

  let draftExecuteCalls = 0;
  draftThemeArtifact.execute = async () => {
    draftExecuteCalls += 1;
    return { success: true, status: "preview_ready", warnings: [] };
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

  assert.equal(result.success, true);
  assert.equal(draftExecuteCalls, 1);
  assert.ok(
    result.warnings?.some((warning) =>
      warning.includes("Planner-required theme-context reads zijn automatisch opgehaald")
    ),
    "create-theme-section should auto-hydrate exact planner reads when they are safely derivable"
  );
  assert.equal(result.recommendedFollowUpTool, "plan-theme-edit");
  assert.equal(result.recommendedFollowUpArgsTemplate?.intent, "existing_edit");
  assert.equal(
    result.recommendedFollowUpArgsTemplate?.targetFile,
    "sections/review-replica.liquid"
  );
});

test("createThemeSection - accepts required planner reads gathered via multiple exact get-theme-file calls", serial, async () => {
  global.fetch = createGraphqlFetch(plannerFiles);

  let draftExecuteCalls = 0;
  draftThemeArtifact.execute = async () => {
    draftExecuteCalls += 1;
    return { success: true, status: "preview_ready", warnings: [] };
  };

  const requestContext = { shopifyClient, tokenHash: "create-theme-single-read-loop" };
  const planResult = await planThemeEditTool.execute(
    {
      themeId: 123,
      intent: "new_section",
      template: "homepage",
      query: "Maak deze review slider exact na van de screenshot",
    },
    requestContext
  );

  for (const key of planResult.nextReadKeys || []) {
    await getThemeFileTool.execute(
      {
        themeId: 123,
        key,
        includeContent: true,
      },
      requestContext
    );
  }

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

  assert.equal(result.success, true);
  assert.equal(draftExecuteCalls, 1);
});

test("createThemeSection - auto-switches to edit when the same newly created section is refined via create again", serial, async () => {
  global.fetch = createGraphqlFetch({
    ...plannerFiles,
    "sections/feature-comparison-women.liquid": makeTextAsset(`
      <div>Existing generated section</div>
      {% schema %}
      {"name":"Feature comparison women","presets":[{"name":"Feature comparison women"}]}
      {% endschema %}
    `),
  });

  let capturedArgs = null;
  let capturedContext = null;
  draftThemeArtifact.execute = async (args, context) => {
    capturedArgs = args;
    capturedContext = context;
    return { success: true, status: "preview_ready", warnings: [] };
  };

  const requestContext = { shopifyClient, tokenHash: "create-theme-refine-auto-switch" };
  rememberThemeWrite(requestContext, {
    themeId: 123,
    intent: "new_section",
    mode: "create",
    files: [{ key: "sections/feature-comparison-women.liquid" }],
    createdSectionFile: "sections/feature-comparison-women.liquid",
  });
  rememberThemeRead(requestContext, {
    themeId: 123,
    files: [
      {
        key: "sections/feature-comparison-women.liquid",
        found: true,
        value: "<div>Existing generated section</div>",
      },
    ],
  });

  const result = await createThemeSectionTool.execute(
    {
      themeId: 123,
      key: "sections/feature-comparison-women.liquid",
      liquid: `
<section class="feature-comparison-women">
  <div class="feature-comparison-women__inner">
    <h2>{{ section.settings.heading }}</h2>
  </div>
</section>
{% schema %}
{
  "name": "Feature comparison women",
  "settings": [
    { "type": "text", "id": "heading", "label": "Heading", "default": "This is what sets us apart." }
  ],
  "presets": [{ "name": "Feature comparison women" }]
}
{% endschema %}
`,
    },
    requestContext
  );

  assert.equal(result.success, true);
  assert.equal(result.autoSwitchedToEdit, true);
  assert.equal(result.autoSwitchReason, "recent_same_section_refinement");
  assert.equal(result.originalRequestedTool, "create-theme-section");
  assert.equal(result.writeToolUsed, "draft-theme-artifact");
  assert.equal(result.writeModeUsed, "edit");
  assert.equal(capturedArgs?.mode, "edit");
  assert.equal(
    capturedArgs?.files?.[0]?.key,
    "sections/feature-comparison-women.liquid"
  );
  assert.equal(
    result.recommendedFollowUpArgsTemplate?.targetFile,
    "sections/feature-comparison-women.liquid"
  );
  assert.ok(
    result.warnings?.some((warning) => warning.includes("veilig omgezet naar een existing_edit rewrite")),
    "auto-switched create refinements should explain why the request was converted to edit mode"
  );
  assert.equal(capturedContext?.plannerHandoff?.intent, "existing_edit");
});

test("planThemeEdit - keeps the last created section as sticky follow-up target", serial, async () => {
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
  assert.equal(
    planResult.writeArgsTemplate?.mode,
    "edit",
    "rewrite-existing follow-up prompts should produce an edit-mode draft template for existing files"
  );
  assert.equal(
    planResult.writeArgsTemplate?.files?.[0]?.key,
    "sections/hero-trustpilot.liquid",
    "rewrite-existing follow-up prompts should keep the existing section as the draft target"
  );
});

test("planThemeEdit - keeps the recent existing-edit target as sticky follow-up target", serial, async () => {
  global.fetch = createGraphqlFetch(plannerFiles);

  const requestContext = { shopifyClient, tokenHash: "sticky-existing-edit-follow-up" };
  rememberThemePlan(requestContext, {
    themeId: 123,
    intent: "existing_edit",
    targetFile: "sections/testimonials.liquid",
    nextReadKeys: ["sections/testimonials.liquid"],
    nextWriteKeys: ["sections/testimonials.liquid"],
    immediateNextTool: "get-theme-file",
    writeTool: "draft-theme-artifact",
  });

  const planResult = await planThemeEditTool.execute(
    {
      themeId: 123,
      description: "maak hem mobiel compacter en rustiger",
    },
    requestContext
  );

  assert.equal(planResult.success, true);
  assert.equal(planResult.intent, "existing_edit");
  assert.equal(planResult.stickyTarget?.source, "recent_plan_target");
  assert.equal(planResult.stickyTarget?.targetFile, "sections/testimonials.liquid");
  assert.equal(planResult.nextTool, "get-theme-file");
  assert.equal(planResult.nextArgsTemplate?.key, "sections/testimonials.liquid");
  assert.equal(planResult.requiresReadBeforeWrite, true);
  assert.equal(planResult.writeTool, "draft-theme-artifact");
  assert.equal(
    planResult.writeArgsTemplate?.mode,
    "edit",
    "sticky existing-edit refinements should hand off to draft-theme-artifact edit mode, not create mode"
  );
  assert.equal(
    planResult.writeArgsTemplate?.files?.[0]?.key,
    "sections/testimonials.liquid",
    "sticky existing-edit refinements should preserve the exact existing file in the write template"
  );
});

test("planThemeEdit - does not reuse a sticky target after an explicit theme switch", serial, async () => {
  global.fetch = createGraphqlFetch(plannerFiles);

  const requestContext = { shopifyClient, tokenHash: "sticky-theme-switch-follow-up" };
  rememberThemePlan(requestContext, {
    themeRole: "main",
    intent: "existing_edit",
    targetFile: "sections/testimonials.liquid",
    nextReadKeys: ["sections/testimonials.liquid"],
    nextWriteKeys: ["sections/testimonials.liquid"],
    immediateNextTool: "get-theme-file",
    writeTool: "draft-theme-artifact",
  });

  const planResult = await planThemeEditTool.execute(
    {
      themeId: 222,
      description: "maak hem mobiel compacter en rustiger",
    },
    requestContext
  );

  assert.equal(
    Boolean(planResult.stickyTarget),
    false,
    "plan-theme-edit should not silently reuse a remembered target after the user explicitly switches themes"
  );
  assert.equal(planResult.normalizedArgs?.themeId, 222);
});
