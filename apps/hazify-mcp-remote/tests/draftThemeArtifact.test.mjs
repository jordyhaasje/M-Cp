import test from "node:test";
import assert from "node:assert";
import { draftThemeArtifact } from "../src/tools/draftThemeArtifact.js";

const execute = draftThemeArtifact.execute;

test("draftThemeArtifact - fails when linter finds issues", async (t) => {
  const mockShopifyClient = {
    session: { shop: "unit-test.myshopify.com" },
    request: async () => {}
  };

  const input = {
    files: [
      {
        key: "sections/bad-file.liquid",
        // This causes a SyntaxError in Liquid (missing closing '}')
        value: "<div>{{ product.title </div>"
      }
    ]
  };

  const result = await execute(draftThemeArtifact.schema.parse(input), { shopifyClient: mockShopifyClient });

  assert.strictEqual(result.success, false);
  assert.strictEqual(result.status, "lint_failed");
  assert.ok(result.errors.length > 0, "Should return linter errors");
  assert.strictEqual(result.errors[0].severity, "error");
});

test("draftThemeArtifact - success when linter passes (pushes directly to chosen theme)", async (t) => {
  let listThemesCalled = false;
  let upsertCalled = false;

  const mockShopifyClient = {
    url: "https://unit-test.myshopify.com",
    requestConfig: {
      headers: new Headers({ "x-shopify-access-token": "fake-token" })
    },
    session: { shop: "unit-test.myshopify.com" },
    request: async () => {},
    graphql: async (query) => {
      listThemesCalled = true;
      return {
        body: {
          data: {
            themes: {
              nodes: [
                { id: "gid://shopify/OnlineStoreTheme/111", name: "Main", role: "MAIN" }
              ]
            }
          }
        }
      };
    },
    rest: {}
  };

  // We are mocking shopifyClient.graphql so upsertThemeFiles resolves target.
  
  const extendedShopifyClient = {
    ...mockShopifyClient,
    request: async (query, vars) => {
      const q = String(query);
      if (q.includes("query ThemeList")) {
        listThemesCalled = true;
        return {
          themes: {
            nodes: [
              { id: "gid://shopify/OnlineStoreTheme/111", name: "Main", role: "MAIN" }
            ]
          }
        };
      }
      if (q.includes("mutation themeFilesUpsert")) {
        upsertCalled = true;
        return {
          themeFilesUpsert: {
            upsertedThemeFiles: [{ filename: "sections/good-file.liquid" }],
            userErrors: []
          }
        };
      }
      throw new Error("Unexpected graphql: " + query);
    }
  };

  const originalFetch = global.fetch;
  global.fetch = async (url, options = {}) => {
    // For REST API upload or verification inside upsertThemeFiles if any
    const payload = options.body ? JSON.parse(String(options.body)) : {};
    const query = String(payload.query || "");

    if (query.includes("themeFilesUpsert")) {
      const resPayload = {
        data: {
          themeFilesUpsert: {
            upsertedThemeFiles: [{ filename: "sections/good-file.liquid" }],
            userErrors: []
          }
        }
      };
      return {
        ok: true,
        status: 200,
        json: async () => resPayload,
        text: async () => JSON.stringify(resPayload)
      };
    }

    if (query.includes("ThemeById") || query.includes("ThemeList")) {
      const resPayload = {
        data: {
          themes: {
            nodes: [
              { id: "gid://shopify/OnlineStoreTheme/111", name: "Main Theme", role: "MAIN" }
            ]
          }
        }
      };
      return {
        ok: true,
        status: 200,
        json: async () => resPayload,
        text: async () => JSON.stringify(resPayload)
      };
    }

    return {
      ok: true,
      status: 200,
      json: async () => ({}),
      text: async () => "{}"
    };
  };

  try {
    const input = {
      files: [
        {
          key: "sections/good-file.liquid",
          value: "<div>{{ product.title }}</div>"
        }
      ]
    };

    const result = await execute(draftThemeArtifact.schema.parse(input), { shopifyClient: extendedShopifyClient });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.status, "preview_ready");
    assert.strictEqual(result.themeId, 111);
    assert.ok(result.editorUrl.includes("admin/themes/111/editor"));
    
  } finally {
    global.fetch = originalFetch;
  }
});
