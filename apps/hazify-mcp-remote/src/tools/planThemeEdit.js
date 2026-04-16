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
  retryMode = "same_request_with_structured_fields",
  warnings = [],
}) => ({
  success: false,
  status,
  message,
  errorCode,
  retryable: true,
  nextAction,
  retryMode,
  normalizedArgs,
  warnings,
  errors,
});

const planThemeEditTool = {
  name: "plan-theme-edit",
  description:
    "Plan een theme edit voordat je bestanden leest of schrijft. Geef bij voorkeur een expliciete intent mee (`existing_edit`, `native_block`, `new_section` of `template_placement`) plus een expliciet themeId of themeRole. Gebruik dit eerst voor native product-blocks, blocks in bestaande sections, template placement of wanneer je tokenzuinig exact wilt weten welke files je moet lezen. De output geeft een compacte theme-aware strategie terug: patch-existing, multi-file-edit, create-section of template-placement, plus de exacte volgende read/write keys. Langere query- of description-prompts zijn toegestaan; de planner compacteert die intern naar een korte query voor tokenzuinige planning. Voor native product-blocks analyseert de planner templates/*.json al zelf; reread dat template daarna alleen als placement expliciet gevraagd is. Compatibele clients mogen ook `_tool_input_summary`, `description`, `type`, `intentType`, `intent_type` en `targetFiles` meesturen. Vrije summary-tekst mag alleen veilige inferentie doen voor intent, theme target, template en exact één bestaand targetFile. Voor nieuwe sections hoort de planner agents ook te sturen richting step-aligned range defaults en select-settings bij kleine discrete keuzes.",
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

    const input = normalizedParse.data;
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
        normalizedArgs,
        errors,
      });
    }

    const shopifyClient = requireShopifyClient(context);
    const result = await planThemeEdit(shopifyClient, API_VERSION, input);
    return {
      success: true,
      normalizedArgs,
      ...result,
    };
  },
};

export {
  NormalizedPlanThemeEditInputSchema,
  PlanThemeEditInputSchema,
  planThemeEditTool,
};
