const screenshotReplicaPrompt =
  "Create a new Shopify section in the live theme based on the provided desktop and mobile reference images. It should replicate the comparison layout with rating row, decorative badge anchors and responsive desktop/mobile behavior.";

const imageBackedReplicaPrompt =
  "Maak deze reference section exact na van de screenshots en gebruik de meegeleverde images hero-1.jpg hero-2.jpg als bronmedia.";

export const matrixFixtures = [
  {
    id: "dawn-like",
    label: "Dawn-like 2.0 theme",
    themeId: 123,
    promptOnlyQuery: "Maak een nieuwe review section met headline, copy en CTA",
    screenshotReplicaPrompt,
    imageBackedReplicaPrompt,
    files: {
      "templates/index.json": JSON.stringify(
        {
          sections: {
            hero_1: { type: "hero-banner" },
            testimonials_1: { type: "testimonials" },
          },
          order: ["hero_1", "testimonials_1"],
        },
        null,
        2
      ),
      "templates/product.json": JSON.stringify(
        {
          sections: {
            main: { type: "main-product" },
          },
          order: ["main"],
        },
        null,
        2
      ),
      "sections/hero-banner.liquid": `
{% schema %}
{
  "name": "Hero banner",
  "presets": [{ "name": "Hero banner" }]
}
{% endschema %}
<section class="page-width">
  <h1>{{ section.settings.heading }}</h1>
</section>
`,
      "sections/testimonials.liquid": `
<section class="testimonials page-width">
  {% render 'section-properties', section: section %}
  <div class="card-grid rte">Trusted by verified customers</div>
  {% render 'button', label: section.settings.heading %}
</section>
{% schema %}
{
  "name": "Testimonials",
  "settings": [
    { "type": "range", "id": "padding_top", "label": "Padding top", "min": 0, "max": 80, "step": 4, "default": 36 },
    { "type": "range", "id": "padding_bottom", "label": "Padding bottom", "min": 0, "max": 80, "step": 4, "default": 36 },
    { "type": "color", "id": "accent", "label": "Accent", "default": "#111111" }
  ],
  "presets": [{ "name": "Customer quotes" }]
}
{% endschema %}
`,
      "sections/main-product.liquid": `
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
`,
      "snippets/section-properties.liquid": `
<div class="section-properties" data-section-id="{{ section.id }}"></div>
`,
      "snippets/button.liquid": `
<button class="button button--primary">{{ label }}</button>
`,
      "snippets/product-info.liquid": `
{% for block in section.blocks %}
  <div class="product-info__block" {{ block.shopify_attributes }}>
    {% case block.type %}
      {% when 'text' %}
        <p>{{ product.title }}</p>
      {% when 'buy_buttons' %}
        <button>Add to cart</button>
    {% endcase %}
  </div>
{% endfor %}
`,
    },
    expectations: {
      representativeSectionKey: "sections/testimonials.liquid",
      helperReadKeys: ["snippets/section-properties.liquid", "snippets/button.liquid"],
      existingEditTarget: "sections/testimonials.liquid",
      existingEditSearch: "Trusted by verified customers",
      existingEditReplace: "Trusted by thousands of verified customers",
      existingEditTool: "patch-theme-file",
      nativeBlock: {
        recommendedFlow: "multi-file-edit",
        usesThemeBlocks: false,
        sectionKey: "sections/main-product.liquid",
        snippetRendererKeys: ["snippets/product-info.liquid"],
        hasBlockShopifyAttributes: true,
        writeProof: {
          mode: "snippet_renderer",
          blockType: "review_badge",
          blockName: "Review badge",
          settingId: "label",
          settingLabel: "Label",
          defaultLabel: "4.9/5 verified",
          snippetKey: "snippets/product-info.liquid",
          assertionNeedles: ["review_badge", "{{ block.settings.label }}"],
        },
      },
    },
  },
  {
    id: "wrapper-heavy-premium",
    label: "Wrapper-heavy premium theme",
    themeId: 123,
    promptOnlyQuery: "Maak een nieuwe premium story section met copy, media en CTA",
    screenshotReplicaPrompt,
    imageBackedReplicaPrompt,
    files: {
      "templates/index.liquid": `
{% section 'premium-hero' %}
{% section 'brand-story' %}
`,
      "templates/product.json": JSON.stringify(
        {
          sections: {
            main: { type: "premium-product" },
          },
          order: ["main"],
        },
        null,
        2
      ),
      "sections/premium-hero.liquid": `
{% schema %}
{
  "name": "Premium hero",
  "presets": [{ "name": "Premium hero" }]
}
{% endschema %}
<section class="container content-container">{{ section.settings.heading }}</section>
`,
      "sections/brand-story.liquid": `
<section class="brand-story container content-container">
  {% render 'section-properties', section: section %}
  {% render 'surface-shell' %}
  <div class="brand-story__copy rte">Clinically backed ingredients</div>
  {% render 'button', label: section.settings.cta_label %}
</section>
{% schema %}
{
  "name": "Brand story",
  "settings": [
    { "type": "range", "id": "padding_top", "label": "Padding top", "min": 0, "max": 96, "step": 8, "default": 32 },
    { "type": "range", "id": "padding_bottom", "label": "Padding bottom", "min": 0, "max": 96, "step": 8, "default": 32 },
    { "type": "text", "id": "cta_label", "label": "CTA label", "default": "Read more" }
  ],
  "presets": [{ "name": "Brand story" }]
}
{% endschema %}
`,
      "sections/premium-product.liquid": `
<section class="premium-product container">
  {% render 'premium-product-blocks', product: product, section: section %}
</section>
{% schema %}
{
  "name": "Premium product",
  "blocks": [
    { "type": "text", "name": "Text" },
    { "type": "review_badge", "name": "Review badge" },
    { "type": "buy_buttons", "name": "Buy buttons" },
    { "type": "@app" }
  ]
}
{% endschema %}
`,
      "snippets/section-properties.liquid": `
<div class="section-properties" data-section-id="{{ section.id }}"></div>
`,
      "snippets/surface-shell.liquid": `
<div class="surface-shell"></div>
`,
      "snippets/button.liquid": `
<button class="button button--secondary">{{ label }}</button>
`,
      "snippets/premium-product-blocks.liquid": `
{% for block in section.blocks %}
  <article class="premium-product__block" {{ block.shopify_attributes }}>
    {% case block.type %}
      {% when 'text' %}
        <p>{{ product.title }}</p>
      {% when 'review_badge' %}
        <span>4.9/5</span>
      {% when 'buy_buttons' %}
        <button>Shop now</button>
    {% endcase %}
  </article>
{% endfor %}
`,
    },
    expectations: {
      representativeSectionKey: "sections/brand-story.liquid",
      helperReadKeys: [
        "snippets/section-properties.liquid",
        "snippets/button.liquid",
      ],
      existingEditTarget: "sections/brand-story.liquid",
      existingEditSearch: "Clinically backed ingredients",
      existingEditReplace: "Clinically backed ingredients and wrappers",
      existingEditTool: "patch-theme-file",
      nativeBlock: {
        recommendedFlow: "multi-file-edit",
        usesThemeBlocks: false,
        sectionKey: "sections/premium-product.liquid",
        snippetRendererKeys: ["snippets/premium-product-blocks.liquid"],
        hasBlockShopifyAttributes: true,
        writeProof: {
          mode: "snippet_renderer",
          blockType: "benefit_badge",
          blockName: "Benefit badge",
          settingId: "label",
          settingLabel: "Label",
          defaultLabel: "Science backed",
          snippetKey: "snippets/premium-product-blocks.liquid",
          assertionNeedles: ["benefit_badge", "{{ block.settings.label }}"],
        },
      },
    },
  },
  {
    id: "snippet-heavy-product",
    label: "Snippet-heavy product theme",
    themeId: 123,
    promptOnlyQuery: "Maak een nieuwe ingredient story section met headline, copy en CTA",
    screenshotReplicaPrompt,
    imageBackedReplicaPrompt,
    files: {
      "templates/index.json": JSON.stringify(
        {
          sections: {
            hero_1: { type: "brand-hero" },
            story_1: { type: "ingredient-story" },
          },
          order: ["hero_1", "story_1"],
        },
        null,
        2
      ),
      "templates/product.json": JSON.stringify(
        {
          sections: {
            main: { type: "main-product" },
          },
          order: ["main"],
        },
        null,
        2
      ),
      "sections/brand-hero.liquid": `
{% schema %}
{
  "name": "Brand hero",
  "presets": [{ "name": "Brand hero" }]
}
{% endschema %}
<section>{{ section.settings.heading }}</section>
`,
      "sections/ingredient-story.liquid": `
<section class="ingredient-story page-width">
  {% render 'section-properties', section: section %}
  {% render 'eyebrow', text: 'Digestive support' %}
  <div class="rte">{{ section.settings.heading }}</div>
  {% render 'button', label: section.settings.button_label %}
</section>
{% schema %}
{
  "name": "Ingredient story",
  "settings": [
    { "type": "range", "id": "padding_top", "label": "Padding top", "min": 0, "max": 80, "step": 4, "default": 32 },
    { "type": "range", "id": "padding_bottom", "label": "Padding bottom", "min": 0, "max": 80, "step": 4, "default": 32 },
    { "type": "text", "id": "button_label", "label": "Button label", "default": "Explore ingredients" }
  ],
  "presets": [{ "name": "Ingredient story" }]
}
{% endschema %}
`,
      "sections/main-product.liquid": `
<section class="main-product">
  {% render 'product-sections', product: product, section: section %}
  {% render 'price-list', product: product %}
</section>
{% schema %}
{
  "name": "Main product",
  "blocks": [
    { "type": "text", "name": "Text" },
    { "type": "benefit_badge", "name": "Benefit badge" },
    { "type": "buy_buttons", "name": "Buy buttons" }
  ]
}
{% endschema %}
`,
      "snippets/section-properties.liquid": `
<div class="section-properties" data-section-id="{{ section.id }}"></div>
`,
      "snippets/eyebrow.liquid": `
{% doc %}
  @param {string} text
{% enddoc %}
<span class="eyebrow__text">Digestive support</span>
`,
      "snippets/button.liquid": `
<button class="button">{{ label }}</button>
`,
      "snippets/price-list.liquid": `
<div class="price-list">{{ product.price | money }}</div>
`,
      "snippets/product-sections.liquid": `
{% for block in section.blocks %}
  <div class="product-sections__block" {{ block.shopify_attributes }}>
    {% case block.type %}
      {% when 'text' %}
        <p>{{ product.title }}</p>
      {% when 'benefit_badge' %}
        <span>Digestive comfort</span>
      {% when 'buy_buttons' %}
        <button>Add to cart</button>
    {% endcase %}
  </div>
{% endfor %}
`,
    },
    expectations: {
      representativeSectionKey: "sections/ingredient-story.liquid",
      helperReadKeys: ["snippets/section-properties.liquid", "snippets/button.liquid"],
      existingEditTarget: "snippets/eyebrow.liquid",
      existingEditSearch: "Digestive support",
      existingEditReplace: "Digestive support plus comfort",
      existingEditTool: "patch-theme-file",
      nativeBlock: {
        recommendedFlow: "multi-file-edit",
        usesThemeBlocks: false,
        sectionKey: "sections/main-product.liquid",
        snippetRendererKeys: ["snippets/product-sections.liquid"],
        disallowedReadKeys: ["snippets/price-list.liquid"],
        hasBlockShopifyAttributes: true,
        writeProof: {
          mode: "snippet_renderer",
          blockType: "review_badge",
          blockName: "Review badge",
          settingId: "label",
          settingLabel: "Label",
          defaultLabel: "Verified comfort",
          snippetKey: "snippets/product-sections.liquid",
          assertionNeedles: ["review_badge", "{{ block.settings.label }}"],
        },
      },
    },
  },
  {
    id: "editor-heavy-theme-blocks",
    label: "Editor-heavy app-block theme",
    themeId: 123,
    promptOnlyQuery: "Maak een nieuwe editor story section met copy, media en CTA",
    screenshotReplicaPrompt,
    imageBackedReplicaPrompt,
    files: {
      "templates/index.json": JSON.stringify(
        {
          sections: {
            hero_1: { type: "editorial-hero" },
            story_1: { type: "editor-story" },
          },
          order: ["hero_1", "story_1"],
        },
        null,
        2
      ),
      "templates/product.json": JSON.stringify(
        {
          sections: {
            main: { type: "main-product" },
          },
          order: ["main"],
        },
        null,
        2
      ),
      "sections/editorial-hero.liquid": `
{% schema %}
{
  "name": "Editorial hero",
  "presets": [{ "name": "Editorial hero" }]
}
{% endschema %}
<section>{{ section.settings.heading }}</section>
`,
      "sections/editor-story.liquid": `
<section class="editor-story page-width">
  {% render 'section-properties', section: section %}
  <div class="rte">Editorial product story</div>
  {% render 'button', label: section.settings.button_label %}
</section>
{% schema %}
{
  "name": "Editor story",
  "settings": [
    { "type": "range", "id": "padding_top", "label": "Padding top", "min": 0, "max": 80, "step": 4, "default": 28 },
    { "type": "range", "id": "padding_bottom", "label": "Padding bottom", "min": 0, "max": 80, "step": 4, "default": 28 },
    { "type": "text", "id": "button_label", "label": "Button label", "default": "Learn more" }
  ],
  "presets": [{ "name": "Editor story" }]
}
{% endschema %}
`,
      "sections/main-product.liquid": `
<section class="editor-product">
  {% content_for 'blocks' %}
</section>
{% schema %}
{
  "name": "Main product",
  "blocks": [
    { "type": "@theme" },
    { "type": "@app" }
  ]
}
{% endschema %}
`,
      "blocks/review-badge.liquid": `
{% doc %}
  @example
  {% content_for 'block', type: 'review-badge', id: 'review-badge' %}
{% enddoc %}
<div class="review-badge">{{ block.settings.label }}</div>
{% schema %}
{
  "name": "Review badge",
  "settings": [
    { "type": "text", "id": "label", "label": "Label", "default": "4.9/5" }
  ]
}
{% endschema %}
`,
      "snippets/section-properties.liquid": `
<div class="section-properties" data-section-id="{{ section.id }}"></div>
`,
      "snippets/button.liquid": `
<button class="button button--tertiary">{{ label }}</button>
`,
    },
    expectations: {
      representativeSectionKey: "sections/editor-story.liquid",
      helperReadKeys: ["snippets/section-properties.liquid", "snippets/button.liquid"],
      existingEditTarget: "sections/editor-story.liquid",
      existingEditSearch: "Editorial product story",
      existingEditReplace: "Editorial product story with app blocks",
      existingEditTool: "patch-theme-file",
      nativeBlock: {
        recommendedFlow: "multi-file-edit",
        usesThemeBlocks: true,
        sectionKey: "sections/main-product.liquid",
        snippetRendererKeys: [],
        hasBlockShopifyAttributes: null,
        writeProof: {
          mode: "theme_block",
          blockKey: "blocks/review-badge.liquid",
          settingId: "subcopy",
          settingLabel: "Subcopy",
          defaultLabel: "Backed by verified reviews",
          assertionNeedles: ["review-badge__subcopy", "\"id\": \"subcopy\""],
        },
      },
    },
  },
];
