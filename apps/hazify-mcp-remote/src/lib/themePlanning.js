import { getThemeFiles, resolveTheme, searchThemeFiles } from "./themeFiles.js";

const DEFAULT_THEME_SEARCH_LIMIT = 50;

const uniqueStrings = (values) => Array.from(new Set(values.filter(Boolean)));

const normalizeText = (value) =>
  String(value || "")
    .trim()
    .toLowerCase();

const safeParseJson = (value) => {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

const extractLiquidSectionTypes = (value) => {
  const matches = [];
  const pattern = /{%\s*section\s+['"]([^'"]+)['"]\s*%}/g;
  let match = pattern.exec(String(value || ""));
  while (match) {
    if (match[1]) {
      matches.push(match[1]);
    }
    match = pattern.exec(String(value || ""));
  }
  return matches;
};

const extractSectionSchema = (value) => {
  const match = String(value || "").match(/{%\s*schema\s*%}([\s\S]*?){%\s*endschema\s*%}/i);
  return safeParseJson(match?.[1] || "");
};

const toSectionFileKey = (type) => {
  const normalized = String(type || "").trim().replace(/^sections\//, "").replace(/\.liquid$/, "");
  return normalized ? `sections/${normalized}.liquid` : null;
};

const extractSectionDisplayMetadata = (asset) => {
  const schema = extractSectionSchema(asset?.value || "");
  const schemaName = typeof schema?.name === "string" && schema.name.trim() ? schema.name.trim() : null;
  const presetNames = Array.isArray(schema?.presets)
    ? schema.presets
        .map((preset) => (typeof preset?.name === "string" ? preset.name.trim() : ""))
        .filter(Boolean)
    : [];
  return {
    schemaName,
    displayTitle: schemaName || presetNames[0] || null,
    presetNames,
  };
};

const readUniqueThemeFiles = async (shopifyClient, apiVersion, options) => {
  const keys = uniqueStrings(options.keys || []);
  if (keys.length === 0) {
    return { theme: await resolveTheme(shopifyClient, apiVersion, options), files: [] };
  }
  return getThemeFiles(shopifyClient, apiVersion, {
    ...options,
    keys,
    includeContent: true,
  });
};

const buildSourceFileRow = (asset, kind, used = true) => ({
  key: asset?.key || null,
  kind,
  found: Boolean(asset?.found),
  used,
});

const buildSectionRecord = ({
  instanceId,
  type,
  sectionFile,
  originFile,
  position,
  metadata,
  confidence,
}) => ({
  instanceId,
  type,
  displayTitle: metadata?.displayTitle || null,
  schemaName: metadata?.schemaName || null,
  presetNames: Array.isArray(metadata?.presetNames) ? metadata.presetNames : [],
  sectionFile,
  originFile,
  position,
  confidence,
});

const parseJsonTemplateSections = (asset, notes = []) => {
  const parsed = safeParseJson(asset?.value || "");
  if (!parsed || typeof parsed !== "object") {
    notes.push(`Kon ${asset?.key || "onbekend template"} niet als JSON-template parsen.`);
    return [];
  }
  const sections = parsed.sections && typeof parsed.sections === "object" ? parsed.sections : {};
  const order = Array.isArray(parsed.order) ? parsed.order : Object.keys(sections);
  return order
    .map((instanceId, index) => {
      const section = sections?.[instanceId];
      const type = typeof section?.type === "string" ? section.type.trim() : "";
      if (!type) {
        return null;
      }
      return {
        instanceId,
        type,
        originFile: asset.key,
        position: index + 1,
        confidence: 0.98,
      };
    })
    .filter(Boolean);
};

const parseLiquidHomepageSections = (asset) =>
  extractLiquidSectionTypes(asset?.value || "").map((type, index) => ({
    instanceId: `liquid-${index + 1}`,
    type,
    originFile: asset.key,
    position: index + 1,
    confidence: 0.74,
  }));

const extractSectionGroupSections = (asset, notes = []) => {
  const parsed = safeParseJson(asset?.value || "");
  if (!parsed || typeof parsed !== "object") {
    return [];
  }
  const sections = parsed.sections && typeof parsed.sections === "object" ? parsed.sections : {};
  const order = Array.isArray(parsed.order) ? parsed.order : Object.keys(sections);
  return order
    .map((instanceId, index) => {
      const section = sections?.[instanceId];
      const type = typeof section?.type === "string" ? section.type.trim() : "";
      if (!type) {
        notes.push(`Section group ${asset.key} bevat een entry zonder type voor instance '${instanceId}'.`);
        return null;
      }
      return {
        instanceId,
        type,
        originFile: asset.key,
        position: index + 1,
        confidence: 0.92,
      };
    })
    .filter(Boolean);
};

const attachSectionMetadata = (sections, assetsByKey) =>
  sections.map((section) => {
    const sectionFile = toSectionFileKey(section.type);
    const metadata = sectionFile ? extractSectionDisplayMetadata(assetsByKey.get(sectionFile)) : {};
    return buildSectionRecord({
      ...section,
      sectionFile,
      metadata,
      confidence: metadata?.schemaName ? Math.min(1, Number(section.confidence || 0.8) + 0.05) : section.confidence,
    });
  });

const scoreSectionMatch = (query, section) => {
  const normalizedQuery = normalizeText(query);
  if (!normalizedQuery) {
    return { score: 0, exact: false, matchedOn: [] };
  }
  const candidates = uniqueStrings([
    section.instanceId,
    section.type,
    section.displayTitle,
    section.schemaName,
    ...(Array.isArray(section.presetNames) ? section.presetNames : []),
  ]);
  const matchedOn = [];
  let score = 0;
  let exact = false;
  for (const candidate of candidates) {
    const normalizedCandidate = normalizeText(candidate);
    if (!normalizedCandidate) {
      continue;
    }
    if (normalizedCandidate === normalizedQuery) {
      matchedOn.push(candidate);
      exact = true;
      score = Math.max(score, 1);
      continue;
    }
    if (normalizedCandidate.includes(normalizedQuery) || normalizedQuery.includes(normalizedCandidate)) {
      matchedOn.push(candidate);
      score = Math.max(score, 0.84);
      continue;
    }
    const queryTokens = normalizedQuery.split(/[^a-z0-9]+/).filter(Boolean);
    const candidateTokens = normalizedCandidate.split(/[^a-z0-9]+/).filter(Boolean);
    const overlap = queryTokens.filter((token) => candidateTokens.includes(token)).length;
    if (overlap > 0) {
      matchedOn.push(candidate);
      score = Math.max(score, Math.min(0.78, 0.52 + overlap * 0.12));
    }
  }
  return {
    score,
    exact,
    matchedOn: uniqueStrings(matchedOn),
  };
};

const buildLookupHints = ({ exactMatches, fuzzyMatches }) => {
  const bestExactConfidence = exactMatches[0]?.confidence || 0;
  const bestFuzzyConfidence = fuzzyMatches[0]?.confidence || 0;
  const bestConfidence = Math.max(bestExactConfidence, bestFuzzyConfidence);
  const recommendedFlow = exactMatches.length > 0 || bestFuzzyConfidence >= 0.85 ? "edit_existing" : "create_new";
  const creationSuggested = exactMatches.length === 0 && bestFuzzyConfidence < 0.85;
  return {
    bestConfidence,
    recommendedFlow,
    creationSuggested,
  };
};

const buildTextSnippets = (content, query, { mode = "literal", snippetLength = 120, maxSnippets = 2 } = {}) => {
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

export const resolveHomepageSections = async (
  shopifyClient,
  apiVersion,
  { themeId, themeRole = "main", page = "homepage" } = {}
) => {
  if (page !== "homepage") {
    throw new Error("Alleen page='homepage' wordt momenteel ondersteund.");
  }

  const notes = [];
  const templateResult = await getThemeFiles(shopifyClient, apiVersion, {
    themeId,
    themeRole,
    keys: ["templates/index.json", "templates/index.liquid"],
    includeContent: true,
  });
  const templateFilesByKey = new Map(templateResult.files.map((asset) => [asset.key, asset]));
  const homepageJson = templateFilesByKey.get("templates/index.json");
  const homepageLiquid = templateFilesByKey.get("templates/index.liquid");

  let rawSections = [];
  let sourceFiles = [
    buildSourceFileRow(homepageJson, "homepage-template", Boolean(homepageJson?.found)),
    buildSourceFileRow(homepageLiquid, "homepage-template-fallback", Boolean(homepageLiquid?.found) && !homepageJson?.found),
  ];

  if (homepageJson?.found && typeof homepageJson.value === "string") {
    rawSections = parseJsonTemplateSections(homepageJson, notes);
  } else if (homepageLiquid?.found && typeof homepageLiquid.value === "string") {
    notes.push("Homepage JSON-template ontbreekt; resolver gebruikt fallback via templates/index.liquid.");
    rawSections = parseLiquidHomepageSections(homepageLiquid);
  } else {
    notes.push("Geen homepage template gevonden onder templates/index.json of templates/index.liquid.");
  }

  const sectionGroupResult = await getThemeFiles(shopifyClient, apiVersion, {
    themeId,
    themeRole,
    keys: ["sections/header-group.json", "sections/footer-group.json"],
    includeContent: true,
  });
  const headerGroup = sectionGroupResult.files.find((asset) => asset.key === "sections/header-group.json");
  const footerGroup = sectionGroupResult.files.find((asset) => asset.key === "sections/footer-group.json");
  sourceFiles = sourceFiles.concat([
    buildSourceFileRow(headerGroup, "section-group", Boolean(headerGroup?.found)),
    buildSourceFileRow(footerGroup, "section-group", Boolean(footerGroup?.found)),
  ]);

  const groupedSections = [];
  if (headerGroup?.found) {
    groupedSections.push(...extractSectionGroupSections(headerGroup, notes));
  }
  if (footerGroup?.found) {
    groupedSections.push(...extractSectionGroupSections(footerGroup, notes));
  }
  const orderedSections = [...groupedSections, ...rawSections].map((section, index) => ({
    ...section,
    position: index + 1,
  }));

  const sectionFileKeys = uniqueStrings(orderedSections.map((section) => toSectionFileKey(section.type)));
  const sectionFileResult = await readUniqueThemeFiles(shopifyClient, apiVersion, {
    themeId,
    themeRole,
    keys: sectionFileKeys,
  });
  const sectionAssetsByKey = new Map(sectionFileResult.files.map((asset) => [asset.key, asset]));
  sourceFiles = sourceFiles.concat(sectionFileResult.files.map((asset) => buildSourceFileRow(asset, "section-file")));

  return {
    theme: {
      id: templateResult.theme.id,
      name: templateResult.theme.name,
      role: templateResult.theme.role,
    },
    page: "homepage",
    sourceFiles: sourceFiles.filter((row) => row.key),
    sections: attachSectionMetadata(orderedSections, sectionAssetsByKey),
    notes,
  };
};

const buildThemeWideSectionCatalog = async (shopifyClient, apiVersion, { themeId, themeRole = "main" }) => {
  const result = await searchThemeFiles(shopifyClient, apiVersion, {
    themeId,
    themeRole,
    patterns: ["sections/*.liquid"],
    includeContent: true,
    resultLimit: DEFAULT_THEME_SEARCH_LIMIT,
  });
  return result.files.map((asset, index) => {
    const metadata = extractSectionDisplayMetadata(asset);
    const filename = String(asset.key || "").replace(/^sections\//, "").replace(/\.liquid$/, "");
    return buildSectionRecord({
      instanceId: `file-${index + 1}`,
      type: filename,
      sectionFile: asset.key,
      originFile: asset.key,
      position: index + 1,
      metadata,
      confidence: metadata?.schemaName ? 0.81 : 0.64,
    });
  });
};

export const findThemeSectionByName = async (
  shopifyClient,
  apiVersion,
  { query, themeId, themeRole = "main", page = null } = {}
) => {
  const relevantFiles = new Set();
  const candidates = [];
  if (!page || page === "homepage") {
    const homepage = await resolveHomepageSections(shopifyClient, apiVersion, { themeId, themeRole, page: "homepage" });
    homepage.sourceFiles.forEach((sourceFile) => relevantFiles.add(sourceFile.key));
    candidates.push(...homepage.sections);
  }
  if (!page) {
    const themeWideCatalog = await buildThemeWideSectionCatalog(shopifyClient, apiVersion, { themeId, themeRole });
    themeWideCatalog.forEach((section) => relevantFiles.add(section.sectionFile));
    candidates.push(...themeWideCatalog);
  }

  const matches = candidates
    .map((section) => {
      const result = scoreSectionMatch(query, section);
      const matchConfidence = Number(result.score.toFixed(2));
      return {
        ...section,
        sourceConfidence: section.confidence || 0,
        confidence: matchConfidence,
        matchedOn: result.matchedOn,
        exact: result.exact,
      };
    })
    .filter((section) => section.confidence >= 0.55)
    .sort((left, right) => right.confidence - left.confidence);

  const exactMatches = matches.filter((entry) => entry.exact);
  const fuzzyMatches = matches.filter((entry) => !entry.exact).slice(0, 8);
  const lookupHints = buildLookupHints({ exactMatches, fuzzyMatches });
  const nextSteps =
    lookupHints.recommendedFlow === "edit_existing"
      ? uniqueStrings(
          (exactMatches.length > 0 ? exactMatches : fuzzyMatches.slice(0, 2)).flatMap((match) => [
            `Gebruik get-theme-file voor ${match.sectionFile || match.originFile}`,
          ])
        )
      : [
          "Gebruik create-theme-section voor een nieuwe OS 2.0 section zodra targetFile bekend is.",
          "Gebruik search-theme-files alleen als je nog een compacte stijlreferentie nodig hebt uit sections/snippets/assets.",
        ];

  return {
    query,
    page: page || "theme-wide",
    exactMatches,
    fuzzyMatches,
    confidence: lookupHints.bestConfidence,
    lookupOnly: true,
    recommendedFlow: lookupHints.recommendedFlow,
    creationSuggested: lookupHints.creationSuggested,
    relevantFiles: uniqueStrings([
      ...Array.from(relevantFiles),
      ...exactMatches.flatMap((match) => [match.originFile, match.sectionFile]),
      ...fuzzyMatches.flatMap((match) => [match.originFile, match.sectionFile]),
    ]),
    nextSteps,
  };
};

export const searchThemeFilesWithSnippets = async (
  shopifyClient,
  apiVersion,
  {
    query,
    mode = "literal",
    filePatterns = [],
    themeId,
    themeRole = "main",
    resultLimit = 8,
    snippetLength = 120,
  } = {}
) => {
  const patternList = uniqueStrings(filePatterns);
  if (patternList.length === 0) {
    throw new Error("filePatterns moet minimaal 1 pattern bevatten.");
  }
  const searchResult = await searchThemeFiles(shopifyClient, apiVersion, {
    themeId,
    themeRole,
    patterns: patternList,
    includeContent: true,
    resultLimit: Math.min(DEFAULT_THEME_SEARCH_LIMIT, Math.max(resultLimit * 3, resultLimit)),
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
    hits,
    truncated: Boolean(searchResult.truncated || hits.length >= resultLimit),
  };
};
