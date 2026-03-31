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
