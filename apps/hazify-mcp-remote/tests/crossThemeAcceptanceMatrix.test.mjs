import test from "node:test";
import assert from "node:assert";
import { createThemeSectionTool } from "../src/tools/createThemeSection.js";
import { draftThemeArtifact } from "../src/tools/draftThemeArtifact.js";
import { getThemeFileTool } from "../src/tools/getThemeFile.js";
import { getThemeFilesTool } from "../src/tools/getThemeFiles.js";
import { patchThemeFileTool } from "../src/tools/patchThemeFile.js";
import { planThemeEditTool } from "../src/tools/planThemeEdit.js";
import { searchThemeFilesTool } from "../src/tools/searchThemeFiles.js";
import { clearThemeEditMemory } from "../src/lib/themeEditMemory.js";
import { createThemeDraftDbHarness } from "./helpers/themeDraftDbHarness.mjs";
import { createThemeFixtureFetch } from "./helpers/themeFixtureHarness.mjs";
import { matrixFixtures } from "./fixtures/themes/matrix.mjs";

process.env.NODE_ENV = "test";

const originalFetch = global.fetch;
const themeDraftDb = createThemeDraftDbHarness();

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

test.after(async () => {
  global.fetch = originalFetch;
  clearThemeEditMemory();
  await themeDraftDb.cleanup();
});

test.afterEach(() => {
  global.fetch = originalFetch;
  clearThemeEditMemory();
});

function buildMerchantEditableSectionLiquid({ label }) {
  const schemaName = "Matrix section";
  const defaultEyebrow = String(label || "Matrix section").slice(0, 48);

  return `
<style>
  #shopify-section-{{ section.id }} .matrix-section {
    display: grid;
    gap: 24px;
    padding: 24px;
    border-radius: 24px;
  }

  #shopify-section-{{ section.id }} .matrix-section__grid {
    display: grid;
    gap: 24px;
    align-items: center;
  }

  #shopify-section-{{ section.id }} .matrix-section__image {
    width: 100%;
    height: auto;
    border-radius: 20px;
    display: block;
  }

  #shopify-section-{{ section.id }} .matrix-section__button {
    display: inline-flex;
    margin-top: 16px;
    padding: 12px 20px;
    border-radius: 999px;
    text-decoration: none;
  }

  @media screen and (min-width: 750px) {
    #shopify-section-{{ section.id }} .matrix-section__grid {
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    }
  }
</style>

<section class="matrix-section page-width">
  <div class="matrix-section__grid">
    <div>
      <p>{{ section.settings.eyebrow }}</p>
      <h2>{{ section.settings.heading }}</h2>
      <div class="rte">{{ section.settings.body }}</div>
      {% if section.settings.button_url != blank %}
        <a class="matrix-section__button" href="{{ section.settings.button_url }}">{{ section.settings.button_label }}</a>
      {% else %}
        <span class="matrix-section__button">{{ section.settings.button_label }}</span>
      {% endif %}
    </div>
    <div>
      {% if section.settings.image != blank %}
        {{ section.settings.image | image_url: width: 1200 | image_tag: class: 'matrix-section__image', loading: 'lazy', widths: '480, 720, 960, 1200' }}
      {% endif %}
    </div>
  </div>
</section>

{% schema %}
{
  "name": "${schemaName}",
  "settings": [
    { "type": "text", "id": "eyebrow", "label": "Eyebrow", "default": "${defaultEyebrow}" },
    { "type": "text", "id": "heading", "label": "Heading", "default": "Built for merchants" },
    { "type": "textarea", "id": "body", "label": "Body", "default": "Merchant editable content that works across multiple theme archetypes." },
    { "type": "text", "id": "button_label", "label": "Button label", "default": "Learn more" },
    { "type": "url", "id": "button_url", "label": "Button URL" },
    { "type": "image_picker", "id": "image", "label": "Image" },
    { "type": "range", "id": "gap", "label": "Gap", "min": 0, "max": 40, "step": 4, "default": 24 }
  ],
  "presets": [{ "name": "${schemaName}" }]
}
{% endschema %}
`;
}

function buildPromptOnlyReviewSectionLiquid({ label }) {
  const schemaName = "Matrix review cards";
  const defaultHeading = String(label || "Review cards").slice(0, 48);

  return `
<style>
  #shopify-section-{{ section.id }} .matrix-reviews {
    display: grid;
    gap: 24px;
    padding: 24px 0;
  }

  #shopify-section-{{ section.id }} .matrix-reviews__grid {
    display: grid;
    gap: 16px;
  }

  #shopify-section-{{ section.id }} .matrix-reviews__card {
    display: grid;
    gap: 12px;
    padding: 20px;
    border-radius: 16px;
    background: #ffffff;
    border: 1px solid rgba(0, 0, 0, 0.1);
  }

  #shopify-section-{{ section.id }} .matrix-reviews__stars {
    letter-spacing: 0;
  }

  #shopify-section-{{ section.id }} .matrix-reviews__avatar {
    width: 56px;
    height: 56px;
    border-radius: 999px;
    object-fit: cover;
  }

  @media screen and (min-width: 750px) {
    #shopify-section-{{ section.id }} .matrix-reviews__grid {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }
  }
</style>

<section class="matrix-reviews page-width">
  <h2>{{ section.settings.heading }}</h2>
  <div class="matrix-reviews__grid">
    {% for block in section.blocks %}
      <article class="matrix-reviews__card" {{ block.shopify_attributes }}>
        {% if block.settings.avatar != blank %}
          {{ block.settings.avatar | image_url: width: 160 | image_tag: class: 'matrix-reviews__avatar', loading: 'lazy', widths: '80, 120, 160' }}
        {% endif %}
        <div class="matrix-reviews__stars" aria-label="{{ block.settings.rating }} star rating">★★★★★</div>
        <blockquote>{{ block.settings.quote }}</blockquote>
        <p>{{ block.settings.author }}</p>
      </article>
    {% endfor %}
  </div>
</section>

{% schema %}
{
  "name": "${schemaName}",
  "settings": [
    { "type": "text", "id": "heading", "label": "Heading", "default": "${defaultHeading}" },
    { "type": "range", "id": "padding_top", "label": "Padding top", "min": 0, "max": 80, "step": 4, "default": 24 },
    { "type": "range", "id": "padding_bottom", "label": "Padding bottom", "min": 0, "max": 80, "step": 4, "default": 24 }
  ],
  "blocks": [
    {
      "type": "review",
      "name": "Review",
      "settings": [
        { "type": "image_picker", "id": "avatar", "label": "Avatar" },
        { "type": "textarea", "id": "quote", "label": "Quote", "default": "Excellent support and product quality." },
        { "type": "text", "id": "author", "label": "Author", "default": "Verified customer" },
        { "type": "range", "id": "rating", "label": "Rating", "min": 1, "max": 5, "step": 1, "default": 5 }
      ]
    }
  ],
  "presets": [
    { "name": "${schemaName}", "blocks": [{ "type": "review" }, { "type": "review" }, { "type": "review" }] }
  ]
}
{% endschema %}
`;
}

function buildExactReplicaSectionLiquid({ label, strictRenderableMedia = false }) {
  const schemaName = strictRenderableMedia
    ? "Image backed reference"
    : "Screenshot reference";
  const demoImageUrl = strictRenderableMedia
    ? "https://cdn.shopify.com/s/files/1/0000/0001/files/reference-hero-1.jpg?v=1"
    : "https://cdn.shopify.com/s/files/1/0000/0001/files/reference-shell.jpg?v=1";
  const defaultHeading = String(label || "Reference match").slice(0, 48);

  return `
<style>
  #shopify-section-{{ section.id }} .reference-match {
    display: grid;
    gap: 28px;
    padding: 24px 0;
  }

  #shopify-section-{{ section.id }} .reference-match__shell {
    display: grid;
    gap: 28px;
    padding: 28px;
    border-radius: 28px;
    background: linear-gradient(180deg, #f4eddc 0%, #fffaf1 100%);
    overflow: hidden;
  }

  #shopify-section-{{ section.id }} .reference-match__badge {
    display: inline-flex;
    align-items: center;
    padding: 8px 14px;
    border-radius: 999px;
    background: rgba(75, 53, 44, 0.1);
    font-size: 0.75rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  #shopify-section-{{ section.id }} .reference-match__rating {
    display: inline-flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px;
    margin: 18px 0 0;
  }

  #shopify-section-{{ section.id }} .reference-match__stars {
    display: inline-flex;
    gap: 4px;
    color: #2f6a52;
    font-size: 1rem;
  }

  #shopify-section-{{ section.id }} .reference-match__cta {
    display: inline-flex;
    align-items: center;
    margin-top: 18px;
    padding: 12px 20px;
    border-radius: 999px;
    background: #4b352c;
    color: #fff9f1;
    text-decoration: none;
  }

  #shopify-section-{{ section.id }} .reference-match__rows {
    display: grid;
    gap: 10px;
    margin-top: 18px;
  }

  #shopify-section-{{ section.id }} .reference-match__row {
    display: flex;
    justify-content: space-between;
    gap: 16px;
    padding: 12px 14px;
    border-radius: 14px;
    background: rgba(255, 255, 255, 0.72);
  }

  #shopify-section-{{ section.id }} .reference-match__media {
    min-height: 320px;
    border-radius: 24px;
    background: radial-gradient(circle at top, rgba(255,255,255,0.85), rgba(230,216,170,0.85));
    display: grid;
    place-items: center;
    overflow: hidden;
  }

  #shopify-section-{{ section.id }} .reference-match__image {
    width: 100%;
    height: auto;
    display: block;
  }

  @media screen and (min-width: 750px) {
    #shopify-section-{{ section.id }} .reference-match__shell {
      grid-template-columns: minmax(0, 1.05fr) minmax(0, 0.95fr);
      align-items: center;
    }
  }

  @media screen and (max-width: 749px) {
    #shopify-section-{{ section.id }} .reference-match__shell {
      padding: 22px;
      gap: 20px;
    }
  }
</style>

<section class="reference-match page-width container">
  <div class="reference-match__shell reference-match__panel">
    <div class="reference-match__copy">
      <p class="reference-match__badge">{{ section.settings.badge_label }}</p>
      <div class="reference-match__rating" aria-label="5 star rating">
        <span class="reference-match__stars" aria-hidden="true">★★★★★</span>
        <span>{{ section.settings.rating_label }}</span>
      </div>
      <h2>{{ section.settings.heading }}</h2>
      <div class="rte">{{ section.settings.body }}</div>
      <article class="reference-match__card comparison-card">
        <div class="reference-match__rows">
          {% for block in section.blocks %}
            <div class="reference-match__row" {{ block.shopify_attributes }}>
              <span>{{ block.settings.label }}</span>
              <strong>{{ block.settings.value }}</strong>
            </div>
          {% endfor %}
        </div>
      </article>
      {% if section.settings.cta_url != blank %}
        <a class="reference-match__cta" href="{{ section.settings.cta_url }}">{{ section.settings.cta_label }}</a>
      {% else %}
        <span class="reference-match__cta">{{ section.settings.cta_label }}</span>
      {% endif %}
    </div>
    <div class="reference-match__media">
      {% if section.settings.media != blank %}
        {{ section.settings.media | image_url: width: 1440 | image_tag: class: 'reference-match__image', loading: 'lazy', widths: '480, 720, 960, 1280', alt: section.settings.heading }}
      {% else %}
        <img
          class="reference-match__image"
          src="${demoImageUrl}"
          alt=""
          loading="lazy"
          width="720"
          height="900"
        >
      {% endif %}
    </div>
  </div>
</section>

{% schema %}
{
  "name": "${schemaName}",
  "settings": [
    { "type": "text", "id": "badge_label", "label": "Badge label", "default": "Clinically backed" },
    { "type": "text", "id": "rating_label", "label": "Rating label", "default": "4.9/5 by verified customers" },
    { "type": "text", "id": "heading", "label": "Heading", "default": "${defaultHeading}" },
    { "type": "richtext", "id": "body", "label": "Body", "default": "<p>Precision-first layout with responsive parity, rating stars and merchant-editable content.</p>" },
    { "type": "text", "id": "cta_label", "label": "CTA label", "default": "Shop now" },
    { "type": "url", "id": "cta_url", "label": "CTA URL" },
    { "type": "image_picker", "id": "media", "label": "Media" },
    { "type": "range", "id": "padding_top", "label": "Padding top", "min": 0, "max": 80, "step": 4, "default": 24 },
    { "type": "range", "id": "padding_bottom", "label": "Padding bottom", "min": 0, "max": 80, "step": 4, "default": 24 },
    { "type": "color", "id": "surface_color", "label": "Surface color", "default": "#fffaf1" }
  ],
  "blocks": [
    {
      "type": "row",
      "name": "Comparison row",
      "settings": [
        { "type": "text", "id": "label", "label": "Label", "default": "Responsive layout" },
        { "type": "text", "id": "value", "label": "Value", "default": "Included" }
      ]
    }
  ],
  "presets": [{ "name": "${schemaName}", "blocks": [{ "type": "row" }, { "type": "row" }] }]
}
{% endschema %}
`;
}

function buildTemplatePlacementValue(templateKey, currentValue, sectionHandle) {
  if (templateKey.endsWith(".json")) {
    const parsed = JSON.parse(currentValue);
    parsed.sections = parsed.sections || {};
    parsed.order = Array.isArray(parsed.order) ? parsed.order : Object.keys(parsed.sections);
    if (!parsed.sections.matrix_acceptance) {
      parsed.sections.matrix_acceptance = { type: sectionHandle };
    }
    if (!parsed.order.includes("matrix_acceptance")) {
      parsed.order.push("matrix_acceptance");
    }
    return JSON.stringify(parsed, null, 2);
  }

  const reference = `{% section '${sectionHandle}' %}`;
  if (currentValue.includes(reference)) {
    return currentValue;
  }
  return `${currentValue.trim()}\n${reference}\n`;
}

function assertMerchantEditableSection(value) {
  assert.match(value, /"type":\s*"image_picker"/);
  assert.match(value, /"type":\s*"textarea"/);
  assert.match(value, /"type":\s*"range"/);
  assert.match(value, /"presets":\s*\[/);
}

function replaceLiquidSchema(value, updater) {
  const schemaMatch = value.match(/\{% schema %\}\s*([\s\S]*?)\s*\{% endschema %\}/);
  assert.ok(schemaMatch, "expected a {% schema %} block");
  const schema = JSON.parse(schemaMatch[1]);
  updater(schema);
  return value.replace(
    schemaMatch[0],
    `{% schema %}\n${JSON.stringify(schema, null, 2)}\n{% endschema %}`
  );
}

function buildSnippetNativeBlockSectionValue(sectionValue, writeProof) {
  return replaceLiquidSchema(sectionValue, (schema) => {
    const blocks = Array.isArray(schema.blocks) ? [...schema.blocks] : [];
    const existingIndex = blocks.findIndex((block) => block?.type === writeProof.blockType);
    const nextBlock = {
      type: writeProof.blockType,
      name: writeProof.blockName,
      settings: [
        {
          type: "text",
          id: writeProof.settingId,
          label: writeProof.settingLabel,
          default: writeProof.defaultLabel,
        },
      ],
    };

    if (existingIndex >= 0) {
      const existing = blocks[existingIndex] || {};
      const existingSettings = Array.isArray(existing.settings) ? [...existing.settings] : [];
      if (!existingSettings.some((setting) => setting?.id === writeProof.settingId)) {
        existingSettings.push(nextBlock.settings[0]);
      }
      blocks[existingIndex] = {
        ...existing,
        type: writeProof.blockType,
        name: existing.name || writeProof.blockName,
        settings: existingSettings,
      };
    } else {
      const appIndex = blocks.findIndex((block) => block?.type === "@app");
      if (appIndex >= 0) {
        blocks.splice(appIndex, 0, nextBlock);
      } else {
        blocks.push(nextBlock);
      }
    }

    schema.blocks = blocks;
  });
}

function buildSnippetNativeBlockRendererValue(snippetValue, writeProof) {
  if (snippetValue.includes(`when '${writeProof.blockType}'`)) {
    return snippetValue;
  }

  const nativeBlockCase = [
    `      {% when '${writeProof.blockType}' %}`,
    `        <div class="${writeProof.blockType.replace(/_/g, "-")}">{{ block.settings.${writeProof.settingId} }}</div>`,
  ].join("\n");

  const nextValue = snippetValue.replace(
    /\{%\s*endcase\s*%\}/,
    `${nativeBlockCase}\n    {% endcase %}`
  );

  assert.notEqual(
    nextValue,
    snippetValue,
    "expected a native block renderer snippet with a {% case block.type %} branch"
  );
  return nextValue;
}

function buildSnippetNativeBlockSectionPatch(sectionValue, writeProof) {
  const originalSchemaMatch = sectionValue.match(/\{% schema %\}\s*([\s\S]*?)\s*\{% endschema %\}/);
  assert.ok(originalSchemaMatch, "expected a {% schema %} block");
  const updatedValue = buildSnippetNativeBlockSectionValue(sectionValue, writeProof);
  const updatedSchemaMatch = updatedValue.match(/\{% schema %\}\s*([\s\S]*?)\s*\{% endschema %\}/);
  assert.ok(updatedSchemaMatch, "expected an updated {% schema %} block");
  return {
    searchString: originalSchemaMatch[0],
    replaceString: updatedSchemaMatch[0],
  };
}

function buildSnippetNativeBlockRendererPatch(snippetValue, writeProof) {
  if (snippetValue.includes(`when '${writeProof.blockType}'`)) {
    return null;
  }

  const endcaseMatch = snippetValue.match(/\{%\s*endcase\s*%\}/);
  assert.ok(
    endcaseMatch,
    "expected a native block renderer snippet with a {% case block.type %} branch"
  );

  return {
    searchString: endcaseMatch[0],
    replaceString: [
      `      {% when '${writeProof.blockType}' %}`,
      `        <div class="${writeProof.blockType.replace(/_/g, "-")}">{{ block.settings.${writeProof.settingId} }}</div>`,
      endcaseMatch[0],
    ].join("\n"),
  };
}

function buildThemeBlockWriteValue(blockValue, writeProof) {
  const withSchema = replaceLiquidSchema(blockValue, (schema) => {
    const settings = Array.isArray(schema.settings) ? [...schema.settings] : [];
    if (!settings.some((setting) => setting?.id === writeProof.settingId)) {
      settings.push({
        type: "text",
        id: writeProof.settingId,
        label: writeProof.settingLabel,
        default: writeProof.defaultLabel,
      });
    }
    schema.settings = settings;
  });

  const schemaMatch = withSchema.match(/\{% schema %\}\s*[\s\S]*?\s*\{% endschema %\}/);
  assert.ok(schemaMatch, "expected a theme block schema");

  const markup = `
{% doc %}
  @example
  {% content_for 'block', type: 'review-badge', id: 'review-badge' %}
{% enddoc %}
<article class="review-badge" {{ block.shopify_attributes }}>
  <strong>{{ block.settings.label }}</strong>
  <p class="review-badge__subcopy">{{ block.settings.${writeProof.settingId} }}</p>
</article>

`;

  return `${markup}${schemaMatch[0]}\n`;
}

function buildThemeBlockWritePatch(blockValue, writeProof) {
  return {
    searchString: blockValue,
    replaceString: buildThemeBlockWriteValue(blockValue, writeProof),
  };
}

test(
  "cross-theme acceptance matrix proves create/edit/placement flows across multiple 2.0 archetypes",
  { concurrency: false },
  async (t) => {
    for (const fixture of matrixFixtures) {
      await t.test(fixture.label, async (fixtureTest) => {
        const themeFetch = createThemeFixtureFetch(fixture.files, {
          themeId: fixture.themeId,
          name: fixture.label,
          role: "MAIN",
        });
        global.fetch = themeFetch.handler;

        const requestContext = {
          shopifyClient,
          tokenHash: `cross-theme-${fixture.id}`,
        };
        const createdSectionKey = `sections/${fixture.id}-matrix-acceptance.liquid`;
        const createdSectionHandle = `${fixture.id}-matrix-acceptance`;

        await fixtureTest.test("prompt-only new section reaches preview_ready and stays merchant editable", async () => {
          global.fetch = themeFetch.handler;
          const planResult = await planThemeEditTool.execute(
            {
              themeId: fixture.themeId,
              intent: "new_section",
              template: "homepage",
              query: fixture.promptOnlyQuery,
            },
            requestContext
          );

          assert.equal(planResult.theme.id, fixture.themeId);
          assert.equal(planResult.recommendedFlow, "create-section");
          assert.equal(planResult.shouldUse, "create-theme-section");
          assert.ok(planResult.nextReadKeys.includes(fixture.expectations.representativeSectionKey));
          for (const helperKey of fixture.expectations.helperReadKeys) {
            assert.ok(
              planResult.nextReadKeys.includes(helperKey),
              `${fixture.label} should surface helper read ${helperKey}`
            );
          }

          await getThemeFilesTool.execute(
            {
              themeId: fixture.themeId,
              keys: planResult.nextReadKeys,
              includeContent: true,
            },
            requestContext
          );

          const createResult = await createThemeSectionTool.execute(
            {
              themeId: fixture.themeId,
              key: createdSectionKey,
              liquid:
                planResult.sectionBlueprint?.archetype === "review_section" ||
                planResult.sectionBlueprint?.archetype === "review_slider"
                  ? buildPromptOnlyReviewSectionLiquid({ label: `${fixture.label} matrix` })
                  : buildMerchantEditableSectionLiquid({ label: `${fixture.label} matrix` }),
              plannerHandoff: planResult.plannerHandoff,
            },
            requestContext
          );

          assert.equal(createResult.success, true);
          assert.equal(createResult.status, "preview_ready");

          const createdSection = await getThemeFileTool.execute(
            {
              themeId: fixture.themeId,
              key: createdSectionKey,
              includeContent: true,
            },
            requestContext
          );

          assert.equal(createdSection.theme.id, fixture.themeId);
          assertMerchantEditableSection(createdSection.asset.value);
          assert.ok(themeFetch.hasFile(createdSectionKey));
        });

        await fixtureTest.test("screenshot-only exact replica planning keeps best-effort preview media semantics", async () => {
          global.fetch = themeFetch.handler;
          const screenshotPlan = await planThemeEditTool.execute(
            {
              themeId: fixture.themeId,
              intent: "new_section",
              template: "homepage",
              query: fixture.screenshotReplicaPrompt,
            },
            requestContext
          );

          assert.equal(screenshotPlan.qualityTarget, "exact_match");
          assert.equal(screenshotPlan.generationMode, "precision_first");
          assert.equal(
            screenshotPlan.sectionBlueprint?.referenceSignals?.previewMediaPolicy,
            "best_effort_demo_media"
          );
          assert.equal(
            screenshotPlan.sectionBlueprint?.referenceSignals?.allowStylizedPreviewFallbacks,
            true
          );
        });

        await fixtureTest.test("screenshot-only exact replica create reaches preview_ready on the archetype", async () => {
          global.fetch = themeFetch.handler;
          const screenshotPlan = await planThemeEditTool.execute(
            {
              themeId: fixture.themeId,
              intent: "new_section",
              template: "homepage",
              query: fixture.screenshotReplicaPrompt,
            },
            requestContext
          );

          await getThemeFilesTool.execute(
            {
              themeId: fixture.themeId,
              keys: screenshotPlan.nextReadKeys,
              includeContent: true,
            },
            requestContext
          );

          const screenshotSectionKey = `sections/${fixture.id}-screenshot-reference.liquid`;
          const screenshotCreate = await createThemeSectionTool.execute(
            {
              themeId: fixture.themeId,
              key: screenshotSectionKey,
              liquid: buildExactReplicaSectionLiquid({
                label: `${fixture.label} screenshot`,
                strictRenderableMedia: false,
              }),
              plannerHandoff: screenshotPlan.plannerHandoff,
            },
            requestContext
          );

          assert.equal(screenshotCreate.success, true, JSON.stringify({
            status: screenshotCreate.status,
            errorCode: screenshotCreate.errorCode,
            errors: screenshotCreate.errors,
            warnings: screenshotCreate.warnings,
          }));
          assert.equal(screenshotCreate.status, "preview_ready");
          assert.equal(screenshotCreate.sectionBlueprint?.qualityTarget, "exact_match");
          assert.ok(themeFetch.hasFile(screenshotSectionKey));
        });

        await fixtureTest.test("image-backed exact replica planning switches to strict renderable media", async () => {
          global.fetch = themeFetch.handler;
          const strictMediaPlan = await planThemeEditTool.execute(
            {
              themeId: fixture.themeId,
              intent: "new_section",
              template: "homepage",
              query: fixture.imageBackedReplicaPrompt,
            },
            requestContext
          );

          assert.equal(strictMediaPlan.qualityTarget, "exact_match");
          assert.equal(
            strictMediaPlan.sectionBlueprint?.referenceSignals?.previewMediaPolicy,
            "strict_renderable_media"
          );
          assert.equal(
            strictMediaPlan.sectionBlueprint?.referenceSignals?.requiresRenderablePreviewMedia,
            true
          );
        });

        await fixtureTest.test("image-backed exact replica create reaches preview_ready on the archetype", async () => {
          global.fetch = themeFetch.handler;
          const strictMediaPlan = await planThemeEditTool.execute(
            {
              themeId: fixture.themeId,
              intent: "new_section",
              template: "homepage",
              query: fixture.imageBackedReplicaPrompt,
            },
            requestContext
          );

          await getThemeFilesTool.execute(
            {
              themeId: fixture.themeId,
              keys: strictMediaPlan.nextReadKeys,
              includeContent: true,
            },
            requestContext
          );

          const strictSectionKey = `sections/${fixture.id}-image-reference.liquid`;
          const strictCreate = await createThemeSectionTool.execute(
            {
              themeId: fixture.themeId,
              key: strictSectionKey,
              liquid: buildExactReplicaSectionLiquid({
                label: `${fixture.label} image`,
                strictRenderableMedia: true,
              }),
              plannerHandoff: strictMediaPlan.plannerHandoff,
            },
            requestContext
          );

          assert.equal(strictCreate.success, true);
          assert.equal(strictCreate.status, "preview_ready");
          assert.equal(strictCreate.sectionBlueprint?.qualityTarget, "exact_match");
          assert.ok(themeFetch.hasFile(strictSectionKey));
        });

        await fixtureTest.test("existing edit stays surgical and keeps the explicit theme target", async () => {
          global.fetch = themeFetch.handler;
          const editPlan = await planThemeEditTool.execute(
            {
              themeId: fixture.themeId,
              intent: "existing_edit",
              targetFile: fixture.expectations.existingEditTarget,
              query: "Werk alleen de zichtbare copy bij",
            },
            requestContext
          );

          assert.equal(editPlan.shouldUse, fixture.expectations.existingEditTool);

          await getThemeFileTool.execute(
            {
              themeId: fixture.themeId,
              key: fixture.expectations.existingEditTarget,
              includeContent: true,
            },
            requestContext
          );

          const patchResult = await patchThemeFileTool.execute(
            {
              key: fixture.expectations.existingEditTarget,
              patch: {
                searchString: fixture.expectations.existingEditSearch,
                replaceString: fixture.expectations.existingEditReplace,
              },
            },
            requestContext
          );

          assert.equal(patchResult.success, true);
          assert.equal(patchResult.status, "preview_ready");

          const editedFile = await getThemeFileTool.execute(
            {
              themeId: fixture.themeId,
              key: fixture.expectations.existingEditTarget,
              includeContent: true,
            },
            requestContext
          );

          assert.equal(editedFile.theme.id, fixture.themeId);
          assert.ok(editedFile.asset.value.includes(fixture.expectations.existingEditReplace));
        });

        await fixtureTest.test("native block planning exposes renderer completeness for the archetype", async () => {
          global.fetch = themeFetch.handler;
          const nativeBlockPlan = await planThemeEditTool.execute(
            {
              themeId: fixture.themeId,
              intent: "native_block",
              template: "product",
              query: "Voeg een review badge block toe op de productpagina",
            },
            requestContext
          );

          assert.equal(
            nativeBlockPlan.recommendedFlow,
            fixture.expectations.nativeBlock.recommendedFlow
          );
          assert.equal(
            nativeBlockPlan.architecture.usesThemeBlocks,
            fixture.expectations.nativeBlock.usesThemeBlocks
          );
          assert.deepEqual(
            nativeBlockPlan.architecture.snippetRendererKeys,
            fixture.expectations.nativeBlock.snippetRendererKeys
          );
          assert.equal(
            nativeBlockPlan.architecture.hasBlockShopifyAttributes,
            fixture.expectations.nativeBlock.hasBlockShopifyAttributes
          );
          assert.equal(
            nativeBlockPlan.plannerHandoff?.architecture?.usesThemeBlocks,
            fixture.expectations.nativeBlock.usesThemeBlocks
          );
          assert.deepEqual(
            nativeBlockPlan.plannerHandoff?.architecture?.snippetRendererKeys || [],
            fixture.expectations.nativeBlock.snippetRendererKeys
          );
          assert.equal(
            nativeBlockPlan.nextTool,
            "search-theme-files",
            "native block planning should steer clients to compact anchor search before write"
          );
          assert.deepEqual(
            nativeBlockPlan.nextArgsTemplate?.keys || [],
            nativeBlockPlan.nextReadKeys,
            "the compact search step should stay inside the exact planner-selected files"
          );
          assert.ok(
            Array.isArray(nativeBlockPlan.plannerHandoff?.searchQueries) &&
              nativeBlockPlan.plannerHandoff.searchQueries.length > 0,
            "planner handoff should preserve compact search anchors for downstream tools and clients"
          );
          if (fixture.expectations.nativeBlock.usesThemeBlocks) {
            assert.ok(
              nativeBlockPlan.writeArgsTemplate?.files?.every(
                (file) => Array.isArray(file.patches) && file.patches.length === 1
              ),
              "theme-block native flows should still prefer patch-first write templates for existing files"
            );
          } else {
            assert.ok(
              nativeBlockPlan.writeArgsTemplate?.files?.every(
                (file) => Array.isArray(file.patches) && file.patches.length === 1
              ),
              "snippet-renderer native flows should return patch-first write templates instead of full rewrites"
            );
          }
          for (const disallowedKey of fixture.expectations.nativeBlock.disallowedReadKeys || []) {
            assert.equal(
              nativeBlockPlan.nextReadKeys.includes(disallowedKey),
              false,
              `native block planning should not force helper file '${disallowedKey}' into the first read pass`
            );
          }

          if (fixture.expectations.nativeBlock.usesThemeBlocks) {
            assert.ok(
              nativeBlockPlan.newFileSuggestions.includes("blocks/<new-theme-block>.liquid")
            );
          } else {
            assert.ok(
              nativeBlockPlan.nextWriteKeys.includes(
                fixture.expectations.nativeBlock.sectionKey
              )
            );
          }
        });

        await fixtureTest.test("native block write reaches preview_ready on the archetype", async () => {
          global.fetch = themeFetch.handler;
          const nativeBlockPlan = await planThemeEditTool.execute(
            {
              themeId: fixture.themeId,
              intent: "native_block",
              template: "product",
              query: "Voeg een review badge block toe op de productpagina",
            },
            requestContext
          );

          const compactSearch = await searchThemeFilesTool.execute(
            nativeBlockPlan.nextArgsTemplate,
            requestContext
          );
          assert.ok(Array.isArray(compactSearch.hits));
          assert.ok(compactSearch.hits.length >= 1);

          const writeProof = fixture.expectations.nativeBlock.writeProof;
          let files;

          if (writeProof.mode === "theme_block") {
            files = [
              {
                key: writeProof.blockKey,
                patches: [
                  buildThemeBlockWritePatch(
                    themeFetch.getFileValue(writeProof.blockKey),
                    writeProof
                  ),
                ],
              },
            ];
          } else {
            const rendererPatch = buildSnippetNativeBlockRendererPatch(
              themeFetch.getFileValue(writeProof.snippetKey),
              writeProof
            );
            files = [
              {
                key: fixture.expectations.nativeBlock.sectionKey,
                patches: [
                  buildSnippetNativeBlockSectionPatch(
                    themeFetch.getFileValue(fixture.expectations.nativeBlock.sectionKey),
                    writeProof
                  ),
                ],
              },
              ...(rendererPatch
                ? [
                    {
                      key: writeProof.snippetKey,
                      patches: [rendererPatch],
                    },
                  ]
                : []),
            ];
          }

          const nativeBlockWrite = await draftThemeArtifact.execute(
            draftThemeArtifact.schema.parse({
              themeId: fixture.themeId,
              mode: "edit",
              plannerHandoff: nativeBlockPlan.plannerHandoff,
              files,
            }),
            requestContext
          );

          assert.equal(nativeBlockWrite.success, true);
          assert.equal(nativeBlockWrite.status, "preview_ready");
          if (writeProof.mode !== "theme_block") {
            assert.ok(
              nativeBlockWrite.warnings?.some((entry) =>
                entry.includes("Planner-required theme-context reads zijn automatisch opgehaald")
              ),
              "patch-first native block writes should still succeed from planner handoff via server-side auto-hydration"
            );
          }

          if (writeProof.mode === "theme_block") {
            const updatedBlock = await getThemeFileTool.execute(
              {
                themeId: fixture.themeId,
                key: writeProof.blockKey,
                includeContent: true,
              },
              requestContext
            );

            for (const needle of writeProof.assertionNeedles) {
              assert.ok(updatedBlock.asset.value.includes(needle));
            }
          } else {
            const updatedSection = await getThemeFileTool.execute(
              {
                themeId: fixture.themeId,
                key: fixture.expectations.nativeBlock.sectionKey,
                includeContent: true,
              },
              requestContext
            );
            const updatedSnippet = await getThemeFileTool.execute(
              {
                themeId: fixture.themeId,
                key: writeProof.snippetKey,
                includeContent: true,
              },
              requestContext
            );

            assert.ok(updatedSection.asset.value.includes(`"type": "${writeProof.blockType}"`));
            for (const needle of writeProof.assertionNeedles) {
              assert.ok(updatedSnippet.asset.value.includes(needle));
            }
          }
        });

        await fixtureTest.test("template placement uses draft-theme-artifact and keeps the created section on the same theme", async () => {
          global.fetch = themeFetch.handler;
          const placementPlan = await planThemeEditTool.execute(
            {
              themeId: fixture.themeId,
              intent: "template_placement",
              template: "homepage",
              query: "Plaats de nieuwe section onder de content section op de homepage",
            },
            requestContext
          );

          assert.equal(placementPlan.recommendedFlow, "template-placement");
          assert.equal(placementPlan.shouldUse, "draft-theme-artifact");
          assert.equal(placementPlan.nextWriteKeys.length, 1);

          const templateKey = placementPlan.nextWriteKeys[0];
          if (placementPlan.nextReadKeys.length === 1) {
            await getThemeFileTool.execute(
              {
                themeId: fixture.themeId,
                key: placementPlan.nextReadKeys[0],
                includeContent: true,
              },
              requestContext
            );
          } else {
            await getThemeFilesTool.execute(
              {
                themeId: fixture.themeId,
                keys: placementPlan.nextReadKeys,
                includeContent: true,
              },
              requestContext
            );
          }

          const placementValue = buildTemplatePlacementValue(
            templateKey,
            themeFetch.getFileValue(templateKey),
            createdSectionHandle
          );

          const placementResult = await draftThemeArtifact.execute(
            draftThemeArtifact.schema.parse({
              themeId: fixture.themeId,
              mode: "edit",
              plannerHandoff: placementPlan.plannerHandoff,
              files: [
                {
                  key: templateKey,
                  value: placementValue,
                },
              ],
            }),
            requestContext
          );

          assert.equal(placementResult.success, true);
          assert.equal(placementResult.status, "preview_ready");

          const placedTemplate = await getThemeFileTool.execute(
            {
              themeId: fixture.themeId,
              key: templateKey,
              includeContent: true,
            },
            requestContext
          );

          assert.equal(placedTemplate.theme.id, fixture.themeId);
          assert.ok(placedTemplate.asset.value.includes(createdSectionHandle));
        });
      });
    }
  }
);
