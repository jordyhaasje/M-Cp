import { z } from "zod";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { check } from "@shopify/theme-check-node";
import {
  createThemeDraftRecord,
  updateThemeDraftRecord,
} from "../lib/db.js";
import { getShopDomainFromClient, upsertThemeFiles } from "../lib/themeFiles.js";
import { requireShopifyClient } from "./_context.js";

export const toolName = "draft-theme-artifact";
export const description = `Draft and validate Shopify theme files through the guarded preview pipeline. This is the only supported remote create/update path for theme artifacts: files are inspected, linted, stored in theme_drafts, pushed to a preview-safe target by default, and verified after write before they are ready for merchant review.

⚠️ EXTREMELY CRITICAL STRICT CODE GENERATION RULES ⚠️
Rule 1 (UI/UX): Code MUST represent modern, premium Shopify 2.0 UI. NEVER use visible native scrollbars (::-webkit-scrollbar { display: none; }). Use modern CSS (scroll-snap-type, display: grid, gap, aspect-ratio).
Rule 2 (Dynamic Schema): NEVER hardcode texts, colors, or image URLs in the HTML. EVERY visual element MUST be bound to a setting in the {% schema %} (using color_picker, image_picker, text, richtext, range for spacing/layout controls).
Rule 3 (Blocks): Sliders, grids, and galleries MUST use the blocks architecture so merchants can add/remove/reorder content in the editor.
Rule 4 (Presets): Every section MUST have a complete presets array with default blocks so it appears in the Theme Editor.
Rule 5 (Mobile First): Always include responsive CSS (media queries) so the layout adapts flawlessly to mobile.`;

const ThemeRoleSchema = z.enum(["main", "unpublished", "development"]);

const ReferenceSourceSchema = z
  .object({
    url: z.string().url().optional(),
    cssSelector: z.string().optional(),
    imageUrls: z.array(z.string().url()).max(8).optional(),
  })
  .partial();

const ReferenceSpecSchema = z
  .object({
    version: z.number().int().positive().optional(),
    sources: z.array(z.object({ type: z.string(), url: z.string().url() })).optional(),
    fidelityGaps: z.array(z.string()).optional(),
  })
  .passthrough();

const ThemeDraftFileSchema = z.object({
  key: z.string().min(1).describe("De exacte filelocatie (bijv. sections/feature-sandbox.liquid)"),
  value: z
    .string()
    .describe(
      "De volledige inhoud / broncode voor deze sandbox preview. Payloads falen als ze niet Shopify OS 2.0 proof zijn: scoped CSS, geldige schema settings en een presets-array zijn verplicht."
    ),
});

export const inputSchema = z.object({
  files: z.array(ThemeDraftFileSchema).min(1).max(10).describe("Maximale file batch is 10 items conform veiligheidsregels"),
  themeId: z.string().or(z.number()).optional().describe("Optioneel expliciet doel theme ID. Laat weg om via themeRole te resolven."),
  themeRole: ThemeRoleSchema.default("development").describe("Preview target. Standaard wordt naar een development theme geschreven."),
  isStandalone: z.boolean().optional().describe("Mark as standalone workflow"),
  referenceInput: ReferenceSourceSchema.optional().describe("Optionele brondata van reference analysis voor draft audit trail."),
  referenceSpec: ReferenceSpecSchema.optional().describe("Optionele gestructureerde referenceSpec voor draft audit trail."),
});

function inspectSectionFile(file) {
  const value = file.value;
  const warnings = [];
  const hasMedia = value.includes("@media");
  const hasRange = value.includes('"type": "range"') || value.includes("'type': 'range'") || value.includes('"type":"range"');
  const hasColor =
    value.includes('"type": "color"') ||
    value.includes("'type': 'color'") ||
    value.includes('"type":"color"') ||
    value.includes("color_background");
  const hasPresets = value.includes('"presets":') || value.includes("'presets':") || value.includes('"presets":');

  if (!hasMedia || !hasRange || !hasColor || !hasPresets) {
    return {
      ok: false,
      status: "inspection_failed",
      message:
        "Building Inspection Failed: Your code was rejected because it is too generic. It is missing mobile responsiveness (@media queries) and/or rich schema settings (range, color) and/or presets. Rewrite the code to match a premium Shopify OS 2.0 section.",
      warnings,
    };
  }

  const hasGridOrFlex =
    value.includes("display: grid") ||
    value.includes("display:grid") ||
    value.includes("display: flex") ||
    value.includes("display:flex");
  const hasPadding = value.includes("padding:");
  const hasBorderRadius = value.includes("border-radius:");
  const hasBoxShadow = value.includes("box-shadow:");
  if (!hasGridOrFlex || !hasPadding || (!hasBorderRadius && !hasBoxShadow)) {
    return {
      ok: false,
      status: "inspection_failed",
      message:
        "Building Inspection Failed: Your code was rejected. The CSS styling is too basic. Use richer custom CSS with layout primitives, spacing, and premium visual treatment such as border-radius or box-shadow.",
      warnings,
    };
  }

  if (file.key === "layout/theme.liquid") {
    warnings.push("layout/theme.liquid is a critical file. Confirm content_for_header and content_for_layout are preserved.");
  }

  return { ok: true, warnings };
}

function normalizeLintErrors(offenses, tmpDir) {
  return offenses.map((offense) => ({
    file: offense.uri ? offense.uri.replace(`file://${tmpDir}/`, "") : "root",
    check: offense.check || "Unknown",
    message: offense.message,
    severity: offense.severity === 0 ? "error" : "warning",
    start: offense.start || null,
  }));
}

function buildDraftPayload(record, { targetTheme, verifySummary, verifyResults, warnings = [] } = {}) {
  return {
    id: record?.id || null,
    status: record?.status || null,
    shopDomain: record?.shop_domain || null,
    previewThemeId: record?.preview_theme_id ?? null,
    appliedThemeId: record?.applied_theme_id ?? null,
    targetTheme: targetTheme || null,
    warnings,
    verifySummary: verifySummary || null,
    verifyResults: verifyResults || null,
    updatedAt: record?.updated_at || null,
  };
}

export const draftThemeArtifact = {
  name: toolName,
  description,
  schema: inputSchema,
  execute: async (args, context = {}) => {
    const shopifyClient = requireShopifyClient(context);
    const { files, themeId, themeRole, referenceInput, referenceSpec } = args;

    const shopDomain = getShopDomainFromClient(shopifyClient);
    const warnings = [];

    for (const file of files) {
      if (file.key.endsWith(".liquid") && file.key.startsWith("sections/")) {
        const inspection = inspectSectionFile(file);
        if (!inspection.ok) {
          return {
            success: false,
            status: inspection.status,
            message: inspection.message,
            warnings: inspection.warnings || [],
          };
        }
        warnings.push(...inspection.warnings);
      }
    }

    if (!themeId && themeRole === "main") {
      warnings.push("Preview draft is writing to the live main theme because themeRole=main was explicitly requested.");
    }

    let draftRecord = await createThemeDraftRecord({
      shopDomain,
      status: "pending",
      files,
      referenceInput: referenceInput || null,
      referenceSpec: referenceSpec || null,
    });
    const draftId = draftRecord?.id || `mock-${Date.now()}`;

    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "hazify-sandbox-"));
    let lintErrors = null;

    try {
      await fs.mkdir(path.join(tmpDir, "locales"), { recursive: true });
      for (const file of files) {
        const fullPath = path.join(tmpDir, file.key);
        await fs.mkdir(path.dirname(fullPath), { recursive: true });
        await fs.writeFile(fullPath, file.value, "utf8");
      }

      const offenses = await check(tmpDir);
      const criticalErrors = offenses.filter((offense) => offense.severity === 0);
      if (criticalErrors.length > 0) {
        lintErrors = normalizeLintErrors(criticalErrors, tmpDir);
      }
    } catch (error) {
      lintErrors = [
        {
          file: "root",
          check: "theme-check-runtime",
          message: `Linter runtime error: ${error.message}`,
          severity: "error",
          start: null,
        },
      ];
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }

    if (lintErrors) {
      draftRecord = await updateThemeDraftRecord(draftId, {
        status: "lint_failed",
        lintReport: {
          summary: {
            total: lintErrors.length,
            errors: lintErrors.length,
          },
          errors: lintErrors,
        },
      });
      return {
        success: false,
        status: "lint_failed",
        draftId,
        message: "Linter heeft syntaxfouten gevonden in de Liquid code. Fix deze bestanden voordat ze naar een preview theme worden gepusht.",
        errors: lintErrors,
        warnings,
        draft: buildDraftPayload(draftRecord, { warnings }),
      };
    }

    try {
      const apiVersion = process.env.SHOPIFY_API_VERSION || "2026-01";
      const upsertResult = await upsertThemeFiles(shopifyClient, apiVersion, {
        themeId: themeId ? String(themeId) : undefined,
        themeRole,
        files: files.map((file) => ({ key: file.key, value: file.value })),
        verifyAfterWrite: true,
      });

      draftRecord = await updateThemeDraftRecord(draftId, {
        status: "preview_applied",
        lintReport: {
          summary: {
            total: 0,
            errors: 0,
          },
          errors: [],
        },
        verifyResult: {
          summary: upsertResult.verifySummary || null,
          results: upsertResult.results || [],
        },
        previewThemeId: upsertResult.theme?.id || null,
      });

      const appliedThemeId = upsertResult.theme?.id || themeId || null;
      const targetTheme = upsertResult.theme
        ? {
            id: upsertResult.theme.id,
            name: upsertResult.theme.name,
            role: upsertResult.theme.role,
          }
        : {
            id: typeof themeId === "number" || (typeof themeId === "string" && themeId) ? Number(themeId) : null,
            name: null,
            role: themeRole,
          };

      return {
        success: true,
        status: "preview_ready",
        draftId,
        themeId: appliedThemeId,
        editorUrl: appliedThemeId ? `https://${shopDomain}/admin/themes/${appliedThemeId}/editor` : null,
        message: "Code is geverifieerd en naar het preview target gepusht.",
        target: targetTheme,
        verify: {
          summary: upsertResult.verifySummary || null,
          results: upsertResult.results || [],
        },
        warnings,
        draft: buildDraftPayload(draftRecord, {
          targetTheme,
          verifySummary: upsertResult.verifySummary || null,
          verifyResults: upsertResult.results || [],
          warnings,
        }),
      };
    } catch (error) {
      draftRecord = await updateThemeDraftRecord(draftId, {
        status: "preview_failed",
      });
      throw new Error(`Na linten faalde de Shopify preview upload: ${error.message}`);
    }
  },
};
