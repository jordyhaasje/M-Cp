import { z } from "zod";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { check } from "@shopify/theme-check-node";
import { createThemeDraftRecord, updateThemeDraftRecord } from "../lib/db.js";
import { getShopDomainFromClient, upsertThemeFiles } from "../lib/themeFiles.js";
import { requireShopifyClient } from "./_context.js";

export const toolName = "draft-theme-artifact";
export const description = `Draft and validate Shopify theme files through the guarded preview pipeline. This is the only supported remote create/update path for theme artifacts: files are inspected, linted, stored in theme_drafts, pushed to a preview-safe target by default, and verified after write before they are ready for merchant review.

⚠️ EXTREMELY CRITICAL STRICT CODE GENERATION RULES ⚠️
Rule 1 (UI/UX): Code MUST represent modern, premium Shopify 2.0 UI. NEVER use visible native scrollbars (::-webkit-scrollbar { display: none; }). Use modern CSS (scroll-snap-type, display: grid, gap, aspect-ratio).
Rule 2 (Dynamic Schema): NEVER hardcode texts, colors, or image URLs in the HTML. EVERY visual element MUST be bound to a setting in the {% schema %} (using color_picker, image_picker, text, richtext, range for spacing/layout controls).
Rule 3 (Blocks): Sliders, grids, and galleries MUST use the blocks architecture so merchants can add/remove/reorder content in the editor.
Rule 4 (Presets): Every section MUST have a complete presets array with default blocks so it appears in the Theme Editor.
Rule 5 (Shopify Constraints): Do not place Liquid inside {% stylesheet %} or {% javascript %}; use <style> or markup-level CSS variables when section.id scoping is required.`;

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

const SectionBlueprintSchema = z
  .object({
    version: z.number().int().positive().optional(),
    archetype: z.string().optional(),
    recommendedPrimaryFile: z.string().optional(),
    mediaPolicy: z.object({}).passthrough().optional(),
  })
  .passthrough();

const ThemeDraftFileSchema = z.object({
  key: z.string().min(1).describe("De exacte filelocatie (bijv. sections/feature-sandbox.liquid)"),
  value: z
    .string()
    .describe(
      "De volledige inhoud / broncode voor deze sandbox preview. Payloads falen als ze niet Shopify OS 2.0 proof zijn: geldige schema settings en een presets-array zijn verplicht."
    ),
});

export const inputSchema = z.object({
  files: z.array(ThemeDraftFileSchema).min(1).max(10).describe("Maximale file batch is 10 items conform veiligheidsregels"),
  themeId: z.string().or(z.number()).optional().describe("Optioneel expliciet doel theme ID. Laat weg om via themeRole te resolven."),
  themeRole: ThemeRoleSchema.default("development").describe("Preview target. Standaard wordt naar een development theme geschreven."),
  isStandalone: z.boolean().optional().describe("Mark as standalone workflow"),
  referenceInput: ReferenceSourceSchema.optional().describe("Optionele brondata van reference analysis voor draft audit trail."),
  referenceSpec: ReferenceSpecSchema.optional().describe("Optionele gestructureerde referenceSpec voor draft audit trail."),
  sectionBlueprint: SectionBlueprintSchema.optional().describe("Optionele blueprint of section-plan uit prepare-section-from-reference zodat de draft minder vrij hoeft te interpreteren."),
});

function extractSchemaJson(value) {
  const match = String(value || "").match(/{%\s*schema\s*%}([\s\S]*?){%\s*endschema\s*%}/i);
  return match ? match[1].trim() : null;
}

function parseSectionSchema(value) {
  const schemaJson = extractSchemaJson(value);
  if (!schemaJson) {
    return { schema: null, error: "Missing {% schema %} block." };
  }

  try {
    return {
      schema: JSON.parse(schemaJson),
      error: null,
    };
  } catch (error) {
    return {
      schema: null,
      error: `Invalid schema JSON: ${error.message}`,
    };
  }
}

function getSpecialBlockContents(value, tagName) {
  return Array.from(
    String(value || "").matchAll(
      new RegExp(`{%\\s*${tagName}\\s*%}([\\s\\S]*?){%\\s*end${tagName}\\s*%}`, "gi")
    ),
    (match) => match[1] || ""
  );
}

function containsLiquidInSpecialBlock(value, tagName) {
  return getSpecialBlockContents(value, tagName).some((block) => /({{)|({%)/.test(block));
}

function collectRawImgTags(value) {
  return Array.from(String(value || "").matchAll(/<img\b([^>]*)>/gi), (match) => match[1] || "");
}

function hasRawImgWithoutDimensions(value) {
  return collectRawImgTags(value).some(
    (attributes) => !/\bwidth\s*=\s*["'][^"']+["']/i.test(attributes) || !/\bheight\s*=\s*["'][^"']+["']/i.test(attributes)
  );
}

function inspectSectionFile(file, { sectionBlueprint } = {}) {
  const value = String(file.value || "");
  const warnings = [];
  const suggestedFixes = [];

  if (/^(templates|config)\//.test(file.key)) {
    return {
      ok: false,
      status: "inspection_failed",
      errorCode: "inspection_failed_schema",
      retryable: false,
      message:
        "Template/config writes zijn niet toegestaan in deze flow. Draft alleen losse theme bronbestanden en laat placement via de Theme Editor lopen.",
      warnings,
      suggestedFixes: [
        "Verwijder templates/*.json of config/*.json uit deze draft batch.",
        "Beperk nieuwe section-cloning standaard tot één file: sections/<handle>.liquid.",
      ],
      shouldNarrowScope: true,
    };
  }

  if (containsLiquidInSpecialBlock(value, "stylesheet") || containsLiquidInSpecialBlock(value, "javascript")) {
    return {
      ok: false,
      status: "inspection_failed",
      errorCode: "inspection_failed_css",
      retryable: true,
      message:
        "Shopify rendert geen Liquid binnen {% stylesheet %} of {% javascript %}. Gebruik <style> of markup-level CSS variables wanneer section.id-scoping nodig is.",
      warnings,
      suggestedFixes: [
        "Verplaats Liquid-afhankelijke CSS naar een <style> block.",
        "Laat {% stylesheet %} en {% javascript %} alleen statische CSS/JS bevatten.",
      ],
      shouldNarrowScope: false,
    };
  }

  const { schema, error } = parseSectionSchema(value);
  if (error || !schema) {
    return {
      ok: false,
      status: "inspection_failed",
      errorCode: "inspection_failed_schema",
      retryable: true,
      message:
        "Building Inspection Failed: section files moeten een geldige {% schema %} JSON-definitie bevatten.",
      warnings,
      suggestedFixes: [
        "Voeg een valide {% schema %} block toe.",
        "Controleer of de schema JSON parsebaar is en presets bevat.",
        error || "Schema ontbreekt volledig.",
      ].filter(Boolean),
      shouldNarrowScope: false,
    };
  }

  const settings = Array.isArray(schema.settings) ? schema.settings : [];
  const blocks = Array.isArray(schema.blocks) ? schema.blocks : [];
  const presets = Array.isArray(schema.presets) ? schema.presets : [];
  const archetype = String(sectionBlueprint?.archetype || "").trim();
  const prefersImageTag = sectionBlueprint?.mediaPolicy?.preferImageTag !== false;

  if (hasRawImgWithoutDimensions(value)) {
    return {
      ok: false,
      status: "inspection_failed",
      errorCode: "inspection_failed_media",
      retryable: true,
      message:
        "Building Inspection Failed: raw <img> tags zonder width en height veroorzaken instabiele Shopify sections. Gebruik image_url + image_tag of geef expliciete afmetingen mee.",
      warnings,
      suggestedFixes: [
        prefersImageTag
          ? "Vervang raw <img> door Shopify image_url + image_tag zodat width/height automatisch goed mee kunnen komen."
          : "Geef expliciete width en height attributen mee aan elke raw <img> tag.",
        archetype
          ? `Houd de media-output afgestemd op blueprint archetype '${archetype}' in plaats van generieke afbeeldingstags.`
          : "Gebruik image_picker, collection of andere Shopify resource settings voor merchant-editable media.",
      ],
      shouldNarrowScope: false,
    };
  }

  if (presets.length === 0) {
    return {
      ok: false,
      status: "inspection_failed",
      errorCode: "inspection_failed_schema",
      retryable: true,
      message:
        "Building Inspection Failed: nieuwe sections moeten presets bevatten zodat ze zichtbaar zijn in de Theme Editor.",
      warnings,
      suggestedFixes: [
        "Voeg minimaal één preset toe aan de schema JSON.",
        "Geef de preset default blocks mee wanneer de section herhaalbare content gebruikt.",
      ],
      shouldNarrowScope: false,
    };
  }

  const settingTypes = new Set([
    ...settings.map((setting) => String(setting?.type || "")),
    ...blocks.flatMap((block) =>
      Array.isArray(block?.settings) ? block.settings.map((setting) => String(setting?.type || "")) : []
    ),
  ]);

  const hasScopedCss = /{%\s*stylesheet\s*%}|<style\b/i.test(value);
  const hasResponsive = /@media\b|clamp\(/i.test(value);
  const hasLayoutPrimitive =
    /display\s*:\s*(?:grid|flex|inline-grid|inline-flex)/i.test(value) ||
    /grid-template-columns\s*:/i.test(value) ||
    /flex-direction\s*:/i.test(value);
  const hasSpacing = /(?:padding|margin|gap)\s*:/i.test(value);
  const hasVisualTreatment = /(?:border-radius|box-shadow|background(?:-color)?|border)\s*:/i.test(value);
  const cssSignalCount = [hasResponsive, hasLayoutPrimitive, hasSpacing, hasVisualTreatment].filter(Boolean).length;

  if (hasScopedCss && cssSignalCount <= 1) {
    return {
      ok: false,
      status: "inspection_failed",
      errorCode: "inspection_failed_css",
      retryable: true,
      message:
        "Building Inspection Failed: de section bevat lokale CSS, maar die is te minimaal om als premium standalone section te slagen.",
      warnings,
      suggestedFixes: [
        "Voeg responsieve regels, spacing en een duidelijke layout primitive toe.",
        "Gebruik grid/flex wanneer de reference een meerkoloms of card-based layout heeft.",
        "Geef de section een visuele afwerking zoals border-radius, borders of background treatment.",
      ],
      shouldNarrowScope: false,
    };
  }

  if (!hasScopedCss) {
    warnings.push("No local <style> or {% stylesheet %} block detected. Zorg dat standalone sections hun eigen component-styling meenemen.");
  }
  if (!hasResponsive) {
    warnings.push("No explicit responsive hint detected. Voeg waar nodig @media of clamp() toe.");
    suggestedFixes.push("Voeg responsieve spacing en stacking toe voor mobiele breakpoints.");
  }
  if (!settingTypes.has("range")) {
    warnings.push("Schema mist een range setting voor spacing/layout. Dit is niet verplicht, maar wel aanbevolen.");
    suggestedFixes.push("Voeg minimaal één range setting toe voor spacing of layoutcontrole.");
  }
  if (!settingTypes.has("color")) {
    warnings.push("Schema mist een color setting voor merchant-editable styling. Dit is aanbevolen voor reference-based sections.");
    suggestedFixes.push("Voeg color settings toe voor achtergrond, tekst of accentkleuren.");
  }
  if (!settingTypes.has("image_picker") && /<img\b|image_tag|svg/i.test(value)) {
    warnings.push("Reference lijkt media te gebruiken, maar schema bevat geen image_picker.");
    suggestedFixes.push("Voeg een image_picker toe wanneer imagery of logo's merchant-editable moeten zijn.");
  }

  return {
    ok: true,
    warnings,
    suggestedFixes,
  };
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
    lintReport: record?.lint_report_json ?? null,
    verifySummary: verifySummary || record?.verify_result_json?.summary || null,
    verifyResults: verifyResults || record?.verify_result_json?.results || null,
    updatedAt: record?.updated_at || null,
  };
}

function buildFailureResponse({
  status,
  message,
  draftId,
  warnings = [],
  errors,
  draft,
  errorCode,
  retryable,
  suggestedFixes = [],
  shouldNarrowScope = false,
}) {
  return {
    success: false,
    status,
    ...(draftId ? { draftId } : {}),
    message,
    ...(errors ? { errors } : {}),
    warnings,
    ...(draft ? { draft } : {}),
    errorCode,
    retryable,
    suggestedFixes: uniqueStrings(suggestedFixes),
    shouldNarrowScope,
  };
}

function uniqueStrings(values) {
  return Array.from(new Set((values || []).filter(Boolean)));
}

function suggestFixesFromLintErrors(lintErrors = []) {
  return uniqueStrings(
    lintErrors.slice(0, 5).flatMap((error) => {
      if (error.check === "ImgWidthAndHeight") {
        return [
          `${error.file}: gebruik image_url + image_tag in plaats van een raw <img> zonder betrouwbare afmetingen.`,
          `${error.file}: als een raw <img> toch nodig is, voeg dan expliciete width en height attributen toe.`,
        ];
      }
      return `${error.file}: ${error.message}`;
    })
  );
}

function classifyLintErrors(lintErrors = [], files = []) {
  if (lintErrors.some((error) => error.check === "ImgWidthAndHeight")) {
    return {
      errorCode: "lint_failed_img_dimensions",
      retryable: true,
      shouldNarrowScope: false,
      suggestedFixes: suggestFixesFromLintErrors(lintErrors),
    };
  }

  return {
    errorCode: "lint_failed_liquid",
    retryable: true,
    shouldNarrowScope: files.length > 3,
    suggestedFixes: suggestFixesFromLintErrors(lintErrors),
  };
}

function classifyPreviewUploadError(error, files) {
  const message = String(error?.message || error || "");
  if (/Geen theme gevonden met role|Theme met ID .* niet gevonden|theme of bestand niet gevonden/i.test(message)) {
    return {
      errorCode: "preview_target_ambiguous",
      retryable: true,
      shouldNarrowScope: false,
      suggestedFixes: [
        "Geef expliciet themeId mee als het development/unpublished target niet eenduidig resolveert.",
        "Controleer of het bedoelde preview theme bestaat en beschikbaar is voor deze shop.",
      ],
    };
  }

  if (/locked by another operation/i.test(message)) {
    return {
      errorCode: "preview_upload_failed",
      retryable: true,
      shouldNarrowScope: false,
      suggestedFixes: ["Wacht kort en probeer dezelfde draft opnieuw zodra de file lock is vrijgegeven."],
    };
  }

  return {
    errorCode: "preview_upload_failed",
    retryable: true,
    shouldNarrowScope: files.length > 3,
    suggestedFixes: [
      "Beperk de draft eventueel tot minder files om de fout nauwkeuriger te isoleren.",
      "Controleer of alle keys, schema's en Liquid syntax overeenkomen met Shopify theme regels.",
    ],
  };
}

export const draftThemeArtifact = {
  name: toolName,
  description,
  schema: inputSchema,
  execute: async (args, context = {}) => {
    const shopifyClient = requireShopifyClient(context);
    const { files, themeId, themeRole, referenceInput, referenceSpec, sectionBlueprint } = args;
    const effectiveReferenceSpec =
      sectionBlueprint || referenceSpec
        ? {
            ...(referenceSpec || {}),
            ...(sectionBlueprint ? { sectionBlueprint } : {}),
          }
        : null;
    const warnings = [];
    const suggestedFixes = [];

    if (!themeId && themeRole === "main") {
      warnings.push("Preview draft is writing to the live main theme because themeRole=main was explicitly requested.");
    }

    if (files.length > 1) {
      warnings.push(
        "Default file policy for new reference-based sections is one sections/<handle>.liquid file. Extra files should only be added when there is a concrete need."
      );
    }

    for (const file of files) {
      if (file.key.endsWith(".liquid") && file.key.startsWith("sections/")) {
        const inspection = inspectSectionFile(file, { sectionBlueprint });
        if (!inspection.ok) {
          return buildFailureResponse({
            status: inspection.status,
            message: inspection.message,
            warnings: inspection.warnings || [],
            errorCode: inspection.errorCode,
            retryable: inspection.retryable,
            suggestedFixes: inspection.suggestedFixes || [],
            shouldNarrowScope: inspection.shouldNarrowScope || false,
          });
        }
        warnings.push(...(inspection.warnings || []));
        suggestedFixes.push(...(inspection.suggestedFixes || []));
      }
    }

    const shopDomain = getShopDomainFromClient(shopifyClient);

    let draftRecord = await createThemeDraftRecord({
      shopDomain,
      status: "pending",
      files,
      referenceInput: referenceInput || null,
      referenceSpec: effectiveReferenceSpec,
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
      const classifiedLint = classifyLintErrors(lintErrors, files);
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
      return buildFailureResponse({
        status: "lint_failed",
        draftId,
        message: "Linter heeft syntaxfouten gevonden in de Liquid code. Fix deze bestanden voordat ze naar een preview theme worden gepusht.",
        errors: lintErrors,
        warnings,
        draft: buildDraftPayload(draftRecord, { warnings }),
        errorCode: classifiedLint.errorCode,
        retryable: classifiedLint.retryable,
        suggestedFixes: [...suggestedFixes, ...classifiedLint.suggestedFixes],
        shouldNarrowScope: classifiedLint.shouldNarrowScope,
      });
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
        suggestedFixes: uniqueStrings(suggestedFixes),
      };
    } catch (error) {
      draftRecord = await updateThemeDraftRecord(draftId, {
        status: "preview_failed",
      });
      const classified = classifyPreviewUploadError(error, files);
      return buildFailureResponse({
        status: "preview_failed",
        draftId,
        message: `Na linten faalde de Shopify preview upload: ${error.message}`,
        warnings,
        draft: buildDraftPayload(draftRecord, { warnings }),
        errorCode: classified.errorCode,
        retryable: classified.retryable,
        suggestedFixes: [...suggestedFixes, ...classified.suggestedFixes],
        shouldNarrowScope: classified.shouldNarrowScope,
      });
    }
  },
};
