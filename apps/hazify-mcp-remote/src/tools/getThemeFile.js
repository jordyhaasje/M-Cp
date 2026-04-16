import { z } from "zod";
import { requireShopifyClient } from "./_context.js";
import { getThemeFile } from "../lib/themeFiles.js";

const API_VERSION = process.env.SHOPIFY_API_VERSION || "2026-01";
const ThemeRoleSchema = z.enum(["main", "unpublished", "demo", "development"]);

const GetThemeFileInputSchema = z.object({
  themeId: z.coerce.number().int().positive().optional().describe("Optional explicit Shopify theme ID"),
  themeRole: ThemeRoleSchema.optional().describe("Optionele theme role. Geef deze in editflows expliciet mee; alleen voor backwards compatibility valt deze read-tool anders terug op main."),
  key: z.string().min(1).describe("Theme file key, e.g. sections/hero.liquid"),
  includeContent: z.boolean().default(true).describe("Include file content (value/attachment) in response"),
});


const getThemeFileTool = {
  name: "get-theme-file",
  description:
    "Read one exact file from a Shopify theme. Geef in editflows bij voorkeur altijd expliciet themeId of themeRole mee zodat je read-context overeenkomt met plan-theme-edit en je write-call. Alleen voor backwards compatibility valt deze read-tool terug op main als themeId/themeRole ontbreekt; dat levert dan ook een warning op. Lees dit liefst na plan-theme-edit, en alleen de compacte exact keys die de planner voorstelt. Voor native product-block flows hoef je templates/*.json na plan-theme-edit meestal niet opnieuw te lezen tenzij placement van het block expliciet gevraagd is. Handige reads zijn bijvoorbeeld sections/main-product.liquid, snippets/product-info.liquid of templates/product.json.",
  schema: GetThemeFileInputSchema,
  execute: async (input, context = {}) => {
    const shopifyClient = requireShopifyClient(context);
    const usedMainFallback = !input.themeId && !input.themeRole;
    const effectiveThemeRole = input.themeId ? undefined : input.themeRole || "main";
    try {
      const result = await getThemeFile(shopifyClient, API_VERSION, {
        themeId: input.themeId,
        themeRole: effectiveThemeRole,
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
        ...(usedMainFallback
          ? {
              warnings: [
                "⚠️ themeId/themeRole ontbrak; deze read-call viel voor backwards compatibility terug op het LIVE main theme.",
              ],
            }
          : {}),
      };
    } catch (error) {
      console.error("Error reading theme file:", error);
      throw new Error(`Failed to read theme file: ${error instanceof Error ? error.message : String(error)}`);
    }
  },
};

export { getThemeFileTool };
