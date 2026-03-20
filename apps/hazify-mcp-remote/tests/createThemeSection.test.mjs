import assert from "assert";
import crypto from "crypto";
import { createThemeSectionTool } from "../src/tools/createThemeSection.js";

const originalFetch = global.fetch;

const themeGraphqlId = "gid://shopify/OnlineStoreTheme/123";
const fixedNow = "2026-03-19T10:00:00Z";

const toChecksumMd5 = (payload, encoding = "utf8") =>
  crypto.createHash("md5").update(Buffer.from(payload, encoding)).digest("base64");

const fileStore = new Map();

const setTextFile = (key, value, contentType = "TEXT") => {
  fileStore.set(key, {
    filename: key,
    value,
    checksumMd5: toChecksumMd5(value),
    contentType,
    size: Buffer.byteLength(value, "utf8"),
    createdAt: fixedNow,
    updatedAt: fixedNow,
  });
};

setTextFile(
  "templates/index.json",
  JSON.stringify(
    {
      sections: {
        hero01: { type: "hero-banner" },
        promo01: { type: "promo-strip" },
      },
      order: ["hero01", "promo01"],
    },
    null,
    2
  )
);
setTextFile(
  "sections/header-group.json",
  JSON.stringify(
    {
      sections: {
        header01: { type: "header" },
      },
      order: ["header01"],
    },
    null,
    2
  )
);
setTextFile(
  "sections/footer-group.json",
  JSON.stringify(
    {
      sections: {
        footer01: { type: "footer" },
      },
      order: ["footer01"],
    },
    null,
    2
  )
);
setTextFile(
  "sections/hero-banner.liquid",
  `{% schema %}{"name":"Hero banner","presets":[{"name":"Hero banner"}]}{% endschema %}<div>Hero</div>`
);

const baseThemeNode = {
  id: themeGraphqlId,
  name: "Main Theme",
  role: "MAIN",
  processing: false,
  createdAt: fixedNow,
  updatedAt: fixedNow,
};

const toGraphqlFileNode = (file, includeContent) => {
  const node = {
    filename: file.filename,
    checksumMd5: file.checksumMd5,
    contentType: file.contentType,
    createdAt: file.createdAt,
    updatedAt: file.updatedAt,
    size: file.size,
  };
  if (includeContent) {
    node.body = { content: file.value };
  }
  return node;
};

global.fetch = async (url, options = {}) => {
  const parsedUrl = new URL(url);
  if (!parsedUrl.pathname.endsWith("/graphql.json")) {
    throw new Error(`Unexpected URL: ${url}`);
  }

  const payload = JSON.parse(options.body || "{}");
  const query = String(payload.query || "");
  const variables = payload.variables || {};

  if (query.includes("query ThemeById")) {
    return new Response(
      JSON.stringify({
        data: {
          theme: baseThemeNode,
        },
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  }

  if (query.includes("query ThemeFileById")) {
    const requested = Array.isArray(variables.filenames) ? variables.filenames : [];
    const firstMatch = requested.map((key) => fileStore.get(key)).find(Boolean);
    const nodes = firstMatch ? [toGraphqlFileNode(firstMatch, true)] : [];
    return new Response(
      JSON.stringify({
        data: {
          theme: {
            ...baseThemeNode,
            files: {
              nodes,
              userErrors: [],
            },
          },
        },
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  }

  if (query.includes("query ThemeFilesByIdMetadata") || query.includes("query ThemeFilesByIdWithContent")) {
    const requested = Array.isArray(variables.filenames) ? variables.filenames : [];
    const includeContent = query.includes("WithContent");
    const nodes = requested
      .map((key) => fileStore.get(key))
      .filter(Boolean)
      .map((file) => toGraphqlFileNode(file, includeContent));
    return new Response(
      JSON.stringify({
        data: {
          theme: {
            ...baseThemeNode,
            files: {
              nodes,
              userErrors: [],
            },
          },
        },
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  }

  if (query.includes("mutation ThemeFilesUpsert")) {
    const inputFiles = Array.isArray(variables.files) ? variables.files : [];
    const upsertedThemeFiles = [];
    for (const entry of inputFiles) {
      const key = entry?.filename;
      const body = entry?.body;
      if (!key || !body) {
        continue;
      }
      if (body.type === "BASE64") {
        const raw = Buffer.from(String(body.value || ""), "base64");
        fileStore.set(key, {
          filename: key,
          value: String(body.value || ""),
          checksumMd5: toChecksumMd5(raw, "binary"),
          contentType: "BASE64",
          size: raw.length,
          createdAt: fixedNow,
          updatedAt: fixedNow,
        });
      } else {
        setTextFile(key, String(body.value || ""));
      }
      upsertedThemeFiles.push({ filename: key });
    }

    return new Response(
      JSON.stringify({
        data: {
          themeFilesUpsert: {
            upsertedThemeFiles,
            job: { id: "gid://shopify/Job/200" },
            userErrors: [],
          },
        },
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  }

  throw new Error(`Unexpected GraphQL query: ${query.slice(0, 120)}`);
};

const shopifyClient = {
  request: async () => {
    throw new Error("Direct request() should not be used in createThemeSection test");
  },
  url: "https://unit-test-shop.myshopify.com/admin/api/2026-01/graphql.json",
  requestConfig: {
    headers: {
      "X-Shopify-Access-Token": "shpat_unit_test",
    },
  },
};

try {
  const appendResult = await createThemeSectionTool.execute(
    createThemeSectionTool.schema.parse({
      themeId: 123,
      targetFile: "templates/index.json",
      name: "FAQ Section",
      sectionLiquid: `{% schema %}{"name":"FAQ Section","presets":[{"name":"FAQ Section"}]}{% endschema %}<div>FAQ</div>`,
    }),
    { shopifyClient }
  );

  assert.equal(appendResult.sectionFile, "sections/faq-section.liquid");
  assert.equal(appendResult.placement, "append");
  assert.ok(appendResult.createdFiles.includes("templates/index.json"));
  assert.ok(appendResult.createdFiles.includes("sections/faq-section.liquid"));
  const appendedTemplate = JSON.parse(fileStore.get("templates/index.json").value);
  assert.equal(appendedTemplate.order.at(-1), appendResult.sectionInstanceId);
  assert.deepEqual(appendedTemplate.sections[appendResult.sectionInstanceId], { type: "faq-section" });

  const beforeResult = await createThemeSectionTool.execute(
    createThemeSectionTool.schema.parse({
      themeId: 123,
      targetFile: "templates/index.json",
      name: "Image FAQ",
      handle: "image-faq",
      sectionLiquid:
        `{% schema %}{"name":"Image FAQ","presets":[{"name":"Image FAQ"}]}{% endschema %}<div>Image FAQ</div>`,
      placement: "before",
      anchorSectionId: "promo01",
      templateSectionData: {
        type: "ignored-here",
        settings: {
          heading: "Most asked questions",
        },
      },
      additionalFiles: [
        {
          key: "snippets/image-faq-item.liquid",
          value: "<div>{{ block.settings.question }}</div>",
        },
        {
          key: "assets/image-faq.css",
          value: ".image-faq{display:grid;gap:1rem;}",
        },
      ],
    }),
    { shopifyClient }
  );

  const beforeTemplate = JSON.parse(fileStore.get("templates/index.json").value);
  const promoIndex = beforeTemplate.order.indexOf("promo01");
  assert.equal(beforeTemplate.order[promoIndex - 1], beforeResult.sectionInstanceId);
  assert.deepEqual(beforeTemplate.sections[beforeResult.sectionInstanceId], {
    type: "image-faq",
    settings: {
      heading: "Most asked questions",
    },
  });
  assert.ok(fileStore.has("snippets/image-faq-item.liquid"));
  assert.ok(fileStore.has("assets/image-faq.css"));

  const afterResult = await createThemeSectionTool.execute(
    createThemeSectionTool.schema.parse({
      themeId: 123,
      targetFile: "sections/header-group.json",
      name: "Promo Strip",
      sectionLiquid:
        `{% schema %}{"name":"Promo Strip","presets":[{"name":"Promo Strip"}]}{% endschema %}<div>Promo</div>`,
      placement: "after",
      anchorSectionId: "header01",
    }),
    { shopifyClient }
  );

  const headerGroup = JSON.parse(fileStore.get("sections/header-group.json").value);
  assert.equal(headerGroup.order[1], afterResult.sectionInstanceId);

  await assert.rejects(
    () =>
      createThemeSectionTool.execute(
        createThemeSectionTool.schema.parse({
          themeId: 123,
          name: "Missing target",
          sectionLiquid: "<div>Missing target</div>",
        }),
        { shopifyClient }
      ),
    /target_required:/
  );

  await assert.rejects(
    () =>
      createThemeSectionTool.execute(
        createThemeSectionTool.schema.parse({
          themeId: 123,
          targetFile: "templates/index.liquid",
          name: "Unsupported target",
          sectionLiquid: "<div>Unsupported</div>",
        }),
        { shopifyClient }
      ),
    /unsupported_target:/
  );

  await assert.rejects(
    () =>
      createThemeSectionTool.execute(
        createThemeSectionTool.schema.parse({
          themeId: 123,
          targetFile: "templates/index.json",
          name: "FAQ Section",
          handle: "faq-section",
          sectionLiquid: "<div>Duplicate</div>",
        }),
        { shopifyClient }
      ),
    /section_file_exists:/
  );

  console.log("createThemeSection.test.mjs passed");
} finally {
  global.fetch = originalFetch;
}
