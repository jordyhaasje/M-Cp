import test from "node:test";
import assert from "node:assert";
import crypto from "node:crypto";
import { applyThemeDraft } from "../src/tools/applyThemeDraft.js";
import { draftThemeArtifact } from "../src/tools/draftThemeArtifact.js";
import { createThemeDraftDbHarness } from "./helpers/themeDraftDbHarness.mjs";

const execute = draftThemeArtifact.execute;
const themeDraftDb = createThemeDraftDbHarness();

test.after(async () => {
  await themeDraftDb.cleanup();
});
const goodSectionLiquid = `
<style>
  #shopify-section-{{ section.id }} .card {
    display: grid;
    padding: 24px;
    border-radius: 18px;
  }

  @media screen and (max-width: 749px) {
    #shopify-section-{{ section.id }} .card {
      padding: 16px;
    }
  }
</style>

<div class="card">{{ section.settings.heading }}</div>

{% schema %}
{
  "name": "Test section",
  "settings": [
    { "type": "text", "id": "heading", "label": "Heading", "default": "Hello" },
    { "type": "range", "id": "gap", "label": "Gap", "min": 0, "max": 40, "step": 4, "default": 16 },
    { "type": "color", "id": "accent", "label": "Accent", "default": "#111111" }
  ],
  "presets": [{ "name": "Test section" }]
}
{% endschema %}
`;

function checksumMd5Base64(value) {
  return crypto.createHash("md5").update(Buffer.from(value, "utf8")).digest("base64");
}

test("draftThemeArtifact - fails when linter finds issues", async (t) => {
  const mockShopifyClient = {
    url: "https://unit-test.myshopify.com/admin/api/2026-01/graphql.json",
    requestConfig: {
      headers: new Headers({ "x-shopify-access-token": "fake-token" })
    },
    session: { shop: "unit-test.myshopify.com" },
    request: async () => {}
  };

  const input = {
    themeId: 111,
    files: [
      {
        key: "sections/bad-file.liquid",
        value: goodSectionLiquid.replace("{{ section.settings.heading }}", "{{ section.settings.heading ")
      }
    ]
  };

  const result = await execute(draftThemeArtifact.schema.parse(input), { shopifyClient: mockShopifyClient });

  assert.strictEqual(result.success, false);
  assert.strictEqual(result.status, "lint_failed");
  assert.ok(result.errors.length > 0, "Should return linter errors");
  assert.strictEqual(result.errors[0].severity, "error");
});

test("draftThemeArtifact - rejects raw img tags without reliable dimensions before lint upload", async () => {
  const mockShopifyClient = {
    url: "https://unit-test.myshopify.com/admin/api/2026-01/graphql.json",
    requestConfig: {
      headers: new Headers({ "x-shopify-access-token": "fake-token" })
    },
    session: { shop: "unit-test.myshopify.com" },
    request: async () => {}
  };

  const result = await execute(
    draftThemeArtifact.schema.parse({
      themeId: 111,
      files: [
        {
          key: "sections/raw-img.liquid",
          value: `
<style>
  #shopify-section-{{ section.id }} .card { display: grid; padding: 24px; border-radius: 18px; }
  @media screen and (max-width: 749px) {
    #shopify-section-{{ section.id }} .card { padding: 16px; }
  }
</style>
<div class="card">
  <img src="{{ section.settings.image | image_url: width: 1200 }}" alt="{{ section.settings.heading }}">
</div>
{% schema %}
{
  "name": "Raw image demo",
  "settings": [
    { "type": "text", "id": "heading", "label": "Heading", "default": "Hello" },
    { "type": "image_picker", "id": "image", "label": "Image" },
    { "type": "range", "id": "gap", "label": "Gap", "min": 0, "max": 40, "step": 4, "default": 16 },
    { "type": "color", "id": "accent", "label": "Accent", "default": "#111111" }
  ],
  "presets": [{ "name": "Raw image demo" }]
}
{% endschema %}
`,
        },
      ],
    }),
    { shopifyClient: mockShopifyClient }
  );

  assert.equal(result.success, false);
  assert.equal(result.errorCode, "inspection_failed_media");
  assert.ok(
    result.suggestedFixes.some((entry) => entry.includes("image_tag")),
    "media failures should steer the model toward Shopify image_tag rendering"
  );
});

test("draftThemeArtifact - rejects sections without presets", async () => {
  const mockShopifyClient = {
    url: "https://unit-test.myshopify.com/admin/api/2026-01/graphql.json",
    requestConfig: {
      headers: new Headers({ "x-shopify-access-token": "fake-token" })
    },
    session: { shop: "unit-test.myshopify.com" },
    request: async () => {}
  };

  const result = await execute(
    draftThemeArtifact.schema.parse({
      themeId: 111,
      files: [
        {
          key: "sections/no-presets.liquid",
          value: `
<style>
  #shopify-section-{{ section.id }} .demo {
    display: grid;
    gap: 24px;
  }

  @media screen and (max-width: 749px) {
    #shopify-section-{{ section.id }} .demo {
      gap: 16px;
    }
  }
</style>
<div class="demo">{{ section.settings.heading }}</div>
{% schema %}
{
  "name": "No presets",
  "settings": [
    { "type": "text", "id": "heading", "label": "Heading", "default": "Hello" },
    { "type": "range", "id": "gap", "label": "Gap", "min": 0, "max": 40, "step": 4, "default": 16 },
    { "type": "color", "id": "accent", "label": "Accent", "default": "#111111" }
  ]
}
{% endschema %}
`,
        },
      ],
    }),
    { shopifyClient: mockShopifyClient }
  );

  assert.equal(result.success, false);
  assert.equal(result.errorCode, "inspection_failed_schema");
  assert.ok(result.suggestedFixes.some((entry) => entry.includes("preset")));
});

test("draftThemeArtifact - rejects color_scheme sections when the target theme has no global color schemes", async () => {
  const mockShopifyClient = {
    url: "https://unit-test.myshopify.com/admin/api/2026-01/graphql.json",
    requestConfig: {
      headers: new Headers({ "x-shopify-access-token": "fake-token" })
    },
    session: { shop: "unit-test.myshopify.com" },
    request: async () => {}
  };

  const originalFetch = global.fetch;
  global.fetch = async (_url, options = {}) => {
    const payload = options.body ? JSON.parse(String(options.body)) : {};
    const query = String(payload.query || "");
    const themeId = String(payload.variables?.themeId || "");
    const numericThemeId = Number(themeId.match(/\/(\d+)$/)?.[1] || 111);

    if (query.includes("ThemeById")) {
      const resPayload = {
        data: {
          theme: {
            id: `gid://shopify/OnlineStoreTheme/${numericThemeId}`,
            name: "Dev Theme",
            role: "DEVELOPMENT",
            processing: false,
            createdAt: "2026-04-02T00:00:00Z",
            updatedAt: "2026-04-02T00:00:00Z"
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

    if (query.includes("ThemeFilesByIdWithContent")) {
      const settingsSchemaValue = JSON.stringify([
        {
          name: "Theme settings",
          settings: [
            { type: "color", id: "accent", label: "Accent" }
          ]
        }
      ]);
      const settingsDataValue = JSON.stringify({
        current: {
          accent: "#111111"
        }
      });
      const resPayload = {
        data: {
          theme: {
            id: `gid://shopify/OnlineStoreTheme/${numericThemeId}`,
            name: "Dev Theme",
            role: "DEVELOPMENT",
            processing: false,
            createdAt: "2026-04-02T00:00:00Z",
            updatedAt: "2026-04-02T00:00:00Z",
            files: {
              nodes: [
                {
                  filename: "config/settings_schema.json",
                  checksumMd5: checksumMd5Base64(settingsSchemaValue),
                  contentType: "application/json",
                  createdAt: "2026-04-02T00:00:00Z",
                  updatedAt: "2026-04-02T00:00:00Z",
                  size: Buffer.byteLength(settingsSchemaValue, "utf8"),
                  body: { content: settingsSchemaValue }
                },
                {
                  filename: "config/settings_data.json",
                  checksumMd5: checksumMd5Base64(settingsDataValue),
                  contentType: "application/json",
                  createdAt: "2026-04-02T00:00:00Z",
                  updatedAt: "2026-04-02T00:00:00Z",
                  size: Buffer.byteLength(settingsDataValue, "utf8"),
                  body: { content: settingsDataValue }
                }
              ],
              userErrors: []
            }
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

    throw new Error(`Unexpected GraphQL query in color_scheme compatibility test: ${query}`);
  };

  try {
    const result = await execute(
      draftThemeArtifact.schema.parse({
        themeId: 111,
        files: [
          {
            key: "sections/video-header.liquid",
            value: `
<style>
  #shopify-section-{{ section.id }} .hero {
    display: grid;
    padding: 24px;
    border-radius: 18px;
    background: var(--hero-background);
  }

  @media screen and (max-width: 749px) {
    #shopify-section-{{ section.id }} .hero {
      padding: 16px;
    }
  }
</style>

<section class="hero" style="--hero-background: {{ section.settings.color_scheme.settings.background }}">
  {{ section.settings.heading }}
</section>

{% schema %}
{
  "name": "Video header",
  "settings": [
    { "type": "text", "id": "heading", "label": "Heading", "default": "Hello" },
    { "type": "color_scheme", "id": "color_scheme", "label": "Color scheme" },
    { "type": "video", "id": "background_video", "label": "Background video" }
  ],
  "presets": [{ "name": "Video header" }]
}
{% endschema %}
`,
          },
        ],
      }),
      { shopifyClient: mockShopifyClient }
    );

    assert.equal(result.success, false);
    assert.equal(result.errorCode, "inspection_failed_color_scheme_theme_support");
    assert.match(result.message, /color_scheme/i);
    assert.ok(
      result.suggestedFixes.some((entry) => entry.includes("settings_schema.json")),
      "color scheme compatibility failures should point to the global theme config"
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test("draftThemeArtifact - blocks template/config writes in create mode", async () => {
  const mockShopifyClient = {
    url: "https://unit-test.myshopify.com/admin/api/2026-01/graphql.json",
    requestConfig: {
      headers: new Headers({ "x-shopify-access-token": "fake-token" })
    },
    session: { shop: "unit-test.myshopify.com" },
    request: async () => {}
  };

  const result = await execute(
    draftThemeArtifact.schema.parse({
      themeId: 111,
      files: [
        {
          key: "templates/index.json",
          value: "{}"
        }
      ]
    }),
    { shopifyClient: mockShopifyClient }
  );

  assert.equal(result.success, false);
  assert.equal(result.status, "inspection_failed");
  assert.equal(result.errorCode, "inspection_failed_schema");
  assert.equal(result.shouldNarrowScope, true);
});

test("draftThemeArtifact - requires themeId or themeRole", async () => {
  const mockShopifyClient = {
    url: "https://unit-test.myshopify.com/admin/api/2026-01/graphql.json",
    requestConfig: {
      headers: new Headers({ "x-shopify-access-token": "fake-token" })
    },
    session: { shop: "unit-test.myshopify.com" },
    request: async () => {}
  };

  const result = await execute(
    // Hier slaan we Zod parsing gedeeltelijk over of we passeren alleen files, 
    // want schema() staat themeRole.optional() toe, maar execute() blockt als het ontbreekt.
    {
      files: [{ key: "sections/some-file.liquid", value: "hello" }],
    },
    { shopifyClient: mockShopifyClient }
  );

  assert.equal(result.success, false);
  assert.equal(result.errorCode, "missing_theme_target");
});

test("draftThemeArtifact - rejects duplicate file keys with a structured failure", async () => {
  const mockShopifyClient = {
    url: "https://unit-test.myshopify.com/admin/api/2026-01/graphql.json",
    requestConfig: {
      headers: new Headers({ "x-shopify-access-token": "fake-token" })
    },
    session: { shop: "unit-test.myshopify.com" },
    request: async () => {
      throw new Error("duplicate key validation should fail before Shopify reads");
    }
  };

  const result = await execute(
    draftThemeArtifact.schema.parse({
      themeId: 111,
      mode: "edit",
      files: [
        {
          key: "sections/main-product.liquid",
          patch: {
            searchString: "{{ section.settings.heading }}",
            replaceString: "<span>Heading</span>",
          },
        },
        {
          key: "sections/main-product.liquid",
          patch: {
            searchString: "\"type\": \"promo\"",
            replaceString: "\"type\": \"review_badge_exact\"",
          },
        },
      ],
    }),
    { shopifyClient: mockShopifyClient }
  );

  assert.equal(result.success, false);
  assert.equal(result.errorCode, "inspection_failed_duplicate_key");
  assert.match(result.message, /files\[\]\.key moet uniek/i);
  assert.ok(
    result.suggestedFixes.some((entry) => entry.includes("patches")),
    "duplicate-key errors should direct callers to patches[]"
  );
});

test("draftThemeArtifact - applies patches[] sequentially within one file", async () => {
  const mockShopifyClient = {
    url: "https://unit-test.myshopify.com/admin/api/2026-01/graphql.json",
    requestConfig: {
      headers: new Headers({ "x-shopify-access-token": "fake-token" })
    },
    session: { shop: "unit-test.myshopify.com" },
    request: async () => {}
  };

  const originalSection = `
<style>
  #shopify-section-{{ section.id }} .demo {
    display: grid;
    padding: 24px;
    border-radius: 18px;
  }
</style>

<div class="demo">
  <span class="eyebrow">Old badge</span>
  {{ section.settings.heading }}
</div>

{% schema %}
{
  "name": "Patch demo",
  "settings": [
    { "type": "text", "id": "heading", "label": "Heading", "default": "Hello" }
  ],
  "blocks": [
    { "type": "promo", "name": "Promo" }
  ],
  "presets": [{ "name": "Patch demo" }]
}
{% endschema %}
`;

  let storedSection = originalSection;
  const originalFetch = global.fetch;
  global.fetch = async (_url, options = {}) => {
    const payload = options.body ? JSON.parse(String(options.body)) : {};
    const query = String(payload.query || "");
    const themeId = String(payload.variables?.themeId || "");
    const numericThemeId = Number(themeId.match(/\/(\d+)$/)?.[1] || 111);

    if (query.includes("ThemeById")) {
      const resPayload = {
        data: {
          theme: {
            id: `gid://shopify/OnlineStoreTheme/${numericThemeId}`,
            name: "Dev Theme",
            role: "DEVELOPMENT",
            processing: false,
            createdAt: "2026-04-02T00:00:00Z",
            updatedAt: "2026-04-02T00:00:00Z"
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

    if (query.includes("ThemeFilesByIdWithContent")) {
      const resPayload = {
        data: {
          theme: {
            id: `gid://shopify/OnlineStoreTheme/${numericThemeId}`,
            name: "Dev Theme",
            role: "DEVELOPMENT",
            processing: false,
            createdAt: "2026-04-02T00:00:00Z",
            updatedAt: "2026-04-02T00:00:00Z",
            files: {
              nodes: [
                {
                  filename: "sections/main-product.liquid",
                  checksumMd5: checksumMd5Base64(storedSection),
                  contentType: "application/x-liquid",
                  createdAt: "2026-04-02T00:00:00Z",
                  updatedAt: "2026-04-02T00:00:00Z",
                  size: Buffer.byteLength(storedSection, "utf8"),
                  body: { content: storedSection }
                }
              ],
              userErrors: []
            }
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

    if (query.includes("ThemeFileById")) {
      const resPayload = {
        data: {
          theme: {
            id: `gid://shopify/OnlineStoreTheme/${numericThemeId}`,
            name: "Dev Theme",
            role: "DEVELOPMENT",
            processing: false,
            createdAt: "2026-04-02T00:00:00Z",
            updatedAt: "2026-04-02T00:00:00Z",
            files: {
              nodes: [
                {
                  filename: "sections/main-product.liquid",
                  checksumMd5: checksumMd5Base64(storedSection),
                  contentType: "application/x-liquid",
                  createdAt: "2026-04-02T00:00:00Z",
                  updatedAt: "2026-04-02T00:00:00Z",
                  size: Buffer.byteLength(storedSection, "utf8"),
                  body: { content: storedSection }
                }
              ],
              userErrors: []
            }
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

    if (query.includes("ThemeFilesByIdMetadata")) {
      const resPayload = {
        data: {
          theme: {
            id: `gid://shopify/OnlineStoreTheme/${numericThemeId}`,
            name: "Dev Theme",
            role: "DEVELOPMENT",
            processing: false,
            createdAt: "2026-04-02T00:00:00Z",
            updatedAt: "2026-04-02T00:00:00Z",
            files: {
              nodes: [
                {
                  filename: "sections/main-product.liquid",
                  checksumMd5: checksumMd5Base64(storedSection),
                  contentType: "application/x-liquid",
                  createdAt: "2026-04-02T00:00:00Z",
                  updatedAt: "2026-04-02T00:00:00Z",
                  size: Buffer.byteLength(storedSection, "utf8")
                }
              ],
              userErrors: []
            }
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

    if (query.includes("ThemeFilesUpsert")) {
      storedSection = payload.variables.files[0].body.value;
      const resPayload = {
        data: {
          themeFilesUpsert: {
            upsertedThemeFiles: [{ filename: "sections/main-product.liquid" }],
            job: { id: "gid://shopify/Job/1" },
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

    throw new Error(`Unexpected GraphQL query in patches[] test: ${query}`);
  };

  try {
    const result = await execute(
      draftThemeArtifact.schema.parse({
        themeId: 111,
        mode: "edit",
        files: [
          {
            key: "sections/main-product.liquid",
            baseChecksumMd5: checksumMd5Base64(originalSection),
            patches: [
              {
                searchString: "<span class=\"eyebrow\">Old badge</span>",
                replaceString: "<span class=\"eyebrow\">Review badge</span>",
              },
              {
                searchString: "\"type\": \"promo\", \"name\": \"Promo\"",
                replaceString: "\"type\": \"review_badge_exact\", \"name\": \"Review badge\" },\n    { \"type\": \"promo\", \"name\": \"Promo\"",
              },
            ],
          },
        ],
      }),
      { shopifyClient: mockShopifyClient }
    );

    assert.equal(result.success, true);
    assert.equal(result.status, "preview_ready");
    assert.match(storedSection, /Review badge/);
    assert.match(storedSection, /review_badge_exact/);
    assert.ok(result.verify.summary.match >= 1);
  } finally {
    global.fetch = originalFetch;
  }
});

test("draftThemeArtifact - fails when checksum precondition blocks the preview write", async () => {
  const mockShopifyClient = {
    url: "https://unit-test.myshopify.com/admin/api/2026-01/graphql.json",
    requestConfig: {
      headers: new Headers({ "x-shopify-access-token": "fake-token" })
    },
    session: { shop: "unit-test.myshopify.com" },
    request: async () => {}
  };

  const originalSection = goodSectionLiquid;
  const changedSection = goodSectionLiquid.replace("Hello", "Changed remotely");
  const originalFetch = global.fetch;
  global.fetch = async (_url, options = {}) => {
    const payload = options.body ? JSON.parse(String(options.body)) : {};
    const query = String(payload.query || "");
    const themeId = String(payload.variables?.themeId || "");
    const numericThemeId = Number(themeId.match(/\/(\d+)$/)?.[1] || 111);

    if (query.includes("ThemeById")) {
      const resPayload = {
        data: {
          theme: {
            id: `gid://shopify/OnlineStoreTheme/${numericThemeId}`,
            name: "Dev Theme",
            role: "DEVELOPMENT",
            processing: false,
            createdAt: "2026-04-02T00:00:00Z",
            updatedAt: "2026-04-02T00:00:00Z"
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

    if (query.includes("ThemeFilesByIdWithContent")) {
      const resPayload = {
        data: {
          theme: {
            id: `gid://shopify/OnlineStoreTheme/${numericThemeId}`,
            name: "Dev Theme",
            role: "DEVELOPMENT",
            processing: false,
            createdAt: "2026-04-02T00:00:00Z",
            updatedAt: "2026-04-02T00:00:00Z",
            files: {
              nodes: [
                {
                  filename: "sections/good-file.liquid",
                  checksumMd5: checksumMd5Base64(changedSection),
                  contentType: "text/plain",
                  createdAt: "2026-04-02T00:00:00Z",
                  updatedAt: "2026-04-02T00:00:00Z",
                  size: Buffer.byteLength(changedSection, "utf8"),
                  body: { content: changedSection }
                }
              ],
              userErrors: []
            }
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

    if (query.includes("ThemeFileById")) {
      const resPayload = {
        data: {
          theme: {
            id: `gid://shopify/OnlineStoreTheme/${numericThemeId}`,
            name: "Dev Theme",
            role: "DEVELOPMENT",
            processing: false,
            createdAt: "2026-04-02T00:00:00Z",
            updatedAt: "2026-04-02T00:00:00Z",
            files: {
              nodes: [
                {
                  filename: "sections/good-file.liquid",
                  checksumMd5: checksumMd5Base64(changedSection),
                  contentType: "text/plain",
                  createdAt: "2026-04-02T00:00:00Z",
                  updatedAt: "2026-04-02T00:00:00Z",
                  size: Buffer.byteLength(changedSection, "utf8"),
                  body: { content: changedSection }
                }
              ],
              userErrors: []
            }
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

    if (query.includes("ThemeFilesByIdMetadata")) {
      const resPayload = {
        data: {
          theme: {
            id: `gid://shopify/OnlineStoreTheme/${numericThemeId}`,
            name: "Dev Theme",
            role: "DEVELOPMENT",
            processing: false,
            createdAt: "2026-04-02T00:00:00Z",
            updatedAt: "2026-04-02T00:00:00Z",
            files: {
              nodes: [
                {
                  filename: "sections/good-file.liquid",
                  checksumMd5: checksumMd5Base64(changedSection),
                  contentType: "text/plain",
                  createdAt: "2026-04-02T00:00:00Z",
                  updatedAt: "2026-04-02T00:00:00Z",
                  size: Buffer.byteLength(changedSection, "utf8")
                }
              ],
              userErrors: []
            }
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

    if (query.includes("ThemeFilesUpsert")) {
      throw new Error("ThemeFilesUpsert should not run when checksum precondition fails");
    }

    throw new Error(`Unexpected GraphQL query in checksum precondition test: ${query}`);
  };

  try {
    const result = await execute(
      draftThemeArtifact.schema.parse({
        themeId: 111,
        mode: "edit",
        files: [
          {
            key: "sections/good-file.liquid",
            value: originalSection.replace("Hello", "Updated locally"),
            baseChecksumMd5: checksumMd5Base64(originalSection)
          }
        ]
      }),
      { shopifyClient: mockShopifyClient }
    );

    assert.equal(result.success, false);
    assert.equal(result.status, "preview_failed");
    assert.equal(result.errorCode, "preview_failed_precondition");
    assert.match(result.message, /conflict-safe write check faalde/i);
  } finally {
    global.fetch = originalFetch;
  }
});

test("draftThemeArtifact - allows valid json template writes in edit mode", async (t) => {
  const mockShopifyClient = {
    url: "https://unit-test.myshopify.com/admin/api/2026-01/graphql.json",
    requestConfig: {
      headers: new Headers({ "x-shopify-access-token": "fake-token" })
    },
    session: { shop: "unit-test.myshopify.com" },
    request: async () => {}
  };

  // Mock global fetch
  const originalFetch = global.fetch;
  global.fetch = async (url, options = {}) => {
    const payload = options.body ? JSON.parse(String(options.body)) : {};
    const query = String(payload.query || "");
    const themeIdMatch = String(payload.variables?.themeId || "");
    const numericThemeId = Number(themeIdMatch.match(/\/(\d+)$/)?.[1] || 111);

    if (query.includes("ThemeById")) {
      const resPayload = {
        data: {
          theme: {
            id: `gid://shopify/OnlineStoreTheme/${numericThemeId}`,
            name: numericThemeId === 111 ? "Dev Theme" : "Applied Theme",
            role: numericThemeId === 111 ? "DEVELOPMENT" : "MAIN",
            processing: false,
            createdAt: "2026-04-02T00:00:00Z",
            updatedAt: "2026-04-02T00:00:00Z"
          }
        }
      };
      return { ok: true, status: 200, json: async () => resPayload, text: async () => JSON.stringify(resPayload) };
    }
    
    if (query.includes("ThemeFilesUpsert")) {
      const resPayload = {
        data: {
          themeFilesUpsert: {
            upsertedThemeFiles: [{ filename: "templates/index.json" }],
            job: { id: "gid://shopify/Job/1" },
            userErrors: []
          }
        }
      };
      return { ok: true, status: 200, json: async () => resPayload, text: async () => JSON.stringify(resPayload) };
    }

    if (query.includes("ThemeFilesByIdMetadata")) {
      const value = JSON.stringify({ sections: {}, order: [] });
      const resPayload = {
        data: {
          theme: {
            id: `gid://shopify/OnlineStoreTheme/${numericThemeId}`,
            name: numericThemeId === 111 ? "Dev Theme" : "Applied Theme",
            role: numericThemeId === 111 ? "DEVELOPMENT" : "MAIN",
            processing: false,
            createdAt: "2026-04-02T00:00:00Z",
            updatedAt: "2026-04-02T00:00:00Z",
            files: {
              nodes: [
                {
                  filename: "templates/index.json",
                  checksumMd5: checksumMd5Base64(value),
                  contentType: "application/json",
                  createdAt: "2026-04-02T00:00:00Z",
                  updatedAt: "2026-04-02T00:00:00Z",
                  size: Buffer.byteLength(value, "utf8")
                }
              ],
              userErrors: []
            }
          }
        }
      };
      return { ok: true, status: 200, json: async () => resPayload, text: async () => JSON.stringify(resPayload) };
    }

    return { ok: true, status: 200, json: async () => ({}), text: async () => "{}" };
  };

  try {
    const result = await execute(
      draftThemeArtifact.schema.parse({
        themeId: 111,
        mode: "edit",
        files: [
          {
            key: "templates/index.json",
            value: JSON.stringify({ sections: {}, order: [] })
          }
        ]
      }),
      { shopifyClient: mockShopifyClient }
    );

    assert.equal(result.success, true);
    assert.equal(result.status, "preview_ready");
  } finally {
    global.fetch = originalFetch;
  }
});

test("draftThemeArtifact - rejects invalid json template writes in edit mode", async () => {
  const mockShopifyClient = {
    url: "https://unit-test.myshopify.com/admin/api/2026-01/graphql.json",
    requestConfig: {
      headers: new Headers({ "x-shopify-access-token": "fake-token" })
    },
    session: { shop: "unit-test.myshopify.com" },
    request: async () => {}
  };

  const originalFetch = global.fetch;
  global.fetch = async (url, options = {}) => {
    console.log("Mock fetched url:", url);
    if (url.includes("/assets.json")) {
      const jsonValue = {
        asset: {
          key: "templates/index.json",
          value: JSON.stringify({ sections: {}, order: [] }),
          checksum: "mock"
        }
      };
      return {
        ok: true,
        status: 200,
        json: async () => jsonValue,
        text: async () => JSON.stringify(jsonValue)
      };
    }
    
    if (url.includes("/themes/111.json")) {
      const jsonValue = {
        theme: {
          id: 111,
          name: "Dev Theme",
          role: "development"
        }
      };
      return {
        ok: true,
        status: 200,
        json: async () => jsonValue,
        text: async () => JSON.stringify(jsonValue)
      };
    }

    const payload = options.body && typeof options.body === "string" ? JSON.parse(options.body) : {};
    const query = String(payload.query || "");

    if (query.includes("ThemeById")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            theme: {
              id: "gid://shopify/OnlineStoreTheme/111",
              name: "Dev Theme",
              role: "DEVELOPMENT",
            }
          }
        }),
        text: async () => "{}"
      };
    }

    if (query.includes("ThemeFilesById")) {
      const value = JSON.stringify({ sections: {}, order: [] });
      return {
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            theme: {
              id: "gid://shopify/OnlineStoreTheme/111",
              name: "Dev Theme",
              role: "DEVELOPMENT",
              files: {
                nodes: [
                  {
                    filename: "templates/index.json",
                    checksumMd5: "mock-checksum",
                    contentType: "application/json",
                    size: Buffer.byteLength(value, "utf8"),
                    body: { content: value }
                  }
                ],
                userErrors: []
              }
            }
          }
        }),
        text: async () => "{}"
      };
    }
    return { ok: true, status: 200, json: async () => ({}), text: async () => "{}" };
  };

  try {
    const result = await execute(
      draftThemeArtifact.schema.parse({
        themeId: 111,
        mode: "edit",
        files: [
          {
            key: "templates/index.json",
            value: JSON.stringify({ sections: {} }) // missing 'order' array
          }
        ]
      }),
      { shopifyClient: mockShopifyClient }
    );

    assert.equal(result.success, false);
    assert.equal(result.status, "inspection_failed");
    assert.equal(result.errorCode, "inspection_failed_json");
    assert.ok(result.message.includes("'order' array"));
  } finally {
    global.fetch = originalFetch;
  }
});

test("draftThemeArtifact - success when linter passes (pushes directly to chosen theme)", async (t) => {
  const mockShopifyClient = {
    url: "https://unit-test.myshopify.com/admin/api/2026-01/graphql.json",
    requestConfig: {
      headers: new Headers({ "x-shopify-access-token": "fake-token" })
    },
    session: { shop: "unit-test.myshopify.com" },
    request: async () => {}
  };

  const originalFetch = global.fetch;
  global.fetch = async (url, options = {}) => {
    const payload = options.body ? JSON.parse(String(options.body)) : {};
    const query = String(payload.query || "");
    const themeId = String(payload.variables?.themeId || "");
    const numericThemeId = Number(themeId.match(/\/(\d+)$/)?.[1] || 111);

    if (query.includes("ThemeById")) {
      const resPayload = {
        data: {
          theme: {
            id: `gid://shopify/OnlineStoreTheme/${numericThemeId}`,
            name: numericThemeId === 111 ? "Dev Theme" : "Applied Theme",
            role: numericThemeId === 111 ? "DEVELOPMENT" : "MAIN",
            processing: false,
            createdAt: "2026-04-02T00:00:00Z",
            updatedAt: "2026-04-02T00:00:00Z"
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

    if (query.includes("ThemeFilesUpsert")) {
      const resPayload = {
        data: {
          themeFilesUpsert: {
            upsertedThemeFiles: [{ filename: "sections/good-file.liquid" }],
            job: { id: "gid://shopify/Job/1" },
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

    if (query.includes("ThemeFilesByIdMetadata")) {
      const value = goodSectionLiquid;
      const resPayload = {
        data: {
          theme: {
            id: `gid://shopify/OnlineStoreTheme/${numericThemeId}`,
            name: numericThemeId === 111 ? "Dev Theme" : "Applied Theme",
            role: numericThemeId === 111 ? "DEVELOPMENT" : "MAIN",
            processing: false,
            createdAt: "2026-04-02T00:00:00Z",
            updatedAt: "2026-04-02T00:00:00Z",
            files: {
              nodes: [
                {
                  filename: "sections/good-file.liquid",
                  checksumMd5: checksumMd5Base64(value),
                  contentType: "text/plain",
                  createdAt: "2026-04-02T00:00:00Z",
                  updatedAt: "2026-04-02T00:00:00Z",
                  size: Buffer.byteLength(value, "utf8")
                }
              ],
              userErrors: []
            }
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
      themeId: 111,
      files: [
        {
          key: "sections/good-file.liquid",
          value: goodSectionLiquid
        }
      ]
    };

    const result = await execute(draftThemeArtifact.schema.parse(input), { shopifyClient: mockShopifyClient });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.status, "preview_ready");
    assert.strictEqual(result.themeId, 111);
    assert.ok(result.editorUrl.includes("admin/themes/111/editor"));
    assert.strictEqual(result.target.role, "development");
    assert.ok(result.verify.summary.match >= 1);
    assert.ok(result.draft);
    
  } finally {
    global.fetch = originalFetch;
  }
});

test("applyThemeDraft - applies an existing draft to an explicit target theme", async () => {
  const mockShopifyClient = {
    url: "https://unit-test.myshopify.com/admin/api/2026-01/graphql.json",
    requestConfig: {
      headers: new Headers({ "x-shopify-access-token": "fake-token" })
    },
    session: { shop: "unit-test.myshopify.com" },
    request: async () => {}
  };

  const originalFetch = global.fetch;
  global.fetch = async (_url, options = {}) => {
    const payload = options.body ? JSON.parse(String(options.body)) : {};
    const query = String(payload.query || "");
    const themeId = String(payload.variables?.themeId || "");
    const numericThemeId = Number(themeId.match(/\/(\d+)$/)?.[1] || 111);

    if (query.includes("ThemeById")) {
      const resPayload = {
        data: {
          theme: {
            id: `gid://shopify/OnlineStoreTheme/${numericThemeId}`,
            name: numericThemeId === 222 ? "Main Theme" : "Dev Theme",
            role: numericThemeId === 222 ? "MAIN" : "DEVELOPMENT",
            processing: false,
            createdAt: "2026-04-02T00:00:00Z",
            updatedAt: "2026-04-02T00:00:00Z"
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

    if (query.includes("ThemeFilesUpsert")) {
      const resPayload = {
        data: {
          themeFilesUpsert: {
            upsertedThemeFiles: [{ filename: "sections/good-file.liquid" }],
            job: { id: "gid://shopify/Job/2" },
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

    if (query.includes("ThemeFilesByIdMetadata")) {
      const value = goodSectionLiquid;
      const resPayload = {
        data: {
          theme: {
            id: `gid://shopify/OnlineStoreTheme/${numericThemeId}`,
            name: numericThemeId === 222 ? "Main Theme" : "Dev Theme",
            role: numericThemeId === 222 ? "MAIN" : "DEVELOPMENT",
            processing: false,
            createdAt: "2026-04-02T00:00:00Z",
            updatedAt: "2026-04-02T00:00:00Z",
            files: {
              nodes: [
                {
                  filename: "sections/good-file.liquid",
                  checksumMd5: checksumMd5Base64(value),
                  contentType: "text/plain",
                  createdAt: "2026-04-02T00:00:00Z",
                  updatedAt: "2026-04-02T00:00:00Z",
                  size: Buffer.byteLength(value, "utf8")
                }
              ],
              userErrors: []
            }
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

    throw new Error(`Unexpected GraphQL query in applyThemeDraft test: ${query}`);
  };

  try {
    const draftResult = await execute(
      draftThemeArtifact.schema.parse({
        themeId: 111,
        files: [{ key: "sections/good-file.liquid", value: goodSectionLiquid }],
      }),
      { shopifyClient: mockShopifyClient }
    );

    const result = await applyThemeDraft.execute(
      applyThemeDraft.schema.parse({
        draftId: draftResult.draftId,
        themeId: 222,
        confirmation: "APPLY_THEME_DRAFT",
        reason: "Promote approved preview to main theme",
      }),
      { shopifyClient: mockShopifyClient }
    );

    assert.equal(result.success, true);
    assert.equal(result.status, "applied");
    assert.equal(result.theme.id, 222);
    assert.equal(result.draft.appliedThemeId, 222);
    assert.ok(result.verify.summary.match >= 1);
  } finally {
    global.fetch = originalFetch;
  }
});

test("applyThemeDraft - requires an explicit target theme", async () => {
  await assert.rejects(
    () =>
      applyThemeDraft.execute(
        applyThemeDraft.schema.parse({
          draftId: "mock-1",
          confirmation: "APPLY_THEME_DRAFT",
          reason: "Explicit target required",
        }),
        {
          shopifyClient: {
            url: "https://unit-test.myshopify.com/admin/api/2026-01/graphql.json",
            requestConfig: {
              headers: new Headers({ "x-shopify-access-token": "fake-token" }),
            },
            session: { shop: "unit-test.myshopify.com" },
            request: async () => {
              throw new Error("should not reach Shopify without an explicit target");
            },
          },
        }
      ),
    /themeId of themeRole/i
  );
});

test("applyThemeDraft - returns a structured failure when Shopify apply does not write files", async () => {
  const mockShopifyClient = {
    url: "https://unit-test.myshopify.com/admin/api/2026-01/graphql.json",
    requestConfig: {
      headers: new Headers({ "x-shopify-access-token": "fake-token" })
    },
    session: { shop: "unit-test.myshopify.com" },
    request: async () => {}
  };

  const originalFetch = global.fetch;
  global.fetch = async (_url, options = {}) => {
    const payload = options.body ? JSON.parse(String(options.body)) : {};
    const query = String(payload.query || "");
    const themeId = String(payload.variables?.themeId || "");
    const numericThemeId = Number(themeId.match(/\/(\d+)$/)?.[1] || 111);

    if (query.includes("ThemeById")) {
      const resPayload = {
        data: {
          theme: {
            id: `gid://shopify/OnlineStoreTheme/${numericThemeId}`,
            name: numericThemeId === 222 ? "Main Theme" : "Dev Theme",
            role: numericThemeId === 222 ? "MAIN" : "DEVELOPMENT",
            processing: false,
            createdAt: "2026-04-02T00:00:00Z",
            updatedAt: "2026-04-02T00:00:00Z"
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

    if (query.includes("ThemeFilesUpsert")) {
      const resPayload = {
        data: {
          themeFilesUpsert: {
            upsertedThemeFiles: [],
            job: { id: "gid://shopify/Job/3" },
            userErrors: [
              {
                filename: "sections/good-file.liquid",
                code: "FILE_VALIDATION_ERROR",
                message: "Simulated apply failure"
              }
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

    if (query.includes("ThemeFilesByIdMetadata")) {
      const value = goodSectionLiquid;
      const resPayload = {
        data: {
          theme: {
            id: `gid://shopify/OnlineStoreTheme/${numericThemeId}`,
            name: numericThemeId === 222 ? "Main Theme" : "Dev Theme",
            role: numericThemeId === 222 ? "MAIN" : "DEVELOPMENT",
            processing: false,
            createdAt: "2026-04-02T00:00:00Z",
            updatedAt: "2026-04-02T00:00:00Z",
            files: {
              nodes: [
                {
                  filename: "sections/good-file.liquid",
                  checksumMd5: checksumMd5Base64(value),
                  contentType: "text/plain",
                  createdAt: "2026-04-02T00:00:00Z",
                  updatedAt: "2026-04-02T00:00:00Z",
                  size: Buffer.byteLength(value, "utf8")
                }
              ],
              userErrors: []
            }
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

    throw new Error(`Unexpected GraphQL query in applyThemeDraft failure test: ${query}`);
  };

  try {
    const draftResult = await execute(
      draftThemeArtifact.schema.parse({
        themeId: 111,
        files: [{ key: "sections/good-file.liquid", value: goodSectionLiquid }],
      }),
      { shopifyClient: mockShopifyClient }
    );

    const result = await applyThemeDraft.execute(
      applyThemeDraft.schema.parse({
        draftId: draftResult.draftId,
        themeId: 222,
        confirmation: "APPLY_THEME_DRAFT",
        reason: "Validate failed apply path",
      }),
      { shopifyClient: mockShopifyClient }
    );

    assert.equal(result.success, false);
    assert.equal(result.status, "apply_failed");
    assert.equal(result.errorCode, "apply_failed");
    assert.match(result.message, /Simulated apply failure/);
  } finally {
    global.fetch = originalFetch;
  }
});
