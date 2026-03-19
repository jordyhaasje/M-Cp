import assert from "assert";
import {
  findThemeSectionByName,
  resolveHomepageSections,
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
    {% schema %}
    {"name":"Testimonials","presets":[{"name":"Customer quotes"}]}
    {% endschema %}
    <div>headline testimonial block</div>
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

try {
  global.fetch = createGraphqlFetch(homepageJsonFiles);

  const homepageResult = await resolveHomepageSections(shopifyClient, "2026-01", { themeId: 123 });
  assert.equal(homepageResult.page, "homepage");
  assert.ok(
    homepageResult.sourceFiles.some((entry) => entry.key === "templates/index.json" && entry.used),
    "homepage resolver should include index.json as source file"
  );
  assert.ok(
    homepageResult.sections.some(
      (section) => section.type === "hero-banner" && section.schemaName === "Hero banner"
    ),
    "homepage resolver should attach schema metadata from section files"
  );
  assert.ok(
    homepageResult.sections.some((section) => section.originFile === "sections/header-group.json"),
    "homepage resolver should include discoverable header/footer section groups"
  );

  const exactMatchResult = await findThemeSectionByName(shopifyClient, "2026-01", {
    themeId: 123,
    query: "Hero banner",
    page: "homepage",
  });
  assert.ok(exactMatchResult.exactMatches.length >= 1, "exact homepage section matches should be returned");
  assert.ok(
    exactMatchResult.relevantFiles.includes("sections/hero-banner.liquid"),
    "exact match should point to the section file"
  );

  const fuzzyMatchResult = await findThemeSectionByName(shopifyClient, "2026-01", {
    themeId: 123,
    query: "quotes",
  });
  assert.ok(fuzzyMatchResult.fuzzyMatches.length >= 1, "theme-wide fuzzy section matches should be returned");

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

  global.fetch = createGraphqlFetch(homepageLiquidFiles);
  const liquidFallbackResult = await resolveHomepageSections(shopifyClient, "2026-01", { themeId: 123 });
  assert.ok(
    liquidFallbackResult.notes.some((note) => note.includes("fallback")),
    "resolver should report when it falls back to templates/index.liquid"
  );
  assert.deepEqual(
    liquidFallbackResult.sections.map((section) => section.type),
    ["hero-banner", "testimonials"],
    "liquid homepage fallback should preserve section order"
  );
} finally {
  global.fetch = originalFetch;
}
