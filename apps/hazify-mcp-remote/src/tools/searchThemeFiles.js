import { z } from "zod";
import { requireShopifyClient } from "./_context.js";
import { searchThemeFilesWithSnippets } from "../lib/themePlanning.js";
import {
  extractThemeToolSummary,
  inferSearchScope,
  inferThemeTargetFromSummary,
  normalizeSummaryFilePatterns,
  normalizeSummaryScope,
} from "./_themeToolCompatibility.js";

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

const SearchThemeFilesShape = z
  .object({
    query: z.string().min(1).describe("Literal text or regex pattern to search for"),
    mode: z.enum(["literal", "regex"]).default("literal"),
    themeId: z.coerce.number().int().positive().optional().describe("Optional explicit Shopify theme ID"),
    themeRole: ThemeRoleSchema.default("main").describe("Theme role fallback when themeId is omitted"),
    filePatterns: z.array(z.string().min(1)).max(20).optional().describe("Glob patterns to filter files (bijv. ['*.liquid', 'assets/*']). Gebruik filePatterns of scope om de zoekruimte smal te houden."),
    scope: z.array(ScopeBucketSchema).min(1).max(4).optional().describe("JE BENT VERPLICHT scope OF filePatterns TE GEBRUIKEN. MOET EEN ARRAY ZIJN (e.g. ['sections']). Absoluut GEEN losse string."),
    resultLimit: z.number().int().min(1).max(10).default(8),
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

const normalizeSearchThemeFilesInput = (rawInput) => {
  if (!rawInput || typeof rawInput !== "object" || Array.isArray(rawInput)) {
    return rawInput;
  }

  const summary = extractThemeToolSummary(rawInput);
  const normalized = {
    ...rawInput,
    scope: normalizeSummaryScope(rawInput.scope),
    filePatterns: normalizeSummaryFilePatterns(rawInput.filePatterns),
  };

  if (!summary) {
    return normalized;
  }

  const withTarget = inferThemeTargetFromSummary(normalized, summary);
  if (!withTarget.query) {
    withTarget.query = summary;
  }
  if ((!withTarget.scope || withTarget.scope.length === 0) && (!withTarget.filePatterns || withTarget.filePatterns.length === 0)) {
    withTarget.scope = inferSearchScope(summary);
  }

  return withTarget;
};

const SearchThemeFilesInputSchema = z.preprocess(
  normalizeSearchThemeFilesInput,
  SearchThemeFilesShape
);

const searchThemeFilesTool = {
  name: "search-theme-files",
  description:
    "Search scoped theme files and return compact snippets instead of full file dumps. Deze read-only tool valt voor backwards compatibility terug op main als themeId/themeRole ontbreekt, maar gebruik in elke editflow bij voorkeur hetzelfde expliciete target als in plan-theme-edit en je write-call. Gebruik dit eerst om een exacte, unieke patch-anchor of bestaand renderpad te vinden voordat je leest of schrijft. Voor native product-blocks of template placement gebruik je bij voorkeur eerst plan-theme-edit, en zoek je daarna alleen in de voorgestelde scope. Bij compatibele clients mag een korte _tool_input_summary ook; die wordt dan als query gebruikt en de scope wordt waar mogelijk automatisch vernauwd. Legacy aliases zoals summary, prompt, request en tool_input_summary blijven alleen voor backwards compatibility ondersteund. Minimaal geldig voorbeeld: { query: 'buy_buttons', scope: ['sections', 'snippets'] } of { query: 'main-product', filePatterns: ['sections/*.liquid'] }.",
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
