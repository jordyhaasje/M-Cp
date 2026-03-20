import { z } from "zod";
import { requireShopifyClient } from "./_context.js";
import { searchThemeFilesWithSnippets } from "../lib/themePlanning.js";

const API_VERSION = process.env.SHOPIFY_API_VERSION || "2026-01";
const ThemeRoleSchema = z.enum(["main", "unpublished", "demo", "development"]);
const ScopeBucketSchema = z.enum(["templates", "sections", "snippets", "assets", "config", "locales"]);

const scopeBucketPatterns = {
  templates: "templates/*",
  sections: "sections/*",
  snippets: "snippets/*",
  assets: "assets/*",
  config: "config/*",
  locales: "locales/*",
};

const SearchThemeFilesInputSchema = z
  .object({
    query: z.string().min(1).describe("Literal text or regex pattern to search for"),
    mode: z.enum(["literal", "regex"]).default("literal"),
    themeId: z.coerce.number().int().positive().optional().describe("Optional explicit Shopify theme ID"),
    themeRole: ThemeRoleSchema.default("main").describe("Theme role fallback when themeId is omitted"),
    filePatterns: z.array(z.string().min(1)).max(20).optional().describe("Explicit filename patterns, e.g. ['sections/*.liquid']. REQUIRED if scope is omitted. Do not leave both empty."),
    scope: z.array(ScopeBucketSchema).min(1).max(4).optional().describe("Optional narrowed scope buckets. REQUIRED if filePatterns is omitted. Do not leave both empty."),
    resultLimit: z.number().int().min(1).max(20).default(8),
    snippetLength: z.number().int().min(40).max(240).default(120),
  })
  .superRefine((input, ctx) => {
    if ((!input.filePatterns || input.filePatterns.length === 0) && (!input.scope || input.scope.length === 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["filePatterns"],
        message: "Geef minimaal filePatterns of scope op om de zoekruimte smal te houden.",
      });
    }
  });

const searchThemeFilesTool = {
  name: "search-theme-files",
  description:
    "Search scoped theme files and return compact snippets instead of full file dumps. Prefer this before full reads when fixing styling/code or borrowing a small reference pattern. Avoid broad searches. Use strict scoping (filePatterns or scope) to prevent hitting results limits.",
  schema: SearchThemeFilesInputSchema,
  execute: async (input, context = {}) => {
    const shopifyClient = requireShopifyClient(context);
    const scopePatterns = Array.isArray(input.scope)
      ? input.scope.map((bucket) => scopeBucketPatterns[bucket]).filter(Boolean)
      : [];
    const filePatterns = Array.from(new Set([...(input.filePatterns || []), ...scopePatterns]));
    return searchThemeFilesWithSnippets(shopifyClient, API_VERSION, {
      ...input,
      filePatterns,
    });
  },
};

export { SearchThemeFilesInputSchema, searchThemeFilesTool };
