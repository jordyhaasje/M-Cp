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

test("prepareSectionFromReference - promotes carousel runtime signals into a slider blueprint", async () => {
  const sliderHtml = `
    <body>
      <section class="reviews-slider">
        <h2>Wat zeggen onze klanten?</h2>
        <div class="slides">
          <article class="slide">A</article>
          <article class="slide">B</article>
          <article class="slide">C</article>
        </div>
      </section>
    </body>
  `;

  const result = await execute(
    {
      url: "https://example.com/reviews",
      sectionHint: "Wat zeggen onze klanten?",
    },
    {
      fetchReferenceHtml: async () => sliderHtml,
      visualWorkerAnalyze: async () => ({
        success: true,
        referenceSpec: {
          version: 3,
          sources: [{ type: "url", url: "https://example.com/reviews" }],
          selector: "body > section.reviews-slider:nth-of-type(1)",
          structure: { textPreview: "Wat zeggen onze klanten?" },
          visualSignals: {},
          fidelityGaps: [],
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
            slideCount: 3,
            slidesPerMove: 1,
            trackSelector: ".slides",
            slideSelector: ".slide",
            paginationStyle: "dots",
            arrowStyle: "svg-icon",
            controlPlacement: "below",
          },
          iconFeatures: {
            hasInlineSvg: false,
            inlineSvgSnippets: [],
            iconImageSources: [],
            iconPresentationMode: null,
            logoAssets: [],
            decorativeIconCount: 0,
            functionalIconCount: 0,
          },
          controlFeatures: {
            hasPrevButton: true,
            hasNextButton: true,
            hasDots: true,
            buttonLabels: ["Previous", "Next"],
            buttonIcons: ["svg"],
            ariaLabels: ["Previous slide", "Next slide"],
            paginationContainerSelector: ".dots",
          },
          animationFeatures: {
            transitionDurations: ["0.4s"],
            timingFunctions: ["ease"],
            transformPatterns: ["translate3d(0px, 0px, 0px)"],
            hoverStates: [],
            entranceEffects: ["fade-up"],
          },
        },
        workerWarnings: [],
        fidelityWarnings: [],
      }),
    }
  );

  assert.equal(result.success, true);
  assert.equal(result.sectionBlueprint.componentType, "testimonial-slider");
  assert.equal(result.sectionBlueprint.controlModel.hasArrows, true);
  assert.equal(result.sectionBlueprint.controlModel.hasDots, true);
  assert.equal(result.sectionBlueprint.mediaModel.preferImageTag, true);
  assert.ok(result.sectionBlueprint.generationHints.some((hint) => hint.includes("slider/carouselgedrag")));
});

test("prepareSectionFromReference - prefers rich interactive section candidates over a shallow page-title wrapper", async () => {
  const sectionStoreLikeHtml = `
    <body>
      <main id="MainContent">
        <section id="shopify-section-template--main" class="shopify-section section-main-page">
          <div class="main-page-title page-width">
            <h1>Video Slider</h1>
            <div class="rte"></div>
          </div>
        </section>

        <div id="shopify-section-template--demo" class="shopify-section">
          <div
            class="slider-slider-template--demo swiper"
            data-slider-view="3"
            data-slider-view-mobile="1.5"
            data-slider-view-tablet="2"
          >
            <div class="swiper-wrapper">
              <div class="swiper-slide slider-slide-template--demo">
                <video data-src="https://cdn.example.com/one.mp4" loop></video>
                <p>Future</p>
              </div>
              <div class="swiper-slide slider-slide-template--demo">
                <video data-src="https://cdn.example.com/two.mp4" loop></video>
                <p>Functional</p>
              </div>
              <div class="swiper-slide slider-slide-template--demo">
                <video data-src="https://cdn.example.com/three.mp4" loop></video>
                <p>Premium</p>
              </div>
            </div>
            <button class="slider-btn-prev-template--demo" aria-label="Previous slide"><svg></svg></button>
            <button class="slider-btn-next-template--demo" aria-label="Next slide"><svg></svg></button>
          </div>
        </div>
      </main>
    </body>
  `;

  const result = await execute(
    {
      url: "https://example.com/video-slider",
      sectionHint: "Video slider",
    },
    {
      fetchReferenceHtml: async () => sectionStoreLikeHtml,
    }
  );

  assert.equal(result.success, true);
  assert.equal(result.selector, "#shopify-section-template--demo");
  assert.equal(result.sectionBlueprint.componentType, "carousel-slider");
  assert.equal(result.sectionBlueprint.archetype, "carousel-slider");
  assert.equal(result.referenceSpec.interactiveFeatures.hasSlider, true);
  assert.equal(result.referenceSpec.controlFeatures.hasPrevButton, true);
  assert.equal(result.referenceSpec.sliderFeatures.slideCount, 3);
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
