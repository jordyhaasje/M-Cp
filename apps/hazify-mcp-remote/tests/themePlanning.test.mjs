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
      {% render 'section-properties', section: section %}
      <div class="card-grid rte">headline testimonial block</div>
      {% render 'button', label: section.settings.heading %}
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
  "snippets/section-properties.liquid": makeTextAsset(`
    <div class="section-properties" data-section-id="{{ section.id }}"></div>
  `),
  "snippets/button.liquid": makeTextAsset(`
    <button class="button button--primary">{{ label }}</button>
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

const mediaEditFiles = {
  ...homepageJsonFiles,
  "sections/video-story.liquid": makeTextAsset(`
    <section class="video-story page-width">
      {% if section.settings.video != blank %}
        {{ section.settings.video | video_tag: controls: true }}
      {% endif %}
    </section>
    {% schema %}
    {"name":"Video story","settings":[
      {"type":"video","id":"video","label":"Video"},
      {"type":"range","id":"overlay_opacity","label":"Overlay opacity","min":0,"max":100,"step":5,"default":40}
    ],"presets":[{"name":"Video story"}]}
    {% endschema %}
  `),
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
    {% render 'price-list', product: product %}
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
  "snippets/price-list.liquid": makeTextAsset(`
    <div class="price-list">{{ product.price | money }}</div>
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
  assert.equal(productBlockPlan.changeScope, "multi_file_structural_edit");
  assert.equal(productBlockPlan.preferredWriteMode, "files");
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
    productBlockPlan.nextReadKeys.includes("snippets/price-list.liquid"),
    false,
    "native product block plan should not force helper snippets that do not render section.blocks into the first read pass"
  );
  assert.equal(
    productBlockPlan.nextReadKeys.includes("templates/product.json"),
    false,
    "native product block plan should not ask the client to reread the template unless placement is requested"
  );
  assert.ok(
    productBlockPlan.searchQueries.includes("buy_buttons"),
    "native product block plan should expose a shared schema/render anchor that can be used in compact search-theme-files reads"
  );
  assert.ok(
    productBlockPlan.warnings.some((warning) => warning.includes("placement")),
    "native product block plan should warn that template reads after planning are only needed for explicit placement"
  );
  assert.ok(
    Array.isArray(productBlockPlan.diagnosticTargets) &&
      productBlockPlan.diagnosticTargets.some(
        (target) =>
          target.fileKey === "sections/main-product.liquid" &&
          target.preferredWriteMode === "files"
      ),
    "native product block plan should expose concrete multi-file write targets"
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

  const exactExistingEditPlan = await planThemeEdit(shopifyClient, "2026-01", {
    themeId: 123,
    intent: "existing_edit",
    targetFile: "sections/main-product.liquid",
    query: "Pas deze section aan",
  });
  assert.equal(exactExistingEditPlan.recommendedFlow, "rewrite-existing");
  assert.equal(exactExistingEditPlan.changeScope, "bounded_rewrite");
  assert.equal(exactExistingEditPlan.preferredWriteMode, "value");
  assert.equal(exactExistingEditPlan.shouldUse, "draft-theme-artifact");
  assert.equal(exactExistingEditPlan.template.requested, null);
  assert.equal(exactExistingEditPlan.template.resolved, null);
  assert.deepEqual(exactExistingEditPlan.nextReadKeys, [
    "sections/main-product.liquid",
    "snippets/product-info.liquid",
  ]);

  const exactSurgicalEditPlan = await planThemeEdit(shopifyClient, "2026-01", {
    themeId: 123,
    intent: "existing_edit",
    targetFile: "sections/main-product.liquid",
    query: "Verklein alleen de padding rond de buy button",
  });
  assert.equal(exactSurgicalEditPlan.recommendedFlow, "patch-existing");
  assert.equal(exactSurgicalEditPlan.changeScope, "micro_patch");
  assert.equal(exactSurgicalEditPlan.preferredWriteMode, "patch");
  assert.equal(exactSurgicalEditPlan.shouldUse, "patch-theme-file");
  assert.deepEqual(
    exactSurgicalEditPlan.nextReadKeys,
    ["sections/main-product.liquid"],
    "surgical existing_edit planning should not eagerly hydrate snippet renderer files"
  );
  assert.ok(
    exactSurgicalEditPlan.diagnosticTargets.some(
      (target) =>
        target.fileKey === "sections/main-product.liquid" &&
        target.preferredWriteMode === "patch"
    ),
    "exact surgical edit plans should expose the patchable target file"
  );

  const constrainedResponsiveEditPlan = await planThemeEdit(shopifyClient, "2026-01", {
    themeId: 123,
    intent: "existing_edit",
    targetFile: "sections/main-product.liquid",
    query:
      "Zet alleen op mobiel de review-sterren bovenaan, laat desktop en de bestaande animatie verder ongewijzigd.",
  });
  assert.equal(constrainedResponsiveEditPlan.recommendedFlow, "patch-existing");
  assert.equal(
    constrainedResponsiveEditPlan.shouldUse,
    "patch-theme-file",
    "constrained mobile-only reorders should stay in the patch flow instead of being escalated to a rewrite"
  );

  const existingPdpEditPlan = await planThemeEdit(shopifyClient, "2026-01", {
    themeId: 123,
    intent: "existing_edit",
    targetFile: "sections/main-product.liquid",
    query:
      "Pas alleen de PDP prijs-spacing rond de product price aan en laat buy_buttons ongewijzigd.",
  });
  assert.equal(existingPdpEditPlan.recommendedFlow, "patch-existing");
  assert.equal(existingPdpEditPlan.changeScope, "micro_patch");
  assert.equal(existingPdpEditPlan.preferredWriteMode, "patch");
  assert.deepEqual(existingPdpEditPlan.nextReadKeys, ["sections/main-product.liquid"]);

  const promptOnlyPdpPlan = await planThemeEdit(shopifyClient, "2026-01", {
    themeId: 123,
    intent: "new_section",
    template: "product",
    query:
      "Maak een PDP conversion block met productprijs, review proof en add-to-cart CTA",
  });
  assert.equal(
    promptOnlyPdpPlan.sectionBlueprint?.archetype,
    "pdp_section",
    "prompt-only PDP/product prompts should surface a dedicated commerce scaffold archetype"
  );
  assert.equal(
    promptOnlyPdpPlan.sectionBlueprint?.layoutContract?.sectionShellFamily,
    "commerce_scaffold"
  );
  assert.equal(
    promptOnlyPdpPlan.sectionBlueprint?.promptContract?.requiresProductContextOrSetting,
    true
  );
  assert.equal(
    promptOnlyPdpPlan.sectionBlueprint?.promptContract?.requiresCommerceActionSignal,
    true
  );
  assert.ok(
    promptOnlyPdpPlan.warnings.some((warning) =>
      warning.toLowerCase().includes("productcontext")
    ),
    "PDP prompt-only plans should warn against fake static commerce markup"
  );

  global.fetch = createGraphqlFetch(homepageJsonFiles);

  const featuredProductPlan = await planThemeEdit(shopifyClient, "2026-01", {
    themeId: 123,
    intent: "new_section",
    template: "homepage",
    query: "Maak een featured product section met prijs, productafbeelding en add-to-cart CTA",
  });
  assert.equal(
    featuredProductPlan.sectionBlueprint?.archetype,
    "featured_product_section",
    "featured product prompts should surface a dedicated product-source contract"
  );
  assert.equal(
    featuredProductPlan.sectionBlueprint?.promptContract?.requiresProductContextOrSetting,
    true
  );
  assert.ok(
    featuredProductPlan.sectionBlueprint?.implementationContract?.renderingRules?.some((entry) =>
      entry.toLowerCase().includes("herhaalbare content") ||
      entry.toLowerCase().includes("product")
    ),
    "featured product plans should expose editor/resource contract guidance"
  );

  const reviewBadgePlan = await planThemeEdit(shopifyClient, "2026-01", {
    themeId: 123,
    intent: "new_section",
    template: "homepage",
    query: "Maak een review badge section met sterren en een korte verified tekst",
  });
  assert.equal(reviewBadgePlan.sectionBlueprint?.archetype, "review_section");
  assert.equal(
    reviewBadgePlan.sectionBlueprint?.promptContract?.requiresBlockBasedCards,
    false,
    "single review/rating badge sections should not be forced into repeatable blocks"
  );

  const existingReviewEditPlan = await planThemeEdit(shopifyClient, "2026-01", {
    themeId: 123,
    intent: "existing_edit",
    targetFile: "sections/testimonials.liquid",
    query: "Verklein alleen de review-card gap op mobiel en laat desktop hetzelfde.",
  });
  assert.equal(existingReviewEditPlan.recommendedFlow, "patch-existing");
  assert.equal(existingReviewEditPlan.changeScope, "micro_patch");
  assert.equal(existingReviewEditPlan.preferredWriteMode, "patch");
  assert.deepEqual(existingReviewEditPlan.nextReadKeys, ["sections/testimonials.liquid"]);

  const newSectionPlan = await planThemeEdit(shopifyClient, "2026-01", {
    themeId: 123,
    intent: "new_section",
    template: "homepage",
    query: "Maak een nieuwe promo section",
  });
  assert.equal(newSectionPlan.recommendedFlow, "create-section");
  assert.equal(newSectionPlan.changeScope, "net_new_generation");
  assert.equal(newSectionPlan.preferredWriteMode, "liquid");
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
  assert.equal(
    newSectionPlan.sectionBlueprint?.category,
    "static",
    "review/testimonial-like new sections should classify as static content by default"
  );
  assert.ok(
    newSectionPlan.nextReadKeys.includes("snippets/section-properties.liquid") &&
      newSectionPlan.nextReadKeys.includes("snippets/button.liquid"),
    "new section planning should surface exact helper snippets so the client can mirror wrappers/helpers in one compact read call"
  );
  assert.ok(
    newSectionPlan.sectionBlueprint?.requiredReads?.some(
      (entry) => entry.key === "sections/testimonials.liquid"
    ),
    "section blueprint should expose required read reasons"
  );
  assert.ok(
    newSectionPlan.sectionBlueprint?.safeUnitStrategy?.typography,
    "section blueprint should expose a safe unit strategy"
  );
  assert.equal(
    newSectionPlan.qualityTarget,
    "theme_consistent",
    "ordinary new-section planning should default to theme-consistent quality"
  );
  assert.ok(
    newSectionPlan.sectionBlueprint?.forbiddenPatterns?.some((entry) =>
      entry.includes("{% javascript %}")
    ),
    "section blueprint should expose forbidden patterns for generic section generation"
  );

  const mediaSectionPlan = await planThemeEdit(shopifyClient, "2026-01", {
    themeId: 123,
    intent: "new_section",
    template: "homepage",
    query: "Maak een hero video slider section",
  });
  assert.ok(
    ["media", "hybrid"].includes(mediaSectionPlan.sectionBlueprint?.category),
    "hero/video-like new sections should be classified as media or hybrid"
  );
  assert.ok(
    mediaSectionPlan.sectionBlueprint?.optionalReads?.some(
      (entry) => entry.key === "layout/theme.liquid"
    ),
    "media and interactive section plans should expose optional global context reads"
  );
  assert.ok(
    mediaSectionPlan.sectionBlueprint?.preflightChecks?.some((entry) =>
      entry.toLowerCase().includes("media")
    ),
    "media plans should surface media-focused preflight checks"
  );
  assert.equal(
    mediaSectionPlan.sectionBlueprint?.archetype,
    "video_slider",
    "video-slider prompts should surface a specific archetype"
  );
  assert.equal(
    mediaSectionPlan.sectionBlueprint?.promptContract?.requiresVideoSourceSetting,
    true,
    "prompt-only video sections should require a merchant-editable video source"
  );
  assert.equal(
    mediaSectionPlan.sectionBlueprint?.promptContract?.requiresVideoRenderablePath,
    true,
    "prompt-only video sections should require a renderable video path"
  );
  assert.equal(
    mediaSectionPlan.sectionBlueprint?.layoutContract?.sectionShellFamily,
    "media_surface",
    "video-slider prompts should keep a media-surface layout contract outside the hero-only shell logic"
  );

  global.fetch = createGraphqlFetch(mediaEditFiles);

  const existingVideoEditPlan = await planThemeEdit(shopifyClient, "2026-01", {
    themeId: 123,
    intent: "existing_edit",
    targetFile: "sections/video-story.liquid",
    query: "Verklein alleen op mobiel de video gap en laat desktop ongewijzigd.",
  });
  assert.equal(existingVideoEditPlan.recommendedFlow, "patch-existing");
  assert.equal(existingVideoEditPlan.changeScope, "micro_patch");
  assert.equal(existingVideoEditPlan.preferredWriteMode, "patch");
  assert.deepEqual(existingVideoEditPlan.nextReadKeys, ["sections/video-story.liquid"]);

  global.fetch = createGraphqlFetch(homepageJsonFiles);

  const promptOnlyReviewPlan = await planThemeEdit(shopifyClient, "2026-01", {
    themeId: 123,
    intent: "new_section",
    template: "homepage",
    query: "Maak een review section met 3 kaarten, klantnamen en sterrenrating",
  });
  assert.equal(
    promptOnlyReviewPlan.sectionBlueprint?.archetype,
    "review_section",
    "prompt-only review prompts without slider language should not collapse to generic content_section"
  );
  assert.equal(
    promptOnlyReviewPlan.sectionBlueprint?.qualityTarget,
    "theme_consistent"
  );
  assert.equal(
    promptOnlyReviewPlan.sectionBlueprint?.layoutContract?.sectionShellFamily,
    "bounded_card_shell"
  );
  assert.equal(
    promptOnlyReviewPlan.sectionBlueprint?.promptContract?.requiresBlockBasedCards,
    true
  );
  assert.equal(
    promptOnlyReviewPlan.sectionBlueprint?.promptContract?.requiresReviewCardSurface,
    true
  );
  assert.ok(
    promptOnlyReviewPlan.sectionBlueprint?.preflightChecks?.some((entry) =>
      entry.toLowerCase().includes("review-card")
    ),
    "prompt-only review plans should expose review-card preflight checks"
  );
  assert.ok(
    promptOnlyReviewPlan.sectionBlueprint?.implementationContract?.schemaRules?.some((entry) =>
      entry.includes("geldige {% schema %} JSON-definitie")
    ),
    "new-section plans should expose a generic schema implementation contract"
  );
  assert.ok(
    promptOnlyReviewPlan.sectionBlueprint?.implementationContract?.editRules?.some((entry) =>
      entry.toLowerCase().includes("patch_scope_too_large")
    ),
    "new-section plans should surface preserve-on-edit rules for later refinements"
  );

  const socialStripPlan = await planThemeEdit(shopifyClient, "2026-01", {
    themeId: 123,
    intent: "new_section",
    template: "homepage",
    query:
      "Maak een Instagram social strip section met uploadbare posts, hover overlay en links",
  });
  assert.ok(
    ["media", "hybrid"].includes(socialStripPlan.sectionBlueprint?.category),
    "social-strip prompts should classify as media-oriented"
  );
  assert.equal(
    socialStripPlan.sectionBlueprint?.archetype,
    "social_strip",
    "Instagram/social prompts without slider language should surface a social_strip archetype"
  );

  const imageSliderPlan = await planThemeEdit(shopifyClient, "2026-01", {
    themeId: 123,
    intent: "new_section",
    template: "homepage",
    query: "Maak een image slider section met drie promo beelden en navigatiepijlen",
  });
  assert.ok(
    ["media", "hybrid"].includes(imageSliderPlan.sectionBlueprint?.category),
    "image-slider prompts should classify as media-oriented"
  );
  assert.equal(
    imageSliderPlan.sectionBlueprint?.archetype,
    "image_slider",
    "image-slider prompts should surface a dedicated image_slider archetype"
  );
  assert.equal(
    imageSliderPlan.sectionBlueprint?.promptContract?.interactionPattern,
    "carousel"
  );
  assert.equal(
    imageSliderPlan.sectionBlueprint?.promptContract?.requiresInteractiveBehavior,
    true
  );

  const logoWallPlan = await planThemeEdit(shopifyClient, "2026-01", {
    themeId: 123,
    intent: "new_section",
    template: "homepage",
    query: "Maak een logo wall section met partnerlogo's en korte intro",
  });
  assert.ok(
    ["media", "hybrid", "static"].includes(logoWallPlan.sectionBlueprint?.category),
    "logo-wall prompts should stay content/media-led instead of being treated as interactive"
  );
  assert.equal(
    logoWallPlan.sectionBlueprint?.archetype,
    "logo_wall",
    "logo-wall prompts should surface a dedicated logo_wall archetype"
  );

  const faqPlan = await planThemeEdit(shopifyClient, "2026-01", {
    themeId: 123,
    intent: "new_section",
    template: "homepage",
    query: "Maak een FAQ collapsible section voor returns en verzending",
  });
  assert.ok(
    ["interactive", "hybrid"].includes(faqPlan.sectionBlueprint?.category),
    "FAQ/collapsible prompts should classify as interactive"
  );
  assert.equal(
    faqPlan.sectionBlueprint?.archetype,
    "faq_collapsible",
    "FAQ prompts should surface a dedicated collapsible archetype"
  );
  assert.equal(
    faqPlan.sectionBlueprint?.promptContract?.interactionPattern,
    "accordion"
  );
  assert.equal(
    faqPlan.sectionBlueprint?.promptContract?.requiresInteractiveBehavior,
    true
  );
  assert.ok(
    faqPlan.sectionBlueprint?.implementationContract?.interactionRules?.some((entry) =>
      entry.toLowerCase().includes("details")
    ),
    "FAQ plans should expose a generic interactive implementation contract"
  );

  const comparisonPlan = await planThemeEdit(shopifyClient, "2026-01", {
    themeId: 123,
    intent: "new_section",
    template: "homepage",
    query: "Maak een comparison table section voor product voordelen",
  });
  assert.ok(
    ["static", "hybrid"].includes(comparisonPlan.sectionBlueprint?.category),
    "comparison-table prompts should remain content-led even when product language introduces extra signals"
  );
  assert.equal(
    comparisonPlan.sectionBlueprint?.archetype,
    "comparison_table",
    "comparison-table prompts should surface a dedicated archetype"
  );

  const exactComparisonReplicaPlan = await planThemeEdit(shopifyClient, "2026-01", {
    themeId: 123,
    intent: "new_section",
    template: "homepage",
    query:
      "Create a new Shopify section in the live theme based on the provided desktop and mobile reference images. It should replicate the comparison layout: left headline and supporting copy, review/rating row, right comparison table card with 'Our Brand' vs 'Others', 5 comparison rows, optional floating sachet image and gluten free badge style elements. Needs responsive desktop and mobile behavior matching the references.",
  });
  assert.equal(
    exactComparisonReplicaPlan.sectionBlueprint?.archetype,
    "comparison_table"
  );
  assert.equal(
    exactComparisonReplicaPlan.sectionBlueprint?.referenceSignals?.hasDesktopMobileReferences,
    true
  );
  assert.equal(
    exactComparisonReplicaPlan.sectionBlueprint?.referenceSignals?.requiresResponsiveViewportParity,
    true
  );
  assert.equal(
    exactComparisonReplicaPlan.sectionBlueprint?.referenceSignals?.requiresDecorativeMediaAnchors,
    true
  );
  assert.equal(
    exactComparisonReplicaPlan.sectionBlueprint?.referenceSignals?.requiresDecorativeBadgeAnchors,
    true
  );
  assert.equal(
    exactComparisonReplicaPlan.sectionBlueprint?.referenceSignals?.requiresRatingStars,
    true
  );
  assert.equal(
    exactComparisonReplicaPlan.sectionBlueprint?.referenceSignals?.requiresComparisonIconography,
    true
  );
  assert.equal(
    exactComparisonReplicaPlan.sectionBlueprint?.referenceSignals?.avoidDoubleSectionShell,
    true
  );
  assert.equal(
    exactComparisonReplicaPlan.sectionBlueprint?.layoutContract?.sectionShellFamily,
    "bounded_card_shell"
  );
  assert.equal(
    exactComparisonReplicaPlan.sectionBlueprint?.layoutContract?.requiresDedicatedInnerCard,
    true,
    "comparison replicas with table-card references should keep a dedicated inner card contract"
  );
  assert.equal(
    exactComparisonReplicaPlan.sectionBlueprint?.referenceSignals?.requiresThemeEditorLifecycleHooks,
    false,
    "comparison-table exact replicas should not demand Theme Editor lifecycle hooks when the archetype is non-interactive"
  );
  assert.ok(
    exactComparisonReplicaPlan.warnings.some((warning) =>
      warning.toLowerCase().includes("badge") ||
      warning.toLowerCase().includes("double") ||
      warning.toLowerCase().includes("ster") ||
      warning.toLowerCase().includes("icon")
    ),
    "exact comparison replica plans should warn about decorative anchors and shell strategy"
  );

  const exactTrustpilotReviewPlan = await planThemeEdit(shopifyClient, "2026-01", {
    themeId: 123,
    intent: "new_section",
    template: "homepage",
    query:
      "Maak deze Trustpilot review slider exact na van de desktop en mobiele screenshots, met pijlen rechtsboven, dezelfde rating cards en aparte desktop/mobile composities.",
  });
  assert.equal(exactTrustpilotReviewPlan.sectionBlueprint?.qualityTarget, "exact_match");
  assert.equal(exactTrustpilotReviewPlan.sectionBlueprint?.archetype, "review_slider");
  assert.equal(
    exactTrustpilotReviewPlan.sectionBlueprint?.referenceSignals?.hasDesktopMobileReferences,
    true
  );
  assert.equal(
    exactTrustpilotReviewPlan.sectionBlueprint?.referenceSignals?.requiresResponsiveViewportParity,
    true
  );
  assert.equal(
    exactTrustpilotReviewPlan.sectionBlueprint?.referenceSignals?.requiresThemeEditorLifecycleHooks,
    true
  );
  assert.equal(
    exactTrustpilotReviewPlan.sectionBlueprint?.referenceSignals?.requiresThemeWrapperMirror,
    true
  );
  assert.equal(
    exactTrustpilotReviewPlan.sectionBlueprint?.referenceSignals?.sectionShellFamily,
    "bounded_card_shell"
  );
  assert.equal(
    exactTrustpilotReviewPlan.sectionBlueprint?.referenceSignals?.requiresNavButtons,
    true
  );
  assert.equal(
    exactTrustpilotReviewPlan.sectionBlueprint?.layoutContract?.requiresDedicatedInnerCard,
    true,
    "review slider replicas with explicit cards should keep a dedicated inner card contract"
  );
  assert.equal(
    exactTrustpilotReviewPlan.sectionBlueprint?.referenceSignals?.previewMediaPolicy,
    "best_effort_demo_media"
  );
  assert.equal(
    exactTrustpilotReviewPlan.sectionBlueprint?.referenceSignals?.avoidDoubleSectionShell,
    true
  );

  const beforeAfterPlan = await planThemeEdit(shopifyClient, "2026-01", {
    themeId: 123,
    intent: "new_section",
    template: "homepage",
    query: "Maak een before/after slider section voor resultaten",
  });
  assert.ok(
    ["interactive", "hybrid"].includes(beforeAfterPlan.sectionBlueprint?.category),
    "before/after prompts should classify as interactive"
  );
  assert.equal(
    beforeAfterPlan.sectionBlueprint?.archetype,
    "before_after",
    "before/after prompts should surface a dedicated archetype"
  );

  const heroBannerPlan = await planThemeEdit(shopifyClient, "2026-01", {
    themeId: 123,
    intent: "new_section",
    template: "homepage",
    query: "Maak een hero banner section met headline, CTA en beeld",
  });
  assert.equal(
    heroBannerPlan.sectionBlueprint?.archetype,
    "hero_banner",
    "hero-banner prompts should surface a dedicated archetype"
  );

  const mediaFirstHeroPlan = await planThemeEdit(shopifyClient, "2026-01", {
    themeId: 123,
    intent: "new_section",
    template: "homepage",
    query:
      "Maak een hero met media-first compositie, background image, overlay layer en headline links",
  });
  assert.equal(
    mediaFirstHeroPlan.sectionBlueprint?.archetype,
    "hero_media_first_overlay",
    "media-first hero prompts should surface a dedicated media-first archetype"
  );
  assert.equal(
    mediaFirstHeroPlan.sectionBlueprint?.layoutContract?.mediaPlacement,
    "background_layer"
  );
  assert.equal(
    mediaFirstHeroPlan.sectionBlueprint?.layoutContract?.contentPlacement,
    "overlay_layer"
  );
  assert.equal(
    mediaFirstHeroPlan.sectionBlueprint?.layoutContract?.sharedMediaSlotRequired,
    true
  );
  assert.equal(
    mediaFirstHeroPlan.sectionBlueprint?.themeWrapperStrategy?.preferredContentWidthLayer,
    "inner_content"
  );

  const fullBleedHeroPlan = await planThemeEdit(shopifyClient, "2026-01", {
    themeId: 123,
    intent: "new_section",
    template: "homepage",
    query:
      "Maak een hero zoals in de screenshot met content links en media visueel rechts, maar als full-width background image met overlay over het hele vlak",
  });
  assert.equal(
    fullBleedHeroPlan.sectionBlueprint?.archetype,
    "hero_full_bleed_media",
    "full-bleed background-media heroes should not collapse into a split archetype just because media appears on the right"
  );
  assert.equal(
    fullBleedHeroPlan.sectionBlueprint?.layoutContract?.outerShell,
    "full_bleed"
  );
  assert.equal(
    fullBleedHeroPlan.sectionBlueprint?.layoutContract?.avoidSplitLayoutAssumption,
    true
  );
  assert.equal(
    fullBleedHeroPlan.sectionBlueprint?.themeWrapperStrategy?.allowOuterThemeContainer,
    false
  );
  assert.equal(
    fullBleedHeroPlan.sectionBlueprint?.referenceSignals?.heroShellFamily,
    "media_first_unboxed"
  );
  assert.equal(
    fullBleedHeroPlan.sectionBlueprint?.referenceSignals?.requiresThemeWrapperMirror,
    false
  );
  assert.ok(
    fullBleedHeroPlan.warnings.some((warning) =>
      warning.toLowerCase().includes("niet automatisch als split")
    ),
    "full-bleed hero plans should warn against split-layout degradation"
  );
  assert.ok(
    fullBleedHeroPlan.warnings.some((warning) =>
      warning.toLowerCase().includes("outer media-shell")
    ),
    "full-bleed hero plans should warn that theme helpers belong on an inner layer"
  );

  const promptOnlyFullBleedHeroPlan = await planThemeEdit(shopifyClient, "2026-01", {
    themeId: 123,
    intent: "new_section",
    template: "homepage",
    query:
      "Maak een edge-to-edge hero banner met tekst over de afbeelding, een donkere overlay en CTA links in beeld",
  });
  assert.equal(
    promptOnlyFullBleedHeroPlan.sectionBlueprint?.archetype,
    "hero_full_bleed_media",
    "prompt-only full-width heroes with text-over-image cues should keep the media-first full-bleed archetype"
  );
  assert.equal(
    promptOnlyFullBleedHeroPlan.sectionBlueprint?.referenceSignals?.heroShellFamily,
    "media_first_unboxed"
  );
  assert.equal(
    promptOnlyFullBleedHeroPlan.sectionBlueprint?.referenceSignals?.requiresThemeWrapperMirror,
    false
  );

  const splitHeroPlan = await planThemeEdit(shopifyClient, "2026-01", {
    themeId: 123,
    intent: "new_section",
    template: "homepage",
    query:
      "Maak een split hero in twee kolommen met content links en beeld rechts",
  });
  assert.equal(
    splitHeroPlan.sectionBlueprint?.archetype,
    "hero_split_layout",
    "explicit two-column hero prompts should surface a split archetype"
  );
  assert.equal(
    splitHeroPlan.sectionBlueprint?.layoutContract?.mediaPlacement,
    "inline_end_column"
  );
  assert.equal(
    splitHeroPlan.sectionBlueprint?.layoutContract?.contentPlacement,
    "inline_start_column"
  );

  const boxedHeroPlan = await planThemeEdit(shopifyClient, "2026-01", {
    themeId: 123,
    intent: "new_section",
    template: "homepage",
    query:
      "Maak een boxed hero section met headline, CTA en beeld in een contained shell",
  });
  assert.equal(
    boxedHeroPlan.sectionBlueprint?.archetype,
    "hero_boxed_shell",
    "boxed hero prompts should surface a bounded-shell archetype"
  );
  assert.equal(
    boxedHeroPlan.sectionBlueprint?.layoutContract?.outerShell,
    "boxed"
  );
  assert.equal(
    boxedHeroPlan.sectionBlueprint?.layoutContract?.contentWidthStrategy,
    "boxed_shell"
  );
  assert.equal(
    boxedHeroPlan.sectionBlueprint?.referenceSignals?.heroShellFamily,
    "boxed"
  );
  assert.equal(
    boxedHeroPlan.sectionBlueprint?.referenceSignals?.requiresThemeWrapperMirror,
    false,
    "boxed heroes should stay bounded via their own layout contract instead of forcing a generic exact-match wrapper mirror"
  );

  const templatePlacementPlan = await planThemeEdit(shopifyClient, "2026-01", {
    themeId: 123,
    intent: "template_placement",
    template: "homepage",
    query: "Plaats de nieuwe section onder testimonials op de homepage",
  });
  assert.equal(
    templatePlacementPlan.recommendedFlow,
    "template-placement",
    "explicit template-placement prompts should stay in the template-placement flow"
  );
  assert.equal(
    templatePlacementPlan.shouldUse,
    "draft-theme-artifact",
    "template placement should route to draft-theme-artifact edit mode"
  );
  assert.equal(
    templatePlacementPlan.architecture.templateFormat,
    "json",
    "homepage placement should target the JSON template when available"
  );
  assert.deepEqual(
    templatePlacementPlan.nextReadKeys,
    ["templates/index.json"],
    "template placement should read only the explicit template file"
  );
  assert.deepEqual(
    templatePlacementPlan.nextWriteKeys,
    ["templates/index.json"],
    "template placement should write only the explicit template file"
  );

  const exactReplicaPlan = await planThemeEdit(shopifyClient, "2026-01", {
    themeId: 123,
    intent: "new_section",
    template: "homepage",
    query: "Maak deze review slider exact na van de screenshot als Trustpilot replica",
  });
  assert.equal(exactReplicaPlan.qualityTarget, "exact_match");
  assert.equal(exactReplicaPlan.generationMode, "precision_first");
  assert.equal(
    exactReplicaPlan.completionPolicy?.deliveryExpectation,
    "final_reference_match_in_first_write"
  );
  assert.equal(
    exactReplicaPlan.completionPolicy?.askBeforeVisualRefinement,
    false
  );
  assert.equal(
    exactReplicaPlan.sectionBlueprint?.completionPolicy
      ?.stagedVisualUpgradeAllowed,
    false
  );
  assert.equal(
    exactReplicaPlan.allowedRefineStrategy,
    "full_rewrite_only",
    "exact-match new sections should discourage patch-batch refinement"
  );
  assert.equal(
    exactReplicaPlan.sectionBlueprint?.writeStrategy?.followUpTool,
    "draft-theme-artifact",
    "exact-match new sections should prefer full rewrite follow-ups"
  );
  assert.equal(
    exactReplicaPlan.sectionBlueprint?.writeStrategy?.disallowPatchBatchRefine,
    true
  );
  assert.equal(
    exactReplicaPlan.sectionBlueprint?.referenceSignals?.previewMediaPolicy,
    "best_effort_demo_media",
    "screenshot-only exact replicas should prefer best-effort demo media when no explicit source assets are provided"
  );
  assert.equal(
    exactReplicaPlan.sectionBlueprint?.referenceSignals?.allowStylizedPreviewFallbacks,
    true
  );
  assert.equal(
    exactReplicaPlan.sectionBlueprint?.referenceSignals?.requiresRenderablePreviewMedia,
    false
  );
  assert.ok(
    exactReplicaPlan.warnings.some((warning) =>
      warning.toLowerCase().includes("replica") ||
      warning.toLowerCase().includes("baseline-first") ||
      warning.toLowerCase().includes("pixel-perfect")
    ),
    "exact-match plans should surface precision-first warnings"
  );

  const exactReplicaWithExplicitMediaPlan = await planThemeEdit(shopifyClient, "2026-01", {
    themeId: 123,
    intent: "new_section",
    template: "homepage",
    query:
      "Maak deze review slider exact na van de screenshot en gebruik de meegeleverde images review-1.jpg review-2.jpg als bronmedia",
  });
  assert.equal(
    exactReplicaWithExplicitMediaPlan.sectionBlueprint?.referenceSignals?.previewMediaPolicy,
    "strict_renderable_media"
  );
  assert.equal(
    exactReplicaWithExplicitMediaPlan.sectionBlueprint?.referenceSignals?.hasExplicitMediaSources,
    true
  );
  assert.equal(
    exactReplicaWithExplicitMediaPlan.sectionBlueprint?.referenceSignals?.requiresRenderablePreviewMedia,
    true,
    "exact replicas with explicit source media should still require renderable preview media in the first write"
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
