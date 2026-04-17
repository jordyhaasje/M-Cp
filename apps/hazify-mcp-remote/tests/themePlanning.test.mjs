import assert from "assert";
import {
  planThemeEdit,
  searchThemeFilesWithSnippets,
} from "../src/lib/themePlanning.js";

const originalFetch = global.fetch;
const shopifyClient = {
  url: "https://unit-test-shop.myshopify.com/admin/api/2026-01/graphql.json",
  requestConfig: {
    headers: {
      "X-Shopify-Access-Token": "shpat_unit_test",
    },
  },
};

const themeNode = {
  id: "gid://shopify/OnlineStoreTheme/123",
  name: "Main theme",
  role: "MAIN",
  processing: false,
  createdAt: "2026-03-10T10:00:00Z",
  updatedAt: "2026-03-11T10:00:00Z",
};

function makeTextAsset(content, contentType = "TEXT") {
  return {
    checksumMd5: "checksum",
    contentType,
    createdAt: "2026-03-10T10:00:00Z",
    updatedAt: "2026-03-11T10:00:00Z",
    size: Buffer.byteLength(content, "utf8"),
    body: {
      content,
    },
  };
}

function patternMatches(filename, pattern) {
  if (!pattern.includes("*")) {
    return filename === pattern;
  }
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`).test(filename);
}

function createGraphqlFetch(files) {
  return async (_url, init = {}) => {
    const payload = JSON.parse(init.body || "{}");
    const query = String(payload.query || "");
    const variables = payload.variables || {};

    if (query.includes("query ThemeById")) {
      return new Response(
        JSON.stringify({
          data: {
            theme: themeNode,
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }

    if (query.includes("ThemeFilesByIdWithContent") || query.includes("ThemeFilesByIdMetadata")) {
      const filenames = Array.isArray(variables.filenames) ? variables.filenames : [];
      const first = Number(variables.first || filenames.length || 50);
      const matched = Object.entries(files)
        .filter(([filename]) => filenames.some((pattern) => patternMatches(filename, pattern)))
        .slice(0, first)
        .map(([filename, file]) => ({
          filename,
          ...file,
        }));
      return new Response(
        JSON.stringify({
          data: {
            theme: {
              ...themeNode,
              files: {
                nodes: matched,
                userErrors: [],
              },
            },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }

    throw new Error(`Unexpected GraphQL query in themePlanning test: ${query.slice(0, 80)}`);
  };
}

const homepageJsonFiles = {
  "templates/index.json": makeTextAsset(
    JSON.stringify({
      sections: {
        hero_1: { type: "hero-banner" },
        testimonials_1: { type: "testimonials" },
      },
      order: ["hero_1", "testimonials_1"],
    })
  ),
  "sections/header-group.json": makeTextAsset(
    JSON.stringify({
      sections: {
        header_1: { type: "announcement-bar" },
      },
      order: ["header_1"],
    })
  ),
  "sections/footer-group.json": makeTextAsset(
    JSON.stringify({
      sections: {
        footer_1: { type: "footer-links" },
      },
      order: ["footer_1"],
    })
  ),
  "sections/hero-banner.liquid": makeTextAsset(`
    {% schema %}
    {"name":"Hero banner","presets":[{"name":"Homepage hero"}]}
    {% endschema %}
    <div>{{ section.settings.heading }}</div>
  `),
  "sections/testimonials.liquid": makeTextAsset(`
    <style>
      .testimonials .title {
        font-size: 2.5rem;
      }

      .testimonials .card-grid {
        gap: 24px;
      }
    </style>
    <section class="testimonials page-width">
      <div class="card-grid rte">headline testimonial block</div>
    </section>
    {% schema %}
    {"name":"Testimonials","settings":[
      {"type":"range","id":"padding_top","label":"Padding top","min":0,"max":80,"step":4,"default":36},
      {"type":"range","id":"padding_bottom","label":"Padding bottom","min":0,"max":80,"step":4,"default":36}
    ],"presets":[{"name":"Customer quotes"}]}
    {% endschema %}
  `),
  "sections/announcement-bar.liquid": makeTextAsset(`
    {% schema %}
    {"name":"Announcement bar","presets":[{"name":"Top banner"}]}
    {% endschema %}
    <div>top banner</div>
  `),
  "sections/footer-links.liquid": makeTextAsset(`
    {% schema %}
    {"name":"Footer links","presets":[{"name":"Footer links"}]}
    {% endschema %}
    <div>Footer links</div>
  `),
};

const homepageLiquidFiles = {
  "templates/index.liquid": makeTextAsset(`
    {% section 'hero-banner' %}
    {% section 'testimonials' %}
  `),
  "sections/hero-banner.liquid": homepageJsonFiles["sections/hero-banner.liquid"],
  "sections/testimonials.liquid": homepageJsonFiles["sections/testimonials.liquid"],
};

const productBlockFiles = {
  "templates/product.json": makeTextAsset(
    `/* Product template */
    {
      "sections": {
        "main": { "type": "main-product" },
        "complementary": { "type": "product-recommendations" }
      },
      "order": ["main", "complementary",]
    }`
  ),
  "sections/main-product.liquid": makeTextAsset(`
    {% render 'product-info', product: product, section: section %}
    {% schema %}
    {
      "name": "Main product",
      "blocks": [
        { "type": "text", "name": "Text" },
        { "type": "buy_buttons", "name": "Buy buttons" },
        { "type": "@app" }
      ]
    }
    {% endschema %}
  `),
  "sections/product-recommendations.liquid": makeTextAsset(`
    {% schema %}
    {
      "name": "Recommendations",
      "presets": [{ "name": "Recommendations" }]
    }
    {% endschema %}
  `),
  "snippets/product-info.liquid": makeTextAsset(`
    {% for block in section.blocks %}
      <div {{ block.shopify_attributes }}>
        {% case block.type %}
          {% when 'text' %}
            <p>{{ product.title }}</p>
          {% when 'buy_buttons' %}
            <button>Add to cart</button>
        {% endcase %}
      </div>
    {% endfor %}
  `),
};

const productThemeBlockFiles = {
  "templates/product.json": makeTextAsset(
    JSON.stringify({
      sections: {
        main: { type: "main-product" },
      },
      order: ["main"],
    })
  ),
  "sections/main-product.liquid": makeTextAsset(`
    <div class="product-shell">{% content_for 'blocks' %}</div>
    {% schema %}
    {
      "name": "Main product",
      "blocks": [
        { "type": "@theme" },
        { "type": "@app" }
      ]
    }
    {% endschema %}
  `),
  "blocks/review-badge.liquid": makeTextAsset(`
    {% schema %}
    { "name": "Review badge" }
    {% endschema %}
  `),
};

try {
  global.fetch = createGraphqlFetch(homepageJsonFiles);

  const searchResult = await searchThemeFilesWithSnippets(shopifyClient, "2026-01", {
    query: "headline",
    filePatterns: ["sections/*.liquid"],
    themeId: 123,
    resultLimit: 2,
    snippetLength: 90,
  });
  assert.ok(searchResult.hits.length >= 1, "search-theme-files should return scoped hits");
  assert.ok(
    searchResult.hits.every((hit) => !Object.prototype.hasOwnProperty.call(hit, "value")),
    "search-theme-files should return snippets instead of full file content"
  );
  assert.ok(
    searchResult.hits.some((hit) => hit.snippets.some((snippet) => snippet.toLowerCase().includes("headline"))),
    "search-theme-files snippets should include the matched text"
  );

  global.fetch = createGraphqlFetch(productBlockFiles);

  const productBlockPlan = await planThemeEdit(shopifyClient, "2026-01", {
    themeId: 123,
    intent: "native_block",
    template: "product",
    query: "review badge block",
  });
  assert.equal(productBlockPlan.recommendedFlow, "multi-file-edit");
  assert.equal(productBlockPlan.shouldUse, "draft-theme-artifact");
  assert.equal(productBlockPlan.architecture.templateFormat, "json");
  assert.equal(productBlockPlan.architecture.primarySectionFile, "sections/main-product.liquid");
  assert.equal(productBlockPlan.architecture.supportsAppBlocks, true);
  assert.equal(productBlockPlan.architecture.usesThemeBlocks, false);
  assert.ok(
    productBlockPlan.nextWriteKeys.includes("sections/main-product.liquid"),
    "native product block plan should include the main section file"
  );
  assert.ok(
    productBlockPlan.nextWriteKeys.includes("snippets/product-info.liquid"),
    "native product block plan should include the snippet that renders section.blocks"
  );
  assert.equal(
    productBlockPlan.nextReadKeys.includes("templates/product.json"),
    false,
    "native product block plan should not ask the client to reread the template unless placement is requested"
  );
  assert.ok(
    productBlockPlan.warnings.some((warning) => warning.includes("placement")),
    "native product block plan should warn that template reads after planning are only needed for explicit placement"
  );

  const exactKeySearchResult = await searchThemeFilesWithSnippets(shopifyClient, "2026-01", {
    query: "buy_buttons",
    keys: ["sections/main-product.liquid", "snippets/product-info.liquid"],
    themeId: 123,
    resultLimit: 4,
    snippetLength: 100,
  });
  assert.ok(
    exactKeySearchResult.hits.every(
      (hit) => hit.key === "sections/main-product.liquid" || hit.key === "snippets/product-info.liquid"
    ),
    "exact-key search should stay inside the planner-provided files"
  );
  assert.ok(
    exactKeySearchResult.hits.some((hit) =>
      hit.snippets.some((snippet) => snippet.includes("buy_buttons") || snippet.includes("Buy buttons"))
    ),
    "exact-key search should still surface compact snippets from the target files"
  );

  global.fetch = createGraphqlFetch(homepageJsonFiles);

  const newSectionPlan = await planThemeEdit(shopifyClient, "2026-01", {
    themeId: 123,
    intent: "new_section",
    template: "homepage",
    query: "Maak een nieuwe promo section",
  });
  assert.equal(newSectionPlan.recommendedFlow, "create-section");
  assert.equal(
    newSectionPlan.shouldUse,
    "create-theme-section",
    "new section planning should point to the direct section create tool"
  );
  assert.ok(
    newSectionPlan.nextReadKeys.includes("sections/testimonials.liquid"),
    "new section planning should prefer a content-like representative section so the client can mirror theme conventions before writing"
  );
  assert.ok(
    newSectionPlan.warnings.some((warning) => warning.includes("padding_top") && warning.includes("padding_bottom")),
    "new section planning should warn about mirroring theme-specific spacing conventions"
  );
  assert.ok(
    newSectionPlan.searchQueries.includes("padding_top") &&
      newSectionPlan.searchQueries.includes("section_padding"),
    "new section planning should surface convention-oriented search queries for spacing patterns"
  );
  assert.equal(
    newSectionPlan.themeContext?.representativeSection?.key,
    "sections/testimonials.liquid",
    "new section planning should expose compact theme context from the representative content section"
  );
  assert.ok(
    Array.isArray(newSectionPlan.themeContext?.guardrails) &&
      newSectionPlan.themeContext.guardrails.length > 0,
    "new section planning should expose scale guardrails for new sections"
  );

  global.fetch = createGraphqlFetch(productThemeBlockFiles);

  const productThemeBlockPlan = await planThemeEdit(shopifyClient, "2026-01", {
    themeId: 123,
    intent: "native_block",
    template: "product",
    query: "theme block review badge",
  });
  assert.equal(productThemeBlockPlan.recommendedFlow, "multi-file-edit");
  assert.equal(productThemeBlockPlan.architecture.usesThemeBlocks, true);
  assert.ok(
    productThemeBlockPlan.newFileSuggestions.includes("blocks/<new-theme-block>.liquid"),
    "theme block architecture should steer toward a blocks/*.liquid create flow"
  );
} finally {
  global.fetch = originalFetch;
}
