import { z } from "zod";
import { requireShopifyClient } from "./_context.js";
import { planThemeEdit } from "../lib/themePlanning.js";
import { buildCodegenContract } from "../lib/themeCodegenContract.js";
import {
  extractThemeToolSummary,
  inferIntentFromSummary,
  inferSectionTypeHint,
  inferSingleThemeFile,
  inferTemplateFromSummary,
  inferThemeTargetFromSummary,
} from "./_themeToolCompatibility.js";
import {
  getRecentThemeRead,
  getThemeEditMemory,
  rememberThemePlan,
  themeTargetsCompatible,
} from "../lib/themeEditMemory.js";

const API_VERSION = process.env.SHOPIFY_API_VERSION || "2026-01";
const ThemeRoleSchema = z.enum(["main"]);
const PLAN_INTENT_VALUES = [
  "existing_edit",
  "native_block",
  "new_section",
  "template_placement",
];
const IntentSchema = z.enum(PLAN_INTENT_VALUES);
const TemplateSchema = z.enum([
  "product",
  "homepage",
  "index",
  "collection",
  "page",
  "article",
  "blog",
  "cart",
  "search",
]);
const PlannerVerbositySchema = z.enum(["compact", "debug"]);

const SummaryAliasFieldDescriptions = {
  _tool_input_summary:
    "Compat summary voor beperkte clients. Alleen veilige inferentie voor intent, theme target, template en exact één targetFile.",
  tool_input_summary:
    "Legacy alias van _tool_input_summary voor backwards compatibility.",
  summary:
    "Legacy alias van _tool_input_summary voor backwards compatibility.",
  prompt:
    "Legacy alias van _tool_input_summary voor backwards compatibility.",
  request:
    "Legacy alias van _tool_input_summary voor backwards compatibility.",
};

const PLAN_QUERY_PUBLIC_MAX_LENGTH = 4000;
const PLAN_QUERY_INTERNAL_MAX_LENGTH = 240;
const FOLLOW_UP_SECTION_PATTERNS = [
  /\b(v2|v3|version 2|variant 2)\b/i,
  /\boptimaliseer\b/i,
  /\boptimi[sz]e\b/i,
  /\bverbeter\b/i,
  /\bimprove\b/i,
  /\bmaak (hem|haar|die|deze)\b/i,
  /\bpas (hem|haar|die|deze)\b/i,
  /\bdie (section|sectie)\b/i,
  /\bdeze (section|sectie)\b/i,
  /\bzelfde (section|sectie)\b/i,
  /\bthat section\b/i,
];

const uniqueStrings = (values) =>
  Array.from(new Set((values || []).filter(Boolean)));

const compactPlanQuery = (value) =>
  typeof value === "string" && value.trim()
    ? value.trim().slice(0, PLAN_QUERY_INTERNAL_MAX_LENGTH)
    : undefined;

const extractPlannerBrief = (rawInput = {}, normalizedInput = {}) => {
  const summary = extractThemeToolSummary(rawInput);
  if (typeof summary === "string" && summary.trim()) {
    return summary.trim();
  }

  if (typeof rawInput?.query === "string" && rawInput.query.trim()) {
    return rawInput.query.trim();
  }

  if (typeof rawInput?.description === "string" && rawInput.description.trim()) {
    return rawInput.description.trim();
  }

  if (
    typeof normalizedInput?.analysisText === "string" &&
    normalizedInput.analysisText.trim()
  ) {
    return normalizedInput.analysisText.trim();
  }

  if (typeof normalizedInput?.query === "string" && normalizedInput.query.trim()) {
    return normalizedInput.query.trim();
  }

  return normalizedInput?.targetFile || "";
};

const PlanThemeEditPublicObjectSchema = z
  .object({
    intent: IntentSchema.optional().describe(
      "Bij voorkeur expliciet meegeven. existing_edit = bestaand bestand patchen, native_block = block in bestaande section/productflow, new_section = nieuwe section maken, template_placement = bestaande section/template placement analyseren. Compat-aliassen en summary-fallback blijven alleen bedoeld voor oudere clients."
    ),
    themeId: z
      .coerce.number()
      .int()
      .positive()
      .optional()
      .describe("Optional explicit Shopify theme ID."),
    theme_id: z
      .coerce.number()
      .int()
      .positive()
      .optional()
      .describe("Compat alias van themeId voor generieke wrappers."),
    themeRole: ThemeRoleSchema
      .optional()
      .describe("Theme role when themeId is omitted. Alleen 'main' is role-only toegestaan; gebruik themeId voor development/unpublished/demo themes."),
    theme_role: ThemeRoleSchema
      .optional()
      .describe("Compat alias van themeRole voor generieke wrappers. Alleen 'main' is role-only toegestaan."),
    template: TemplateSchema
      .optional()
      .describe("Optioneel template-oppervlak, bijv. product of homepage. Als dit ontbreekt gebruikt de planner een veilige default per intent."),
    query: z
      .string()
      .max(PLAN_QUERY_PUBLIC_MAX_LENGTH)
      .optional()
      .describe(
        "Taakomschrijving of zichtbare anchor. Langere client-prompts zijn toegestaan; de planner compacteert deze intern tot een korte query voor tokenzuinige planning."
      ),
    analysisText: z
      .string()
      .max(PLAN_QUERY_PUBLIC_MAX_LENGTH)
      .optional()
      .describe(
        "Interne of compatibele volledige analysetekst naast de compacte query. Hoeft normale clients meestal niet expliciet mee te sturen."
      ),
    targetFile: z
      .string()
      .min(1)
      .optional()
      .describe("Exact bestaand bestand wanneer je al weet welk file gepatcht moet worden."),
    target_file: z
      .string()
      .min(1)
      .optional()
      .describe("Compat alias van targetFile voor generieke wrappers."),
    sectionTypeHint: z
      .string()
      .max(120)
      .optional()
      .describe("Optionele hint voor de section type/handle, bijvoorbeeld main-product."),
    section_type_hint: z
      .string()
      .max(120)
      .optional()
      .describe("Compat alias van sectionTypeHint voor generieke wrappers."),
    _tool_input_summary: z
      .string()
      .max(4000)
      .optional()
      .describe(SummaryAliasFieldDescriptions._tool_input_summary),
    tool_input_summary: z
      .string()
      .max(4000)
      .optional()
      .describe(SummaryAliasFieldDescriptions.tool_input_summary),
    summary: z
      .string()
      .max(4000)
      .optional()
      .describe(SummaryAliasFieldDescriptions.summary),
    prompt: z
      .string()
      .max(4000)
      .optional()
      .describe(SummaryAliasFieldDescriptions.prompt),
    request: z
      .string()
      .max(4000)
      .optional()
      .describe(SummaryAliasFieldDescriptions.request),
    description: z
      .string()
      .max(PLAN_QUERY_PUBLIC_MAX_LENGTH)
      .optional()
      .describe(
        "Compat alias voor query; wordt alleen gebruikt als query ontbreekt en intern compact gemaakt."
      ),
    type: z
      .string()
      .max(80)
      .optional()
      .describe("Compat alias voor intent. Alleen ondersteund voor bekende intent-waarden."),
    intentType: z
      .string()
      .max(80)
      .optional()
      .describe("Compat alias voor intent. Alleen ondersteund voor bekende intent-waarden."),
    intent_type: z
      .string()
      .max(80)
      .optional()
      .describe("Compat alias voor intent. Alleen ondersteund voor bekende intent-waarden."),
    targetFiles: z
      .array(z.string().min(1))
      .max(10)
      .optional()
      .describe("Compat alias. Alleen een array van exact één targetFile wordt automatisch genormaliseerd."),
    snippetLimit: z
      .number()
      .int()
      .min(1)
      .max(5)
      .default(3)
      .describe("Maximaal aantal gerelateerde snippets om compact mee te nemen in de plan-output."),
    snippet_limit: z
      .number()
      .int()
      .min(1)
      .max(5)
      .optional()
      .describe("Compat alias van snippetLimit voor generieke wrappers."),
    verbosity: PlannerVerbositySchema
      .default("compact")
      .describe(
        "compact is de standaard machine-actionable planner-output. debug voegt volledige plannerHandoff, sectionBlueprint en codegenContract toe."
      ),
    includeContracts: z
      .boolean()
      .default(false)
      .describe(
        "Zet true wanneer een stateless client de volledige plannerHandoff/codegenContract/sectionBlueprint moet doorgeven aan een latere write-tool."
      ),
    include_contracts: z
      .boolean()
      .optional()
      .describe("Compat alias van includeContracts."),
  })
  .strict();

const PlanThemeEditPublicShape = PlanThemeEditPublicObjectSchema
  .superRefine((input, ctx) => {
    if (input.themeId && input.themeRole) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["themeId"],
        message: "Gebruik themeId of themeRole, niet allebei tegelijk.",
      });
    }

    if (input.intent && input.intent !== "existing_edit" && input.targetFile) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["targetFile"],
        message: "targetFile is alleen bedoeld voor existing_edit flows.",
      });
    }
  });

const PlanThemeEditNormalizedShape = z
  .object({
    intent: IntentSchema.optional(),
    themeId: z.coerce.number().int().positive().optional(),
    themeRole: ThemeRoleSchema.optional(),
    template: TemplateSchema.optional(),
    query: z.string().max(240).optional(),
    analysisText: z.string().max(PLAN_QUERY_PUBLIC_MAX_LENGTH).optional(),
    targetFile: z.string().min(1).optional(),
    sectionTypeHint: z.string().max(120).optional(),
    snippetLimit: z.number().int().min(1).max(5).default(3),
    verbosity: PlannerVerbositySchema.default("compact"),
    includeContracts: z.boolean().default(false),
  })
  .strict()
  .superRefine((input, ctx) => {
    if (input.themeId && input.themeRole) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["themeId"],
        message: "Gebruik themeId of themeRole, niet allebei tegelijk.",
      });
    }

    if (input.intent && input.intent !== "existing_edit" && input.targetFile) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["targetFile"],
        message: "targetFile is alleen bedoeld voor existing_edit flows.",
      });
    }
  });

const normalizePlanThemeEditInput = (rawInput) => {
  if (!rawInput || typeof rawInput !== "object" || Array.isArray(rawInput)) {
    return rawInput;
  }

  let normalized = {
    intent: rawInput.intent,
    themeId: rawInput.themeId ?? rawInput.theme_id,
    themeRole: rawInput.themeRole ?? rawInput.theme_role,
    template: rawInput.template,
    query: compactPlanQuery(rawInput.query),
    analysisText:
      typeof rawInput.query === "string" && rawInput.query.trim()
        ? rawInput.query.trim().slice(0, PLAN_QUERY_PUBLIC_MAX_LENGTH)
        : undefined,
    targetFile: rawInput.targetFile ?? rawInput.target_file,
    sectionTypeHint: rawInput.sectionTypeHint ?? rawInput.section_type_hint,
    snippetLimit: rawInput.snippetLimit ?? rawInput.snippet_limit,
    verbosity: rawInput.verbosity,
    includeContracts: rawInput.includeContracts ?? rawInput.include_contracts,
  };
  const descriptionAlias =
    typeof rawInput.description === "string" && rawInput.description.trim()
      ? rawInput.description.trim().slice(0, PLAN_QUERY_PUBLIC_MAX_LENGTH)
      : "";

  if (!normalized.intent) {
    for (const candidate of [rawInput.intent_type, rawInput.intentType, rawInput.type]) {
      if (typeof candidate === "string" && PLAN_INTENT_VALUES.includes(candidate)) {
        normalized.intent = candidate;
        break;
      }
    }
  }

  if (!normalized.query && descriptionAlias) {
    normalized.query = compactPlanQuery(descriptionAlias);
  }

  if (!normalized.analysisText && descriptionAlias) {
    normalized.analysisText = descriptionAlias;
  }

  if (!normalized.targetFile && Array.isArray(rawInput.targetFiles) && rawInput.targetFiles.length === 1) {
    normalized.targetFile = rawInput.targetFiles[0];
  }

  if (!normalized.intent && normalized.targetFile) {
    normalized.intent = "existing_edit";
  }

  const summary = extractThemeToolSummary(rawInput) || descriptionAlias;
  if (!summary) {
    return normalized;
  }

  normalized = inferThemeTargetFromSummary(normalized, summary);
  if (!normalized.intent) {
    normalized.intent = inferIntentFromSummary(summary, normalized);
  }
  if (!normalized.template) {
    normalized.template = inferTemplateFromSummary(summary) || normalized.template;
  }
  if (!normalized.query) {
    normalized.query = compactPlanQuery(summary);
  }
  if (!normalized.analysisText) {
    normalized.analysisText = String(summary || "")
      .trim()
      .slice(0, PLAN_QUERY_PUBLIC_MAX_LENGTH);
  }
  if (!normalized.targetFile && normalized.intent === "existing_edit") {
    normalized.targetFile = inferSingleThemeFile(summary) || normalized.targetFile;
  }
  if (!normalized.sectionTypeHint) {
    normalized.sectionTypeHint = inferSectionTypeHint(summary) || normalized.sectionTypeHint;
  }

  return normalized;
};

const PlanThemeEditInputSchema = z.preprocess(
  normalizePlanThemeEditInput,
  PlanThemeEditPublicShape
);

const NormalizedPlanThemeEditInputSchema = z.preprocess(
  normalizePlanThemeEditInput,
  PlanThemeEditNormalizedShape
);

const summarizeNormalizedPlanInput = (input = {}) => ({
  intent: input.intent || null,
  themeId: input.themeId ?? null,
  themeRole: input.themeRole || null,
  template: input.template || null,
  query: input.query || null,
  analysisText: input.analysisText || null,
  targetFile: input.targetFile || null,
  sectionTypeHint: input.sectionTypeHint || null,
  snippetLimit: input.snippetLimit ?? 3,
  verbosity: input.verbosity || "compact",
  includeContracts: input.includeContracts === true,
});

const buildExplicitThemeTarget = (input = {}) =>
  input.themeId !== undefined
    ? { themeId: input.themeId }
    : input.themeRole
      ? { themeRole: input.themeRole }
      : {};

const getBasenameQueryFromTargetFile = (targetFile) => {
  const normalized = String(targetFile || "").trim();
  if (!normalized) {
    return null;
  }
  const filename = normalized.split("/").pop() || normalized;
  return filename.replace(/\.[^.]+$/, "") || filename;
};

const getFileScopeFromKey = (key) => {
  const normalized = String(key || "").trim();
  if (normalized.startsWith("sections/")) {
    return ["sections"];
  }
  if (normalized.startsWith("snippets/")) {
    return ["snippets"];
  }
  if (normalized.startsWith("blocks/")) {
    return ["sections", "snippets", "blocks"];
  }
  if (normalized.startsWith("templates/")) {
    return ["templates"];
  }
  if (normalized.startsWith("config/")) {
    return ["config"];
  }
  if (normalized.startsWith("assets/")) {
    return ["assets"];
  }
  return undefined;
};

const STICKY_PLAN_INTENTS = new Set([
  "existing_edit",
  "native_block",
  "template_placement",
]);

const deriveStickyTargetHandle = (memoryState, stickyTargetFile) => {
  const createdHandle = String(memoryState?.lastCreatedSectionHandle || "").trim();
  if (createdHandle) {
    return createdHandle;
  }

  const normalizedTargetFile = String(stickyTargetFile || "").trim();
  if (!normalizedTargetFile) {
    return "";
  }

  return normalizedTargetFile
    .split("/")
    .pop()
    ?.replace(/\.(liquid|json|css|js|svg)$/i, "") || "";
};

const getStickyPlanTarget = (memoryState) => {
  if (!memoryState || typeof memoryState !== "object") {
    return null;
  }

  const createdSectionFile = String(memoryState.lastCreatedSectionFile || "").trim();
  if (createdSectionFile) {
    return {
      key: createdSectionFile,
      source: "last_created_section",
    };
  }

  const planIntent = String(memoryState.lastPlan?.intent || "").trim();
  const planTargetFile = String(memoryState.lastPlan?.targetFile || "").trim();
  if (planTargetFile && STICKY_PLAN_INTENTS.has(planIntent)) {
    return {
      key: planTargetFile,
      source: "recent_plan_target",
    };
  }

  const lastIntent = String(memoryState.lastIntent || "").trim();
  const lastTargetFile = String(memoryState.lastTargetFile || "").trim();
  if (lastTargetFile && STICKY_PLAN_INTENTS.has(lastIntent)) {
    return {
      key: lastTargetFile,
      source: "recent_target_file",
    };
  }

  return null;
};

const looksLikeStickySectionFollowUp = (text, memoryState) => {
  const normalized = String(text || "").trim();
  const stickyPlanTarget = getStickyPlanTarget(memoryState);
  if (!normalized || !stickyPlanTarget?.key) {
    return false;
  }
  if (inferSingleThemeFile(normalized)) {
    return false;
  }
  const handle = deriveStickyTargetHandle(memoryState, stickyPlanTarget.key);
  if (handle && normalized.toLowerCase().includes(handle.toLowerCase())) {
    return true;
  }
  return FOLLOW_UP_SECTION_PATTERNS.some((pattern) => pattern.test(normalized));
};

const applyStickyPlanContext = (input, rawInput, context) => {
  const memoryState = getThemeEditMemory(context);
  if (!memoryState) {
    return { input, stickyTarget: null };
  }

  const summary = extractThemeToolSummary(rawInput) || input.query || "";
  if (!looksLikeStickySectionFollowUp(summary, memoryState)) {
    return { input, stickyTarget: null };
  }
  if (input.targetFile || inferSingleThemeFile(summary)) {
    return { input, stickyTarget: null };
  }
  if (input.intent && input.intent !== "existing_edit") {
    return { input, stickyTarget: null };
  }
  if (
    (input.themeId !== undefined || input.themeRole) &&
    !themeTargetsCompatible(memoryState.themeTarget, {
      themeId: input.themeId,
      themeRole: input.themeRole,
    })
  ) {
    return { input, stickyTarget: null };
  }

  const stickyPlanTarget = getStickyPlanTarget(memoryState);
  if (!stickyPlanTarget?.key) {
    return { input, stickyTarget: null };
  }
  const stickyTargetFile = stickyPlanTarget.key;

  const nextInput = {
    ...input,
    intent: "existing_edit",
    targetFile: stickyTargetFile,
    themeId:
      input.themeId !== undefined
        ? input.themeId
        : memoryState.themeTarget?.themeId ?? input.themeId,
    themeRole:
      input.themeRole ||
      (input.themeId === undefined ? memoryState.themeTarget?.themeRole || input.themeRole : input.themeRole),
  };

  return {
    input: nextInput,
    stickyTarget: {
      source: stickyPlanTarget.source,
      targetFile: stickyTargetFile,
      themeId: nextInput.themeId ?? null,
      themeRole: nextInput.themeRole || null,
    },
  };
};

const buildPlanInputError = ({
  path,
  problem,
  fixSuggestion,
  suggestedReplacement,
}) => ({
  path,
  problem,
  fixSuggestion,
  ...(suggestedReplacement !== undefined ? { suggestedReplacement } : {}),
});

const compactSearchQuery = (value) =>
  typeof value === "string" && value.trim()
    ? value.trim().slice(0, 160)
    : undefined;

const buildPlanRepairResponse = ({
  status = "needs_input",
  message,
  errorCode,
  errors = [],
  normalizedArgs,
  nextAction,
  nextTool,
  nextArgsTemplate,
  retryMode = "same_request_with_structured_fields",
  warnings = [],
}) => ({
  success: false,
  status,
  message,
  errorCode,
  retryable: true,
  nextAction,
  ...(nextTool ? { nextTool } : {}),
  ...(nextArgsTemplate ? { nextArgsTemplate } : {}),
  retryMode,
  normalizedArgs,
  warnings,
  errors,
});

const buildPatchTemplateEntry = (key) => ({
  key,
  patches: [
    {
      searchString: "<exact literal anchor from the current file>",
      replaceString: "<updated markup/liquid>",
    },
  ],
});

const pickPlanSearchQuery = (input = {}, result = {}) => {
  const resultQueries = Array.isArray(result?.searchQueries)
    ? result.searchQueries.filter(
        (entry) => typeof entry === "string" && entry.trim()
      )
    : [];
  if (resultQueries.length > 0) {
    return resultQueries[0];
  }

  const compactedQuery = compactSearchQuery(input?.query);
  if (compactedQuery) {
    return compactedQuery;
  }

  return getBasenameQueryFromTargetFile(input?.targetFile) || "block.type";
};

const buildPlanWriteArgsTemplate = (input = {}, result = {}) => {
  const explicitThemeTarget = buildExplicitThemeTarget(input);

  if (result?.shouldUse === "create-theme-section") {
    const precisionFirst =
      result?.sectionBlueprint?.completionPolicy?.deliveryExpectation ===
      "final_reference_match_in_first_write";
    return {
      ...explicitThemeTarget,
      key: result?.newFileSuggestions?.[0] || "sections/<new-section>.liquid",
      liquid: precisionFirst
        ? "<complete Shopify Liquid section with the final requested styling and interaction; do not write a rough baseline; valid {% schema %}>"
        : "<complete Shopify Liquid section with the final requested styling and valid {% schema %}>",
    };
  }

  if (result?.shouldUse === "patch-theme-file") {
    return {
      ...explicitThemeTarget,
      key: input.targetFile || result?.nextWriteKeys?.[0] || "<existing-theme-file>",
      searchString: "<exact literal anchor from the file>",
      replaceString: "<updated markup/liquid>",
    };
  }

  if (result?.shouldUse === "draft-theme-artifact") {
    const preferFullRewrite =
      result?.recommendedFlow === "rewrite-existing" ||
      result?.sectionBlueprint?.writeStrategy?.preferFullRewriteAfterCreate === true;
    const isEditModeFlow =
      result?.recommendedFlow === "rewrite-existing" ||
      result?.recommendedFlow === "template-placement" ||
      result?.recommendedFlow === "multi-file-edit";
    const patchPreferredWriteKeys = Array.isArray(result?.nextWriteKeys)
      ? result.nextWriteKeys.filter(Boolean)
      : [];
    const shouldPreferPatchTemplate =
      isEditModeFlow &&
      !preferFullRewrite &&
      (
        input?.intent === "native_block" ||
        result?.recommendedFlow === "template-placement" ||
        result?.recommendedFlow === "multi-file-edit"
      ) &&
      patchPreferredWriteKeys.length > 0;

    if (shouldPreferPatchTemplate) {
      return {
        ...explicitThemeTarget,
        mode: "edit",
        files: patchPreferredWriteKeys.map((key) => buildPatchTemplateEntry(key)),
      };
    }

    return {
      ...explicitThemeTarget,
      mode: isEditModeFlow ? "edit" : "create",
      files: [
        {
          key:
            result?.nextWriteKeys?.[0] ||
            result?.newFileSuggestions?.[0] ||
            "<theme-file>",
          value: preferFullRewrite
            ? "<full rewritten file content>"
            : "<complete file content or use patch/patches for edits>",
        },
      ],
    };
  }

  return undefined;
};

const shouldPreferCompactSearchStep = (input = {}, result = {}, nextReadKeys = []) => {
  if (nextReadKeys.length === 0) {
    return false;
  }

  const hasStructuredSearchQueries =
    Array.isArray(result?.searchQueries) &&
    result.searchQueries.some(
      (entry) => typeof entry === "string" && entry.trim()
    );

  if (
    input?.intent === "native_block"
  ) {
    return true;
  }

  if (result?.recommendedFlow === "patch-existing" && hasStructuredSearchQueries) {
    return true;
  }

  return false;
};

const buildPlanImmediateNextStep = (input = {}, result = {}) => {
  const explicitThemeTarget = buildExplicitThemeTarget(input);
  const nextReadKeys = Array.isArray(result?.nextReadKeys)
    ? result.nextReadKeys.filter(Boolean)
    : [];

  if (input.intent === "existing_edit" && input.targetFile && (!result?.nextWriteKeys || result.nextWriteKeys.length === 0)) {
    const recoveryQuery = getBasenameQueryFromTargetFile(input.targetFile);
    return {
      nextAction: "search_exact_file",
      nextTool: "search-theme-files",
      nextArgsTemplate: {
        ...explicitThemeTarget,
        query: recoveryQuery || input.targetFile,
        ...(getFileScopeFromKey(input.targetFile)
          ? { scope: getFileScopeFromKey(input.targetFile) }
          : {}),
      },
      requiresReadBeforeWrite: true,
    };
  }

  if (shouldPreferCompactSearchStep(input, result, nextReadKeys)) {
    return {
      nextAction: "search_theme_context",
      nextTool: "search-theme-files",
      nextArgsTemplate: {
        ...explicitThemeTarget,
        query: pickPlanSearchQuery(input, result),
        keys: nextReadKeys,
      },
      requiresReadBeforeWrite: true,
    };
  }

  if (nextReadKeys.length === 1) {
    return {
      nextAction: "read_target_file",
      nextTool: "get-theme-file",
      nextArgsTemplate: {
        ...explicitThemeTarget,
        key: nextReadKeys[0],
        includeContent: true,
      },
      requiresReadBeforeWrite: true,
    };
  }

  if (nextReadKeys.length > 1) {
    return {
      nextAction: "read_target_files",
      nextTool: "get-theme-files",
      nextArgsTemplate: {
        ...explicitThemeTarget,
        keys: nextReadKeys,
        includeContent: true,
      },
      requiresReadBeforeWrite: true,
    };
  }

  const writeTool = typeof result?.shouldUse === "string" ? result.shouldUse : undefined;
  return {
    nextAction: writeTool ? "write_theme_change" : undefined,
    nextTool: writeTool,
    nextArgsTemplate: buildPlanWriteArgsTemplate(input, result),
    requiresReadBeforeWrite: false,
  };
};

const buildPlannerHandoff = ({
  brief,
  input = {},
  result = {},
  immediateStep = {},
  writeTool = null,
  codegenContract = null,
} = {}) => ({
  brief: String(brief || "").trim() || null,
  plannerQuery: String(input?.query || "").trim() || null,
  intent: input?.intent || result?.intent || null,
  template: input?.template || result?.template?.resolved || null,
  themeTarget: {
    themeId:
      input?.themeId === undefined || input?.themeId === null
        ? null
        : Number(input.themeId),
    themeRole: String(input?.themeRole || "").trim() || null,
  },
  targetFile: String(input?.targetFile || "").trim() || null,
  archetype: result?.sectionBlueprint?.archetype || null,
  layoutContract: result?.sectionBlueprint?.layoutContract || null,
  themeWrapperStrategy: result?.sectionBlueprint?.themeWrapperStrategy || null,
  generationRecipe: result?.sectionBlueprint?.generationRecipe || null,
  qualityTarget: result?.qualityTarget || result?.sectionBlueprint?.qualityTarget || null,
  generationMode:
    result?.generationMode || result?.sectionBlueprint?.generationMode || null,
  completionPolicy:
    result?.completionPolicy || result?.sectionBlueprint?.completionPolicy || null,
  changeScope: result?.changeScope || null,
  preferredWriteMode: result?.preferredWriteMode || null,
  requiredReadKeys: Array.isArray(result?.nextReadKeys) ? result.nextReadKeys : [],
  requiredReads: Array.isArray(result?.sectionBlueprint?.requiredReads)
    ? result.sectionBlueprint.requiredReads
    : [],
  searchQueries: Array.isArray(result?.searchQueries)
    ? result.searchQueries
    : [],
  relevantHelpers: Array.isArray(result?.sectionBlueprint?.relevantHelpers)
    ? result.sectionBlueprint.relevantHelpers
    : [],
  referenceSignals: result?.sectionBlueprint?.referenceSignals || null,
  implementationContract:
    result?.sectionBlueprint?.implementationContract || null,
  codegenContract,
  themeContext: result?.themeContext || null,
  sectionBlueprint: result?.sectionBlueprint || null,
  architecture:
    result?.architecture && typeof result.architecture === "object"
      ? result.architecture
      : null,
  readTool: immediateStep?.nextTool || null,
  writeTool,
  requiredToolNames: uniqueStrings([immediateStep?.nextTool, writeTool]),
  nextWriteKeys: Array.isArray(result?.nextWriteKeys) ? result.nextWriteKeys : [],
  newFileSuggestions: Array.isArray(result?.newFileSuggestions)
    ? result.newFileSuggestions
    : [],
  diagnosticTargets: Array.isArray(result?.diagnosticTargets)
    ? result.diagnosticTargets
    : [],
});

const getPlanTargetFile = (input = {}, result = {}) =>
  input?.targetFile ||
  result?.nextWriteKeys?.[0] ||
  result?.newFileSuggestions?.[0] ||
  result?.nextReadKeys?.[0] ||
  null;

const buildPlanDoNotUse = ({ changeScope, writeTool, intent } = {}) => {
  if (changeScope === "net_new_generation") {
    return uniqueStrings([
      "patch-theme-file",
      "apply-theme-draft",
      ...(writeTool === "create-theme-section" ? ["draft-theme-artifact"] : []),
    ]);
  }
  if (changeScope === "bounded_rewrite" || changeScope === "multi_file_structural_edit") {
    return uniqueStrings([
      "patch-theme-file",
      ...(intent !== "new_section" ? ["create-theme-section"] : []),
      "apply-theme-draft",
    ]);
  }
  if (changeScope === "micro_patch") {
    return uniqueStrings(["create-theme-section", "apply-theme-draft"]);
  }
  return uniqueStrings(["apply-theme-draft"]);
};

const buildPlanWritePolicy = ({ input = {}, result = {}, writeTool = null } = {}) => {
  const changeScope = result?.changeScope || null;
  const doNotUse = buildPlanDoNotUse({
    changeScope,
    writeTool,
    intent: input?.intent,
  });
  const allowedTools =
    changeScope === "net_new_generation"
      ? ["create-theme-section"]
      : changeScope === "micro_patch"
        ? ["patch-theme-file", "draft-theme-artifact"]
        : ["draft-theme-artifact"];

  return {
    preferredTool: writeTool || result?.shouldUse || null,
    allowedTools,
    doNotUse,
    writeMode: result?.preferredWriteMode || null,
    requiresFullFileValue:
      result?.preferredWriteMode === "value" ||
      changeScope === "bounded_rewrite",
    requiresPriorRead: Array.isArray(result?.nextReadKeys) && result.nextReadKeys.length > 0,
    patchThemeFileAllowed: changeScope === "micro_patch",
    reason: changeScope || result?.recommendedFlow || null,
  };
};

const buildPlanRequiredReads = (result = {}) => {
  const blueprintReads = Array.isArray(result?.sectionBlueprint?.requiredReads)
    ? result.sectionBlueprint.requiredReads
    : [];
  const byKey = new Map();
  for (const read of blueprintReads) {
    const key = String(read?.key || "").trim();
    if (!key) {
      continue;
    }
    byKey.set(key, {
      key,
      reason: String(read?.reason || "planner required context read"),
      includeContent: true,
    });
  }
  for (const key of Array.isArray(result?.nextReadKeys) ? result.nextReadKeys : []) {
    const normalized = String(key || "").trim();
    if (!normalized || byKey.has(normalized)) {
      continue;
    }
    byKey.set(normalized, {
      key: normalized,
      reason: "required before write",
      includeContent: true,
    });
  }
  return Array.from(byKey.values());
};

const resolveScaleConstraintProfile = ({ result = {}, codegenContract = null } = {}) => {
  const scaleProfile =
    codegenContract?.scaleProfile ||
    result?.generationRecipe?.scaleProfile ||
    result?.sectionBlueprint?.generationRecipe?.scaleProfile ||
    null;
  const referenceSignals = result?.sectionBlueprint?.referenceSignals || null;
  const layoutContract = result?.sectionBlueprint?.layoutContract || null;
  const fullBleedAllowed =
    scaleProfile?.allowOversizedScale === true ||
    layoutContract?.outerShell === "full_bleed" ||
    layoutContract?.avoidOuterContainer === true ||
    referenceSignals?.heroShellFamily === "media_first_unboxed";
  const profile = fullBleedAllowed
    ? "full_bleed"
    : result?.qualityTarget === "exact_match" ||
        result?.sectionBlueprint?.qualityTarget === "exact_match"
      ? "reference_replica"
      : "theme_default";

  return { scaleProfile, profile };
};

const buildPlanConstraints = ({ result = {}, codegenContract = null } = {}) => {
  const { scaleProfile, profile } = resolveScaleConstraintProfile({
    result,
    codegenContract,
  });
  return {
    schema: {
      exactlyOneSchemaBlock: true,
      presetRequired: true,
      uniqueSettingIds: true,
      labelsRequiredForEditableSettings: true,
      rangeDefaultsMustFitBoundsAndStep: true,
      preferSelectForSmallDiscreteRanges: true,
    },
    liquid: {
      blockShopifyAttributesInLoop: true,
      blankSafeMediaGuards: true,
      shopifyImagesUseImageUrlImageTag: true,
      noLiquidInsideStylesheetOrJavascriptTags: true,
    },
    css: {
      scopeToSectionRoot: true,
      liquidDependentCssUsesStyleTag: true,
      boundedShellMarker: "data-section-bounded-shell",
    },
    js: {
      scopeInteractiveSelectorsToSection: true,
      themeEditorLifecycleForScriptedInteractions: true,
    },
    media: {
      merchantUploadedVideoSettingType: "video",
      externalVideoSettingType: "video_url",
      imageSettingType: "image_picker",
    },
    architecture: codegenContract?.architecture || null,
    scale: {
      profile,
      ...(scaleProfile?.contentMaxWidthDefault
        ? { contentWidthDefaultMax: scaleProfile.contentMaxWidthDefault }
        : {}),
      ...(scaleProfile?.contentMaxWidthMax
        ? { contentWidthSettingMax: scaleProfile.contentMaxWidthMax }
        : {}),
      ...(scaleProfile?.gridGapMaxPx ? { gridGapMax: scaleProfile.gridGapMaxPx } : {}),
      ...(scaleProfile?.cardMinHeightMax
        ? { cardHeightMax: scaleProfile.cardMinHeightMax }
        : {}),
      ...(scaleProfile?.mobileCardMinHeightMax
        ? { mobileCardHeightMax: scaleProfile.mobileCardMinHeightMax }
        : {}),
      ...(scaleProfile?.cardPaddingMaxPx
        ? { cardPaddingMax: scaleProfile.cardPaddingMaxPx }
        : {}),
      allowOversizedScale: scaleProfile?.allowOversizedScale === true,
      themeSource: scaleProfile?.themeSource || null,
    },
  };
};

const buildPlanReadContext = ({ context = {}, input = {}, result = {} } = {}) => {
  const keys = uniqueStrings([
    getPlanTargetFile(input, result),
    ...(Array.isArray(result?.nextReadKeys) ? result.nextReadKeys : []),
  ]);
  const files = keys.map((key) => {
    const recentRead = getRecentThemeRead(context, {
      key,
      themeId: input?.themeId,
      themeRole: input?.themeRole,
      requireContent: true,
    });
    return {
      key,
      currentReadContextValid: Boolean(recentRead?.content),
      checksumMd5: recentRead?.checksumMd5 || null,
      contentLength: recentRead?.contentLength ?? null,
    };
  });
  return {
    currentReadContextValid:
      files.length > 0 && files.every((file) => file.currentReadContextValid),
    knownChecksumMd5:
      files.length === 1 && files[0]?.checksumMd5 ? files[0].checksumMd5 : null,
    files,
  };
};

const buildPlanGoldenPath = ({
  immediateStep = {},
  writeTool = null,
  writeArgsTemplate = null,
} = {}) => {
  const steps = [];
  if (immediateStep?.nextTool) {
    steps.push({
      tool: immediateStep.nextTool,
      ...(immediateStep.nextArgsTemplate
        ? { args: immediateStep.nextArgsTemplate }
        : {}),
    });
  }
  if (writeTool && writeTool !== immediateStep?.nextTool) {
    steps.push({
      tool: writeTool,
      ...(writeArgsTemplate ? { argsShape: writeArgsTemplate } : {}),
    });
  }
  return steps;
};

const buildPlanSafetyWarnings = ({ result = {}, input = {} } = {}) => {
  const warnings = [];
  const role = String(result?.theme?.role || input?.themeRole || "").toLowerCase();
  if (role === "main") {
    warnings.push({
      code: "LIVE_THEME",
      message: "Writes target the live theme.",
    });
  }
  return warnings;
};

const mergePlanWarningStrings = (resultWarnings = [], safetyWarnings = []) =>
  uniqueStrings([
    ...(Array.isArray(resultWarnings) ? resultWarnings : []),
    ...safetyWarnings.map((warning) => warning.message),
  ]);

const buildCompactPlanResponse = ({
  input = {},
  result = {},
  immediateStep = {},
  writeTool = null,
  writeArgsTemplate = null,
  requiredToolNames = [],
  codegenContract = null,
  normalizedArgs = {},
  stickyTarget = null,
  context = {},
} = {}) => {
  const targetFile = getPlanTargetFile(input, result);
  const safetyWarnings = buildPlanSafetyWarnings({ result, input });
  const writePolicy = buildPlanWritePolicy({ input, result, writeTool });
  const flowArchitecture =
    input?.intent === "native_block" && result?.architecture
      ? result.architecture
      : codegenContract?.architecture || result?.architecture || null;
  return {
    ok: true,
    success: true,
    flowId: `theme-${Date.now().toString(36)}`,
    normalizedArgs,
    target: {
      themeId:
        result?.theme?.id ??
        (input?.themeId === undefined || input?.themeId === null ? null : Number(input.themeId)),
      themeRole: result?.theme?.role || input?.themeRole || null,
      themeName: result?.theme?.name || null,
      file: targetFile,
    },
    intent: input?.intent || result?.intent || null,
    changeScope: result?.changeScope || null,
    goldenPath: buildPlanGoldenPath({
      immediateStep,
      writeTool,
      writeArgsTemplate,
    }),
    writePolicy,
    doNotUse: writePolicy.doNotUse,
    requiredReads: buildPlanRequiredReads(result),
    constraints: buildPlanConstraints({ result, codegenContract }),
    readContext: buildPlanReadContext({ context, input, result }),
    architecture: flowArchitecture,
    codegenArchitecture: codegenContract?.architecture || null,
    nextAction: immediateStep.nextAction || null,
    nextTool: immediateStep.nextTool || null,
    nextArgsTemplate: immediateStep.nextArgsTemplate || null,
    writeTool: writeTool || null,
    writeArgsTemplate: writeArgsTemplate || null,
    requiredToolNames,
    requiresReadBeforeWrite: Boolean(immediateStep.requiresReadBeforeWrite),
    recommendedFlow: result?.recommendedFlow || null,
    shouldUse: result?.shouldUse || null,
    reason: result?.reason || null,
    candidateFiles: result?.candidateFiles || [],
    nextReadKeys: result?.nextReadKeys || [],
    nextWriteKeys: result?.nextWriteKeys || [],
    newFileSuggestions: result?.newFileSuggestions || [],
    searchQueries: result?.searchQueries || [],
    warnings: mergePlanWarningStrings(result?.warnings, safetyWarnings),
    safetyWarnings,
    ...(stickyTarget ? { stickyTarget } : {}),
  };
};

const planThemeEditTool = {
  name: "plan-theme-edit",
  title: "Plan Theme Edit",
  description:
    "Start hier als je eerst wilt weten welke theme files gelezen of geschreven moeten worden. Geef intent plus themeId of themeRole='main' mee. De standaardoutput is compact en machine-actionable: target, goldenPath, writePolicy, doNotUse, requiredReads, constraints, readContext, architecture, nextTool en writeTool. Gebruik includeContracts=true of verbosity='debug' wanneer een stateless client de volledige plannerHandoff, sectionBlueprint en codegenContract.promptBlock moet doorgeven aan latere write-tools.",
  docsDescription:
    "Plan een theme edit voordat je bestanden leest of schrijft. Geef bij voorkeur een expliciete intent mee (`existing_edit`, `native_block`, `new_section` of `template_placement`) plus een expliciet `themeId` of `themeRole='main'`; gebruik themeId voor development/unpublished/demo themes. De standaardoutput is compact: `target`, `goldenPath`, `writePolicy`, `doNotUse`, `requiredReads`, `constraints`, `readContext`, `architecture`, `nextTool`, `nextArgsTemplate`, `writeTool` en `writeArgsTemplate`. Zwaardere velden zoals `plannerHandoff`, `sectionBlueprint`, `codegenContract` en `codegenContract.promptBlock` zijn opt-in via `includeContracts=true` of `verbosity='debug'`. Voor native blocks blijft `architecture` de native renderer-architectuur; section-codegen architectuur staat apart onder `codegenArchitecture` en `constraints.architecture`. Gebruik `goldenPath` en `writePolicy.doNotUse` als bron van waarheid voor toolrouting: micro-patches mogen `patch-theme-file`, bounded rewrites gaan naar `draft-theme-artifact`, en net-new sections gebruiken `create-theme-section` als eerste write-tool.",
  inputSchema: PlanThemeEditPublicObjectSchema,
  schema: PlanThemeEditInputSchema,
  execute: async (rawInput, context = {}) => {
    const normalizedParse = NormalizedPlanThemeEditInputSchema.safeParse(rawInput);
    if (!normalizedParse.success) {
      const normalizedArgs = summarizeNormalizedPlanInput(
        normalizePlanThemeEditInput(rawInput)
      );
      return buildPlanRepairResponse({
        message:
          "De planner kon deze compat-input niet veilig normaliseren. Corrigeer de conflicterende velden en probeer opnieuw.",
        errorCode: "invalid_plan_theme_edit_input",
        nextAction: "fix_input",
        nextTool: "plan-theme-edit",
        normalizedArgs,
        errors: normalizedParse.error.issues.map((issue) =>
          buildPlanInputError({
            path: issue.path,
            problem: issue.message,
            fixSuggestion:
              issue.path.join(".") === "themeId"
                ? "Stuur alleen themeId of alleen themeRole mee."
                : "Corrigeer dit invoerveld en probeer dezelfde toolcall opnieuw.",
          })
        ),
      });
    }

    const { input, stickyTarget } = applyStickyPlanContext(
      normalizedParse.data,
      rawInput,
      context
    );
    const normalizedArgs = summarizeNormalizedPlanInput(input);
    const errors = [];

    if (!input.themeId && !input.themeRole) {
      errors.push(
        buildPlanInputError({
          path: ["themeRole"],
          problem:
            "Geef themeId of themeRole op. Deze planner default niet stilzwijgend naar een theme.",
          fixSuggestion:
            "Voeg een expliciet theme target toe, bijvoorbeeld themeRole='main' of themeId=123456789.",
        })
      );
    }

    if (!input.intent) {
      errors.push(
        buildPlanInputError({
          path: ["intent"],
          problem:
            "De planner kon geen veilige intent afleiden uit deze input.",
          fixSuggestion:
            "Geef intent expliciet mee als existing_edit, native_block, new_section of template_placement.",
        })
      );
    }

    if (errors.length > 0) {
      const missingThemeTarget = errors.some(
        (entry) => entry.path.join(".") === "themeRole"
      );
      const missingIntent = errors.some(
        (entry) => entry.path.join(".") === "intent"
      );

      return buildPlanRepairResponse({
        message:
          missingThemeTarget && missingIntent
            ? "De planner mist zowel een expliciet theme target als een veilige intent."
            : missingThemeTarget
              ? "De planner mist een expliciet theme target."
              : "De planner mist een veilige intent.",
        errorCode:
          missingThemeTarget && missingIntent
            ? "missing_plan_theme_target_and_intent"
            : missingThemeTarget
              ? "missing_plan_theme_target"
              : "missing_plan_intent",
        nextAction:
          missingThemeTarget && missingIntent
            ? "provide_theme_target_and_intent"
            : missingThemeTarget
              ? "provide_theme_target"
              : "provide_intent",
        nextTool: "plan-theme-edit",
        normalizedArgs,
        errors,
      });
    }

    const shopifyClient = requireShopifyClient(context);
    const result = await planThemeEdit(shopifyClient, API_VERSION, input);
    const writeTool = typeof result?.shouldUse === "string" ? result.shouldUse : undefined;
    const writeArgsTemplate = buildPlanWriteArgsTemplate(input, result);
    const immediateStep = buildPlanImmediateNextStep(input, result);
    const codegenContract = buildCodegenContract({
      intent: input.intent,
      mode: writeArgsTemplate?.mode || (writeTool === "create-theme-section" ? "create" : null),
      targetFile:
        input.targetFile ||
        result?.nextWriteKeys?.[0] ||
        result?.newFileSuggestions?.[0] ||
        null,
      themeTarget: {
        themeId:
          input.themeId === undefined || input.themeId === null
            ? null
            : Number(input.themeId),
        themeRole: String(input.themeRole || "").trim() || null,
      },
      plannerResult: result,
      requestText: extractPlannerBrief(rawInput, input),
    });
    const plannerHandoff = buildPlannerHandoff({
      brief: extractPlannerBrief(rawInput, input),
      input,
      result,
      immediateStep,
      writeTool,
      codegenContract,
    });
    const requiredToolNames = uniqueStrings([
      immediateStep.nextTool,
      writeTool,
    ]);
    rememberThemePlan(context, {
      themeId: input.themeId,
      themeRole: input.themeRole,
      intent: input.intent,
      template: input.template,
      query: input.query,
      analysisText: input.analysisText,
      targetFile: input.targetFile,
      nextReadKeys: result?.nextReadKeys || [],
      nextWriteKeys: result?.nextWriteKeys || [],
      immediateNextTool: immediateStep.nextTool || null,
      writeTool,
      themeContext: result?.themeContext || null,
      sectionBlueprint: result?.sectionBlueprint || null,
      plannerHandoff,
    });
    const compactResponse = buildCompactPlanResponse({
      input,
      result,
      immediateStep,
      writeTool,
      writeArgsTemplate,
      requiredToolNames,
      codegenContract,
      normalizedArgs,
      stickyTarget,
      context,
    });
    const includeContracts =
      input.includeContracts === true || input.verbosity === "debug";

    if (!includeContracts) {
      return compactResponse;
    }

    return {
      ...compactResponse,
      verbosity: input.verbosity,
      plannerHandoff,
      codegenContract,
      ...(result?.sectionBlueprint?.generationRecipe
        ? { generationRecipe: result.sectionBlueprint.generationRecipe }
        : {}),
      ...(result?.sectionBlueprint?.implementationContract
        ? { implementationContract: result.sectionBlueprint.implementationContract }
        : {}),
      ...(Array.isArray(result?.diagnosticTargets) &&
      result.diagnosticTargets.length > 0
        ? { diagnosticTargets: result.diagnosticTargets }
        : {}),
      ...result,
      warnings: compactResponse.warnings,
      safetyWarnings: compactResponse.safetyWarnings,
      goldenPath: compactResponse.goldenPath,
      writePolicy: compactResponse.writePolicy,
      doNotUse: compactResponse.doNotUse,
      constraints: compactResponse.constraints,
      readContext: compactResponse.readContext,
      architecture: compactResponse.architecture,
      codegenArchitecture: compactResponse.codegenArchitecture,
    };
  },
};

export {
  NormalizedPlanThemeEditInputSchema,
  PlanThemeEditInputSchema,
  planThemeEditTool,
};
