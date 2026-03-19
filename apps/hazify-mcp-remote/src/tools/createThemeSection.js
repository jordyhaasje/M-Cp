import { z } from "zod";
import { requireShopifyClient } from "./_context.js";
import { createThemeSection } from "../lib/themeSectionCreation.js";

const API_VERSION = process.env.SHOPIFY_API_VERSION || "2026-01";
const ThemeRoleSchema = z.enum(["main", "unpublished", "demo", "development"]);
const PlacementSchema = z.enum(["append", "prepend", "before", "after"]);

const ThemeWriteFileSchema = z
  .object({
    key: z.string().min(1).describe("Theme file key, e.g. snippets/faq-item.liquid or assets/faq.css"),
    value: z.string().optional().describe("Text content for Liquid/JSON/CSS/JS assets"),
    attachment: z.string().optional().describe("Base64 payload for binary assets"),
    checksum: z.string().optional().describe("Optional checksum precondition"),
  })
  .superRefine((file, ctx) => {
    const hasValue = typeof file.value === "string";
    const hasAttachment = typeof file.attachment === "string";
    if (hasValue === hasAttachment) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["value"],
        message: "Provide exactly one of 'value' or 'attachment'.",
      });
    }
  });

const CreateThemeSectionInputSchema = z
  .object({
    themeId: z.coerce.number().int().positive().optional().describe("Optional explicit Shopify theme ID"),
    themeRole: ThemeRoleSchema.default("main").describe("Theme role fallback when themeId is omitted"),
    targetFile: z
      .string()
      .min(1)
      .optional()
      .describe("Required JSON template/group target, e.g. templates/index.json or sections/header-group.json"),
    name: z.string().min(1).describe("Human-readable section name"),
    handle: z
      .string()
      .min(1)
      .optional()
      .describe("Optional section handle; defaults to a slug of name and writes sections/<handle>.liquid"),
    sectionLiquid: z.string().min(1).describe("Full Liquid source for the new section file"),
    additionalFiles: z.array(ThemeWriteFileSchema).max(40).optional().describe("Optional supporting theme files to write in the same batch"),
    placement: PlacementSchema.default("append").describe("Where to place the new section instance in the target JSON order"),
    anchorSectionId: z.string().min(1).optional().describe("Required for placement 'before' or 'after'"),
    templateSectionData: z
      .record(z.string(), z.unknown())
      .optional()
      .describe("Optional JSON payload to store under target.sections[sectionInstanceId]"),
    overwriteExistingSectionFile: z.boolean().default(false).describe("Allow overwriting an existing sections/<handle>.liquid file"),
    verifyAfterWrite: z.boolean().default(true).describe("Verify written files directly after write"),
  })
  .superRefine((input, ctx) => {
    if ((input.placement === "before" || input.placement === "after") && !input.anchorSectionId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["anchorSectionId"],
        message: "anchorSectionId is required when placement is 'before' or 'after'.",
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

