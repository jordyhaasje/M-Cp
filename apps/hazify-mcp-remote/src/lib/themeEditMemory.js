const DEFAULT_THEME_EDIT_MEMORY_TTL_MS = Number(
  process.env.HAZIFY_MCP_THEME_EDIT_MEMORY_TTL_MS || 4 * 60 * 60 * 1000
);

const themeEditMemory = new Map();

const uniqueStrings = (values) =>
  Array.from(new Set((values || []).filter(Boolean)));

const trimToNull = (value) => {
  const normalized = String(value || "").trim();
  return normalized ? normalized : null;
};

const normalizeThemeRole = (value) => {
  const normalized = trimToNull(value);
  return normalized ? normalized.toLowerCase() : null;
};

const normalizeThemeId = (value) => {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : null;
};

const normalizeThemeTarget = ({ themeId, themeRole } = {}) => ({
  themeId: normalizeThemeId(themeId),
  themeRole: normalizeThemeRole(themeRole),
});

const isUniquelyResolvableThemeRole = (themeRole) =>
  normalizeThemeRole(themeRole) === "main";

const mergeThemeTargets = (previousTarget = {}, nextTarget = {}) => {
  const previous = normalizeThemeTarget(previousTarget);
  const next = normalizeThemeTarget(nextTarget);
  const nextHasThemeId = next.themeId !== null;
  const nextHasThemeRole = Boolean(next.themeRole);

  if (!nextHasThemeId && !nextHasThemeRole) {
    return previous;
  }

  if (nextHasThemeId && nextHasThemeRole) {
    return next;
  }

  if (nextHasThemeId) {
    const canCarryRole =
      previous.themeId !== null &&
      previous.themeId === next.themeId &&
      Boolean(previous.themeRole);
    return {
      themeId: next.themeId,
      themeRole: canCarryRole ? previous.themeRole : null,
    };
  }

  const canCarryId =
    previous.themeId !== null &&
    Boolean(previous.themeRole) &&
    previous.themeRole === next.themeRole &&
    isUniquelyResolvableThemeRole(next.themeRole);

  return {
    themeId: canCarryId ? previous.themeId : null,
    themeRole: next.themeRole,
  };
};

const getThemeEditMemoryKey = (context = {}) =>
  trimToNull(
    context?.tokenHash ||
      context?.sessionId ||
      context?.mcpSessionId ||
      context?.requestSessionId
  );

const pruneExpiredThemeEditMemory = () => {
  const now = Date.now();
  for (const [key, entry] of themeEditMemory.entries()) {
    if (!entry || Number(entry.expiresAtMs || 0) <= now) {
      themeEditMemory.delete(key);
    }
  }
};

const withThemeEditMemoryState = (context, updater) => {
  const key = getThemeEditMemoryKey(context);
  if (!key) {
    return null;
  }

  pruneExpiredThemeEditMemory();
  const current =
    themeEditMemory.get(key)?.state || {
      themeTarget: normalizeThemeTarget({}),
      lastCreatedSectionFile: null,
      lastCreatedSectionHandle: null,
      lastTargetFile: null,
      lastIntent: null,
      lastTemplate: null,
      lastPlan: null,
      readFiles: {},
    };

  const nextState = updater(current) || current;
  themeEditMemory.set(key, {
    expiresAtMs:
      Date.now() + Math.max(DEFAULT_THEME_EDIT_MEMORY_TTL_MS, 60 * 1000),
    state: nextState,
  });
  return nextState;
};

const themeTargetsCompatible = (left = {}, right = {}) => {
  const normalizedLeft = normalizeThemeTarget(left);
  const normalizedRight = normalizeThemeTarget(right);
  const leftHasThemeId = normalizedLeft.themeId !== null;
  const rightHasThemeId = normalizedRight.themeId !== null;
  const leftHasThemeRole = Boolean(normalizedLeft.themeRole);
  const rightHasThemeRole = Boolean(normalizedRight.themeRole);

  if ((!leftHasThemeId && !leftHasThemeRole) || (!rightHasThemeId && !rightHasThemeRole)) {
    return true;
  }

  if (leftHasThemeId && rightHasThemeId) {
    if (normalizedLeft.themeId !== normalizedRight.themeId) {
      return false;
    }

    if (
      leftHasThemeRole &&
      rightHasThemeRole &&
      normalizedLeft.themeRole !== normalizedRight.themeRole
    ) {
      return false;
    }

    return true;
  }

  if (
    leftHasThemeRole &&
    rightHasThemeRole &&
    normalizedLeft.themeRole !== normalizedRight.themeRole
  ) {
    return false;
  }

  if (leftHasThemeRole && rightHasThemeRole && !leftHasThemeId && !rightHasThemeId) {
    return true;
  }

  if (leftHasThemeId && rightHasThemeRole) {
    return (
      isUniquelyResolvableThemeRole(normalizedRight.themeRole) &&
      leftHasThemeRole &&
      normalizedLeft.themeRole === normalizedRight.themeRole
    );
  }

  if (leftHasThemeRole && rightHasThemeId) {
    return (
      isUniquelyResolvableThemeRole(normalizedLeft.themeRole) &&
      rightHasThemeRole &&
      normalizedRight.themeRole === normalizedLeft.themeRole
    );
  }

  return true;
};

const deriveSectionHandle = (fileKey) => {
  const normalized = trimToNull(fileKey);
  if (!normalized || !normalized.startsWith("sections/")) {
    return null;
  }

  return normalized.replace(/^sections\//, "").replace(/\.liquid$/, "") || null;
};

const normalizeReadFiles = (files = []) =>
  (Array.isArray(files) ? files : []).map((file) => ({
    key: trimToNull(file?.key),
    checksumMd5: trimToNull(file?.checksumMd5 || file?.checksum),
    found:
      file?.found === false || file?.missing === true
        ? false
        : file?.found === true
          ? true
          : null,
    hasContent:
      file?.hasContent === true ||
      typeof file?.value === "string" ||
      typeof file?.attachment === "string",
    content: typeof file?.value === "string" ? file.value : null,
  }));

const rememberThemePlan = (
  context,
  {
    themeId,
    themeRole,
    intent,
    template,
    query,
    targetFile,
    nextReadKeys = [],
    nextWriteKeys = [],
    immediateNextTool = null,
    writeTool = null,
    themeContext = null,
    sectionBlueprint = null,
    plannerHandoff = null,
  } = {}
) =>
  withThemeEditMemoryState(context, (state) => {
    const themeTarget = mergeThemeTargets(state.themeTarget, { themeId, themeRole });
    return {
      ...state,
      themeTarget,
      lastTargetFile: trimToNull(targetFile) || state.lastTargetFile,
      lastIntent: trimToNull(intent) || state.lastIntent,
      lastTemplate: trimToNull(template) || state.lastTemplate,
      lastPlan: {
        atMs: Date.now(),
        targetFile: trimToNull(targetFile),
        intent: trimToNull(intent),
        template: trimToNull(template),
        query: trimToNull(query),
        nextReadKeys: uniqueStrings(nextReadKeys),
        nextWriteKeys: uniqueStrings(nextWriteKeys),
        immediateNextTool: trimToNull(immediateNextTool),
        writeTool: trimToNull(writeTool),
        themeContext: themeContext && typeof themeContext === "object" ? themeContext : null,
        sectionBlueprint:
          sectionBlueprint && typeof sectionBlueprint === "object"
            ? sectionBlueprint
            : null,
        plannerHandoff:
          plannerHandoff && typeof plannerHandoff === "object"
            ? plannerHandoff
            : null,
      },
    };
  });

const rememberThemeRead = (
  context,
  {
    themeId,
    themeRole,
    files = [],
  } = {}
) =>
  withThemeEditMemoryState(context, (state) => {
    const themeTarget = mergeThemeTargets(state.themeTarget, { themeId, themeRole });
    const nextReadFiles = { ...(state.readFiles || {}) };

    for (const file of normalizeReadFiles(files)) {
      if (!file.key || !file.hasContent || file.found === false) {
        continue;
      }
      nextReadFiles[file.key] = {
        atMs: Date.now(),
        themeTarget,
        checksumMd5: file.checksumMd5,
        content: file.content,
      };
    }

    return {
      ...state,
      themeTarget,
      readFiles: nextReadFiles,
    };
  });

const rememberThemeWrite = (
  context,
  {
    themeId,
    themeRole,
    intent = null,
    mode = null,
    files = [],
    createdSectionFile = null,
  } = {}
) =>
  withThemeEditMemoryState(context, (state) => {
    const themeTarget = mergeThemeTargets(state.themeTarget, { themeId, themeRole });
    const normalizedFiles = (Array.isArray(files) ? files : [])
      .map((file) => trimToNull(file?.key || file))
      .filter(Boolean);
    const effectiveCreatedSectionFile =
      trimToNull(createdSectionFile) ||
      normalizedFiles.find((key) => key.startsWith("sections/")) ||
      null;

    return {
      ...state,
      themeTarget,
      lastIntent: trimToNull(intent) || trimToNull(mode) || state.lastIntent,
      lastTargetFile:
        effectiveCreatedSectionFile ||
        normalizedFiles[0] ||
        state.lastTargetFile,
      lastCreatedSectionFile:
        effectiveCreatedSectionFile || state.lastCreatedSectionFile,
      lastCreatedSectionHandle:
        deriveSectionHandle(effectiveCreatedSectionFile) ||
        state.lastCreatedSectionHandle,
    };
  });

const getThemeEditMemory = (context) => {
  const key = getThemeEditMemoryKey(context);
  if (!key) {
    return null;
  }
  pruneExpiredThemeEditMemory();
  return themeEditMemory.get(key)?.state || null;
};

const getRecentThemeRead = (
  context,
  { key, themeId, themeRole, requireContent = true } = {}
) => {
  const state = getThemeEditMemory(context);
  if (!state) {
    return null;
  }

  const normalizedKey = trimToNull(key);
  if (!normalizedKey) {
    return null;
  }

  const readEntry = state.readFiles?.[normalizedKey];
  if (!readEntry) {
    return null;
  }

  if (
    !themeTargetsCompatible(readEntry.themeTarget, normalizeThemeTarget({ themeId, themeRole }))
  ) {
    return null;
  }

  if (
    requireContent &&
    Number(readEntry.atMs || 0) + Math.max(DEFAULT_THEME_EDIT_MEMORY_TTL_MS, 60 * 1000) <
      Date.now()
  ) {
    return null;
  }

  return readEntry;
};

const haveRecentThemeReads = (
  context,
  { keys = [], themeId, themeRole } = {}
) =>
  uniqueStrings(keys).every((key) =>
    Boolean(
      getRecentThemeRead(context, {
        key,
        themeId,
        themeRole,
        requireContent: true,
      })
    )
  );

const clearThemeEditMemory = () => {
  themeEditMemory.clear();
};

export {
  clearThemeEditMemory,
  getRecentThemeRead,
  getThemeEditMemory,
  haveRecentThemeReads,
  rememberThemePlan,
  rememberThemeRead,
  rememberThemeWrite,
  themeTargetsCompatible,
};
