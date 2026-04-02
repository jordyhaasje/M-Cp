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
    basicReferenceSpec: {
      version: 1,
      fidelityGaps: ["base gap"],
    },
  },
  { fetchText }
);

assert.equal(result.success, true);
assert.equal(result.referenceSpec.version, 2);
assert.ok(result.referenceSpec.visualSignals.breakpointHints.includes(749));
assert.ok(result.referenceSpec.visualSignals.colorTokens.some((token) => token.includes("rgba")));
assert.ok(Array.isArray(result.referenceSpec.visualSignals.computedStyleCandidates));
assert.ok(result.referenceSpec.fidelityGaps.length >= 1);

console.log("All hazify-visual-worker tests passed");
