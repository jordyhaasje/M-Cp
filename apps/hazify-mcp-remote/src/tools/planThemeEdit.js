import { z } from "zod";
import { requireShopifyClient } from "./_context.js";
import { planThemeEdit } from "../lib/themePlanning.js";

const API_VERSION = process.env.SHOPIFY_API_VERSION || "2026-01";
const ThemeRoleSchema = z.enum(["main", "unpublished", "demo", "development"]);
const IntentSchema = z.enum([
  "existing_edit",
  "native_block",
  "new_section",
  "template_placement",
]);
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

const PlanThemeEditInputSchema = z
  .object({
    themeId: z
      .coerce.number()
      .int()
      .positive()
      .optional()
      .describe("Optional explicit Shopify theme ID."),
    themeRole: ThemeRoleSchema
      .optional()
      .describe("Theme role when themeId is omitted. Geef altijd expliciet hetzelfde target mee als in je uiteindelijke write-flow."),
    intent: IntentSchema.describe(
      "existing_edit = bestaand bestand patchen, native_block = block in bestaande section/productflow, new_section = nieuwe section maken, template_placement = bestaande section/template placement analyseren."
    ),
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

const planThemeEditTool = {
  name: "plan-theme-edit",
  description:
    "Plan een theme edit voordat je bestanden leest of schrijft. Gebruik dit eerst voor native product-blocks, blocks in bestaande sections, template placement of wanneer je tokenzuinig exact wilt weten welke files je moet lezen. De output geeft een compacte theme-aware strategie terug: patch-existing, multi-file-edit, create-section of template-placement, plus de exacte volgende read/write keys.",
  schema: PlanThemeEditInputSchema,
  execute: async (input, context = {}) => {
    const shopifyClient = requireShopifyClient(context);
    return planThemeEdit(shopifyClient, API_VERSION, input);
  },
};

export { PlanThemeEditInputSchema, planThemeEditTool };
