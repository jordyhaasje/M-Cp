import { z } from "zod";
import { requireShopifyClient } from "./_context.js";
import { findThemeSectionByName } from "../lib/themePlanning.js";

const API_VERSION = process.env.SHOPIFY_API_VERSION || "2026-01";
const ThemeRoleSchema = z.enum(["main", "unpublished", "demo", "development"]);

const FindThemeSectionByNameInputSchema = z.object({
  query: z.string().min(1).describe("Section name, schema title, preset name, instance id, or type"),
  themeId: z.coerce.number().int().positive().optional().describe("Optional explicit Shopify theme ID"),
  themeRole: ThemeRoleSchema.default("main").describe("Theme role fallback when themeId is omitted"),
  page: z.enum(["homepage"]).optional().describe("Optional page scope. Omit for theme-wide search."),
});

const findThemeSectionByNameTool = {
  name: "find-theme-section-by-name",
  description: "Find exact and fuzzy theme section matches by section name, schema name, preset, or instance id.",
  schema: FindThemeSectionByNameInputSchema,
  execute: async (input, context = {}) => {
    const shopifyClient = requireShopifyClient(context);
    return findThemeSectionByName(shopifyClient, API_VERSION, input);
  },
};

export { FindThemeSectionByNameInputSchema, findThemeSectionByNameTool };
