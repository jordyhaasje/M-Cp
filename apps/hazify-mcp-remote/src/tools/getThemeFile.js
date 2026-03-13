import { z } from "zod";
import { getThemeFile } from "../lib/themeFiles.js";

const API_VERSION = process.env.SHOPIFY_API_VERSION || "2026-01";
const ThemeRoleSchema = z.enum(["main", "unpublished", "demo", "development"]);

const GetThemeFileInputSchema = z.object({
  themeId: z.coerce.number().int().positive().optional().describe("Optional explicit Shopify theme ID"),
  themeRole: ThemeRoleSchema.default("main").describe("Theme role fallback when themeId is omitted"),
  key: z.string().min(1).describe("Theme file key, e.g. sections/hero.liquid"),
  includeContent: z.boolean().default(true).describe("Include file content (value/attachment) in response"),
});


const getThemeFileTool = {
  name: "get-theme-file",
  description: "Read a file from a Shopify theme (defaults to live theme role=main).",
  schema: GetThemeFileInputSchema,
  execute: async (input, context = {}) => {
        const shopifyClient = context?.shopifyClient;
        if (!shopifyClient) {
            throw new Error("Missing Shopify client in execution context");
        }
    try {
      const result = await getThemeFile(shopifyClient, API_VERSION, {
        themeId: input.themeId,
        themeRole: input.themeRole,
        key: input.key,
      });

      const asset = { ...result.asset };
      if (!input.includeContent) {
        delete asset.value;
        delete asset.attachment;
      }

      return {
        theme: {
          id: result.theme.id,
          name: result.theme.name,
          role: result.theme.role,
        },
        asset,
      };
    } catch (error) {
      console.error("Error reading theme file:", error);
      throw new Error(`Failed to read theme file: ${error instanceof Error ? error.message : String(error)}`);
    }
  },
};

export { getThemeFileTool };
