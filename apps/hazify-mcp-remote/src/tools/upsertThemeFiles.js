import { z } from "zod";
import { requireShopifyClient } from "./_context.js";
import { upsertThemeFiles, getThemeFiles } from "../lib/themeFiles.js";

const API_VERSION = process.env.SHOPIFY_API_VERSION || "2026-01";
const ThemeRoleSchema = z.enum(["main", "unpublished", "demo", "development"]);

const UpsertThemeFilesInputSchema = z
  .object({
    themeId: z.coerce.number().int().positive().optional().describe("Optional explicit Shopify theme ID"),
    themeRole: ThemeRoleSchema.default("main").describe("Theme role fallback when themeId is omitted"),
    auditReason: z.string().min(5).describe("VERPLICHT: Een duidelijke en gedetailleerde reden waarom je deze file aanpast of aanmaakt. Zonder dit veld faalt de actie gegarandeerd."),
    files: z
      .array(
        z
          .object({
            key: z.string().min(1).describe("Theme file key. Note: layout/theme.liquid requires 'content_for_header' & 'content_for_layout'."),
            value: z.string().optional().describe("De letterlijke bestandsinhoud (tekst/broncode) voor Liquid, JSON, CSS, JS etc. (CRITICAL: Store the source code in this 'value' field. DO NOT use a field named 'content')"),
            content: z.string().optional().describe("DO NOT USE THIS FIELD. LLMs hallucinate this. Use 'value' instead."),
            attachment: z.string().optional().describe("Base64 geëncodeerde string, ALLEEN voor binaire bestanden (zoals afbeeldingen/fonts). NOOIT gebruiken voor tekst/code."),
            searchString: z.string().optional().describe("Optional. Text to find & replace. CRITICAL: requires 'replaceString'. Must be an exact match."),
            replaceString: z.string().optional().describe("Optional. New text to replace 'searchString'. CRITICAL: requires 'searchString'."),
            checksum: z.string().optional().describe("Optional checksum precondition"),
          })
          .superRefine((file, ctx) => {
            if (typeof file.content === "string" && typeof file.value !== "string") {
              file.value = file.content;
              delete file.content;
            }
            const hasValue = typeof file.value === "string";
            const hasAttachment = typeof file.attachment === "string";
            const hasSearch = typeof file.searchString === "string";
            const hasReplace = typeof file.replaceString === "string";

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
          })
      )
      .min(1)
      .max(200)
      .describe("Batch of theme files to create/update"),
    verifyAfterWrite: z.boolean().default(false).describe("Verify files directly after write"),
    confirmation: z.literal("UPSERT_THEME_FILES").describe("Verplicht type: 'UPSERT_THEME_FILES' ter bevestiging"),
  })
  .superRefine((input, ctx) => {
    const keys = input.files.map((file) => String(file.key).trim());
    if (new Set(keys).size !== keys.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["files"],
        message: "Duplicate keys are not allowed in files[].",
      });
    }

    input.files.forEach((file, index) => {
      const themeFileKey = file.key.trim();
      if (themeFileKey.endsWith('.json') && (themeFileKey.startsWith('templates/') || themeFileKey.startsWith('config/'))) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["files", index, "key"],
          message: "Modifying JSON templates directly is strictly forbidden to prevent layout destruction. The section files (.liquid/.css/.js) are safely created. STOP modifying files now and instruct the user to manually add the new section via the Shopify Theme Editor.",
        });
      }
    });
  });

const upsertThemeFilesTool = {
  name: "upsert-theme-files",
  description:
    "Create or update multiple Shopify theme files in chunked batches, including new section/snippet/template/assets files when exact targets are already known.",
  schema: UpsertThemeFilesInputSchema,
  execute: async (input, context = {}) => {
    const shopifyClient = requireShopifyClient(context);
    try {
      const patchFiles = input.files.filter(f => f.searchString !== undefined && f.replaceString !== undefined);
      
      if (patchFiles.length > 0) {
        const patchKeys = patchFiles.map(f => f.key);
        const currentData = await getThemeFiles(shopifyClient, API_VERSION, {
          themeId: input.themeId,
          themeRole: input.themeRole,
          keys: patchKeys,
          includeContent: true
        });

        for (const fileItem of input.files) {
          if (fileItem.searchString !== undefined && fileItem.replaceString !== undefined) {
            const currentAsset = currentData.files.find(a => a.key === fileItem.key);
            if (!currentAsset || currentAsset.missing) {
              throw new Error(`Cannot patch non-existing file '${fileItem.key}'.`);
            }
            if (typeof currentAsset.value !== "string") {
              throw new Error(`Cannot patch binary or empty file '${fileItem.key}' using search/replace.`);
            }
            if (!currentAsset.value.includes(fileItem.searchString)) {
              throw new Error(`Error: searchString not found in the file '${fileItem.key}'. Make sure you use an exact, unique match.`);
            }
            
            fileItem.value = currentAsset.value.replace(fileItem.searchString, fileItem.replaceString);
            if (fileItem.checksum === undefined) {
              fileItem.checksum = currentAsset.checksumMd5 || currentAsset.checksum;
            }
            
            delete fileItem.searchString;
            delete fileItem.replaceString;
          }
        }
      }

      const result = await upsertThemeFiles(shopifyClient, API_VERSION, {
        themeId: input.themeId,
        themeRole: input.themeRole,
        files: input.files,
        verifyAfterWrite: input.verifyAfterWrite,
      });

      return {
        action: "upserted_batch",
        theme: {
          id: result.theme.id,
          name: result.theme.name,
          role: result.theme.role,
        },
        summary: result.summary,
        results: result.results,
        ...(result.verifySummary ? { verifySummary: result.verifySummary } : {}),
        ...(result.verifyError ? { verifyError: result.verifyError } : {}),
      };
    } catch (error) {
      console.error("Error upserting theme files:", error);
      throw new Error(`Failed to upsert theme files: ${error instanceof Error ? error.message : String(error)}`);
    }
  },
};

export { upsertThemeFilesTool };
