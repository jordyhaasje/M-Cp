import { z } from "zod";
import { requireShopifyClient } from "./_context.js";
import { getThemeFiles } from "../lib/themeFiles.js";
import { rememberThemeRead } from "../lib/themeEditMemory.js";

const API_VERSION = process.env.SHOPIFY_API_VERSION || "2026-01";
const ThemeRoleSchema = z.enum(["main", "unpublished", "demo", "development"]);

const normalizeGetThemeFilesInput = (rawInput) => {
  if (!rawInput || typeof rawInput !== "object" || Array.isArray(rawInput)) {
    return rawInput;
  }

  return {
    themeId: rawInput.themeId,
    themeRole: rawInput.themeRole ?? rawInput.role,
    keys: rawInput.keys ?? rawInput.filenames,
    includeContent: rawInput.includeContent,
  };
};

const GetThemeFilesInputSchema = z
  .preprocess(
    normalizeGetThemeFilesInput,
    z
      .object({
        themeId: z.coerce.number().int().positive().optional().describe("Optional explicit Shopify theme ID"),
        themeRole: ThemeRoleSchema.optional().describe("Optionele theme role. Geef deze in editflows expliciet mee; alleen voor backwards compatibility valt deze read-tool anders terug op main."),
        keys: z
          .array(z.string().min(1))
          .min(1)
          .max(10)
          .describe("EXACT, VOLLEDIGE file paths, e.g. ['sections/hero.liquid']. GEEN GLOBBING OF WILDCARDS (*). Gebruik search-theme-files als je een path niet zeker weet (hard limit: 10)."),
        includeContent: z.boolean().default(false).describe("Include file content (value/attachment) in response"),
      })
      .superRefine((input, ctx) => {
        const normalized = input.keys.map((key) => String(key).trim());
        if (new Set(normalized).size !== normalized.length) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["keys"],
            message: "Duplicate keys are not allowed.",
          });
        }

        const wildcardKey = normalized.find((key) => /[*?]/.test(key));
        if (wildcardKey) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["keys"],
            message: `Gebruik alleen exacte keys. Wildcards zoals '${wildcardKey}' horen bij search-theme-files, niet bij get-theme-files.`,
          });
        }
      })
  );

const getThemeFilesTool = {
  name: "get-theme-files",
  description:
    "Read EXACT files from a Shopify theme. GEEN GLOBBING. Geef in editflows bij voorkeur altijd expliciet themeId of themeRole mee zodat je read-context overeenkomt met plan-theme-edit en je write-call. Alleen voor backwards compatibility valt deze read-tool terug op main als themeId/themeRole ontbreekt; dat levert dan ook een warning op. Gebruik altijd search-theme-files als je niet 100% zeker bent van de file path. Gebruik dit bij voorkeur na plan-theme-edit, zodat je alleen de exact voorgestelde files leest. Voor native product-block flows zijn dat meestal sections + snippets; lees templates/*.json daarna alleen opnieuw als placement van het block expliciet gevraagd is. Handig voor bewuste multi-read workflows zoals ['sections/main-product.liquid', 'snippets/product-info.liquid'] of ['templates/product.json'].",
  schema: GetThemeFilesInputSchema,
  execute: async (input, context = {}) => {
    const shopifyClient = requireShopifyClient(context);
    const usedMainFallback = !input.themeId && !input.themeRole;
    const effectiveThemeRole = input.themeId ? undefined : input.themeRole || "main";
    try {
      const result = await getThemeFiles(shopifyClient, API_VERSION, {
        themeId: input.themeId,
        themeRole: effectiveThemeRole,
        keys: input.keys,
        includeContent: input.includeContent,
      });

      rememberThemeRead(context, {
        themeId: result.theme.id,
        themeRole: result.theme.role?.toLowerCase?.() || input.themeRole || effectiveThemeRole,
        files: (result.files || []).map((file) => ({
          key: file.key,
          checksumMd5: file.checksumMd5 || file.checksum || null,
          hasContent: input.includeContent === true,
          value: input.includeContent === true ? file.value : undefined,
          attachment: input.includeContent === true ? file.attachment : undefined,
        })),
      });

      return {
        theme: {
          id: result.theme.id,
          name: result.theme.name,
          role: result.theme.role,
        },
        files: result.files,
        ...(usedMainFallback
          ? {
              warnings: [
                "⚠️ themeId/themeRole ontbrak; deze read-call viel voor backwards compatibility terug op het LIVE main theme.",
              ],
            }
          : {}),
      };
    } catch (error) {
      console.error("Error reading theme files:", error);
      throw new Error(`Failed to read theme files: ${error instanceof Error ? error.message : String(error)}`);
    }
  },
};

export { getThemeFilesTool };
