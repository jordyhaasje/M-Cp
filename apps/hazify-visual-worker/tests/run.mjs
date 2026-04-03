import assert from "assert";
import { analyzeReferencePayload } from "../src/referenceAnalysis.js";

const html = `
  <html>
    <head>
      <link rel="stylesheet" href="/styles/main.css">
      <style>
        .hero { padding: 32px; border-radius: 24px; }
      </style>
    </head>
    <body>
      <section class="hero">
        <h2>Hero heading</h2>
        <p>Intro text</p>
      </section>
    </body>
  </html>
`;

const css = `
  .hero { display: grid; gap: 24px; box-shadow: 0 20px 60px rgba(0,0,0,.12); }
  .hero h2 { font-size: 48px; }
  @media screen and (max-width: 749px) { .hero { padding: 20px; } }
`;

const fetchText = async (url) => {
  if (url.endsWith("/styles/main.css")) {
    return css;
  }
  return html;
};

const result = await analyzeReferencePayload(
  {
    url: "https://example.com/page",
    cssSelector: ".hero",
    imageUrls: ["https://example.com/hint.png"],
    basicReferenceSpec: {
      version: 1,
      fidelityGaps: ["base gap"],
    },
  },
  {
    fetchText,
    runtimeAnalyze: async () => ({
      success: true,
      runtimeLayoutSignals: {
        viewports: [{ profileId: "desktop", visibleSlides: 3 }],
      },
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
        trackSelector: ".hero-track",
        slideSelector: ".hero-slide",
        paginationStyle: "dots",
        arrowStyle: "svg-icon",
        controlPlacement: "below",
      },
      iconFeatures: {
        hasInlineSvg: true,
        inlineSvgSnippets: ["<svg><path d='M10 10'/></svg>"],
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
        buttonLabels: ["Previous", "Next"],
        buttonIcons: ["svg", "arrow-left", "arrow-right"],
        ariaLabels: ["Go to previous slide", "Go to next slide"],
        paginationContainerSelector: ".hero-dots",
      },
      animationFeatures: {
        transitionDurations: ["0.45s"],
        timingFunctions: ["cubic-bezier(0.22, 1, 0.36, 1)"],
        transformPatterns: ["translate3d(0px, 0px, 0px)"],
        hoverStates: [],
        entranceEffects: ["fade-up"],
      },
    }),
  }
);

assert.equal(result.success, true);
assert.equal(result.referenceSpec.version, 3);
assert.ok(result.referenceSpec.visualSignals.breakpointHints.includes(749));
assert.ok(result.referenceSpec.visualSignals.colorTokens.some((token) => token.includes("rgba")));
assert.ok(Array.isArray(result.referenceSpec.visualSignals.computedStyleCandidates));
assert.ok(result.referenceSpec.fidelityGaps.length >= 1);
assert.equal(result.usedVisualWorker, true);
assert.equal(result.fidelityUpgradeApplied, true);
assert.ok(result.referenceSpec.fidelityGaps.some((gap) => gap.includes("Image inputs")));
assert.equal(result.referenceSpec.interactiveFeatures.hasSlider, true);
assert.equal(result.referenceSpec.sliderFeatures.visibleSlidesDesktop, 3);
assert.equal(result.referenceSpec.controlFeatures.hasDots, true);
assert.equal(result.referenceSpec.iconFeatures.hasInlineSvg, true);
assert.ok(result.referenceSpec.animationFeatures.transitionDurations.includes("0.45s"));
assert.ok(Array.isArray(result.referenceSpec.visualSignals.runtimeLayoutSignals.viewports));

console.log("All hazify-visual-worker tests passed");
