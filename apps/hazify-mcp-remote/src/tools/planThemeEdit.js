import { z } from "zod";
import { requireShopifyClient } from "./_context.js";
import { planThemeEdit } from "../lib/themePlanning.js";
import {
  extractThemeToolSummary,
  inferIntentFromSummary,
  inferSectionTypeHint,
  inferSingleThemeFile,
  inferTemplateFromSummary,
  inferThemeTargetFromSummary,
} from "./_themeToolCompatibility.js";
import {
  getThemeEditMemory,
  rememberThemePlan,
} from "../lib/themeEditMemory.js";

const API_VERSION = process.env.SHOPIFY_API_VERSION || "2026-01";
const ThemeRoleSchema = z.enum(["main", "unpublished", "demo", "development"]);
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

const compactPlanQuery = (value) =>
  typeof value === "string" && value.trim()
    ? value.trim().slice(0, PLAN_QUERY_INTERNAL_MAX_LENGTH)
    : undefined;

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
    themeRole: ThemeRoleSchema
      .optional()
      .describe("Theme role when themeId is omitted. Geef altijd expliciet hetzelfde target mee als in je uiteindelijke write-flow."),
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
    targetFile: z
      .string()
      .min(1)
      .optional()
      .describe("Exact bestaand bestand wanneer je al weet welk file gepatcht moet worden."),
    sectionTypeHint: z
      .string()
      .max(120)
      .optional()
      .describe("Optionele hint voor de section type/handle, bijvoorbeeld main-product."),
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
    targetFile: z.string().min(1).optional(),
    sectionTypeHint: z.string().max(120).optional(),
    snippetLimit: z.number().int().min(1).max(5).default(3),
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
    themeId: rawInput.themeId,
    themeRole: rawInput.themeRole,
    template: rawInput.template,
    query: compactPlanQuery(rawInput.query),
    targetFile: rawInput.targetFile,
    sectionTypeHint: rawInput.sectionTypeHint,
    snippetLimit: rawInput.snippetLimit,
  };
  const descriptionAlias =
    compactPlanQuery(rawInput.description) || "";

  if (!normalized.intent) {
    for (const candidate of [rawInput.intent_type, rawInput.intentType, rawInput.type]) {
      if (typeof candidate === "string" && PLAN_INTENT_VALUES.includes(candidate)) {
        normalized.intent = candidate;
        break;
      }
    }
  }

  if (!normalized.query && descriptionAlias) {
    normalized.query = descriptionAlias;
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
  targetFile: input.targetFile || null,
  sectionTypeHint: input.sectionTypeHint || null,
  snippetLimit: input.snippetLimit ?? 3,
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

const looksLikeStickySectionFollowUp = (text, memoryState) => {
  const normalized = String(text || "").trim();
  if (!normalized || !memoryState?.lastCreatedSectionFile) {
    return false;
  }
  if (inferSingleThemeFile(normalized)) {
    return false;
  }
  const handle = String(memoryState.lastCreatedSectionHandle || "").trim();
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

  const stickyTargetFile = memoryState.lastCreatedSectionFile || memoryState.lastTargetFile;
  if (!stickyTargetFile) {
    return { input, stickyTarget: null };
  }

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
      source: "last_created_section",
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

const buildPlanWriteArgsTemplate = (input = {}, result = {}) => {
  const explicitThemeTarget = buildExplicitThemeTarget(input);

  if (result?.shouldUse === "create-theme-section") {
    return {
      ...explicitThemeTarget,
      key: result?.newFileSuggestions?.[0] || "sections/<new-section>.liquid",
      liquid: "<complete Shopify Liquid section with valid {% schema %}>",
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
    return {
      ...explicitThemeTarget,
      mode:
        result?.recommendedFlow === "template-placement" ||
        result?.recommendedFlow === "multi-file-edit"
          ? "edit"
          : "create",
      files: [
        {
          key:
            result?.nextWriteKeys?.[0] ||
            result?.newFileSuggestions?.[0] ||
            "<theme-file>",
          value: "<complete file content or use patch/patches for edits>",
        },
      ],
    };
  }

  return undefined;
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

const planThemeEditTool = {
  name: "plan-theme-edit",
  title: "Plan Theme Edit",
  description:
    "Start hier als je eerst wilt weten welke theme files gelezen of geschreven moeten worden. Gebruik plan-theme-edit voor native blocks, placement-vragen en andere theme-aware flows. Geef bij voorkeur intent plus themeId of themeRole mee. De planner retourneert nu de directe volgende stap: eerst lezen als nextReadKeys nodig zijn, pas daarna schrijven. Voor follow-up prompts op een net gemaakte section kan dezelfde target sticky blijven zolang de gebruiker niet expliciet van bestand wisselt.",
  docsDescription:
    "Plan een theme edit voordat je bestanden leest of schrijft. Geef bij voorkeur een expliciete intent mee (`existing_edit`, `native_block`, `new_section` of `template_placement`) plus een expliciet `themeId` of `themeRole`. Gebruik dit eerst voor native product-blocks, blocks in bestaande sections, template placement of wanneer je tokenzuinig exact wilt weten welke files je moet lezen. De output geeft een compacte theme-aware strategie terug: `patch-existing`, `multi-file-edit`, `create-section` of `template-placement`, plus de exacte volgende read/write keys. `nextTool` en `nextArgsTemplate` beschrijven nu de onmiddellijke volgende stap: meestal eerst `get-theme-file` of `get-theme-files` voor verplichte contextreads, en pas daarna de uiteindelijke write-tool via `writeTool` en `writeArgsTemplate`. Langere `query`- of `description`-prompts zijn toegestaan; de planner compacteert die intern naar een korte query voor tokenzuinige planning. Voor native product-blocks analyseert de planner `templates/*.json` al zelf; reread dat template daarna alleen als placement expliciet gevraagd is. Compatibele clients mogen ook `_tool_input_summary`, `description`, `type`, `intentType`, `intent_type` en `targetFiles` meesturen. Vrije summary-tekst mag alleen veilige inferentie doen voor intent, theme target, template en exact één bestaand `targetFile`. Wanneer in dezelfde flow net een section is aangemaakt, kunnen vervolgprompts zoals 'optimaliseer hem' of 'maak V2' automatisch blijven wijzen naar datzelfde created target. Voor nieuwe sections retourneert de planner nu naast `themeContext` ook een `sectionBlueprint` met category, required reads, relevante helpers, risky inherited classes, safe unit strategy, forbidden patterns, preflight checks en write-strategy hints.",
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
    rememberThemePlan(context, {
      themeId: input.themeId,
      themeRole: input.themeRole,
      intent: input.intent,
      template: input.template,
      targetFile: input.targetFile,
      nextReadKeys: result?.nextReadKeys || [],
      nextWriteKeys: result?.nextWriteKeys || [],
      immediateNextTool: immediateStep.nextTool || null,
      writeTool,
    });
    return {
      success: true,
      normalizedArgs,
      ...(immediateStep.nextAction ? { nextAction: immediateStep.nextAction } : {}),
      ...(immediateStep.nextTool ? { nextTool: immediateStep.nextTool } : {}),
      ...(immediateStep.nextArgsTemplate
        ? { nextArgsTemplate: immediateStep.nextArgsTemplate }
        : {}),
      ...(writeTool ? { writeTool } : {}),
      ...(writeArgsTemplate ? { writeArgsTemplate } : {}),
      ...(typeof immediateStep.requiresReadBeforeWrite === "boolean"
        ? { requiresReadBeforeWrite: immediateStep.requiresReadBeforeWrite }
        : {}),
      ...(stickyTarget ? { stickyTarget } : {}),
      ...result,
    };
  },
};

export {
  NormalizedPlanThemeEditInputSchema,
  PlanThemeEditInputSchema,
  planThemeEditTool,
};
