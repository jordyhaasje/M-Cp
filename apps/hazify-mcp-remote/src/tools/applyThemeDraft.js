import { z } from "zod";
import {
  createMutationAuditLog,
  getThemeDraftRecord,
  updateThemeDraftRecord,
} from "../lib/db.js";
import { getShopDomainFromClient, getThemeFiles, upsertThemeFiles } from "../lib/themeFiles.js";
import { requireShopifyClient } from "./_context.js";

const ThemeRoleSchema = z.enum(["main"]);
const ExpectedTargetFileSchema = z
  .object({
    key: z.string().min(1).describe("Theme file key that will be overwritten or created."),
    checksumMd5: z
      .string()
      .min(1)
      .optional()
      .describe("Checksum from a fresh target read. Required when the file should currently exist."),
    status: z
      .enum(["missing", "match"])
      .optional()
      .describe("Use status='missing' only when a fresh target read confirmed the file does not exist."),
  })
  .superRefine((input, ctx) => {
    if (input.status !== "missing" && !input.checksumMd5) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["checksumMd5"],
        message: "checksumMd5 is verplicht tenzij status='missing' expliciet is bevestigd.",
      });
    }
  });
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const normalizeApplyThemeDraftInput = (rawInput) => {
  if (!rawInput || typeof rawInput !== "object" || Array.isArray(rawInput)) {
    return rawInput;
  }

  return {
    draftId: rawInput.draftId ?? rawInput.draft_id,
    themeId: rawInput.themeId ?? rawInput.theme_id,
    themeRole: rawInput.themeRole ?? rawInput.theme_role ?? rawInput.role,
    expectedTargetFiles:
      rawInput.expectedTargetFiles ??
      rawInput.expected_target_files ??
      rawInput.expected,
    confirmation: rawInput.confirmation,
    reason: rawInput.reason,
  };
};

const ApplyThemeDraftInputSchema = z.preprocess(
  normalizeApplyThemeDraftInput,
  z
    .object({
      draftId: z
        .string()
        .min(1)
        .describe(
          "UUID draft ID returned by draft-theme-artifact. Gebruik hier geen bestandsnaam, slug of zelfverzonnen placeholder."
        ),
      themeId: z.coerce.number().int().positive().optional().describe("Optional explicit target theme ID."),
      themeRole: ThemeRoleSchema.optional().describe("Target theme role when themeId is omitted. Alleen 'main' is role-only toegestaan; gebruik themeId voor unpublished/demo/development themes."),
      expectedTargetFiles: z
        .array(ExpectedTargetFileSchema)
        .min(1)
        .max(10)
        .optional()
        .describe(
          "Fresh target-state preconditions for every file in the draft. Use checksumMd5 for existing files or status='missing' for new files."
        ),
      confirmation: z.literal("APPLY_THEME_DRAFT").describe("Verplicht type: 'APPLY_THEME_DRAFT' ter bevestiging."),
      reason: z.string().min(5).describe("Auditable reden voor het toepassen van dit draft."),
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

function normalizeChecksumMd5(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return null;
  }
  if (/^[a-f0-9]{32}$/i.test(raw)) {
    return Buffer.from(raw, "hex").toString("base64");
  }
  return raw;
}

function buildMissingTargetPreconditionResponse({ input, files }) {
  return {
    success: false,
    status: "needs_precondition",
    draftId: input.draftId,
    message:
      "Lees het apply-target eerst en geef expectedTargetFiles mee zodat apply-theme-draft niet blind bestaande theme files overschrijft.",
    errorCode: "apply_target_precondition_required",
    retryable: true,
    nextAction: "read_target_files_then_retry_apply",
    nextTool: "get-theme-files",
    nextArgsTemplate: {
      ...(input.themeId !== undefined ? { themeId: input.themeId } : {}),
      ...(input.themeRole ? { themeRole: input.themeRole } : {}),
      keys: files.map((file) => file.key),
      includeContent: false,
    },
    applyRetryArgsTemplate: {
      draftId: input.draftId,
      ...(input.themeId !== undefined ? { themeId: input.themeId } : {}),
      ...(input.themeRole ? { themeRole: input.themeRole } : {}),
      expectedTargetFiles: files.map((file) => ({
        key: file.key,
        checksumMd5: "<checksumMd5 from get-theme-files, or use status='missing'>",
      })),
      confirmation: "APPLY_THEME_DRAFT",
      reason: input.reason,
    },
  };
}

async function verifyApplyTargetPreconditions(shopifyClient, apiVersion, input, files) {
  const expectedByKey = new Map(
    (input.expectedTargetFiles || []).map((entry) => [entry.key, entry])
  );
  const missingExpected = files
    .map((file) => file.key)
    .filter((key) => !expectedByKey.has(key));
  if (missingExpected.length > 0) {
    return {
      ok: false,
      errorCode: "apply_target_precondition_required",
      failures: missingExpected.map((key) => ({
        key,
        status: "missing_expected_precondition",
        message: "expectedTargetFiles mist deze draft file.",
      })),
      actual: [],
    };
  }

  const actualResult = await getThemeFiles(shopifyClient, apiVersion, {
    themeId: input.themeId,
    themeRole: input.themeRole,
    keys: files.map((file) => file.key),
    includeContent: false,
  });
  const actualByKey = new Map((actualResult.files || []).map((file) => [file.key, file]));
  const failures = [];

  for (const file of files) {
    const expected = expectedByKey.get(file.key);
    const actual = actualByKey.get(file.key) || null;
    if (expected.status === "missing") {
      if (actual && !actual.missing) {
        failures.push({
          key: file.key,
          status: "expected_missing_but_found",
          expected: { status: "missing" },
          actual: {
            size: actual.size ?? null,
            checksumMd5: actual.checksumMd5 || actual.checksum || null,
            updatedAt: actual.updatedAt || null,
          },
        });
      }
      continue;
    }

    const expectedChecksum = normalizeChecksumMd5(expected.checksumMd5);
    const actualChecksum = normalizeChecksumMd5(actual?.checksumMd5 || actual?.checksum);
    if (!actual || actual.missing) {
      failures.push({
        key: file.key,
        status: "expected_existing_but_missing",
        expected: { checksumMd5: expectedChecksum },
        actual: null,
      });
      continue;
    }
    if (String(actualChecksum || "") !== String(expectedChecksum || "")) {
      failures.push({
        key: file.key,
        status: "checksum_mismatch",
        expected: { checksumMd5: expectedChecksum },
        actual: {
          size: actual.size ?? null,
          checksumMd5: actualChecksum,
          updatedAt: actual.updatedAt || null,
        },
      });
    }
  }

  return {
    ok: failures.length === 0,
    errorCode: failures.length > 0 ? "apply_target_precondition_failed" : null,
    failures,
    actual: actualResult.files || [],
  };
}

function getUpsertFailures(upsertResult) {
  return Array.isArray(upsertResult?.results)
    ? upsertResult.results.filter((result) => result?.status && result.status !== "applied")
    : [];
}

function getVerifyFailures(upsertResult) {
  const failures = [];
  if (upsertResult?.verifyError) {
    failures.push({
      key: null,
      status: "verify_error",
      error: upsertResult.verifyError,
    });
  }

  const summary = upsertResult?.verifySummary || {};
  if (Number(summary.mismatch || 0) > 0 || Number(summary.missing || 0) > 0) {
    for (const result of Array.isArray(upsertResult?.results) ? upsertResult.results : []) {
      if (result?.verify?.status && result.verify.status !== "match") {
        failures.push({
          key: result.key || null,
          status: result.verify.status,
          error: {
            message: `Verify-after-write status is '${result.verify.status}'.`,
            mismatches: result.verify.mismatches || [],
          },
        });
      }
    }
    if (failures.length === 0) {
      failures.push({
        key: null,
        status: "verify_failed",
        error: {
          message: "Verify-after-write summary bevat missing of mismatch resultaten.",
        },
      });
    }
  }

  return failures;
}

const applyThemeDraft = {
  name: "apply-theme-draft",
  title: "Promote Existing Draft",
  description:
    "Promote a previously saved theme draft to an explicit target theme. Do not use this to create a new section or for the first write of files. First create/write via create-theme-section or draft-theme-artifact, then apply only with the returned draftId.",
  docsDescription:
    "Apply a previously drafted theme artifact to an explicit target theme. Dit is de promote/apply stap nadat `draft-theme-artifact` of `create-theme-section` eerst een echte draft/write heeft voorbereid en geverifieerd. Gebruik deze tool dus niet om een nieuwe section voor het eerst te schrijven. `themeId` of `themeRole='main'` is verplicht; gebruik themeId voor development/unpublished/demo themes en kies nooit stilzwijgend een live target. Het draft moet bij dezelfde Shopify shop horen en verify-after-write moet matchen.",
  schema: ApplyThemeDraftInputSchema,
  execute: async (input, context = {}) => {
    if (!input.themeId && !input.themeRole) {
      return {
        success: false,
        status: "needs_input",
        draftId: input.draftId,
        message:
          "Geef expliciet aan op welk thema dit bestaande draft toegepast moet worden via themeRole of themeId.",
        errorCode: "missing_apply_theme_target",
        retryable: true,
        nextAction: "provide_theme_target",
        nextTool: "apply-theme-draft",
        nextArgsTemplate: {
          draftId: input.draftId,
          themeRole: "main",
          confirmation: "APPLY_THEME_DRAFT",
          reason: input.reason,
        },
        errors: [
          {
            path: ["themeRole"],
            problem:
              "Er ontbreekt een expliciet apply-target. Deze tool kiest nooit stilzwijgend een theme.",
            fixSuggestion:
              "Voeg themeRole of themeId toe, bijvoorbeeld themeRole='main' of themeId=123456789.",
          },
        ],
      };
    }
    if (!UUID_PATTERN.test(input.draftId)) {
      return {
        success: false,
        status: "invalid_input",
        draftId: input.draftId,
        message:
          "apply-theme-draft verwacht een echte UUID draftId van een eerdere create/write stap. Gebruik deze tool niet voor de eerste write van een nieuwe section.",
        errorCode: "invalid_apply_theme_draft_id",
        retryable: true,
        nextAction: "create_or_write_first",
        nextTool: "create-theme-section",
        nextArgsTemplate: {
          ...(input.themeId !== undefined ? { themeId: input.themeId } : {}),
          ...(input.themeRole ? { themeRole: input.themeRole } : {}),
          key: "sections/<new-section>.liquid",
          liquid: "<complete Shopify Liquid section with valid {% schema %}>",
        },
        errors: [
          {
            path: ["draftId"],
            problem:
              "draftId is geen geldige UUID van een eerder theme draft record.",
            fixSuggestion:
              "Gebruik voor een nieuwe section eerst create-theme-section of draft-theme-artifact en hergebruik daarna pas de geretourneerde draftId.",
          },
        ],
      };
    }
    const draftRecord = await getThemeDraftRecord(input.draftId);
    if (!draftRecord) {
      return {
        success: false,
        status: "missing_draft",
        draftId: input.draftId,
        message:
          `Theme draft '${input.draftId}' kon niet worden gevonden. Voor de eerste write van een nieuwe section gebruik je create-theme-section of draft-theme-artifact.`,
        errorCode: "missing_theme_draft",
        retryable: true,
        nextAction: "create_or_write_first",
        nextTool: "draft-theme-artifact",
        nextArgsTemplate: {
          ...(input.themeId !== undefined ? { themeId: input.themeId } : {}),
          ...(input.themeRole ? { themeRole: input.themeRole } : {}),
          mode: "edit",
          files: [
            {
              key: "<theme-file>",
              value: "<complete file content or use patch/patches for edits>",
            },
          ],
        },
        errors: [
          {
            path: ["draftId"],
            problem:
              "Er bestaat geen opgeslagen theme draft record met deze draftId.",
            fixSuggestion:
              "Voer eerst een create/write uit via create-theme-section of draft-theme-artifact en gebruik daarna de echte draftId uit die response.",
          },
        ],
      };
    }

    if (draftRecord.status !== "preview_applied") {
      return {
        success: false,
        status: "invalid_draft_status",
        draftId: input.draftId,
        message:
          `Theme draft '${input.draftId}' heeft status '${draftRecord.status}' en is niet veilig toepasbaar. Alleen preview_applied drafts mogen worden gepromoot.`,
        errorCode: "invalid_apply_theme_draft_status",
        retryable: true,
        nextAction: "create_or_write_preview_first",
        nextTool: "draft-theme-artifact",
        errors: [
          {
            path: ["draftId"],
            problem:
              "Het draft is niet succesvol naar een preview/target geschreven en geverifieerd.",
            fixSuggestion:
              "Voer eerst draft-theme-artifact of create-theme-section opnieuw uit totdat status preview_ready/preview_applied is.",
          },
        ],
      };
    }

    const shopifyClient = requireShopifyClient(context);
    const currentShopDomain = getShopDomainFromClient(shopifyClient);
    const draftShopDomain = String(draftRecord.shop_domain || "").trim().toLowerCase();
    if (draftShopDomain && draftShopDomain !== currentShopDomain) {
      return {
        success: false,
        status: "draft_shop_mismatch",
        draftId: input.draftId,
        message:
          "Dit theme draft hoort bij een andere Shopify shop en kan niet in deze requestcontext worden toegepast.",
        errorCode: "theme_draft_shop_mismatch",
        retryable: false,
        errors: [
          {
            path: ["draftId"],
            problem: `Draft shop '${draftShopDomain}' komt niet overeen met request shop '${currentShopDomain}'.`,
            fixSuggestion:
              "Gebruik de draftId die is aangemaakt binnen dezelfde gekoppelde Shopify shop, of maak een nieuw draft voor deze shop.",
          },
        ],
      };
    }

    const files = normalizeStoredFiles(draftRecord.files_json);
    if (files.length === 0) {
      return {
        success: false,
        status: "missing_draft_files",
        draftId: input.draftId,
        message: `Theme draft '${input.draftId}' bevat geen toepasbare files.`,
        errorCode: "missing_theme_draft_files",
        retryable: true,
        nextAction: "rewrite_draft_first",
        nextTool: "draft-theme-artifact",
      };
    }

    const apiVersion = process.env.SHOPIFY_API_VERSION || "2026-01";
    if (!Array.isArray(input.expectedTargetFiles) || input.expectedTargetFiles.length === 0) {
      return buildMissingTargetPreconditionResponse({ input, files });
    }

    const targetPrecondition = await verifyApplyTargetPreconditions(
      shopifyClient,
      apiVersion,
      input,
      files
    );
    if (!targetPrecondition.ok) {
      return {
        success: false,
        status: "target_precondition_failed",
        draftId: input.draftId,
        message:
          "Het apply-target komt niet overeen met de opgegeven expectedTargetFiles. Lees het target opnieuw en bevestig de nieuwe checksum/status voordat je toepast.",
        errorCode: targetPrecondition.errorCode,
        retryable: true,
        nextAction: "refresh_target_read_before_apply",
        nextTool: "get-theme-files",
        failures: targetPrecondition.failures,
        actual: targetPrecondition.actual.map((file) => ({
          key: file.key,
          found: Boolean(file.found),
          missing: Boolean(file.missing),
          size: file.size ?? null,
          checksumMd5: file.checksumMd5 || file.checksum || null,
          updatedAt: file.updatedAt || null,
        })),
      };
    }

    const upsertResult = await upsertThemeFiles(shopifyClient, apiVersion, {
      themeId: input.themeId,
      themeRole: input.themeRole,
      files: files.map((file) => ({ key: file.key, value: file.value })),
      verifyAfterWrite: true,
    });

    const failedApplyWrites = getUpsertFailures(upsertResult);
    const failedApplyVerifications = getVerifyFailures(upsertResult);
    if (
      failedApplyWrites.length > 0 ||
      failedApplyVerifications.length > 0 ||
      Number(upsertResult?.summary?.applied || 0) !== files.length
    ) {
      const firstFailure = failedApplyWrites[0] || failedApplyVerifications[0] || null;
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
          firstFailure?.error?.message ||
          "Het draft kon niet volledig op het gekozen target worden toegepast.",
        errorCode: failedApplyWrites.some((result) => result.status === "failed_precondition")
          ? "apply_failed_precondition"
          : failedApplyVerifications.length > 0
          ? "apply_verify_failed"
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
    const auditLog = await createMutationAuditLog({
      toolName: "apply-theme-draft",
      tenantId: context?.tenantId || null,
      shopDomain,
      requestId: context?.requestId || null,
      reason: input.reason,
      targetIds: [
        ...(upsertResult.theme?.id ? [`theme:${upsertResult.theme.id}`] : []),
        ...files.map((file) => file.key),
      ],
      payload: {
        confirmation: input.confirmation,
        draftId: input.draftId,
        themeId: upsertResult.theme?.id || input.themeId || null,
        themeRole: upsertResult.theme?.role || input.themeRole || null,
        expectedTargetFiles: input.expectedTargetFiles,
        verify: {
          summary: upsertResult.verifySummary || null,
          results: upsertResult.results || [],
        },
      },
    });
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
      audit: {
        auditLogId: auditLog?.id || null,
        reason: input.reason,
        requestId: context?.requestId || null,
        tenantId: context?.tenantId || null,
        shopDomain,
        targetIds: [
          ...(upsertResult.theme?.id ? [`theme:${upsertResult.theme.id}`] : []),
          ...files.map((file) => file.key),
        ],
      },
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
