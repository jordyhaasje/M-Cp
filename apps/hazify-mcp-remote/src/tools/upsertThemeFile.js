import { z } from "zod";
import { requireShopifyClient } from "./_context.js";
import { upsertThemeFile, getThemeFile } from "../lib/themeFiles.js";

const API_VERSION = process.env.SHOPIFY_API_VERSION || "2026-01";
const ThemeRoleSchema = z.enum(["main", "unpublished", "demo", "development"]);

const UpsertThemeFileInputSchema = z
  .object({
    themeId: z.coerce.number().int().positive().optional().describe("Optional explicit Shopify theme ID"),
    themeRole: ThemeRoleSchema.default("main").describe("Theme role fallback when themeId is omitted"),
    key: z.string().min(1).describe("Theme file key, e.g. sections/custom-banner.liquid. Note: layout/theme.liquid requires 'content_for_header' & 'content_for_layout'."),
    value: z.string().optional().describe("De letterlijke bestandsinhoud (tekst/broncode) voor Liquid, JSON, CSS, JS etc. Gebruik dít veld voor source code! (CRITICAL: Store the source code in this 'value' field. DO NOT use a field named 'content')"),
    content: z.string().optional().describe("DO NOT USE THIS FIELD. LLMs hallucinate this. Use 'value' instead."),
    attachment: z.string().optional().describe("Base64 geëncodeerde string, ALLEEN voor binaire bestanden (zoals afbeeldingen/fonts). NOOIT gebruiken voor tekst/code."),
    searchString: z.string().optional().describe("Optional. Text to find & replace. CRITICAL: requires 'replaceString'. Must be an exact match."),
    replaceString: z.string().optional().describe("Optional. New text to replace 'searchString'. CRITICAL: requires 'searchString'."),
    checksum: z.string().optional().describe("Optional checksum for conflict-safe writes"),
    auditReason: z.string().min(5).describe("VERPLICHT: Een duidelijke en gedetailleerde reden waarom je deze file aanpast of aanmaakt. Zonder dit veld faalt de actie gegarandeerd."),
  })
  .superRefine((input, ctx) => {
    if (typeof input.content === "string" && typeof input.value !== "string") {
      input.value = input.content;
      delete input.content;
    }
    const hasValue = typeof input.value === "string";
    const hasAttachment = typeof input.attachment === "string";
    const hasSearch = typeof input.searchString === "string";
    const hasReplace = typeof input.replaceString === "string";

    if (!hasValue && !hasAttachment && (!hasSearch || !hasReplace)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["value"],
        message: "Provide either 'value' (text), 'attachment' (base64) OR BOTH 'searchString' and 'replaceString' (patch/replace).",
      });
    }

    if ((hasValue || hasAttachment) && (hasSearch || hasReplace)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["searchString"],
        message: "You cannot mix 'value' or 'attachment' with 'searchString'/'replaceString'. Choose one method: full overwrite OR find/replace patch.",
      });
    }

    if (hasSearch !== hasReplace) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["searchString"],
        message: "Both 'searchString' and 'replaceString' must be provided together for a patch.",
      });
    }
    if (hasValue && hasAttachment) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["attachment"],
        message: "Use either 'value' or 'attachment', not both.",
      });
    }

    const themeFileKey = input.key.trim();
    if (themeFileKey.endsWith('.json') && (themeFileKey.startsWith('templates/') || themeFileKey.startsWith('config/'))) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["key"],
        message: "Modifying JSON templates directly is strictly forbidden to prevent layout destruction. The section files (.liquid/.css/.js) are safely created. STOP modifying files now and instruct the user to manually add the new section via the Shopify Theme Editor.",
      });
    }
  });


const upsertThemeFileTool = {
  name: "upsert-theme-file",
  description:
    "Create or update a single Shopify theme file, including new section/snippet/template/assets files when you already know the exact target key.",
  schema: UpsertThemeFileInputSchema,
  execute: async (input, context = {}) => {
      const shopifyClient = requireShopifyClient(context);
    try {
      let finalValue = input.value;
      let finalChecksum = input.checksum;

      if (input.searchString !== undefined && input.replaceString !== undefined) {
        const current = await getThemeFile(shopifyClient, API_VERSION, {
          themeId: input.themeId,
          themeRole: input.themeRole,
          key: input.key
        });
        
        const currentValue = current?.asset?.value;
        if (typeof currentValue !== "string") {
          throw new Error(`Cannot patch binary or empty file '${input.key}' using search/replace.`);
        }
        
        if (!currentValue.includes(input.searchString)) {
          throw new Error(`Error: searchString not found in the file. Make sure you use an exact, unique match.`);
        }
        
        finalValue = currentValue.replace(input.searchString, input.replaceString);
        if (finalChecksum === undefined) {
          finalChecksum = current.asset.checksumMd5 || current.asset.checksum;
        }
      }

      const result = await upsertThemeFile(shopifyClient, API_VERSION, {
        themeId: input.themeId,
        themeRole: input.themeRole,
        key: input.key,
        value: finalValue,
        attachment: input.attachment,
        checksum: finalChecksum,
      });

      return {
        action: "upserted",
        theme: {
          id: result.theme.id,
          name: result.theme.name,
          role: result.theme.role,
        },
        asset: result.asset,
      };
    } catch (error) {
      console.error("Error upserting theme file:", error);
      throw new Error(`Failed to upsert theme file: ${error instanceof Error ? error.message : String(error)}`);
    }
  },
};

export { upsertThemeFileTool };
