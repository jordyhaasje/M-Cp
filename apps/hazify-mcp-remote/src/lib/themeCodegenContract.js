const CODEGEN_CONTRACT_VERSION = "2026-05-08.2";

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
  "video_grid",
  "video_slider",
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
  "mobile_scroll_snap",
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
  "block_level_video",
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
  "video_slider",
  "testimonial_slider",
  "review_carousel",
  "social_comments",
]);
const CARD_KINDS = new Set([
  "video_grid",
  "video_slider",
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
  details,
  diagnostics,
}) => ({
  code,
  issueCode: code,
  severity,
  path,
  message,
  problem: message,
  fixSuggestion,
  ...(suggestedReplacement !== undefined ? { suggestedReplacement } : {}),
  ...(details !== undefined ? { details } : {}),
  ...(diagnostics !== undefined ? { diagnostics } : {}),
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
  const valueWithoutStyleBlocks = String(value || "").replace(
    /<style\b[^>]*>[\s\S]*?<\/style>|\{%\s*stylesheet\s*%\}[\s\S]*?\{%\s*endstylesheet\s*%\}/gi,
    " "
  );
  const haystack = normalizeText(
    [
      requestText,
      fileKey,
      valueWithoutStyleBlocks.slice(0, 1200),
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
    /\b(reviews?|review|testimonial|beoordeling(?:en)?)\b[\s\S]{0,40}\b(section|sectie|blok|component)\b/.test(
      semanticHaystack
    ) ||
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
  if (/\b(comparison|compare|vergelijk|tabel|table|vs|comparison_table)\b/.test(haystack)) {
    return "comparison";
  }
  if (/(faq|frequently[-_ ]?asked[-_ ]?questions?|questions?|vragen|antwoorden|accordion|collapsible)/.test(haystack)) {
    return "faq";
  }
  if (/\btabs?\b|tabbladen|panelen/.test(haystack)) {
    return "tabs";
  }
  if (/(image|gallery|photo)/.test(haystack) && sliderLike) {
    return "image_slider";
  }
  if (/\bvideo\b/.test(haystack) && sliderLike) {
    return "video_slider";
  }
  if (
    /\bvideo\b/.test(semanticHaystack) &&
    /\b(repeatable|repeated|multiple|cards?|grid|items?|blocks?|per[-_ ]?card)\b/.test(
      semanticHaystack
    )
  ) {
    return "video_grid";
  }
  if (/product|collection|pdp|commerce|price|buy|cart/.test(haystack)) {
    return "product_related";
  }
  if (/\b(media|image|video|gallery|logo|reels?)\b|media_/.test(haystack)) {
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
  const semanticHaystack = normalizeText(
    [
      requestText,
      fileKey,
      schema?.name,
      sectionBlueprint?.archetype,
      sectionKind,
    ].join(" ")
  );
  const schemaBlocks = getSchemaBlocks(schema);
  const hasSchemaBlocks = schemaBlocks.length > 0;
  const hasSectionBlocksLoop = /for\s+block\s+in\s+section\.blocks/i.test(
    String(value || "")
  );
  const hasBlockMediaHint = /\b(slides?|multiple images?|background images?|gallery|card images?|block image|per[-_ ]?slide)\b/.test(
    semanticHaystack
  );
  const hasImageHint = /\b(images?|afbeelding(?:en)?|photos?|pictures?|background images?)\b/.test(
    semanticHaystack
  );
  const hasRepeatedCardHint = /\b(repeatable|repeated|multiple|cards?|grid|items?|blocks?|per[-_ ]?card)\b/.test(
    semanticHaystack
  ) || hasSchemaBlocks || hasSectionBlocksLoop;
  const hasVideoHint = /\b(videos?|video_url|youtube|vimeo|reels?)\b/.test(
    semanticHaystack
  );
  const hasBlockVideoHint =
    /\b(video cards?|card videos?|block video|per[-_ ]?(?:card|slide) video|video blocks?|video items?|slide videos?|slides? with videos?)\b/.test(
      semanticHaystack
    ) ||
    (hasVideoHint && /\b(slides?|slider|carousel|per[-_ ]?slide)\b/.test(semanticHaystack));
  const hasMobileScrollSnapHint = /\b(mobile|mobiel)\b[\s\S]{0,80}\b(scroll[-_ ]?snap|swipe|carousel|slider|horizontal scroll)\b/.test(
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
  const hasQuoteHint = /\b(quotes?|reviews?|testimonial|beoordeling(?:en)?|ervaring(?:en)?)\b/.test(
    semanticHaystack
  );
  const hasBodyTextHint = /\b(text|copy|caption|subtitle|subheading|description|body|richtext|tekst|omschrijving|bijschrift)\b/.test(
    semanticHaystack
  );
  const hasReviewerNameHint = /\b(reviewer|reviewer name|customer name|author|naam|klantnaam)\b/.test(
    semanticHaystack
  ) || hasQuoteHint;
  const hasButtonHint = /\b(button|buttons|cta|ctas|knop|knoppen|link)\b/.test(
    semanticHaystack
  );
  const hasExplicitSecondaryButtonHint =
    /\b(secondary|second|tweede|alternate|outline)\b[\s\S]{0,40}\b(button|cta|link|knop)\b/.test(
      semanticHaystack
    ) ||
    /\b(two|2|twee)\b[\s\S]{0,30}\b(buttons?|ctas?|knoppen)\b/.test(
      semanticHaystack
    );
  const requiresReviewRating = hasRatingHint;
  const requiresSlideText =
    sectionKind.startsWith("hero_slider") || hasBodyTextHint || hasQuoteHint;
  const requiresSlideButton =
    sectionKind.startsWith("hero_slider") || hasButtonHint;

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
      mediaModel = hasBlockVideoHint ? "block_level_video" : "block_level_media";
      contentModel = "block_settings";
      break;
    case "hero_slider_with_logo_marquee":
      interactionKind = "slider_and_marquee";
      blockModel = "mixed_blocks";
      mediaModel = hasBlockVideoHint ? "block_level_video" : "block_level_media";
      contentModel = "mixed";
      break;
    case "image_slider":
      interactionKind = "slider";
      blockModel = "slides";
      mediaModel = "block_level_media";
      contentModel = "block_settings";
      break;
    case "video_slider":
      interactionKind = hasMobileScrollSnapHint ? "mobile_scroll_snap" : "carousel";
      blockModel = "repeated_cards";
      mediaModel = "block_level_video";
      contentModel = "block_settings";
      break;
    case "video_grid":
      interactionKind = hasMobileScrollSnapHint ? "mobile_scroll_snap" : "static";
      blockModel = "repeated_cards";
      mediaModel = "block_level_video";
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
      mediaModel =
        hasBlockVideoHint ? "block_level_video" : hasBlockMediaHint ? "block_level_media" : "section_level_media";
      blockModel = hasRepeatedCardHint ? "repeated_cards" : hasBlockMediaHint ? "slides" : "none";
      interactionKind = hasMobileScrollSnapHint ? "mobile_scroll_snap" : interactionKind;
      contentModel = blockModel !== "none" ? "block_settings" : "section_settings";
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
    ...(blockModel === "repeated_cards" ? ["card"] : []),
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
            ...(mediaModel === "block_level_media" || mediaModel === "both" || hasImageHint
              ? ["image"]
              : []),
            ...(mediaModel === "block_level_video" ? ["video_or_external_video"] : []),
            "heading",
            ...(requiresSlideText ? ["text"] : []),
            ...(requiresSlideButton
              ? ["button_text", "button_link"]
              : []),
            ...(hasAvatarHint ? ["avatar"] : []),
            ...(hasQuoteHint ? ["quote_or_comment"] : []),
            ...(hasReviewerNameHint ? ["author_or_name"] : []),
            ...(hasRatingHint ? ["rating_text_or_star_count"] : []),
            ...(hasExplicitSecondaryButtonHint
              ? ["secondary_button_text", "secondary_button_link"]
              : []),
          ]),
          optionalSlideSettings: uniqueStrings([
            "mobile_image",
            "video",
            "external_video",
            "avatar",
            "quote",
            "reviewer",
            "secondary_button_text",
            "secondary_button_link",
            ...(hasRatingHint ? ["star_count", "rating_text"] : []),
          ]),
        }
      : {}),
    ...(blockRoles.includes("logo")
      ? { logo: ["logo_image_or_text", "logo_alt_or_name"] }
      : {}),
    ...(blockRoles.includes("card")
      ? {
          card: uniqueStrings([
            mediaModel === "block_level_video"
              ? "video_or_external_video"
              : mediaModel === "block_level_media"
                ? "image_or_media"
                : "content",
            "heading_or_title",
            "text_or_caption",
          ]),
        }
      : {}),
    ...(blockRoles.includes("review")
      ? {
          review: uniqueStrings([
            "quote_or_comment",
            "author_or_name",
            ...(requiresReviewRating ? ["rating_or_star_count"] : []),
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
      interactionKind === "mobile_scroll_snap" ||
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
            "Prefer one coherent slider strategy: transform-based translateX with flex: 0 0 100%, or scroll-snap with scroll index synchronization; avoid half-wired visual controls.",
            "Autoplay sliders must pause on hover/focus, respect prefers-reduced-motion, and keep manual navigation/swipe state in sync.",
            "When slides contain videos, play only the active slide media and pause inactive slide videos.",
          ]
        : []),
    ]),
    responsiveVisual: productionLike
      ? uniqueStrings([
          ...(sliderLike
            ? [
                "Carousel tracks need scroll-snap or scripted navigation, stable mobile card widths, and working controls when controls are visible.",
                "Slider pagination/dots should reflect active state and be generated without a second section.blocks loop.",
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
  sectionDataContract,
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

  if (sectionDataContract?.requiredFeatures?.length > 0) {
    lines.push(
      `Required features: ${sectionDataContract.requiredFeatures.join(", ")}. Missing or partial prompt coverage is not complete; do not remove requested features to pass validation.`
    );
  }

  if (sectionDataContract?.featureContracts?.length > 0) {
    lines.push(
      `Feature contracts: ${sectionDataContract.featureContracts
        .slice(0, 10)
        .map((entry) => `${entry.feature}: schema=${entry.schema}; render=${entry.render}`)
        .join(" | ")}`
    );
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
  const sectionDataContract = buildSectionDataContract({
    requestText,
    sectionKind,
    architecture,
    sectionBlueprint: effectiveBlueprint,
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
    sectionDataContract,
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
      sectionDataContract,
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
  ["slider", "carousel", "mobile_scroll_snap", "slider_and_marquee"].includes(
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

const blockIdentityText = (block) =>
  normalizeText([block?.type, block?.name].filter(Boolean).join(" "));

const TYPE_ONLY_SAFE_SETTING_TYPES = new Set([
  "image_picker",
  "video",
  "video_url",
  "product",
  "collection",
  "article",
  "blog",
  "page",
  "link_list",
]);

const settingMatches = (setting, patterns = [], types = []) => {
  const type = String(setting?.type || "").trim();
  const text = normalizeText(
    [setting?.id, setting?.label, setting?.content].join(" ")
  );
  const patternMatches = patterns.some((pattern) => pattern.test(text));
  if (patternMatches) {
    return true;
  }
  if (!types.includes(type)) {
    return false;
  }
  return patterns.length === 0 || TYPE_ONLY_SAFE_SETTING_TYPES.has(type);
};

const blockHasSetting = (block, patterns = [], types = []) =>
  (Array.isArray(block?.settings) ? block.settings : []).some((setting) =>
    settingMatches(setting, patterns, types)
  );

const blockSettingSummaries = (block) =>
  (Array.isArray(block?.settings) ? block.settings : []).map((setting) => ({
    type: String(setting?.type || "").trim() || null,
    id: String(setting?.id || "").trim() || null,
    label: String(setting?.label || "").trim() || null,
  }));

const isLogoBlock = (block) =>
  /\b(logos?|brand|publication|press|partner)\b/.test(blockText(block)) ||
  blockHasSetting(block, [/\blogo\b/, /\bbrand\b/, /\bpublication\b/, /\bpress\b/]);

const isReviewBlock = (block) =>
  /\b(review|testimonial|quote|comment|author|customer|reviewer|naam|klant)\b/.test(
    blockText(block)
  ) ||
  blockHasSetting(block, [
    /\b(author|customer|reviewer|naam)\b/,
    /\b(quote|comment|review|testimonial)\b/,
  ]);

const isFaqBlock = (block) =>
  /\b(faq|question|answer|vraag|antwoord)\b/.test(blockText(block)) ||
  (blockHasSetting(block, [/\b(question|vraag)\b/]) &&
    blockHasSetting(block, [/\b(answer|antwoord|content|body|text)\b/]));

const isTabBlock = (block) =>
  /\b(tab|panel)\b/.test(blockIdentityText(block)) ||
  (blockHasSetting(block, [/\b(tab|label|title|heading)\b/]) &&
    blockHasSetting(block, [/\b(content|panel|body|text)\b/]));

const isRowBlock = (block) =>
  /\b(row|comparison|feature|benefit|spec|attribute)\b/.test(blockText(block)) ||
  (blockHasSetting(block, [/\b(label|title|feature|benefit|name)\b/]) &&
    blockHasSetting(block, [/\b(content|value|text|description)\b/]));

const isExplicitSlideBlock = (block) =>
  /\b(slides?|hero|banner|carousel)\b/.test(blockIdentityText(block));

const hasSlideMediaSetting = (block) =>
  blockHasSetting(
    block,
    [/\b(image|media|background|photo|picture|poster|video|external_video)\b/],
    ["image_picker", "video", "video_url"]
  );

const hasSlideContentSetting = (block) =>
  blockHasSetting(block, [/\b(heading|title|headline|button|cta|subheading)\b/]);

const isSlideBlock = (block) => {
  if (isExplicitSlideBlock(block)) {
    return !isLogoBlock(block);
  }
  if (isLogoBlock(block)) {
    return false;
  }
  if (isReviewBlock(block) && !hasSlideMediaSetting(block)) {
    return false;
  }
  return (
    /\b(image|media|banner)\b/.test(blockText(block)) ||
    (hasSlideMediaSetting(block) && hasSlideContentSetting(block))
  );
};

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
  if (role === "faq_item") {
    return blocks.filter(isFaqBlock);
  }
  if (role === "tab") {
    return blocks.filter(isTabBlock);
  }
  if (role === "row") {
    return blocks.filter(isRowBlock);
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
    secondary_button_text: {
      patterns: [
        /\b(secondary|second|tweede|alternate|outline)[_-]?(button|cta)?[_-]?(text|label)\b/,
        /\bsecondary[_-]?button[_-]?text\b/,
        /\bsecond[_-]?button[_-]?text\b/,
      ],
      types: [],
      label: "secondary button text",
    },
    secondary_button_link: {
      patterns: [
        /\b(secondary|second|tweede|alternate|outline)[_-]?(button|cta)?[_-]?(link|url)\b/,
        /\bsecondary[_-]?button[_-]?link\b/,
        /\bsecond[_-]?button[_-]?link\b/,
      ],
      types: [],
      label: "secondary button link",
    },
    avatar: {
      patterns: [/\b(avatar|customer[_-]?photo|headshot|portrait|person[_-]?image)\b/],
      types: ["image_picker"],
      label: "avatar/customer image",
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
      patterns: [/\b(author|name|customer|reviewer|naam|person)\b/],
      types: ["text"],
      label: "author/name",
    },
    rating_or_star_count: {
      patterns: [/\b(rating|stars?|star[_-]?count|score|trustpilot)\b/],
      types: ["range", "number", "select", "text"],
      label: "rating/star score",
    },
    rating_text_or_star_count: {
      patterns: [/\b(rating|stars?|star[_-]?count|score|trustpilot)\b/],
      types: ["range", "number", "select", "text"],
      label: "rating/star score",
    },
    label_or_title: {
      patterns: [/\b(label|title|heading|feature|benefit|name)\b/],
      types: ["text", "inline_richtext"],
      label: "label/title",
    },
    content: {
      patterns: [/\b(content|value|text|body|description|copy)\b/],
      types: ["text", "textarea", "richtext", "inline_richtext"],
      label: "content/value",
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
    video_or_external_video: {
      patterns: [/\b(video|external_video|youtube|vimeo|media)\b/],
      types: ["video", "video_url"],
      label: "video/video_url",
    },
    image_or_media: {
      patterns: [/\b(image|media|photo|picture)\b/],
      types: ["image_picker", "video", "video_url"],
      label: "image/media",
    },
    heading_or_title: {
      patterns: [/\b(heading|title|headline|kop)\b/],
      types: ["text", "inline_richtext"],
      label: "heading/title",
    },
    text_or_caption: {
      patterns: [/\b(text|copy|caption|body|description|subheading)\b/],
      types: ["text", "textarea", "richtext", "inline_richtext"],
      label: "text/caption",
    },
  };

  for (const requirement of requirements) {
    if (requirement.includes("_or_") && !requirementMatchers[requirement]) {
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
          details: {
            role,
            blockType,
            requirement,
            requiredAnyOf: {
              settingIdOrLabelPatterns: matcher.patterns.map((pattern) =>
                String(pattern)
              ),
              settingTypes: matcher.types,
            },
            detectedSettings: blockSettingSummaries(block),
          },
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

const hasExplicitPromptText = (requestText = "") => {
  const text = String(requestText || "").trim();
  if (!text) {
    return false;
  }
  if (/^sections\/[A-Za-z0-9._-]+\.liquid$/.test(text)) {
    return false;
  }
  if (text.length >= 24) {
    return true;
  }
  return /\b(maak|create|build|generate|section|sectie|slider|carousel|faq|tabs?|newsletter|video|review|testimonial)\b/i.test(
    text
  );
};

const buildArchitectureDiagnostics = ({ schema, architecture } = {}) => {
  const detectedBlocks = getSchemaBlocks(schema).map((block) => {
    const type = String(block?.type || "").trim();
    const name = String(block?.name || "").trim();
    const settings = blockSettingSummaries(block);
    const roles = uniqueStrings([
      isSlideBlock(block) ? "slide" : null,
      isLogoBlock(block) ? "logo" : null,
      isReviewBlock(block) ? "review" : null,
      isFaqBlock(block) ? "faq_item" : null,
      isTabBlock(block) ? "tab" : null,
      isRowBlock(block) ? "row" : null,
    ]);
    return {
      type,
      name,
      roles,
      settings,
      settingIds: settings.map((setting) => setting.id).filter(Boolean),
      settingTypes: uniqueStrings(settings.map((setting) => setting.type).filter(Boolean)),
    };
  });

  return {
    blockModel: architecture?.blockModel || "none",
    interactionKind: architecture?.interactionKind || "static",
    mediaModel: architecture?.mediaModel || "none",
    navigationModel: architecture?.navigationModel || "none",
    requiredBlockSettings: architecture?.requiredBlockSettings || {},
    detectedBlocks,
  };
};

const schemaHasSettingByTypeOrId = (settings = [], { types = [], patterns = [] } = {}) =>
  (Array.isArray(settings) ? settings : []).some((setting) =>
    settingMatches(setting, patterns, types)
  );

const collectAllSchemaSettings = (schema) => [
  ...(Array.isArray(schema?.settings) ? schema.settings : []),
  ...getSchemaBlocks(schema).flatMap((block) =>
    Array.isArray(block?.settings) ? block.settings : []
  ),
];

const detectPromptExpectations = (requestText = "") => {
  const text = normalizeText(requestText);
  const sliderRequested = /\b(slider|carousel|slideshow|slides?|swipe)\b/.test(text);
  const videoRequested = /\b(videos?|video_url|youtube|vimeo|reels?)\b/.test(text);
  const imageRequested = /\b(images?|afbeelding(?:en)?|photos?|pictures?|media)\b/.test(text);
  const perSlideRequested =
    /\bper[-_ ]?slide\b/.test(text) ||
    (sliderRequested && /\b(each|every|per|elke|iedere)\b[\s\S]{0,50}\b(slide|slides)\b/.test(text));

  return {
    slides: sliderRequested,
    images: imageRequested,
    videos: videoRequested,
    perSlideVideo:
      videoRequested &&
      (perSlideRequested ||
        /\b(slides?|slider|carousel)\b[\s\S]{0,80}\bvideos?\b|\bvideos?\b[\s\S]{0,80}\b(slides?|slider|carousel)\b/.test(
          text
        )),
    autoplay: /\b(auto[-_ ]?play|automatisch afspelen|automatisch door)\b/.test(text),
    avatars: /\b(avatars?|customer photo|headshot|portrait|profielfoto(?:'s)?)\b/.test(text),
    reviews: /\b(reviews?|testimonial|beoordeling(?:en)?|ervaring(?:en)?)\b/.test(text),
    quotes: /\b(quotes?|citaten?|testimonial)\b/.test(text),
    reviewerNames: /\b(reviewer|reviewer name|customer name|author|naam|klantnaam)\b/.test(text),
    primaryButton: /\b(button|cta|knop|buttons|knoppen)\b/.test(text),
    secondaryButton:
      /\b(secondary|second|tweede|alternate|outline)\b[\s\S]{0,40}\b(button|cta|link|knop)\b/.test(text) ||
      /\b(two|2|twee)\b[\s\S]{0,30}\b(buttons?|ctas?|knoppen)\b/.test(text),
    dots: /\b(dots?|pagination|paginatie|bullets?)\b/.test(text),
    logos: /\b(logos?|brands?|merken|publications?|press|as seen in|featured in)\b/.test(text),
    faqItems: /\b(faq|frequently asked|questions?|vragen|accordion|collapsible)\b/.test(text),
    tabs: /\b(tabs?|tabbladen|panels?)\b/.test(text),
    comparisonRows: /\b(comparison|vergelijk(?:ing)?|compare|table|tabel|rows?|rijen|specs?)\b/.test(text),
    productSource: /\b(featured product|product section|product card|pdp|productpagina|product picker)\b/.test(text),
    collectionSource: /\b(featured collection|collection slider|collection grid|collectie|products grid|productlijst)\b/.test(text),
    newsletterSignup: /\b(newsletter|email signup|e-mail signup|subscribe|inschrijven|aanmelden)\b/.test(text),
    beforeAfter: /\b(before[-_ ]?after|voor[-_ ]?na|comparison slider|range compare)\b/.test(text),
  };
};

const buildPromptCoverage = ({ source, schema, requestText, architecture } = {}) => {
  const expectations = detectPromptExpectations(requestText);
  const slideBlocks = findBlocksByRole(schema, "slide");
  const reviewBlocks = findBlocksByRole(schema, "review");
  const logoBlocks = findBlocksByRole(schema, "logo");
  const faqBlocks = findBlocksByRole(schema, "faq_item");
  const tabBlocks = findBlocksByRole(schema, "tab");
  const rowBlocks = findBlocksByRole(schema, "row");
  const repeatableContentBlocks = [
    ...slideBlocks,
    ...reviewBlocks,
    ...logoBlocks,
    ...faqBlocks,
    ...tabBlocks,
    ...rowBlocks,
  ];
  const settings = collectAllSchemaSettings(schema);
  const sectionSettings = Array.isArray(schema?.settings) ? schema.settings : [];
  const lowerSource = String(source || "").toLowerCase();

  const slideHas = (config) =>
    slideBlocks.some((block) =>
      schemaHasSettingByTypeOrId(block?.settings || [], config)
    );
  const reviewHas = (config) =>
    reviewBlocks.some((block) =>
      schemaHasSettingByTypeOrId(block?.settings || [], config)
    );
  const anyHas = (config) => schemaHasSettingByTypeOrId(settings, config);
  const sectionHas = (config) => schemaHasSettingByTypeOrId(sectionSettings, config);
  const hasVideoMarkup =
    /<video\b|video_tag\b|<iframe\b|external_video_url\b|external_video_tag\b/i.test(
      source
    );
  const blockVideoRendered =
    /block\.settings\.[A-Za-z0-9_]*(?:video|external_video)[A-Za-z0-9_]*[\s\S]{0,120}(?:video_tag|external_video_url|external_video_tag)|(?:video_tag|external_video_url|external_video_tag)[\s\S]{0,120}block\.settings\.[A-Za-z0-9_]*(?:video|external_video)[A-Za-z0-9_]*/i.test(
      source
    );
  const blockImageRendered =
    /block\.settings\.[A-Za-z0-9_]*(?:image|media|photo|picture)[A-Za-z0-9_]*[\s\S]{0,160}image_url|image_url[\s\S]{0,160}block\.settings\.[A-Za-z0-9_]*(?:image|media|photo|picture)[A-Za-z0-9_]*/i.test(
      source
    );
  const sectionImageRendered =
    /section\.settings\.[A-Za-z0-9_]*(?:image|media|photo|picture)[A-Za-z0-9_]*[\s\S]{0,180}image_url|image_url[\s\S]{0,180}section\.settings\.[A-Za-z0-9_]*(?:image|media|photo|picture)[A-Za-z0-9_]*/i.test(
      source
    );
  const sectionButtonTextSetting = sectionHas({
    patterns: [/\b(button[_-]?(?:text|label)|cta[_-]?(?:text|label))\b/],
  });
  const sectionButtonLinkSetting = sectionHas({
    patterns: [/\b(button[_-]?(?:url|link)|cta[_-]?(?:url|link)|url)\b/],
    types: ["url"],
  });
  const sectionButtonRendered =
    /section\.settings\.[A-Za-z0-9_]*(?:button|cta)[A-Za-z0-9_]*(?:label|text)[A-Za-z0-9_]*|section\.settings\.[A-Za-z0-9_]*(?:button|cta)[A-Za-z0-9_]*(?:url|link)[A-Za-z0-9_]*/i.test(
      source
    );
  const features = {
    slides: {
      requested: expectations.slides,
      status:
        repeatableContentBlocks.length > 0 && sourceHasSectionBlocksLoop(source)
          ? "yes"
          : repeatableContentBlocks.length > 0 || sourceHasSectionBlocksLoop(source)
            ? "partial"
            : "no",
    },
    images: {
      requested: expectations.images,
      status:
        slideHas({ types: ["image_picker"], patterns: [/\b(image|media|photo|picture)\b/] }) &&
        blockImageRendered
          ? "yes"
          : sectionHas({
                types: ["image_picker"],
                patterns: [/\b(image|media|photo|picture)\b/],
              }) && sectionImageRendered
          ? "yes"
          : anyHas({ types: ["image_picker"], patterns: [/\b(image|media|photo|picture)\b/] })
            ? "partial"
            : "no",
    },
    videos: {
      requested: expectations.videos,
      status:
        slideHas({
          types: ["video", "video_url"],
          patterns: [/\b(video|external_video|youtube|vimeo)\b/],
        }) && blockVideoRendered
          ? "yes"
          : anyHas({
                types: ["video", "video_url"],
                patterns: [/\b(video|external_video|youtube|vimeo)\b/],
              }) && hasVideoMarkup
            ? "yes"
            : anyHas({
                  types: ["video", "video_url"],
                  patterns: [/\b(video|external_video|youtube|vimeo)\b/],
                })
              ? "partial"
              : "no",
      scope:
        slideHas({
          types: ["video", "video_url"],
          patterns: [/\b(video|external_video|youtube|vimeo)\b/],
        })
          ? "block"
          : sectionHas({
                types: ["video", "video_url"],
                patterns: [/\b(video|external_video|youtube|vimeo)\b/],
              })
            ? "section"
            : "none",
    },
    perSlideVideo: {
      requested: expectations.perSlideVideo,
      status:
        slideHas({
          types: ["video", "video_url"],
          patterns: [/\b(video|external_video|youtube|vimeo)\b/],
        }) && blockVideoRendered
          ? "yes"
          : sectionHas({
                types: ["video", "video_url"],
                patterns: [/\b(video|external_video|youtube|vimeo)\b/],
              })
            ? "partial"
            : "no",
    },
    autoplay: {
      requested: expectations.autoplay,
      status: /setInterval|data-autoplay|autoplay|requestAnimationFrame/i.test(source)
        ? "yes"
        : "no",
    },
    avatars: {
      requested: expectations.avatars,
      status:
        (slideHas({
          types: ["image_picker"],
          patterns: [/\b(avatar|customer[_-]?photo|headshot|portrait)\b/],
        }) ||
          reviewHas({
            types: ["image_picker"],
            patterns: [/\b(avatar|customer[_-]?photo|headshot|portrait)\b/],
          })) &&
        /block\.settings\.[A-Za-z0-9_]*avatar[A-Za-z0-9_]*/i.test(source)
          ? "yes"
          : anyHas({
                types: ["image_picker"],
                patterns: [/\b(avatar|customer[_-]?photo|headshot|portrait)\b/],
              })
            ? "partial"
            : "no",
    },
    reviews: {
      requested: expectations.reviews || expectations.quotes,
      status:
        (slideHas({
          patterns: [/\b(quote|review|testimonial|comment)\b/],
          types: ["textarea", "richtext", "inline_richtext", "text"],
        }) ||
          reviewHas({
            patterns: [/\b(quote|review|testimonial|comment)\b/],
            types: ["textarea", "richtext", "inline_richtext", "text"],
          })) &&
        /block\.settings\.[A-Za-z0-9_]*(?:quote|review|testimonial|comment)[A-Za-z0-9_]*/i.test(source)
          ? "yes"
          : /[★☆]|premium uitstraling|review|testimonial|quote/i.test(source)
            ? "partial"
            : "no",
    },
    reviewerNames: {
      requested: expectations.reviewerNames || expectations.reviews,
      status:
        (slideHas({
          patterns: [/\b(author|customer|reviewer|name|naam|person)\b/],
          types: ["text"],
        }) ||
          reviewHas({
            patterns: [/\b(author|customer|reviewer|name|naam|person)\b/],
            types: ["text"],
          })) &&
        /block\.settings\.[A-Za-z0-9_]*(?:author|customer|reviewer|name|naam)[A-Za-z0-9_]*/i.test(source)
          ? "yes"
          : anyHas({
                patterns: [/\b(author|customer|reviewer|name|naam|person)\b/],
                types: ["text"],
              })
            ? "partial"
            : "no",
    },
    primaryButton: {
      requested: expectations.primaryButton,
      status:
        slideHas({ patterns: [/\b(button[_-]?text|button[_-]?label|cta[_-]?text)\b/] }) &&
        slideHas({ patterns: [/\b(button[_-]?link|cta[_-]?link|url)\b/], types: ["url"] })
          ? "yes"
          : sectionButtonTextSetting && sectionButtonLinkSetting && sectionButtonRendered
          ? "yes"
          : /<a\b|<button\b/i.test(source)
            ? "partial"
            : "no",
    },
    secondaryButton: {
      requested: expectations.secondaryButton,
      status:
        slideHas({
          patterns: [/\bsecondary[_-]?button[_-]?text\b/, /\bsecond[_-]?button[_-]?text\b/],
        }) &&
        slideHas({
          patterns: [/\bsecondary[_-]?button[_-]?link\b/, /\bsecond[_-]?button[_-]?link\b/],
          types: ["url"],
        })
          ? "yes"
          : /secondary|second|outline/.test(lowerSource)
            ? "partial"
            : "no",
    },
    dots: {
      requested: expectations.dots,
      status: /data-dots|data-dot|pagination|__dot|[-_]dot\b/i.test(source)
        ? "yes"
        : "no",
    },
    logos: {
      requested: expectations.logos,
      status:
        logoBlocks.length > 0 &&
        sourceHasSectionBlocksLoop(source) &&
        (/data-section-logo-item/i.test(source) ||
          /block\.settings\.[A-Za-z0-9_]*(?:logo|brand|publication|press|name|text)[A-Za-z0-9_]*/i.test(
            source
          ))
          ? "yes"
          : logoBlocks.length > 0 ||
              anyHas({
                types: ["image_picker", "text"],
                patterns: [/\b(logo|brand|publication|press)\b/],
              })
            ? "partial"
            : "no",
    },
    faqItems: {
      requested: expectations.faqItems,
      status:
        faqBlocks.length > 0 &&
        sourceHasSectionBlocksLoop(source) &&
        /<details\b|<summary\b|aria-expanded|data-section-accordion/i.test(source)
          ? "yes"
          : faqBlocks.length > 0
            ? "partial"
            : "no",
    },
    tabs: {
      requested: expectations.tabs,
      status:
        tabBlocks.length > 0 &&
        sourceHasSectionBlocksLoop(source) &&
        /role\s*=\s*["']tab|data-section-tabs|data-tab|aria-controls/i.test(source)
          ? "yes"
          : tabBlocks.length > 0
            ? "partial"
            : "no",
    },
    comparisonRows: {
      requested: expectations.comparisonRows,
      status:
        rowBlocks.length > 0 &&
        sourceHasSectionBlocksLoop(source) &&
        /<table\b|data-section-comparison|comparison|block\.settings\.[A-Za-z0-9_]*(?:label|feature|benefit|value|content|text)[A-Za-z0-9_]*/i.test(
          source
        )
          ? "yes"
          : rowBlocks.length > 0
            ? "partial"
            : "no",
    },
    productSource: {
      requested: expectations.productSource,
      status:
        anyHas({ types: ["product"], patterns: [/\bproduct\b/] }) &&
        /section\.settings\.[A-Za-z0-9_]*product[A-Za-z0-9_]*|product\./i.test(
          source
        )
          ? "yes"
          : /product\./i.test(source) ||
              anyHas({ types: ["product"], patterns: [/\bproduct\b/] })
            ? "partial"
            : "no",
    },
    collectionSource: {
      requested: expectations.collectionSource,
      status:
        anyHas({ types: ["collection"], patterns: [/\bcollection|collectie\b/] }) &&
        /section\.settings\.[A-Za-z0-9_]*(?:collection|collectie)[A-Za-z0-9_]*|collection\.products/i.test(
          source
        )
          ? "yes"
          : /collection\.products/i.test(source) ||
              anyHas({ types: ["collection"], patterns: [/\bcollection|collectie\b/] })
            ? "partial"
            : "no",
    },
    newsletterSignup: {
      requested: expectations.newsletterSignup,
      status: /{%-?\s*form\s+['"]customer['"]|name\s*=\s*["']contact\[email\]|type\s*=\s*["']email["']/i.test(
        source
      )
        ? "yes"
        : "no",
    },
    beforeAfter: {
      requested: expectations.beforeAfter,
      status:
        anyHas({ types: ["image_picker"], patterns: [/\bbefore|voor\b/] }) &&
        anyHas({ types: ["image_picker"], patterns: [/\bafter|na\b/] }) &&
        /type\s*=\s*["']range["']|data-section-before-after|clip-path|--before-after/i.test(
          source
        )
          ? "yes"
          : anyHas({ types: ["image_picker"], patterns: [/\bbefore|voor|after|na\b/] })
            ? "partial"
            : "no",
    },
  };

  const requestedEntries = Object.entries(features).filter(
    ([, feature]) => feature.requested
  );
  const passed = requestedEntries.filter(([, feature]) => feature.status === "yes")
    .length;
  const partial = requestedEntries.filter(
    ([, feature]) => feature.status === "partial"
  ).length;
  const missing = requestedEntries
    .filter(([, feature]) => feature.status !== "yes")
    .map(([key, feature]) => ({ key, status: feature.status, scope: feature.scope }));

  return {
    score:
      requestedEntries.length === 0
        ? 1
        : Number(((passed + partial * 0.5) / requestedEntries.length).toFixed(2)),
    requestedCount: requestedEntries.length,
    passedCount: passed,
    partialCount: partial,
    missingCount: missing.filter((entry) => entry.status === "no").length,
    missing,
    features,
    architecture: {
      blockModel: architecture?.blockModel || "none",
      mediaModel: architecture?.mediaModel || "none",
      navigationModel: architecture?.navigationModel || "none",
    },
  };
};

const describeBlockContract = (role, requirements = []) => ({
  role,
  requiredSettings: Array.isArray(requirements) ? requirements : [],
  renderThrough: "section.blocks",
  editorAttributes:
    "Put {{ block.shopify_attributes }} on the top-level rendered block wrapper.",
});

const buildFeatureContractEntries = ({ expectations, architecture }) => {
  const entries = [];
  const blockLevel =
    architecture?.contentModel === "block_settings" ||
    ["slides", "mixed_blocks", "repeated_cards", "repeated_reviews"].includes(
      architecture?.blockModel
    );
  const mediaModel = architecture?.mediaModel || "none";

  const add = (feature, requirement) => {
    if (expectations?.[feature]) {
      entries.push({ feature, ...requirement });
    }
  };

  add("slides", {
    schema: "schema.blocks must define real slide/card blocks.",
    render:
      "Render slides/cards from section.blocks, not hardcoded duplicated markup.",
  });
  add("images", {
    schema: blockLevel
      ? "Use block-level image_picker settings for repeated media."
      : "Use a section-level image_picker setting for single media.",
    render: "Guard blank images and render Shopify images with image_url + image_tag.",
  });
  add("videos", {
    schema:
      mediaModel === "block_level_video"
        ? "Use block-level video and/or video_url settings."
        : "Use a merchant-editable video or video_url setting.",
    render:
      "Guard blank videos; hosted Shopify video uses video_tag, external video_url uses external_video_tag/url.",
  });
  add("perSlideVideo", {
    schema:
      "Each slide block must expose video and/or video_url settings; section-level video is not enough.",
    render:
      "Render video from block.settings inside the active slide and pause inactive slide media.",
  });
  add("autoplay", {
    schema: "Expose autoplay/pause controls as section settings when useful.",
    render:
      "Autoplay must respect prefers-reduced-motion and pause on hover/focus/manual interaction.",
  });
  add("avatars", {
    schema: "Use block-level image_picker avatar/customer photo settings.",
    render: "Render avatars from block.settings with image_url + image_tag behind blank guards.",
  });
  add("reviews", {
    schema: "Use block-level quote/comment/review text settings.",
    render: "Render merchant-editable quote/review text from block.settings.",
  });
  add("quotes", {
    schema: "Use block-level quote/comment richtext or textarea settings.",
    render: "Render quotes from block.settings, not hardcoded fallback-only copy.",
  });
  add("reviewerNames", {
    schema: "Use block-level author/reviewer/customer name settings.",
    render: "Render reviewer names from block.settings.",
  });
  add("primaryButton", {
    schema: "Use merchant-editable button_text/button_link or CTA label/link settings.",
    render: "Render CTAs only when the label and/or link exists; keep accessible link/button semantics.",
  });
  add("secondaryButton", {
    schema:
      "Use separate secondary_button_text and secondary_button_link settings.",
    render: "Render the secondary CTA as a distinct merchant-editable CTA.",
  });
  add("dots", {
    schema: "No extra section.blocks loop is required for dots.",
    render:
      "Generate dots/pagination from initialized slides in JS or non-block markup and keep active state synced.",
  });
  add("logos", {
    schema: "Use logo/brand blocks with image_picker or text fallback settings.",
    render: "Render logos from section.blocks and mark logo items with data-section-logo-item.",
  });
  add("faqItems", {
    schema: "Use FAQ item blocks with question and answer settings.",
    render: "Render accessible accordion/disclosure UI, preferably details/summary.",
  });
  add("tabs", {
    schema: "Use tab blocks with tab_title and tab_content settings.",
    render: "Render accessible tabs with role/aria wiring or a robust disclosure fallback.",
  });
  add("comparisonRows", {
    schema: "Use row/feature blocks with label/title and content/value settings.",
    render: "Render comparison rows from section.blocks; do not hardcode all rows.",
  });
  add("productSource", {
    schema: "Use a product setting or the real product template context.",
    render: "Render product data from product/section.settings product objects, not fake static commerce.",
  });
  add("collectionSource", {
    schema: "Use a collection setting or the real collection template context.",
    render: "Render products from a real collection source, not static placeholder product cards.",
  });
  add("newsletterSignup", {
    schema: "Expose heading/copy/button labels as settings where relevant.",
    render: "Use a Shopify customer/contact form with an email input.",
  });
  add("beforeAfter", {
    schema: "Use before and after image_picker settings.",
    render: "Render a functional before/after interaction, not two static images only.",
  });

  return entries;
};

const buildSectionDataContract = ({
  requestText = "",
  sectionKind = "unknown",
  architecture = null,
  sectionBlueprint = null,
} = {}) => {
  const expectations = detectPromptExpectations(requestText);
  const requiredFeatures = Object.entries(expectations)
    .filter(([, requested]) => requested)
    .map(([feature]) => feature);
  const requiredBlockSettings = architecture?.requiredBlockSettings || {};
  const blockContracts = Object.entries(requiredBlockSettings)
    .filter(([, requirements]) => Array.isArray(requirements) && requirements.length > 0)
    .map(([role, requirements]) => describeBlockContract(role, requirements));
  const featureContracts = buildFeatureContractEntries({
    expectations,
    architecture,
  });
  const isInteractive =
    isSliderInteraction(architecture?.interactionKind) ||
    ["accordion", "tabs"].includes(architecture?.interactionKind);

  return {
    version: CODEGEN_CONTRACT_VERSION,
    sectionKind,
    archetype: sectionBlueprint?.archetype || null,
    requiredFeatures,
    dataModel: {
      interactionKind: architecture?.interactionKind || "static",
      blockModel: architecture?.blockModel || "none",
      mediaModel: architecture?.mediaModel || "none",
      navigationModel: architecture?.navigationModel || "none",
      contentModel: architecture?.contentModel || "section_settings",
      blockRoles: Array.isArray(architecture?.blockRoles)
        ? architecture.blockRoles
        : [],
    },
    requiredSchema: {
      exactlyOneSchemaBlock: true,
      presetsRequired: true,
      blockContracts,
      settingRules: [
        "All merchant-editable settings need stable id, type and label.",
        "Extra settings are allowed; required settings are minimums, not exact shapes.",
        "Use video for Shopify-hosted videos and video_url only for external YouTube/Vimeo embeds.",
      ],
    },
    requiredRenderPaths: uniqueStrings([
      "Render every requested feature from merchant-editable section/block settings or real Shopify context.",
      "Render optional media behind blank-safe guards.",
      ...(architecture?.mediaModel === "block_level_video"
        ? ["Per-item/per-slide video must be read from block.settings, not section.settings."]
        : []),
      ...(architecture?.blockModel && architecture.blockModel !== "none"
        ? ["Render repeated content through one primary section.blocks loop."]
        : []),
    ]),
    interactionRequirements: uniqueStrings([
      ...(isInteractive
        ? [
            "Scope JS per section instance.",
            "Support Shopify Theme Editor load/select lifecycle or use idempotent custom elements.",
          ]
        : []),
      ...(isSliderInteraction(architecture?.interactionKind)
        ? [
            "Use one coherent slider strategy with synced index, controls and pagination.",
            "Autoplay must pause on hover/focus/manual interaction and respect prefers-reduced-motion.",
          ]
        : []),
    ]),
    featureContracts,
    completionGate: {
      promptCoverageGapsBlockCreate: true,
      partialCoverageIsNotComplete: true,
      doNotRemoveRequestedFeaturesToPassValidation: true,
    },
  };
};

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
  const architectureDiagnostics = buildArchitectureDiagnostics({ schema, architecture });

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
          details: {
            detectedBlocks: architectureDiagnostics.detectedBlocks,
            required: requiredBlockSettings.slide || ["heading", "text"],
            result: "fail",
          },
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

  if (schema && blockModel === "repeated_cards") {
    const cardBlocks = getSchemaBlocks(schema).filter(
      (block) => !isLogoBlock(block)
    );
    if (cardBlocks.length === 0) {
      issues.push(
        createIssue({
          code: "architecture_missing_card_blocks",
          path: [fileKey, "schema", "blocks"],
          message:
            "The codegen architecture requires repeated merchant-editable card blocks, but no suitable card block type is defined.",
          fixSuggestion:
            "Add card/item blocks with merchant-editable media/content settings and render them through section.blocks.",
        })
      );
    }
    for (const block of cardBlocks) {
      const blockType = String(block?.type || "card");
      issues.push(
        ...collectMissingBlockSettingIssues({
          block,
          role: "card",
          fileKey,
          blockType,
          requirements: requiredBlockSettings.card || ["heading_or_title", "text_or_caption"],
        })
      );
    }
  }

  if (schema && blockModel === "rows") {
    const rowBlocks = findBlocksByRole(schema, "row");
    if (rowBlocks.length === 0) {
      issues.push(
        createIssue({
          code: "architecture_missing_row_blocks",
          path: [fileKey, "schema", "blocks"],
          message:
            "The codegen architecture requires comparison/row blocks, but no row block type is defined.",
          fixSuggestion:
            "Add row blocks with merchant-editable label/title and content/value settings, then render them through section.blocks.",
        })
      );
    }
    for (const block of rowBlocks) {
      const blockType = String(block?.type || "row");
      issues.push(
        ...collectMissingBlockSettingIssues({
          block,
          role: "row",
          fileKey,
          blockType,
          requirements: requiredBlockSettings.row || ["label_or_title", "content"],
        })
      );
    }
  }

  if (schema && blockModel === "faq_items") {
    const faqBlocks = findBlocksByRole(schema, "faq_item");
    if (faqBlocks.length === 0) {
      issues.push(
        createIssue({
          code: "architecture_missing_faq_item_blocks",
          path: [fileKey, "schema", "blocks"],
          message:
            "The codegen architecture requires FAQ item blocks, but no question/answer block type is defined.",
          fixSuggestion:
            "Add FAQ item blocks with merchant-editable question and answer settings, then render them through section.blocks.",
        })
      );
    }
    for (const block of faqBlocks) {
      const blockType = String(block?.type || "faq_item");
      issues.push(
        ...collectMissingBlockSettingIssues({
          block,
          role: "faq_item",
          fileKey,
          blockType,
          requirements: requiredBlockSettings.faq_item || ["question", "answer"],
        })
      );
    }
  }

  if (schema && blockModel === "tabs") {
    const tabBlocks = findBlocksByRole(schema, "tab");
    if (tabBlocks.length === 0) {
      issues.push(
        createIssue({
          code: "architecture_missing_tab_blocks",
          path: [fileKey, "schema", "blocks"],
          message:
            "The codegen architecture requires tab blocks, but no tab block type is defined.",
          fixSuggestion:
            "Add tab blocks with merchant-editable tab title and tab content settings, then render them through section.blocks.",
        })
      );
    }
    for (const block of tabBlocks) {
      const blockType = String(block?.type || "tab");
      issues.push(
        ...collectMissingBlockSettingIssues({
          block,
          role: "tab",
          fileKey,
          blockType,
          requirements: requiredBlockSettings.tab || ["tab_title", "tab_content"],
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
          sectionDataContract:
            codegenContract.sectionDataContract ||
            buildSectionDataContract({
              requestText,
              sectionKind,
              architecture,
              sectionBlueprint,
            }),
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
  const architectureDiagnostics = buildArchitectureDiagnostics({
    schema: parsed.schema,
    architecture: effectiveContract.architecture,
  });
  const promptCoverage = buildPromptCoverage({
    source,
    schema: parsed.schema,
    requestText,
    architecture: effectiveContract.architecture,
  });
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

  if (
    VISUAL_PROFILES.has(effectiveProfile) &&
    promptCoverage.requestedCount > 0 &&
    promptCoverage.missing.length > 0
  ) {
    const explicitPromptText =
      hasExplicitPromptText(requestText) ||
      sectionBlueprint?.promptContract?.promptOnly === true ||
      sectionBlueprint?.qualityTarget === "exact_match";
    const blockCoverageGap =
      explicitPromptText &&
      (mode === "create" ||
        intent === "new_section" ||
        effectiveProfile === "exact_replica");
    const coverageIssue = createIssue({
      code: "prompt_coverage_partial",
      severity: blockCoverageGap ? "error" : "warning",
      path: [fileKey],
      message:
        `Prompt coverage is ${promptCoverage.score}; missing or partial requested features: ${promptCoverage.missing
          .map((entry) => `${entry.key}${entry.status === "partial" ? " (partial)" : ""}`)
          .join(", ")}.`,
      fixSuggestion:
        "Preserve the requested data model and add targeted merchant-editable settings/render paths instead of simplifying the section to pass validation.",
      details: promptCoverage,
      diagnostics: {
        sectionDataContract: effectiveContract.sectionDataContract || null,
      },
    });
    if (blockCoverageGap) {
      issues.push(coverageIssue);
    } else {
      warnings.push(coverageIssue);
    }
  }

  const blockingIssues = issues.filter((issue) => issue.severity !== "warning");
  const allIssues = [...blockingIssues, ...warnings];

  return {
    ok: blockingIssues.length === 0,
    validationProfile: effectiveProfile,
    sectionKind,
    codegenContract: effectiveContract,
    architectureDiagnostics,
    promptCoverage,
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
  buildSectionDataContract,
  buildSectionRepairPrompt,
  inferSectionArchitecture,
  inferSectionKind,
  inferValidationProfile,
  parseSectionSchemaStrict,
  preflightSectionLiquid,
};
