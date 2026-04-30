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
  #shopify-section-{{ section.id }} .review-replica__track {
    display: grid;
    grid-auto-flow: column;
    grid-auto-columns: minmax(260px, 86%);
    gap: 16px;
    overflow-x: auto;
    scroll-snap-type: x mandatory;
  }
  #shopify-section-{{ section.id }} .review-replica__card {
    padding: 20px;
    border-radius: 12px;
    min-height: 160px;
  }
  @media screen and (max-width: 749px) {
    #shopify-section-{{ section.id }} .review-replica { gap: 16px; }
  }
</style>
<review-replica class="review-replica page-width" data-section-slider>
  <div class="rte">{{ section.settings.heading }}</div>
  <button type="button" data-next aria-label="Next review">Next</button>
  <div class="review-replica__track">
    {% for block in section.blocks %}
      <article class="review-replica__card" data-section-review-item {{ block.shopify_attributes }}>
        <blockquote>{{ block.settings.quote }}</blockquote>
        <p>{{ block.settings.author }}</p>
      </article>
    {% endfor %}
  </div>
  <script>
    if (!customElements.get('review-replica')) {
      customElements.define('review-replica', class extends HTMLElement {
        connectedCallback() {
          const track = this.querySelector('.review-replica__track');
          this.querySelector('[data-next]')?.addEventListener('click', () => track?.scrollBy({ left: 280, behavior: 'smooth' }));
        }
      });
    }
  </script>
</review-replica>
{% schema %}
{
  "name": "Review replica",
  "settings": [
    { "type": "text", "id": "heading", "label": "Heading", "default": "Great reviews" }
  ],
  "blocks": [
    {
      "type": "review",
      "name": "Review",
      "settings": [
        { "type": "textarea", "id": "quote", "label": "Quote", "default": "Great service." },
        { "type": "text", "id": "author", "label": "Author", "default": "Customer" }
      ]
    }
  ],
  "presets": [{ "name": "Review replica", "blocks": [{ "type": "review" }] }]
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

test("createThemeSection - blocks generation recipe violations before draftThemeArtifact", serial, async () => {
  global.fetch = createGraphqlFetch(plannerFiles);

  let draftCalled = false;
  draftThemeArtifact.execute = async () => {
    draftCalled = true;
    return {
      success: true,
      status: "preview_ready",
      warnings: [],
    };
  };

  const result = await createThemeSectionTool.execute(
    {
      themeId: 123,
      key: "sections/review-slider-preflight.liquid",
      plannerHandoff: {
        brief: "Create a review slider with editable review cards.",
        intent: "new_section",
        themeTarget: { themeId: 123, themeRole: null },
        themeContext: {
          usesPageWidth: true,
          usesSectionPropertiesWrapper: true,
        },
        sectionBlueprint: {
          archetype: "review_slider",
          category: "hybrid",
          qualityTarget: "theme_consistent",
          promptContract: {
            promptOnly: true,
            requiresBlockBasedCards: true,
            requiresReviewCardSurface: true,
          },
          generationRecipe: {
            sectionContractType: "review_slider",
            wrapperMode: "own_scoped_shell",
            forbiddenWrapperCombinations: [
              "Do not combine section-properties background helper with a custom background shell.",
            ],
            scaleProfile: {
              contentMaxWidthDefault: 1000,
              contentMaxWidthMax: 1120,
              cardMinHeightDefault: 300,
              cardMinHeightMax: 360,
              quoteFontMaxPx: 30,
              gridGapMaxPx: 40,
              cardPaddingMaxPx: 26,
            },
            desktopMobileLayoutRequirements: {
              requiresContentWidthWrapper: true,
            },
          },
        },
      },
      liquid: `
<style>
  #shopify-section-{{ section.id }} .review-slider-preflight {
    background: #f6f3ea;
    padding: 32px 0;
  }
  #shopify-section-{{ section.id }} .review-slider-preflight__track {
    display: grid;
    grid-auto-flow: column;
    grid-auto-columns: minmax(240px, 86%);
    gap: 16px;
    overflow-x: auto;
    scroll-snap-type: x mandatory;
  }
  #shopify-section-{{ section.id }} .review-slider-preflight__card {
    padding: 20px;
    border-radius: 12px;
    min-height: 180px;
  }

  @media screen and (max-width: 749px) {
    #shopify-section-{{ section.id }} .review-slider-preflight {
      padding: 24px 0;
    }
  }
</style>
<section class="review-slider-preflight page-width">
  <div {% render 'section-properties', background: section.settings.background, text_color: section.settings.text_color %}>
    <button type="button" data-next aria-label="Next review">Next</button>
    <div class="review-slider-preflight__track">
      {% for block in section.blocks %}
        <article class="review-slider-preflight__card" {{ block.shopify_attributes }}>
          <p>{{ block.settings.quote }}</p>
          <p>{{ block.settings.author }}</p>
        </article>
      {% endfor %}
    </div>
    <script>
      const root = document.currentScript.closest('.review-slider-preflight');
      root.querySelector('[data-next]')?.addEventListener('click', () => {
        root.querySelector('.review-slider-preflight__track')?.scrollBy({ left: 280, behavior: 'smooth' });
      });
      document.addEventListener('shopify:section:load', () => {});
    </script>
  </div>
</section>
{% schema %}
{
  "name": "Review slider preflight",
  "settings": [
    { "type": "color", "id": "background", "label": "Background", "default": "#F6F3EA" },
    { "type": "color", "id": "text_color", "label": "Text color", "default": "#111111" }
  ],
  "blocks": [
    {
      "type": "review",
      "name": "Review",
      "settings": [
        { "type": "textarea", "id": "quote", "label": "Quote", "default": "Great." },
        { "type": "text", "id": "author", "label": "Author", "default": "Customer" }
      ]
    }
  ],
  "presets": [{ "name": "Review slider preflight", "blocks": [{ "type": "review" }] }]
}
{% endschema %}
`,
    },
    { shopifyClient, tokenHash: "create-theme-recipe-preflight" }
  );

  assert.equal(draftCalled, false);
  assert.equal(result.success, false);
  assert.equal(result.errorCode, "section_recipe_wrapper_mode_mismatch");
  assert.equal(result.nextTool, "create-theme-section");
  assert.ok(
    result.errors?.some((issue) => issue.issueCode === "section_recipe_wrapper_mode_mismatch")
  );
});

test("createThemeSection - blocks codegen preflight failures before draftThemeArtifact", serial, async () => {
  global.fetch = createGraphqlFetch(plannerFiles);

  let draftCalled = false;
  draftThemeArtifact.execute = async () => {
    draftCalled = true;
    return {
      success: true,
      status: "preview_ready",
      warnings: [],
    };
  };

  const result = await createThemeSectionTool.execute(
    {
      themeId: 123,
      key: "sections/unscoped-codegen.liquid",
      liquid: `
<style>
  .unscoped-codegen {
    display: grid;
    gap: 24px;
  }
</style>
<section class="unscoped-codegen">
  <h2>{{ section.settings.heading }}</h2>
</section>
{% schema %}
{
  "name": "Unscoped codegen",
  "settings": [
    { "type": "text", "id": "heading", "label": "Heading", "default": "Hello" }
  ],
  "presets": [{ "name": "Unscoped codegen" }]
}
{% endschema %}
`,
    },
    { shopifyClient, tokenHash: "create-theme-codegen-preflight" }
  );

  assert.equal(draftCalled, false);
  assert.equal(result.success, false);
  assert.equal(result.errorCode, "css_missing_section_scope");
  assert.equal(result.nextTool, "create-theme-section");
  assert.match(result.repairPrompt || "", /css_missing_section_scope/);
  assert.equal(result.codegenContract?.validationProfile, "production_visual");
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
<style>
  #shopify-section-{{ section.id }} .trustpilot-slider { display: grid; gap: 24px; }
  #shopify-section-{{ section.id }} .trustpilot-slider__track {
    display: grid;
    grid-auto-flow: column;
    grid-auto-columns: minmax(260px, 86%);
    gap: 16px;
    overflow-x: auto;
    scroll-snap-type: x mandatory;
  }
  #shopify-section-{{ section.id }} .trustpilot-slider__card {
    padding: 20px;
    border-radius: 12px;
    min-height: 160px;
  }
  @media screen and (max-width: 749px) {
    #shopify-section-{{ section.id }} .trustpilot-slider { gap: 16px; }
  }
</style>
<trustpilot-slider class="trustpilot-slider page-width" data-section-slider>
  <h2>{{ section.settings.heading }}</h2>
  <button type="button" data-next aria-label="Next review">Next</button>
  <div class="trustpilot-slider__track">
    {% for block in section.blocks %}
      <article class="trustpilot-slider__card" data-section-review-item {{ block.shopify_attributes }}>
        <div aria-label="{{ block.settings.rating }} star rating">★★★★★</div>
        <blockquote>{{ block.settings.quote }}</blockquote>
        <p>{{ block.settings.author }}</p>
      </article>
    {% endfor %}
  </div>
  <script>
    if (!customElements.get('trustpilot-slider')) {
      customElements.define('trustpilot-slider', class extends HTMLElement {
        connectedCallback() {
          const track = this.querySelector('.trustpilot-slider__track');
          this.querySelector('[data-next]')?.addEventListener('click', () => track?.scrollBy({ left: 280, behavior: 'smooth' }));
        }
      });
    }
  </script>
</trustpilot-slider>
{% schema %}
{
  "name": "Trustpilot slider",
  "settings": [
    { "type": "text", "id": "heading", "label": "Heading", "default": "Loved by customers" }
  ],
  "blocks": [
    {
      "type": "review",
      "name": "Review",
      "settings": [
        { "type": "textarea", "id": "quote", "label": "Quote", "default": "Great service." },
        { "type": "text", "id": "author", "label": "Author", "default": "Customer" },
        { "type": "range", "id": "rating", "label": "Rating", "min": 1, "max": 5, "step": 1, "default": 5 }
      ]
    }
  ],
  "presets": [{ "name": "Trustpilot slider", "blocks": [{ "type": "review" }] }]
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
  assert.ok(
    capturedContext.plannerHandoff?.layoutContract &&
      typeof capturedContext.plannerHandoff.layoutContract === "object"
  );
  assert.ok(
    capturedContext.plannerHandoff?.themeWrapperStrategy &&
      typeof capturedContext.plannerHandoff.themeWrapperStrategy === "object"
  );
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
  assert.ok(
    planResult.plannerHandoff?.layoutContract &&
      typeof planResult.plannerHandoff.layoutContract === "object"
  );
  assert.ok(
    planResult.plannerHandoff?.themeWrapperStrategy &&
      typeof planResult.plannerHandoff.themeWrapperStrategy === "object"
  );
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
  #shopify-section-{{ section.id }} .review-slider__track {
    display: grid;
    grid-auto-flow: column;
    grid-auto-columns: minmax(260px, 86%);
    gap: 16px;
    overflow-x: auto;
    scroll-snap-type: x mandatory;
  }
  #shopify-section-{{ section.id }} .review-slider__card {
    padding: 20px;
    border-radius: 12px;
    min-height: 160px;
  }
  @media screen and (max-width: 749px) {
    #shopify-section-{{ section.id }} .review-slider { gap: 16px; }
  }
</style>
<review-slider class="review-slider page-width" data-section-slider>
  <h2>{{ section.settings.heading }} <em>{{ section.settings.heading_accent }}</em></h2>
  <button type="button" data-next aria-label="Next review">Next</button>
  <div class="review-slider__track">
    {% for block in section.blocks %}
      <article class="review-slider__card" data-section-review-item {{ block.shopify_attributes }}>
        <blockquote>{{ block.settings.quote }}</blockquote>
        <p>{{ block.settings.author }}</p>
      </article>
    {% endfor %}
  </div>
  <script>
    if (!customElements.get('review-slider')) {
      customElements.define('review-slider', class extends HTMLElement {
        connectedCallback() {
          const track = this.querySelector('.review-slider__track');
          this.querySelector('[data-next]')?.addEventListener('click', () => track?.scrollBy({ left: 280, behavior: 'smooth' }));
        }
      });
    }
  </script>
</review-slider>
{% schema %}
{
  "name": "Review slider",
  "settings": [
    { "type": "text", "id": "heading", "label": "Heading", "default": "Loved by" },
    { "type": "text", "id": "heading_accent", "label": "Accent", "default": "customers" }
  ],
  "blocks": [
    {
      "type": "review",
      "name": "Review",
      "settings": [
        { "type": "textarea", "id": "quote", "label": "Quote", "default": "Great service." },
        { "type": "text", "id": "author", "label": "Author", "default": "Customer" }
      ]
    }
  ],
  "presets": [{ "name": "Review slider", "blocks": [{ "type": "review" }] }]
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

test("createThemeSection - preserves desktop/mobile exact-match review signals through planner handoff", serial, async () => {
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

  const requestContext = { shopifyClient, tokenHash: "create-theme-review-handoff" };
  const planResult = await planThemeEditTool.execute(
    {
      themeId: 123,
      intent: "new_section",
      template: "homepage",
      query:
        "Maak deze Trustpilot review slider exact na van de desktop en mobiele screenshots, met pijlen rechtsboven, dezelfde rating cards en aparte desktop/mobile composities.",
    },
    requestContext
  );

  await getThemeFilesTool.execute(planResult.nextArgsTemplate, requestContext);

  const result = await createThemeSectionTool.execute(
    {
      themeId: 123,
      key: "sections/review-slider-desktop-mobile.liquid",
      liquid: `
<style>
  #shopify-section-{{ section.id }} .review-slider {
    display: grid;
    gap: 24px;
  }
  #shopify-section-{{ section.id }} .review-slider__track {
    display: grid;
    grid-auto-flow: column;
    grid-auto-columns: minmax(240px, 86%);
    gap: 16px;
    padding: 16px;
    border-radius: 14px;
    overflow-x: auto;
    scroll-snap-type: x mandatory;
  }
  @media screen and (max-width: 749px) {
    #shopify-section-{{ section.id }} .review-slider {
      gap: 16px;
    }
  }
</style>
<review-slider class="review-slider page-width">
  <button type="button" aria-label="Previous review">Prev</button>
  <h2>{{ section.settings.heading }}</h2>
  <div class="review-slider__track">
    {% for block in section.blocks %}
      <article class="review-slider__card" data-section-review-item {{ block.shopify_attributes }}>
        <div aria-label="{{ block.settings.rating }} star rating">★★★★★</div>
        <blockquote>{{ block.settings.quote }}</blockquote>
        <p>{{ block.settings.author }}</p>
      </article>
    {% endfor %}
  </div>
  <button type="button" aria-label="Next review">Next</button>
  <script>
    if (!customElements.get('review-slider')) {
      customElements.define('review-slider', class extends HTMLElement {
        connectedCallback() {
          const track = this.querySelector('.review-slider__track');
          this.querySelector('[aria-label="Next review"]')?.addEventListener('click', () => track?.scrollBy({ left: 280, behavior: 'smooth' }));
          this.querySelector('[aria-label="Previous review"]')?.addEventListener('click', () => track?.scrollBy({ left: -280, behavior: 'smooth' }));
        }
      });
    }
  </script>
</review-slider>
{% schema %}
{
  "name": "Review slider desktop mobile",
  "settings": [
    { "type": "text", "id": "heading", "label": "Heading", "default": "Wat zeggen klanten?" }
  ],
  "blocks": [
    {
      "type": "review",
      "name": "Review",
      "settings": [
        { "type": "textarea", "id": "quote", "label": "Quote", "default": "Great service." },
        { "type": "text", "id": "author", "label": "Author", "default": "Customer" },
        { "type": "range", "id": "rating", "label": "Rating", "min": 1, "max": 5, "step": 1, "default": 5 }
      ]
    }
  ],
  "presets": [{ "name": "Review slider desktop mobile", "blocks": [{ "type": "review" }] }]
}
{% endschema %}
`,
      _tool_input_summary:
        "Maak deze Trustpilot review slider exact na van de desktop en mobiele screenshots, met pijlen rechtsboven, dezelfde rating cards en aparte desktop/mobile composities.",
    },
    requestContext
  );

  assert.equal(
    capturedContext.sectionBlueprint?.referenceSignals?.hasDesktopMobileReferences,
    true
  );
  assert.equal(
    capturedContext.sectionBlueprint?.referenceSignals?.requiresResponsiveViewportParity,
    true
  );
  assert.equal(
    capturedContext.sectionBlueprint?.referenceSignals?.requiresThemeEditorLifecycleHooks,
    true
  );
  assert.equal(
    capturedContext.sectionBlueprint?.referenceSignals?.requiresThemeWrapperMirror,
    true
  );
  assert.equal(
    capturedContext.sectionBlueprint?.referenceSignals?.requiresNavButtons,
    true
  );
  assert.equal(
    result.plannerHandoff?.sectionBlueprint?.referenceSignals?.hasDesktopMobileReferences,
    true
  );
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
    min-height: 340px;
  }
</style>
<section class="hero-video page-width">
  {% if section.settings.background_video != blank %}
    {{ section.settings.background_video | video_tag: autoplay: true, muted: true, loop: true, playsinline: true }}
  {% endif %}
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
  assert.equal(
    capturedContext.sectionBlueprint?.promptContract?.requiresVideoSourceSetting,
    true,
    "prompt-only video sections should carry the video source contract into create validation"
  );
  assert.equal(
    capturedContext.sectionBlueprint?.promptContract?.requiresVideoRenderablePath,
    true,
    "prompt-only video sections should carry the renderable video path contract into create validation"
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

test("createThemeSection - forwards prompt-only review contracts for non-exact review sections", serial, async () => {
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

  const requestContext = { shopifyClient, tokenHash: "create-theme-review-prompt-only" };
  const planResult = await planThemeEditTool.execute(
    {
      themeId: 123,
      intent: "new_section",
      template: "homepage",
      query: "Maak een review section met 3 kaarten, klantnamen en sterrenrating",
    },
    requestContext
  );

  await getThemeFilesTool.execute(planResult.nextArgsTemplate, requestContext);

  const result = await createThemeSectionTool.execute(
    {
      themeId: 123,
      key: "sections/review-cards.liquid",
      liquid: `
<style>
  #shopify-section-{{ section.id }} .review-cards {
    display: grid;
    gap: 24px;
  }
  #shopify-section-{{ section.id }} .review-cards__card {
    padding: 20px;
    border-radius: 12px;
    min-height: 160px;
  }
  @media screen and (max-width: 749px) {
    #shopify-section-{{ section.id }} .review-cards {
      gap: 16px;
    }
  }
</style>
<section class="review-cards page-width">
  {% for block in section.blocks %}
    <article class="review-cards__card" {{ block.shopify_attributes }}>
      <div class="review-cards__stars" aria-label="{{ block.settings.rating }} star rating">★★★★★</div>
      <blockquote>{{ block.settings.quote }}</blockquote>
      <p>{{ block.settings.author }}</p>
    </article>
  {% endfor %}
</section>
{% schema %}
{
  "name": "Review cards",
  "blocks": [
    {
      "type": "review",
      "name": "Review",
      "settings": [
        { "type": "text", "id": "quote", "label": "Quote", "default": "Great quality." },
        { "type": "text", "id": "author", "label": "Author", "default": "Verified customer" },
        { "type": "range", "id": "rating", "label": "Rating", "min": 1, "max": 5, "step": 1, "default": 5 }
      ]
    }
  ],
  "presets": [
    { "name": "Review cards", "blocks": [{ "type": "review" }, { "type": "review" }, { "type": "review" }] }
  ]
}
{% endschema %}
`,
      plannerHandoff: planResult.plannerHandoff,
    },
    requestContext
  );

  assert.equal(result.success, true);
  assert.equal(capturedContext.sectionBlueprint?.archetype, "review_section");
  assert.equal(
    capturedContext.sectionBlueprint?.promptContract?.requiresBlockBasedCards,
    true
  );
  assert.equal(
    result.plannerHandoff?.sectionBlueprint?.promptContract?.requiresReviewCardSurface,
    true
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
  #shopify-section-{{ section.id }} .review-replica__track {
    display: grid;
    grid-auto-flow: column;
    grid-auto-columns: minmax(260px, 86%);
    gap: 16px;
    overflow-x: auto;
    scroll-snap-type: x mandatory;
  }
  #shopify-section-{{ section.id }} .review-replica__card {
    padding: 20px;
    border-radius: 12px;
    min-height: 160px;
  }
  @media screen and (max-width: 749px) {
    #shopify-section-{{ section.id }} .review-replica { gap: 16px; }
  }
</style>
<review-replica class="review-replica page-width" data-section-slider>
  <div class="rte">{{ section.settings.heading }}</div>
  <button type="button" data-next aria-label="Next review">Next</button>
  <div class="review-replica__track">
    {% for block in section.blocks %}
      <article class="review-replica__card" data-section-review-item {{ block.shopify_attributes }}>
        <blockquote>{{ block.settings.quote }}</blockquote>
        <p>{{ block.settings.author }}</p>
      </article>
    {% endfor %}
  </div>
  <script>
    if (!customElements.get('review-replica')) {
      customElements.define('review-replica', class extends HTMLElement {
        connectedCallback() {
          const track = this.querySelector('.review-replica__track');
          this.querySelector('[data-next]')?.addEventListener('click', () => track?.scrollBy({ left: 280, behavior: 'smooth' }));
        }
      });
    }
  </script>
</review-replica>
{% schema %}
{
  "name": "Review replica",
  "settings": [
    { "type": "text", "id": "heading", "label": "Heading", "default": "Great reviews" }
  ],
  "blocks": [
    {
      "type": "review",
      "name": "Review",
      "settings": [
        { "type": "textarea", "id": "quote", "label": "Quote", "default": "Great service." },
        { "type": "text", "id": "author", "label": "Author", "default": "Customer" }
      ]
    }
  ],
  "presets": [{ "name": "Review replica", "blocks": [{ "type": "review" }] }]
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
