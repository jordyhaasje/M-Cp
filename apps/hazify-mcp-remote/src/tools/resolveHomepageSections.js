import { z } from "zod";
import { requireShopifyClient } from "./_context.js";
import { resolveHomepageSections } from "../lib/themePlanning.js";

const API_VERSION = process.env.SHOPIFY_API_VERSION || "2026-01";
const ThemeRoleSchema = z.enum(["main", "unpublished", "demo", "development"]);

const ResolveHomepageSectionsInputSchema = z.object({
  themeId: z.coerce.number().int().positive().optional().describe("Optional explicit Shopify theme ID"),
  themeRole: ThemeRoleSchema.default("main").describe("Theme role fallback when themeId is omitted"),
  page: z.literal("homepage").default("homepage"),
});

const resolveHomepageSectionsTool = {
  name: "resolve-homepage-sections",
  description:
    "Resolve homepage template files and section instances with token-lean metadata for homepage inventory and edit planning.",
  schema: ResolveHomepageSectionsInputSchema,
  execute: async (input, context = {}) => {
    const shopifyClient = requireShopifyClient(context);
    return resolveHomepageSections(shopifyClient, API_VERSION, input);
  },
};

export { ResolveHomepageSectionsInputSchema, resolveHomepageSectionsTool };
