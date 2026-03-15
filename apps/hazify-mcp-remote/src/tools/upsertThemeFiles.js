import { z } from "zod";
import { requireShopifyClient } from "./_context.js";
import { upsertThemeFiles } from "../lib/themeFiles.js";

const API_VERSION = process.env.SHOPIFY_API_VERSION || "2026-01";
const ThemeRoleSchema = z.enum(["main", "unpublished", "demo", "development"]);

const UpsertThemeFilesInputSchema = z
  .object({
    themeId: z.coerce.number().int().positive().optional().describe("Optional explicit Shopify theme ID"),
    themeRole: ThemeRoleSchema.default("main").describe("Theme role fallback when themeId is omitted"),
    files: z
      .array(
        z
          .object({
            key: z.string().min(1).describe("Theme file key, e.g. sections/custom-banner.liquid"),
            value: z.string().optional().describe("Text content for Liquid/JSON/CSS/JS assets"),
            attachment: z.string().optional().describe("Base64 payload for binary assets"),
            checksum: z.string().optional().describe("Optional checksum precondition"),
          })
          .superRefine((file, ctx) => {
            const hasValue = typeof file.value === "string";
            const hasAttachment = typeof file.attachment === "string";
            if (!hasValue && !hasAttachment) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["value"],
                message: "Provide either 'value' (text) or 'attachment' (base64).",
              });
            }
            if (hasValue && hasAttachment) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["attachment"],
                message: "Use either 'value' or 'attachment', not both.",
              });
            }
          })
      )
      .min(1)
      .max(200)
      .describe("Batch of theme files to create/update"),
    verifyAfterWrite: z.boolean().default(false).describe("Verify files directly after write"),
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
  });

const upsertThemeFilesTool = {
  name: "upsert-theme-files",
  description: "Create or update multiple Shopify theme files in chunked batches.",
  schema: UpsertThemeFilesInputSchema,
  execute: async (input, context = {}) => {
    const shopifyClient = requireShopifyClient(context);
    try {
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
