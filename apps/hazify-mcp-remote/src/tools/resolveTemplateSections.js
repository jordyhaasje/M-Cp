import { z } from "zod";
import { requireShopifyClient } from "./_context.js";
import { resolveTemplateSections } from "../lib/themePlanning.js";

const API_VERSION = process.env.SHOPIFY_API_VERSION || "2026-01";
const ThemeRoleSchema = z.enum(["main", "unpublished", "demo", "development"]);

const ResolveTemplateSectionsInputSchema = z.object({
  themeId: z.coerce.number().int().positive().optional().describe("Optional explicit Shopify theme ID"),
  themeRole: ThemeRoleSchema.default("main").describe("Theme role fallback when themeId is omitted"),
  pageType: z.string().min(1).default("index").describe("Type of page template to resolve (e.g. 'index', 'product', 'collection', 'cart', 'page')"),
});

const resolveTemplateSectionsTool = {
  name: "resolve-template-sections",
  description:
    "Resolve any page template files (e.g. index, product) and section instances with token-lean metadata for page inventory and edit planning. Use this instead of get-theme-file on large template JSON files.",
  schema: ResolveTemplateSectionsInputSchema,
  execute: async (input, context = {}) => {
    const shopifyClient = requireShopifyClient(context);
    return resolveTemplateSections(shopifyClient, API_VERSION, input);
  },
};

export { ResolveTemplateSectionsInputSchema, resolveTemplateSectionsTool };
