import test from "node:test";
import assert from "node:assert";
import { analyzeReferenceUi } from "../src/tools/analyzeReferenceUi.js";

const execute = analyzeReferenceUi.execute;

test("analyzeReferenceUi - basic token optimization", async (t) => {
  const mockHtml = `
    <!DOCTYPE html>
    <html>
      <head>
        <title>Test Reference UI</title>
        <script>console.log("Remove me")</script>
        <style>.remove-me { color: red; }</style>
      </head>
      <body>
        <div id="main" class="container layout-grid">
          <header class="header">
            <h1 class="title">My Awesome Site</h1>
            <svg width="10" height="10"><path d="M10 10"/></svg>
            <img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAE" alt="tracker">
            <img src="https://example.com/logo.png" class="logo">
          </header>
          <main>
            <p>Some content</p>
          </main>
        </div>
      </body>
    </html>
  `;

  const result = await execute(
    { url: "https://example.com" },
    { fetchReferenceHtml: async () => mockHtml }
  );
  assert.strictEqual(result.success, true);
  assert.strictEqual(result.selector, "body");
  assert.strictEqual(result.analysisMode, "cheerio");
  
  // Check that heavy tags are stripped but structure remains
  assert.ok(!result.markup.includes("script"));
  assert.ok(!result.markup.includes("style"));
  assert.ok(!result.markup.includes("data:image"));
  
  // Check that important elements remain
  assert.ok(result.markup.includes("div#main.container.layout-grid"));
  assert.ok(result.markup.includes("h1.title"));
  assert.ok(result.markup.includes("svg"));
  assert.ok(result.markup.includes("img.logo(src=\"https://example.com/logo.png\")"));
  assert.ok(result.markup.includes("My Awesome Site"));
  assert.ok(result.referenceSpec);
  assert.ok(Array.isArray(result.sources));
  assert.ok(result.referenceSpec.structure.svgCount >= 1);
  assert.equal(result.sectionPlan.readyForDraft, true);
  assert.equal(result.nextAction.tool, "draft-theme-artifact");
  assert.equal(result.suggestedFiles[0].key, "sections/my-awesome-site.liquid");
  assert.ok(result.generationHints.some((hint) => hint.includes("draft-theme-artifact")));
});

test("analyzeReferenceUi - with cssSelector focus", async (t) => {
  const mockHtml = `
    <body>
      <header>Ignore me</header>
      <div class="product-card">
        <h2 class="name">Product 1</h2>
        <span class="price">$10</span>
      </div>
      <footer>Ignore me too</footer>
    </body>
  `;

  const result = await execute(
    { url: "https://example.com", cssSelector: ".product-card" },
    { fetchReferenceHtml: async () => mockHtml }
  );
  assert.strictEqual(result.success, true);
  
  assert.ok(!result.markup.includes("header"));
  assert.ok(!result.markup.includes("footer"));
  assert.ok(!result.markup.includes("Ignore me"));
  
  assert.ok(result.markup.includes("div.product-card"));
  assert.ok(result.markup.includes("h2.name"));
  assert.ok(result.markup.includes("Product 1"));
});

test("analyzeReferenceUi - fetch failure", async (t) => {
  const result = await execute(
    { url: "https://example.com" },
    {
      fetchReferenceHtml: async () => {
        throw new Error("Fetch faalde met HTTP status 404 Not Found");
      },
    }
  );
  assert.strictEqual(result.success, false);
  assert.ok(result.error.includes("404"));
  assert.equal(result.errorCode, "reference_fetch_failed");
  assert.equal(result.retryable, true);
});

test("analyzeReferenceUi - image only returns actionable blocked status", async () => {
  const result = await execute({
    imageUrls: ["https://example.com/reference.png"],
  });

  assert.strictEqual(result.success, true);
  assert.strictEqual(result.analysisMode, "image-hint-only");
  assert.equal(result.errorCode, "image_only_not_supported");
  assert.equal(result.retryable, false);
  assert.equal(result.sectionPlan.readyForDraft, false);
  assert.equal(result.nextAction.kind, "user_input_required");
  assert.ok(result.requiredInputs.includes("url"));
});

test("analyzeReferenceUi - visual worker fallback keeps cheerio result", async () => {
  const result = await execute(
    { url: "https://example.com", imageUrls: ["https://example.com/reference.png"] },
    {
      fetchReferenceHtml: async () => "<body><section class='hero'><h2>Hero</h2></section></body>",
      visualWorkerAnalyze: async () => {
        throw new Error("worker offline");
      },
    }
  );

  assert.strictEqual(result.success, true);
  assert.strictEqual(result.analysisMode, "cheerio-fallback");
  assert.ok(result.fidelityWarnings.some((warning) => warning.includes("worker offline")));
  assert.equal(result.usedVisualWorker, false);
  assert.ok(result.workerWarnings.some((warning) => warning.includes("worker offline")));
});

test("analyzeReferenceUi - visual worker success enriches result", async () => {
  const result = await execute(
    { url: "https://example.com/product" },
    {
      fetchReferenceHtml: async () => "<body><section class='hero'><h2>Hero</h2></section></body>",
      visualWorkerAnalyze: async () => ({
        success: true,
        referenceSpec: {
          version: 3,
          sources: [{ type: "url", url: "https://example.com/product" }],
          selector: "body",
          fidelityGaps: ["worker gap"],
          interactiveFeatures: {
            hasSlider: true,
            hasCarousel: true,
            hasTabs: false,
            hasAccordion: false,
            hasAutoplay: true,
            hasLoop: false,
            hasScrollSnap: true,
          },
          sliderFeatures: {
            visibleSlidesDesktop: 3,
            visibleSlidesTablet: 2,
            visibleSlidesMobile: 1,
            slideCount: 5,
            slidesPerMove: 1,
            trackSelector: ".track",
            slideSelector: ".slide",
            paginationStyle: "dots",
            arrowStyle: "svg-icon",
            controlPlacement: "below",
          },
          iconFeatures: {
            hasInlineSvg: true,
            inlineSvgSnippets: ["<svg></svg>"],
            iconImageSources: [],
            iconPresentationMode: "inline-svg",
            logoAssets: [],
            decorativeIconCount: 1,
            functionalIconCount: 0,
          },
          controlFeatures: {
            hasPrevButton: true,
            hasNextButton: true,
            hasDots: true,
            buttonLabels: ["Prev", "Next"],
            buttonIcons: ["svg"],
            ariaLabels: ["Prev slide", "Next slide"],
            paginationContainerSelector: ".dots",
          },
          animationFeatures: {
            transitionDurations: ["0.4s"],
            timingFunctions: ["ease-out"],
            transformPatterns: ["translate3d(0px,0px,0px)"],
            hoverStates: [],
            entranceEffects: ["fade-up"],
          },
        },
        workerWarnings: ["worker note"],
        fidelityWarnings: ["worker fidelity warning"],
      }),
    }
  );

  assert.strictEqual(result.success, true);
  assert.strictEqual(result.analysisMode, "hybrid");
  assert.equal(result.usedVisualWorker, true);
  assert.equal(result.fidelityUpgradeApplied, true);
  assert.ok(result.workerWarnings.includes("worker note"));
  assert.equal(result.sectionPlan.componentType, "carousel-slider");
  assert.ok(result.generationHints.some((hint) => hint.includes("slider/carouselgedrag")));
});

test("analyzeReferenceUi - selector not found returns retry guidance", async () => {
  const result = await execute(
    { url: "https://example.com", cssSelector: ".missing" },
    { fetchReferenceHtml: async () => "<body><div class='present'>ok</div></body>" }
  );

  assert.equal(result.success, false);
  assert.equal(result.errorCode, "selector_not_found");
  assert.equal(result.retryable, true);
  assert.equal(result.nextAction.tool, "analyze-reference-ui");
});
