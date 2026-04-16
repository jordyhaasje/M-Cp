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

const PlanThemeEditShape = z
  .object({
    intent: IntentSchema.describe(
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
      .max(240)
      .optional()
      .describe("Korte taakomschrijving of zichtbare anchor, alleen voor compactere planning en snippet-prioritering."),
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
    snippetLimit: z
      .number()
      .int()
      .min(1)
      .max(5)
      .default(3)
      .describe("Maximaal aantal gerelateerde snippets om compact mee te nemen in de plan-output."),
  })
  .superRefine((input, ctx) => {
    if (!input.themeId && !input.themeRole) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["themeRole"],
        message: "Geef themeId of themeRole op. Deze planner default niet stilzwijgend naar een theme.",
      });
    }

    if (input.themeId && input.themeRole) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["themeId"],
        message: "Gebruik themeId of themeRole, niet allebei tegelijk.",
      });
    }

    if (input.intent !== "existing_edit" && input.targetFile) {
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

  let normalized = { ...rawInput };
  const descriptionAlias =
    typeof rawInput.description === "string" && rawInput.description.trim()
      ? rawInput.description.trim()
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
    normalized.query = descriptionAlias.slice(0, 240);
  }

  if (!normalized.targetFile && Array.isArray(rawInput.targetFiles) && rawInput.targetFiles.length === 1) {
    normalized.targetFile = rawInput.targetFiles[0];
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
    normalized.query = summary.slice(0, 240);
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
  PlanThemeEditShape
);

const planThemeEditTool = {
  name: "plan-theme-edit",
  description:
    "Plan een theme edit voordat je bestanden leest of schrijft. Geef bij voorkeur een expliciete intent mee (`existing_edit`, `native_block`, `new_section` of `template_placement`) plus een expliciet themeId of themeRole. Gebruik dit eerst voor native product-blocks, blocks in bestaande sections, template placement of wanneer je tokenzuinig exact wilt weten welke files je moet lezen. De output geeft een compacte theme-aware strategie terug: patch-existing, multi-file-edit, create-section of template-placement, plus de exacte volgende read/write keys. Voor native product-blocks analyseert de planner templates/*.json al zelf; reread dat template daarna alleen als placement expliciet gevraagd is. Compatibele clients mogen nog een korte `_tool_input_summary` of `description` meesturen, maar die vrije tekst is alleen fallback en vervangt gestructureerde write-inputs niet.",
  schema: PlanThemeEditInputSchema,
  execute: async (input, context = {}) => {
    const shopifyClient = requireShopifyClient(context);
    return planThemeEdit(shopifyClient, API_VERSION, input);
  },
};

export { PlanThemeEditInputSchema, planThemeEditTool };
