import test from "node:test";
import assert from "node:assert";
import {
  buildCodegenContract,
  inferSectionKind,
  inferValidationProfile,
  preflightSectionLiquid,
} from "../src/lib/themeCodegenContract.js";
import {
  inspectSectionGenerationRecipePreflight,
} from "../src/lib/themeSectionContext.js";

const section = ({ body = "<section>Ok</section>", schema }) => `
${body}
{% schema %}
${schema}
{% endschema %}
`;

const validSchema = `{
  "name": "Codegen test",
  "settings": [
    { "type": "text", "id": "heading", "label": "Heading", "default": "Hello" }
  ],
  "presets": [{ "name": "Codegen test" }]
}`;

const validSection = (body = "<section>Ok</section>") =>
  section({ body, schema: validSchema });

const codes = (result) => [
  ...(result.issues || []),
  ...(result.warnings || []),
].map((issue) => issue.code || issue.issueCode);

test("themeCodegenContract - infers profile and section kind conservatively", () => {
  assert.equal(
    inferValidationProfile({
      intent: "existing_edit",
      mode: "edit",
      changeScope: "micro_patch",
      preferredWriteMode: "patch",
    }),
    "syntax_only"
  );
  assert.equal(
    inferValidationProfile({ intent: "new_section", mode: "create" }),
    "production_visual"
  );
  assert.equal(
    inferValidationProfile({ requestText: "pixel perfect screenshot replica" }),
    "exact_replica"
  );
  assert.equal(
    inferValidationProfile({ intent: "existing_edit", mode: "edit" }),
    "theme_safe"
  );
  assert.equal(
    inferSectionKind({ requestText: "Create a Trustpilot review carousel" }),
    "review_carousel"
  );
  assert.equal(
    inferSectionKind({ requestText: "Build a product comparison table" }),
    "comparison"
  );
});

test("themeCodegenContract - planner contract includes compact prompt block", () => {
  const contract = buildCodegenContract({
    intent: "new_section",
    mode: "create",
    targetFile: "sections/reviews.liquid",
    requestText: "review carousel",
  });

  assert.equal(contract.version, "2026-04-30");
  assert.equal(contract.validationProfile, "production_visual");
  assert.equal(contract.sectionKind, "review_carousel");
  assert.match(contract.promptBlock, /CODEGEN CONTRACT/);
  assert.match(contract.promptBlock, /profile=production_visual/);
});

test("themeCodegenContract - schema JSON must be valid", () => {
  const result = preflightSectionLiquid(
    section({ schema: `{ "name": "Broken", }` }),
    { mode: "create", validationProfile: "syntax_only" }
  );

  assert.equal(result.ok, false);
  assert.ok(codes(result).includes("schema_invalid_json"));
});

test("themeCodegenContract - schema setting ids must be unique", () => {
  const result = preflightSectionLiquid(
    section({
      schema: `{
        "name": "Duplicate ids",
        "settings": [
          { "type": "text", "id": "heading", "label": "Heading" },
          { "type": "text", "id": "heading", "label": "Heading 2" }
        ],
        "presets": [{ "name": "Duplicate ids" }]
      }`,
    }),
    { mode: "create", validationProfile: "syntax_only" }
  );

  assert.equal(result.ok, false);
  assert.ok(codes(result).includes("schema_duplicate_setting_id"));
});

test("themeCodegenContract - merchant-editable settings need labels", () => {
  const result = preflightSectionLiquid(
    section({
      schema: `{
        "name": "Missing label",
        "settings": [
          { "type": "text", "id": "heading", "default": "Hello" }
        ],
        "presets": [{ "name": "Missing label" }]
      }`,
    }),
    { validationProfile: "syntax_only" }
  );

  assert.equal(result.ok, false);
  assert.ok(codes(result).includes("schema_missing_setting_label"));
});

test("themeCodegenContract - invalid range defaults are blocked", () => {
  const result = preflightSectionLiquid(
    section({
      schema: `{
        "name": "Bad range",
        "settings": [
          { "type": "range", "id": "gap", "label": "Gap", "min": 0, "max": 10, "step": 2, "default": 11 }
        ],
        "presets": [{ "name": "Bad range" }]
      }`,
    }),
    { validationProfile: "syntax_only" }
  );

  assert.equal(result.ok, false);
  assert.ok(codes(result).includes("schema_range_default_out_of_bounds"));
});

test("themeCodegenContract - two-value ranges suggest select settings", () => {
  const result = preflightSectionLiquid(
    section({
      schema: `{
        "name": "Small range",
        "settings": [
          { "type": "range", "id": "columns", "label": "Columns", "min": 1, "max": 2, "step": 1, "default": 1 }
        ],
        "presets": [{ "name": "Small range" }]
      }`,
    }),
    { validationProfile: "syntax_only" }
  );
  const issue = result.issues.find(
    (entry) => entry.code === "schema_range_should_be_select"
  );

  assert.ok(issue);
  assert.equal(issue.suggestedReplacement.type, "select");
});

test("themeCodegenContract - presets are required", () => {
  const result = preflightSectionLiquid(
    section({
      schema: `{
        "name": "No preset",
        "settings": [
          { "type": "text", "id": "heading", "label": "Heading" }
        ]
      }`,
    }),
    { mode: "create", validationProfile: "syntax_only" }
  );

  assert.equal(result.ok, false);
  assert.ok(codes(result).includes("schema_missing_presets"));
});

test("themeCodegenContract - preset block types must exist", () => {
  const result = preflightSectionLiquid(
    section({
      schema: `{
        "name": "Bad preset block",
        "blocks": [
          { "type": "review", "name": "Review", "settings": [] }
        ],
        "presets": [
          { "name": "Bad preset block", "blocks": [{ "type": "slide" }] }
        ]
      }`,
    }),
    { validationProfile: "syntax_only" }
  );

  assert.equal(result.ok, false);
  assert.ok(codes(result).includes("schema_preset_block_type_missing"));
});

test("themeCodegenContract - Liquid inside stylesheet fails", () => {
  const result = preflightSectionLiquid(
    validSection(`
      {% stylesheet %}
        #shopify-section-{{ section.id }} .x { color: red; }
      {% endstylesheet %}
    `),
    { validationProfile: "theme_safe" }
  );

  assert.equal(result.ok, false);
  assert.ok(codes(result).includes("css_liquid_inside_stylesheet"));
});

test("themeCodegenContract - production visual CSS must be section-scoped", () => {
  const result = preflightSectionLiquid(
    validSection(`
      <style>.reviews { display: grid; gap: 24px; }</style>
      <section class="reviews">Reviews</section>
    `),
    { validationProfile: "production_visual" }
  );

  assert.equal(result.ok, false);
  assert.ok(codes(result).includes("css_missing_section_scope"));
});

test("themeCodegenContract - unstable mobile carousel width fails only visual profiles", () => {
  const liquid = validSection(`
    <style>
      #shopify-section-{{ section.id }} .review-carousel__track {
        display: grid;
        gap: 16px;
        padding: 16px;
        border-radius: 12px;
        grid-auto-flow: column;
        grid-auto-columns: 88%;
        overflow-x: auto;
        scroll-snap-type: x mandatory;
      }
      @media screen and (max-width: 749px) {
        #shopify-section-{{ section.id }} .review-carousel__track { grid-auto-columns: 88%; }
      }
    </style>
    <section class="review-carousel"><div class="review-carousel__track"></div></section>
  `);

  const visual = preflightSectionLiquid(liquid, {
    validationProfile: "production_visual",
    requestText: "review carousel",
  });
  const syntaxOnly = preflightSectionLiquid(liquid, {
    validationProfile: "syntax_only",
    requestText: "review carousel",
  });

  assert.equal(visual.ok, false);
  assert.ok(codes(visual).includes("visual_unstable_mobile_carousel_width"));
  assert.equal(syntaxOnly.ok, true);
  assert.ok(!codes(syntaxOnly).includes("visual_unstable_mobile_carousel_width"));
});

test("themeCodegenContract - interactive carousel JS needs Theme Editor lifecycle", () => {
  const result = preflightSectionLiquid(
    validSection(`
      <style>
        #shopify-section-{{ section.id }} .review-carousel__track {
          display: grid;
          gap: 16px;
          padding: 16px;
          border-radius: 12px;
          grid-auto-flow: column;
          grid-auto-columns: minmax(240px, 86%);
          overflow-x: auto;
          scroll-snap-type: x mandatory;
        }
        @media screen and (max-width: 749px) {
          #shopify-section-{{ section.id }} .review-carousel__track { grid-auto-columns: minmax(240px, 86%); }
        }
      </style>
      <section class="review-carousel" data-section-root>
        <button type="button" data-prev>Prev</button>
        <div class="review-carousel__track"></div>
      </section>
      <script>
        const root = document.currentScript.closest('[data-section-root]');
        root.querySelector('[data-prev]').addEventListener('click', () => {
          root.querySelector('.review-carousel__track').scrollBy({ left: -240, behavior: 'smooth' });
        });
      </script>
    `),
    { validationProfile: "production_visual", requestText: "review carousel" }
  );

  assert.equal(result.ok, false);
  assert.ok(codes(result).includes("js_missing_theme_editor_lifecycle"));
});

test("themeCodegenContract - unscoped document selectors fail for visual JS", () => {
  const result = preflightSectionLiquid(
    validSection(`
      <style>
        #shopify-section-{{ section.id }} .tabs { display: grid; }
        @media screen and (max-width: 749px) { #shopify-section-{{ section.id }} .tabs { display: block; } }
      </style>
      <section class="tabs"><button type="button">Open</button></section>
      <script>
        document.querySelector('.tabs button').addEventListener('click', () => {});
      </script>
    `),
    { validationProfile: "production_visual", requestText: "interactive tabs" }
  );

  assert.equal(result.ok, false);
  assert.ok(codes(result).includes("js_unscoped_selector"));
});

test("themeCodegenContract - scoped custom element with lifecycle passes", () => {
  const result = preflightSectionLiquid(
    section({
      body: `
      <style>
        #shopify-section-{{ section.id }} .review-carousel__track {
          display: grid;
          gap: 16px;
          padding: 16px;
          border-radius: 12px;
          grid-auto-flow: column;
          grid-auto-columns: minmax(240px, 86%);
          overflow-x: auto;
          scroll-snap-type: x mandatory;
        }
        @media screen and (max-width: 749px) {
          #shopify-section-{{ section.id }} .review-carousel__track { grid-auto-columns: minmax(240px, 86%); }
        }
      </style>
      <review-carousel class="review-carousel" data-section-root>
        <button type="button" data-next aria-label="Next review">Next</button>
        <div class="review-carousel__track">
          {% for block in section.blocks %}
            <article data-section-review-item {{ block.shopify_attributes }}>
              <blockquote>{{ block.settings.quote }}</blockquote>
              <p>{{ block.settings.author }}</p>
            </article>
          {% endfor %}
        </div>
      </review-carousel>
      <script>
        if (!customElements.get('review-carousel')) {
          customElements.define('review-carousel', class extends HTMLElement {
            connectedCallback() {
              const track = this.querySelector('.review-carousel__track');
              this.querySelector('[data-next]').addEventListener('click', () => {
                track.scrollBy({ left: 280, behavior: 'smooth' });
              });
            }
          });
        }
      </script>
    `,
      schema: `{
        "name": "Review carousel",
        "blocks": [
          {
            "type": "review",
            "name": "Review",
            "settings": [
              { "type": "textarea", "id": "quote", "label": "Quote", "default": "Great service." },
              { "type": "text", "id": "author", "label": "Author", "default": "Customer" }
            ]
          }
        ],
        "presets": [
          { "name": "Review carousel", "blocks": [{ "type": "review" }] }
        ]
      }`,
    }),
    { validationProfile: "production_visual", requestText: "review carousel" }
  );

  assert.equal(result.ok, true);
});

test("themeCodegenContract - exact replica uses stricter profile", () => {
  const result = preflightSectionLiquid(
    validSection(`<section class="reviews">Reviews</section>`),
    { requestText: "pixel perfect screenshot replica review carousel" }
  );

  assert.equal(result.validationProfile, "exact_replica");
  assert.equal(result.sectionKind, "review_carousel");
  assert.ok(codes(result).includes("visual_missing_responsive_strategy"));
});

const recipeCodes = (result) =>
  [...(result.issues || []), ...(result.warnings || [])].map(
    (issue) => issue.issueCode || issue.code
  );

const contentWidthRecipeContext = {
  sectionBlueprint: {
    generationRecipe: {
      desktopMobileLayoutRequirements: { requiresContentWidthWrapper: true },
    },
  },
  themeContext: { usesPageWidth: true },
};

test("themeCodegenContract - custom bounded shell CSS passes recipe preflight without theme classes", () => {
  const result = inspectSectionGenerationRecipePreflight(
    validSection(`
      <style>
        #shopify-section-{{ section.id }} .custom-section__inner {
          width: min(1120px, calc(100vw - 32px));
          max-width: 1120px;
          margin-inline: auto;
        }
      </style>
      <section class="custom-section">
        <div class="custom-section__inner">Content</div>
      </section>
    `),
    "sections/custom-bounded.liquid",
    contentWidthRecipeContext
  );

  assert.ok(!recipeCodes(result).includes("section_recipe_missing_theme_container"));
});

test("themeCodegenContract - data-section-bounded-shell passes recipe preflight", () => {
  const result = inspectSectionGenerationRecipePreflight(
    validSection(`
      <section class="custom-section">
        <div data-section-bounded-shell>Content</div>
      </section>
    `),
    "sections/custom-bounded-marker.liquid",
    contentWidthRecipeContext
  );

  assert.ok(!recipeCodes(result).includes("section_recipe_missing_theme_container"));
});

test("themeCodegenContract - full-width media shell with inner bounded content passes", () => {
  const result = inspectSectionGenerationRecipePreflight(
    validSection(`
      <style>
        #shopify-section-{{ section.id }} .hero-shell { width: 100%; }
        #shopify-section-{{ section.id }} .hero-shell__content {
          width: clamp(280px, calc(100vw - 40px), 1180px);
          max-width: 1180px;
          margin-left: auto;
          margin-right: auto;
        }
      </style>
      <section class="hero-shell">
        <div class="hero-shell__media"></div>
        <div class="hero-shell__content">Hero copy</div>
      </section>
    `),
    "sections/full-width-inner-bounded.liquid",
    contentWidthRecipeContext
  );

  assert.ok(!recipeCodes(result).includes("section_recipe_missing_theme_container"));
});

test("themeCodegenContract - hero with rating badge and logo marquee is not a review section", () => {
  const requestText =
    "Create a hero with background image, overlay, heading, CTA, star rating badge, arrow, and logo marquee";
  const contract = buildCodegenContract({
    intent: "new_section",
    mode: "create",
    requestText,
  });

  assert.equal(inferSectionKind({ requestText }), "hero_with_logo_marquee");
  assert.equal(contract.sectionKind, "hero_with_logo_marquee");
  assert.equal(contract.interactionKind, "marquee");
  assert.equal(contract.blockModel, "logos");
  assert.match(contract.promptBlock, /data-section-bounded-shell/);
  assert.match(contract.promptBlock, /data-section-logo-item/);
  assert.ok(!contract.promptBlock.includes("author_or_name"));
});

test("themeCodegenContract - logo marquee blocks do not require review author or rating settings", () => {
  const result = preflightSectionLiquid(
    section({
      body: `
        <style>
          #shopify-section-{{ section.id }} .logo-marquee { overflow: hidden; }
          #shopify-section-{{ section.id }} .logo-marquee__track { display: flex; gap: 24px; animation: marquee 18s linear infinite; }
          @media screen and (max-width: 749px) { #shopify-section-{{ section.id }} .logo-marquee__track { gap: 16px; } }
        </style>
        <section class="logo-marquee" data-section-marquee>
          <div class="logo-marquee__track">
            {% for block in section.blocks %}
              <span data-section-logo-item {{ block.shopify_attributes }}>{{ block.settings.logo_text }}</span>
            {% endfor %}
          </div>
        </section>
      `,
      schema: `{
        "name": "Logo marquee",
        "blocks": [
          {
            "type": "logo",
            "name": "Logo",
            "settings": [
              { "type": "text", "id": "logo_text", "label": "Logo text", "default": "Press" }
            ]
          }
        ],
        "presets": [
          { "name": "Logo marquee", "blocks": [{ "type": "logo" }] }
        ]
      }`,
    }),
    { validationProfile: "production_visual", requestText: "logo marquee" }
  );

  assert.equal(result.ok, true);
  assert.ok(!codes(result).some((code) => /author|rating|review/.test(code)));
});

test("themeCodegenContract - static hero with logo marquee does not require slide blocks", () => {
  const contract = buildCodegenContract({
    intent: "new_section",
    mode: "create",
    requestText: "static hero with one background image, CTA, rating badge, and logo marquee",
  });

  assert.equal(contract.sectionKind, "hero_with_logo_marquee");
  assert.equal(contract.interactionKind, "marquee");
  assert.equal(contract.blockModel, "logos");
  assert.notEqual(contract.blockModel, "slides");
});

test("themeCodegenContract - hero slider request declares slide block architecture", () => {
  const contract = buildCodegenContract({
    intent: "new_section",
    mode: "create",
    requestText: "hero slider with multiple background images, headings, text, CTA buttons, arrows and dots",
  });

  assert.equal(contract.sectionKind, "hero_slider");
  assert.equal(contract.interactionKind, "slider");
  assert.equal(contract.blockModel, "slides");
  assert.equal(contract.mediaModel, "block_level_media");
  assert.ok(contract.architecture.requiredBlockSettings.slide.includes("image"));
});

test("themeCodegenContract - hero slider with logo marquee declares mixed block roles", () => {
  const contract = buildCodegenContract({
    intent: "new_section",
    mode: "create",
    requestText: "hero slider with multiple background images and a publication logo marquee",
  });

  assert.equal(contract.sectionKind, "hero_slider_with_logo_marquee");
  assert.equal(contract.interactionKind, "slider_and_marquee");
  assert.equal(contract.blockModel, "mixed_blocks");
  assert.deepEqual(contract.architecture.blockRoles.sort(), ["logo", "slide"]);
});

const heroSlideBlockSchema = `{
  "type": "slide",
  "name": "Slide",
  "settings": [
    { "type": "image_picker", "id": "image", "label": "Image" },
    { "type": "text", "id": "heading", "label": "Heading", "default": "Hero" },
    { "type": "textarea", "id": "text", "label": "Text", "default": "Copy" },
    { "type": "text", "id": "button_text", "label": "Button text", "default": "Shop now" },
    { "type": "url", "id": "button_link", "label": "Button link" }
  ]
}`;

const heroSliderSchema = `{
  "name": "Hero slider",
  "blocks": [
    ${heroSlideBlockSchema}
  ],
  "presets": [{ "name": "Hero slider", "blocks": [{ "type": "slide" }] }]
}`;

test("themeCodegenContract - slider_controls contract fails if buttons do not change slides", () => {
  const result = preflightSectionLiquid(
    section({
      body: `
        <style>
          #shopify-section-{{ section.id }} .hero-slider__track {
            display: grid;
            grid-auto-flow: column;
            grid-auto-columns: minmax(280px, 100%);
            overflow-x: auto;
            scroll-snap-type: x mandatory;
          }
          @media screen and (max-width: 749px) { #shopify-section-{{ section.id }} .hero-slider__track { grid-auto-columns: minmax(260px, 100%); } }
        </style>
        <section class="hero-slider" data-section-slider>
          <button type="button" data-prev aria-label="Previous slide">Prev</button>
          <div class="hero-slider__track">
            {% for block in section.blocks %}
              <article data-section-slide {{ block.shopify_attributes }}>
                {% if block.settings.image != blank %}
                  {{ block.settings.image | image_url: width: 1600 | image_tag }}
                {% endif %}
                <h2>{{ block.settings.heading }}</h2>
                <p>{{ block.settings.text }}</p>
                <a href="{{ block.settings.button_link }}">{{ block.settings.button_text }}</a>
              </article>
            {% endfor %}
          </div>
        </section>
      `,
      schema: heroSliderSchema,
    }),
    {
      validationProfile: "production_visual",
      requestText: "hero slider with arrows",
    }
  );

  assert.equal(result.ok, false);
  assert.ok(codes(result).includes("visual_carousel_controls_not_wired"));
});

test("themeCodegenContract - decorative arrow contract does not require slide blocks", () => {
  const result = preflightSectionLiquid(
    validSection(`
      <style>
        #shopify-section-{{ section.id }} .hero { display: grid; gap: 16px; }
        @media screen and (max-width: 749px) { #shopify-section-{{ section.id }} .hero { padding: 24px; } }
      </style>
      <section class="hero">
        <h2>Hero</h2>
        <a href="/collections/all">Shop <span aria-hidden="true">&rarr;</span></a>
      </section>
    `),
    {
      validationProfile: "production_visual",
      requestText: "static hero with CTA and decorative arrow",
    }
  );

  assert.equal(result.ok, true);
  assert.ok(!codes(result).includes("architecture_missing_slide_blocks"));
});

test("themeCodegenContract - marquee interaction does not require slider controls", () => {
  const result = preflightSectionLiquid(
    section({
      body: `
        <style>
          #shopify-section-{{ section.id }} .logo-marquee__track { display: flex; gap: 20px; animation: marquee 20s linear infinite; }
          @media screen and (max-width: 749px) { #shopify-section-{{ section.id }} .logo-marquee__track { gap: 14px; } }
        </style>
        <section class="logo-marquee" data-section-marquee>
          <div class="logo-marquee__track">
            {% for block in section.blocks %}
              <span data-section-logo-item {{ block.shopify_attributes }}>{{ block.settings.logo_text }}</span>
            {% endfor %}
          </div>
        </section>
      `,
      schema: `{
        "name": "Logo marquee",
        "blocks": [
          { "type": "logo", "name": "Logo", "settings": [
            { "type": "text", "id": "logo_text", "label": "Logo text", "default": "Brand" }
          ] }
        ],
        "presets": [{ "name": "Logo marquee", "blocks": [{ "type": "logo" }] }]
      }`,
    }),
    { validationProfile: "production_visual", requestText: "logo marquee" }
  );

  assert.equal(result.ok, true);
  assert.ok(!codes(result).includes("architecture_slider_controls_missing_buttons"));
});

test("themeCodegenContract - mixed block sections validate slide and logo roles independently", () => {
  const result = preflightSectionLiquid(
    section({
      body: `
        <style>
          #shopify-section-{{ section.id }} .mixed-hero__track {
            display: grid;
            grid-auto-flow: column;
            grid-auto-columns: minmax(280px, 100%);
            overflow-x: auto;
            scroll-snap-type: x mandatory;
          }
          #shopify-section-{{ section.id }} .mixed-hero__logos { display: flex; gap: 20px; }
          @media screen and (max-width: 749px) { #shopify-section-{{ section.id }} .mixed-hero__logos { gap: 12px; } }
        </style>
        <section class="mixed-hero" data-section-slider data-section-marquee>
          <button type="button" data-next aria-label="Next slide">Next</button>
          <div class="mixed-hero__track" data-slider-track>
            {% for block in section.blocks %}
              {% if block.type == 'slide' %}
                <article data-section-slide {{ block.shopify_attributes }}>
                  {% if block.settings.image != blank %}
                    {{ block.settings.image | image_url: width: 1600 | image_tag }}
                  {% endif %}
                  <h2>{{ block.settings.heading }}</h2>
                  <p>{{ block.settings.text }}</p>
                  <a href="{{ block.settings.button_link }}">{{ block.settings.button_text }}</a>
                </article>
              {% elsif block.type == 'logo' %}
                <span data-section-logo-item {{ block.shopify_attributes }}>{{ block.settings.logo_text }}</span>
              {% endif %}
            {% endfor %}
          </div>
          <div class="mixed-hero__logos" aria-hidden="true"></div>
        </section>
        <script>
          const root = document.currentScript.closest('[data-section-slider]');
          root.querySelector('[data-next]').addEventListener('click', () => {
            root.querySelector('[data-slider-track]').scrollBy({ left: 320, behavior: 'smooth' });
          });
          document.addEventListener('shopify:section:load', () => {});
        </script>
      `,
      schema: `{
        "name": "Hero slider with logos",
        "blocks": [
          ${heroSlideBlockSchema},
          { "type": "logo", "name": "Logo", "settings": [
            { "type": "text", "id": "logo_text", "label": "Logo text", "default": "Press" }
          ] }
        ],
        "presets": [{ "name": "Hero slider with logos", "blocks": [{ "type": "slide" }, { "type": "logo" }] }]
      }`,
    }),
    {
      validationProfile: "production_visual",
      requestText: "hero slider with multiple background images and logo marquee",
    }
  );

  assert.equal(result.ok, true);
});

test("themeCodegenContract - testimonial slider requires review fields", () => {
  const result = preflightSectionLiquid(
    section({
      body: `
        <style>
          #shopify-section-{{ section.id }} .testimonial__track {
            display: grid;
            grid-auto-flow: column;
            grid-auto-columns: minmax(280px, 80%);
            overflow-x: auto;
            scroll-snap-type: x mandatory;
          }
          @media screen and (max-width: 749px) { #shopify-section-{{ section.id }} .testimonial__track { grid-auto-columns: minmax(260px, 86%); } }
        </style>
        <section class="testimonial" data-section-slider>
          <button type="button" data-next aria-label="Next testimonial">Next</button>
          <div class="testimonial__track">
            {% for block in section.blocks %}
              <article data-section-review-item {{ block.shopify_attributes }}>{{ block.settings.quote }}</article>
            {% endfor %}
          </div>
          <script>
            const root = document.currentScript.closest('[data-section-slider]');
            root.querySelector('[data-next]').addEventListener('click', () => root.querySelector('.testimonial__track').scrollBy({ left: 320 }));
            document.addEventListener('shopify:section:load', () => {});
          </script>
        </section>
      `,
      schema: `{
        "name": "Testimonial slider",
        "blocks": [
          { "type": "testimonial", "name": "Testimonial", "settings": [
            { "type": "textarea", "id": "quote", "label": "Quote", "default": "Great." }
          ] }
        ],
        "presets": [{ "name": "Testimonial slider", "blocks": [{ "type": "testimonial" }] }]
      }`,
    }),
    {
      validationProfile: "production_visual",
      requestText: "testimonial slider with customer quotes",
    }
  );

  assert.equal(result.ok, false);
  assert.ok(codes(result).includes("architecture_review_missing_author_or_name"));
});

test("themeCodegenContract - syntax_only profile skips visual architecture checks", () => {
  const result = preflightSectionLiquid(
    section({
      body: `
        <section class="hero-slider" data-section-slider>
          <button type="button" data-next>Next</button>
        </section>
      `,
      schema: heroSliderSchema,
    }),
    {
      validationProfile: "syntax_only",
      requestText: "hero slider with arrows",
      changeScope: "micro_patch",
    }
  );

  assert.equal(result.ok, true);
  assert.ok(!codes(result).some((code) => code.startsWith("architecture_")));
  assert.ok(!codes(result).some((code) => code.startsWith("visual_")));
});
