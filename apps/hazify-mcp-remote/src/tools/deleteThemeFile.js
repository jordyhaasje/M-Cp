import { z } from "zod";
import { requireShopifyClient } from "./_context.js";
import { createMutationAuditLog } from "../lib/db.js";
import { deleteThemeFile, getThemeFile } from "../lib/themeFiles.js";

const API_VERSION = process.env.SHOPIFY_API_VERSION || "2026-01";
const ThemeRoleSchema = z.enum(["main"]);

const normalizeDeleteThemeFileInput = (rawInput) => {
  if (!rawInput || typeof rawInput !== "object" || Array.isArray(rawInput)) {
    return rawInput;
  }

  return {
    themeId: rawInput.themeId ?? rawInput.theme_id,
    themeRole: rawInput.themeRole ?? rawInput.theme_role ?? rawInput.role,
    key: rawInput.key ?? rawInput.filename ?? rawInput.file,
    confirmKey: rawInput.confirmKey ?? rawInput.confirm_key,
    expectedChecksumMd5:
      rawInput.expectedChecksumMd5 ??
      rawInput.expected_checksum_md5 ??
      rawInput.checksumMd5 ??
      rawInput.checksum,
    confirmation: rawInput.confirmation,
    reason: rawInput.reason,
  };
};

const resolveShopDomain = (context, shopifyClient) => {
  if (typeof context?.shopifyDomain === "string" && context.shopifyDomain.trim()) {
    return context.shopifyDomain.trim();
  }
  const rawUrl = typeof shopifyClient?.url === "string" ? shopifyClient.url : "";
  if (!rawUrl) {
    return null;
  }
  try {
    return new URL(rawUrl).hostname || null;
  } catch {
    return null;
  }
};

const DeleteThemeFilePublicObjectSchema = z.object({
  themeId: z.coerce.number().int().positive().optional().describe("Optional explicit Shopify theme ID"),
  theme_id: z.coerce.number().int().positive().optional().describe("Compat alias van themeId voor generieke wrappers."),
  themeRole: ThemeRoleSchema.optional().describe("Theme role. Alleen 'main' is role-only toegestaan; gebruik themeId voor development/unpublished/demo themes."),
  theme_role: ThemeRoleSchema.optional().describe("Compat alias van themeRole voor generieke wrappers. Alleen 'main' is role-only toegestaan."),
  role: ThemeRoleSchema.optional().describe("Compat alias van themeRole voor generieke wrappers. Alleen 'main' is role-only toegestaan."),
  key: z.string().min(1).optional().describe("Theme file key to delete. Note: layout/theme.liquid cannot be deleted."),
  filename: z.string().min(1).optional().describe("Compat alias van key voor generieke wrappers."),
  file: z.string().min(1).optional().describe("Compat alias van key voor generieke wrappers."),
  confirmKey: z
    .string()
    .min(1)
    .optional()
    .describe("Moet exact gelijk zijn aan key. Dit voorkomt accidental deletes door tool-call samenvattingen."),
  confirm_key: z
    .string()
    .min(1)
    .optional()
    .describe("Compat alias van confirmKey voor generieke wrappers."),
  expectedChecksumMd5: z
    .string()
    .min(1)
    .optional()
    .describe("Checksum uit een recente get-theme-file/get-theme-files read. Vereist voor conflict-safe delete."),
  expected_checksum_md5: z
    .string()
    .min(1)
    .optional()
    .describe("Compat alias van expectedChecksumMd5 voor generieke wrappers."),
  checksumMd5: z
    .string()
    .min(1)
    .optional()
    .describe("Compat alias van expectedChecksumMd5 voor generieke wrappers."),
  checksum: z
    .string()
    .min(1)
    .optional()
    .describe("Compat alias van expectedChecksumMd5 voor generieke wrappers."),
  confirmation: z.literal("DELETE_THEME_FILE").describe("Verplicht type: 'DELETE_THEME_FILE' ter bevestiging"),
  reason: z.string().min(5).describe("Auditable reden"),
});

const DeleteThemeFileInputSchema = z.preprocess(
  normalizeDeleteThemeFileInput,
  z
    .object({
      themeId: z.coerce.number().int().positive().optional(),
      themeRole: ThemeRoleSchema.optional(),
      key: z.string().min(1),
      confirmKey: z.string().min(1).optional(),
      expectedChecksumMd5: z.string().min(1).optional(),
      confirmation: z.literal("DELETE_THEME_FILE"),
      reason: z.string().min(5),
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

const deleteThemeFileTool = {
  name: "delete-theme-file",
  description: "Delete a file from a Shopify theme. Gebruik themeRole='main' of een exact themeId; vraag de gebruiker welk thema.",
  inputSchema: DeleteThemeFilePublicObjectSchema,
  schema: DeleteThemeFileInputSchema,
  execute: async (rawInput, context = {}) => {
    const normalizedParse = DeleteThemeFileInputSchema.safeParse(rawInput);
    if (!normalizedParse.success) {
      throw new Error(normalizedParse.error.issues.map((issue) => issue.message).join(" | "));
    }
    const input = normalizedParse.data;
    const shopifyClient = requireShopifyClient(context);
    if (!input.themeId && !input.themeRole) {
      throw new Error("Geef themeRole='main' of een exact themeId op. Vraag de gebruiker welk thema bedoeld wordt.");
    }
    if (input.confirmKey !== input.key) {
      return {
        success: false,
        status: "needs_confirmation",
        message:
          "Bevestig exact welk theme-bestand verwijderd moet worden door confirmKey gelijk te zetten aan key.",
        errorCode: "delete_theme_file_confirm_key_required",
        retryable: true,
        nextAction: "confirm_exact_delete_key",
        nextTool: "delete-theme-file",
        nextArgsTemplate: {
          ...(input.themeId !== undefined ? { themeId: input.themeId } : {}),
          ...(input.themeRole ? { themeRole: input.themeRole } : {}),
          key: input.key,
          confirmKey: input.key,
          expectedChecksumMd5: input.expectedChecksumMd5 || "<checksum from get-theme-file>",
          confirmation: "DELETE_THEME_FILE",
          reason: input.reason,
        },
      };
    }
    if (!input.expectedChecksumMd5) {
      try {
        const current = await getThemeFile(shopifyClient, API_VERSION, {
          themeId: input.themeId,
          themeRole: input.themeRole,
          key: input.key,
        });
        const checksumMd5 = current.asset?.checksumMd5 || current.asset?.checksum || null;
        return {
          success: false,
          status: "needs_precondition",
          message:
            "Lees/controleer het doelbestand en geef expectedChecksumMd5 mee voordat delete-theme-file echt verwijdert.",
          errorCode: "delete_theme_file_checksum_required",
          retryable: true,
          nextAction: "retry_with_expected_checksum",
          nextTool: "delete-theme-file",
          currentFile: {
            key: input.key,
            size: current.asset?.size ?? null,
            checksumMd5,
            updatedAt: current.asset?.updatedAt ?? null,
          },
          nextArgsTemplate: {
            ...(input.themeId !== undefined ? { themeId: input.themeId } : {}),
            ...(input.themeRole ? { themeRole: input.themeRole } : {}),
            key: input.key,
            confirmKey: input.key,
            expectedChecksumMd5: checksumMd5 || "<checksum from get-theme-file>",
            confirmation: "DELETE_THEME_FILE",
            reason: input.reason,
          },
        };
      } catch (error) {
        return {
          success: false,
          status: "precondition_read_failed",
          message: `Kon het doelbestand niet vooraf lezen: ${error instanceof Error ? error.message : String(error)}`,
          errorCode: "delete_theme_file_precondition_read_failed",
          retryable: true,
          nextAction: "verify_target_file_then_retry",
          nextTool: "get-theme-file",
        };
      }
    }
    try {
      const result = await deleteThemeFile(shopifyClient, API_VERSION, {
        themeId: input.themeId,
        themeRole: input.themeRole,
        key: input.key,
        expectedChecksumMd5: input.expectedChecksumMd5,
      });
      const auditLog = await createMutationAuditLog({
        toolName: "delete-theme-file",
        tenantId: context?.tenantId || null,
        shopDomain: resolveShopDomain(context, shopifyClient),
        requestId: context?.requestId || null,
        reason: input.reason,
        targetIds: [
          `theme:${result.theme.id}`,
          input.key,
        ],
        payload: {
          confirmation: input.confirmation,
          themeId: result.theme.id,
          themeRole: result.theme.role,
          key: input.key,
          expectedChecksumMd5: input.expectedChecksumMd5,
          verify: result.verify || null,
        },
      });

      return {
        success: true,
        action: "deleted",
        theme: {
          id: result.theme.id,
          name: result.theme.name,
          role: result.theme.role,
        },
        deletedKey: result.deletedKey,
        verify: result.verify || null,
        audit: {
          auditLogId: auditLog?.id || null,
          reason: input.reason,
          requestId: context?.requestId || null,
          tenantId: context?.tenantId || null,
          shopDomain: resolveShopDomain(context, shopifyClient),
          targetIds: [`theme:${result.theme.id}`, input.key],
        },
      };
    } catch (error) {
      console.error("Error deleting theme file:", error);
      throw new Error(`Failed to delete theme file: ${error instanceof Error ? error.message : String(error)}`);
    }
  },
};

export { deleteThemeFileTool };
