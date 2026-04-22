import { getThemeEditMemory } from "../lib/themeEditMemory.js";

const normalizeNumericThemeId = (value) => {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const numericValue = Number(value);
  return Number.isFinite(numericValue) && numericValue > 0 ? numericValue : null;
};

const normalizeThemeRole = (value) => {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized || null;
};

const buildThemeTargetWarnings = ({ reusedStickyTarget, themeId, themeRole } = {}) => {
  if (!reusedStickyTarget) {
    return [];
  }

  const targetLabel =
    themeId !== null
      ? `themeId=${themeId}${themeRole ? ` (${themeRole})` : ""}`
      : themeRole
        ? `themeRole='${themeRole}'`
        : "eerder bevestigd theme target";

  return [
    `Eerder bevestigd theme target uit dezelfde flow hergebruikt: ${targetLabel}. Geef themeId of themeRole opnieuw mee als je van theme wilt wisselen.`,
  ];
};

const resolveThemeTargetFromInputOrMemory = (input = {}, context = {}) => {
  const explicitThemeId = normalizeNumericThemeId(input.themeId);
  const explicitThemeRole = normalizeThemeRole(input.themeRole);
  if (explicitThemeId !== null || explicitThemeRole) {
    return {
      themeId: explicitThemeId,
      themeRole: explicitThemeRole,
      reusedStickyTarget: false,
      warnings: [],
    };
  }

  const stickyTarget = getThemeEditMemory(context)?.themeTarget || null;
  const stickyThemeId = normalizeNumericThemeId(stickyTarget?.themeId);
  const stickyThemeRole = normalizeThemeRole(stickyTarget?.themeRole);
  if (stickyThemeId === null && !stickyThemeRole) {
    return null;
  }

  return {
    themeId: stickyThemeId,
    themeRole: stickyThemeRole,
    reusedStickyTarget: true,
    warnings: buildThemeTargetWarnings({
      reusedStickyTarget: true,
      themeId: stickyThemeId,
      themeRole: stickyThemeRole,
    }),
  };
};

const buildExplicitThemeTargetRequiredResponse = ({
  toolName,
  normalizedArgs = {},
  nextArgsTemplate = {},
  guidance = null,
} = {}) => ({
  success: false,
  status: "missing_theme_target",
  message:
    guidance ||
    "Er ontbreekt een expliciet theme target. Kies eerst het juiste Shopify theme via themeId of themeRole en probeer daarna dezelfde read/write stap opnieuw.",
  errorCode: "explicit_theme_target_required",
  retryable: true,
  nextAction: "choose_theme_target_then_retry",
  nextTool: toolName,
  retryMode: "same_request_with_theme_target",
  normalizedArgs,
  nextArgsTemplate: {
    ...nextArgsTemplate,
    themeId: null,
    themeRole: null,
  },
  suggestedFixes: [
    "Vraag of bepaal eerst expliciet het doeltheme via get-themes.",
    "Voeg daarna themeRole='main' of een exact themeId toe aan dezelfde call.",
  ],
  errors: [
    {
      path: ["themeRole"],
      problem:
        "Deze theme read/search/verify-flow kiest nooit stilzwijgend een live of default theme.",
      fixSuggestion:
        "Voeg themeRole of themeId toe, bijvoorbeeld themeRole='main' of themeId=123456789.",
    },
  ],
});

export {
  buildExplicitThemeTargetRequiredResponse,
  resolveThemeTargetFromInputOrMemory,
};
