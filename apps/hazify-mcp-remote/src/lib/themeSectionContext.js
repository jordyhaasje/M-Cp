import { parseJsonLike } from "./jsonLike.js";

const KNOWN_TEMPLATE_SURFACES = new Set([
  "homepage",
  "index",
  "product",
  "collection",
  "page",
  "article",
  "blog",
  "cart",
  "search",
]);

const PREFERRED_THEME_CLASSES = [
  "page-width",
  "container",
  "container--full",
  "rte",
  "button",
  "button--primary",
  "button--secondary",
  "button--tertiary",
  "section",
  "content-container",
  "title",
  "subtitle",
  "caption-with-letter-spacing",
];

const HERO_SECTION_PATTERNS = [
  /hero/i,
  /banner/i,
  /slideshow/i,
  /announcement/i,
  /header/i,
  /footer/i,
  /marquee/i,
  /ticker/i,
  /masthead/i,
  /cover/i,
  /split[-_ ]?hero/i,
];

const HERO_FULL_BLEED_PATTERNS = [
  /\bfull[-_ ]?(?:width|bleed)\b/i,
  /\bedge[-_ ]?to[-_ ]?edge\b/i,
  /\bviewport[-_ ]?wide\b/i,
  /\bbleeds?\b/i,
];

const HERO_BOXED_PATTERNS = [
  /\bboxed\b/i,
  /\bbounded\b/i,
  /\bcontained\b/i,
  /\bframed\b/i,
  /\bin\s+(?:een\s+)?container\b/i,
  /\bcard[-_ ]?(?:style|shell)?\b/i,
];

const HERO_SPLIT_LAYOUT_PATTERNS = [
  /\bsplit[-_ ]?hero\b/i,
  /\btwo[-_ ]?column\b/i,
  /\b2[-_ ]?column\b/i,
  /\btwo columns\b/i,
  /\btwee kolommen\b/i,
  /\bside[-_ ]?by[-_ ]?side\b/i,
  /\btwo[-_ ]?up\b/i,
];

const HERO_OVERLAY_PATTERNS = [
  /\boverlay\b/i,
  /\bgradient\b/i,
  /\bfade\b/i,
  /\bmedia[-_ ]?layer\b/i,
  /\bimage[-_ ]?layer\b/i,
  /\bvideo[-_ ]?layer\b/i,
  /\bcontent[-_ ]?layer\b/i,
  /\bcontent\s+over\b/i,
  /\btext\s+over\b/i,
  /\bover\s+the\s+(?:image|video|media)\b/i,
];

const HERO_BACKGROUND_MEDIA_PATTERNS = [
  /\bbackground[-_ ]?(?:image|video|media)\b/i,
  /\bmedia[-_ ]?first\b/i,
  /\bimage[-_ ]?first\b/i,
  /\bvideo[-_ ]?first\b/i,
  /\bbackground\s+hero\b/i,
  /\bhero\s+background\b/i,
  /\bmedia\s+behind\b/i,
  /\bimage\s+behind\b/i,
  /\bvideo\s+behind\b/i,
];

const HERO_DIRECTIONAL_MEDIA_PATTERNS = [
  /\b(?:image|media|video|photo|visual|beeld|afbeelding|foto)\b[\w\s,/-]{0,40}\b(?:right|rechts)\b/i,
  /\b(?:right|rechts)\b[\w\s,/-]{0,40}\b(?:image|media|video|photo|visual|beeld|afbeelding|foto)\b/i,
  /\b(?:content|copy|headline|tekst|inhoud)\b[\w\s,/-]{0,40}\b(?:left|links)\b/i,
  /\b(?:left|links)\b[\w\s,/-]{0,40}\b(?:content|copy|headline|tekst|inhoud)\b/i,
];

const SECTION_CATEGORY_ORDER = ["interactive", "media", "commerce", "static"];

const SECTION_CATEGORY_PATTERNS = {
  static: [
    /review/i,
    /testimonial/i,
    /quote/i,
    /comparison/i,
    /compare/i,
    /\bvs\b/i,
    /\btable\b/i,
    /rich[-_ ]?text/i,
    /logo[-_ ]?wall/i,
    /content/i,
    /text[-_ ]?columns?/i,
  ],
  interactive: [
    /slider/i,
    /carousel/i,
    /accordion/i,
    /collapsible/i,
    /faq/i,
    /frequently[-_ ]?asked[-_ ]?questions?/i,
    /tab/i,
    /marquee/i,
    /ticker/i,
    /modal/i,
    /hotspot/i,
    /before[-_ ]?after/i,
  ],
  media: [
    /image/i,
    /gallery/i,
    /video/i,
    /logo/i,
    /media/i,
    /instagram/i,
    /tiktok/i,
    /ugc/i,
    /feed/i,
    /reels?/i,
    /social[-_ ]?(?:strip|feed|slider|carousel|grid|gallery|posts?)/i,
    /banner/i,
    /hero/i,
    /slideshow/i,
  ],
  commerce: [
    /\bpdp\b/i,
    /product/i,
    /product[-_ ]?page/i,
    /productpagina/i,
    /product[-_ ]?detail/i,
    /collection/i,
    /price/i,
    /variant/i,
    /cart/i,
    /buy/i,
    /upsell/i,
    /cross[-_ ]?sell/i,
  ],
};

const HELPER_SNIPPET_PATTERNS = {
  shared: [
    /section[-_ ]?properties/i,
    /section[-_ ]?spacing/i,
    /spacing[-_ ]?collaps/i,
    /button/i,
    /icon/i,
    /rte/i,
    /media/i,
  ],
  interactive: [
    /slider/i,
    /carousel/i,
    /accordion/i,
    /tabs?/i,
    /pagination/i,
    /controls?/i,
  ],
  media: [
    /image/i,
    /video/i,
    /gallery/i,
    /logo/i,
    /poster/i,
  ],
  commerce: [
    /product/i,
    /price/i,
    /buy/i,
    /variant/i,
    /badge/i,
    /quantity/i,
  ],
};

const CATEGORY_SEARCH_HINTS = {
  static: ["page-width", "rte", "button"],
  interactive: ["section.id", "slider", "accordion", "carousel"],
  media: ["image_tag", "video_tag", "image_picker", "video"],
  commerce: ["price", "product", "buy_buttons", "variant"],
};

const CATEGORY_FORBIDDEN_PATTERNS = {
  universal: [
    "Plaats nooit Liquid binnen {% stylesheet %} of {% javascript %}.",
    "Gebruik geen raw <img> zonder betrouwbare width/height of image_tag.",
    "Gebruik geen range-default buiten min/max of buiten het step-raster.",
  ],
  interactive: [
    "Mix geen JavaScript template interpolation ${...} met Liquid {{ ... }} of {% ... %} in dezelfde expressie.",
    "Gebruik geen globale document.querySelector(...) zonder section-scoping.",
  ],
  media: [
    "Render geen merchant-editable media via hardcoded externe assets wanneer een image_picker, video of video_url hoort te worden gebruikt.",
    "Gebruik video_url niet voor merchant-uploaded videobestanden; gebruik dan type 'video'.",
  ],
  commerce: [
    "Herintroduceer geen losse product/price markup als het doeltheme al product/button helpers heeft die je kunt spiegelen.",
  ],
};

const CATEGORY_EXTRA_VALIDATIONS = {
  universal: [
    "Valideer schema als pure JSON met presets en renderbare markup.",
    "Controleer typography, spacing, gaps en min-heights tegen theme-scale guardrails.",
  ],
  interactive: [
    "Controleer JS op parser-veilige Liquid-combinaties en scope selectors per section instance.",
  ],
  media: [
    "Controleer merchant-editable media settings, image/video rendering en responsieve wrapper-strategie.",
  ],
  commerce: [
    "Controleer of prijzen, knoppen en variant-gerelateerde markup aansluiten op theme-conventies.",
  ],
};

const EXACT_MATCH_PATTERNS = [
  /\bexact(?:ly|e)?\b/i,
  /\bpixel(?:[- ]?perfect)?\b/i,
  /\b1[:\- ]?1\b/i,
  /\breplica\b/i,
  /\bscreenshot\b/i,
  /\breference\b/i,
  /\bidentiek\b/i,
  /\bprecies\b/i,
  /\bcopy this\b/i,
  /\bmatch(?:ing|en)?\b/i,
  /\bna(?:maken|bouwen)\b/i,
  /\bzoals op (?:de )?(?:afbeelding|screenshot|referentie)\b/i,
];

const SCREENSHOT_REFERENCE_PATTERNS = [
  /\bscreenshot\b/i,
  /\breference\b/i,
  /\breferentie\b/i,
  /\bafbeelding\b/i,
  /\bmockup\b/i,
  /\bvoorbeeldbeeld\b/i,
  /\bvoorbeeld image\b/i,
];

const DESKTOP_MOBILE_REFERENCE_PATTERNS = [
  /\bdesktop\b.*\bmobile\b/i,
  /\bmobile\b.*\bdesktop\b/i,
  /\bdesktop versie\b/i,
  /\bmobiele? versie\b/i,
  /\bdesktop image\b.*\bmobile image\b/i,
  /\bmobile image\b.*\bdesktop image\b/i,
  /\bdesktop screenshot\b.*\bmobile screenshot\b/i,
  /\bmobile screenshot\b.*\bdesktop screenshot\b/i,
  /\bdesktop and mobile\b/i,
  /\bdesktop en mobile\b/i,
  /\bdesktop en mobiel\b/i,
  /\bboth desktop and mobile\b/i,
  /\bbeide\b.*\bdesktop\b.*\bmob(?:ile|iel(?:e)?)\b/i,
  /\btwee\b.*\b(?:screenshots?|afbeeldingen|referentiebeelden)\b/i,
];

const DESKTOP_REFERENCE_PATTERNS = [/\bdesktop\b/i, /\blaptop\b/i, /\bpc\b/i];

const MOBILE_REFERENCE_PATTERNS = [
  /\bmob(?:ile|iel(?:e)?)\b/i,
  /\bphone\b/i,
  /\bsmartphone\b/i,
];

const VIEWPORT_REFERENCE_HINT_PATTERNS = [
  /\b(versie|variant|weergave|viewport|breakpoint|layout|compositie)\b/i,
  /\b(screenshots?|afbeeldingen|referentiebeelden|reference images?)\b/i,
  /\b(beide|both|allebei|twee|two)\b/i,
];

const DECORATIVE_MEDIA_REFERENCE_PATTERNS = [
  {
    tag: "floating_product_media",
    pattern:
      /\b(floating|zwevend|hovering|overlapping)\b.*\b(sachet|pouch|pack(?:aging)?|product|bottle|jar|mockup|image)\b/i,
  },
  {
    tag: "product_media_anchor",
    pattern:
      /\b(sachet|pouch|pack(?:aging)?|product image|product shot|bottle|jar|mockup)\b/i,
  },
  {
    tag: "device_mockup",
    pattern:
      /\b(phone|iphone|mobile mockup|device mockup|device frame|telefoon(?:mockup)?)\b/i,
  },
];

const DECORATIVE_BADGE_REFERENCE_PATTERNS = [
  {
    tag: "badge",
    pattern: /\b(badge|seal|sticker)\b/i,
  },
  {
    tag: "gluten_free_badge",
    pattern: /\bgluten[- ]?free\b/i,
  },
  {
    tag: "rating_badge",
    pattern: /\b(trustpilot|verified|rating badge)\b/i,
  },
];

const RATING_STAR_REFERENCE_PATTERNS = [
  /\b(stars?|star rating|rating strip|rating row|review rating)\b/i,
  /\b(trustpilot|4\.5|5 stars?|five stars?)\b/i,
];

const COMPARISON_ICON_REFERENCE_PATTERNS = [
  /\b(check(?:mark|marks)?|tick(?:s)?)\b/i,
  /\b(thumbs?[- ]?down|thumbs? down|cross(?:es)?|x mark|x-mark)\b/i,
  /\b(versus|vs\b|others)\b/i,
];

const EXPLICIT_MEDIA_SOURCE_PATTERNS = [
  /shopify:\/\//i,
  /cdn\.shopify/i,
  /\bhttps?:\/\/\S+\.(?:png|jpe?g|webp|gif|svg|mp4|mov|webm)\b/i,
  /\b\S+\.(?:png|jpe?g|webp|gif|svg|mp4|mov|webm)\b/i,
  /\b(?:use|gebruik)\s+(?:the\s+|de\s+)?(?:meegeleverde|bijgevoegde|uploaded|attached|supplied)\s+(?:images?|afbeeldingen|assets?|videos?)\b/i,
  /\b(?:zelfde|same)\s+(?:images?|afbeeldingen|assets?|video(?:'s)?)\b/i,
  /\b(?:product|collection|shop)\s+(?:images?|media|video(?:'s)?)\b/i,
];

const CONTENT_WIDTH_WRAPPER_CLASSES = [
  "page-width",
  "container",
  "content-container",
];

const CARD_COUNT_PATTERN = /\b([2-6])\s+(?:kaarten|cards?|slides?|items?)\b/i;

const hasContentWidthWrapperClass = (tokens = []) =>
  (Array.isArray(tokens) ? tokens : []).some((token) =>
    CONTENT_WIDTH_WRAPPER_CLASSES.includes(String(token || "").trim())
  );

const hasPreferredContentWidthWrapper = (preferredClasses = []) =>
  hasContentWidthWrapperClass(preferredClasses);

const uniqueStrings = (values) =>
  Array.from(new Set((values || []).filter(Boolean)));

const normalizeText = (value) =>
  String(value || "")
    .trim()
    .toLowerCase();

const escapeRegExp = (value) =>
  String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const normalizeTemplateSurface = (value) => {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (!normalized) {
    return null;
  }
  return normalized === "index" ? "homepage" : normalized;
};

const safeParseJson = (value) => {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }

  try {
    return parseJsonLike(value);
  } catch {
    return null;
  }
};

const getLiquidBlockContents = (value, tagName) => {
  const source = String(value || "");
  const normalizedTagName = escapeRegExp(tagName);
  const openPattern = new RegExp(
    `{%-?\\s*${normalizedTagName}\\s*-?%}`,
    "gi"
  );
  const closePattern = new RegExp(
    `{%-?\\s*end${normalizedTagName}\\s*-?%}`,
    "gi"
  );
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

const extractSchemaJson = (value) => {
  const [schemaJson] = getLiquidBlockContents(value, "schema");
  return schemaJson === undefined ? null : schemaJson.trim();
};

const parseSectionSchema = (value) => safeParseJson(extractSchemaJson(value));

const collectSchemaSettings = (schema) => {
  const sectionSettings = Array.isArray(schema?.settings) ? schema.settings : [];
  const blockSettings = Array.isArray(schema?.blocks)
    ? schema.blocks.flatMap((block) =>
        Array.isArray(block?.settings) ? block.settings : []
      )
    : [];
  return [...sectionSettings, ...blockSettings].filter(Boolean);
};

const collectSpacingSettings = (schema) =>
  collectSchemaSettings(schema)
    .filter((setting) => {
      const id = String(setting?.id || "");
      const label = String(setting?.label || "");
      const haystack = `${id} ${label}`.toLowerCase();
      return (
        ["range", "select", "number"].includes(String(setting?.type || "")) &&
        /(padding|spacing|gap|margin|width|columns|cards)/i.test(haystack)
      );
    })
    .slice(0, 6)
    .map((setting) => ({
      id: String(setting?.id || ""),
      type: String(setting?.type || ""),
      label: String(setting?.label || "") || null,
      default:
        typeof setting?.default === "number" || typeof setting?.default === "string"
          ? setting.default
          : null,
      min:
        typeof setting?.min === "number" && Number.isFinite(setting.min)
          ? setting.min
          : null,
      max:
        typeof setting?.max === "number" && Number.isFinite(setting.max)
          ? setting.max
          : null,
      step:
        typeof setting?.step === "number" && Number.isFinite(setting.step)
          ? setting.step
          : null,
    }));

const extractClassTokens = (value) => {
  const source = String(value || "");
  const classMatches = Array.from(
    source.matchAll(/\bclass\s*=\s*["']([^"']+)["']/gi),
    (match) => match[1]
  );

  return uniqueStrings(
    classMatches
      .flatMap((classValue) => classValue.split(/\s+/))
      .map((token) => token.trim())
      .filter(
        (token) =>
          token &&
          !token.includes("{{") &&
          !token.includes("{%") &&
          /^[A-Za-z0-9_-]+$/.test(token)
      )
  );
};

const collectPreferredClasses = (tokens) =>
  PREFERRED_THEME_CLASSES.filter((className) => tokens.includes(className));

const extractRequestedVisibleCardCount = (value) => {
  const match = String(value || "").match(CARD_COUNT_PATTERN);
  if (!match) {
    return null;
  }

  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
};

const extractReferenceAnchorTags = (query, definitions = []) =>
  definitions
    .filter((entry) => entry?.pattern?.test(query))
    .map((entry) => entry.tag)
    .filter(Boolean);

const inferDesktopMobileReferencePair = ({
  query = "",
  exactReplicaRequested = false,
  hasScreenshotLikeReference = false,
} = {}) => {
  if (DESKTOP_MOBILE_REFERENCE_PATTERNS.some((pattern) => pattern.test(query))) {
    return true;
  }

  const hasDesktopReference = DESKTOP_REFERENCE_PATTERNS.some((pattern) =>
    pattern.test(query)
  );
  const hasMobileReference = MOBILE_REFERENCE_PATTERNS.some((pattern) =>
    pattern.test(query)
  );

  if (!hasDesktopReference || !hasMobileReference) {
    return false;
  }

  return (
    hasScreenshotLikeReference ||
    exactReplicaRequested ||
    VIEWPORT_REFERENCE_HINT_PATTERNS.some((pattern) => pattern.test(query))
  );
};

const inferSectionArchetype = ({
  query = "",
  sectionTypeHint = "",
  category = "static",
  categorySignals = [],
} = {}) => {
  const haystack = normalizeText(`${query} ${sectionTypeHint}`);
  const effectiveSignals = Array.isArray(categorySignals) && categorySignals.length > 0
    ? categorySignals
    : [category].filter(Boolean);

  const inferHeroArchetype = () => {
    const heroLike =
      /(hero|banner|masthead|cover|split[-_ ]?hero)/.test(haystack) &&
      !/(slider|carousel|slideshow)/.test(haystack);
    if (!heroLike) {
      return null;
    }

    const wantsBoxed = HERO_BOXED_PATTERNS.some((pattern) => pattern.test(haystack));
    const hasDirectionalMedia = HERO_DIRECTIONAL_MEDIA_PATTERNS.some((pattern) =>
      pattern.test(haystack)
    );
    const wantsExplicitSplit =
      HERO_SPLIT_LAYOUT_PATTERNS.some((pattern) => pattern.test(haystack)) ||
      (hasDirectionalMedia &&
        /\b(split|columns?|kolommen|side[-_ ]?by[-_ ]?side)\b/i.test(haystack));
    const wantsOverlay = HERO_OVERLAY_PATTERNS.some((pattern) => pattern.test(haystack));
    const wantsBackgroundMedia = HERO_BACKGROUND_MEDIA_PATTERNS.some((pattern) =>
      pattern.test(haystack)
    );
    const wantsFullBleed = HERO_FULL_BLEED_PATTERNS.some((pattern) =>
      pattern.test(haystack)
    );
    const prefersMediaFirst = wantsOverlay || wantsBackgroundMedia || wantsFullBleed;

    if (wantsBoxed) {
      return "hero_boxed_shell";
    }
    if (prefersMediaFirst && wantsFullBleed) {
      return "hero_full_bleed_media";
    }
    if (prefersMediaFirst) {
      return "hero_media_first_overlay";
    }
    if (wantsExplicitSplit) {
      return "hero_split_layout";
    }
    return "hero_banner";
  };

  if (
    /(instagram|tiktok|ugc|reels?|feed|social[-_ ]?(?:strip|feed|slider|carousel|grid|gallery|posts?))/.test(
      haystack
    )
  ) {
    if (/(slider|carousel|slideshow)/.test(haystack)) {
      return "social_slider";
    }
    return "social_strip";
  }
  if (/(faq|frequently[-_ ]?asked[-_ ]?questions?|accordion|collapsible)/.test(haystack)) {
    return "faq_collapsible";
  }
  if (/(before[-_ ]?after|before\/after)/.test(haystack)) {
    return "before_after";
  }
  if (
    /comparison[-_ ]?table/.test(haystack) ||
    (/(comparison|compare|\bvs\b)/.test(haystack) && /(table|grid|chart)/.test(haystack))
  ) {
    return "comparison_table";
  }
  if (
    /\b(pdp|product[-_ ]?page|productpagina|product[-_ ]?detail|product[-_ ]?story|product[-_ ]?benefits?|buy[-_ ]?box|conversion[-_ ]?block)\b/.test(
      haystack
    )
  ) {
    return "pdp_section";
  }
  if (
    /\b(featured[-_ ]?product|product[-_ ]?(?:feature|showcase|spotlight|highlight)|single[-_ ]?product)\b/.test(
      haystack
    )
  ) {
    return "featured_product_section";
  }
  if (
    /\b(featured[-_ ]?collection|collection[-_ ]?(?:feature|showcase|spotlight|grid|section)|collection\s+lijst|collectie[-_ ]?(?:showcase|grid|sectie))\b/.test(
      haystack
    ) &&
    !/(slider|carousel|slideshow)/.test(haystack)
  ) {
    return "featured_collection_section";
  }
  if (
    /(logo[-_ ]?wall|brand[-_ ]?wall|logo[-_ ]?(?:grid|list)|logo showcase)/.test(
      haystack
    )
  ) {
    return "logo_wall";
  }
  if (/(image|gallery|photo)/.test(haystack) && /(slider|carousel|slideshow)/.test(haystack)) {
    return "image_slider";
  }
  if (/video/.test(haystack) && /(slider|carousel|slideshow)/.test(haystack)) {
    return "video_slider";
  }
  if (/video/.test(haystack)) {
    return "video_section";
  }
  if (
    /(review|testimonial|trustpilot)/.test(haystack) &&
    /(slider|carousel)/.test(haystack)
  ) {
    return "review_slider";
  }
  if (/(review|testimonial|trustpilot|quote|klant(?:en)?|beoordeling(?:en)?|ervaring(?:en)?)/.test(haystack)) {
    return "review_section";
  }
  if (/(collection)/.test(haystack) && /(slider|carousel)/.test(haystack)) {
    return "collection_slider";
  }
  if (/(logo)/.test(haystack) && /(slider|carousel)/.test(haystack)) {
    return "logo_slider";
  }
  if (/(gallery|masonry)/.test(haystack)) {
    return "media_gallery";
  }
  const heroArchetype = inferHeroArchetype();
  if (heroArchetype) {
    return heroArchetype;
  }
  if (effectiveSignals.includes("interactive") && effectiveSignals.includes("media")) {
    return "media_carousel";
  }
  if (effectiveSignals.includes("commerce") && /block/.test(haystack)) {
    return "native_block";
  }
  if (effectiveSignals.includes("interactive")) {
    return "interactive_section";
  }
  if (effectiveSignals.includes("media")) {
    return "media_section";
  }
  if (effectiveSignals.includes("commerce")) {
    return "commerce_section";
  }
  return "content_section";
};

const inferHeroShellFamily = ({
  archetype = "content_section",
  query = "",
  qualityTarget = "theme_consistent",
} = {}) => {
  if (archetype === "hero_media_first_overlay" || archetype === "hero_full_bleed_media") {
    return "media_first_unboxed";
  }

  if (archetype === "hero_boxed_shell") {
    return "boxed";
  }

  if (archetype === "hero_split_layout") {
    return "split";
  }

  if (archetype !== "hero_banner") {
    return "generic";
  }

  const haystack = normalizeText(query);
  const wantsBoxed = HERO_BOXED_PATTERNS.some((pattern) => pattern.test(haystack));
  const hasDirectionalMedia = HERO_DIRECTIONAL_MEDIA_PATTERNS.some((pattern) =>
    pattern.test(haystack)
  );
  const wantsSplit =
    HERO_SPLIT_LAYOUT_PATTERNS.some((pattern) => pattern.test(haystack)) ||
    (hasDirectionalMedia &&
      /\b(split|columns?|kolommen|side[-_ ]?by[-_ ]?side|inline|naast)\b/i.test(
        haystack
      ));
  const wantsMediaFirst =
    HERO_FULL_BLEED_PATTERNS.some((pattern) => pattern.test(haystack)) ||
    HERO_OVERLAY_PATTERNS.some((pattern) => pattern.test(haystack)) ||
    HERO_BACKGROUND_MEDIA_PATTERNS.some((pattern) => pattern.test(haystack)) ||
    /\b(?:edge[-_ ]?to[-_ ]?edge|full[-_ ]?width|full[-_ ]?bleed|over\s+het\s+hele\s+vlak|text\s+on\s+(?:the\s+)?(?:image|media|photo)|tekst\s+(?:op|over)\s+(?:de\s+)?(?:afbeelding|foto|image|media)|image\s+as\s+background|beeld\s+als\s+achtergrond)\b/i.test(
      query
    );
  const exactReplicaRequested = qualityTarget === "exact_match";

  if (!wantsBoxed && !wantsSplit && wantsMediaFirst) {
    return "media_first_unboxed";
  }

  if (
    !wantsBoxed &&
    !wantsSplit &&
    exactReplicaRequested &&
    /\b(?:hero|banner|masthead|cover)\b/i.test(haystack) &&
    /\b(?:text|tekst|content|copy|headline)\b/i.test(haystack) &&
    /\b(?:image|media|photo|visual|beeld|foto|afbeelding)\b/i.test(haystack) &&
    /\b(?:behind|achter|background|achtergrond|overlay|over)\b/i.test(haystack)
  ) {
    return "media_first_unboxed";
  }

  return "generic";
};

const inferSectionShellFamily = ({
  archetype = "content_section",
  query = "",
  qualityTarget = "theme_consistent",
} = {}) => {
  const heroShellFamily = inferHeroShellFamily({
    archetype,
    query,
    qualityTarget,
  });

  if (heroShellFamily !== "generic") {
    return heroShellFamily;
  }

  switch (archetype) {
    case "comparison_table":
    case "review_slider":
    case "review_section":
      return "bounded_card_shell";
    case "video_section":
    case "video_slider":
    case "image_slider":
    case "social_strip":
    case "social_slider":
    case "collection_slider":
    case "featured_collection_section":
    case "logo_slider":
    case "logo_wall":
    case "media_gallery":
    case "media_carousel":
      return "media_surface";
    case "native_block":
    case "pdp_section":
    case "featured_product_section":
    case "commerce_section":
      return "commerce_scaffold";
    default:
      return "theme_default";
  }
};

const buildReferenceSignals = ({
  query = "",
  qualityTarget = "theme_consistent",
  category = "static",
  categorySignals = [],
  archetype = "content_section",
  heroLike = false,
  themeContext = null,
} = {}) => {
  const haystack = normalizeText(query);
  const effectiveSignals = Array.isArray(categorySignals) && categorySignals.length > 0
    ? categorySignals
    : [category].filter(Boolean);
  const exactReplicaRequested = qualityTarget === "exact_match";
  const interactiveLike =
    effectiveSignals.includes("interactive") || effectiveSignals.includes("hybrid");
  const mediaLike =
    interactiveLike ||
    effectiveSignals.includes("media") ||
    effectiveSignals.includes("commerce");
  const hasScreenshotLikeReference = SCREENSHOT_REFERENCE_PATTERNS.some((pattern) =>
    pattern.test(query)
  );
  const hasDesktopMobileReferences = inferDesktopMobileReferencePair({
    query,
    exactReplicaRequested,
    hasScreenshotLikeReference,
  });
  const hasExplicitMediaSources = EXPLICIT_MEDIA_SOURCE_PATTERNS.some((pattern) =>
    pattern.test(query)
  );
  const reviewLikeReference =
    /\b(review|reviews|testimonial|testimonials|trustpilot|quote|quotes|klant(?:en)?|beoordeling(?:en)?|ervaring(?:en)?)\b/i.test(
      query
    );
  const boundedCardCompositionRequested =
    /\b(card|cards|wall|masonry|grid|quotes?)\b/i.test(query);
  const heroShellFamily = inferHeroShellFamily({
    archetype,
    query,
    qualityTarget,
  });
  const sectionShellFamily = inferSectionShellFamily({
    archetype,
    query,
    qualityTarget,
  });
  const exactReplicaWrapperMirror =
    exactReplicaRequested &&
    heroShellFamily !== "media_first_unboxed" &&
    !heroLike &&
    Boolean(
      themeContext?.usesPageWidth || themeContext?.usesSectionPropertiesWrapper
    ) &&
    (hasScreenshotLikeReference ||
      hasDesktopMobileReferences ||
      archetype === "comparison_table" ||
      reviewLikeReference ||
      boundedCardCompositionRequested);
  const wantsDedicatedInnerCard =
    exactReplicaRequested &&
    (archetype === "comparison_table" ||
      (reviewLikeReference && boundedCardCompositionRequested));
  const requestedDecorativeMediaAnchors = uniqueStrings(
    extractReferenceAnchorTags(query, DECORATIVE_MEDIA_REFERENCE_PATTERNS)
  );
  const requestedDecorativeBadgeAnchors = uniqueStrings(
    extractReferenceAnchorTags(query, DECORATIVE_BADGE_REFERENCE_PATTERNS)
  );
  const interactiveReplicaArchetypes = new Set([
    "social_slider",
    "image_slider",
    "video_slider",
    "review_slider",
    "collection_slider",
    "logo_slider",
    "media_carousel",
    "interactive_section",
    "before_after",
    "faq_collapsible",
  ]);
  const interactivePattern =
    [
      "social_slider",
      "image_slider",
      "video_slider",
      "review_slider",
      "collection_slider",
      "logo_slider",
      "media_carousel",
    ].includes(archetype)
      ? "carousel"
      : archetype === "faq_collapsible"
        ? "accordion"
        : archetype === "before_after"
          ? "range_compare"
          : /\btabs?\b/.test(haystack)
            ? "tabs"
            : archetype === "interactive_section"
              ? "generic_interactive"
              : null;
  const previewMediaPolicy = !exactReplicaRequested || !mediaLike
    ? "not_media_driven"
    : hasExplicitMediaSources
      ? "strict_renderable_media"
      : "best_effort_demo_media";

  return {
    exactReplicaRequested,
    previewMediaPolicy,
    hasScreenshotLikeReference,
    hasDesktopMobileReferences,
    hasExplicitMediaSources,
    heroShellFamily,
    sectionShellFamily,
    requestedDecorativeMediaAnchors,
    requestedDecorativeBadgeAnchors,
    interactivePattern,
    prefersRenderablePreviewMedia:
      exactReplicaRequested && mediaLike,
    requiresRenderablePreviewMedia:
      exactReplicaRequested &&
      mediaLike &&
      hasExplicitMediaSources,
    allowStylizedPreviewFallbacks:
      exactReplicaRequested &&
      mediaLike &&
      !hasExplicitMediaSources,
    requiresThemeEditorLifecycleHooks:
      exactReplicaRequested && interactiveReplicaArchetypes.has(archetype),
    requiresResponsiveViewportParity:
      exactReplicaRequested && hasDesktopMobileReferences,
    requiresDecorativeMediaAnchors:
      exactReplicaRequested && requestedDecorativeMediaAnchors.length > 0,
    requiresDecorativeBadgeAnchors:
      exactReplicaRequested && requestedDecorativeBadgeAnchors.length > 0,
    requiresRatingStars:
      exactReplicaRequested &&
      RATING_STAR_REFERENCE_PATTERNS.some((pattern) => pattern.test(query)),
    requiresComparisonIconography:
      exactReplicaRequested &&
      archetype === "comparison_table" &&
      COMPARISON_ICON_REFERENCE_PATTERNS.some((pattern) => pattern.test(query)),
    requiresTitleAccent:
      exactReplicaRequested &&
      /\b(cursief|italic|italics|accent(?:woord| word)?|emphasis|emphasized)\b/i.test(
        query
      ),
    requiresOverlayTreatment:
      exactReplicaRequested &&
      /\b(overlay|gradient|fade|verloop|schaduw)\b/i.test(query),
    requiresNavButtons:
      exactReplicaRequested &&
      /\b(pijl|pijlen|arrow|arrows|prev|next|navigatie|navigation)\b/i.test(
        query
      ),
    requiresThemeWrapperMirror: exactReplicaWrapperMirror,
    requiresTwoSurfaceComposition: wantsDedicatedInnerCard,
    requiresDedicatedInnerCard: wantsDedicatedInnerCard,
    avoidDoubleSectionShell:
      exactReplicaWrapperMirror &&
      (wantsDedicatedInnerCard ||
        hasScreenshotLikeReference ||
        hasDesktopMobileReferences),
    requestedVisibleCardsDesktop: extractRequestedVisibleCardCount(query),
  };
};

const convertUnitToPx = (value, unit) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }

  switch (String(unit || "").toLowerCase()) {
    case "px":
      return numeric;
    case "rem":
    case "em":
      return numeric * 16;
    default:
      return null;
  }
};

const extractPropertyMaxPx = (source, propertyNames) => {
  if (!Array.isArray(propertyNames) || propertyNames.length === 0) {
    return null;
  }

  const declarationPattern = new RegExp(
    `(?:${propertyNames.map((name) => escapeRegExp(name)).join("|")})\\s*:\\s*([^;{}]+)`,
    "gi"
  );
  const measurementPattern = /(-?\d*\.?\d+)\s*(px|rem|em)\b/gi;
  const values = [];

  for (const match of source.matchAll(declarationPattern)) {
    const declarationValue = String(match[1] || "");
    for (const measurement of declarationValue.matchAll(measurementPattern)) {
      const pxValue = convertUnitToPx(measurement[1], measurement[2]);
      if (pxValue !== null) {
        values.push(pxValue);
      }
    }
  }

  if (values.length === 0) {
    return null;
  }

  return Math.round(Math.max(...values));
};

const getMaxSpacingDefault = (spacingSettings = []) => {
  const defaults = spacingSettings
    .map((setting) =>
      typeof setting?.default === "number" && Number.isFinite(setting.default)
        ? setting.default
        : null
    )
    .filter((value) => value !== null);

  if (defaults.length === 0) {
    return null;
  }

  return Math.max(...defaults);
};

const inferHeroLikeName = ({ key, schemaName }) => {
  const haystack = `${String(key || "")} ${String(schemaName || "")}`;
  return HERO_SECTION_PATTERNS.some((pattern) => pattern.test(haystack));
};

const scoreCategoryFromPatterns = (haystack, category) =>
  (SECTION_CATEGORY_PATTERNS[category] || []).reduce(
    (score, pattern) => score + (pattern.test(haystack) ? 2 : 0),
    0
  );

const normalizeSnippetName = (key) =>
  String(key || "")
    .replace(/^snippets\//, "")
    .replace(/\.liquid$/, "");

const buildCategorySetFromScores = (scores) => {
  const active = [];
  if ((scores.interactive || 0) >= 2) {
    active.push("interactive");
  }
  if ((scores.media || 0) >= 2) {
    active.push("media");
  }
  if ((scores.commerce || 0) >= 2) {
    active.push("commerce");
  }

  const hasStrongStaticSignal = (scores.static || 0) >= 2;
  if (active.length === 0 || hasStrongStaticSignal) {
    active.push("static");
  }

  return uniqueStrings(active);
};

const buildSafeUnitStrategy = ({
  category,
  themeContext = null,
  themeScale = {},
  spacingSettings = [],
}) => {
  const spacingSettingIds = spacingSettings
    .map((setting) => String(setting?.id || "").trim())
    .filter(Boolean);
  const typographyLimit =
    typeof themeScale?.maxExplicitFontSizePx === "number"
      ? themeScale.maxExplicitFontSizePx
      : null;
  const spacingLimit =
    typeof themeScale?.maxExplicitPaddingYPx === "number"
      ? themeScale.maxExplicitPaddingYPx
      : typeof themeScale?.maxSpacingSettingDefaultPx === "number"
        ? themeScale.maxSpacingSettingDefaultPx
        : null;

  return {
    typography: typographyLimit
      ? `Gebruik bij gewone content sections liever bestaande title/subtitle classes of houd expliciete font-sizes ongeveer <= ${typographyLimit}px tenzij de gebruiker expliciet een hero/banner vraagt.`
      : "Gebruik bij voorkeur bestaande theme-typography classes in plaats van grote rem/clamp aannames.",
    spacing: spacingSettingIds.length > 0
      ? `Spiegel bestaande spacing-settings zoals ${spacingSettingIds.join(", ")} en houd defaults step-aligned.`
      : spacingLimit
        ? `Houd verticale spacing in dezelfde orde als het doeltheme, ongeveer <= ${spacingLimit}px.`
        : "Gebruik theme-consistente spacing en vermijd hero-achtige vaste paddings voor gewone content sections.",
    wrappers: themeContext?.usesPageWidth
      ? "Gebruik de page-width/container wrapper van het doeltheme voor normale content sections."
      : "Gebruik de bestaande content-wrapper van het doeltheme als die beschikbaar is.",
    media:
      "Gebruik image_url + image_tag voor afbeeldingen, en gebruik type 'video' voor merchant-uploaded video of video_url alleen voor externe embeds.",
    javascript:
      category === "interactive" || category === "hybrid"
        ? "Zet Liquid-waarden eerst in losse JS-variabelen of data-attributen en scope selectors per section-root; gebruik pas daarna gewone JS-interpolatie."
        : "Houd JS minimaal en component-scoped wanneer interactiviteit echt nodig is.",
  };
};

const describeHelperReason = (name) => {
  if (/section[-_ ]?properties|section[-_ ]?spacing|spacing[-_ ]?collaps/i.test(name)) {
    return "theme wrapper and spacing helper";
  }
  if (/button/i.test(name)) {
    return "theme button styling/helper";
  }
  if (/slider|carousel|accordion|tabs?|pagination|controls?/i.test(name)) {
    return "interactive behavior helper";
  }
  if (/image|video|gallery|logo|media/i.test(name)) {
    return "media rendering helper";
  }
  if (/product|price|buy|variant|badge|quantity/i.test(name)) {
    return "commerce rendering helper";
  }
  if (/icon/i.test(name)) {
    return "shared icon helper";
  }
  return "theme helper snippet";
};

const scoreHelperSnippet = (file, { category, themeContext = null } = {}) => {
  const name = normalizeSnippetName(file?.key);
  let score = 0;

  for (const pattern of HELPER_SNIPPET_PATTERNS.shared) {
    if (pattern.test(name)) {
      score += 12;
    }
  }

  for (const pattern of HELPER_SNIPPET_PATTERNS[category] || []) {
    if (pattern.test(name)) {
      score += 18;
    }
  }

  if (themeContext?.usesButtonClass && /button/i.test(name)) {
    score += 8;
  }
  if (themeContext?.usesRte && /rte|rich[-_ ]?text/i.test(name)) {
    score += 8;
  }
  if (themeContext?.usesPageWidth && /section|container|wrapper|layout/i.test(name)) {
    score += 6;
  }

  return score;
};

const inferQualityTarget = ({ query = "", sectionTypeHint = "", fileKey = "" } = {}) => {
  const haystack = normalizeText(`${query} ${sectionTypeHint} ${fileKey}`);
  if (!haystack) {
    return "theme_consistent";
  }

  return EXACT_MATCH_PATTERNS.some((pattern) => pattern.test(haystack))
    ? "exact_match"
    : "theme_consistent";
};

const buildCompletionPolicy = ({ qualityTarget = "theme_consistent" } = {}) => {
  if (qualityTarget === "exact_match") {
    return {
      deliveryExpectation: "final_reference_match_in_first_write",
      askBeforeVisualRefinement: false,
      askBeforePlacement: true,
      stagedVisualUpgradeAllowed: false,
      onlyAskFollowUpOnValidationBlockers: true,
      treatReferenceImagesAsFinalTarget: true,
      hint:
        "Als de gebruiker vraagt om een screenshot of referentie na te maken, lever dan direct de volledige styling, interactie en responsive afwerking in de eerste write. Vraag niet eerst of je hem daarna pixel-perfect moet maken.",
    };
  }

  return {
    deliveryExpectation: "complete_theme_consistent_section_in_first_write",
    askBeforeVisualRefinement: false,
    askBeforePlacement: true,
    stagedVisualUpgradeAllowed: false,
    onlyAskFollowUpOnValidationBlockers: true,
    treatReferenceImagesAsFinalTarget: false,
    hint:
      "Lever direct een complete, bruikbare section in de eerste write. Gebruik follow-up alleen voor validatiefixes of wanneer placement expliciet extra gevraagd wordt.",
  };
};

const buildWriteStrategy = ({ category, qualityTarget = "theme_consistent" } = {}) => {
  if (qualityTarget === "exact_match") {
    return {
      mode: "single_precise_create_then_full_edit_if_needed",
      firstTool: "create-theme-section",
      followUpTool: "draft-theme-artifact",
      allowedRefineStrategy: "full_rewrite_only",
      maxCreateAttempts: 1,
      preferFullRewriteAfterCreate: true,
      disallowPatchBatchRefine: true,
      hint:
        "Voor exacte screenshot/design-replica's: lees eerst alle required reads, doe daarna één precieze create-write en gebruik alleen draft-theme-artifact mode='edit' met een volledige rewrite als bredere visuele correcties nog nodig zijn.",
    };
  }

  if (category === "interactive" || category === "hybrid") {
    return {
      mode: "single_create_then_full_edit_if_needed",
      firstTool: "create-theme-section",
      followUpTool: "draft-theme-artifact",
      allowedRefineStrategy: "full_rewrite_preferred",
      maxCreateAttempts: 1,
      preferFullRewriteAfterCreate: true,
      disallowPatchBatchRefine: true,
      hint:
        "Maak eerst één volledige section-write met parser-veilige JS en theme-aware wrappers. Gebruik voor bredere vervolgverbeteringen of rewrites daarna draft-theme-artifact mode='edit'; reserveer patch-theme-file alleen voor kleine, unieke literal fixes.",
    };
  }

  if (category === "media") {
    return {
      mode: "single_create_then_media_edit_if_needed",
      firstTool: "create-theme-section",
      followUpTool: "draft-theme-artifact",
      allowedRefineStrategy: "full_rewrite_preferred",
      maxCreateAttempts: 1,
      preferFullRewriteAfterCreate: true,
      disallowPatchBatchRefine: true,
      hint:
        "Maak eerst één complete section en laat media-rendering vooraf valideren op image_tag/video settings en responsieve wrappers. Gebruik voor bredere vervolgstappen liever draft-theme-artifact mode='edit' dan losse grote patches.",
    };
  }

  if (category === "commerce") {
    return {
      mode: "single_create_with_theme_helpers",
      firstTool: "create-theme-section",
      followUpTool: "draft-theme-artifact",
      allowedRefineStrategy: "full_rewrite_preferred",
      maxCreateAttempts: 1,
      preferFullRewriteAfterCreate: true,
      disallowPatchBatchRefine: true,
      hint:
        "Spiegel bestaande price/button/product helpers en gebruik alleen een multi-file edit als de planner daar expliciet om vraagt.",
    };
  }

  return {
    mode: "single_create",
    firstTool: "create-theme-section",
    followUpTool: "patch-theme-file",
    allowedRefineStrategy: "literal_patch_or_full_rewrite",
    maxCreateAttempts: 1,
    preferFullRewriteAfterCreate: false,
    disallowPatchBatchRefine: false,
    hint:
      "Lees de planner-provided referenties in één compacte read-call en doe daarna één complete create-write.",
  };
};

const buildLayoutContract = ({
  archetype = "content_section",
  referenceSignals = null,
} = {}) => {
  const heroShellFamily =
    referenceSignals?.heroShellFamily ||
    inferHeroShellFamily({
      archetype,
    });
  const sectionShellFamily =
    referenceSignals?.sectionShellFamily ||
    inferSectionShellFamily({
      archetype,
    });
  const isMediaFirstHero = heroShellFamily === "media_first_unboxed";
  const isFullBleedHero = archetype === "hero_full_bleed_media";
  const isSplitHero = heroShellFamily === "split";
  const isBoxedHero = heroShellFamily === "boxed";
  const isBoundedCardShell = sectionShellFamily === "bounded_card_shell";
  const isMediaSurface = sectionShellFamily === "media_surface";
  const isCommerceScaffold = sectionShellFamily === "commerce_scaffold";

  return {
    heroShellFamily,
    sectionShellFamily,
    outerShell: isFullBleedHero
      ? "full_bleed"
      : isBoxedHero
        ? "boxed"
        : isSplitHero
          ? "bounded_split"
          : isMediaFirstHero
            ? "media_first"
            : isBoundedCardShell
              ? "bounded_card_shell"
              : isMediaSurface
                ? "media_surface"
                : isCommerceScaffold
                  ? "commerce_scaffold"
            : "theme_default",
    contentWidthStrategy: isFullBleedHero
      ? "inner_content_wrapper"
      : isBoxedHero
        ? "boxed_shell"
        : isSplitHero
          ? "outer_content_wrapper"
          : isBoundedCardShell
            ? "outer_content_wrapper"
            : isMediaSurface
              ? "theme_media_wrapper"
              : isCommerceScaffold
                ? "existing_theme_scaffold"
          : "theme_default",
    mediaPlacement: isMediaFirstHero
      ? "background_layer"
      : isSplitHero
        ? "inline_end_column"
        : isBoxedHero
          ? "boxed_shell_media"
          : isBoundedCardShell
            ? "supporting_media_or_cards"
            : isMediaSurface
              ? "inline_media_or_slider"
              : isCommerceScaffold
                ? "theme_renderer"
          : "flexible",
    contentPlacement: isMediaFirstHero
      ? "overlay_layer"
      : isSplitHero
        ? "inline_start_column"
        : isBoxedHero
          ? "boxed_flow"
          : isBoundedCardShell
            ? "bounded_card_stack"
            : isMediaSurface
              ? "media_frame_or_copy_stack"
              : isCommerceScaffold
                ? "theme_renderer"
          : "flow",
    overlayRequired:
      isMediaFirstHero || Boolean(referenceSignals?.requiresOverlayTreatment),
    fallbackMediaStrategy: isMediaFirstHero
      ? "shared_primary_slot"
      : isBoundedCardShell || isMediaSurface
        ? "consistent_media_path"
      : referenceSignals?.prefersRenderablePreviewMedia
        ? "consistent_media_path"
        : "theme_default",
    sharedMediaSlotRequired: isMediaFirstHero,
    requiresBackgroundMediaArchitecture: isMediaFirstHero,
    avoidOuterContainer: isMediaFirstHero,
    avoidSplitLayoutAssumption: isMediaFirstHero,
    allowOuterContainer: !isMediaFirstHero,
    outerShellOwnsMediaBounds: isMediaFirstHero,
    allowInnerContentWidthMirror: isMediaFirstHero || isBoundedCardShell,
    forbidOuterThemeWrapperMirror: isMediaFirstHero,
    requiresDedicatedInnerCard: Boolean(referenceSignals?.requiresDedicatedInnerCard),
    preferBoundedShell: isBoundedCardShell,
    preferMediaSurface: isMediaSurface,
    preferExistingCommerceScaffold: isCommerceScaffold,
  };
};

const buildThemeWrapperStrategy = ({
  archetype = "content_section",
  themeContext = null,
  referenceSignals = null,
} = {}) => {
  const heroShellFamily =
    referenceSignals?.heroShellFamily ||
    inferHeroShellFamily({
      archetype,
    });
  const sectionShellFamily =
    referenceSignals?.sectionShellFamily ||
    inferSectionShellFamily({
      archetype,
    });
  const isMediaFirstHero = heroShellFamily === "media_first_unboxed";
  const isBoxedHero = heroShellFamily === "boxed";
  const isBoundedCardShell = sectionShellFamily === "bounded_card_shell";
  const isMediaSurface = sectionShellFamily === "media_surface";
  const isCommerceScaffold = sectionShellFamily === "commerce_scaffold";
  const prefersThemeContentWidth = Boolean(themeContext?.usesPageWidth);

  return {
    heroShellFamily,
    sectionShellFamily,
    mirrorThemeSpacingSettings: true,
    mirrorThemeHelpers: true,
    usesPageWidth: prefersThemeContentWidth,
    usesSectionPropertiesWrapper: Boolean(themeContext?.usesSectionPropertiesWrapper),
    preferredContentWidthLayer: isMediaFirstHero
      ? "inner_content"
      : isBoundedCardShell
        ? prefersThemeContentWidth
          ? "outer_shell"
          : "bounded_shell"
      : isBoxedHero
        ? "boxed_shell"
        : isCommerceScaffold
          ? "existing_renderer_shell"
        : prefersThemeContentWidth
          ? "outer_shell"
          : "theme_default",
    preferredHelperPlacement: isMediaFirstHero
      ? "inner_content_or_spacing_layer"
      : isBoundedCardShell
        ? "outer_shell_or_inner_card"
      : isBoxedHero
          ? "boxed_shell_or_inner_content"
          : isCommerceScaffold
            ? "existing_renderer_shell"
            : isMediaSurface
              ? "outer_shell_or_media_frame"
          : "theme_default",
    allowOuterThemeContainer: !isMediaFirstHero,
    allowInnerContentWidthMirror: isMediaFirstHero || prefersThemeContentWidth,
    forbidOuterThemeWrapperMirror: isMediaFirstHero,
    preferBoundedShell: isBoundedCardShell,
    preferExistingCommerceScaffold: isCommerceScaffold,
  };
};

const buildPromptOnlyContract = ({
  query = "",
  qualityTarget = "theme_consistent",
  archetype = "content_section",
} = {}) => {
  if (qualityTarget === "exact_match") {
    return {
      promptOnly: false,
      requiredMarkupSignals: [],
      requiredSchemaSignals: [],
      hints: [],
    };
  }

  const haystack = normalizeText(query);
  const singleReviewRequested =
    /\b(?:single|one|1|een enkele|één)\b.{0,40}\b(?:review|testimonial|quote|beoordeling)\b/.test(
      haystack
    ) ||
    /\b(?:review|testimonial|quote|beoordeling)\b.{0,40}\b(?:single|one|1|een enkele|één)\b/.test(
      haystack
    );
  const reviewLike =
    archetype === "review_slider" || archetype === "review_section";
  const videoLike =
    archetype === "video_section" || archetype === "video_slider";
  const carouselLike =
    archetype === "review_slider" ||
    archetype === "video_slider" ||
    archetype === "image_slider" ||
    archetype === "social_slider" ||
    archetype === "collection_slider" ||
    archetype === "logo_slider" ||
    archetype === "media_carousel";
  const accordionLike = archetype === "faq_collapsible";
  const rangeCompareLike = archetype === "before_after";
  const tabsLike = /\btabs?\b/.test(haystack);
  const genericInteractiveLike =
    archetype === "interactive_section" && !accordionLike && !tabsLike;
  const interactionPattern = carouselLike
    ? "carousel"
    : accordionLike
      ? "accordion"
      : rangeCompareLike
        ? "range_compare"
        : tabsLike
          ? "tabs"
          : genericInteractiveLike
            ? "generic_interactive"
            : null;
  const interactiveLike = Boolean(interactionPattern);
  const commerceLike =
    archetype === "pdp_section" ||
    archetype === "featured_product_section" ||
    archetype === "commerce_section" ||
    archetype === "native_block";
  const collectionLike =
    archetype === "featured_collection_section" ||
    archetype === "collection_slider";

  return {
    promptOnly: true,
    requiresReviewContentSignals: reviewLike,
    requiresReviewCardSurface: reviewLike,
    requiresBlockBasedCards: reviewLike && !singleReviewRequested,
    requiresRatingOrQuoteSignal: reviewLike,
    interactionPattern,
    requiresSliderControls: carouselLike,
    requiresSliderBehavior: carouselLike,
    requiresInteractiveBehavior: interactiveLike,
    requiresThemeEditorSafeInteractivity: interactiveLike,
    requiresVideoSourceSetting: videoLike,
    requiresVideoRenderablePath: videoLike,
    requiresProductContextOrSetting: commerceLike,
    requiresCollectionContextOrSetting: collectionLike,
    requiresCommerceActionSignal: commerceLike,
    requiredMarkupSignals: uniqueStrings([
      ...(reviewLike ? ["review_card_or_quote_markup", "rating_or_quote_signal"] : []),
      ...(interactiveLike ? ["functional_interactive_behavior"] : []),
      ...(videoLike ? ["video_or_external_embed_render_path"] : []),
      ...(commerceLike
        ? ["product_context_or_product_setting", "commerce_action_or_product_helper"]
        : []),
      ...(collectionLike ? ["collection_context_or_collection_setting"] : []),
    ]),
    requiredSchemaSignals: uniqueStrings([
      ...(reviewLike && !singleReviewRequested ? ["review_blocks"] : []),
      ...(videoLike ? ["video_or_video_url_setting"] : []),
      ...(commerceLike ? ["product_setting_or_product_context"] : []),
      ...(collectionLike ? ["collection_setting_or_collection_context"] : []),
    ]),
    hints: uniqueStrings([
      ...(reviewLike
        ? [
            "Gebruik voor prompt-only review/testimonial sections herhaalbare review cards of blocks met quote, naam en rating-signalen.",
            "Behoud een bounded card/panel surface zodat reviews niet degraderen naar één vlak richtext-blok.",
          ]
        : []),
      ...(interactiveLike
        ? [
            interactionPattern === "carousel"
              ? "Gebruik voor interactieve carousels of sliders echte werking: scroll-snap of component-scoped JS die controls aan werkend gedrag koppelt."
              : interactionPattern === "accordion"
                ? "Gebruik voor collapsible content native <details>/<summary> of een editor-safe accordion met correcte open/closed state per item."
                : interactionPattern === "range_compare"
                  ? "Gebruik voor before/after sections een echte input/handle of andere renderbare compare-interactie, niet alleen een stilstaande mockup."
                  : interactionPattern === "tabs"
                    ? "Gebruik voor tabs een echte tablist/tab/tabpanel-structuur met werkende state-switching per section instance."
                    : "Gebruik voor interactieve sections echte werking per section instance; zichtbare controls, toggles of handles mogen geen styling-only mock zijn.",
            "Scope interactieve logica per section-root en maak scripted gedrag veilig voor Theme Editor reload/select events.",
          ]
        : []),
      ...(videoLike
        ? [
            "Gebruik een merchant-editable video of video_url setting en render die blank-safe in de eerste write.",
            "Geef video sliders echte controls of een scroll-snap/slide structuur met Theme Editor-veilige initialisatie.",
          ]
        : []),
      ...(commerceLike
        ? [
            "Gebruik product context, een product setting of bestaande theme product helpers; schrijf geen statische fake prijs/CTA als PDP-output.",
            "Behoud PDP/product flows als commerce scaffold in plaats van een losse marketing-card zonder productbron.",
          ]
        : []),
      ...(collectionLike
        ? [
            "Gebruik een collection setting of bestaande collection context zodat merchants de productbron kunnen beheren.",
            "Render collection/product cards vanuit echte collection data in plaats van statische kaartmarkup.",
          ]
        : []),
    ]),
  };
};

const buildSectionImplementationContract = ({
  promptContract = null,
  layoutContract = null,
  themeWrapperStrategy = null,
  themeContext = null,
  relevantHelpers = [],
} = {}) => {
  const helperKeys = uniqueStrings(
    (relevantHelpers || [])
      .map((entry) => (typeof entry === "string" ? entry : entry?.key))
      .filter(Boolean)
  );
  const interactiveLike = Boolean(promptContract?.requiresInteractiveBehavior);

  return {
    schemaRules: uniqueStrings([
      "Gebruik exact één geldige {% schema %} JSON-definitie met unieke setting IDs.",
      "Geef iedere merchant-editable setting en block-setting een label, behalve types zoals header en paragraph.",
      "Voeg minstens één render-safe preset toe zodat de section direct zichtbaar is in de Theme Editor.",
    ]),
    renderingRules: uniqueStrings([
      "Als je section.blocks rendert, zet {{ block.shopify_attributes }} op de top-level block-wrapper binnen dezelfde loop.",
      "Gebruik blank-safe guards rond optionele image/video/product settings voordat je image_tag, video_tag of product-output rendert.",
      "Gebruik voor Shopify-images bij voorkeur image_url gevolgd door image_tag in plaats van raw <img> wanneer de bron uit Shopify komt.",
      "Herhaalbare content zoals slides, FAQ-items, reviews, comparison rows, logo's en tab-panels moet via schema.blocks of een echte Shopify resource setting merchant-editable blijven.",
    ]),
    stylingRules: uniqueStrings([
      "Plaats geen Liquid in {% stylesheet %} of {% javascript %}; gebruik <style> voor Liquid-afhankelijke CSS en gewone markup/data-attributen voor runtime-waarden.",
      "Scope lokale CSS en JS per section instance via #shopify-section-{{ section.id }}, data-section-id of een lokaal root-element.",
      "Lever altijd een expliciete desktop- en mobiele compositie, bijvoorbeeld via @media, @container of een aantoonbaar responsive layoutpatroon.",
    ]),
    interactionPattern: promptContract?.interactionPattern || null,
    interactionRules: uniqueStrings([
      ...(interactiveLike
        ? [
            "Interactiviteit moet echt werken: zichtbare controls, toggles, tabs, handles of pagination mogen geen visuele mock zijn.",
            "Initialiseer interactieve logica per section instance en maak scripted gedrag veilig voor Theme Editor reload/select events.",
          ]
        : []),
      ...(promptContract?.interactionPattern === "carousel"
        ? [
            "Carousel/sliders moeten werkend scroll-, snap- of slidegedrag bevatten; prev/next knoppen moeten gekoppeld zijn aan echte navigatie.",
          ]
        : []),
      ...(promptContract?.interactionPattern === "accordion"
        ? [
            "Accordion/collapsible content moet echte open/closed state hebben, bij voorkeur via native <details>/<summary> of een gelijkwaardige toegankelijke toggle.",
          ]
        : []),
      ...(promptContract?.interactionPattern === "range_compare"
        ? [
            "Before/after sections moeten een werkende compare-handle of range-input hebben in plaats van een statische split-layout.",
          ]
        : []),
      ...(promptContract?.interactionPattern === "tabs"
        ? [
            "Tabs moeten een echte tablist/tab/tabpanel-structuur of gelijkwaardige toegankelijke state-switching per section instance hebben.",
          ]
        : []),
    ]),
    themeRules: uniqueStrings([
      ...(helperKeys.length > 0
        ? [
            `Spiegel relevante theme helpers waar passend, zoals ${helperKeys.join(", ")}.`,
          ]
        : []),
      ...(themeContext?.usesPageWidth
        ? [
            "Spiegel bestaande content-width wrappers van het doeltheme waar passend, in plaats van een losstaande globale shell te introduceren.",
          ]
        : []),
      ...(themeWrapperStrategy?.allowOuterThemeContainer === false ||
      layoutContract?.avoidOuterContainer
        ? [
            "Plaats outer theme containers bij media-first/full-bleed shells alleen waar de layoutcontracten dat toelaten.",
          ]
        : []),
    ]),
    editRules: [
      "Bij edits: behoud bestaande schema settings, blocks, presets, accessibility-attributen en render helpers tenzij de wijziging ze expliciet verandert.",
      "Na patch_scope_too_large: lees eerst het actuele bestand opnieuw in en voer daarna pas een preserve-on-edit rewrite uit.",
    ],
  };
};

const buildCategoryGuardrails = ({
  category,
  archetype = "content_section",
  themeContext = null,
  referenceSignals = null,
  layoutContract = null,
  themeWrapperStrategy = null,
  promptContract = null,
}) => {
  const guardrails = [...(themeContext?.guardrails || [])];

  if (category === "interactive" || category === "hybrid") {
    guardrails.push(
      "Scope interactieve JS per section instance via section.id, data-section-id of een lokaal root-element.",
      "Gebruik losse JS-variabelen voor Liquid-waarden voordat je template literals gebruikt."
    );
  }

  if (category === "media" || category === "hybrid") {
    guardrails.push(
      "Gebruik responsieve media wrappers en mirror bestaande image/video helper-patronen van het theme.",
      "Houd gewone media/content sections binnen de bestaande page-width tenzij de gebruiker expliciet een hero vraagt."
    );
  }

  if (category === "commerce" || category === "hybrid") {
    guardrails.push(
      "Spiegel bestaande product/button/price helpers in plaats van eigen commerce-markup te introduceren."
    );
  }

  if (layoutContract?.requiresBackgroundMediaArchitecture) {
    guardrails.push(
      "Gebruik voor media-first heroes een media layer, overlay layer en content layer in plaats van een losse inline media-kolom.",
      "Laat fallback-media en geüploade media hetzelfde primaire media-slot en dezelfde wrapper-hiërarchie delen."
    );
  }

  if (layoutContract?.avoidSplitLayoutAssumption) {
    guardrails.push(
      "Interpreteer een hero met content links en media visueel rechts niet automatisch als split two-column layout wanneer de referentie eigenlijk background-media met overlay toont."
    );
  }

  if (layoutContract?.avoidOuterContainer || themeWrapperStrategy?.allowOuterThemeContainer === false) {
    guardrails.push(
      "Plaats theme helpers zoals page-width, container of section-properties bij full-bleed/media-first heroes alleen op een inner content- of spacer-laag en niet blind op de outer media-shell."
    );
  }

  if (layoutContract?.requiresDedicatedInnerCard) {
    guardrails.push(
      "Behoud bij bounded review/comparison replica's zowel een bounded outer shell als een duidelijke inner card- of panel-surface. Degradeer niet naar een vlakke full-width sectie zonder kaartlaag."
    );
  }

  if (archetype === "hero_split_layout") {
    guardrails.push(
      "Behoud bij split heroes een echte inline media-kolom en degradeer die niet naar een background-media shell achter de content."
    );
  }

  if (archetype === "hero_boxed_shell") {
    guardrails.push(
      "Behoud bij boxed heroes de bounded outer shell en laat die niet onbedoeld full-bleed worden door generieke wrapper-spiegeling."
    );
  }

  if (archetype === "comparison_table" && referenceSignals?.exactReplicaRequested) {
    guardrails.push(
      "Behoud bij comparison screenshot-replica's de bounded shell plus inner comparison card compositie uit de referentie, niet alleen een generieke tabel-layout.",
      "Als de referentie decoratieve anchors zoals een floating product-afbeelding of badge/seal toont, laat die niet weg in de eerste write; maak ze merchant-editable wanneer mogelijk."
    );
  }

  if (archetype === "review_slider" && referenceSignals?.exactReplicaRequested) {
    guardrails.push(
      "Behoud bij review-slider replica's de bounded shell plus zichtbare review cards. Maak er geen generieke full-width quote-wall van tenzij de referentie dat echt toont."
    );
  }

  if (
    promptContract?.promptOnly &&
    (archetype === "review_slider" || archetype === "review_section")
  ) {
    guardrails.push(
      "Prompt-only review/testimonial sections moeten direct review-card fidelity hebben: herhaalbare cards of blocks, quote/rating/signalen en een duidelijke bounded card/panel surface.",
      "Maak van een reviewprompt geen generieke richtext section met alleen heading/copy/CTA."
    );
  }

  if (archetype === "video_section" || archetype === "video_slider") {
    guardrails.push(
      "Gebruik setting type 'video' voor merchant-uploaded video en gebruik video_url alleen voor externe YouTube/Vimeo embeds.",
      "Laat video sections merchant-editable en blank-safe renderen; combineer het video-contract niet met losse hardcoded embedlogica."
    );
  }

  if (
    promptContract?.promptOnly &&
    (archetype === "pdp_section" || archetype === "commerce_section")
  ) {
    guardrails.push(
      "Prompt-only PDP/product sections moeten een echte productbron of productcontext gebruiken en mogen niet eindigen als statische marketingkaart met fake prijs of fake add-to-cart.",
      "Spiegel bestaande product helpers voor prijs, knoppen en variantcontext wanneer het doeltheme die al heeft."
    );
  }

  if (layoutContract?.preferExistingCommerceScaffold) {
    guardrails.push(
      "Behoud bij commerce/native-block flows de bestaande product-renderer scaffold van het theme. Vervang product-info, buy_buttons of price-renderers niet door een los marketing-shell."
    );
  }

  if (archetype === "featured_product_section") {
    guardrails.push(
      "Featured product sections moeten een echte product setting of product context gebruiken, met productprijs/CTA vanuit die bron in plaats van statische fake commerce-markup."
    );
  }

  if (archetype === "featured_collection_section" || archetype === "collection_slider") {
    guardrails.push(
      "Featured collection sections moeten een collection setting of collection context gebruiken zodat merchants de bron kunnen beheren.",
      "Render product/cards vanuit echte collection data of merchant-editable blocks; schrijf geen statische productkaart-lijst als eindresultaat."
    );
  }

  if (referenceSignals?.requiresRatingStars) {
    guardrails.push(
      "Behoud ster- of rating-iconografie uit de referentie; vervang die niet door generieke blokjes of vormloze placeholders."
    );
  }

  if (referenceSignals?.requiresComparisonIconography) {
    guardrails.push(
      "Behoud comparison-iconografie zoals check/x/thumb-achtige markers; vervang die niet door generieke cirkels of lege vakken."
    );
  }

  if (referenceSignals?.avoidDoubleSectionShell) {
    guardrails.push(
      "Gebruik geen dubbele achtergrond-shell. Combineer een theme wrapper helper met een eigen decoratieve shell alleen wanneer duidelijk is welke laag spacing en welke laag de visuele surface beheert."
    );
  }

  return uniqueStrings(guardrails);
};

const classifySectionGeneration = ({
  query = "",
  sectionTypeHint = "",
  fileKey = "",
  source = "",
  schema = null,
} = {}) => {
  const haystack = `${query} ${sectionTypeHint} ${fileKey} ${String(schema?.name || "")}`.toLowerCase();
  const sourceText = String(source || "");
  const scores = {
    static: scoreCategoryFromPatterns(haystack, "static"),
    interactive: scoreCategoryFromPatterns(haystack, "interactive"),
    media: scoreCategoryFromPatterns(haystack, "media"),
    commerce: scoreCategoryFromPatterns(haystack, "commerce"),
  };

  const hasInlineScript = /<script\b/i.test(sourceText);
  const hasInteractiveMarkup =
    /<details\b|<summary\b|scroll-snap-type|aria-expanded|data-slider|data-accordion|swiper|carousel/i.test(
      sourceText
    );
  const mediaSettingCount = collectSchemaSettings(schema).filter((setting) =>
    ["image_picker", "video", "video_url"].includes(String(setting?.type || ""))
  ).length;
  const hasMediaMarkup =
    /image_tag\b|<img\b|<video\b|video_tag\b|<iframe\b|placeholder_svg_tag\b/i.test(
      sourceText
    ) || mediaSettingCount > 0;
  const hasCommerceMarkup =
    /\bproduct\b|\bcollection\b|buy_buttons|price|variant|cart|product_form/i.test(
      `${haystack} ${sourceText}`
    );

  if (hasInlineScript || hasInteractiveMarkup) {
    scores.interactive += hasInlineScript ? 2 : 1;
  }
  if (hasMediaMarkup) {
    scores.media += mediaSettingCount > 0 ? 2 : 1;
  }
  if (hasCommerceMarkup) {
    scores.commerce += 2;
  }

  const activeCategories = buildCategorySetFromScores(scores);
  const category =
    activeCategories.length === 1 ? activeCategories[0] : "hybrid";

  return {
    category,
    categorySignals: uniqueStrings(
      activeCategories
        .slice()
        .sort(
          (left, right) =>
            SECTION_CATEGORY_ORDER.indexOf(left) -
            SECTION_CATEGORY_ORDER.indexOf(right)
        )
    ),
    hasInlineScript,
    hasInteractiveMarkup,
    hasMediaMarkup,
    hasCommerceMarkup,
    heroLike: inferHeroLikeName({
      key: fileKey,
      schemaName: String(schema?.name || ""),
    }),
    mediaSettingCount,
  };
};

const buildSectionGenerationBlueprint = ({
  templateSurface,
  query,
  sectionTypeHint,
  representativeSectionFile,
  representativeSectionType = null,
  snippetFiles = [],
  themeContext = null,
} = {}) => {
  const source = representativeSectionFile?.value || "";
  const schema = parseSectionSchema(source);
  const profile = classifySectionGeneration({
    query,
    sectionTypeHint,
    fileKey:
      representativeSectionFile?.key ||
      (representativeSectionType
        ? `sections/${representativeSectionType}.liquid`
        : ""),
    source,
    schema,
  });
  const qualityTarget = inferQualityTarget({
    query,
    sectionTypeHint,
    fileKey:
      representativeSectionFile?.key ||
      (representativeSectionType
        ? `sections/${representativeSectionType}.liquid`
        : ""),
  });

  const relevantHelpers = (snippetFiles || [])
    .map((file) => ({
      file,
      score: scoreHelperSnippet(file, {
        category:
          profile.category === "hybrid"
            ? profile.categorySignals[0] || "static"
            : profile.category,
        themeContext,
      }),
    }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, 3)
    .map((entry) => ({
      key: entry.file.key,
      reason: describeHelperReason(normalizeSnippetName(entry.file.key)),
    }));

  const requiredReads = uniqueStrings([
    representativeSectionFile?.key,
    ...relevantHelpers.map((entry) => entry.key),
  ])
    .filter(Boolean)
    .map((key) => ({
      key,
      reason:
        key === representativeSectionFile?.key
          ? "representative content section"
          : relevantHelpers.find((entry) => entry.key === key)?.reason ||
            "theme helper snippet",
    }));

  const optionalReads = [];
  if (profile.category === "interactive" || profile.category === "media" || profile.category === "hybrid") {
    optionalReads.push({
      key: "layout/theme.liquid",
      reason:
        "global wrapper/context read when JS scoping or inherited container behavior is ambiguous",
    });
  }

  const riskyInheritedClasses = uniqueStrings([
    ...(themeContext?.usesPageWidth ? ["page-width"] : []),
    ...(themeContext?.usesRte ? ["rte"] : []),
    ...(themeContext?.usesButtonClass ? ["button"] : []),
    ...((themeContext?.preferredClasses || []).filter((className) =>
      ["content-container", "section", "title", "subtitle"].includes(className)
    ) || []),
  ]);

  const effectiveScaleGuide = themeContext?.scaleGuide || {};
  const effectiveSpacingSettings = themeContext?.spacingSettings || [];
  const completionPolicy = buildCompletionPolicy({ qualityTarget });
  const archetype = inferSectionArchetype({
    query,
    sectionTypeHint,
    category: profile.category,
    categorySignals: profile.categorySignals,
  });
  const referenceSignals = buildReferenceSignals({
    query,
    qualityTarget,
    category: profile.category,
    categorySignals: profile.categorySignals,
    archetype,
    heroLike: profile.heroLike,
    themeContext,
  });
  const promptContract = buildPromptOnlyContract({
    query,
    qualityTarget,
    archetype,
  });
  const layoutContract = buildLayoutContract({
    archetype,
    referenceSignals,
  });
  const themeWrapperStrategy = buildThemeWrapperStrategy({
    archetype,
    themeContext,
    referenceSignals,
  });
  const implementationContract = buildSectionImplementationContract({
    promptContract,
    layoutContract,
    themeWrapperStrategy,
    themeContext,
    relevantHelpers,
  });
  const contractPreflightChecks = [
    ...(layoutContract.requiresBackgroundMediaArchitecture
      ? [
          "Controleer dat media-first heroes zijn opgebouwd als media layer -> overlay layer -> content layer, niet als losse split-layout met een rechter media-kolom.",
        ]
      : []),
    ...(layoutContract.sharedMediaSlotRequired
      ? [
          "Controleer dat fallback-media en geüploade media exact hetzelfde primaire media-slot en dezelfde wrapper-hiërarchie delen.",
        ]
      : []),
    ...(layoutContract.avoidOuterContainer
      ? [
          "Controleer dat full-bleed/media-first hero-shells geen onterechte outer page-width of container wrapper krijgen.",
        ]
      : []),
    ...(layoutContract.requiresDedicatedInnerCard
      ? [
          "Controleer dat bounded review/comparison replica's een bounded shell plus een duidelijke inner card/panel-surface houden in plaats van een vlakke full-width sectie.",
        ]
      : []),
    ...(archetype === "video_section" || archetype === "video_slider"
      ? [
          "Controleer dat merchant-uploaded video via type 'video' + video_tag loopt en externe embeds alleen via video_url + external_video_tag/url.",
        ]
      : []),
    ...(layoutContract.preferExistingCommerceScaffold
      ? [
          "Controleer dat product/PDP flows bestaande theme renderers zoals product-info, buy_buttons en prijshelpers blijven spiegelen.",
        ]
      : []),
    ...(promptContract.requiresReviewContentSignals
      ? [
          "Controleer dat prompt-only review/testimonial sections echte review-card of quote/rating-signalen bevatten en niet alleen generieke heading/copy/CTA.",
        ]
      : []),
    ...(promptContract.requiresBlockBasedCards
      ? [
          "Controleer dat review/testimonial content via schema.blocks en een section.blocks renderer merchant-editable blijft.",
        ]
      : []),
    ...(promptContract.requiresInteractiveBehavior
      ? [
          "Controleer dat interactieve prompts echte werking hebben die past bij het gevraagde interactiepatroon; controls, tabs, toggles of handles mogen geen styling-only mock zijn.",
          "Controleer dat interactieve logica per section instance wordt gescoped en dat scripted gedrag veilig kan herinitialiseren in de Theme Editor.",
        ]
      : []),
    ...(promptContract.requiresVideoRenderablePath
      ? [
          "Controleer dat prompt-only video sections een video/video_url setting en een renderbaar, blank-safe video-pad hebben.",
        ]
      : []),
    ...(promptContract.requiresProductContextOrSetting
      ? [
          "Controleer dat PDP/product sections een echte productcontext of product setting gebruiken en geen statische fake commerce-markup schrijven.",
        ]
      : []),
    ...(promptContract.requiresCollectionContextOrSetting
      ? [
          "Controleer dat featured collection/collection-slider sections een echte collection context of collection setting gebruiken en geen statische productlijst schrijven.",
        ]
      : []),
  ];

  return {
    archetype,
    category: profile.category,
    categorySignals: profile.categorySignals,
    qualityTarget,
    generationMode:
      qualityTarget === "exact_match" ? "precision_first" : "theme_aware_baseline",
    completionPolicy,
    referenceSignals,
    promptContract,
    implementationContract,
    layoutContract,
    themeWrapperStrategy,
    requiredReads,
    optionalReads,
    relevantHelpers,
    riskyInheritedClasses,
    safeUnitStrategy: buildSafeUnitStrategy({
      category: profile.category,
      themeContext,
      themeScale: effectiveScaleGuide,
      spacingSettings: effectiveSpacingSettings,
    }),
    scaleGuide: effectiveScaleGuide,
    guardrails: buildCategoryGuardrails({
      category: profile.category,
      archetype,
      themeContext,
      referenceSignals,
      layoutContract,
      themeWrapperStrategy,
      promptContract,
    }),
    forbiddenPatterns: uniqueStrings([
      ...CATEGORY_FORBIDDEN_PATTERNS.universal,
      ...(CATEGORY_FORBIDDEN_PATTERNS[profile.category] || []),
      ...(profile.category === "hybrid"
        ? [
            ...CATEGORY_FORBIDDEN_PATTERNS.interactive,
            ...CATEGORY_FORBIDDEN_PATTERNS.media,
          ]
        : []),
    ]),
    preflightChecks: uniqueStrings([
      ...CATEGORY_EXTRA_VALIDATIONS.universal,
      ...(CATEGORY_EXTRA_VALIDATIONS[profile.category] || []),
      ...(profile.category === "hybrid"
        ? [
            ...CATEGORY_EXTRA_VALIDATIONS.interactive,
            ...CATEGORY_EXTRA_VALIDATIONS.media,
          ]
        : []),
      ...contractPreflightChecks,
      ...(qualityTarget === "exact_match"
        ? [
            "Gebruik geen snelle baseline-first aanpak: besteed extra aandacht aan typography, spacing en compositie vóór de eerste write.",
            "Gebruik bij bredere visuele refinements na create liever één volledige rewrite dan een lange patch-batch.",
            "Vraag niet eerst of je de section daarna pixel-perfect moet maken; de referentieprompt vraagt al om de finale styling in de eerste write.",
            ...(referenceSignals.requiresRenderablePreviewMedia
              ? [
                  "De eerste preview mag geen placeholder-media of lege card-slots als hoofdinhoud tonen; zorg voor direct renderbare demo/fallback media wanneer de referentie vooral beeldgedreven is.",
                ]
              : []),
            ...(referenceSignals.allowStylizedPreviewFallbacks
              ? [
                  "Als de referentie alleen uit een screenshot of mockup bestaat en losse bronmedia ontbreken, maak dan wel de exacte layout/styling af in de eerste write maar gebruik renderbare demo-media of gestileerde media shells in plaats van placeholder_svg_tag.",
                ]
              : []),
            ...(referenceSignals.requiresResponsiveViewportParity
              ? [
                  "De referentie bevat expliciet desktop- en mobile-composities. Lever beide breakpoint-varianten in de eerste write in plaats van alleen een desktop-layout die toevallig schaalt.",
                ]
              : []),
            ...(referenceSignals.requiresDecorativeMediaAnchors
              ? [
                  "Behoud onderscheidende decoratieve media-anchors uit de referentie, zoals floating productmedia of een mockupbeeld, en maak ze merchant-editable als losse bron-assets ontbreken.",
                ]
              : []),
            ...(referenceSignals.requiresDecorativeBadgeAnchors
              ? [
                  "Behoud badge- of seal-achtige reference-elementen uit de referentie in de eerste write en maak ze zo nodig merchant-editable.",
                ]
              : []),
            ...(referenceSignals.requiresRatingStars
              ? [
                  "Behoud de ster/rating-strip uit de referentie in de eerste write; degradeer niet naar generieke blokjes of abstracte vormen.",
                ]
              : []),
            ...(referenceSignals.requiresComparisonIconography
              ? [
                  "Behoud de check/x/thumb-iconografie van de vergelijking in de eerste write in plaats van generieke vormpjes.",
                ]
              : []),
            ...(referenceSignals.avoidDoubleSectionShell
              ? [
                  "Gebruik geen dubbele achtergrond-shell wanneer het doeltheme al een section-properties of vergelijkbare wrapper-helper gebruikt. Kies bewust welke laag de decoratieve background draagt.",
                ]
              : []),
            ...(referenceSignals.requiresThemeEditorLifecycleHooks
              ? [
                  "Slider- of carousel-JS moet in de eerste write al Shopify Theme Editor lifecycle hooks ondersteunen.",
                ]
              : []),
          ]
        : []),
    ]),
    helperSearchQueries: uniqueStrings([
      ...CATEGORY_SEARCH_HINTS.static,
      ...(CATEGORY_SEARCH_HINTS[profile.category] || []),
    ]).slice(0, 6),
    writeStrategy: buildWriteStrategy({
      category: profile.category,
      qualityTarget,
    }),
  };
};

const buildGuardrails = ({
  preferredClasses = [],
  spacingSettings = [],
  maxFontSizePx,
  maxPaddingYValuePx,
  maxGapPx,
  maxMinHeightPx,
}) => {
  const guardrails = [];

  if (hasPreferredContentWidthWrapper(preferredClasses)) {
    guardrails.push(
      "Gebruik de content-width wrapper van het doeltheme voor gewone content sections (bijvoorbeeld page-width of container)."
    );
  }

  if (spacingSettings.some((setting) => setting.id === "padding_top")) {
    guardrails.push(
      "Spiegel theme-specifieke spacing-settings zoals padding_top en padding_bottom in plaats van hero-achtige vaste paddings."
    );
  }

  if (typeof maxFontSizePx === "number" && Number.isFinite(maxFontSizePx)) {
    guardrails.push(
      `Houd expliciete heading-groottes ongeveer binnen ${maxFontSizePx}px tenzij de gebruiker expliciet om een hero of banner vraagt.`
    );
  }

  if (
    typeof maxPaddingYValuePx === "number" &&
    Number.isFinite(maxPaddingYValuePx)
  ) {
    guardrails.push(
      `Houd verticale paddings in dezelfde orde als de referentiesection, ongeveer tot ${maxPaddingYValuePx}px.`
    );
  }

  if (typeof maxGapPx === "number" && Number.isFinite(maxGapPx)) {
    guardrails.push(
      `Gebruik normale content-gaps in plaats van hero-achtige witruimte; de referentiesection blijft rond ${maxGapPx}px.`
    );
  }

  if (
    typeof maxFontSizePx === "number" &&
    Number.isFinite(maxFontSizePx) &&
    typeof maxPaddingYValuePx === "number" &&
    Number.isFinite(maxPaddingYValuePx)
  ) {
    guardrails.push(
      "Beperk de gecombineerde visuele massa: laat headline, kaartpadding en layout-gaps samen niet alsnog hero-groot worden wanneer elk onderdeel afzonderlijk nog net binnen de limiet valt."
    );
  }

  if (typeof maxMinHeightPx === "number" && Number.isFinite(maxMinHeightPx)) {
    guardrails.push(
      `Gebruik geen vaste hero-min-height boven ongeveer ${maxMinHeightPx}px zonder expliciete gebruikersvraag.`
    );
  }

  return uniqueStrings(guardrails);
};

const analyzeSectionScale = (value, { key } = {}) => {
  const source = String(value || "");
  const schema = parseSectionSchema(source);
  const classTokens = extractClassTokens(source);
  const preferredClasses = collectPreferredClasses(classTokens);
  const spacingSettings = collectSpacingSettings(schema);

  return {
    schemaName: String(schema?.name || "").trim() || null,
    hasRichtextSetting: collectSchemaSettings(schema).some(
      (setting) => String(setting?.type || "") === "richtext"
    ),
    preferredClasses,
    hasPageWidthClass: hasContentWidthWrapperClass(classTokens),
    hasRteClass: classTokens.includes("rte"),
    hasButtonClass: classTokens.includes("button"),
    maxFontSizePx: extractPropertyMaxPx(source, ["font-size"]),
    maxPaddingYValuePx: extractPropertyMaxPx(source, [
      "padding-top",
      "padding-bottom",
      "padding-block",
      "padding",
      "margin-top",
      "margin-bottom",
      "margin-block",
      "margin",
    ]),
    maxGapPx: extractPropertyMaxPx(source, ["gap", "row-gap", "column-gap"]),
    maxMinHeightPx: extractPropertyMaxPx(source, ["min-height", "height"]),
    maxTopOffsetPx: extractPropertyMaxPx(source, [
      "top",
      "inset-block-start",
      "inset-top",
    ]),
    hasStickyPosition: /position\s*:\s*sticky\b/i.test(source),
    usesSectionPropertiesWrapper: /render\s+['"]section-properties['"]/i.test(source),
    spacingSettings,
    maxSpacingDefaultPx: getMaxSpacingDefault(spacingSettings),
    isHeroLike: inferHeroLikeName({
      key,
      schemaName: String(schema?.name || ""),
    }),
  };
};

const createScaleIssue = ({
  fileKey,
  metric,
  actualValue,
  recommendedValue,
  representativeSectionKey,
  issueCode = "inspection_failed_theme_scale",
}) => ({
  path: [fileKey],
  problem: `De nieuwe section gebruikt ${metric} rond ${actualValue}px, terwijl vergelijkbare content sections in '${representativeSectionKey}' ongeveer rond ${recommendedValue}px blijven. Daardoor oogt deze section waarschijnlijk hero-groot en disproportioneel.`,
  fixSuggestion: `Verlaag ${metric} richting de theme-conventie uit '${representativeSectionKey}' en gebruik bestaande page-width/spacing patronen in plaats van hero-schaal waarden.`,
  suggestedReplacement: {
    recommendedMaxPx: recommendedValue,
  },
  issueCode,
});

const createCompositeScaleIssue = ({
  fileKey,
  representativeSectionKey,
  issueCode = "inspection_failed_theme_scale",
  contributingMetrics = [],
}) => ({
  path: [fileKey],
  problem: `De nieuwe section stapelt meerdere middelgrote schaalafwijkingen (${contributingMetrics.join(
    ", "
  )}). Daardoor oogt de totale compositie groter dan '${representativeSectionKey}', ook al blijft elk onderdeel afzonderlijk nog net binnen een harde limiet.`,
  fixSuggestion:
    "Breng headline, kaartpadding, layout-gaps en eventuele sticky offsets samen dichter bij de theme-conventie. Spiegel ook de bestaande wrapper/surface-strategie van het doeltheme in plaats van een hero-achtige shell op te bouwen.",
  suggestedReplacement: {
    contributingMetrics,
  },
  issueCode,
});

const collectCompositeScalePressure = ({
  candidate,
  representativeScale,
}) => {
  const contributingMetrics = [];
  let totalPressure = 0;

  const addPressure = ({
    label,
    actualValue,
    recommendedValue,
    softRatio,
    weight,
  }) => {
    if (
      typeof actualValue !== "number" ||
      !Number.isFinite(actualValue) ||
      typeof recommendedValue !== "number" ||
      !Number.isFinite(recommendedValue) ||
      recommendedValue <= 0
    ) {
      return;
    }

    const ratio = actualValue / recommendedValue;
    if (ratio <= softRatio) {
      return;
    }

    contributingMetrics.push(label);
    totalPressure += (ratio - softRatio) * weight;
  };

  addPressure({
    label: "expliciete font-size",
    actualValue: candidate.maxFontSizePx,
    recommendedValue: representativeScale.maxExplicitFontSizePx,
    softRatio: 1.15,
    weight: 1.35,
  });
  addPressure({
    label: "verticale spacing/padding",
    actualValue: candidate.maxPaddingYValuePx,
    recommendedValue:
      representativeScale.maxExplicitPaddingYPx ??
      representativeScale.maxSpacingSettingDefaultPx,
    softRatio: 1.25,
    weight: 1.1,
  });
  addPressure({
    label: "card gap/whitespace",
    actualValue: candidate.maxGapPx,
    recommendedValue: representativeScale.maxGapPx,
    softRatio: 1.2,
    weight: 1,
  });
  addPressure({
    label: "min-height/vaste hoogte",
    actualValue: candidate.maxMinHeightPx,
    recommendedValue: representativeScale.maxMinHeightPx,
    softRatio: 1.2,
    weight: 0.95,
  });

  if (candidate.hasStickyPosition && contributingMetrics.length >= 2) {
    contributingMetrics.push("sticky offset/compositie");
    totalPressure += 0.2;
  }

  return {
    contributingMetrics: uniqueStrings(contributingMetrics),
    totalPressure,
  };
};

const pushScaleWarning = (warnings, suggestedFixes, warning, fixSuggestion) => {
  warnings.push(warning);
  if (fixSuggestion) {
    suggestedFixes.push(fixSuggestion);
  }
};

const inspectSectionScaleAgainstTheme = ({
  value,
  fileKey,
  themeContext,
}) => {
  if (!themeContext || typeof value !== "string" || !fileKey) {
    return {
      issues: [],
      warnings: [],
      suggestedFixes: [],
    };
  }

  const candidate = analyzeSectionScale(value, { key: fileKey });
  const issues = [];
  const warnings = [];
  const suggestedFixes = [];
  const representativeSectionKey =
    themeContext.representativeSection?.key || "representatieve section";
  const representativeScale = themeContext.scaleGuide || {};
  const isHeroLikeCandidate = Boolean(candidate.isHeroLike);

  const maybeAddScaleIssue = ({
    actualValue,
    recommendedValue,
    metric,
    absoluteFloor,
    multiplier = 1.5,
    additiveBuffer = 16,
  }) => {
    if (
      typeof actualValue !== "number" ||
      !Number.isFinite(actualValue) ||
      typeof recommendedValue !== "number" ||
      !Number.isFinite(recommendedValue)
    ) {
      return;
    }

    const threshold = Math.max(
      Math.round(recommendedValue * multiplier),
      recommendedValue + additiveBuffer,
      absoluteFloor
    );

    if (actualValue <= threshold) {
      return;
    }

    const issue = createScaleIssue({
      fileKey,
      metric,
      actualValue,
      recommendedValue,
      representativeSectionKey,
    });

    if (isHeroLikeCandidate) {
      pushScaleWarning(
        warnings,
        suggestedFixes,
        `De nieuwe section gebruikt ${metric} rond ${actualValue}px. Dat is groter dan de normale content-conventie uit '${representativeSectionKey}', maar de section lijkt bewust hero-achtig benoemd.`,
        issue.fixSuggestion
      );
      return;
    }

    issues.push(issue);
    suggestedFixes.push(issue.fixSuggestion);
  };

  maybeAddScaleIssue({
    actualValue: candidate.maxFontSizePx,
    recommendedValue: representativeScale.maxExplicitFontSizePx,
    metric: "expliciete font-size",
    absoluteFloor: 52,
    multiplier: 1.45,
    additiveBuffer: 12,
  });

  maybeAddScaleIssue({
    actualValue: candidate.maxPaddingYValuePx,
    recommendedValue:
      representativeScale.maxExplicitPaddingYPx ??
      representativeScale.maxSpacingSettingDefaultPx,
    metric: "verticale spacing/padding",
    absoluteFloor: 120,
    multiplier: 1.75,
    additiveBuffer: 32,
  });

  maybeAddScaleIssue({
    actualValue: candidate.maxGapPx,
    recommendedValue: representativeScale.maxGapPx,
    metric: "card gap/whitespace",
    absoluteFloor: 72,
    multiplier: 1.75,
    additiveBuffer: 24,
  });

  const minHeightReference =
    representativeScale.maxMinHeightPx && representativeScale.maxMinHeightPx > 0
      ? representativeScale.maxMinHeightPx
      : null;
  const minHeightActual = candidate.maxMinHeightPx;
  if (
    typeof minHeightActual === "number" &&
    Number.isFinite(minHeightActual) &&
    minHeightActual >= 520
  ) {
    const recommendedValue = minHeightReference || 360;
    const threshold = minHeightReference
      ? Math.max(Math.round(minHeightReference * 1.5), minHeightReference + 120, 520)
      : 520;

    if (minHeightActual > threshold) {
      const issue = createScaleIssue({
        fileKey,
        metric: "min-height/vaste hoogte",
        actualValue: minHeightActual,
        recommendedValue,
        representativeSectionKey,
      });
      if (isHeroLikeCandidate) {
        pushScaleWarning(
          warnings,
          suggestedFixes,
          `De nieuwe section gebruikt min-height rond ${minHeightActual}px. Dat is groter dan de normale content-conventie uit '${representativeSectionKey}', maar de section lijkt bewust hero-achtig benoemd.`,
          issue.fixSuggestion
        );
      } else {
        issues.push(issue);
        suggestedFixes.push(issue.fixSuggestion);
      }
    }
  }

  if (!isHeroLikeCandidate && issues.length === 0) {
    const compositePressure = collectCompositeScalePressure({
      candidate,
      representativeScale,
    });

    if (
      compositePressure.contributingMetrics.length >= 2 &&
      compositePressure.totalPressure >= 0.9
    ) {
      const issue = createCompositeScaleIssue({
        fileKey,
        representativeSectionKey,
        contributingMetrics: compositePressure.contributingMetrics,
      });
      issues.push(issue);
      suggestedFixes.push(issue.fixSuggestion);
    }
  } else if (isHeroLikeCandidate) {
    const compositePressure = collectCompositeScalePressure({
      candidate,
      representativeScale,
    });
    if (
      compositePressure.contributingMetrics.length >= 2 &&
      compositePressure.totalPressure >= 0.9
    ) {
      pushScaleWarning(
        warnings,
        suggestedFixes,
        `De nieuwe section stapelt meerdere middelgrote schaalafwijkingen (${compositePressure.contributingMetrics.join(
          ", "
        )}). Dat is groter dan de normale content-conventie uit '${representativeSectionKey}', maar de section lijkt bewust hero-achtig benoemd.`,
        "Breng headline, padding en gaps dichter bij de theme-conventie wanneer de hero minder dominant moet ogen."
      );
    }
  }

  if (themeContext.usesPageWidth && !candidate.hasPageWidthClass) {
    pushScaleWarning(
      warnings,
      suggestedFixes,
      `De referentiesection '${representativeSectionKey}' gebruikt een page-width wrapper, maar deze nieuwe section niet. Daardoor kan de section visueel te breed en disproportioneel uitpakken.`,
      "Gebruik een page-width wrapper of de equivalente container-class van het doeltheme voor normale content sections."
    );
  }

  if (themeContext.usesRte && candidate.hasRichtextSetting && !candidate.hasRteClass) {
    pushScaleWarning(
      warnings,
      suggestedFixes,
      `De referentiesection '${representativeSectionKey}' gebruikt de rte-class voor rijke tekst, maar deze nieuwe section niet.`,
      "Gebruik de bestaande rte styling van het theme voor richtext-content zodat typography en spacing aansluiten."
    );
  }

  return {
    issues,
    warnings: uniqueStrings(warnings),
    suggestedFixes: uniqueStrings(suggestedFixes),
  };
};

const inferTemplateSurfaceFromSectionLiquid = (value) => {
  const schema = parseSectionSchema(value);
  if (!schema) {
    return "homepage";
  }

  const templates = [];

  if (
    schema?.enabled_on &&
    typeof schema.enabled_on === "object" &&
    Array.isArray(schema.enabled_on.templates)
  ) {
    templates.push(...schema.enabled_on.templates);
  }

  if (Array.isArray(schema?.templates)) {
    templates.push(...schema.templates);
  }

  for (const entry of templates) {
    const normalized = normalizeTemplateSurface(entry);
    if (normalized && KNOWN_TEMPLATE_SURFACES.has(normalized)) {
      return normalized;
    }
  }

  return "homepage";
};

const buildThemeSectionContext = ({
  templateSurface,
  representativeSectionFile,
  representativeSectionType = null,
}) => {
  if (
    !representativeSectionFile ||
    !representativeSectionFile.found ||
    typeof representativeSectionFile.value !== "string"
  ) {
    return null;
  }

  const analysis = analyzeSectionScale(representativeSectionFile.value, {
    key: representativeSectionFile.key,
  });

  return {
    templateSurface: normalizeTemplateSurface(templateSurface) || "homepage",
    representativeSection: {
      key: representativeSectionFile.key,
      type:
        representativeSectionType ||
        representativeSectionFile.key.replace(/^sections\//, "").replace(/\.liquid$/, ""),
    },
    preferredClasses: analysis.preferredClasses,
    usesPageWidth: analysis.hasPageWidthClass,
    usesSectionPropertiesWrapper: analysis.usesSectionPropertiesWrapper,
    usesRte: analysis.hasRteClass,
    usesButtonClass: analysis.hasButtonClass,
    spacingSettings: analysis.spacingSettings,
    scaleGuide: {
      maxExplicitFontSizePx: analysis.maxFontSizePx,
      maxExplicitPaddingYPx: analysis.maxPaddingYValuePx,
      maxGapPx: analysis.maxGapPx,
      maxMinHeightPx: analysis.maxMinHeightPx,
      maxSpacingSettingDefaultPx: analysis.maxSpacingDefaultPx,
    },
    guardrails: buildGuardrails({
      preferredClasses: analysis.preferredClasses,
      spacingSettings: analysis.spacingSettings,
      maxFontSizePx: analysis.maxFontSizePx,
      maxPaddingYValuePx: analysis.maxPaddingYValuePx,
      maxGapPx: analysis.maxGapPx,
      maxMinHeightPx: analysis.maxMinHeightPx,
    }),
  };
};

export {
  analyzeSectionScale,
  buildSectionGenerationBlueprint,
  buildThemeSectionContext,
  classifySectionGeneration,
  inferQualityTarget,
  inferTemplateSurfaceFromSectionLiquid,
  inspectSectionScaleAgainstTheme,
};
