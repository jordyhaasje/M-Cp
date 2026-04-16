import { z } from "zod";
import { requireShopifyClient } from "./_context.js";
import { verifyThemeFiles } from "../lib/themeFiles.js";

const API_VERSION = process.env.SHOPIFY_API_VERSION || "2026-01";
const ThemeRoleSchema = z.enum(["main", "unpublished", "demo", "development"]);

const VerifyThemeFilesInputSchema = z
  .object({
    themeId: z.coerce.number().int().positive().optional().describe("Optional explicit Shopify theme ID"),
    themeRole: ThemeRoleSchema.optional().describe("Optionele theme role. Geef deze in editflows expliciet mee; alleen voor backwards compatibility valt deze read-tool anders terug op main."),
    expected: z
      .array(
        z.object({
          key: z.string().min(1).describe("Theme file key"),
          size: z.number().int().nonnegative().optional().describe("Expected file size in bytes"),
          checksumMd5: z.string().optional().describe("Expected Shopify checksumMd5"),
        })
      )
      .min(1)
      .max(10)
      .describe("Expected metadata to verify per file (hard limit: 10 files max)"),
  })
  .superRefine((input, ctx) => {
    const keys = input.expected.map((entry) => String(entry.key).trim());
    if (new Set(keys).size !== keys.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["expected"],
        message: "Duplicate keys are not allowed in expected[].",
      });
    }
  });

const verifyThemeFilesTool = {
  name: "verify-theme-files",
  description: "Verify multiple theme files by expected metadata (size/checksumMd5). Geef in editflows bij voorkeur altijd expliciet themeId of themeRole mee zodat je verify-context overeenkomt met je planner/read/write-flow. Alleen voor backwards compatibility valt deze read-only tool terug op main als themeId/themeRole ontbreekt; dat levert dan ook een warning op. Minimaal geldig voorbeeld: { expected: [{ key: 'sections/hero.liquid', checksumMd5: '...' }] }.",
  schema: VerifyThemeFilesInputSchema,
  execute: async (input, context = {}) => {
    const shopifyClient = requireShopifyClient(context);
    const usedMainFallback = !input.themeId && !input.themeRole;
    const effectiveThemeRole = input.themeId ? undefined : input.themeRole || "main";
    try {
      const result = await verifyThemeFiles(shopifyClient, API_VERSION, {
        themeId: input.themeId,
        themeRole: effectiveThemeRole,
        expected: input.expected,
      });

      return {
        theme: {
          id: result.theme.id,
          name: result.theme.name,
          role: result.theme.role,
        },
        summary: result.summary,
        results: result.results,
        ...(usedMainFallback
          ? {
              warnings: [
                "⚠️ themeId/themeRole ontbrak; deze verify-call viel voor backwards compatibility terug op het LIVE main theme.",
              ],
            }
          : {}),
      };
    } catch (error) {
      console.error("Error verifying theme files:", error);
      throw new Error(`Failed to verify theme files: ${error instanceof Error ? error.message : String(error)}`);
    }
  },
};

export { verifyThemeFilesTool };
