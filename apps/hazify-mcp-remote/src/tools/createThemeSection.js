import { z } from "zod";
import { requireShopifyClient } from "./_context.js";
import { createThemeSection } from "../lib/themeSectionCreation.js";

const API_VERSION = process.env.SHOPIFY_API_VERSION || "2026-01";
const ThemeRoleSchema = z.enum(["main", "unpublished", "demo", "development"]);
const PlacementSchema = z.enum(["append", "prepend", "before", "after"]);

const ThemeWriteFileSchema = z
  .object({
    key: z.string().min(1).describe("Theme file key, e.g. snippets/faq-item.liquid or assets/faq.css"),
    value: z.string().optional().describe("De letterlijke bestandsinhoud (tekst/broncode) voor Liquid, JSON, CSS, JS etc. (CRITICAL: Store the source code in this 'value' field. DO NOT use a field named 'content')"),
    content: z.string().optional().describe("DO NOT USE THIS FIELD. LLMs hallucinate this. Use 'value' instead."),
    attachment: z.string().optional().describe("Base64 geëncodeerde string, ALLEEN voor binaire bestanden (zoals afbeeldingen/fonts). NOOIT gebruiken voor tekst/code."),
    checksum: z.string().optional().describe("Optional checksum precondition"),
  })
  .superRefine((file, ctx) => {
    if (typeof file.content === "string" && typeof file.value !== "string") {
      file.value = file.content;
      delete file.content;
    }
    const hasValue = typeof file.value === "string";
    const hasAttachment = typeof file.attachment === "string";
    if (hasValue === hasAttachment) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["value"],
        message: "Provide exactly one of 'value' or 'attachment'. (CRITICAL: You MUST use 'value' for source code, not 'content'!)",
      });
    }
  });

const CreateThemeSectionInputSchema = z
  .object({
    themeId: z.coerce.number().int().positive().optional().describe("Optional explicit Shopify theme ID"),
    themeRole: ThemeRoleSchema.default("main").describe("Theme role fallback when themeId is omitted"),
    auditReason: z.string().min(5).describe("VERPLICHT: Een duidelijke en gedetailleerde reden waarom je deze file aanpast of aanmaakt. Zonder dit veld faalt de actie gegarandeerd."),
    targetFile: z
      .string()
      .min(1)
      .optional()
      .describe("Required JSON section group target, e.g. sections/header-group.json. NOTE: templates/ targets are strictly forbidden."),
    name: z.string().min(1).describe("Human-readable section name"),
    handle: z
      .string()
      .min(1)
      .optional()
      .describe("Optional section handle; defaults to a slug of name and writes sections/<handle>.liquid"),
    sectionLiquid: z.string().optional().describe("Full Liquid source for the new section file (CRITICAL: Use 'sectionLiquid', do NOT use 'content')."),
    content: z.string().optional().describe("DO NOT USE THIS FIELD. LLMs hallucinate this here as well. Use 'sectionLiquid' instead."),
    additionalFiles: z.array(ThemeWriteFileSchema).max(40).optional().describe("Optional supporting theme files to write in the same batch"),
    placement: PlacementSchema.default("append").describe("Where to place the new section instance in the target JSON order"),
    anchorSectionId: z.string().min(1).optional().describe("Required for placement 'before' or 'after'"),
    templateSectionData: z
      .record(z.string(), z.unknown())
      .optional()
      .describe("Optional JSON payload to store under target.sections[sectionInstanceId]"),
    overwriteExistingSectionFile: z.boolean().default(false).describe("Allow overwriting an existing sections/<handle>.liquid file"),
    verifyAfterWrite: z.boolean().default(true).describe("Verify written files directly after write"),
    confirmation: z.literal("CREATE_THEME_SECTION").describe("Verplicht type: 'CREATE_THEME_SECTION' ter bevestiging"),
  })
  .superRefine((input, ctx) => {
    if (typeof input.content === "string" && typeof input.sectionLiquid !== "string") {
      input.sectionLiquid = input.content;
      delete input.content;
    }
    if (typeof input.sectionLiquid !== "string" || input.sectionLiquid.trim() === "") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sectionLiquid"],
        message: "You must provide the full Liquid source in 'sectionLiquid'. (CRITICAL: Do NOT use a field named 'content'!)",
      });
    }

    if ((input.placement === "before" || input.placement === "after") && !input.anchorSectionId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["anchorSectionId"],
        message: "anchorSectionId is required when placement is 'before' or 'after'.",
      });
    }

    if (input.targetFile) {
      const target = input.targetFile.trim();
      if (target.endsWith('.json') && (target.startsWith('templates/') || target.startsWith('config/'))) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["targetFile"],
          message: "Modifying JSON templates directly is strictly forbidden to prevent layout destruction. The section files (.liquid/.css/.js) are safely created. STOP modifying files now and instruct the user to manually add the new section via the Shopify Theme Editor.",
        });
      }
    }

    if (input.additionalFiles) {
      input.additionalFiles.forEach((file, index) => {
        const themeFileKey = file.key.trim();
        if (themeFileKey.endsWith('.json') && (themeFileKey.startsWith('templates/') || themeFileKey.startsWith('config/'))) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["additionalFiles", index, "key"],
            message: "Modifying JSON templates directly is strictly forbidden to prevent layout destruction. The section files (.liquid/.css/.js) are safely created. STOP modifying files now and instruct the user to manually add the new section via the Shopify Theme Editor.",
          });
        }
      });
    }
  });

const formatToolError = (error) => {
  if (error?.code) {
    const wrapped = new Error(`${error.code}: ${error.message}`);
    wrapped.code = error.code;
    return wrapped;
  }
  return error instanceof Error ? error : new Error(String(error));
};

const createThemeSectionTool = {
  name: "create-theme-section",
  description:
    "Create a new OS 2.0 section file and place it directly into a supported JSON template or section group without first searching for an existing section.",
  schema: CreateThemeSectionInputSchema,
  execute: async (input, context = {}) => {
    const shopifyClient = requireShopifyClient(context);
    try {
      return await createThemeSection(shopifyClient, API_VERSION, input);
    } catch (error) {
      throw formatToolError(error);
    }
  },
};

export { CreateThemeSectionInputSchema, createThemeSectionTool };

