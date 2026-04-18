const SUMMARY_KEYS = [
  "_tool_input_summary",
  "tool_input_summary",
  "summary",
  "prompt",
  "request",
];

const THEME_FILE_PATH_PATTERN =
  /\b(?:sections|snippets|blocks|assets|config|templates|locales)\/[A-Za-z0-9._/-]+\b/g;

const normalizeText = (value) =>
  String(value || "")
    .trim()
    .replace(/\s+/g, " ");

export function extractThemeToolSummary(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return "";
  }

  for (const key of SUMMARY_KEYS) {
    if (typeof input[key] === "string" && input[key].trim()) {
      return normalizeText(input[key]);
    }
  }

  return "";
}

export function inferThemeTargetFromSummary(input, summary) {
  const next = { ...input };
  const text = normalizeText(summary).toLowerCase();
  const referencesMainTheme =
    /\b(?:live|main)(?:\s*\/\s*main)?\s+theme\b/.test(text) ||
    /\btheme\s+(?:is|=|:)?\s*(?:live|main)\b/.test(text) ||
    /\btheme(?:\s+role)?\s*(?:is|=|:)?\s*main\b/.test(text);
  const referencesDevelopmentTheme =
    /\bdevelopment\s+theme\b/.test(text) ||
    /\btheme(?:\s+role)?\s*(?:is|=|:)?\s*development\b/.test(text);
  const referencesUnpublishedTheme =
    /\b(?:preview|unpublished)\s+theme\b/.test(text) ||
    /\btheme(?:\s+role)?\s*(?:is|=|:)?\s*unpublished\b/.test(text);
  const referencesDemoTheme =
    /\bdemo\s+theme\b/.test(text) ||
    /\btheme(?:\s+role)?\s*(?:is|=|:)?\s*demo\b/.test(text);

  if (!next.themeId) {
    const themeIdMatch = summary.match(/\btheme(?:\s*id)?\s*[:#]?\s*(\d{6,})\b/i);
    if (themeIdMatch) {
      next.themeId = Number(themeIdMatch[1]);
    }
  }

  if (!next.themeRole) {
    if (referencesMainTheme) {
      next.themeRole = "main";
    } else if (referencesDevelopmentTheme || /\bdev(?:elopment)? theme\b/.test(text)) {
      next.themeRole = "development";
    } else if (referencesUnpublishedTheme) {
      next.themeRole = "unpublished";
    } else if (referencesDemoTheme) {
      next.themeRole = "demo";
    }
  }

  return next;
}

export function extractThemeFilePaths(summary) {
  return Array.from(
    new Set(Array.from(String(summary || "").matchAll(THEME_FILE_PATH_PATTERN), (match) => match[0]))
  );
}

export function inferSingleThemeFile(summary) {
  const paths = extractThemeFilePaths(summary);
  return paths.length === 1 ? paths[0] : null;
}

export function inferTemplateFromSummary(summary) {
  const text = normalizeText(summary).toLowerCase();

  if (/\bproduct(?: page|pagina)?\b|templates\/product\./.test(text)) {
    return "product";
  }
  if (/\bhomepage\b|\bhome page\b|\bhomepagina\b|templates\/index\./.test(text)) {
    return "homepage";
  }
  if (/\bcollection\b|templates\/collection\./.test(text)) {
    return "collection";
  }
  if (/\barticle\b|templates\/article\./.test(text)) {
    return "article";
  }
  if (/\bblog\b|templates\/blog\./.test(text)) {
    return "blog";
  }
  if (/\bcart\b|templates\/cart\./.test(text)) {
    return "cart";
  }
  if (/\bsearch\b|templates\/search\./.test(text)) {
    return "search";
  }
  if (/\bpage\b|templates\/page\./.test(text)) {
    return "page";
  }

  return null;
}

export function inferIntentFromSummary(summary, input = {}) {
  const text = normalizeText(summary).toLowerCase();

  if (input.targetFile || input.key) {
    return "existing_edit";
  }

  if (
    /\b(template placement|plaats.*template|plaats.*producttemplate|plaats.*homepage)\b/.test(text) ||
    /templates\/(?:index|product|collection|page|article|blog|cart|search)\./.test(text)
  ) {
    return "template_placement";
  }

  if (
    /\b(?:new|nieuwe|create|maak|build|bouw|add|voeg toe)\b[\w\s-]{0,24}\bsection\b/.test(text) ||
    /\bsection\b[\w\s-]{0,12}\b(?:aanmaken|maken|creëren|build|bouwen|toevoegen)\b/.test(text)
  ) {
    return "new_section";
  }

  if (
    /\b(?:native|theme|product)\s+block\b/.test(text) ||
    /\bblock\b[\w\s-]{0,24}\b(?:toevoegen|aanmaken|maken|creëren|build|bouwen)\b/.test(text) ||
    /\b(?:add|create|make|build)\b[\w\s-]{0,24}\bblock\b/.test(text)
  ) {
    return "native_block";
  }

  return "existing_edit";
}

export function inferSectionTypeHint(summary) {
  const pathMatch = String(summary || "").match(/\b(main-product|product-info|featured-product|main_collection_product_grid)\b/i);
  return pathMatch ? pathMatch[1] : null;
}

export function inferSearchScope(summary) {
  const paths = extractThemeFilePaths(summary);
  if (paths.length > 0) {
    const buckets = Array.from(
      new Set(
        paths
          .map((entry) => entry.split("/")[0])
          .filter((bucket) =>
            ["templates", "sections", "snippets", "assets", "config", "locales"].includes(bucket)
          )
      )
    );
    if (buckets.length > 0) {
      return buckets;
    }
  }

  const text = normalizeText(summary).toLowerCase();
  if (/\bproduct(?: page|pagina)?\b|\bnative block\b|\bblock\b/.test(text)) {
    return ["sections", "snippets"];
  }
  if (/\btemplate\b|\bhomepage\b|\bhomepagina\b/.test(text)) {
    return ["templates", "sections"];
  }
  if (/\bconfig\b|\bsettings_data\b|\bsettings_schema\b/.test(text)) {
    return ["config"];
  }

  return ["sections"];
}

export function normalizeSummaryScope(scope) {
  if (Array.isArray(scope)) {
    return scope;
  }
  if (typeof scope === "string" && scope.trim()) {
    return [scope.trim()];
  }
  return scope;
}

export function normalizeSummaryFilePatterns(filePatterns) {
  if (Array.isArray(filePatterns)) {
    return filePatterns;
  }
  if (typeof filePatterns === "string" && filePatterns.trim()) {
    return [filePatterns.trim()];
  }
  return filePatterns;
}
