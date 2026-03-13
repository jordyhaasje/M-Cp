import { z } from "zod";
import { listThemes } from "../lib/themeFiles.js";

const API_VERSION = process.env.SHOPIFY_API_VERSION || "2026-01";
const ThemeRoleSchema = z.enum(["main", "unpublished", "demo", "development"]);

const GetThemesInputSchema = z.object({
  role: ThemeRoleSchema.optional().describe("Optional filter by Shopify theme role"),
  limit: z.number().int().positive().max(250).default(100),
});


const getThemes = {
  name: "get-themes",
  description: "List available Shopify themes (including the live theme).",
  schema: GetThemesInputSchema,
  execute: async (input, context = {}) => {
        const shopifyClient = context?.shopifyClient;
        if (!shopifyClient) {
            throw new Error("Missing Shopify client in execution context");
        }
    try {
      const roleFilter = input.role ? String(input.role).toLowerCase() : null;
      const themes = await listThemes(shopifyClient, API_VERSION);
      const filtered = roleFilter
        ? themes.filter((theme) => String(theme?.role || "").toLowerCase() === roleFilter)
        : themes;

      return {
        themes: filtered.slice(0, input.limit).map((theme) => ({
          id: theme.id,
          name: theme.name,
          role: theme.role,
          previewable: theme.previewable,
          processing: theme.processing,
          createdAt: theme.created_at || null,
          updatedAt: theme.updated_at || null,
        })),
      };
    } catch (error) {
      console.error("Error listing themes:", error);
      throw new Error(`Failed to list themes: ${error instanceof Error ? error.message : String(error)}`);
    }
  },
};

export { getThemes };
