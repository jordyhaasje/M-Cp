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

test("draftThemeArtifact - success when linter passes (mocks Shopify Sandbox push)", async (t) => {
  let listThemesCalled = false;
  let upsertCalled = false;
  let postThemesCalled = false;

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
    post: async (path, params) => {
      postThemesCalled = true;
      return {
        body: {
          theme: { id: 222, name: "Hazify Sandbox", role: "unpublished" }
        }
      };
    },
    rest: {
      Theme: {
        post: async () => {} // Just to prevent undefined error if it calls it
      }
    }
  };

  // We mock upsertThemeFilesTool inside the execution context by overriding it if we want,
  // but since we are modifying files, let's actually let it execute its inner fetch.
  // Wait, upsertThemeFilesTool uses shopifyClient.graphql. We can mock its response.
  
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
    if (String(url).includes("/themes.json")) {
       const resPayload = { theme: { id: 222, name: "Hazify Sandbox", role: "unpublished" } };
       return {
         ok: true,
         status: 200,
         json: async () => resPayload,
         text: async () => JSON.stringify(resPayload)
       };
    }
    
    // For REST API upload or verification inside upsertThemeFilesTool if any
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
          theme: { id: "gid://shopify/OnlineStoreTheme/222", name: "Hazify Sandbox", role: "UNPUBLISHED" }
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
    assert.strictEqual(result.sandboxThemeId, 222);
    assert.ok(result.previewUrl.includes("preview_theme_id=222"));
    
  } finally {
    global.fetch = originalFetch;
  }
});
