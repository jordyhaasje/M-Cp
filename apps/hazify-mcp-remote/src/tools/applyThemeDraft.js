import { z } from "zod";
import { getThemeDraftRecord, updateThemeDraftRecord } from "../lib/db.js";
import { getShopDomainFromClient, upsertThemeFiles } from "../lib/themeFiles.js";
import { requireShopifyClient } from "./_context.js";

const ThemeRoleSchema = z.enum(["main", "unpublished", "demo", "development"]);

const ApplyThemeDraftInputSchema = z.object({
  draftId: z.string().min(1).describe("Theme draft ID returned by draft-theme-artifact."),
  themeId: z.coerce.number().int().positive().optional().describe("Optional explicit target theme ID."),
  themeRole: ThemeRoleSchema.optional().describe("Target theme role when themeId is omitted. Verplicht als themeId niet is opgegeven; vraag de gebruiker welk thema bedoeld wordt."),
  confirmation: z.literal("APPLY_THEME_DRAFT").describe("Verplicht type: 'APPLY_THEME_DRAFT' ter bevestiging."),
  reason: z.string().min(5).describe("Auditable reden voor het toepassen van dit draft."),
});

function normalizeStoredFiles(value) {
  if (Array.isArray(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function getUpsertFailures(upsertResult) {
  return Array.isArray(upsertResult?.results)
    ? upsertResult.results.filter((result) => result?.status && result.status !== "applied")
    : [];
}

const applyThemeDraft = {
  name: "apply-theme-draft",
  description:
    "Apply a previously drafted theme artifact to an explicit target theme. This is the promote/apply step after draft-theme-artifact has prepared and verified the files. themeId of themeRole is verplicht; kies nooit stilzwijgend een live target.",
  schema: ApplyThemeDraftInputSchema,
  execute: async (input, context = {}) => {
    const shopifyClient = requireShopifyClient(context);
    if (!input.themeId && !input.themeRole) {
      throw new Error("Geef themeId of themeRole op. Vraag de gebruiker expliciet op welk thema het draft toegepast moet worden.");
    }
    const draftRecord = await getThemeDraftRecord(input.draftId);
    if (!draftRecord) {
      throw new Error(`Theme draft '${input.draftId}' kon niet worden gevonden.`);
    }

    const files = normalizeStoredFiles(draftRecord.files_json);
    if (files.length === 0) {
      throw new Error(`Theme draft '${input.draftId}' bevat geen toepasbare files.`);
    }

    const apiVersion = process.env.SHOPIFY_API_VERSION || "2026-01";
    const upsertResult = await upsertThemeFiles(shopifyClient, apiVersion, {
      themeId: input.themeId,
      themeRole: input.themeRole,
      files: files.map((file) => ({ key: file.key, value: file.value })),
      verifyAfterWrite: true,
    });

    const failedApplyWrites = getUpsertFailures(upsertResult);
    if (failedApplyWrites.length > 0 || Number(upsertResult?.summary?.applied || 0) !== files.length) {
      const updatedDraft = await updateThemeDraftRecord(input.draftId, {
        status: "apply_failed",
        verifyResult: {
          summary: upsertResult.verifySummary || null,
          results: upsertResult.results || [],
        },
      });
      return {
        success: false,
        status: "apply_failed",
        draftId: input.draftId,
        theme: upsertResult.theme
          ? {
              id: upsertResult.theme.id,
              name: upsertResult.theme.name,
              role: upsertResult.theme.role,
            }
          : null,
        verify: {
          summary: upsertResult.verifySummary || null,
          results: upsertResult.results || [],
        },
        message:
          failedApplyWrites[0]?.error?.message ||
          "Het draft kon niet volledig op het gekozen target worden toegepast.",
        errorCode: failedApplyWrites.some((result) => result.status === "failed_precondition")
          ? "apply_failed_precondition"
          : "apply_failed",
        retryable: true,
        draft: updatedDraft
          ? {
              id: updatedDraft.id,
              status: updatedDraft.status,
              previewThemeId: updatedDraft.preview_theme_id ?? null,
              appliedThemeId: updatedDraft.applied_theme_id ?? null,
              updatedAt: updatedDraft.updated_at ?? null,
            }
          : null,
      };
    }

    const updatedDraft = await updateThemeDraftRecord(input.draftId, {
      status: "applied",
      appliedThemeId: upsertResult.theme?.id || null,
      verifyResult: {
        summary: upsertResult.verifySummary || null,
        results: upsertResult.results || [],
      },
    });

    const shopDomain = getShopDomainFromClient(shopifyClient);
    return {
      success: true,
      status: "applied",
      draftId: input.draftId,
      theme: upsertResult.theme
        ? {
            id: upsertResult.theme.id,
            name: upsertResult.theme.name,
            role: upsertResult.theme.role,
          }
        : null,
      verify: {
        summary: upsertResult.verifySummary || null,
        results: upsertResult.results || [],
      },
      message: "Theme draft is succesvol toegepast op het gekozen target.",
      editorUrl: upsertResult.theme?.id ? `https://${shopDomain}/admin/themes/${upsertResult.theme.id}/editor` : null,
      draft: updatedDraft
        ? {
            id: updatedDraft.id,
            status: updatedDraft.status,
            previewThemeId: updatedDraft.preview_theme_id ?? null,
            appliedThemeId: updatedDraft.applied_theme_id ?? null,
            updatedAt: updatedDraft.updated_at ?? null,
          }
        : null,
    };
  },
};

export { ApplyThemeDraftInputSchema, applyThemeDraft };
