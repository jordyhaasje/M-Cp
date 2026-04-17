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
];

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
  buildThemeSectionContext,
  inferTemplateSurfaceFromSectionLiquid,
  inspectSectionScaleAgainstTheme,
};
