import { z } from "zod";
import { requireShopifyClient } from "./_context.js";
import { searchThemeFilesWithSnippets } from "../lib/themePlanning.js";
import { rememberThemeRead } from "../lib/themeEditMemory.js";
import {
  extractThemeToolSummary,
  inferSearchScope,
  inferThemeTargetFromSummary,
  normalizeSummaryFilePatterns,
  normalizeSummaryScope,
} from "./_themeToolCompatibility.js";
import {
  buildExplicitThemeTargetRequiredResponse,
  resolveThemeTargetFromInputOrMemory,
} from "./_themeTargeting.js";

const API_VERSION = process.env.SHOPIFY_API_VERSION || "2026-01";
const ThemeRoleSchema = z.enum(["main"]);
const ScopeBucketSchema = z.enum(["templates", "sections", "snippets", "assets", "config", "locales"]);

const scopeBucketPatterns = {
  templates: "templates/*",
  sections: "sections/*",
  snippets: "snippets/*",
  assets: "assets/*",
  config: "config/*",
  locales: "locales/*",
};

const SearchThemeFilesPublicObjectSchema = z
  .object({
    query: z.string().min(1).optional().describe("Literal text or regex pattern to search for"),
    mode: z.enum(["literal", "regex"]).optional(),
    themeId: z.coerce.number().int().positive().optional().describe("Optional explicit Shopify theme ID"),
    theme_id: z.coerce.number().int().positive().optional().describe("Compat alias van themeId voor generieke wrappers."),
    themeRole: ThemeRoleSchema.optional().describe("Expliciete theme role. Alleen 'main' is role-only toegestaan; gebruik themeId voor development/unpublished/demo themes."),
    theme_role: ThemeRoleSchema.optional().describe("Compat alias van themeRole voor generieke wrappers. Alleen 'main' is role-only toegestaan."),
    role: ThemeRoleSchema.optional().describe("Compat alias van themeRole voor generieke wrappers. Alleen 'main' is role-only toegestaan."),
    keys: z.array(z.string().min(1)).min(1).max(10).optional().describe("Exacte file keys om compact binnen al bekende planner-output te zoeken."),
    filePatterns: z.array(z.string().min(1)).max(20).optional().describe("Glob patterns to filter files."),
    file_patterns: z.array(z.string().min(1)).max(20).optional().describe("Compat alias van filePatterns voor generieke wrappers."),
    scope: z.union([z.array(ScopeBucketSchema).min(1).max(4), ScopeBucketSchema]).optional().describe("Scopebucket(s) voor de zoekruimte."),
    resultLimit: z.number().int().min(1).max(10).optional().describe("Maximum number of snippets to return."),
    result_limit: z.number().int().min(1).max(10).optional().describe("Compat alias van resultLimit voor generieke wrappers."),
    limit: z.number().int().min(1).max(10).optional().describe("Compat alias van resultLimit voor generieke wrappers."),
    snippetLength: z.number().int().min(40).max(240).optional().describe("Maximum snippet length."),
    snippet_length: z.number().int().min(40).max(240).optional().describe("Compat alias van snippetLength voor generieke wrappers."),
    _tool_input_summary: z.string().max(4000).optional().describe("Compat summary voor beperkte clients."),
    tool_input_summary: z.string().max(4000).optional().describe("Legacy alias van _tool_input_summary."),
    summary: z.string().max(4000).optional().describe("Legacy alias van _tool_input_summary."),
    prompt: z.string().max(4000).optional().describe("Legacy alias van _tool_input_summary."),
    request: z.string().max(4000).optional().describe("Legacy alias van _tool_input_summary."),
  })
  .strict();

const SearchThemeFilesShape = z
  .object({
    query: z.string().min(1).describe("Literal text or regex pattern to search for"),
    mode: z.enum(["literal", "regex"]).default("literal"),
    themeId: z.coerce.number().int().positive().optional().describe("Optional explicit Shopify theme ID"),
    themeRole: ThemeRoleSchema.optional().describe("Expliciete theme role. Alleen 'main' is role-only toegestaan; gebruik themeId voor development/unpublished/demo themes."),
    keys: z.array(z.string().min(1)).min(1).max(10).optional().describe("Exacte file keys om compact binnen al bekende planner-output te zoeken, bijvoorbeeld ['sections/main-product.liquid', 'snippets/product-info.liquid']."),
    filePatterns: z.array(z.string().min(1)).max(20).optional().describe("Glob patterns to filter files (bijv. ['*.liquid', 'assets/*']). Gebruik filePatterns of scope om de zoekruimte smal te houden."),
    scope: z.array(ScopeBucketSchema).min(1).max(4).optional().describe("JE BENT VERPLICHT scope OF filePatterns TE GEBRUIKEN. MOET EEN ARRAY ZIJN (e.g. ['sections']). Absoluut GEEN losse string."),
    resultLimit: z.number().int().min(1).max(10).default(8),
    snippetLength: z.number().int().min(40).max(240).default(120),
  })
  .superRefine((input, ctx) => {
    if ((!input.keys || input.keys.length === 0) && (!input.filePatterns || input.filePatterns.length === 0) && (!input.scope || input.scope.length === 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["filePatterns"],
        message: "Geef minimaal keys, filePatterns of scope op om de zoekruimte smal te houden.",
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
    themeId: rawInput.themeId ?? rawInput.theme_id,
    themeRole:
      rawInput.themeRole ?? rawInput.theme_role ?? rawInput.role,
    keys: Array.isArray(rawInput.keys) ? rawInput.keys : rawInput.keys ? [rawInput.keys] : rawInput.keys,
    scope: normalizeSummaryScope(rawInput.scope),
    filePatterns: normalizeSummaryFilePatterns(
      rawInput.filePatterns ?? rawInput.file_patterns
    ),
    resultLimit:
      rawInput.resultLimit ?? rawInput.result_limit ?? rawInput.limit,
    snippetLength:
      rawInput.snippetLength ?? rawInput.snippet_length,
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
    "Search scoped theme files and return compact snippets instead of full file dumps. Gebruik in elke editflow hetzelfde expliciete target als in plan-theme-edit en je write-call. Als dezelfde flow al eerder een theme target bevestigde, mag die sticky worden hergebruikt; anders blokkeert deze tool met een repair response. Gebruik dit eerst om een exacte, unieke patch-anchor of bestaand renderpad te vinden voordat je leest of schrijft. Voor native product-blocks of template placement gebruik je bij voorkeur eerst plan-theme-edit, en zoek je daarna alleen in de voorgestelde scope of exact keys. Bij compatibele clients mag een korte _tool_input_summary ook; die wordt dan als query gebruikt en de scope wordt waar mogelijk automatisch vernauwd. Legacy aliases zoals summary, prompt, request en tool_input_summary blijven alleen voor backwards compatibility ondersteund. Minimaal geldig voorbeeld: { query: 'buy_buttons', scope: ['sections', 'snippets'] }, { query: 'block.type', keys: ['sections/main-product.liquid', 'snippets/product-info.liquid'] } of { query: 'main-product', filePatterns: ['sections/*.liquid'] }.",
  inputSchema: SearchThemeFilesPublicObjectSchema,
  schema: SearchThemeFilesInputSchema,
  execute: async (rawInput, context = {}) => {
    const normalizedParse = SearchThemeFilesInputSchema.safeParse(rawInput);
    if (!normalizedParse.success) {
      throw new Error(normalizedParse.error.issues.map((issue) => issue.message).join(" | "));
    }
    const input = normalizedParse.data;
    const shopifyClient = requireShopifyClient(context);
    const scopePatterns = Array.isArray(input.scope)
      ? input.scope.map((bucket) => scopeBucketPatterns[bucket]).filter(Boolean)
      : [];
    const filePatterns = Array.from(new Set([...(input.filePatterns || []), ...scopePatterns]));
    const resolvedThemeTarget = resolveThemeTargetFromInputOrMemory(input, context);
    if (!resolvedThemeTarget) {
      return buildExplicitThemeTargetRequiredResponse({
        toolName: "search-theme-files",
        normalizedArgs: {
          query: input.query,
          keys: input.keys,
          filePatterns,
          scope: input.scope,
        },
        nextArgsTemplate: {
          query: input.query,
          ...(input.keys?.length ? { keys: input.keys } : {}),
          ...(filePatterns.length ? { filePatterns } : {}),
          ...(input.scope?.length ? { scope: input.scope } : {}),
        },
      });
    }
    const result = await searchThemeFilesWithSnippets(shopifyClient, API_VERSION, {
      ...input,
      themeId: resolvedThemeTarget.themeId ?? undefined,
      themeRole: resolvedThemeTarget.themeId ? undefined : resolvedThemeTarget.themeRole,
      keys: input.keys,
      filePatterns,
    });
    rememberThemeRead(context, {
      themeId: result.theme.id,
      themeRole:
        result.theme.role?.toLowerCase?.() ||
        resolvedThemeTarget.themeRole ||
        undefined,
      files: [],
    });
    return {
      ...result,
      ...(resolvedThemeTarget.warnings?.length
        ? { warnings: resolvedThemeTarget.warnings }
        : {}),
    };
  },
};

export { SearchThemeFilesInputSchema, searchThemeFilesTool };
