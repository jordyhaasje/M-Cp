import test from "node:test";
import assert from "node:assert";
import { prepareSectionFromReference } from "../src/tools/prepareSectionFromReference.js";

const execute = prepareSectionFromReference.execute;

const homepageHtml = `
  <body>
    <section class="hero-section">
      <h2>Welkom bij Cloudpillo</h2>
      <p>Hero copy</p>
    </section>
    <section class="collection-overview">
      <div class="section-header">
        <h2>Ontdek onze collecties</h2>
        <p>Kies de categorie die bij jouw slaap past.</p>
      </div>
      <div class="collection-links">
        <a href="/collections/toppers">Toppers</a>
        <a href="/collections/hoofdkussens">Hoofdkussens</a>
        <a href="/collections/matrassen">Matrassen</a>
        <a href="/collections/dekbedden">Dekbedden</a>
      </div>
    </section>
    <section class="reviews-section">
      <h2>Wat zeggen onze klanten?</h2>
      <p>Review content</p>
    </section>
  </body>
`;

test("prepareSectionFromReference - selects hinted subsection and returns a collection blueprint", async () => {
  const result = await execute(
    {
      url: "https://example.com",
      sectionHint: "Ontdek onze collecties",
      imageUrls: ["https://example.com/hint.png"],
    },
    {
      fetchReferenceHtml: async () => homepageHtml,
    }
  );

  assert.equal(result.success, true);
  assert.equal(result.selectionEvidence.strategy, "section_hint");
  assert.equal(result.selectionEvidence.matchedHeading, "Ontdek onze collecties");
  assert.equal(result.sectionBlueprint.archetype, "collection-link-grid");
  assert.equal(result.sectionPlan.readyForDraft, true);
  assert.equal(result.nextAction.tool, "draft-theme-artifact");
  assert.equal(result.suggestedFiles[0].key, "sections/ontdek-onze-collecties.liquid");
  assert.ok(
    result.generationHints.some((hint) => hint.includes("search-theme-files")),
    "prepare flow should discourage extra read-tool calls for new sections"
  );
});

test("prepareSectionFromReference - blocks ambiguous multi-section pages without a hint", async () => {
  const result = await execute(
    {
      url: "https://example.com",
    },
    {
      fetchReferenceHtml: async () => homepageHtml,
    }
  );

  assert.equal(result.success, false);
  assert.equal(result.errorCode, "section_hint_required");
  assert.equal(result.retryable, true);
  assert.ok(result.requiredInputs.includes("sectionHint"));
});

test("prepareSectionFromReference - blocks image-only requests without claiming clone success", async () => {
  const result = await execute({
    imageUrls: ["https://example.com/reference.png"],
  });

  assert.equal(result.success, false);
  assert.equal(result.errorCode, "image_only_not_supported");
  assert.equal(result.retryable, false);
  assert.ok(result.requiredInputs.includes("url"));
});

