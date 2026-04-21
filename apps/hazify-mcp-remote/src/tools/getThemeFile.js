import { z } from "zod";
import { requireShopifyClient } from "./_context.js";
import { getThemeFile } from "../lib/themeFiles.js";
import { rememberThemeRead } from "../lib/themeEditMemory.js";

const API_VERSION = process.env.SHOPIFY_API_VERSION || "2026-01";
const ThemeRoleSchema = z.enum(["main", "unpublished", "demo", "development"]);

const normalizeGetThemeFileInput = (rawInput) => {
  if (!rawInput || typeof rawInput !== "object" || Array.isArray(rawInput)) {
    return rawInput;
  }

  return {
    themeId: rawInput.themeId ?? rawInput.theme_id,
    themeRole:
      rawInput.themeRole ?? rawInput.theme_role ?? rawInput.role,
    key: rawInput.key ?? rawInput.filename,
    includeContent:
      rawInput.includeContent ?? rawInput.include_content,
  };
};

const GetThemeFilePublicObjectSchema = z
  .object({
    themeId: z.coerce.number().int().positive().optional().describe("Optional explicit Shopify theme ID"),
    theme_id: z.coerce.number().int().positive().optional().describe("Compat alias van themeId voor generieke wrappers."),
    themeRole: ThemeRoleSchema.optional().describe("Optionele theme role. Geef deze in editflows expliciet mee; alleen voor backwards compatibility valt deze read-tool anders terug op main."),
    theme_role: ThemeRoleSchema.optional().describe("Compat alias van themeRole voor generieke wrappers."),
    role: ThemeRoleSchema.optional().describe("Compat alias van themeRole voor generieke wrappers."),
    key: z.string().min(1).optional().describe("Theme file key, e.g. sections/hero.liquid"),
    filename: z.string().min(1).optional().describe("Compat alias van key voor generieke wrappers."),
    includeContent: z.boolean().optional().describe("Include file content (value/attachment) in response"),
    include_content: z.boolean().optional().describe("Compat alias van includeContent voor generieke wrappers."),
  })
  .strict();

const GetThemeFileInputSchema = z.preprocess(
  normalizeGetThemeFileInput,
  z
    .object({
      themeId: z.coerce.number().int().positive().optional(),
      themeRole: ThemeRoleSchema.optional(),
      key: z.string().min(1),
      includeContent: z.boolean().default(true),
    })
    .superRefine((input, ctx) => {
      if (input.themeId && input.themeRole) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["themeId"],
          message: "Gebruik themeId of themeRole, niet allebei tegelijk.",
        });
      }
    })
);


const getThemeFileTool = {
  name: "get-theme-file",
  description:
    "Read one exact file from a Shopify theme. Geef in editflows bij voorkeur altijd expliciet themeId of themeRole mee zodat je read-context overeenkomt met plan-theme-edit en je write-call. Dit is vaak de verplichte read-stap vóór create-theme-section of draft-theme-artifact wanneer de planner één nextReadKey teruggeeft. Alleen voor backwards compatibility valt deze read-tool terug op main als themeId/themeRole ontbreekt; dat levert dan ook een warning op. Lees dit liefst na plan-theme-edit, en alleen de compacte exact keys die de planner voorstelt. Voor native product-block flows hoef je templates/*.json na plan-theme-edit meestal niet opnieuw te lezen tenzij placement van het block expliciet gevraagd is. Handige reads zijn bijvoorbeeld sections/main-product.liquid, snippets/product-info.liquid of templates/product.json.",
  inputSchema: GetThemeFilePublicObjectSchema,
  schema: GetThemeFileInputSchema,
  execute: async (rawInput, context = {}) => {
    const normalizedParse = GetThemeFileInputSchema.safeParse(rawInput);
    if (!normalizedParse.success) {
      throw new Error(normalizedParse.error.issues.map((issue) => issue.message).join(" | "));
    }
    const input = normalizedParse.data;
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

      rememberThemeRead(context, {
        themeId: result.theme.id,
        themeRole: result.theme.role?.toLowerCase?.() || input.themeRole || effectiveThemeRole,
        files: [
          {
            key: result.asset?.key || input.key,
            checksumMd5: result.asset?.checksumMd5 || result.asset?.checksum || null,
            hasContent: input.includeContent !== false,
            value: input.includeContent !== false ? result.asset?.value : undefined,
            attachment:
              input.includeContent !== false ? result.asset?.attachment : undefined,
          },
        ],
      });

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
