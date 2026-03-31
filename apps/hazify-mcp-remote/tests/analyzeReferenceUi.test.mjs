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

  // Mock global fetch
  const originalFetch = global.fetch;
  global.fetch = async (url) => {
    assert.strictEqual(url, "https://example.com");
    return {
      ok: true,
      text: async () => mockHtml,
    };
  };

  try {
    const result = await execute({ url: "https://example.com" });
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.selector, "body");
    
    // Check that tags are stripped but structure remains
    assert.ok(!result.markup.includes("script"));
    assert.ok(!result.markup.includes("style"));
    assert.ok(!result.markup.includes("svg"));
    assert.ok(!result.markup.includes("data:image"));
    
    // Check that important elements remain
    assert.ok(result.markup.includes("div#main.container.layout-grid"));
    assert.ok(result.markup.includes("h1.title"));
    assert.ok(result.markup.includes("img.logo(src=\"https://example.com/logo.png\")"));
    assert.ok(result.markup.includes("My Awesome Site"));

  } finally {
    global.fetch = originalFetch;
  }
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

  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    text: async () => mockHtml,
  });

  try {
    const result = await execute({ url: "https://example.com", cssSelector: ".product-card" });
    assert.strictEqual(result.success, true);
    
    assert.ok(!result.markup.includes("header"));
    assert.ok(!result.markup.includes("footer"));
    assert.ok(!result.markup.includes("Ignore me"));
    
    assert.ok(result.markup.includes("div.product-card"));
    assert.ok(result.markup.includes("h2.name"));
    assert.ok(result.markup.includes("Product 1"));
  } finally {
    global.fetch = originalFetch;
  }
});

test("analyzeReferenceUi - fetch failure", async (t) => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: false,
    status: 404,
    statusText: "Not Found",
  });

  try {
    const result = await execute({ url: "https://example.com" });
    assert.strictEqual(result.success, false);
    assert.ok(result.error.includes("404"));
  } finally {
    global.fetch = originalFetch;
  }
});
