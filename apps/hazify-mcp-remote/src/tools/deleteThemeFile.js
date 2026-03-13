import { z } from "zod";
import { deleteThemeFile } from "../lib/themeFiles.js";

const API_VERSION = process.env.SHOPIFY_API_VERSION || "2026-01";
const ThemeRoleSchema = z.enum(["main", "unpublished", "demo", "development"]);

const DeleteThemeFileInputSchema = z.object({
  themeId: z.coerce.number().int().positive().optional().describe("Optional explicit Shopify theme ID"),
  themeRole: ThemeRoleSchema.default("main").describe("Theme role fallback when themeId is omitted"),
  key: z.string().min(1).describe("Theme file key to delete"),
});


const deleteThemeFileTool = {
  name: "delete-theme-file",
  description: "Delete a file from a Shopify theme (defaults to live theme role=main).",
  schema: DeleteThemeFileInputSchema,
  execute: async (input, context = {}) => {
        const shopifyClient = context?.shopifyClient;
        if (!shopifyClient) {
            throw new Error("Missing Shopify client in execution context");
        }
    try {
      const result = await deleteThemeFile(shopifyClient, API_VERSION, {
        themeId: input.themeId,
        themeRole: input.themeRole,
        key: input.key,
      });

      return {
        action: "deleted",
        theme: {
          id: result.theme.id,
          name: result.theme.name,
          role: result.theme.role,
        },
        deletedKey: result.deletedKey,
      };
    } catch (error) {
      console.error("Error deleting theme file:", error);
      throw new Error(`Failed to delete theme file: ${error instanceof Error ? error.message : String(error)}`);
    }
  },
};

export { deleteThemeFileTool };
