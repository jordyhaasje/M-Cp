import { getThemeFiles, searchThemeFiles } from "./themeFiles.js";
import { parseJsonLike } from "./jsonLike.js";

const DEFAULT_THEME_SEARCH_LIMIT = 10;
const DEFAULT_SNIPPET_LIMIT = 3;
const DEFAULT_TEMPLATE_BY_INTENT = {
  native_block: "product",
  new_section: "homepage",
  template_placement: "homepage",
  existing_edit: "product",
};

const TEMPLATE_EXACT_KEYS = {
  article: ["templates/article.json", "templates/article.liquid"],
  blog: ["templates/blog.json", "templates/blog.liquid"],
  cart: ["templates/cart.json", "templates/cart.liquid"],
  collection: ["templates/collection.json", "templates/collection.liquid"],
  homepage: ["templates/index.json", "templates/index.liquid"],
  index: ["templates/index.json", "templates/index.liquid"],
  page: ["templates/page.json", "templates/page.liquid"],
  product: ["templates/product.json", "templates/product.liquid"],
  search: ["templates/search.json", "templates/search.liquid"],
};

const PRODUCT_SECTION_HINTS = [
  /main[-_]?product/i,
  /product[-_]?information/i,
  /featured[-_]?product/i,
  /product/i,
];

const PRODUCT_SNIPPET_HINTS = [
  /product[-_]?info/i,
  /buy[-_]?buttons/i,
  /price/i,
  /variant/i,
  /review/i,
  /accordion/i,
  /inventory/i,
];

const uniqueStrings = (values) => Array.from(new Set(values.filter(Boolean)));

const normalizeText = (value) =>
  String(value || "")
    .trim()
    .toLowerCase();

const normalizeTemplateSurface = (value, intent = "existing_edit") => {
  const normalized = normalizeText(value);
  if (!normalized) {
    return DEFAULT_TEMPLATE_BY_INTENT[intent] || "product";
  }
  if (normalized === "index") {
    return "homepage";
  }
  return normalized;
};

const safeParseJson = (value) => {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }
  try {
    return parseJsonLike(value);
  } catch (error) {
    console.warn("safeParseJson kon een String niet als JSON/JSONC parsen. Syntaxfout of ongeldige inhoud.", error.message);
    return null;
  }
};

const escapeRegExp = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

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

const extractSchemaJson = (value) => {
  const [schemaJson] = getLiquidBlockContents(value, "schema");
  return schemaJson === undefined ? null : schemaJson.trim();
};

const parseSectionSchema = (value) => safeParseJson(extractSchemaJson(value));

const buildTextSnippets = (
  content,
  query,
  { mode = "literal", snippetLength = 120, maxSnippets = 2 } = {}
) => {
  const text = typeof content === "string" ? content : "";
  if (!text) {
    return [];
  }
  const results = [];
  if (mode === "regex") {
    let regex;
    try {
      regex = new RegExp(query, "gi");
    } catch {
      throw new Error(`Ongeldige regex-query: ${query}`);
    }
    let match = regex.exec(text);
    while (match && results.length < maxSnippets) {
      const index = match.index || 0;
      const start = Math.max(0, index - Math.floor(snippetLength / 2));
      const end = Math.min(text.length, index + match[0].length + Math.floor(snippetLength / 2));
      results.push(text.slice(start, end).trim());
      if (match[0].length === 0) {
        regex.lastIndex += 1;
      }
      match = regex.exec(text);
    }
    return results;
  }
  const lowered = text.toLowerCase();
  const loweredQuery = normalizeText(query);
  let searchIndex = 0;
  while (results.length < maxSnippets) {
    const matchIndex = lowered.indexOf(loweredQuery, searchIndex);
    if (matchIndex < 0) {
      break;
    }
    const start = Math.max(0, matchIndex - Math.floor(snippetLength / 2));
    const end = Math.min(text.length, matchIndex + loweredQuery.length + Math.floor(snippetLength / 2));
    results.push(text.slice(start, end).trim());
    searchIndex = matchIndex + Math.max(loweredQuery.length, 1);
  }
  return results;
};

const extractRenderSnippetNames = (value) => {
  const matches = Array.from(
    String(value || "").matchAll(/{%-?\s*render\s+['"]([^'"]+)['"]/gi),
    (match) => match[1]
  );
  return uniqueStrings(matches.map((entry) => String(entry || "").trim()).filter(Boolean));
};

const extractLiquidTemplateSections = (value) =>
  Array.from(
    String(value || "").matchAll(/{%-?\s*section\s+['"]([^'"]+)['"]/gi),
    (match) => match[1]
  ).map((handle) => ({
    id: handle,
    type: handle,
    fileKey: `sections/${handle}.liquid`,
  }));

const extractBlockTypeCases = (value) =>
  uniqueStrings(
    Array.from(
      String(value || "").matchAll(/{%-?\s*when\s+['"]([^'"]+)['"]/gi),
      (match) => match[1]
    ).map((entry) => String(entry || "").trim()).filter(Boolean)
  );

const extractStaticThemeBlockTypes = (value) =>
  uniqueStrings(
    Array.from(
      String(value || "").matchAll(
        /content_for\s+['"]block['"][^%]*\btype:\s*['"]([^'"]+)['"]/gi
      ),
      (match) => match[1]
    ).map((entry) => String(entry || "").trim()).filter(Boolean)
  );

const analyzeLiquidFile = (value) => {
  const source = String(value || "");
  const schema = parseSectionSchema(source);
  const schemaBlockTypes = uniqueStrings(
    Array.isArray(schema?.blocks)
      ? schema.blocks.map((block) => String(block?.type || "").trim()).filter(Boolean)
      : []
  );

  return {
    renderSnippets: extractRenderSnippetNames(source),
    hasSectionBlocksLoop: /for\s+block\s+in\s+section\.blocks/i.test(source),
    referencesBlockType: /block\.type/i.test(source),
    hasBlockSwitch:
      /case\s+block\.type/i.test(source) ||
      /if\s+block\.type/i.test(source),
    hasBlockShopifyAttributes: /block\.shopify_attributes/.test(source),
    usesThemeBlockSlots:
      /content_for\s+['"]blocks['"]/i.test(source) ||
      /content_for\s+['"]block['"]/i.test(source),
    schemaBlockTypes,
    caseBlockTypes: extractBlockTypeCases(source),
    staticThemeBlockTypes: extractStaticThemeBlockTypes(source),
    supportsAppBlocks: schemaBlockTypes.includes("@app"),
    supportsThemeBlocks:
      schemaBlockTypes.includes("@theme") ||
      /content_for\s+['"]blocks['"]/i.test(source),
  };
};

const getExactTemplateKeys = (templateSurface) =>
  TEMPLATE_EXACT_KEYS[templateSurface] || [
    `templates/${templateSurface}.json`,
    `templates/${templateSurface}.liquid`,
  ];

const getAlternateTemplatePatterns = (templateSurface) => {
  const exactKeys = getExactTemplateKeys(templateSurface);
  return uniqueStrings(
    exactKeys.map((key) => {
      if (key.endsWith(".json")) {
        return key.replace(/\.json$/, "*.json");
      }
      if (key.endsWith(".liquid")) {
        return key.replace(/\.liquid$/, "*.liquid");
      }
      return key;
    })
  );
};

const scoreTemplateCandidate = (key, templateSurface) => {
  const normalizedKey = normalizeText(key);
  const exactKeys = getExactTemplateKeys(templateSurface).map((entry) => normalizeText(entry));
  const exactIndex = exactKeys.indexOf(normalizedKey);
  if (exactIndex >= 0) {
    return 100 - exactIndex;
  }
  if (normalizedKey.includes(`templates/${templateSurface}.`)) {
    return 80;
  }
  if (normalizedKey.includes(`templates/${templateSurface}`)) {
    return 70;
  }
  return 20;
};

const choosePrimaryTemplateFile = (files, templateSurface) => {
  const candidates = (files || [])
    .filter((file) => file && file.found && typeof file.value === "string")
    .slice()
    .sort(
      (left, right) =>
        scoreTemplateCandidate(right.key, templateSurface) -
        scoreTemplateCandidate(left.key, templateSurface)
    );
  return candidates[0] || null;
};

const scoreSectionEntry = (entry, { templateSurface, sectionTypeHint, index = 0 } = {}) => {
  const haystack = `${entry?.id || ""} ${entry?.type || ""} ${entry?.fileKey || ""}`;
  let score = Math.max(0, 30 - index);

  if (sectionTypeHint && normalizeText(haystack).includes(normalizeText(sectionTypeHint))) {
    score += 80;
  }

  if (templateSurface === "product") {
    const bonusIndex = PRODUCT_SECTION_HINTS.findIndex((pattern) => pattern.test(haystack));
    if (bonusIndex >= 0) {
      score += 60 - bonusIndex * 10;
    }
  }

  return score;
};

const choosePrimarySectionEntry = (entries, options = {}) => {
  const ranked = (entries || [])
    .slice()
    .map((entry, index) => ({
      entry,
      score: scoreSectionEntry(entry, { ...options, index }),
    }))
    .sort((left, right) => right.score - left.score);
  return ranked[0]?.entry || null;
};

const analyzeTemplateFile = (file, { templateSurface, sectionTypeHint } = {}) => {
  const key = String(file?.key || "");
  const value = String(file?.value || "");

  if (key.endsWith(".json")) {
    const parsed = safeParseJson(value);
    const sections = parsed && typeof parsed.sections === "object" ? parsed.sections : {};
    const order = Array.isArray(parsed?.order) ? parsed.order : Object.keys(sections);
    const sectionEntries = order
      .map((id) => ({
        id,
        type: String(sections?.[id]?.type || "").trim(),
      }))
      .filter((entry) => entry.type)
      .map((entry) => ({
        ...entry,
        fileKey: `sections/${entry.type}.liquid`,
      }));

    return {
      format: "json",
      sections: sectionEntries,
      primarySection: choosePrimarySectionEntry(sectionEntries, {
        templateSurface,
        sectionTypeHint,
      }),
    };
  }

  const sectionEntries = extractLiquidTemplateSections(value);
  return {
    format: "liquid",
    sections: sectionEntries,
    primarySection: choosePrimarySectionEntry(sectionEntries, {
      templateSurface,
      sectionTypeHint,
    }),
  };
};

const scoreSnippetName = (name, { templateSurface, query } = {}) => {
  const normalizedName = normalizeText(name);
  let score = 10;

  if (templateSurface === "product") {
    const bonusIndex = PRODUCT_SNIPPET_HINTS.findIndex((pattern) => pattern.test(normalizedName));
    if (bonusIndex >= 0) {
      score += 40 - bonusIndex * 4;
    }
  }

  const queryTokens = uniqueStrings(
    normalizeText(query)
      .split(/[^a-z0-9]+/i)
      .filter((token) => token.length >= 3)
  );
  if (queryTokens.some((token) => normalizedName.includes(token))) {
    score += 20;
  }

  return score;
};

const prioritizeSnippetNames = (names, options = {}) =>
  uniqueStrings(names)
    .slice()
    .sort(
      (left, right) =>
        scoreSnippetName(right, options) - scoreSnippetName(left, options)
    );

const pickBlockRendererSnippetKeys = (snippetFiles, snippetAnalyses) => {
  const byKey = new Map(snippetFiles.map((file) => [file.key, file]));
  const renderers = snippetAnalyses
    .filter(
      (entry) =>
        entry.analysis.hasSectionBlocksLoop ||
        entry.analysis.referencesBlockType ||
        entry.analysis.hasBlockShopifyAttributes
    )
    .map((entry) => byKey.get(entry.key))
    .filter(Boolean);

  if (renderers.length > 0) {
    return renderers.map((file) => file.key);
  }

  return [];
};

const summarizeTemplateFile = (file) => ({
  key: String(file?.key || ""),
  found: Boolean(file?.found),
  format: String(file?.key || "").endsWith(".json") ? "json" : "liquid",
});

const summarizeCandidateFile = (file, role) => ({
  key: String(file?.key || ""),
  role,
  found: Boolean(file?.found),
});

const buildPlanFromAnalysis = ({
  intent,
  templateSurface,
  templateFile,
  sectionFile,
  templateAnalysis,
  sectionAnalysis,
  snippetFiles,
  snippetAnalyses,
  query,
}) => {
  const readKeys = uniqueStrings(
    [
      templateFile?.key,
      sectionFile?.key,
      ...snippetFiles.map((file) => file.key),
    ].filter(Boolean)
  );

  const snippetRendererKeys = pickBlockRendererSnippetKeys(snippetFiles, snippetAnalyses);
  const warnings = [];
  let recommendedFlow = "manual-review";
  let shouldUse = "draft-theme-artifact";
  let likelyNeedsMultiFileEdit = false;
  let reason =
    "Kon geen veilige, theme-aware editstrategie bepalen. Lees eerst de primaire template en section handmatig.";
  let nextWriteKeys = [];
  let nextReadKeys = readKeys;
  let newFileSuggestions = [];
  const searchQueries = [];

  if (intent === "existing_edit") {
    recommendedFlow = "patch-existing";
    shouldUse = "patch-theme-file";
    reason = "Bestaande single-file edits blijven het veiligst via een gerichte patch-flow.";
    nextWriteKeys = sectionFile?.key ? [sectionFile.key] : readKeys.slice(0, 1);
  } else if (intent === "new_section") {
    recommendedFlow = "create-section";
    shouldUse = "draft-theme-artifact";
    likelyNeedsMultiFileEdit = false;
    reason =
      "Nieuwe sections horen eerst als los sections/<handle>.liquid bestand gemaakt te worden; template placement is een aparte stap. Spiegel vooraf ook de spacing- en setting-conventies van een vergelijkbare bestaande section in het doeltheme.";
    nextWriteKeys = [];
    newFileSuggestions = ["sections/<new-section>.liquid"];
    if (templateFile?.key) {
      warnings.push(
        "Plaats de nieuwe section pas in het template nadat de user dat expliciet vraagt."
      );
    }
    warnings.push(
      "Lees vóór het schrijven bij voorkeur één vergelijkbare bestaande section in hetzelfde theme om padding/color-conventies te spiegelen, bijvoorbeeld aparte ids zoals padding_top/padding_bottom versus een gecombineerde spacing-setting."
    );
    nextReadKeys = uniqueStrings([sectionFile?.key]);
    searchQueries.push("padding_top");
    searchQueries.push("padding_bottom");
    searchQueries.push("section_padding");
    searchQueries.push("color_scheme");
  } else if (intent === "template_placement") {
    recommendedFlow = "template-placement";
    shouldUse = "draft-theme-artifact";
    likelyNeedsMultiFileEdit = true;
    reason =
      "Template placement hoort in een aparte edit op het bestaande templates/*.json of *.liquid bestand.";
    nextWriteKeys = templateFile?.key ? [templateFile.key] : [];
    nextReadKeys = templateFile?.key ? [templateFile.key] : [];
  } else if (sectionAnalysis?.supportsThemeBlocks) {
    recommendedFlow = "multi-file-edit";
    shouldUse = "draft-theme-artifact";
    likelyNeedsMultiFileEdit = true;
    reason =
      "De primaire section ondersteunt theme blocks via @theme/content_for('blocks'); een losse section-block patch is hier niet de juiste route.";
    nextWriteKeys = sectionFile?.key ? [sectionFile.key] : [];
    newFileSuggestions = ["blocks/<new-theme-block>.liquid"];
    if (templateFile?.key) {
      warnings.push(
        "Maak geen blocks/*.liquid bestand aan tenzij de section deze theme blocks ook echt accepteert."
      );
    }
    nextReadKeys = uniqueStrings([sectionFile?.key]);
  } else if (
    sectionAnalysis &&
    (sectionAnalysis.schemaBlockTypes.length > 0 ||
      sectionAnalysis.hasSectionBlocksLoop ||
      snippetRendererKeys.length > 0)
  ) {
    recommendedFlow = "multi-file-edit";
    shouldUse = "draft-theme-artifact";
    likelyNeedsMultiFileEdit = true;
    reason =
      snippetRendererKeys.length > 0
        ? "De native block-rendering loopt via een bestaande snippet; een one-file section patch is waarschijnlijk onvolledig."
        : "De primaire section gebruikt bestaande schema.blocks; patch de section schema en block-rendering samen.";
    nextWriteKeys = uniqueStrings(
      [sectionFile?.key, ...snippetRendererKeys].filter(Boolean)
    );
    nextReadKeys = uniqueStrings(
      [sectionFile?.key, ...snippetRendererKeys].filter(Boolean)
    );
  } else if (templateFile?.key) {
    recommendedFlow = "create-section";
    shouldUse = "draft-theme-artifact";
    likelyNeedsMultiFileEdit = true;
    reason =
      "Er is geen consistente native block-architectuur gedetecteerd; een losse section plus expliciete template placement is veiliger.";
    nextWriteKeys = [templateFile.key];
    newFileSuggestions = ["sections/<new-section>.liquid"];
    nextReadKeys = [templateFile.key];
  }

  if (
    intent === "native_block" &&
    sectionAnalysis &&
    !sectionAnalysis.supportsThemeBlocks &&
    !sectionAnalysis.hasBlockShopifyAttributes &&
    (sectionAnalysis.hasSectionBlocksLoop || snippetRendererKeys.length > 0)
  ) {
    warnings.push(
      "De block-rendering mist waarschijnlijk block.shopify_attributes. Dat kan drag-and-drop in de Theme Editor breken."
    );
  }

  if (
    intent === "native_block" &&
    sectionAnalysis?.hasBlockSwitch &&
    sectionAnalysis?.schemaBlockTypes.length > 0
  ) {
    warnings.push(
      "Kies voor section schema patches een unieke anchor uit het {% schema %} block. Losse block type strings komen vaak ook terug in Liquid case-switches."
    );
  }

  if (intent === "native_block" && templateFile?.key && nextReadKeys.every((key) => key !== templateFile.key)) {
    warnings.push(
      "De planner heeft het template al geanalyseerd. Lees templates/*.json alleen opnieuw als placement van het block expliciet gevraagd is."
    );
  }

  if (intent === "native_block" && snippetRendererKeys.length === 0 && query) {
    searchQueries.push(query);
  }

  if (intent === "native_block" && nextWriteKeys.length <= 1 && sectionFile?.key) {
    searchQueries.push("buy_buttons");
    searchQueries.push("block.type");
  }

  return {
    recommendedFlow,
    shouldUse,
    likelyNeedsMultiFileEdit,
    reason,
    nextReadKeys,
    nextWriteKeys,
    newFileSuggestions,
    searchQueries: uniqueStrings(searchQueries),
    warnings,
  };
};

export const searchThemeFilesWithSnippets = async (
  shopifyClient,
  apiVersion,
  {
    query,
    mode = "literal",
    filePatterns = [],
    keys = [],
    themeId,
    themeRole = "main",
    resultLimit = 8,
    snippetLength = 120,
  } = {}
) => {
  const patternList = uniqueStrings(filePatterns);
  const keyList = uniqueStrings(keys);
  if (patternList.length === 0 && keyList.length === 0) {
    throw new Error("filePatterns of keys moet minimaal 1 item bevatten.");
  }
  const searchResult = await searchThemeFiles(shopifyClient, apiVersion, {
    themeId,
    themeRole,
    patterns: patternList,
    keys: keyList,
    includeContent: true,
    resultLimit: Math.min(
      DEFAULT_THEME_SEARCH_LIMIT,
      Math.max(resultLimit * 3, resultLimit)
    ),
  });

  const hits = [];
  for (const file of searchResult.files) {
    if (hits.length >= resultLimit) {
      break;
    }
    if (typeof file?.value !== "string") {
      continue;
    }
    const snippets = buildTextSnippets(file.value, query, {
      mode,
      snippetLength,
      maxSnippets: 2,
    });
    if (snippets.length === 0) {
      continue;
    }
    hits.push({
      key: file.key,
      contentType: file.contentType || null,
      size: file.size ?? null,
      snippets,
    });
  }

  return {
    theme: {
      id: searchResult.theme.id,
      name: searchResult.theme.name,
      role: searchResult.theme.role,
    },
    query,
    mode,
    filePatterns: patternList,
    keys: keyList,
    hits,
    truncated: Boolean(searchResult.truncated || hits.length >= resultLimit),
  };
};

export const planThemeEdit = async (
  shopifyClient,
  apiVersion,
  {
    themeId,
    themeRole,
    intent = "existing_edit",
    template,
    query,
    targetFile,
    sectionTypeHint,
    snippetLimit = DEFAULT_SNIPPET_LIMIT,
  } = {}
) => {
  const templateSurface = normalizeTemplateSurface(template, intent);

  if (targetFile && intent === "existing_edit") {
    const readback = await getThemeFiles(shopifyClient, apiVersion, {
      themeId,
      themeRole,
      keys: [targetFile],
      includeContent: false,
    });

    const existingFile = readback.files[0];
    return {
      theme: {
        id: readback.theme.id,
        name: readback.theme.name,
        role: readback.theme.role,
      },
      intent,
      template: {
        requested: templateSurface,
        resolved: templateSurface,
        primary: null,
        alternates: [],
      },
      recommendedFlow: "patch-existing",
      shouldUse: "patch-theme-file",
      likelyNeedsMultiFileEdit: false,
      reason:
        existingFile?.found
          ? "Exact targetbestand bestaat al; een gerichte patch-flow is hier het meest tokenzuinig."
          : "Exact targetbestand is nog niet gevonden; verifieer eerst of de key klopt voordat je schrijft.",
      candidateFiles: [summarizeCandidateFile(existingFile || { key: targetFile }, "target")],
      nextReadKeys: [targetFile],
      nextWriteKeys: existingFile?.found ? [targetFile] : [],
      newFileSuggestions: [],
      searchQueries: [],
      warnings: existingFile?.found
        ? []
        : [`Bestand '${targetFile}' bestaat niet op het doeltheme.`],
      architecture: {
        templateFormat: null,
        primarySectionId: null,
        primarySectionType: null,
        primarySectionFile: null,
        usesSectionBlocks: false,
        usesThemeBlocks: false,
        renderedSnippets: [],
        snippetRendererKeys: [],
        hasBlockShopifyAttributes: null,
        supportsAppBlocks: null,
        blockTypes: [],
      },
    };
  }

  const exactTemplateResult = await getThemeFiles(shopifyClient, apiVersion, {
    themeId,
    themeRole,
    keys: getExactTemplateKeys(templateSurface),
    includeContent: true,
  });

  const exactTemplateFiles = exactTemplateResult.files || [];
  let templateFile = choosePrimaryTemplateFile(exactTemplateFiles, templateSurface);
  let alternateTemplateFiles = exactTemplateFiles
    .filter((file) => file.found && file.key !== templateFile?.key)
    .map(summarizeTemplateFile);

  if (!templateFile) {
    const fallbackSearch = await searchThemeFiles(shopifyClient, apiVersion, {
      themeId,
      themeRole,
      patterns: getAlternateTemplatePatterns(templateSurface),
      includeContent: true,
      resultLimit: 6,
    });
    templateFile = choosePrimaryTemplateFile(fallbackSearch.files || [], templateSurface);
    alternateTemplateFiles = (fallbackSearch.files || [])
      .filter((file) => file.key !== templateFile?.key)
      .map(summarizeTemplateFile);
  }

  if (!templateFile) {
    return {
      theme: {
        id: exactTemplateResult.theme.id,
        name: exactTemplateResult.theme.name,
        role: exactTemplateResult.theme.role,
      },
      intent,
      template: {
        requested: templateSurface,
        resolved: templateSurface,
        primary: null,
        alternates: alternateTemplateFiles,
      },
      recommendedFlow: "manual-review",
      shouldUse: "draft-theme-artifact",
      likelyNeedsMultiFileEdit: false,
      reason: `Geen herkenbaar ${templateSurface} template gevonden op het doeltheme.`,
      candidateFiles: [],
      nextReadKeys: [],
      nextWriteKeys: [],
      newFileSuggestions: [],
      searchQueries: getAlternateTemplatePatterns(templateSurface),
      warnings: [
        "Zonder herkenbaar template kan de planner geen veilige file-scope bepalen.",
      ],
      architecture: {
        templateFormat: null,
        primarySectionId: null,
        primarySectionType: null,
        primarySectionFile: null,
        usesSectionBlocks: false,
        usesThemeBlocks: false,
        renderedSnippets: [],
        snippetRendererKeys: [],
        hasBlockShopifyAttributes: null,
        supportsAppBlocks: null,
        blockTypes: [],
      },
    };
  }

  const templateAnalysis = analyzeTemplateFile(templateFile, {
    templateSurface,
    sectionTypeHint,
  });

  let sectionFile = null;
  if (templateAnalysis.primarySection?.fileKey) {
    const sectionReadback = await getThemeFiles(shopifyClient, apiVersion, {
      themeId,
      themeRole,
      keys: [templateAnalysis.primarySection.fileKey],
      includeContent: true,
    });
    sectionFile = sectionReadback.files.find((file) => file.key === templateAnalysis.primarySection.fileKey) || null;
  }

  const sectionAnalysis = sectionFile?.found
    ? analyzeLiquidFile(sectionFile.value)
    : null;

  const snippetNames = prioritizeSnippetNames(sectionAnalysis?.renderSnippets || [], {
    templateSurface,
    query,
  }).slice(0, Math.max(1, Math.min(Number(snippetLimit || DEFAULT_SNIPPET_LIMIT), 5)));

  const snippetKeys = snippetNames.map((name) => `snippets/${name}.liquid`);
  let snippetFiles = [];
  if (snippetKeys.length > 0) {
    const snippetReadback = await getThemeFiles(shopifyClient, apiVersion, {
      themeId,
      themeRole,
      keys: snippetKeys,
      includeContent: true,
    });
    snippetFiles = (snippetReadback.files || []).filter((file) => file.found);
  }

  const snippetAnalyses = snippetFiles.map((file) => ({
    key: file.key,
    analysis: analyzeLiquidFile(file.value),
  }));

  const plan = buildPlanFromAnalysis({
    intent,
    templateSurface,
    templateFile,
    sectionFile,
    templateAnalysis,
    sectionAnalysis,
    snippetFiles,
    snippetAnalyses,
    query,
  });

  return {
    theme: {
      id: exactTemplateResult.theme.id,
      name: exactTemplateResult.theme.name,
      role: exactTemplateResult.theme.role,
    },
    intent,
    template: {
      requested: templateSurface,
      resolved: templateSurface,
      primary: summarizeTemplateFile(templateFile),
      alternates: alternateTemplateFiles,
    },
    recommendedFlow: plan.recommendedFlow,
    shouldUse: plan.shouldUse,
    likelyNeedsMultiFileEdit: plan.likelyNeedsMultiFileEdit,
    reason: plan.reason,
    candidateFiles: uniqueStrings([
      templateFile?.key,
      sectionFile?.key,
      ...snippetFiles.map((file) => file.key),
    ]).map((key) => {
      if (key === templateFile?.key) {
        return summarizeCandidateFile({ key, found: true }, "template");
      }
      if (key === sectionFile?.key) {
        return summarizeCandidateFile(sectionFile, "primary");
      }
      const snippetFile = snippetFiles.find((file) => file.key === key);
      return summarizeCandidateFile(snippetFile || { key, found: false }, "secondary");
    }),
    nextReadKeys: plan.nextReadKeys,
    nextWriteKeys: plan.nextWriteKeys,
    newFileSuggestions: plan.newFileSuggestions,
    searchQueries: plan.searchQueries,
    warnings: plan.warnings,
    architecture: {
      templateFormat: templateAnalysis.format,
      primarySectionId: templateAnalysis.primarySection?.id || null,
      primarySectionType: templateAnalysis.primarySection?.type || null,
      primarySectionFile: templateAnalysis.primarySection?.fileKey || null,
      usesSectionBlocks: Boolean(
        sectionAnalysis &&
          (sectionAnalysis.schemaBlockTypes.length > 0 ||
            sectionAnalysis.hasSectionBlocksLoop ||
            snippetAnalyses.some(
              (entry) =>
                entry.analysis.hasSectionBlocksLoop ||
                entry.analysis.hasBlockSwitch
            ))
      ),
      usesThemeBlocks: Boolean(sectionAnalysis?.supportsThemeBlocks),
      renderedSnippets: sectionAnalysis?.renderSnippets || [],
      snippetRendererKeys: pickBlockRendererSnippetKeys(snippetFiles, snippetAnalyses),
      hasBlockShopifyAttributes:
        sectionAnalysis &&
        (sectionAnalysis.hasSectionBlocksLoop ||
          snippetAnalyses.some((entry) => entry.analysis.hasSectionBlocksLoop))
          ? Boolean(
              sectionAnalysis.hasBlockShopifyAttributes ||
                snippetAnalyses.some(
                  (entry) => entry.analysis.hasBlockShopifyAttributes
                )
            )
          : null,
      supportsAppBlocks:
        sectionAnalysis?.supportsAppBlocks === true ? true : false,
      blockTypes: uniqueStrings(
        [
          ...(sectionAnalysis?.schemaBlockTypes || []),
          ...(sectionAnalysis?.caseBlockTypes || []),
          ...(sectionAnalysis?.staticThemeBlockTypes || []),
          ...snippetAnalyses.flatMap((entry) => [
            ...entry.analysis.caseBlockTypes,
            ...entry.analysis.staticThemeBlockTypes,
          ]),
        ].filter(Boolean)
      ),
    },
  };
};
