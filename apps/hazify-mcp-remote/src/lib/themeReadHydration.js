import {
  getRecentThemeRead,
  getThemeEditMemory,
  rememberThemeRead,
  themeTargetsCompatible,
} from "./themeEditMemory.js";
import { getThemeFiles, searchThemeFiles } from "./themeFiles.js";

const uniqueStrings = (values) =>
  Array.from(new Set((values || []).filter(Boolean)));

const FALLBACK_REPRESENTATIVE_KEYS = ["sections/animated-header.liquid"];

const isRelevantRepresentativeReadKey = (key) =>
  /^(sections|snippets)\/[A-Za-z0-9._-]+\.liquid$/.test(String(key || "")) ||
  String(key || "") === "layout/theme.liquid";

const isDefaultRepresentativeFallbackKey = (key) =>
  /^sections\/[A-Za-z0-9._-]+\.liquid$/.test(String(key || ""));

const scoreRepresentativeRead = ({ key, content = "" } = {}) => {
  const normalizedKey = String(key || "");
  const source = String(content || "");
  let score = 0;

  if (/^sections\//.test(normalizedKey)) score += 120;
  if (/^snippets\//.test(normalizedKey)) score += 70;
  if (normalizedKey === "layout/theme.liquid") score += 20;
  if (normalizedKey === "sections/animated-header.liquid") score += 90;
  if (/testimonial|review|rich[-_]?text|multi[-_]?column|image[-_]?with[-_]?text|feature|content|faq|collapsible/i.test(normalizedKey)) {
    score += 45;
  }
  if (/announcement|popup|drawer|footer-group|header-group/i.test(normalizedKey)) {
    score -= 25;
  }
  if (/{%\s*schema\s*%}/i.test(source)) score += 35;
  if (/"presets"\s*:/i.test(source)) score += 25;
  if (/padding_top|padding-bottom|padding_bottom|section_padding|section-spacing/i.test(source)) {
    score += 55;
  }
  if (/image_picker|video_url|type"\s*:\s*"video"|richtext|button|btn|href=|image_tag/i.test(source)) {
    score += 35;
  }

  return score;
};

const mapFileToRememberedRead = (file) => ({
  key: file.key,
  checksumMd5: file.checksumMd5 || file.checksum || null,
  found:
    file?.found === false || file?.missing === true
      ? false
      : file?.found === true
        ? true
        : undefined,
  hasContent: true,
  value: file.value,
  attachment: file.attachment,
});

const findRecentRepresentativeThemeRead = (
  context,
  { themeId, themeRole, excludeKeys = [] } = {}
) => {
  const state = getThemeEditMemory(context);
  if (!state?.readFiles) {
    return null;
  }

  const excluded = new Set(uniqueStrings(excludeKeys));
  const candidates = Object.entries(state.readFiles)
    .filter(([key, entry]) => {
      if (!isRelevantRepresentativeReadKey(key) || excluded.has(key)) {
        return false;
      }
      if (!entry?.content) {
        return false;
      }
      return themeTargetsCompatible(entry.themeTarget, { themeId, themeRole });
    })
    .map(([key, entry]) => ({
      key,
      checksumMd5: entry.checksumMd5 || null,
      contentLength: entry.contentLength ?? String(entry.content || "").length,
      score: scoreRepresentativeRead({ key, content: entry.content }),
    }))
    .sort((left, right) => right.score - left.score);

  return candidates[0] || null;
};

const chooseRepresentativeFile = (files = []) =>
  (Array.isArray(files) ? files : [])
    .filter((file) => file?.found !== false && file?.missing !== true)
    .filter((file) => isRelevantRepresentativeReadKey(file?.key))
    .filter((file) => typeof file?.value === "string" || typeof file?.attachment === "string")
    .map((file) => ({
      file,
      score: scoreRepresentativeRead({
        key: file.key,
        content: file.value || file.attachment || "",
      }),
    }))
    .sort((left, right) => right.score - left.score)[0]?.file || null;

const hydrateRepresentativeReadFallback = async (
  context,
  {
    shopifyClient,
    apiVersion,
    themeId,
    themeRole,
    excludeKeys = [],
  } = {}
) => {
  const recent = findRecentRepresentativeThemeRead(context, {
    themeId,
    themeRole,
    excludeKeys,
  });
  if (recent) {
    return {
      attempted: false,
      substitute: recent,
      theme: null,
      source: "recent_read",
    };
  }

  if (!shopifyClient) {
    return {
      attempted: false,
      substitute: null,
      theme: null,
      source: "unavailable",
    };
  }

  const excluded = new Set(uniqueStrings(excludeKeys));
  const exactFallbackKeys = FALLBACK_REPRESENTATIVE_KEYS.filter(
    (key) => !excluded.has(key)
  );

  if (exactFallbackKeys.length > 0) {
    const exactResult = await getThemeFiles(shopifyClient, apiVersion, {
      themeId,
      themeRole,
      keys: exactFallbackKeys,
      includeContent: true,
    });
    const representative = chooseRepresentativeFile(exactResult.files || []);
    if (representative) {
      rememberThemeRead(context, {
        themeId: exactResult.theme.id,
        themeRole: exactResult.theme.role?.toLowerCase?.() || themeRole,
        files: [mapFileToRememberedRead(representative)],
      });
      return {
        attempted: true,
        substitute: {
          key: representative.key,
          checksumMd5: representative.checksumMd5 || representative.checksum || null,
          contentLength:
            typeof representative.value === "string"
              ? representative.value.length
              : null,
          score: scoreRepresentativeRead({
            key: representative.key,
            content: representative.value || "",
          }),
        },
        theme: exactResult.theme,
        source: "fallback_exact",
      };
    }
  }

  const searchResult = await searchThemeFiles(shopifyClient, apiVersion, {
    themeId,
    themeRole,
    patterns: ["sections/*.liquid"],
    includeContent: true,
    resultLimit: 10,
  });
  const representative = chooseRepresentativeFile(
    (searchResult.files || []).filter((file) => !excluded.has(file.key))
  );

  if (!representative) {
    return {
      attempted: true,
      substitute: null,
      theme: searchResult.theme,
      source: "fallback_search",
      truncated: searchResult.truncated === true,
    };
  }

  rememberThemeRead(context, {
    themeId: searchResult.theme.id,
    themeRole: searchResult.theme.role?.toLowerCase?.() || themeRole,
    files: [mapFileToRememberedRead(representative)],
  });

  return {
    attempted: true,
    substitute: {
      key: representative.key,
      checksumMd5: representative.checksumMd5 || representative.checksum || null,
      contentLength:
        typeof representative.value === "string" ? representative.value.length : null,
      score: scoreRepresentativeRead({
        key: representative.key,
        content: representative.value || "",
      }),
    },
    theme: searchResult.theme,
    source: "fallback_search",
    truncated: searchResult.truncated === true,
  };
};

const getMissingThemeReadKeys = (
  context,
  { keys = [], themeId, themeRole } = {}
) =>
  uniqueStrings(keys).filter(
    (key) =>
      !getRecentThemeRead(context, {
        key,
        themeId,
        themeRole,
        requireContent: true,
      })
  );

const hydrateExactThemeReads = async (
  context,
  {
    shopifyClient,
    apiVersion,
    themeId,
    themeRole,
    keys = [],
  } = {}
) => {
  const missingKeys = getMissingThemeReadKeys(context, {
    keys,
    themeId,
    themeRole,
  });

  if (!shopifyClient || missingKeys.length === 0) {
    return {
      attempted: false,
      hydratedKeys: [],
      missingKeys,
      theme: null,
    };
  }

  const result = await getThemeFiles(shopifyClient, apiVersion, {
    themeId,
    themeRole,
    keys: missingKeys,
    includeContent: true,
  });

  rememberThemeRead(context, {
    themeId: result.theme.id,
    themeRole: result.theme.role?.toLowerCase?.() || themeRole,
    files: (result.files || []).map(mapFileToRememberedRead),
  });

  const unresolvedKeys = getMissingThemeReadKeys(context, {
    keys: missingKeys,
    themeId: result.theme.id,
    themeRole: result.theme.role?.toLowerCase?.() || themeRole,
  });

  return {
    attempted: true,
    hydratedKeys: missingKeys.filter((key) => !unresolvedKeys.includes(key)),
    missingKeys: unresolvedKeys,
    theme: result.theme,
  };
};

const hydrateThemeReadsWithRepresentativeFallback = async (
  context,
  {
    shopifyClient,
    apiVersion,
    themeId,
    themeRole,
    keys = [],
    allowRepresentativeFallback = false,
    representativeFallbackKeys = [],
  } = {}
) => {
  const hydrationResult = await hydrateExactThemeReads(context, {
    shopifyClient,
    apiVersion,
    themeId,
    themeRole,
    keys,
  });

  const missingKeys = hydrationResult.missingKeys || [];
  if (!allowRepresentativeFallback || missingKeys.length === 0) {
    return hydrationResult;
  }

  const explicitFallbackKeys = uniqueStrings(representativeFallbackKeys);
  const fallbackEligibleKeys = new Set(
    explicitFallbackKeys.length > 0
      ? explicitFallbackKeys
      : missingKeys.filter(isDefaultRepresentativeFallbackKey)
  );
  const fallbackEligibleMissingKeys = missingKeys.filter((key) =>
    fallbackEligibleKeys.has(key)
  );
  const strictMissingKeys = missingKeys.filter(
    (key) => !fallbackEligibleKeys.has(key)
  );

  if (fallbackEligibleMissingKeys.length === 0) {
    return {
      ...hydrationResult,
      representativeFallbackAttempted: false,
      substituteRepresentativeRead: null,
      staleMissingKeys: [],
      unsatisfiedRepresentativeReadKeys: [],
      strictMissingKeys,
    };
  }

  const fallbackResult = await hydrateRepresentativeReadFallback(context, {
    shopifyClient,
    apiVersion,
    themeId: hydrationResult.theme?.id ?? themeId,
    themeRole: hydrationResult.theme?.role?.toLowerCase?.() || themeRole,
    excludeKeys: missingKeys,
  });

  if (!fallbackResult.substitute?.key) {
    return {
      ...hydrationResult,
      missingKeys: strictMissingKeys,
      staleMissingKeys: [],
      unsatisfiedRepresentativeReadKeys: fallbackEligibleMissingKeys,
      strictMissingKeys,
      representativeFallbackAttempted: fallbackResult.attempted === true,
      substituteRepresentativeRead: null,
      fallbackSource: fallbackResult.source || null,
    };
  }

  return {
    ...hydrationResult,
    missingKeys: strictMissingKeys,
    staleMissingKeys: fallbackEligibleMissingKeys,
    unsatisfiedRepresentativeReadKeys: [],
    strictMissingKeys,
    substituteRepresentativeRead: fallbackResult.substitute,
    representativeFallbackAttempted: fallbackResult.attempted === true,
    fallbackSource: fallbackResult.source || null,
    theme: fallbackResult.theme || hydrationResult.theme,
  };
};

export {
  findRecentRepresentativeThemeRead,
  getMissingThemeReadKeys,
  hydrateExactThemeReads,
  hydrateRepresentativeReadFallback,
  hydrateThemeReadsWithRepresentativeFallback,
  isRelevantRepresentativeReadKey,
};
