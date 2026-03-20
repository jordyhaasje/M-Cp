import { z } from "zod";
import { requireShopifyClient } from "./_context.js";
import { upsertThemeFile } from "../lib/themeFiles.js";

const API_VERSION = process.env.SHOPIFY_API_VERSION || "2026-01";
const ThemeRoleSchema = z.enum(["main", "unpublished", "demo", "development"]);

const UpsertThemeFileInputSchema = z
  .object({
    themeId: z.coerce.number().int().positive().optional().describe("Optional explicit Shopify theme ID"),
    themeRole: ThemeRoleSchema.default("main").describe("Theme role fallback when themeId is omitted"),
    key: z.string().min(1).describe("Theme file key, e.g. sections/custom-banner.liquid"),
    value: z.string().optional().describe("Text content for Liquid/JSON/CSS/JS assets"),
    attachment: z.string().optional().describe("Base64 content for binary assets"),
    checksum: z.string().optional().describe("Optional checksum for conflict-safe writes"),
  })
  .superRefine((input, ctx) => {
    const hasValue = typeof input.value === "string";
    const hasAttachment = typeof input.attachment === "string";
    if (!hasValue && !hasAttachment) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["value"],
        message: "Provide either 'value' (text) or 'attachment' (base64).",
      });
    }
    if (hasValue && hasAttachment) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["attachment"],
        message: "Use either 'value' or 'attachment', not both.",
      });
    }
  });


const upsertThemeFileTool = {
  name: "upsert-theme-file",
  description:
    "Create or update a single Shopify theme file, including new section/snippet/template/assets files when you already know the exact target key.",
  schema: UpsertThemeFileInputSchema,
  execute: async (input, context = {}) => {
      const shopifyClient = requireShopifyClient(context);
    try {
      const result = await upsertThemeFile(shopifyClient, API_VERSION, {
        themeId: input.themeId,
        themeRole: input.themeRole,
        key: input.key,
        value: input.value,
        attachment: input.attachment,
        checksum: input.checksum,
      });

      return {
        action: "upserted",
        theme: {
          id: result.theme.id,
          name: result.theme.name,
          role: result.theme.role,
        },
        asset: result.asset,
      };
    } catch (error) {
      console.error("Error upserting theme file:", error);
      throw new Error(`Failed to upsert theme file: ${error instanceof Error ? error.message : String(error)}`);
    }
  },
};

export { upsertThemeFileTool };
