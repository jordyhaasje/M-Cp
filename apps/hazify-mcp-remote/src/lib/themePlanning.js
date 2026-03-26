import { searchThemeFiles } from "./themeFiles.js";

const DEFAULT_THEME_SEARCH_LIMIT = 10;

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
  } catch (err) {
    console.warn("safeParseJson kon een String niet als JSON parsen. Syntaxfout of ongeldige JSON.", err.message);
    return null;
  }
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
