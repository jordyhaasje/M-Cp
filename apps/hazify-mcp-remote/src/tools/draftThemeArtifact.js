import { z } from "zod";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { check } from "@shopify/theme-check-node";
import { createThemeDraftRecord, updateThemeDraftRecord } from "../lib/db.js";
import { getShopDomainFromClient, upsertThemeFiles } from "../lib/themeFiles.js";
import { requireShopifyClient } from "./_context.js";

export const toolName = "draft-theme-artifact";
export const description = `Draft and validate Shopify theme files through the guarded pipeline.

Modes:
- mode="create": Volledige inspectie voor nieuwe sections (schema, presets, CSS kwaliteit verplicht). Templates/config geblokkeerd.
- mode="edit": Lichtere inspectie voor wijzigingen aan bestaande bestanden. Templates/config TOEGESTAAN met JSON validatie.

Beide modes: Liquid-in-stylesheet check, theme-check linting, layout/theme.liquid bescherming.

Belangrijk: themeRole of themeId is verplicht. Vraag de gebruiker welk thema als dit niet is opgegeven.

Rules for valid Shopify Liquid:

Do not place Liquid inside {% stylesheet %} or {% javascript %}

Use <style> or markup-level CSS variables for section.id scoping`;

const ThemeRoleSchema = z.enum(["main", "unpublished", "development"]);

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
  themeRole: ThemeRoleSchema.optional().describe("Target theme role. Verplicht als themeId niet is opgegeven. Vraag de gebruiker welk thema."),
  mode: z.enum(["create", "edit"]).default("create").describe("'create' = nieuw section met volledige inspectie (schema, presets, CSS kwaliteit). 'edit' = bestaand bestand fixen met lichtere checks."),
  isStandalone: z.boolean().optional().describe("Mark as standalone workflow"),
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

function inspectConfigFile(file) {
  let parsed;
  try {
    parsed = JSON.parse(file.value);
  } catch (e) {
    return {
      ok: false,
      status: "inspection_failed",
      errorCode: "inspection_failed_json",
      retryable: true,
      message: `Config bestand '${file.key}' bevat ongeldige JSON: ${e.message}`,
      warnings: [],
      suggestedFixes: ["Controleer de JSON syntax en probeer opnieuw."],
      shouldNarrowScope: false,
    };
  }

  if (file.key === "config/settings_data.json") {
    if (!parsed || typeof parsed.current !== "object") {
      return {
        ok: false,
        status: "inspection_failed",
        errorCode: "inspection_failed_json",
        retryable: true,
        message: "settings_data.json moet een 'current' object bevatten (Shopify vereiste).",
        warnings: [],
        suggestedFixes: ["Voeg een 'current' object toe aan de root van settings_data.json."],
        shouldNarrowScope: false,
      };
    }
  }

  return {
    ok: true,
    warnings: [`⚠️ Config write (${file.key}): wijzigingen zijn direct zichtbaar op het thema.`],
    suggestedFixes: [],
  };
}

function inspectTemplateFile(file) {
  let parsed;
  try {
    parsed = JSON.parse(file.value);
  } catch (e) {
    return {
      ok: false,
      status: "inspection_failed",
      errorCode: "inspection_failed_json",
      retryable: true,
      message: `Template bestand '${file.key}' bevat ongeldige JSON: ${e.message}`,
      warnings: [],
      suggestedFixes: ["Controleer de JSON syntax en probeer opnieuw."],
      shouldNarrowScope: false,
    };
  }

  if (!parsed || typeof parsed.sections !== "object") {
    return {
      ok: false,
      status: "inspection_failed",
      errorCode: "inspection_failed_json",
      retryable: true,
      message: `Template '${file.key}' moet een 'sections' object bevatten (Shopify vereiste).`,
      warnings: [],
      suggestedFixes: ["Voeg een 'sections' object toe aan de root van het template JSON bestand."],
      shouldNarrowScope: false,
    };
  }
  if (!Array.isArray(parsed.order)) {
    return {
      ok: false,
      status: "inspection_failed",
      errorCode: "inspection_failed_json",
      retryable: true,
      message: `Template '${file.key}' moet een 'order' array bevatten (Shopify vereiste).`,
      warnings: [],
      suggestedFixes: ["Voeg een 'order' array toe die de section-volgorde definieert."],
      shouldNarrowScope: false,
    };
  }

  return {
    ok: true,
    warnings: [`⚠️ Template write (${file.key}): dit wijzigt de pagina-layout direct.`],
    suggestedFixes: [],
  };
}

function inspectSectionFile(file) {
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
        "Template/config writes zijn niet toegestaan in create mode. Gebruik mode='edit' voor wijzigingen aan bestaande template/config bestanden.",
      warnings,
      suggestedFixes: [
        "Gebruik mode='edit' als je een bestaand template of config bestand wilt wijzigen.",
        "Beperk nieuwe section writes in create mode tot sections/<handle>.liquid.",
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
        "Vervang raw <img> door Shopify image_url + image_tag zodat width/height automatisch goed mee kunnen komen.",
        "Gebruik image_picker, collection of andere Shopify resource settings voor merchant-editable media.",
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
        "Gebruik grid/flex wanneer de section een meerkoloms of card-based layout heeft.",
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
    warnings.push("Schema mist een color setting voor merchant-editable styling. Dit is aanbevolen voor theme editing.");
    suggestedFixes.push("Voeg color settings toe voor achtergrond, tekst of accentkleuren.");
  }
  if (!settingTypes.has("image_picker") && /<img\b|image_tag|svg/i.test(value)) {
    warnings.push("De section lijkt media te gebruiken, maar schema bevat geen image_picker.");
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
    const { files, themeId, themeRole, mode } = args;
    const warnings = [];
    const suggestedFixes = [];

    if (!themeId && !themeRole) {
      return buildFailureResponse({
        status: "missing_theme_target",
        message: "Geef aan op welk thema je wilt schrijven via themeRole ('main', 'development', 'unpublished') of themeId. Vraag dit aan de gebruiker als het niet is opgegeven.",
        errorCode: "missing_theme_target",
        retryable: true,
        suggestedFixes: ["Vraag de gebruiker: 'Op welk thema wil je dit toepassen?'"],
        shouldNarrowScope: false,
      });
    }

    if (!themeId && themeRole === "main") {
      warnings.push("⚠️ Je schrijft naar het LIVE main thema. Wijzigingen zijn direct zichtbaar voor klanten.");
    }

    if (files.length > 1) {
      warnings.push("Draft alleen de noodzakelijke bestanden. Gebruik meerdere files alleen wanneer daar een concrete reden voor is.");
    }

    for (const file of files) {
      const isTemplateConfig = /^(templates|config)\//.test(file.key);
      const isSectionFile = file.key.endsWith(".liquid") && file.key.startsWith("sections/");

      if (isTemplateConfig) {
        if (mode === "create") {
          const inspection = inspectSectionFile(file);
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
        // edit mode: JSON validatie voor templates/config
        const inspection = file.key.startsWith("config/")
          ? inspectConfigFile(file)
          : inspectTemplateFile(file);
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
      } else if (isSectionFile) {
        if (mode === "create") {
          // Create mode: volledige inspectie (schema, presets, CSS kwaliteit)
          const inspection = inspectSectionFile(file);
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
        } else {
          // Edit mode: alleen Liquid-in-special-block check (geen presets/CSS kwaliteit)
          const value = String(file.value || "");
          if (containsLiquidInSpecialBlock(value, "stylesheet") || containsLiquidInSpecialBlock(value, "javascript")) {
            return buildFailureResponse({
              status: "inspection_failed",
              message: "Liquid binnen {% stylesheet %} of {% javascript %} is niet toegestaan. Gebruik <style> of markup-level CSS variables.",
              errorCode: "inspection_failed_css",
              retryable: true,
              suggestedFixes: [
                "Verplaats Liquid-afhankelijke CSS naar een <style> block.",
                "Laat {% stylesheet %} en {% javascript %} alleen statische CSS/JS bevatten.",
              ],
              shouldNarrowScope: false,
            });
          }
          // Schema parse proberen als waarschuwing (geen blokkade in edit mode)
          if (value.includes("{% schema %}")) {
            const { error } = parseSectionSchema(value);
            if (error) {
              warnings.push(`Schema parse waarschuwing: ${error}`);
            }
          }
        }
      }
      // Snippets, assets, locales: geen aanvullende inspectie nodig
    }

    const shopDomain = getShopDomainFromClient(shopifyClient);

    let draftRecord = await createThemeDraftRecord({
      shopDomain,
      status: "pending",
      files,
      referenceInput: null,
      referenceSpec: null,
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
