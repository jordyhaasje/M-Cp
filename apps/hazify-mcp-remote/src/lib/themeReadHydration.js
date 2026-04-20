import {
  getRecentThemeRead,
  rememberThemeRead,
} from "./themeEditMemory.js";
import { getThemeFiles } from "./themeFiles.js";

const uniqueStrings = (values) =>
  Array.from(new Set((values || []).filter(Boolean)));

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
    files: (result.files || []).map((file) => ({
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
    })),
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

export { getMissingThemeReadKeys, hydrateExactThemeReads };
