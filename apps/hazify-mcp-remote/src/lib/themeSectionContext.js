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

const SECTION_CATEGORY_ORDER = ["interactive", "media", "commerce", "static"];

const SECTION_CATEGORY_PATTERNS = {
  static: [
    /review/i,
    /testimonial/i,
    /quote/i,
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
    /banner/i,
    /hero/i,
    /slideshow/i,
  ],
  commerce: [
    /product/i,
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

const uniqueStrings = (values) =>
  Array.from(new Set((values || []).filter(Boolean)));

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

const buildWriteStrategy = (category) => {
  if (category === "interactive" || category === "hybrid") {
    return {
      mode: "staged_create_then_tighten",
      firstTool: "create-theme-section",
      followUpTool: "patch-theme-file",
      hint:
        "Maak eerst één volledige section-write met parser-veilige JS en theme-aware wrappers. Gebruik daarna alleen kleine patch/theme-edit follow-ups als de section al bestaat.",
    };
  }

  if (category === "media") {
    return {
      mode: "single_create_with_media_preflight",
      firstTool: "create-theme-section",
      followUpTool: "patch-theme-file",
      hint:
        "Maak eerst één complete section en laat media-rendering vooraf valideren op image_tag/video settings en responsieve wrappers.",
    };
  }

  if (category === "commerce") {
    return {
      mode: "single_create_with_theme_helpers",
      firstTool: "create-theme-section",
      followUpTool: "draft-theme-artifact",
      hint:
        "Spiegel bestaande price/button/product helpers en gebruik alleen een multi-file edit als de planner daar expliciet om vraagt.",
    };
  }

  return {
    mode: "single_create",
    firstTool: "create-theme-section",
    followUpTool: "patch-theme-file",
    hint:
      "Lees de planner-provided referenties in één compacte read-call en doe daarna één complete create-write.",
  };
};

const buildCategoryGuardrails = ({ category, themeContext = null }) => {
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

  return {
    category: profile.category,
    categorySignals: profile.categorySignals,
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
      themeContext,
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
    ]),
    helperSearchQueries: uniqueStrings([
      ...CATEGORY_SEARCH_HINTS.static,
      ...(CATEGORY_SEARCH_HINTS[profile.category] || []),
    ]).slice(0, 6),
    writeStrategy: buildWriteStrategy(profile.category),
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

  if (preferredClasses.includes("page-width")) {
    guardrails.push(
      "Gebruik de page-width wrapper van het doeltheme voor gewone content sections."
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
    hasPageWidthClass: classTokens.includes("page-width"),
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
  inferTemplateSurfaceFromSectionLiquid,
  inspectSectionScaleAgainstTheme,
};
