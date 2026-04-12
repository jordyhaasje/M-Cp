import { z } from "zod";
import { requireShopifyClient } from "./_context.js";
import { getThemeFiles } from "../lib/themeFiles.js";

const API_VERSION = process.env.SHOPIFY_API_VERSION || "2026-01";
const ThemeRoleSchema = z.enum(["main", "unpublished", "demo", "development"]);

const GetThemeFilesInputSchema = z
  .object({
    themeId: z.coerce.number().int().positive().optional().describe("Optional explicit Shopify theme ID"),
    themeRole: ThemeRoleSchema.default("main").describe("Theme role fallback when themeId is omitted"),
    keys: z
      .array(z.string().min(1))
      .min(1)
      .max(10)
      .describe("EXACT, VOLLEDIGE file paths, e.g. ['sections/hero.liquid']. GEEN GLOBBING OF WILDCARDS (*). Gebruik search-theme-files als je een path niet zeker weet (hard limit: 10)."),
    includeContent: z.boolean().default(false).describe("Include file content (value/attachment) in response"),
  })
  .superRefine((input, ctx) => {
    const normalized = input.keys.map((key) => String(key).trim());
    if (new Set(normalized).size !== normalized.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["keys"],
        message: "Duplicate keys are not allowed.",
      });
    }
  });

const getThemeFilesTool = {
  name: "get-theme-files",
  description:
    "Read EXACT files from a Shopify theme. GEEN GLOBBING. Gebruik altijd search-theme-files als je niet 100% zeker bent van de file path. Gebruik dit voor bewuste multi-read workflows zoals ['sections/main-product.liquid', 'snippets/product-info.liquid'] of ['templates/product.json'].",
  schema: GetThemeFilesInputSchema,
  execute: async (input, context = {}) => {
    const shopifyClient = requireShopifyClient(context);
    try {
      const result = await getThemeFiles(shopifyClient, API_VERSION, {
        themeId: input.themeId,
        themeRole: input.themeRole,
        keys: input.keys,
        includeContent: input.includeContent,
      });

      return {
        theme: {
          id: result.theme.id,
          name: result.theme.name,
          role: result.theme.role,
        },
        files: result.files,
      };
    } catch (error) {
      console.error("Error reading theme files:", error);
      throw new Error(`Failed to read theme files: ${error instanceof Error ? error.message : String(error)}`);
    }
  },
};

export { getThemeFilesTool };
