import { z } from "zod";
import { requireShopifyClient } from "./_context.js";
import { deleteThemeFile } from "../lib/themeFiles.js";

const API_VERSION = process.env.SHOPIFY_API_VERSION || "2026-01";
const ThemeRoleSchema = z.enum(["main", "unpublished", "demo", "development"]);

const DeleteThemeFileInputSchema = z.object({
  themeId: z.coerce.number().int().positive().optional().describe("Optional explicit Shopify theme ID"),
  themeRole: ThemeRoleSchema.optional().describe("Theme role. Verplicht als themeId niet is opgegeven. Vraag de gebruiker welk thema."),
  key: z.string().min(1).describe("Theme file key to delete. Note: layout/theme.liquid cannot be deleted."),
  confirmation: z.literal("DELETE_THEME_FILE").describe("Verplicht type: 'DELETE_THEME_FILE' ter bevestiging"),
  reason: z.string().min(5).describe("Auditable reden"),
});


const deleteThemeFileTool = {
  name: "delete-theme-file",
  description: "Delete a file from a Shopify theme. themeRole of themeId is verplicht — vraag de gebruiker welk thema.",
  schema: DeleteThemeFileInputSchema,
  execute: async (input, context = {}) => {
      const shopifyClient = requireShopifyClient(context);
    if (!input.themeId && !input.themeRole) {
      throw new Error("Geef themeRole of themeId op. Vraag de gebruiker welk thema bedoeld wordt.");
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
