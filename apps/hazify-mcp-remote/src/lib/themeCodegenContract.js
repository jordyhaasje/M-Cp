const CODEGEN_CONTRACT_VERSION = "2026-04-30";

const VALIDATION_PROFILES = new Set([
  "syntax_only",
  "theme_safe",
  "production_visual",
  "exact_replica",
]);

const SECTION_KINDS = new Set([
  "hero",
  "hero_with_social_proof",
  "hero_with_logo_marquee",
  "hero_slider",
  "hero_slider_with_logo_marquee",
  "image_slider",
  "logo_marquee",
  "testimonial_slider",
  "review_grid",
  "review_carousel",
  "social_comments",
  "comparison",
  "faq",
  "tabs",
  "media_section",
  "content",
  "product_related",
  "unknown",
]);

const INTERACTION_KINDS = new Set([
  "none",
  "static",
  "slider",
  "carousel",
  "marquee",
  "slider_and_marquee",
  "tabs",
  "accordion",
]);

const BLOCK_MODELS = new Set([
  "none",
  "slides",
  "logos",
  "repeated_cards",
  "repeated_reviews",
  "mixed_blocks",
  "rows",
  "faq_items",
  "tabs",
]);

const MEDIA_MODELS = new Set([
  "none",
  "section_level_media",
  "block_level_media",
  "block_level_avatar",
  "block_level_logo",
  "both",
]);

const NAVIGATION_MODELS = new Set([
  "none",
  "link_button",
  "decorative_arrow",
  "slider_controls",
  "dots",
  "arrows",
  "arrows_and_dots",
]);

const CONTENT_MODELS = new Set([
  "section_settings",
  "block_settings",
  "mixed",
]);

const SETTING_TYPES_WITH_CONTENT_ONLY = new Set(["header", "paragraph"]);
const VISUAL_PROFILES = new Set(["production_visual", "exact_replica"]);
const CAROUSEL_KINDS = new Set([
  "hero_slider",
  "hero_slider_with_logo_marquee",
  "image_slider",
  "testimonial_slider",
  "review_carousel",
  "social_comments",
]);
const CARD_KINDS = new Set([
  "social_comments",
  "testimonial_slider",
  "review_grid",
  "review_carousel",
  "comparison",
]);

const uniqueStrings = (values = []) =>
  Array.from(new Set(values.filter(Boolean)));

const normalizeText = (value) =>
  String(value || "")
    .trim()
    .toLowerCase();

const escapeRegExp = (value) =>
  String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const getLiquidBlockContents = (value, tagName) => {
  const source = String(value || "");
  const normalizedTagName = escapeRegExp(tagName);
  const openPattern = new RegExp(`{%-?\\s*${normalizedTagName}\\s*-?%}`, "gi");
  const closePattern = new RegExp(`{%-?\\s*end${normalizedTagName}\\s*-?%}`, "gi");
  const contents = [];
  let searchStart = 0;

  while (searchStart < source.length) {
    openPattern.lastIndex = searchStart;
    const openMatch = openPattern.exec(source);
    if (!openMatch || openMatch.index === undefined) {
      break;
    }

    closePattern.lastIndex = openPattern.lastIndex;
    const closeMatch = closePattern.exec(source);
    if (!closeMatch || closeMatch.index === undefined) {
      break;
    }

    contents.push(source.slice(openPattern.lastIndex, closeMatch.index));
    searchStart = closePattern.lastIndex;
  }

  return contents;
};

const getSpecialBlockContents = (value, tagName) =>
  getLiquidBlockContents(value, tagName).map((entry) => String(entry || ""));

const parseSectionSchemaStrict = (value) => {
  const schemaBlocks = getLiquidBlockContents(value, "schema");
  if (schemaBlocks.length !== 1) {
    return {
      schema: null,
      schemaBlockCount: schemaBlocks.length,
      error:
        schemaBlocks.length === 0
          ? "Missing {% schema %} block."
          : "Multiple {% schema %} blocks found.",
    };
  }

  const schemaJson = String(schemaBlocks[0] || "").trim();
  if (!schemaJson) {
    return {
      schema: null,
      schemaBlockCount: 1,
      error: "Empty {% schema %} block.",
    };
  }

  try {
    return {
      schema: JSON.parse(schemaJson),
      schemaBlockCount: 1,
      error: null,
    };
  } catch (error) {
    return {
      schema: null,
      schemaBlockCount: 1,
      error: `Invalid schema JSON: ${error.message}`,
    };
  }
};

const humanizeLabel = (value, fallback = "Setting") => {
  const normalized = String(value || "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) {
    return fallback;
  }
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
};

const createIssue = ({
  code,
  severity = "error",
  path = [],
  message,
  fixSuggestion,
  suggestedReplacement,
}) => ({
  code,
  issueCode: code,
  severity,
  path,
  message,
  problem: message,
  fixSuggestion,
  ...(suggestedReplacement !== undefined ? { suggestedReplacement } : {}),
});

const settingRequiresLabel = (setting) => {
  const type = String(setting?.type || "").trim();
  return Boolean(type) && !SETTING_TYPES_WITH_CONTENT_ONLY.has(type);
};

const collectSettingsWithPaths = (schema, fileKey) => {
  const settings = [];
  for (const [index, setting] of (Array.isArray(schema?.settings)
    ? schema.settings
    : []
  ).entries()) {
    settings.push({
      setting,
      owner: "section",
      ownerLabel: "Section",
      path: [
        fileKey,
        "schema",
        "settings",
        String(setting?.id || setting?.type || `index_${index}`),
      ],
    });
  }

  for (const [blockIndex, block] of (Array.isArray(schema?.blocks)
    ? schema.blocks
    : []
  ).entries()) {
    const blockType = String(block?.type || `block_${blockIndex}`).trim();
    for (const [settingIndex, setting] of (Array.isArray(block?.settings)
      ? block.settings
      : []
    ).entries()) {
      settings.push({
        setting,
        owner: "block",
        ownerLabel: `Block '${blockType}'`,
        blockType,
        path: [
          fileKey,
          "schema",
          "blocks",
          blockType,
          "settings",
          String(setting?.id || setting?.type || `index_${settingIndex}`),
        ],
      });
    }
  }

  return settings;
};

const isStepAligned = (value, min, step) => {
  const steps = (value - min) / step;
  return Math.abs(steps - Math.round(steps)) < 1e-9;
};

const nearestRangeDefault = ({ min, max, step, defaultValue }) => {
  if (![min, max, step, defaultValue].every(Number.isFinite) || step <= 0) {
    return null;
  }
  const clamped = Math.min(max, Math.max(min, defaultValue));
  const steps = Math.round((clamped - min) / step);
  const candidate = Number((min + steps * step).toFixed(6));
  return Math.min(max, Math.max(min, candidate));
};

const collectSchemaPreflightIssues = ({ schema, fileKey, mode = null }) => {
  const issues = [];
  const settings = collectSettingsWithPaths(schema, fileKey);

  const sectionSettingIds = new Set();
  for (const { setting, path, ownerLabel } of settings.filter(
    (entry) => entry.owner === "section"
  )) {
    const id = String(setting?.id || "").trim();
    if (id && sectionSettingIds.has(id)) {
      issues.push(
        createIssue({
          code: "schema_duplicate_setting_id",
          path,
          message: `${ownerLabel} setting id '${id}' is duplicated.`,
          fixSuggestion:
            "Use unique setting IDs within section.settings so Liquid refs stay unambiguous.",
          suggestedReplacement: { id: `${id}_2` },
        })
      );
    }
    if (id) {
      sectionSettingIds.add(id);
    }
  }

  for (const block of Array.isArray(schema?.blocks) ? schema.blocks : []) {
    const blockType = String(block?.type || "").trim();
    const blockSettingIds = new Set();
    for (const setting of Array.isArray(block?.settings) ? block.settings : []) {
      const id = String(setting?.id || "").trim();
      if (id && blockSettingIds.has(id)) {
        issues.push(
          createIssue({
            code: "schema_duplicate_setting_id",
            path: [
              fileKey,
              "schema",
              "blocks",
              blockType || "unknown",
              "settings",
              id,
            ],
            message: `Block '${blockType || "unknown"}' setting id '${id}' is duplicated.`,
            fixSuggestion:
              "Use unique setting IDs within each block.settings array.",
            suggestedReplacement: { id: `${id}_2` },
          })
        );
      }
      if (id) {
        blockSettingIds.add(id);
      }
    }
  }

  const blockTypes = new Set();
  for (const [index, block] of (Array.isArray(schema?.blocks)
    ? schema.blocks
    : []
  ).entries()) {
    const blockType = String(block?.type || "").trim();
    if (!blockType) {
      issues.push(
        createIssue({
          code: "schema_missing_block_type",
          path: [fileKey, "schema", "blocks", `block_${index}`, "type"],
          message: `Block at index ${index} is missing type.`,
          fixSuggestion:
            "Add a stable block type such as review, slide, item, or row.",
        })
      );
    } else if (blockTypes.has(blockType)) {
      issues.push(
        createIssue({
          code: "schema_duplicate_block_type",
          path: [fileKey, "schema", "blocks", blockType],
          message: `Block type '${blockType}' is duplicated.`,
          fixSuggestion:
            "Use one schema.blocks entry per block type, or give each type a unique name.",
        })
      );
    }
    if (blockType) {
      blockTypes.add(blockType);
    }

    const blockName = String(block?.name || "").trim();
    if (blockType && !blockType.startsWith("@") && !blockName) {
      issues.push(
        createIssue({
          code: "schema_missing_block_name",
          path: [fileKey, "schema", "blocks", blockType, "name"],
          message: `Block '${blockType}' is missing a merchant-visible name.`,
          fixSuggestion: "Add a name such as Review, Slide, Item, or Row.",
        })
      );
    }
  }

  for (const { setting, path, ownerLabel } of settings) {
    const type = String(setting?.type || "").trim();
    const id = String(setting?.id || "").trim();
    const label = String(setting?.label || "").trim();
    const content = String(setting?.content || "").trim();

    if (!type) {
      issues.push(
        createIssue({
          code: "schema_missing_setting_type",
          path: [...path, "type"],
          message: `${ownerLabel} setting '${id || path.at(-1)}' is missing type.`,
          fixSuggestion:
            "Add a valid Shopify setting type such as text, image_picker, color, select, or range.",
        })
      );
      continue;
    }

    if (settingRequiresLabel(setting)) {
      if (!id) {
        issues.push(
          createIssue({
            code: "schema_missing_setting_id",
            path: [...path, "id"],
            message: `${ownerLabel} setting of type '${type}' is missing id.`,
            fixSuggestion:
              "Add a stable setting id such as heading, image, background_color, or card_gap.",
          })
        );
      }
      if (!label) {
        issues.push(
          createIssue({
            code: "schema_missing_setting_label",
            path: [...path, "label"],
            message: `${ownerLabel} setting '${id || type}' is missing label.`,
            fixSuggestion:
              "Add a short merchant-visible label for every editable setting.",
            suggestedReplacement: {
              label: humanizeLabel(id || type, "Setting"),
            },
          })
        );
      }
    } else if (!content) {
      issues.push(
        createIssue({
          code: "schema_missing_setting_content",
          path: [...path, "content"],
          message: `${ownerLabel} ${type} setting '${id || type}' is missing content.`,
          fixSuggestion:
            "Use content for header/paragraph editor text instead of label.",
        })
      );
    }

    if (type === "range") {
      const min = setting.min;
      const max = setting.max;
      const step = setting.step === undefined ? 1 : setting.step;
      const defaultValue = setting.default;

      if (![min, max, step, defaultValue].every(Number.isFinite) || step <= 0) {
        issues.push(
          createIssue({
            code: "schema_invalid_range",
            path,
            message: `${ownerLabel} range setting '${id || "unknown"}' must use numeric min, max, step, and default values with step > 0.`,
            fixSuggestion:
              "Use numeric range values, or switch to select when the value set is discrete.",
          })
        );
        continue;
      }

      if (min > max || defaultValue < min || defaultValue > max) {
        issues.push(
          createIssue({
            code: "schema_range_default_out_of_bounds",
            path: [...path, "default"],
            message: `${ownerLabel} range setting '${id}' has default ${defaultValue}, outside ${min}-${max}.`,
            fixSuggestion:
              "Move default inside min/max or adjust the range bounds before writing.",
            suggestedReplacement: {
              default: nearestRangeDefault({ min, max, step, defaultValue }),
            },
          })
        );
      } else if (!isStepAligned(defaultValue, min, step)) {
        issues.push(
          createIssue({
            code: "schema_range_default_not_step_aligned",
            path: [...path, "default"],
            message: `${ownerLabel} range setting '${id}' has default ${defaultValue}, which is not aligned to step ${step} from min ${min}.`,
            fixSuggestion:
              "Choose a default that lands exactly on the range step grid.",
            suggestedReplacement: {
              default: nearestRangeDefault({ min, max, step, defaultValue }),
            },
          })
        );
      }

      const stepCount = Math.floor((max - min) / step) + 1;
      if (Number.isFinite(stepCount) && stepCount < 3) {
        issues.push(
          createIssue({
            code: "schema_range_should_be_select",
            path,
            message: `${ownerLabel} range setting '${id}' exposes only ${stepCount} discrete choices.`,
            fixSuggestion:
              "Use a select setting for fewer than three discrete values.",
            suggestedReplacement: {
              type: "select",
              options: Array.from({ length: Math.max(0, stepCount) }, (_, index) => {
                const value = min + index * step;
                return { value: String(value), label: String(value) };
              }),
              default: String(defaultValue),
            },
          })
        );
      }

      if (Number.isFinite(stepCount) && stepCount > 101) {
        issues.push(
          createIssue({
            code: "schema_range_too_many_steps",
            path,
            message: `${ownerLabel} range setting '${id}' exposes ${stepCount} values.`,
            fixSuggestion:
              "Keep range settings to 101 values or fewer by increasing step or reducing max/min spread.",
            suggestedReplacement: {
              step: Math.ceil((max - min) / 100),
            },
          })
        );
      }
    }

    if (type === "select") {
      const options = Array.isArray(setting.options) ? setting.options : [];
      const values = options
        .map((option) => String(option?.value ?? "").trim())
        .filter(Boolean);
      if (values.length === 0) {
        issues.push(
          createIssue({
            code: "schema_select_missing_options",
            path: [...path, "options"],
            message: `${ownerLabel} select setting '${id}' has no valid options.`,
            fixSuggestion:
              "Add options with value and label entries for every choice.",
          })
        );
      }
      const missingOptionLabel = options.find(
        (option) => String(option?.value ?? "").trim() && !String(option?.label ?? "").trim()
      );
      if (missingOptionLabel) {
        issues.push(
          createIssue({
            code: "schema_select_option_missing_label",
            path: [...path, "options"],
            message: `${ownerLabel} select setting '${id}' has an option without label.`,
            fixSuggestion: "Add a merchant-visible label to every select option.",
            suggestedReplacement: {
              label: humanizeLabel(missingOptionLabel.value, "Option"),
            },
          })
        );
      }
      if (
        Object.prototype.hasOwnProperty.call(setting, "default") &&
        !values.includes(String(setting.default))
      ) {
        issues.push(
          createIssue({
            code: "schema_select_default_missing_option",
            path: [...path, "default"],
            message: `${ownerLabel} select setting '${id}' has default '${setting.default}', but that value is not in options.`,
            fixSuggestion:
              "Use an existing option value as the select default.",
            suggestedReplacement: {
              default: values[0] || "",
              validOptions: values,
            },
          })
        );
      }
    }
  }

  const presets = Array.isArray(schema?.presets) ? schema.presets : [];
  if (mode === "create" && presets.length === 0) {
    issues.push(
      createIssue({
        code: "schema_missing_presets",
        path: [fileKey, "schema", "presets"],
        message: "Section schema is missing presets.",
        fixSuggestion:
          "Add at least one render-safe preset so the section appears in the Theme Editor.",
      })
    );
  }

  for (const [presetIndex, preset] of presets.entries()) {
    for (const [blockIndex, block] of (Array.isArray(preset?.blocks)
      ? preset.blocks
      : []
    ).entries()) {
      const type = String(block?.type || "").trim();
      if (type && !blockTypes.has(type)) {
        issues.push(
          createIssue({
            code: "schema_preset_block_type_missing",
            path: [
              fileKey,
              "schema",
              "presets",
              String(preset?.name || presetIndex),
              "blocks",
              blockIndex,
              "type",
            ],
            message: `Preset block type '${type}' does not exist in schema.blocks.`,
            fixSuggestion:
              "Use only block types defined in schema.blocks, or add the missing block definition.",
            suggestedReplacement: {
              validBlockTypes: Array.from(blockTypes),
            },
          })
        );
      }
    }
  }

  if (
    Object.prototype.hasOwnProperty.call(schema || {}, "max_blocks") &&
    (!Number.isInteger(schema.max_blocks) || schema.max_blocks < 0 || schema.max_blocks > 50)
  ) {
    issues.push(
      createIssue({
        code: "schema_invalid_max_blocks",
        path: [fileKey, "schema", "max_blocks"],
        message: "Section max_blocks must be a sane integer between 0 and 50.",
        fixSuggestion:
          "Remove max_blocks unless needed, or set it to a valid value up to Shopify's 50-block section limit.",
        suggestedReplacement: { max_blocks: 50 },
      })
    );
  }

  return issues;
};

const inferSectionKind = ({
  requestText = "",
  sectionBlueprint = null,
  fileKey = "",
  value = "",
  schema = null,
} = {}) => {
  const archetype = normalizeText(sectionBlueprint?.archetype);
  const haystack = normalizeText(
    [
      requestText,
      fileKey,
      value.slice(0, 1200),
      schema?.name,
      archetype,
    ].join(" ")
  );
  const semanticHaystack = normalizeText(
    [requestText, fileKey, schema?.name, archetype].join(" ")
  );

  const heroLike = /\b(hero|banner|masthead|cover|slideshow|hero_)\b/.test(
    haystack
  );
  const sliderLike =
    /\b(slider|carousel|slideshow|slides?)\b/.test(haystack) ||
    (/\b(next|previous|prev|dots)\b/.test(haystack) &&
      /\b(slide|slides|card|cards|carousel|slider)\b/.test(haystack));
  const marqueeLike = /\b(marquee|ticker|logo[-_ ]?strip|logo[-_ ]?wall|brand[-_ ]?wall|publication|press|featured in|as seen in)\b/.test(
    haystack
  );
  const logoLike = /\b(logos?|brands?|publications?|press|featured in|as seen in)\b/.test(
    haystack
  );
  const socialProofLike = /\b(rating|stars?|trustpilot|verified|badge|seal|social proof)\b/.test(
    haystack
  );
  const testimonialLike = /\b(testimonials?|customer quotes?|quote cards?|klant(?:en)?ervaring(?:en)?)\b/.test(
    semanticHaystack
  );
  const reviewMainLike =
    testimonialLike ||
    /\b(review cards?|review grid|review wall|reviews? carousel|reviews? slider|customer reviews?|customer comments?|beoordeling(?:en)?(?:\s+(?:grid|carousel|slider|cards?|kaarten))?)\b/.test(
      semanticHaystack
    ) ||
    (/\b(review|reviews|testimonials?|comments?|quotes?|beoordeling(?:en)?|ervaring(?:en)?)\b/.test(
      semanticHaystack
    ) &&
      /\b(carousel|slider|slides?|grid|cards?|kaarten|wall|list|blocks?)\b/.test(
        semanticHaystack
      ));

  if (heroLike && sliderLike && (marqueeLike || logoLike)) {
    return "hero_slider_with_logo_marquee";
  }
  if (heroLike && sliderLike) {
    return "hero_slider";
  }
  if (heroLike && (marqueeLike || logoLike)) {
    return "hero_with_logo_marquee";
  }
  if (heroLike && socialProofLike) {
    return "hero_with_social_proof";
  }
  if (heroLike) {
    return "hero";
  }

  if (/social|instagram|tiktok|ugc|comments?/.test(haystack)) {
    return "social_comments";
  }
  if ((marqueeLike || logoLike) && !reviewMainLike) {
    return "logo_marquee";
  }
  if (testimonialLike && sliderLike) {
    return "testimonial_slider";
  }
  if (reviewMainLike && sliderLike) {
    return "review_carousel";
  }
  if (reviewMainLike && /\b(grid|wall|cards?|kaarten|list)\b/.test(haystack)) {
    return "review_grid";
  }
  if (/comparison|compare|vergelijk|\bvs\b|comparison_table/.test(haystack)) {
    return "comparison";
  }
  if (/(faq|frequently[-_ ]?asked[-_ ]?questions?|accordion|collapsible)/.test(haystack)) {
    return "faq";
  }
  if (/\btabs?\b/.test(haystack)) {
    return "tabs";
  }
  if (/(image|gallery|photo)/.test(haystack) && sliderLike) {
    return "image_slider";
  }
  if (/product|collection|pdp|commerce|price|buy|cart/.test(haystack)) {
    return "product_related";
  }
  if (/media|image|video|gallery|logo|reels?|media_/.test(haystack)) {
    return "media_section";
  }
  if (/content|text|richtext|feature|faq|accordion|tabs?/.test(haystack)) {
    return "content";
  }

  return "unknown";
};

const inferNavigationModel = ({ haystack, interactionKind }) => {
  if (["slider", "carousel", "slider_and_marquee"].includes(interactionKind)) {
    if (/\bdots?\b/.test(haystack) && /\b(arrows?|next|prev|previous)\b/.test(haystack)) {
      return "arrows_and_dots";
    }
    if (/\bdots?\b/.test(haystack)) {
      return "dots";
    }
    if (/\b(arrows?|next|prev|previous|controls?|navigation)\b/.test(haystack)) {
      return "slider_controls";
    }
    return "slider_controls";
  }
  if (/\b(cta|button|link|shop now|learn more|lees meer|bekijk)\b/.test(haystack)) {
    return "link_button";
  }
  if (/\b(arrow|pijl|chevron)\b/.test(haystack)) {
    return "decorative_arrow";
  }
  return "none";
};

const inferSectionArchitecture = ({
  sectionKind = "unknown",
  requestText = "",
  sectionBlueprint = null,
  fileKey = "",
  value = "",
  schema = null,
} = {}) => {
  const haystack = normalizeText(
    [
      requestText,
      fileKey,
      value.slice(0, 1600),
      schema?.name,
      sectionBlueprint?.archetype,
      sectionKind,
    ].join(" ")
  );
  const hasBlockMediaHint = /\b(slides?|multiple images?|background images?|gallery|card images?|block image|per[-_ ]?slide)\b/.test(
    haystack
  );
  const hasAvatarHint = /\b(avatar|customer photo|headshot|portrait)\b/.test(
    haystack
  );
  const hasLogoHint = /\b(logos?|brands?|publications?|press|featured in|as seen in)\b/.test(
    haystack
  );
  const hasSectionMediaHint = /\b(background image|hero image|banner image|overlay|section image|cover image|media background)\b/.test(
    haystack
  );
  const hasRatingHint = /\b(rating|stars?|star_count|trustpilot|score)\b/.test(
    haystack
  );

  let interactionKind = "static";
  let blockModel = "none";
  let mediaModel = hasSectionMediaHint ? "section_level_media" : "none";
  let contentModel = "section_settings";

  switch (sectionKind) {
    case "hero_with_logo_marquee":
      interactionKind = "marquee";
      blockModel = "logos";
      mediaModel = hasSectionMediaHint ? "section_level_media" : "both";
      contentModel = "mixed";
      break;
    case "hero_slider":
      interactionKind = "slider";
      blockModel = "slides";
      mediaModel = "block_level_media";
      contentModel = "block_settings";
      break;
    case "hero_slider_with_logo_marquee":
      interactionKind = "slider_and_marquee";
      blockModel = "mixed_blocks";
      mediaModel = "block_level_media";
      contentModel = "mixed";
      break;
    case "image_slider":
      interactionKind = "slider";
      blockModel = "slides";
      mediaModel = "block_level_media";
      contentModel = "block_settings";
      break;
    case "logo_marquee":
      interactionKind = "marquee";
      blockModel = "logos";
      mediaModel = "block_level_logo";
      contentModel = "block_settings";
      break;
    case "testimonial_slider":
      interactionKind = "slider";
      blockModel = "repeated_reviews";
      mediaModel = hasAvatarHint ? "block_level_avatar" : "none";
      contentModel = "block_settings";
      break;
    case "review_carousel":
      interactionKind = "carousel";
      blockModel = "repeated_reviews";
      mediaModel = hasAvatarHint ? "block_level_avatar" : "none";
      contentModel = "block_settings";
      break;
    case "review_grid":
      blockModel = "repeated_reviews";
      mediaModel = hasAvatarHint ? "block_level_avatar" : "none";
      contentModel = "block_settings";
      break;
    case "social_comments":
      interactionKind = /\b(slider|carousel|slides?)\b/.test(haystack)
        ? "carousel"
        : "static";
      blockModel = "repeated_cards";
      mediaModel = "block_level_avatar";
      contentModel = "block_settings";
      break;
    case "comparison":
      blockModel = "rows";
      contentModel = "mixed";
      break;
    case "faq":
      interactionKind = "accordion";
      blockModel = "faq_items";
      contentModel = "block_settings";
      break;
    case "tabs":
      interactionKind = "tabs";
      blockModel = "tabs";
      contentModel = "block_settings";
      break;
    case "media_section":
      mediaModel = hasBlockMediaHint ? "block_level_media" : "section_level_media";
      blockModel = hasBlockMediaHint ? "slides" : "none";
      contentModel = hasBlockMediaHint ? "block_settings" : "section_settings";
      break;
    default:
      break;
  }

  if (
    ["hero", "hero_with_social_proof"].includes(sectionKind) &&
    hasBlockMediaHint &&
    /\b(slider|carousel|slides?)\b/.test(haystack)
  ) {
    interactionKind = "slider";
    blockModel = "slides";
    mediaModel = "block_level_media";
    contentModel = "block_settings";
  }

  const navigationModel = inferNavigationModel({ haystack, interactionKind });
  const blockRoles = uniqueStrings([
    ...(blockModel === "slides" || blockModel === "mixed_blocks" ? ["slide"] : []),
    ...(blockModel === "logos" || blockModel === "mixed_blocks" ? ["logo"] : []),
    ...(blockModel === "repeated_reviews" ? ["review"] : []),
    ...(blockModel === "rows" ? ["row"] : []),
    ...(blockModel === "faq_items" ? ["faq_item"] : []),
    ...(blockModel === "tabs" ? ["tab"] : []),
  ]);

  const requiredBlockSettings = {
    ...(blockRoles.includes("slide")
      ? {
          slide: uniqueStrings([
            ...(mediaModel === "block_level_media" || mediaModel === "both"
              ? ["image"]
              : []),
            "heading",
            "text",
            ...(sectionKind.startsWith("hero_slider")
              ? ["button_text", "button_link"]
              : []),
            ...(hasRatingHint ? ["rating_text_or_star_count"] : []),
          ]),
          optionalSlideSettings: uniqueStrings([
            "mobile_image",
            ...(hasRatingHint ? ["star_count", "rating_text"] : []),
          ]),
        }
      : {}),
    ...(blockRoles.includes("logo")
      ? { logo: ["logo_image_or_text", "logo_alt_or_name"] }
      : {}),
    ...(blockRoles.includes("review")
      ? {
          review: uniqueStrings([
            "quote_or_comment",
            "author_or_name",
            ...(hasRatingHint ? ["rating_or_star_count"] : []),
          ]),
          optionalReviewSettings: ["avatar"],
        }
      : {}),
    ...(blockRoles.includes("row") ? { row: ["label_or_title", "content"] } : {}),
    ...(blockRoles.includes("faq_item") ? { faq_item: ["question", "answer"] } : {}),
    ...(blockRoles.includes("tab") ? { tab: ["tab_title", "tab_content"] } : {}),
  };

  return {
    sectionKind,
    interactionKind,
    blockModel,
    mediaModel,
    navigationModel,
    contentModel,
    blockRoles,
    requiredBlockSettings,
    markers: uniqueStrings([
      "data-section-bounded-shell",
      ...(hasRatingHint ? ["data-section-rating-badge"] : []),
      ...(interactionKind === "marquee" || interactionKind === "slider_and_marquee"
        ? ["data-section-marquee"]
        : []),
      ...(interactionKind === "slider" ||
      interactionKind === "carousel" ||
      interactionKind === "slider_and_marquee"
        ? ["data-section-slider", "data-section-slide"]
        : []),
      ...(blockRoles.includes("logo") ? ["data-section-logo-item"] : []),
      ...(blockRoles.includes("review") ? ["data-section-review-item"] : []),
    ]),
  };
};

const inferValidationProfile = ({
  requestedProfile,
  intent = "",
  mode = "",
  changeScope = "",
  preferredWriteMode = "",
  requestText = "",
  sectionKind = "unknown",
  sectionBlueprint = null,
} = {}) => {
  if (VALIDATION_PROFILES.has(requestedProfile)) {
    return requestedProfile;
  }

  const haystack = normalizeText(
    [
      requestText,
      sectionBlueprint?.qualityTarget,
      sectionBlueprint?.generationMode,
      sectionBlueprint?.archetype,
      sectionKind,
    ].join(" ")
  );

  if (
    sectionBlueprint?.qualityTarget === "exact_match" ||
    /\b(exact|pixel|replica|screenshot|reference|match|identiek|precies)\b/.test(
      haystack
    )
  ) {
    return "exact_replica";
  }

  if (
    changeScope === "micro_patch" ||
    preferredWriteMode === "patch" ||
    (mode === "edit" && intent === "existing_edit" && changeScope === "micro_patch")
  ) {
    return "syntax_only";
  }

  if (
    intent === "new_section" ||
    mode === "create" ||
    CAROUSEL_KINDS.has(sectionKind) ||
    [
      "comparison",
      "hero",
      "hero_with_social_proof",
      "hero_with_logo_marquee",
      "logo_marquee",
      "media_section",
      "image_slider",
    ].includes(sectionKind) ||
    /\b(slider|carousel|testimonial|review|social|comments?|comparison)\b/.test(
      haystack
    )
  ) {
    return "production_visual";
  }

  if (intent === "existing_edit" || mode === "edit") {
    return "theme_safe";
  }

  return "theme_safe";
};

const getContractRules = ({ validationProfile, sectionKind, architecture = null }) => {
  const productionLike = VISUAL_PROFILES.has(validationProfile);
  const sliderLike =
    ["slider", "carousel", "slider_and_marquee"].includes(
      architecture?.interactionKind
    ) || CAROUSEL_KINDS.has(sectionKind);
  const cardLike =
    ["repeated_cards", "repeated_reviews", "rows"].includes(
      architecture?.blockModel
    ) || CARD_KINDS.has(sectionKind);

  return {
    schema: uniqueStrings([
      "Use exactly one valid {% schema %} JSON block.",
      "Use unique setting IDs and merchant-visible labels for editable settings.",
      "Keep range defaults in min/max and aligned to step; use select for fewer than 3 choices.",
      "Include render-safe presets; preset block types must exist in schema.blocks.",
    ]),
    liquid: uniqueStrings([
      "Do not nest Liquid delimiters inside a single output/tag expression.",
      "Put {{ block.shopify_attributes }} on the rendered block wrapper inside each section.blocks loop.",
      "Render optional image/video/product resources behind blank-safe guards.",
      "Use Shopify image_url + image_tag for Shopify image resources.",
    ]),
    css: uniqueStrings([
      "Do not put Liquid inside {% stylesheet %}; use <style> for section.id-dependent CSS.",
      "Scope generated section CSS under #shopify-section-{{ section.id }} or an equivalent local root.",
      ...(productionLike
        ? [
            "Provide explicit mobile behavior via @media, @container, clamp/minmax, flex-wrap, or equivalent responsive strategy.",
            "Do not rely only on theme utility classes for core generated layout.",
          ]
        : []),
    ]),
    js: uniqueStrings([
      "Do not put Liquid inside {% javascript %}; use data attributes or plain <script> values instead.",
      "Scope JS selectors per section instance before querying controls or slides.",
      ...(sliderLike || productionLike
        ? [
            "Interactive sliders/carousels need real behavior and Theme Editor-safe reinitialization.",
          ]
        : []),
    ]),
    responsiveVisual: productionLike
      ? uniqueStrings([
          ...(sliderLike
            ? [
                "Carousel tracks need scroll-snap or scripted navigation, stable mobile card widths, and working controls when controls are visible.",
              ]
            : []),
          ...(cardLike
            ? [
                "Card sections need explicit gap, padding, border-radius/surface, and stable mobile sizing signals.",
              ]
            : []),
          ...(validationProfile === "exact_replica"
            ? [
                "Replica sections must preserve visible anchors such as badges, rating stars, comparison icons, and desktop/mobile parity when requested.",
              ]
            : []),
        ])
      : [],
  };
};

const summarizeRequiredBlockSettings = (requiredBlockSettings = {}) =>
  Object.entries(requiredBlockSettings)
    .filter(([, settings]) => Array.isArray(settings) && settings.length > 0)
    .map(([role, settings]) => `${role}=[${settings.join(", ")}]`);

const buildPromptBlock = ({
  validationProfile,
  sectionKind,
  architecture,
  rules,
  scaleProfile,
}) => {
  const lines = [
    `CODEGEN CONTRACT v${CODEGEN_CONTRACT_VERSION}`,
    `profile=${validationProfile}; sectionKind=${sectionKind}`,
    `Architecture: interactionKind=${architecture?.interactionKind || "static"}; blockModel=${architecture?.blockModel || "none"}; mediaModel=${architecture?.mediaModel || "none"}; navigationModel=${architecture?.navigationModel || "none"}; contentModel=${architecture?.contentModel || "section_settings"}`,
    `Schema: ${rules.schema.join(" ")}`,
    `Liquid: ${rules.liquid.join(" ")}`,
    `CSS: ${rules.css.join(" ")}`,
    `JS: ${rules.js.join(" ")}`,
  ];

  const blockSettings = summarizeRequiredBlockSettings(
    architecture?.requiredBlockSettings
  );
  if (blockSettings.length > 0) {
    lines.push(`Blocks: ${blockSettings.join("; ")}`);
  }

  if (architecture?.navigationModel) {
    if (
      ["slider_controls", "arrows", "dots", "arrows_and_dots"].includes(
        architecture.navigationModel
      )
    ) {
      lines.push(
        "Navigation: visible slider/carousel controls must be semantic buttons wired to real slide/card movement; do not output visual-only arrows."
      );
    } else if (
      ["decorative_arrow", "link_button"].includes(architecture.navigationModel)
    ) {
      lines.push(
        "Navigation: arrows/buttons are decorative or links, not slider controls; do not add slide blocks only because an arrow is visible."
      );
    }
  }

  if (architecture?.mediaModel) {
    lines.push(
      `Media: ${architecture.mediaModel}; keep merchant media at the level implied by the architecture.`
    );
  }

  if (architecture?.markers?.length > 0) {
    lines.push(`Markers: include when applicable ${architecture.markers.join(", ")}.`);
  }

  if (rules.responsiveVisual.length > 0) {
    lines.push(`Responsive/visual: ${rules.responsiveVisual.join(" ")}`);
  }

  if (scaleProfile && typeof scaleProfile === "object") {
    const compactScale = [
      scaleProfile.contentMaxWidthMax
        ? `contentMax<=${scaleProfile.contentMaxWidthMax}px`
        : null,
      scaleProfile.cardMinHeightMax
        ? `cardMinHeight<=${scaleProfile.cardMinHeightMax}px`
        : null,
      scaleProfile.gridGapMaxPx ? `gap<=${scaleProfile.gridGapMaxPx}px` : null,
      scaleProfile.cardPaddingMaxPx
        ? `cardPadding<=${scaleProfile.cardPaddingMaxPx}px`
        : null,
    ].filter(Boolean);
    if (compactScale.length > 0) {
      lines.push(`Scale: ${compactScale.join("; ")}`);
    }
  }

  return lines.join("\n");
};

const buildCodegenContract = ({
  intent = null,
  mode = null,
  targetFile = null,
  themeTarget = null,
  plannerResult = null,
  sectionBlueprint = null,
  themeContext = null,
  changeScope = null,
  preferredWriteMode = null,
  requestText = "",
  validationProfile = null,
  value = "",
  schema = null,
} = {}) => {
  const effectiveBlueprint =
    sectionBlueprint ||
    plannerResult?.sectionBlueprint ||
    null;
  const effectiveThemeContext =
    themeContext ||
    plannerResult?.themeContext ||
    null;
  const effectiveChangeScope =
    changeScope || plannerResult?.changeScope || null;
  const effectivePreferredWriteMode =
    preferredWriteMode || plannerResult?.preferredWriteMode || null;
  const effectiveIntent = intent || plannerResult?.intent || null;
  const sectionKind = inferSectionKind({
    requestText,
    sectionBlueprint: effectiveBlueprint,
    fileKey: targetFile,
    value,
    schema,
  });
  const effectiveProfile = inferValidationProfile({
    requestedProfile: validationProfile,
    intent: effectiveIntent,
    mode,
    changeScope: effectiveChangeScope,
    preferredWriteMode: effectivePreferredWriteMode,
    requestText,
    sectionKind,
    sectionBlueprint: effectiveBlueprint,
  });
  const architecture = inferSectionArchitecture({
    sectionKind,
    requestText,
    sectionBlueprint: effectiveBlueprint,
    fileKey: targetFile,
    value,
    schema,
  });
  const rules = getContractRules({
    validationProfile: effectiveProfile,
    sectionKind,
    architecture,
  });
  const scaleProfile =
    effectiveBlueprint?.generationRecipe?.scaleProfile ||
    effectiveBlueprint?.scaleProfile ||
    effectiveBlueprint?.scaleGuide ||
    effectiveThemeContext?.scaleGuide ||
    null;

  return {
    version: CODEGEN_CONTRACT_VERSION,
    validationProfile: effectiveProfile,
    sectionKind,
    interactionKind: architecture.interactionKind,
    blockModel: architecture.blockModel,
    mediaModel: architecture.mediaModel,
    navigationModel: architecture.navigationModel,
    contentModel: architecture.contentModel,
    architecture,
    target: {
      intent: effectiveIntent,
      file: targetFile || null,
      theme: themeTarget || null,
      mode: mode || null,
      changeScope: effectiveChangeScope,
      preferredWriteMode: effectivePreferredWriteMode,
    },
    schemaRules: rules.schema,
    liquidRules: rules.liquid,
    cssRules: rules.css,
    jsRules: rules.js,
    responsiveVisualRules: rules.responsiveVisual,
    scaleProfile,
    promptBlock: buildPromptBlock({
      validationProfile: effectiveProfile,
      sectionKind,
      architecture,
      rules,
      scaleProfile,
    }),
  };
};

const hasLiquidSyntax = (value) => /{{|{%/.test(String(value || ""));

const hasSectionScopeMarker = (source) =>
  /#shopify-section-\s*{{-?\s*section\.id\s*-?}}|#shopify-section-{{\s*section\.id\s*}}|data-section-id|data-section-root|shopify-section-\{\{\s*section\.id\s*\}\}/i.test(
    String(source || "")
  );

const extractInlineScriptContents = (value) =>
  Array.from(
    String(value || "").matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi),
    (match) => String(match[1] || "")
  );

const hasScopedJsSelector = (scriptSource) =>
  /\b(root|sectionRoot|sectionEl|container|host|this)\.(querySelector(?:All)?|getElementById)\s*\(|closest\([^)]*(?:shopify-section|data-section-id|data-section-root)|document\.currentScript\.closest/i.test(
    String(scriptSource || "")
  );

const hasGlobalJsSelector = (scriptSource) =>
  /document\.(querySelector(?:All)?|getElementById|getElementsByClassName|getElementsByTagName)\s*\(/.test(
    String(scriptSource || "")
  );

const hasThemeEditorLifecycle = (scriptSource) =>
  /shopify:section:load|shopify:section:select|shopify:block:select|Shopify\.designMode/i.test(
    String(scriptSource || "")
  ) ||
  /customElements\.define[\s\S]{0,800}connectedCallback\s*\(/i.test(
    String(scriptSource || "")
  );

const hasCarouselBehavior = (source, scriptSource) =>
  /scroll-snap-type\s*:/i.test(source) ||
  /(?:scrollBy|scrollTo|scrollLeft|translateX|style\.transform|classList\.(?:add|remove|toggle)\s*\([^)]*(?:active|current|is-selected)|new\s+(?:Swiper|Splide|Flickity|KeenSlider|EmblaCarousel))/i.test(
    scriptSource
  );

const hasVisibleCarouselControls = (source) =>
  /<button\b[^>]*(?:data-(?:next|prev|slider|carousel)|aria-label\s*=\s*["'][^"']*(?:next|previous|prev|volgende|vorige)|class\s*=\s*["'][^"']*(?:next|prev|arrow|nav|control))/i.test(
    source
  );

const sourceHasResponsiveStrategy = (source) =>
  /@media\b|@container\b|clamp\(|minmax\(|flex-wrap\s*:\s*wrap|auto-fit|auto-fill|grid-template-columns\s*:\s*repeat\(/i.test(
    String(source || "")
  );

const sourceHasCardSizingSignals = (source) => {
  const text = String(source || "");
  const signals = [
    /gap\s*:/i,
    /padding(?:-[a-z]+)?\s*:/i,
    /border-radius\s*:/i,
    /min-height\s*:/i,
    /grid-auto-columns\s*:/i,
  ];
  return signals.filter((pattern) => pattern.test(text)).length >= 3;
};

const sourceHasVisualStructureSignals = (source) =>
  /(?:__|[-_])(?:card|slide|track|grid)\b|data-(?:track|slider|carousel)|grid-auto-columns\s*:|scroll-snap|overflow-x\s*:|<article\b/i.test(
    String(source || "")
  );

const sourceHasCarouselStructureSignals = (source) =>
  /(?:__|[-_])(?:slide|track)\b|data-(?:track|slider|carousel)|grid-auto-columns\s*:|scroll-snap|overflow-x\s*:|aria-label\s*=\s*["'][^"']*(?:next|previous|prev|volgende|vorige)/i.test(
    String(source || "")
  );

const sourceUsesOnlyThemeUtilitiesForLayout = (source) => {
  const text = String(source || "");
  const hasUtilityClasses = /\b(page-width|container|rte|button|section)\b/i.test(text);
  const hasOwnLayoutCss =
    /display\s*:\s*(?:grid|flex|inline-grid|inline-flex)|grid-template-columns\s*:|flex-direction\s*:|gap\s*:|padding\s*:/i.test(
      text
    );
  return hasUtilityClasses && !hasOwnLayoutCss;
};

const collectMobilePercentColumnIssues = ({
  source,
  fileKey,
  sectionKind,
  architecture = null,
}) => {
  const carouselLike =
    isSliderInteraction(architecture?.interactionKind) ||
    CAROUSEL_KINDS.has(sectionKind) ||
    (!architecture && /carousel|slider|track/i.test(source));
  if (!carouselLike) {
    return [];
  }

  const issues = [];
  const pattern = /grid-auto-columns\s*:\s*(\d+(?:\.\d+)?)%\s*;/gi;
  for (const match of source.matchAll(pattern)) {
    const percent = Number(match[1]);
    if (!Number.isFinite(percent)) {
      continue;
    }
    if (percent <= 72 || percent >= 88) {
      issues.push(
        createIssue({
          code: "visual_unstable_mobile_carousel_width",
          path: [fileKey],
          message: `Carousel uses percentage-only grid-auto-columns: ${percent}%.`,
          fixSuggestion:
            "Use stable mobile card sizing such as minmax(240px, 86%), calc((100vw - 32px) * .86), or clamp/min/max with fixed gutters.",
          suggestedReplacement: "grid-auto-columns: minmax(240px, 86%);",
        })
      );
    }
  }

  return issues;
};

const isSliderInteraction = (interactionKind) =>
  ["slider", "carousel", "slider_and_marquee"].includes(
    String(interactionKind || "")
  );

const requiresSliderControls = (navigationModel) =>
  ["slider_controls", "arrows", "dots", "arrows_and_dots"].includes(
    String(navigationModel || "")
  );

const mergeContractArchitecture = ({
  codegenContract = null,
  sectionKind,
  requestText,
  sectionBlueprint,
  fileKey,
  value,
  schema,
} = {}) => {
  const inferred = inferSectionArchitecture({
    sectionKind,
    requestText,
    sectionBlueprint,
    fileKey,
    value,
    schema,
  });
  const supplied =
    codegenContract?.architecture && typeof codegenContract.architecture === "object"
      ? codegenContract.architecture
      : {};

  const interactionKind = INTERACTION_KINDS.has(
    codegenContract?.interactionKind || supplied.interactionKind
  )
    ? codegenContract?.interactionKind || supplied.interactionKind
    : inferred.interactionKind;
  const blockModel = BLOCK_MODELS.has(codegenContract?.blockModel || supplied.blockModel)
    ? codegenContract?.blockModel || supplied.blockModel
    : inferred.blockModel;
  const mediaModel = MEDIA_MODELS.has(codegenContract?.mediaModel || supplied.mediaModel)
    ? codegenContract?.mediaModel || supplied.mediaModel
    : inferred.mediaModel;
  const navigationModel = NAVIGATION_MODELS.has(
    codegenContract?.navigationModel || supplied.navigationModel
  )
    ? codegenContract?.navigationModel || supplied.navigationModel
    : inferred.navigationModel;
  const contentModel = CONTENT_MODELS.has(
    codegenContract?.contentModel || supplied.contentModel
  )
    ? codegenContract?.contentModel || supplied.contentModel
    : inferred.contentModel;

  return {
    ...inferred,
    ...supplied,
    sectionKind,
    interactionKind,
    blockModel,
    mediaModel,
    navigationModel,
    contentModel,
    blockRoles: uniqueStrings([
      ...(Array.isArray(inferred.blockRoles) ? inferred.blockRoles : []),
      ...(Array.isArray(supplied.blockRoles) ? supplied.blockRoles : []),
    ]),
    markers: uniqueStrings([
      ...(Array.isArray(inferred.markers) ? inferred.markers : []),
      ...(Array.isArray(supplied.markers) ? supplied.markers : []),
    ]),
    requiredBlockSettings: {
      ...(inferred.requiredBlockSettings || {}),
      ...(supplied.requiredBlockSettings || {}),
    },
  };
};

const getSchemaBlocks = (schema) =>
  (Array.isArray(schema?.blocks) ? schema.blocks : []).filter((block) => {
    const type = String(block?.type || "").trim();
    return type && !type.startsWith("@");
  });

const blockText = (block) =>
  normalizeText(
    [
      block?.type,
      block?.name,
      ...(Array.isArray(block?.settings)
        ? block.settings.map((setting) =>
            [
              setting?.type,
              setting?.id,
              setting?.label,
              setting?.content,
            ].join(" ")
          )
        : []),
    ].join(" ")
  );

const settingMatches = (setting, patterns = [], types = []) => {
  const type = String(setting?.type || "").trim();
  if (types.includes(type)) {
    return true;
  }
  const text = normalizeText(
    [setting?.id, setting?.label, setting?.type, setting?.content].join(" ")
  );
  return patterns.some((pattern) => pattern.test(text));
};

const blockHasSetting = (block, patterns = [], types = []) =>
  (Array.isArray(block?.settings) ? block.settings : []).some((setting) =>
    settingMatches(setting, patterns, types)
  );

const isLogoBlock = (block) =>
  /\b(logos?|brand|publication|press|partner)\b/.test(blockText(block)) ||
  blockHasSetting(block, [/\blogo\b/, /\bbrand\b/, /\bpublication\b/, /\bpress\b/]);

const isReviewBlock = (block) =>
  /\b(review|testimonial|quote|comment|author|customer|naam|klant)\b/.test(
    blockText(block)
  ) ||
  blockHasSetting(block, [
    /\b(author|customer|naam)\b/,
    /\b(quote|comment|review|testimonial)\b/,
  ]);

const isSlideBlock = (block) =>
  !isLogoBlock(block) &&
  !isReviewBlock(block) &&
  (/\b(slide|hero|image|media|banner)\b/.test(blockText(block)) ||
    blockHasSetting(block, [/\b(image|media|background|photo)\b/], ["image_picker"]));

const findBlocksByRole = (schema, role) => {
  const blocks = getSchemaBlocks(schema);
  if (role === "logo") {
    return blocks.filter(isLogoBlock);
  }
  if (role === "review") {
    return blocks.filter(isReviewBlock);
  }
  if (role === "slide") {
    return blocks.filter(isSlideBlock);
  }
  return blocks;
};

const collectMissingBlockSettingIssues = ({
  block,
  role,
  fileKey,
  blockType,
  requirements = [],
}) => {
  const issues = [];
  const requirementMatchers = {
    image: {
      patterns: [/\b(image|media|background|photo|picture)\b/],
      types: ["image_picker"],
      label: "image/media",
    },
    heading: {
      patterns: [/\b(heading|title|headline|kop)\b/],
      types: [],
      label: "heading/title",
    },
    text: {
      patterns: [/\b(text|copy|body|description|subheading|richtext)\b/],
      types: ["text", "textarea", "richtext", "inline_richtext"],
      label: "text/copy",
    },
    button_text: {
      patterns: [/\b(button[_-]?text|button[_-]?label|cta[_-]?text|link[_-]?label)\b/],
      types: [],
      label: "button text",
    },
    button_link: {
      patterns: [/\b(button[_-]?link|cta[_-]?link|link|url)\b/],
      types: ["url"],
      label: "button link",
    },
    logo_image_or_text: {
      patterns: [/\b(logo|brand|publication|press|image|name|text)\b/],
      types: ["image_picker", "text"],
      label: "logo image/text",
    },
    quote_or_comment: {
      patterns: [/\b(quote|comment|review|testimonial|body|text)\b/],
      types: ["textarea", "richtext", "inline_richtext", "text"],
      label: "quote/comment",
    },
    author_or_name: {
      patterns: [/\b(author|name|customer|naam|person)\b/],
      types: ["text"],
      label: "author/name",
    },
    question: {
      patterns: [/\b(question|vraag|title|heading)\b/],
      types: ["text", "inline_richtext"],
      label: "question",
    },
    answer: {
      patterns: [/\b(answer|antwoord|content|text|body)\b/],
      types: ["textarea", "richtext", "inline_richtext", "text"],
      label: "answer",
    },
    tab_title: {
      patterns: [/\b(tab|title|heading|label)\b/],
      types: ["text", "inline_richtext"],
      label: "tab title",
    },
    tab_content: {
      patterns: [/\b(content|text|body|panel)\b/],
      types: ["textarea", "richtext", "inline_richtext", "text"],
      label: "tab content",
    },
  };

  for (const requirement of requirements) {
    if (requirement.includes("_or_") && !requirementMatchers[requirement]) {
      continue;
    }
    if (requirement === "rating_text_or_star_count" || requirement === "rating_or_star_count") {
      continue;
    }
    const matcher = requirementMatchers[requirement];
    if (!matcher) {
      continue;
    }
    if (!blockHasSetting(block, matcher.patterns, matcher.types)) {
      issues.push(
        createIssue({
          code: `architecture_${role}_missing_${requirement}`,
          path: [fileKey, "schema", "blocks", blockType, "settings"],
          message: `The ${role} block is missing a merchant-editable ${matcher.label} setting required by the codegen architecture.`,
          fixSuggestion: `Add a ${matcher.label} setting to the ${role} block and render block.settings.* from it.`,
        })
      );
    }
  }

  return issues;
};

const sourceHasSectionBlocksLoop = (source) =>
  /for\s+block\s+in\s+section\.blocks/i.test(String(source || ""));

const sourceHasBlockRoleMarker = (source, marker) =>
  new RegExp(escapeRegExp(marker), "i").test(String(source || ""));

const collectArchitectureIssues = ({
  source,
  schema,
  fileKey,
  validationProfile,
  architecture,
}) => {
  if (!VISUAL_PROFILES.has(validationProfile) || !architecture) {
    return { issues: [], warnings: [] };
  }

  const issues = [];
  const warnings = [];
  const blockModel = architecture.blockModel;
  const interactionKind = architecture.interactionKind;
  const navigationModel = architecture.navigationModel;
  const requiredBlockSettings = architecture.requiredBlockSettings || {};

  const requireSectionBlocks = [
    "slides",
    "logos",
    "repeated_cards",
    "repeated_reviews",
    "mixed_blocks",
    "rows",
    "faq_items",
    "tabs",
  ].includes(blockModel);

  if (requireSectionBlocks && schema && getSchemaBlocks(schema).length === 0) {
    issues.push(
      createIssue({
        code: "architecture_missing_blocks",
        path: [fileKey, "schema", "blocks"],
        message:
          "The codegen architecture requires merchant-editable repeated blocks, but schema.blocks is empty.",
        fixSuggestion:
          "Add schema.blocks for the requested slides, logos, reviews, rows, FAQ items, or tabs and render them through section.blocks.",
      })
    );
  }

  if (requireSectionBlocks && !sourceHasSectionBlocksLoop(source)) {
    issues.push(
      createIssue({
        code: "architecture_missing_section_blocks_loop",
        path: [fileKey],
        message:
          "The codegen architecture requires block-based content, but the section does not loop over section.blocks.",
        fixSuggestion:
          "Render the block model with a primary {% for block in section.blocks %} loop and block.shopify_attributes.",
      })
    );
  }

  if (schema && ["slides", "mixed_blocks"].includes(blockModel)) {
    const slideBlocks = findBlocksByRole(schema, "slide");
    if (slideBlocks.length === 0) {
      issues.push(
        createIssue({
          code: "architecture_missing_slide_blocks",
          path: [fileKey, "schema", "blocks"],
          message:
            "The codegen architecture requires real slide blocks, but no slide/image/media block type is defined.",
          fixSuggestion:
            "Add a slide block type with merchant-editable image/media, heading, text, and optional CTA settings.",
        })
      );
    }
    for (const block of slideBlocks) {
      const blockType = String(block?.type || "slide");
      issues.push(
        ...collectMissingBlockSettingIssues({
          block,
          role: "slide",
          fileKey,
          blockType,
          requirements: requiredBlockSettings.slide || ["heading", "text"],
        })
      );
    }
    if (
      slideBlocks.length > 0 &&
      !sourceHasBlockRoleMarker(source, "data-section-slide")
    ) {
      warnings.push(
        createIssue({
          code: "architecture_missing_slide_marker",
          severity: "warning",
          path: [fileKey],
          message:
            "Slide markup does not include the data-section-slide semantic marker.",
          fixSuggestion:
            "Add data-section-slide to the top-level rendered slide wrapper to make validator and client intent explicit.",
        })
      );
    }
  }

  if (schema && ["logos", "mixed_blocks"].includes(blockModel)) {
    const logoBlocks = findBlocksByRole(schema, "logo");
    if (logoBlocks.length === 0) {
      issues.push(
        createIssue({
          code: "architecture_missing_logo_blocks",
          path: [fileKey, "schema", "blocks"],
          message:
            "The codegen architecture requires logo blocks, but no logo/brand/publication block type is defined.",
          fixSuggestion:
            "Add a logo block type with merchant-editable logo image or text and render it as a logo item.",
        })
      );
    }
    for (const block of logoBlocks) {
      const blockType = String(block?.type || "logo");
      issues.push(
        ...collectMissingBlockSettingIssues({
          block,
          role: "logo",
          fileKey,
          blockType,
          requirements: requiredBlockSettings.logo || ["logo_image_or_text"],
        })
      );
    }
  }

  if (schema && blockModel === "repeated_reviews") {
    const reviewBlocks = findBlocksByRole(schema, "review");
    if (reviewBlocks.length === 0) {
      issues.push(
        createIssue({
          code: "architecture_missing_review_blocks",
          path: [fileKey, "schema", "blocks"],
          message:
            "The codegen architecture requires review/testimonial blocks, but no review block type is defined.",
          fixSuggestion:
            "Add review/testimonial blocks with quote/comment and author/name settings.",
        })
      );
    }
    for (const block of reviewBlocks) {
      const blockType = String(block?.type || "review");
      issues.push(
        ...collectMissingBlockSettingIssues({
          block,
          role: "review",
          fileKey,
          blockType,
          requirements: requiredBlockSettings.review || [
            "quote_or_comment",
            "author_or_name",
          ],
        })
      );
    }
  }

  if (
    isSliderInteraction(interactionKind) &&
    requiresSliderControls(navigationModel) &&
    !hasVisibleCarouselControls(source)
  ) {
    issues.push(
      createIssue({
        code: "architecture_slider_controls_missing_buttons",
        path: [fileKey],
        message:
          "The codegen architecture requires slider controls, but no semantic prev/next button controls are rendered.",
        fixSuggestion:
          "Render accessible <button type=\"button\"> controls with data-prev/data-next or equivalent section-scoped attributes.",
      })
    );
  }

  if (
    !isSliderInteraction(interactionKind) &&
    ["decorative_arrow", "link_button"].includes(navigationModel)
  ) {
    return { issues, warnings };
  }

  return { issues, warnings };
};

const refIsGuarded = (source, ref) => {
  const escaped = escapeRegExp(ref);
  return new RegExp(`\\b${escaped}\\s*!=\\s*(?:blank|nil)|\\b${escaped}\\b[\\s\\S]{0,80}\\|\\s*default\\s*:`, "i").test(
    source
  );
};

const collectMediaResourceIssues = ({ source, schema, fileKey }) => {
  const issues = [];
  const settings = collectSettingsWithPaths(schema, fileKey);
  for (const { setting, owner, path } of settings) {
    const type = String(setting?.type || "").trim();
    const id = String(setting?.id || "").trim();
    if (!id || !["image_picker", "video", "video_url"].includes(type)) {
      continue;
    }

    const ref = `${owner}.settings.${id}`;
    if (
      type === "image_picker" &&
      new RegExp(`<img\\b[^>]*{{[^}]*${escapeRegExp(ref)}|${escapeRegExp(ref)}\\s*\\|\\s*img_url\\b`, "i").test(
        source
      )
    ) {
      issues.push(
        createIssue({
          code: "liquid_image_picker_not_image_tag",
          path,
          message: `${ref} is rendered through raw img/img_url instead of image_url + image_tag.`,
          fixSuggestion:
            "Render Shopify images with {{ setting | image_url: width: ... | image_tag: ... }} behind a blank-safe guard.",
        })
      );
    }

    const riskyFilter =
      type === "image_picker"
        ? "image_url"
        : type === "video"
          ? "video_tag"
          : "(?:external_video_url|external_video_tag)";
    if (
      new RegExp(`${escapeRegExp(ref)}\\s*\\|\\s*${riskyFilter}\\b`, "i").test(source) &&
      !refIsGuarded(source, ref)
    ) {
      issues.push(
        createIssue({
          code: "liquid_unguarded_optional_media",
          path,
          message: `${ref} is passed to a media filter without a blank-safe guard.`,
          fixSuggestion:
            `Wrap ${ref} in {% if ${ref} != blank %} before calling image/video filters, and render a safe empty/fallback state otherwise.`,
        })
      );
    }
  }

  return issues;
};

const sectionBlocksLoopHasAttributes = (source) => {
  const loopPattern =
    /{%-?\s*for\s+block\s+in\s+section\.blocks\b[\s\S]*?-?%}([\s\S]*?){%-?\s*endfor\s*-?%}/gi;
  const loops = Array.from(String(source || "").matchAll(loopPattern));
  if (loops.length === 0) {
    return true;
  }
  return loops.every((match) => /block\.shopify_attributes/i.test(match[1] || ""));
};

const collectLiquidCssJsIssues = ({ source, fileKey, validationProfile }) => {
  const issues = [];
  const warnings = [];

  for (const stylesheetBody of getSpecialBlockContents(source, "stylesheet")) {
    if (hasLiquidSyntax(stylesheetBody)) {
      issues.push(
        createIssue({
          code: "css_liquid_inside_stylesheet",
          path: [fileKey],
          message:
            "Liquid is inside {% stylesheet %}; Shopify does not render Liquid there.",
          fixSuggestion:
            "Move Liquid-dependent CSS to a regular <style> block scoped by #shopify-section-{{ section.id }}.",
        })
      );
    }
  }

  for (const javascriptBody of getSpecialBlockContents(source, "javascript")) {
    if (hasLiquidSyntax(javascriptBody)) {
      issues.push(
        createIssue({
          code: "js_liquid_inside_javascript",
          path: [fileKey],
          message:
            "Liquid is inside {% javascript %}; Shopify does not render Liquid there.",
          fixSuggestion:
            "Move Liquid-derived values into data attributes or a regular <script> block.",
        })
      );
    }
  }

  const hasLocalCss =
    /<style\b/i.test(source) || getSpecialBlockContents(source, "stylesheet").length > 0;
  if (hasLocalCss && !hasSectionScopeMarker(source)) {
    const issue = createIssue({
      code: "css_missing_section_scope",
      severity: VISUAL_PROFILES.has(validationProfile) ? "error" : "warning",
      path: [fileKey],
      message:
        "Generated section CSS is not scoped to #shopify-section-{{ section.id }} or an equivalent local section root.",
      fixSuggestion:
        "Scope CSS selectors under #shopify-section-{{ section.id }} so multiple section instances cannot leak styles.",
    });
    if (issue.severity === "error") {
      issues.push(issue);
    } else {
      warnings.push(issue);
    }
  }

  return { issues, warnings };
};

const collectJsIssues = ({
  source,
  fileKey,
  validationProfile,
  sectionKind,
  architecture = null,
}) => {
  const issues = [];
  const warnings = [];
  const scriptBodies = [
    ...extractInlineScriptContents(source),
    ...getSpecialBlockContents(source, "javascript"),
  ].filter((entry) => entry.trim());
  const scriptSource = scriptBodies.join("\n");
  if (!scriptSource) {
    return { issues, warnings };
  }

  if (
    validationProfile !== "syntax_only" &&
    hasGlobalJsSelector(scriptSource) &&
    !hasScopedJsSelector(scriptSource)
  ) {
    issues.push(
      createIssue({
        code: "js_unscoped_selector",
        path: [fileKey],
        message:
          "Interactive section JS uses document-level selectors without local section scoping.",
        fixSuggestion:
          "Resolve a section root first, then call root.querySelector/querySelectorAll for controls and slides.",
      })
    );
  }

  const architectureInteractiveLike =
    isSliderInteraction(architecture?.interactionKind) ||
    ["tabs", "accordion"].includes(architecture?.interactionKind);
  const interactiveLike =
    architectureInteractiveLike ||
    (!architecture &&
      (CAROUSEL_KINDS.has(sectionKind) ||
        /carousel|slider|accordion|tabs?|before[-_ ]?after|data-(?:slider|carousel|tabs?|accordion)|<button\b/i.test(
          source
        )));

  if (
    VISUAL_PROFILES.has(validationProfile) &&
    interactiveLike &&
    /addEventListener|scrollBy|scrollTo|classList|customElements\.define/i.test(
      scriptSource
    ) &&
    !hasThemeEditorLifecycle(scriptSource)
  ) {
    issues.push(
      createIssue({
        code: "js_missing_theme_editor_lifecycle",
        path: [fileKey],
        message:
          "Scripted interactive section is missing Shopify Theme Editor lifecycle support.",
        fixSuggestion:
          "Support shopify:section:load and relevant select/block events, or use a scoped custom element with connectedCallback for idempotent reinitialization.",
      })
    );
  }

  return { issues, warnings };
};

const collectVisualIssues = ({
  source,
  fileKey,
  validationProfile,
  sectionKind,
  architecture = null,
}) => {
  if (!VISUAL_PROFILES.has(validationProfile)) {
    return { issues: [], warnings: [] };
  }

  const issues = [];
  const warnings = [];
  const scriptSource = extractInlineScriptContents(source).join("\n");
  const carouselLike =
    isSliderInteraction(architecture?.interactionKind) ||
    (!architecture &&
      (CAROUSEL_KINDS.has(sectionKind) ||
        /carousel|slider|data-(?:slider|carousel)/i.test(source)));
  const hasVisualStructure = sourceHasVisualStructureSignals(source);
  const hasCarouselStructure = sourceHasCarouselStructureSignals(source);

  if (
    carouselLike &&
    hasCarouselStructure &&
    !hasCarouselBehavior(source, scriptSource)
  ) {
    issues.push(
      createIssue({
        code: "visual_carousel_missing_behavior",
        path: [fileKey],
        message:
          "Carousel/slider section lacks scroll-snap or equivalent scripted navigation.",
        fixSuggestion:
          "Add overflow-x + scroll-snap behavior, or component-scoped JS that moves the track/slides.",
      })
    );
  }

  if (
    carouselLike &&
    (!architecture || requiresSliderControls(architecture.navigationModel)) &&
    hasVisibleCarouselControls(source) &&
    !/(?:scrollBy|scrollTo|scrollLeft|translateX|addEventListener\s*\(\s*['"]click['"])/i.test(
      scriptSource
    )
  ) {
    issues.push(
      createIssue({
        code: "visual_carousel_controls_not_wired",
        path: [fileKey],
        message:
          "Carousel has visible controls, but the controls are not wired to real navigation.",
        fixSuggestion:
          "Attach prev/next click handlers to section-scoped scrollBy/scrollTo/transform behavior.",
      })
    );
  }

  issues.push(
    ...collectMobilePercentColumnIssues({
      source,
      fileKey,
      sectionKind,
      architecture,
    })
  );

  if (!sourceHasResponsiveStrategy(source)) {
    const hardResponsiveRequired =
      hasVisualStructure &&
      (
        validationProfile === "exact_replica" ||
        carouselLike ||
        ["repeated_cards", "repeated_reviews", "rows"].includes(
          architecture?.blockModel
        ) ||
        CARD_KINDS.has(sectionKind) ||
        [
          "hero",
          "hero_with_social_proof",
          "hero_with_logo_marquee",
          "hero_slider",
          "hero_slider_with_logo_marquee",
          "media_section",
          "comparison",
        ].includes(sectionKind)
      );
    const issue = createIssue({
      code: "visual_missing_responsive_strategy",
      severity: hardResponsiveRequired ? "error" : "warning",
      path: [fileKey],
      message:
        "Generated section has no explicit mobile/responsive strategy.",
      fixSuggestion:
        "Add @media/@container rules, clamp/minmax sizing, flex-wrap, or another clear responsive layout strategy.",
    });
    if (hardResponsiveRequired) {
      issues.push(issue);
    } else {
      warnings.push(issue);
    }
  }

  if (
    (CARD_KINDS.has(sectionKind) ||
      ["repeated_cards", "repeated_reviews", "rows"].includes(
        architecture?.blockModel
      )) &&
    hasVisualStructure &&
    !sourceHasCardSizingSignals(source)
  ) {
    issues.push(
      createIssue({
        code: "visual_missing_card_sizing",
        path: [fileKey],
        message:
          "Card-based section lacks enough stable card sizing signals.",
        fixSuggestion:
          "Add scoped card gap, padding, radius/surface, and min-height or stable grid-auto-columns/card width rules.",
      })
    );
  }

  if (sourceUsesOnlyThemeUtilitiesForLayout(source)) {
    warnings.push(
      createIssue({
        code: "visual_theme_utility_only_layout",
        severity: "warning",
        path: [fileKey],
        message:
          "Core generated layout appears to rely only on theme utility classes.",
        fixSuggestion:
          "Keep theme helpers for consistency, but add scoped layout CSS for this section's grid/flex/cards/mobile behavior.",
      })
    );
  }

  if (
    validationProfile === "exact_replica" &&
    ["review_carousel", "testimonial_slider", "review_grid"].includes(sectionKind) &&
    !/[★☆]|star|rating|quote|blockquote|testimonial|review/i.test(source)
  ) {
    warnings.push(
      createIssue({
        code: "exact_replica_missing_review_anchors",
        severity: "warning",
        path: [fileKey],
        message:
          "Exact review/testimonial replica lacks rating, star, quote, or review-card anchors.",
        fixSuggestion:
          "Preserve visible review anchors such as stars, rating text, quotes, author labels, and card surfaces in the first write.",
      })
    );
  }

  return { issues, warnings };
};

const buildSectionRepairPrompt = (issues = []) => {
  const actionableIssues = (issues || []).filter(Boolean);
  if (actionableIssues.length === 0) {
    return "";
  }

  return [
    "Repair this Shopify section without changing unrelated design or data model.",
    ...actionableIssues.slice(0, 8).map((issue, index) => {
      const code = issue.code || issue.issueCode || "preflight_issue";
      const message = issue.message || issue.problem || "Fix the reported issue.";
      const fix = issue.fixSuggestion || "Apply the smallest targeted fix.";
      return `${index + 1}. ${code}: ${message} Fix: ${fix}`;
    }),
    "Preserve existing merchant settings, blocks, presets, visible content, and section intent unless an issue explicitly requires changing them.",
  ].join("\n");
};

const preflightSectionLiquid = (
  value,
  {
    fileKey = "sections/<section>.liquid",
    mode = null,
    intent = null,
    requestText = "",
    themeTarget = null,
    themeContext = null,
    sectionBlueprint = null,
    codegenContract = null,
    validationProfile = null,
    changeScope = null,
    preferredWriteMode = null,
  } = {}
) => {
  const source = String(value || "");
  const parsed = parseSectionSchemaStrict(source);
  const sectionKind =
    codegenContract?.sectionKind && SECTION_KINDS.has(codegenContract.sectionKind)
      ? codegenContract.sectionKind
      : inferSectionKind({
          requestText,
          sectionBlueprint,
          fileKey,
          value: source,
          schema: parsed.schema,
        });
  const architecture = mergeContractArchitecture({
    codegenContract,
    sectionKind,
    requestText,
    sectionBlueprint,
    fileKey,
    value: source,
    schema: parsed.schema,
  });
  const effectiveContract =
    codegenContract && typeof codegenContract === "object"
      ? {
          ...codegenContract,
          validationProfile: VALIDATION_PROFILES.has(
            codegenContract.validationProfile
          )
            ? codegenContract.validationProfile
            : inferValidationProfile({
                requestedProfile: validationProfile,
                intent,
                mode,
                changeScope,
                preferredWriteMode,
                requestText,
                sectionKind,
                sectionBlueprint,
              }),
          sectionKind,
          interactionKind: architecture.interactionKind,
          blockModel: architecture.blockModel,
          mediaModel: architecture.mediaModel,
          navigationModel: architecture.navigationModel,
          contentModel: architecture.contentModel,
          architecture,
        }
      : buildCodegenContract({
          intent,
          mode,
          targetFile: fileKey,
          themeTarget,
          themeContext,
          sectionBlueprint,
          changeScope,
          preferredWriteMode,
          requestText,
          validationProfile,
          value: source,
          schema: parsed.schema,
        });
  const effectiveProfile = effectiveContract.validationProfile;
  const issues = [];
  const warnings = [];

  if (parsed.schemaBlockCount !== 1) {
    issues.push(
      createIssue({
        code:
          parsed.schemaBlockCount === 0
            ? "schema_missing_schema_block"
            : "schema_multiple_schema_blocks",
        path: [fileKey, "schema"],
        message: parsed.error,
        fixSuggestion:
          "Use exactly one {% schema %} block containing valid JSON at the end of the section.",
      })
    );
  } else if (parsed.error) {
    issues.push(
      createIssue({
        code: "schema_invalid_json",
        path: [fileKey, "schema"],
        message: parsed.error,
        fixSuggestion:
          "Fix the schema JSON syntax. Section schemas must be strict JSON, not JSONC.",
      })
    );
  }

  if (parsed.schema) {
    issues.push(
      ...collectSchemaPreflightIssues({
        schema: parsed.schema,
        fileKey,
        mode,
      })
    );
  }

  if (
    /for\s+block\s+in\s+section\.blocks/i.test(source) &&
    !sectionBlocksLoopHasAttributes(source)
  ) {
    issues.push(
      createIssue({
        code: "liquid_missing_block_shopify_attributes",
        path: [fileKey],
        message:
          "A section.blocks loop does not render block.shopify_attributes inside the loop body.",
        fixSuggestion:
          "Place {{ block.shopify_attributes }} on the top-level card/slide/item wrapper in the same loop.",
      })
    );
  }

  if (parsed.schema) {
    issues.push(
      ...collectMediaResourceIssues({
        source,
        schema: parsed.schema,
        fileKey,
      })
    );
  }

  const cssJsInspection = collectLiquidCssJsIssues({
    source,
    fileKey,
    validationProfile: effectiveProfile,
  });
  issues.push(...cssJsInspection.issues);
  warnings.push(...cssJsInspection.warnings);

  const jsInspection = collectJsIssues({
    source,
    fileKey,
    validationProfile: effectiveProfile,
    sectionKind,
    architecture: effectiveContract.architecture,
  });
  issues.push(...jsInspection.issues);
  warnings.push(...jsInspection.warnings);

  const architectureInspection = collectArchitectureIssues({
    source,
    schema: parsed.schema,
    fileKey,
    validationProfile: effectiveProfile,
    architecture: effectiveContract.architecture,
  });
  issues.push(...architectureInspection.issues);
  warnings.push(...architectureInspection.warnings);

  const visualInspection = collectVisualIssues({
    source,
    fileKey,
    validationProfile: effectiveProfile,
    sectionKind,
    architecture: effectiveContract.architecture,
  });
  issues.push(...visualInspection.issues);
  warnings.push(...visualInspection.warnings);

  const blockingIssues = issues.filter((issue) => issue.severity !== "warning");
  const allIssues = [...blockingIssues, ...warnings];

  return {
    ok: blockingIssues.length === 0,
    validationProfile: effectiveProfile,
    sectionKind,
    codegenContract: effectiveContract,
    issues: blockingIssues,
    warnings,
    errors: blockingIssues,
    repairPrompt: buildSectionRepairPrompt(blockingIssues),
    suggestedFixes: uniqueStrings(
      allIssues.map((issue) => issue.fixSuggestion).filter(Boolean)
    ),
  };
};

export {
  CODEGEN_CONTRACT_VERSION,
  buildCodegenContract,
  buildSectionRepairPrompt,
  inferSectionArchitecture,
  inferSectionKind,
  inferValidationProfile,
  parseSectionSchemaStrict,
  preflightSectionLiquid,
};
