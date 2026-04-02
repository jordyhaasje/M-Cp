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
});
