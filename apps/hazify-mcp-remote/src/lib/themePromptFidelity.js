const STRICT_ARCHETYPES = [
  "single_media_story",
  "hero_banner",
  "image_with_text",
  "feature_grid",
  "testimonial_carousel",
  "logo_marquee",
  "faq",
  "comparison_table",
  "product_showcase",
  "collection_grid",
  "before_after",
  "newsletter",
  "tabs",
  "custom_static_section",
];

const STRICT_ARCHETYPE_SET = new Set(STRICT_ARCHETYPES);
const SECTION_KIND_BY_ARCHETYPE = {
  single_media_story: "static_media_content",
  hero_banner: "hero",
  image_with_text: "media_content",
  feature_grid: "feature_media_list",
  testimonial_carousel: "review_carousel",
  logo_marquee: "logo_marquee",
  faq: "faq",
  comparison_table: "comparison",
  product_showcase: "product_related",
  collection_grid: "product_related",
  before_after: "media_content",
  newsletter: "content",
  tabs: "tabs",
  custom_static_section: "content",
};

const normalizeWhitespace = (value) =>
  String(value || "").replace(/\s+/g, " ").trim();

const normalizeForSearch = (value) =>
  normalizeWhitespace(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&eacute;|&#233;|&#x[eE]9;/g, "e")
    .replace(/&euml;|&#235;|&#x[eE][bB];/g, "e")
    .toLowerCase();

const stringifyBrief = (value) => {
  if (!value) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

const buildPromptText = ({
  prompt = "",
  visualBrief = "",
  referenceAnalysis = "",
  designBrief = "",
  sectionTypeHint = "",
  fileKey = "",
} = {}) =>
  normalizeWhitespace(
    [
      prompt,
      stringifyBrief(visualBrief),
      stringifyBrief(referenceAnalysis),
      stringifyBrief(designBrief),
      sectionTypeHint,
      fileKey,
    ]
      .filter(Boolean)
      .join(" ")
  );

const matchAny = (text, patterns) =>
  patterns.some((pattern) => {
    pattern.lastIndex = 0;
    return pattern.test(text);
  });

const explicitNegationFor = (text, featurePattern) =>
  new RegExp(
    `\\b(?:no|not|without|geen|niet|zonder)\\s+(?:a\\s+|an\\s+|een\\s+)?(?:${featurePattern})\\b`,
    "i"
  ).test(text);

const hasRepeatingLogoIntent = (normalizedText) =>
  matchAny(normalizedText, [
    /\b(?:logo|brand|partner|publication|press|merk)(?:s|en)?\b.{0,50}\b(?:marquee|ticker|strip|wall|grid|list|carousel|slider|repeating|scrolling|infinite|loop|rij|balk)\b/i,
    /\b(?:marquee|ticker|strip|wall|grid|carousel|slider|scrolling|infinite|loop)\b.{0,50}\b(?:logo|brand|partner|publication|press|merk)(?:s|en)?\b/i,
    /\b(?:as seen in|featured in|bekend van|gezien in|partnerlogo|partner logo|brand strip|logo strip|logo wall|logo showcase)\b/i,
  ]);

const hasCarouselIntent = (normalizedText) =>
  !explicitNegationFor(normalizedText, "slider|carousel|slideshow|slides?|cards?|kaart(?:en)?|marquee") &&
  matchAny(normalizedText, [
    /\b(?:slider|carousel|slideshow|slides?|swipeable|prev(?:ious)?|next|arrows?|dots?|pagination)\b/i,
    /\b(?:multiple|several|meerdere|verschillende|repeated|repeatable|herhaalbare)\b.{0,40}\b(?:cards?|slides?|items?|kaarten)\b/i,
    /\b(?:cards?|kaarten)\b.{0,40}\b(?:slider|carousel|track|scroll|swipe)\b/i,
  ]);

const hasSingleMediaStoryIntent = (normalizedText) => {
  const mediaSignals = [
    /\b(?:single|one|een|1)\b.{0,40}\b(?:media|image|video|preview|kaart|card)\b/i,
    /\b(?:media card|media kaart|video preview|image\/video|image or video|afbeelding\/video|image picker|image_picker)\b/i,
    /\b(?:play button|play knop|bekijk video|video pill|video button)\b/i,
    /\b(?:title below|heading below|titel onder|title around|body centered)\b/i,
  ].filter((pattern) => pattern.test(normalizedText)).length;
  const textSignals = [
    /\blive your\b/i,
    /\bdreams\b/i,
    /\bons verhaal\b/i,
    /\bje leeft maar een keer\b/i,
    /\bsplit heading|italic serif|richtext|body centered|dutch copy\b/i,
  ].filter((pattern) => pattern.test(normalizedText)).length;
  return mediaSignals >= 2 || (mediaSignals >= 1 && textSignals >= 2);
};

const extractPromptFacts = ({
  prompt = "",
  visualBrief = "",
  referenceAnalysis = "",
  designBrief = "",
  sectionTypeHint = "",
  fileKey = "",
} = {}) => {
  const rawText = buildPromptText({
    prompt,
    visualBrief,
    referenceAnalysis,
    designBrief,
    sectionTypeHint,
    fileKey,
  });
  const text = normalizeForSearch(rawText);
  const logoOverlayOnly =
    /\b(?:small|klein|optional|optioneel)?\s*(?:logo|brand)\b.{0,50}\b(?:top right|rechtsboven|overlay|badge)\b/i.test(
      text
    ) &&
    !hasRepeatingLogoIntent(text);
  const explicitlyForbidsCarousel =
    explicitNegationFor(text, "slider|carousel|slideshow|slides?|card blocks?|cards?|kaarten|marquee");
  const explicitlyForbidsMarquee =
    explicitNegationFor(text, "marquee|logo marquee|logo strip|logo wall|repeating logos?|scrolling logos?");

  const positiveSignals = [];
  const negativeSignals = [];
  const addSignal = (condition, value) => {
    if (condition) {
      positiveSignals.push(value);
    }
  };
  const addNegative = (condition, value) => {
    if (condition) {
      negativeSignals.push(value);
    }
  };

  addSignal(/\bmedia card|media kaart\b/.test(text), "media card");
  addSignal(/\bimage\/video|video preview|image picker|image_picker|afbeelding\/video\b/.test(text), "image/video preview");
  addSignal(/\bplay button|play knop|bekijk video\b/.test(text), "play button");
  addSignal(/\btitle below|titel onder|heading below\b/.test(text), "title below");
  addSignal(/\bcta|button|knop|ons verhaal\b/.test(text), "CTA");
  addSignal(/\bdesktop\b/.test(text) && /\bmobile|mobiel\b/.test(text), "desktop/mobile");
  addSignal(logoOverlayOnly, "optional logo overlay");
  addNegative(!hasCarouselIntent(text), "no multiple cards/slides");
  addNegative(!hasRepeatingLogoIntent(text), "no repeated logos/marquee");
  addNegative(logoOverlayOnly, "logo is overlay only");
  addNegative(explicitlyForbidsCarousel, "carousel/card blocks explicitly forbidden");
  addNegative(explicitlyForbidsMarquee, "marquee explicitly forbidden");

  return {
    rawText,
    normalizedText: text,
    positiveSignals: Array.from(new Set(positiveSignals)),
    negativeSignals: Array.from(new Set(negativeSignals)),
    logoOverlayOnly,
    explicitlyForbidsCarousel,
    explicitlyForbidsMarquee,
    singleMediaStoryIntent: hasSingleMediaStoryIntent(text),
    repeatingLogoIntent: hasRepeatingLogoIntent(text),
    carouselIntent: hasCarouselIntent(text),
  };
};

const normalizeOverride = (value) => {
  const normalized = normalizeForSearch(value).replace(/\s+/g, "_");
  return STRICT_ARCHETYPE_SET.has(normalized) ? normalized : null;
};

const classifyArchetype = ({
  prompt = "",
  visualBrief = "",
  referenceAnalysis = "",
  designBrief = "",
  sectionTypeHint = "",
  fileKey = "",
  archetypeOverride = null,
} = {}) => {
  const facts = extractPromptFacts({
    prompt,
    visualBrief,
    referenceAnalysis,
    designBrief,
    sectionTypeHint,
    fileKey,
  });
  const override = normalizeOverride(archetypeOverride);
  const rejectedArchetypes = [];
  const reject = (archetype, reason) => {
    rejectedArchetypes.push({ archetype, reason });
  };

  let archetype = "custom_static_section";
  let confidence = 0.45;
  let source = "fallback";

  if (override) {
    archetype = override;
    confidence = 0.96;
    source = "override";
  } else if (facts.singleMediaStoryIntent) {
    archetype = "single_media_story";
    confidence = 0.94;
    source = "prompt";
    reject("logo_marquee", "logo signal is an optional overlay or no repeated logo strip was requested");
    reject("testimonial_carousel", "no review/testimonial carousel intent");
    reject("hero_banner", "media/content story requested rather than full hero/banner");
  } else if (facts.repeatingLogoIntent && !facts.logoOverlayOnly) {
    archetype = "logo_marquee";
    confidence = 0.91;
    source = "prompt";
  } else if (facts.carouselIntent && /\b(?:review|testimonial|quote|beoordeling|ervaring)\b/i.test(facts.normalizedText)) {
    archetype = "testimonial_carousel";
    confidence = 0.88;
    source = "prompt";
  } else if (/\b(?:faq|frequently asked|vragen|accordion|collapsible)\b/i.test(facts.normalizedText)) {
    archetype = "faq";
    confidence = 0.86;
    source = "prompt";
  } else if (/\b(?:comparison|vergelijk|compare|table|tabel|vs)\b/i.test(facts.normalizedText)) {
    archetype = "comparison_table";
    confidence = 0.84;
    source = "prompt";
  } else if (/\b(?:newsletter|email signup|subscribe|inschrijven|aanmelden)\b/i.test(facts.normalizedText)) {
    archetype = "newsletter";
    confidence = 0.82;
    source = "prompt";
  } else if (/\btabs?\b|tabbladen/i.test(facts.normalizedText)) {
    archetype = "tabs";
    confidence = 0.82;
    source = "prompt";
  } else if (/\b(?:hero|banner|masthead)\b/i.test(facts.normalizedText)) {
    archetype = "hero_banner";
    confidence = 0.78;
    source = "prompt";
  } else if (/\b(?:image with text|image_with_text|afbeelding met tekst|media text)\b/i.test(facts.normalizedText)) {
    archetype = "image_with_text";
    confidence = 0.78;
    source = "prompt";
  }

  if (archetype !== "logo_marquee" && facts.logoOverlayOnly) {
    reject("logo_marquee", "small logo top-right overlay is a section setting, not repeated logo content");
  }
  if (archetype !== "testimonial_carousel" && !facts.carouselIntent) {
    reject("testimonial_carousel", "no slides/cards/arrows/dots requested");
  }
  if (archetype !== "single_media_story" && facts.singleMediaStoryIntent) {
    reject("single_media_story", "lower-priority classifier was selected despite media story signals");
  }

  const sectionKind = SECTION_KIND_BY_ARCHETYPE[archetype] || "content";
  const interactionKind =
    archetype === "logo_marquee"
      ? "marquee"
      : archetype === "testimonial_carousel"
        ? "carousel"
        : archetype === "faq"
          ? "accordion"
          : archetype === "tabs"
            ? "tabs"
            : "none";
  const blockModel =
    archetype === "logo_marquee"
      ? "logos"
      : archetype === "testimonial_carousel"
        ? "repeated_reviews"
        : archetype === "faq"
          ? "faq_items"
          : archetype === "tabs"
            ? "tabs"
            : "none";
  const blocksAllowed = blockModel !== "none";

  return {
    archetype,
    sectionKind,
    interactionKind,
    blockModel,
    blocksAllowed,
    confidence,
    source,
    facts,
    positiveSignals: facts.positiveSignals,
    negativeSignals: facts.negativeSignals,
    rejectedArchetypes,
  };
};

const SINGLE_MEDIA_STORY_FEATURES = [
  "single_media_card",
  "image_picker",
  "video",
  "external_video_url",
  "overlay_play_button",
  "optional_logo_overlay",
  "split_heading_with_italic_accent",
  "richtext_body",
  "primary_cta",
  "responsive_desktop_mobile",
  "title_animation_prefers_reduced_motion",
];

const SINGLE_MEDIA_STORY_FORBIDDEN = [
  "carousel",
  "slider",
  "marquee",
  "logo_marquee",
  "card_blocks",
  "testimonials",
  "prev_next_controls",
  "scrollBy",
  "required_section_blocks",
];

const makePattern = (label, pattern, weight = 1) => ({
  label,
  pattern,
  weight,
});

const SINGLE_MEDIA_STORY_REQUIRED_ANCHORS = [
  makePattern("Bekijk video", /\bBekijk\s+video\b/i, 1.2),
  makePattern("Live your", /\bLive\s+your\b/i, 1.2),
  makePattern("dreams.", /\bdreams\./i, 1.2),
  makePattern("Je leeft maar een keer", /\bJe\s+leeft\s+maar\s+(?:een|één|&eacute;&eacute;n)\s+keer\b/i, 1.2),
  makePattern("Ons verhaal", /\bOns\s+verhaal\b/i, 1.2),
  makePattern("image_picker", /"type"\s*:\s*"image_picker"/i, 1),
  makePattern("video", /"type"\s*:\s*"video"/i, 1),
  makePattern("video_url", /"type"\s*:\s*"video_url"/i, 0.8),
  makePattern("button_label or CTA setting", /\b(?:button_label|button_text|cta_label|primary_button_text)\b/i, 0.9),
  makePattern("richtext body setting", /"type"\s*:\s*"richtext"[\s\S]{0,160}"id"\s*:\s*"(?:text|body|copy|description)"/i, 0.9),
  makePattern("overlay play button markup", /\b(?:play|video)[\w-]*\b[\s\S]{0,160}\bBekijk\s+video\b|\bBekijk\s+video\b[\s\S]{0,160}\b(?:play|video)[\w-]*\b/i, 1),
  makePattern("aspect-ratio", /aspect-ratio\s*:/i, 0.9),
  makePattern("border-radius", /border-radius\s*:/i, 0.8),
  makePattern("@media", /@media\b/i, 0.8),
  makePattern("prefers-reduced-motion", /prefers-reduced-motion/i, 1),
];

const SINGLE_MEDIA_STORY_FORBIDDEN_ARTIFACTS = [
  makePattern("data-dream-prev", /data-dream-prev/i, 1),
  makePattern("data-dream-next", /data-dream-next/i, 1),
  makePattern("Previous card", /Previous\s+card/i, 1),
  makePattern("Next card", /Next\s+card/i, 1),
  makePattern("scrollBy", /\bscrollBy\s*\(/i, 1),
  makePattern("carousel", /\bcarousel\b|data-[\w-]*carousel|carousel controls/i, 1),
  makePattern("slider", /\bslider\b|data-[\w-]*slider/i, 0.9),
  makePattern("marquee", /\bmarquee\b|data-[\w-]*marquee/i, 1),
  makePattern("Card block schema", /"blocks"\s*:\s*\[[\s\S]{0,900}"type"\s*:\s*"card"|"type"\s*:\s*"card"[\s\S]{0,900}"name"\s*:\s*"Card"/i, 1),
  makePattern("section.blocks required", /\bfor\s+block\s+in\s+section\.blocks\b|section\.blocks|block\.settings/i, 1),
  makePattern("Kicker", /\bKicker\b|card-kicker|__card-kicker/i, 0.9),
  makePattern("Built for momentum", /Built\s+for\s+momentum/i, 1),
  makePattern("A sharper way to launch every moment.", /A\s+sharper\s+way\s+to\s+launch\s+every\s+moment\./i, 1),
];

const buildSectionContract = ({
  archetype,
  facts = null,
  prompt = "",
  visualBrief = "",
  referenceAnalysis = "",
  designBrief = "",
} = {}) => {
  const effectiveFacts =
    facts ||
    extractPromptFacts({
      prompt,
      visualBrief,
      referenceAnalysis,
      designBrief,
    });
  if (archetype === "single_media_story") {
    return {
      archetype,
      sectionKind: "static_media_content",
      interactionKind: "none",
      blockModel: "none",
      blocksAllowed: false,
      requiredFeatures: SINGLE_MEDIA_STORY_FEATURES,
      forbiddenFeatures: SINGLE_MEDIA_STORY_FORBIDDEN,
      requiredAnchors: SINGLE_MEDIA_STORY_REQUIRED_ANCHORS,
      forbiddenArtifacts: SINGLE_MEDIA_STORY_FORBIDDEN_ARTIFACTS,
      threshold: 0.85,
      facts: effectiveFacts,
    };
  }
  return {
    archetype,
    sectionKind: SECTION_KIND_BY_ARCHETYPE[archetype] || "content",
    interactionKind: archetype === "logo_marquee" ? "marquee" : "none",
    blockModel: archetype === "logo_marquee" ? "logos" : "none",
    blocksAllowed: archetype === "logo_marquee",
    requiredFeatures: [],
    forbiddenFeatures: [],
    requiredAnchors: [],
    forbiddenArtifacts: [],
    threshold: 0.75,
    facts: effectiveFacts,
  };
};

const patternFound = (source, pattern) => {
  pattern.lastIndex = 0;
  if (pattern.test(source)) {
    return true;
  }
  const normalizedSource = normalizeForSearch(source);
  pattern.lastIndex = 0;
  return pattern.test(normalizedSource);
};

const detectGeneratedArchetype = (liquid = "") => {
  const source = String(liquid || "");
  const text = normalizeForSearch(source);
  const hasBlocks = /\bfor\s+block\s+in\s+section\.blocks\b|section\.blocks|block\.settings/i.test(source);
  const hasCarousel =
    /\bscrollBy\s*\(|data-[\w-]*(?:prev|next|track|slider|carousel)|aria-label\s*=\s*["'][^"']*(?:previous|next|prev|vorige|volgende|card)|scroll-snap-type/i.test(
      source
    );
  const hasCardSchema = /"type"\s*:\s*"card"|"name"\s*:\s*"Card"/i.test(source);
  const hasLogoMarquee =
    /\bmarquee\b|data-[\w-]*marquee|logo[-_ ]?(?:strip|wall|carousel)/i.test(source);
  const hasSingleMedia =
    /\bbekijk video\b/i.test(text) &&
    /\blive your\b/i.test(text) &&
    /"type"\s*:\s*"image_picker"/i.test(source) &&
    /"type"\s*:\s*"video"/i.test(source) &&
    /aspect-ratio\s*:/i.test(source);

  if (hasLogoMarquee) {
    return "logo_marquee";
  }
  if (hasCarousel && (hasBlocks || hasCardSchema)) {
    return "carousel_cards";
  }
  if (hasCarousel) {
    return "carousel";
  }
  if (hasBlocks && hasCardSchema) {
    return "card_blocks";
  }
  if (hasSingleMedia) {
    return "single_media_story";
  }
  if (/"type"\s*:\s*"image_picker"/i.test(source) || /"type"\s*:\s*"video"/i.test(source)) {
    return "media_content";
  }
  return "unknown";
};

const computePromptFidelity = ({
  liquid = "",
  contract,
} = {}) => {
  const source = String(liquid || "");
  const requiredAnchors = Array.isArray(contract?.requiredAnchors)
    ? contract.requiredAnchors
    : [];
  const forbiddenArtifacts = Array.isArray(contract?.forbiddenArtifacts)
    ? contract.forbiddenArtifacts
    : [];

  const missingAnchors = [];
  let requiredWeight = 0;
  let matchedRequiredWeight = 0;
  for (const anchor of requiredAnchors) {
    const weight = Number(anchor.weight || 1);
    requiredWeight += weight;
    if (patternFound(source, anchor.pattern)) {
      matchedRequiredWeight += weight;
    } else {
      missingAnchors.push(anchor.label);
    }
  }

  const unexpectedArtifacts = [];
  let forbiddenWeight = 0;
  let matchedForbiddenWeight = 0;
  for (const artifact of forbiddenArtifacts) {
    const weight = Number(artifact.weight || 1);
    forbiddenWeight += weight;
    if (patternFound(source, artifact.pattern)) {
      matchedForbiddenWeight += weight;
      unexpectedArtifacts.push(artifact.label);
    }
  }

  const requiredScore =
    requiredWeight <= 0 ? 1 : matchedRequiredWeight / requiredWeight;
  const forbiddenScore =
    forbiddenWeight <= 0 ? 1 : Math.max(0, 1 - matchedForbiddenWeight / forbiddenWeight);
  const score = Number((requiredScore * 0.82 + forbiddenScore * 0.18).toFixed(2));

  return {
    promptFidelity: score,
    missingAnchors,
    unexpectedArtifacts,
    requiredMatched: requiredAnchors.length - missingAnchors.length,
    requiredTotal: requiredAnchors.length,
    forbiddenMatched: unexpectedArtifacts.length,
    actualArchetypeDetected: detectGeneratedArchetype(source),
  };
};

const validateContractAgainstPrompt = ({
  contract = null,
  promptFacts = null,
} = {}) => {
  if (!contract || !promptFacts) {
    return { ok: true, errors: [] };
  }
  const errors = [];
  if (
    contract.archetype === "logo_marquee" &&
    (promptFacts.singleMediaStoryIntent ||
      promptFacts.logoOverlayOnly ||
      promptFacts.explicitlyForbidsMarquee)
  ) {
    errors.push({
      errorCode: "planner_contract_conflict",
      message:
        "Planner classified this as logo_marquee but visual brief indicates single_media_story.",
      nextAction: "replan_with_archetype_override",
      suggestedPlannerOverride: {
        archetype: "single_media_story",
        blocksAllowed: false,
      },
    });
  }
  if (
    ["testimonial_carousel"].includes(contract.archetype) &&
    (promptFacts.singleMediaStoryIntent || promptFacts.explicitlyForbidsCarousel)
  ) {
    errors.push({
      errorCode: "planner_contract_conflict",
      message:
        "Planner classified this as carousel content but the prompt indicates a static media/content section.",
      nextAction: "replan_with_archetype_override",
      suggestedPlannerOverride: {
        archetype: "single_media_story",
        blocksAllowed: false,
      },
    });
  }
  return { ok: errors.length === 0, errors };
};

const validateGeneratedSectionFidelity = ({
  liquid = "",
  contract = null,
  prompt = "",
  visualBrief = "",
  referenceAnalysis = "",
  designBrief = "",
} = {}) => {
  const classification = classifyArchetype({
    prompt,
    visualBrief,
    referenceAnalysis,
    designBrief,
    archetypeOverride: contract?.archetype,
  });
  const effectiveContract =
    contract ||
    buildSectionContract({
      archetype: classification.archetype,
      facts: classification.facts,
    });
  const contractPromptCheck = validateContractAgainstPrompt({
    contract: effectiveContract,
    promptFacts: classification.facts,
  });
  if (!contractPromptCheck.ok) {
    return {
      writeApplied: false,
      technicalSuccess: false,
      schemaSuccess: true,
      taskSuccess: false,
      promptFidelity: 0,
      expectedArchetype: effectiveContract.archetype,
      generatedArchetype: detectGeneratedArchetype(liquid),
      actualArchetypeDetected: detectGeneratedArchetype(liquid),
      missingRequiredFeatures: effectiveContract.requiredFeatures || [],
      unexpectedFeatures: [],
      missingAnchors: [],
      unexpectedArtifacts: [],
      errorCode: "planner_contract_conflict",
      errors: contractPromptCheck.errors,
      nextAction: "replan_with_archetype_override",
      suggestedPlannerOverride:
        contractPromptCheck.errors[0]?.suggestedPlannerOverride || null,
      enforced: true,
    };
  }

  const fidelity = computePromptFidelity({
    liquid,
    contract: effectiveContract,
  });
  const actualArchetypeDetected = fidelity.actualArchetypeDetected;
  const archetypeMatches =
    effectiveContract.archetype === "single_media_story"
      ? ["single_media_story", "media_content"].includes(actualArchetypeDetected)
      : actualArchetypeDetected === effectiveContract.archetype ||
        actualArchetypeDetected === "unknown";
  const taskSuccess =
    fidelity.promptFidelity >= Number(effectiveContract.threshold || 0.85) &&
    archetypeMatches &&
    fidelity.unexpectedArtifacts.length === 0;

  return {
    writeApplied: false,
    technicalSuccess: false,
    schemaSuccess: true,
    taskSuccess,
    promptFidelity: fidelity.promptFidelity,
    expectedArchetype: effectiveContract.archetype,
    generatedArchetype: actualArchetypeDetected,
    actualArchetypeDetected,
    missingRequiredFeatures: fidelity.missingAnchors,
    unexpectedFeatures: fidelity.unexpectedArtifacts,
    missingAnchors: fidelity.missingAnchors,
    unexpectedArtifacts: fidelity.unexpectedArtifacts,
    threshold: effectiveContract.threshold || 0.85,
    errorCode: taskSuccess ? null : "prompt_fidelity_failed",
    nextAction: taskSuccess ? "continue" : "regenerate_with_expected_archetype",
    enforced: effectiveContract.archetype === "single_media_story",
  };
};

const buildSingleMediaStorySection = ({ handle = "dream-section12" } = {}) => {
  const safeHandle = String(handle || "dream-section12")
    .replace(/^sections\//, "")
    .replace(/\.liquid$/, "")
    .replace(/[^A-Za-z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "dream-section12";
  return `{% liquid
  assign section_root = '${safeHandle}-' | append: section.id
  assign video_source = section.settings.video
  assign external_video = section.settings.external_video
%}

<style>
  #shopify-section-{{ section.id }} .${safeHandle} {
    --story-bg: {{ section.settings.background_color }};
    --story-text: {{ section.settings.text_color }};
    --story-accent: {{ section.settings.button_color }};
    --story-button-text: {{ section.settings.button_text_color }};
    --story-overlay: {{ section.settings.overlay_color }};
    background: var(--story-bg);
    color: var(--story-text);
    padding: {{ section.settings.padding_top }}px 18px {{ section.settings.padding_bottom }}px;
  }

  #shopify-section-{{ section.id }} .${safeHandle}__inner {
    width: min({{ section.settings.max_width }}px, 100%);
    margin: 0 auto;
    text-align: center;
  }

  #shopify-section-{{ section.id }} .${safeHandle}__media {
    position: relative;
    width: min(92%, 100%);
    margin: 0 auto 68px;
    aspect-ratio: 16 / 9;
    overflow: hidden;
    border-radius: {{ section.settings.media_radius }}px;
    background:
      linear-gradient(90deg, rgba(90, 64, 40, .45), rgba(255,255,255,.02)),
      radial-gradient(circle at 72% 24%, rgba(86, 133, 104, .55), transparent 26%),
      linear-gradient(135deg, #b9d9d2 0%, #d9c9a8 48%, #8b755d 100%);
  }

  #shopify-section-{{ section.id }} .${safeHandle}__media img,
  #shopify-section-{{ section.id }} .${safeHandle}__media video,
  #shopify-section-{{ section.id }} .${safeHandle}__media iframe {
    width: 100%;
    height: 100%;
    display: block;
    object-fit: cover;
  }

  #shopify-section-{{ section.id }} .${safeHandle}__fallback {
    position: absolute;
    inset: 0;
    background:
      linear-gradient(90deg, rgba(96, 65, 43, .72) 0 22%, transparent 22%),
      radial-gradient(ellipse at 76% 12%, rgba(42, 96, 68, .72), transparent 32%),
      linear-gradient(140deg, #c4ddd5 0%, #e7d5ad 50%, #9f8060 100%);
  }

  #shopify-section-{{ section.id }} .${safeHandle}__logo {
    position: absolute;
    top: 22px;
    right: 34px;
    z-index: 2;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 34px;
    padding: 7px 16px;
    border-radius: 2px;
    background: rgba(120, 195, 224, .92);
    color: #fff;
    font-size: 14px;
    font-weight: 700;
  }

  #shopify-section-{{ section.id }} .${safeHandle}__logo img {
    width: auto;
    max-width: 150px;
    height: 28px;
    object-fit: contain;
  }

  #shopify-section-{{ section.id }} .${safeHandle}__play {
    position: absolute;
    right: 48px;
    bottom: 48px;
    z-index: 2;
    display: inline-flex;
    align-items: center;
    gap: 22px;
    min-height: 110px;
    padding: 0 58px;
    border-radius: 999px;
    background: var(--story-overlay);
    color: #fff;
    text-decoration: none;
    font-size: clamp(22px, 3.2vw, 42px);
    line-height: 1;
    font-weight: 650;
  }

  #shopify-section-{{ section.id }} .${safeHandle}__play-icon {
    width: 0;
    height: 0;
    border-top: 14px solid transparent;
    border-bottom: 14px solid transparent;
    border-left: 22px solid #fff;
  }

  #shopify-section-{{ section.id }} .${safeHandle}__heading {
    margin: 0 auto 46px;
    font-size: clamp(44px, 5.2vw, 72px);
    line-height: 1.02;
    font-weight: 800;
    letter-spacing: 0;
    animation: ${safeHandle}-title 900ms ease both;
  }

  #shopify-section-{{ section.id }} .${safeHandle}__heading-accent {
    font-family: Georgia, 'Times New Roman', serif;
    font-style: italic;
    font-weight: 400;
  }

  #shopify-section-{{ section.id }} .${safeHandle}__text {
    width: min(1120px, 100%);
    margin: 0 auto 64px;
    font-size: clamp(28px, 3.25vw, 45px);
    line-height: 1.58;
  }

  #shopify-section-{{ section.id }} .${safeHandle}__text p {
    margin: 0;
  }

  #shopify-section-{{ section.id }} .${safeHandle}__button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 112px;
    min-width: 390px;
    padding: 0 54px;
    border-radius: 999px;
    background: var(--story-accent);
    color: var(--story-button-text);
    text-decoration: none;
    font-size: clamp(28px, 3vw, 44px);
    line-height: 1;
    font-weight: 500;
  }

  @keyframes ${safeHandle}-title {
    from { opacity: 0; transform: translateY(18px); }
    to { opacity: 1; transform: translateY(0); }
  }

  @media screen and (max-width: 749px) {
    #shopify-section-{{ section.id }} .${safeHandle} {
      padding: {{ section.settings.mobile_padding_top }}px 14px {{ section.settings.mobile_padding_bottom }}px;
    }

    #shopify-section-{{ section.id }} .${safeHandle}__media {
      width: 100%;
      margin-bottom: 42px;
      border-radius: {{ section.settings.mobile_media_radius }}px;
    }

    #shopify-section-{{ section.id }} .${safeHandle}__logo {
      top: 12px;
      right: 16px;
      min-height: 26px;
      padding: 5px 10px;
      font-size: 11px;
    }

    #shopify-section-{{ section.id }} .${safeHandle}__play {
      right: 18px;
      bottom: 18px;
      min-height: 58px;
      padding: 0 22px;
      gap: 12px;
      font-size: 18px;
    }

    #shopify-section-{{ section.id }} .${safeHandle}__play-icon {
      border-top-width: 8px;
      border-bottom-width: 8px;
      border-left-width: 13px;
    }

    #shopify-section-{{ section.id }} .${safeHandle}__heading {
      margin-bottom: 28px;
      font-size: clamp(40px, 11vw, 46px);
    }

    #shopify-section-{{ section.id }} .${safeHandle}__text {
      margin-bottom: 42px;
      font-size: clamp(24px, 7.2vw, 30px);
      line-height: 1.46;
    }

    #shopify-section-{{ section.id }} .${safeHandle}__button {
      min-width: min(100%, 260px);
      min-height: 76px;
      padding: 0 34px;
      font-size: 26px;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    #shopify-section-{{ section.id }} .${safeHandle}__heading {
      animation: none;
    }
  }
</style>

<section class="${safeHandle}" id="{{ section_root }}">
  <div class="${safeHandle}__inner" data-section-bounded-shell>
    <div class="${safeHandle}__media">
      <div class="${safeHandle}__fallback" aria-hidden="true"></div>
      {% if video_source != blank %}
        {{ video_source | video_tag: controls: false, autoplay: false, loop: false, muted: false }}
      {% elsif external_video != blank %}
        {{ external_video | external_video_tag }}
      {% elsif section.settings.image != blank %}
        {{ section.settings.image | image_url: width: 1800 | image_tag: loading: 'lazy', sizes: '(min-width: 990px) 92vw, 100vw' }}
      {% endif %}
      {% if section.settings.logo_image != blank %}
        <span class="${safeHandle}__logo">{{ section.settings.logo_image | image_url: width: 300 | image_tag: loading: 'lazy', alt: section.settings.logo_alt }}</span>
      {% elsif section.settings.logo_text != blank %}
        <span class="${safeHandle}__logo">{{ section.settings.logo_text }}</span>
      {% endif %}
      {% if section.settings.play_label != blank %}
        <a class="${safeHandle}__play" {% if section.settings.video_link != blank %}href="{{ section.settings.video_link }}"{% else %}role="link" aria-disabled="true"{% endif %}>
          <span class="${safeHandle}__play-icon" aria-hidden="true"></span>
          <span>{{ section.settings.play_label }}</span>
        </a>
      {% endif %}
    </div>

    <h2 class="${safeHandle}__heading">
      <span>{{ section.settings.heading_prefix }}</span>
      <span class="${safeHandle}__heading-accent">{{ section.settings.heading_accent }}</span>
    </h2>

    <div class="${safeHandle}__text rte">{{ section.settings.text }}</div>

    {% if section.settings.button_label != blank %}
      <a class="${safeHandle}__button" {% if section.settings.button_link != blank %}href="{{ section.settings.button_link }}"{% else %}role="link" aria-disabled="true"{% endif %}>{{ section.settings.button_label }}</a>
    {% endif %}
  </div>
</section>

{% schema %}
{
  "name": "Dream section 12",
  "tag": "section",
  "settings": [
    { "type": "image_picker", "id": "image", "label": "Image" },
    { "type": "video", "id": "video", "label": "Shopify video" },
    { "type": "video_url", "id": "external_video", "label": "External video", "accept": ["youtube", "vimeo"] },
    { "type": "url", "id": "video_link", "label": "Video button link" },
    { "type": "image_picker", "id": "logo_image", "label": "Logo image" },
    { "type": "text", "id": "logo_text", "label": "Logo text", "default": "cloudpillo" },
    { "type": "text", "id": "logo_alt", "label": "Logo alt text", "default": "Cloudpillo" },
    { "type": "text", "id": "play_label", "label": "Play label", "default": "Bekijk video" },
    { "type": "text", "id": "heading_prefix", "label": "Heading prefix", "default": "Live your" },
    { "type": "text", "id": "heading_accent", "label": "Heading accent", "default": "dreams." },
    { "type": "richtext", "id": "text", "label": "Text", "default": "<p>Je leeft maar één keer, dus haal alles eruit! Doe waar jij écht gelukkig van wordt. En als de dag erop zit, leg je hoofd dan op een Cloudpillo om op te laden voor het leven.</p>" },
    { "type": "text", "id": "button_label", "label": "Button label", "default": "Ons verhaal" },
    { "type": "url", "id": "button_link", "label": "Button link" },
    { "type": "range", "id": "max_width", "label": "Maximum width", "min": 900, "max": 1320, "step": 20, "unit": "px", "default": 1200 },
    { "type": "range", "id": "media_radius", "label": "Media radius", "min": 0, "max": 40, "step": 1, "unit": "px", "default": 24 },
    { "type": "range", "id": "mobile_media_radius", "label": "Mobile media radius", "min": 0, "max": 28, "step": 1, "unit": "px", "default": 18 },
    { "type": "range", "id": "padding_top", "label": "Top padding", "min": 0, "max": 140, "step": 4, "unit": "px", "default": 88 },
    { "type": "range", "id": "padding_bottom", "label": "Bottom padding", "min": 0, "max": 140, "step": 4, "unit": "px", "default": 88 },
    { "type": "range", "id": "mobile_padding_top", "label": "Mobile top padding", "min": 0, "max": 100, "step": 4, "unit": "px", "default": 48 },
    { "type": "range", "id": "mobile_padding_bottom", "label": "Mobile bottom padding", "min": 0, "max": 100, "step": 4, "unit": "px", "default": 56 },
    { "type": "color", "id": "background_color", "label": "Background", "default": "#f7f7f4" },
    { "type": "color", "id": "text_color", "label": "Text", "default": "#000000" },
    { "type": "color", "id": "overlay_color", "label": "Play button background", "default": "#171b21" },
    { "type": "color", "id": "button_color", "label": "Button", "default": "#ff7300" },
    { "type": "color", "id": "button_text_color", "label": "Button text", "default": "#ffffff" }
  ],
  "presets": [{ "name": "Dream section 12" }]
}
{% endschema %}`;
};

export {
  STRICT_ARCHETYPES,
  buildPromptText,
  buildSectionContract,
  buildSingleMediaStorySection,
  classifyArchetype,
  computePromptFidelity,
  detectGeneratedArchetype,
  extractPromptFacts,
  validateContractAgainstPrompt,
  validateGeneratedSectionFidelity,
};
