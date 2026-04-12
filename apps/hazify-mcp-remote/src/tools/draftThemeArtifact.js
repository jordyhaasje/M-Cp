import { z } from "zod";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { check } from "@shopify/theme-check-node";
import { createThemeDraftRecord, updateThemeDraftRecord } from "../lib/db.js";
import { getShopDomainFromClient, upsertThemeFiles, getThemeFiles } from "../lib/themeFiles.js";
import { requireShopifyClient } from "./_context.js";

export const toolName = "draft-theme-artifact";
export const description = `Draft and validate Shopify theme files through the guarded pipeline.

Modes:
- mode="create": Volledige inspectie voor nieuwe sections (schema, presets, CSS kwaliteit verplicht). Templates/config geblokkeerd.
- mode="edit": Lichtere inspectie voor wijzigingen aan bestaande bestanden. Templates/config TOEGESTAAN met JSON validatie.

Beide modes: Liquid-in-stylesheet check, theme-check linting, layout/theme.liquid bescherming.

Belangrijk: themeRole of themeId is verplicht. Vraag de gebruiker welk thema als dit niet is opgegeven.

Theme-aware section regels:
- Gebruik setting type "video" voor merchant-uploaded video bestanden. Gebruik "video_url" alleen voor externe YouTube/Vimeo URLs.
- Gebruik "color_scheme" alleen als het doeltheme al globale color schemes heeft in config/settings_schema.json + config/settings_data.json. Anders: gebruik simpele "color" settings of patch die config eerst in een aparte mode="edit" call.
- Als de gebruiker een nieuwe section ook op een homepage/productpagina geplaatst wil hebben, maak eerst sections/<handle>.liquid in mode="create" en doe daarna een aparte mode="edit" call voor templates/*.json of config/settings_data.json op het expliciet gekozen thema.

Rules for valid Shopify Liquid:

Do not place Liquid inside {% stylesheet %} or {% javascript %}

Use <style> or markup-level CSS variables for section.id scoping`;

const ThemeRoleSchema = z.enum(["main", "unpublished", "demo", "development"]);

const ThemeDraftPatchSchema = z.object({
  searchString: z.string().min(1).describe("De te vervangen string in het originele bestand (literal match, vervangt alle identieke instanties)"),
  replaceString: z.string().describe("De nieuwe string"),
});

const ThemeDraftPatchesSchema = z
  .array(ThemeDraftPatchSchema)
  .min(1)
  .max(10)
  .describe("Voer meerdere patches sequentieel uit binnen hetzelfde bestand. Gebruik dit wanneer een bestaand bestand meerdere losse wijzigingen nodig heeft.");

const ThemeDraftFileSchema = z.object({
  key: z.string().min(1).describe("De exacte filelocatie (bijv. sections/feature-sandbox.liquid)"),
  value: z
    .string()
    .optional()
    .describe(
      "De volledige inhoud / broncode. Payloads falen als ze niet Shopify OS 2.0 proof zijn: geldige schema settings en een presets-array zijn verplicht."
    ),
  patch: ThemeDraftPatchSchema.optional().describe("Verander een specifieke string zonder het hele bestand in te sturen. Bespaart tokens en voorkomt truncated writes."),
  patches: ThemeDraftPatchesSchema.optional(),
  baseChecksumMd5: z.string().optional().describe("Optioneel MD5 checksum voor optimistic locking. De write faalt als het bestand tussentijds is gewijzigd."),
}).refine((data) => {
  const hasValue = data.value !== undefined;
  const hasPatch = data.patch !== undefined;
  const hasPatches = Array.isArray(data.patches) && data.patches.length > 0;
  return hasValue || hasPatch || hasPatches;
}, {
  message: "Provide exactly one of 'value', 'patch', or 'patches'",
});

export const inputSchema = z.object({
  files: z.array(ThemeDraftFileSchema).min(1).max(10).describe("Maximale file batch is 10 items conform veiligheidsregels"),
  themeId: z.string().or(z.number()).optional().describe("Optioneel expliciet doel theme ID. Laat weg om via themeRole te resolven."),
  themeRole: ThemeRoleSchema.optional().describe("Target theme role. Verplicht als themeId niet is opgegeven. Vraag de gebruiker welk thema."),
  mode: z.enum(["create", "edit"]).default("create").describe("'create' = nieuw section met volledige inspectie (schema, presets, CSS kwaliteit). 'edit' = bestaand bestand fixen met lichtere checks."),
  isStandalone: z.boolean().optional().describe("Mark as standalone workflow"),
});

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getLiquidBlockContents(value, tagName) {
  const source = String(value || "");
  const normalizedTagName = escapeRegExp(tagName);
  const openPattern = new RegExp(`{%-?\\s*${normalizedTagName}\\s*-?%}`, "gi");
  const closePattern = new RegExp(`{%-?\\s*end${normalizedTagName}\\s*-?%}`, "gi");
  const contents = [];

  let searchStart = 0;

  while (searchStart < source.length) {
    openPattern.lastIndex = searchStart;
    const openMatch = openPattern.exec(source);
    if (!openMatch || openMatch.index === undefined) {
      break;
    }

    closePattern.lastIndex = openPattern.lastIndex;
    const closeMatch = closePattern.exec(source);
    if (!closeMatch || closeMatch.index === undefined) {
      break;
    }

    contents.push(source.slice(openPattern.lastIndex, closeMatch.index));
    searchStart = closePattern.lastIndex;
  }

  return contents;
}

function hasLiquidBlockTag(value, tagName) {
  return new RegExp(`{%-?\\s*${escapeRegExp(tagName)}\\s*-?%}`, "i").test(String(value || ""));
}

function extractSchemaJson(value) {
  const [schemaJson] = getLiquidBlockContents(value, "schema");
  return schemaJson === undefined ? null : schemaJson.trim();
}

function parseSectionSchema(value) {
  const schemaJson = extractSchemaJson(value);
  if (schemaJson === null) {
    return { schema: null, error: "Missing {% schema %} block." };
  }

  if (schemaJson.length === 0) {
    return { schema: null, error: "Empty {% schema %} block." };
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

function collectSchemaSettings(schema) {
  const sectionSettings = Array.isArray(schema?.settings) ? schema.settings : [];
  const blockSettings = Array.isArray(schema?.blocks)
    ? schema.blocks.flatMap((block) =>
        Array.isArray(block?.settings) ? block.settings : []
      )
    : [];
  return [...sectionSettings, ...blockSettings].filter(Boolean);
}

function collectSchemaSettingTypes(schema) {
  return new Set(
    collectSchemaSettings(schema).map((setting) => String(setting?.type || ""))
  );
}

function collectColorSchemeGroupIds(node, ids = new Set()) {
  if (Array.isArray(node)) {
    for (const value of node) {
      collectColorSchemeGroupIds(value, ids);
    }
    return ids;
  }

  if (!node || typeof node !== "object") {
    return ids;
  }

  if (node.type === "color_scheme_group" && typeof node.id === "string" && node.id.trim()) {
    ids.add(node.id.trim());
  }

  for (const value of Object.values(node)) {
    collectColorSchemeGroupIds(value, ids);
  }

  return ids;
}

function hasThemeSettingDataForIds(settingsData, ids = []) {
  if (!settingsData || typeof settingsData !== "object" || ids.length === 0) {
    return false;
  }

  const current = settingsData.current && typeof settingsData.current === "object" ? settingsData.current : {};
  const presets = settingsData.presets && typeof settingsData.presets === "object" ? settingsData.presets : {};

  return ids.some((id) => {
    if (Object.prototype.hasOwnProperty.call(current, id) && current[id] != null) {
      return true;
    }

    return Object.values(presets).some(
      (preset) =>
        preset &&
        typeof preset === "object" &&
        Object.prototype.hasOwnProperty.call(preset, id) &&
        preset[id] != null
    );
  });
}

function inspectThemeColorSchemeSupport(settingsSchemaValue, settingsDataValue) {
  let parsedSettingsSchema;
  let parsedSettingsData;

  try {
    parsedSettingsSchema = JSON.parse(String(settingsSchemaValue || ""));
  } catch (error) {
    return {
      ok: false,
      reason: `config/settings_schema.json bevat ongeldige JSON: ${error.message}`,
      missing: "settings_schema",
    };
  }

  try {
    parsedSettingsData = JSON.parse(String(settingsDataValue || ""));
  } catch (error) {
    return {
      ok: false,
      reason: `config/settings_data.json bevat ongeldige JSON: ${error.message}`,
      missing: "settings_data",
    };
  }

  const colorSchemeGroupIds = Array.from(collectColorSchemeGroupIds(parsedSettingsSchema));
  if (colorSchemeGroupIds.length === 0) {
    return {
      ok: false,
      reason:
        "Het doeltheme mist een color_scheme_group definitie in config/settings_schema.json.",
      missing: "settings_schema",
    };
  }

  if (!hasThemeSettingDataForIds(parsedSettingsData, colorSchemeGroupIds)) {
    return {
      ok: false,
      reason:
        "Het doeltheme mist color scheme data in config/settings_data.json voor de beschikbare color_scheme_group settings.",
      missing: "settings_data",
    };
  }

  return {
    ok: true,
    ids: colorSchemeGroupIds,
  };
}

function findFirstDuplicate(values) {
  const seen = new Set();
  for (const value of values) {
    if (seen.has(value)) {
      return value;
    }
    seen.add(value);
  }
  return null;
}

function normalizeDraftFile(file) {
  const patches = Array.isArray(file.patches) && file.patches.length > 0
    ? file.patches
    : file.patch
      ? [file.patch]
      : [];

  return {
    ...file,
    patches,
  };
}

function getDraftFileModeCount(file) {
  const hasValue = file.value !== undefined;
  const hasPatch = file.patch !== undefined;
  const hasPatches = Array.isArray(file.patches) && file.patches.length > 0;
  return [hasValue, hasPatch, hasPatches].filter(Boolean).length;
}

function getSpecialBlockContents(value, tagName) {
  return getLiquidBlockContents(value, tagName);
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

  const settings = collectSchemaSettings(schema);
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

  const settingTypes = collectSchemaSettingTypes(schema);

  if (settingTypes.has("color_scheme_group")) {
    return {
      ok: false,
      status: "inspection_failed",
      errorCode: "inspection_failed_schema",
      retryable: true,
      message:
        "Building Inspection Failed: color_scheme_group hoort in config/settings_schema.json en niet in een section schema.",
      warnings,
      suggestedFixes: [
        "Verwijder color_scheme_group uit de section schema settings.",
        "Gebruik in sections alleen color_scheme wanneer het theme al globale color schemes heeft.",
      ],
      shouldNarrowScope: false,
    };
  }

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
  if (settingTypes.has("video_url") && !settingTypes.has("video")) {
    warnings.push(
      "Schema gebruikt video_url. Dit ondersteunt externe YouTube/Vimeo URLs; gebruik type 'video' voor merchant-uploaded videobestanden."
    );
    suggestedFixes.push(
      "Gebruik een video setting in plaats van video_url wanneer de gebruiker een video moet uploaden in het theme."
    );
  }
  if (blocks.length > 0 && !/block\.shopify_attributes/.test(value)) {
    warnings.push(
      "Schema bevat blocks, maar de markup mist block.shopify_attributes. Daardoor werkt drag-and-drop in de Theme Editor minder betrouwbaar."
    );
    suggestedFixes.push(
      "Voeg {{ block.shopify_attributes }} toe op de block wrapper in loops over section.blocks."
    );
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

function getUpsertFailures(upsertResult) {
  return Array.isArray(upsertResult?.results)
    ? upsertResult.results.filter((result) => result?.status && result.status !== "applied")
    : [];
}

function classifyPreviewUpsertFailures(upsertResult, files) {
  const failures = getUpsertFailures(upsertResult);
  const hasPreconditionFailure = failures.some((result) => result.status === "failed_precondition");
  const failedKeys = failures.map((result) => result.key).filter(Boolean);
  const firstFailureMessage = failures[0]?.error?.message || "Onbekende preview write-fout.";

  return {
    failures,
    message: hasPreconditionFailure
      ? `Na linten is de preview niet toegepast omdat de conflict-safe write check faalde: ${firstFailureMessage}`
      : `Na linten is de preview niet volledig toegepast: ${firstFailureMessage}`,
    errorCode: hasPreconditionFailure ? "preview_failed_precondition" : "preview_upload_failed",
    retryable: true,
    shouldNarrowScope: files.length > 3,
    suggestedFixes: hasPreconditionFailure
      ? uniqueStrings([
          "Lees het doelbestand opnieuw in en gebruik de nieuwste checksum voordat je opnieuw schrijft.",
          failedKeys.length > 0 ? `Controleer of deze file(s) tussentijds zijn gewijzigd: ${failedKeys.join(", ")}.` : null,
        ])
      : uniqueStrings([
          "Controleer de Shopify write-resultaten en probeer de draft opnieuw.",
          failedKeys.length > 0 ? `Isoleer eerst deze file(s): ${failedKeys.join(", ")}.` : null,
        ]),
  };
}

async function validateThemeCompatibilityForSections({
  files,
  shopifyClient,
  apiVersion,
  themeId,
  themeRole,
}) {
  const sectionFilesUsingColorScheme = files.filter((file) => {
    if (!(file.key.startsWith("sections/") && file.key.endsWith(".liquid"))) {
      return false;
    }

    const { schema, error } = parseSectionSchema(file.value);
    if (error || !schema) {
      return false;
    }

    return collectSchemaSettingTypes(schema).has("color_scheme");
  });

  if (sectionFilesUsingColorScheme.length === 0) {
    return { ok: true };
  }

  const draftFileValues = new Map(
    files.map((file) => [file.key, String(file.value || "")])
  );
  const requiredKeys = ["config/settings_schema.json", "config/settings_data.json"];
  const missingKeys = requiredKeys.filter((key) => !draftFileValues.has(key));

  if (missingKeys.length > 0) {
    const fetched = await getThemeFiles(shopifyClient, apiVersion, {
      themeId,
      themeRole,
      keys: missingKeys,
      includeContent: true,
    });

    for (const file of fetched.files || []) {
      if (!file?.missing) {
        draftFileValues.set(file.key, String(file.value || ""));
      }
    }
  }

  const settingsSchemaValue = draftFileValues.get("config/settings_schema.json");
  const settingsDataValue = draftFileValues.get("config/settings_data.json");

  if (!settingsSchemaValue || !settingsDataValue) {
    return {
      ok: false,
      reason:
        "Deze section gebruikt color_scheme, maar de pipeline kon config/settings_schema.json en config/settings_data.json niet allebei lezen op het doeltheme.",
      missing: !settingsSchemaValue ? "settings_schema" : "settings_data",
    };
  }

  return inspectThemeColorSchemeSupport(settingsSchemaValue, settingsDataValue);
}

export const draftThemeArtifact = {
  name: toolName,
  description,
  schema: inputSchema,
  execute: async (args, context = {}) => {
    const shopifyClient = requireShopifyClient(context);
    let { files, themeId, themeRole, mode } = args;
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

    const duplicateKey = findFirstDuplicate(files.map((file) => String(file.key || "").trim()).filter(Boolean));
    if (duplicateKey) {
      return buildFailureResponse({
        status: "inspection_failed",
        message: `Elk files[].key moet uniek zijn binnen één draft-theme-artifact request. Dubbele key: '${duplicateKey}'.`,
        errorCode: "inspection_failed_duplicate_key",
        retryable: true,
        suggestedFixes: [
          `Combineer alle wijzigingen voor '${duplicateKey}' in één files[] entry.`,
          "Gebruik 'patches' om meerdere patches sequentieel binnen hetzelfde bestand uit te voeren.",
        ],
        shouldNarrowScope: false,
      });
    }

    files = files.map(normalizeDraftFile);

    for (const file of files) {
      if (getDraftFileModeCount(file) !== 1) {
        return buildFailureResponse({
          status: "inspection_failed",
          message: `Bestand '${file.key}' moet precies één van 'value', 'patch' of 'patches' gebruiken.`,
          errorCode: "inspection_failed_patch_mode",
          retryable: true,
          suggestedFixes: [
            "Gebruik 'value' voor een volledige rewrite van één bestand.",
            "Gebruik 'patch' voor één gerichte vervanging, of 'patches' voor meerdere vervangingen in dezelfde file.",
          ],
          shouldNarrowScope: false,
        });
      }
    }

    let resolvedFiles = [];
    let needsOriginal = files.some((f) => f.patches.length > 0) || mode === "edit";
    
    if (needsOriginal) {
      try {
        const apiVersion = process.env.SHOPIFY_API_VERSION || "2026-01";
        const keysToFetch = files.map(f => f.key);
        const fetchedFiles = await getThemeFiles(shopifyClient, apiVersion, { themeId, themeRole, keys: keysToFetch, includeContent: true });
        
        const fetchedByKey = new Map(fetchedFiles.files.map(f => [f.key, f]));

        for (const file of files) {
          const original = fetchedByKey.get(file.key);
          if (!original || original.missing) {
            if (file.patches.length > 0) {
               return buildFailureResponse({
                 status: "inspection_failed",
                 message: `Patch failed: Bestand '${file.key}' bestaat niet in het thema.`,
                 errorCode: "patch_failed_missing",
                 retryable: false,
                 shouldNarrowScope: false,
               });
            }
            resolvedFiles.push({ key: file.key, value: file.value || "", checksum: file.baseChecksumMd5 });
            continue;
          }

          const originalValue = typeof original.value === "string" ? original.value : "";
          let newValue = file.value;
          
          if (file.patches.length > 0) {
             newValue = originalValue;
             for (const [index, patch] of file.patches.entries()) {
               const searchString = patch.searchString;
               if (!newValue.includes(searchString)) {
                return buildFailureResponse({
                  status: "inspection_failed",
                  message: `Patch ${index + 1} failed: De searchString '${searchString.substring(0, 50)}...' werd niet gevonden in '${file.key}'.`,
                  errorCode: "patch_failed_nomatch",
                  retryable: true,
                  suggestedFixes: ["Gebruik search-theme-files om de exacte string te achterhalen of gebruik een regex via patch.", "Zorg dat witruimte/inspringen exact overeenkomt."],
                  shouldNarrowScope: false,
                });
               }
               newValue = newValue.split(searchString).join(patch.replaceString);
             }
          }

          if (mode === "edit" && file.patches.length === 0 && newValue) {
             if (newValue.length < originalValue.length * 0.5) {
                return buildFailureResponse({
                  status: "inspection_failed",
                  message: `Existing section edit appears incomplete. De nieuwe content van '${file.key}' is minder dan 50% van het origineel. Dit duidt mogelijk op truncation.`,
                  errorCode: "inspection_failed_truncated",
                  retryable: true,
                  suggestedFixes: ["Stuur het VOLLEDIGE bestand terug, of gebruik het nieuwe 'patch' argument om een specifieke regel aan te passen."],
                  shouldNarrowScope: false,
                });
             }

             if (file.key.startsWith("sections/") && file.key.endsWith(".liquid")) {
               const origSchema = extractSchemaJson(originalValue);
               const newSchema = extractSchemaJson(newValue);
               if (origSchema && !newSchema) {
                 return buildFailureResponse({
                   status: "inspection_failed",
                   message: `Existing section edit appears incomplete. Het origineel in '${file.key}' had een {% schema %} block, maar deze is verdwenen.`,
                   errorCode: "inspection_failed_schema_loss",
                   retryable: true,
                   suggestedFixes: ["Behoud altijd het {% schema %} block op bestaande sections (met presets settings) tenzij je hem expliciet wilt weggooien (niet aanbevolen)."],
                   shouldNarrowScope: false,
                 });
               }
             }
          }

          resolvedFiles.push({ 
            key: file.key, 
            value: newValue, 
            checksum: file.baseChecksumMd5 || null 
          });
        }
      } catch (err) {
        return buildFailureResponse({
          status: "inspection_failed",
          message: `Kon bestaande bestanden niet ophalen voor patch/edit validatie: ${err.message}`,
          errorCode: "inspection_failed_read",
          retryable: true,
          shouldNarrowScope: false,
        });
      }
    } else {
      resolvedFiles = files.map(f => ({ key: f.key, value: f.value || "", checksum: f.baseChecksumMd5 }));
    }

    files = resolvedFiles;

    try {
      const themeCompatibility = await validateThemeCompatibilityForSections({
        files,
        shopifyClient,
        apiVersion: process.env.SHOPIFY_API_VERSION || "2026-01",
        themeId,
        themeRole,
      });

      if (!themeCompatibility.ok) {
        return buildFailureResponse({
          status: "inspection_failed",
          message: `Building Inspection Failed: deze section gebruikt een color_scheme setting, maar het doeltheme is daar niet compatibel mee. ${themeCompatibility.reason}`,
          warnings,
          errorCode: "inspection_failed_color_scheme_theme_support",
          retryable: true,
          suggestedFixes: [
            "Gebruik in de section eenvoudige color settings wanneer het theme nog geen globale color schemes ondersteunt.",
            "Of patch eerst config/settings_schema.json met een color_scheme_group en voeg de bijbehorende data toe in config/settings_data.json via mode='edit'.",
          ],
          shouldNarrowScope: false,
        });
      }
    } catch (error) {
      return buildFailureResponse({
        status: "inspection_failed",
        message: `Kon theme-compatibiliteit niet controleren voor color_scheme settings: ${error.message}`,
        warnings,
        errorCode: "inspection_failed_read",
        retryable: true,
        suggestedFixes: [
          "Controleer of het doeltheme bereikbaar is en de config files gelezen kunnen worden.",
          "Gebruik themeId wanneer themeRole niet eenduidig resolveert.",
        ],
        shouldNarrowScope: false,
      });
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
          if (hasLiquidBlockTag(value, "schema")) {
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
      files: files.map(({ key, value }) => ({ key, value })),
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

      let offenses = await check(tmpDir);
      
      const preExistingChecks = ["MissingSnippet", "MissingAsset", "MissingTemplate", "UnknownObject", "UnknownFilter"];
      
      offenses = offenses.map(offense => {
        if (offense.severity === 0 && preExistingChecks.includes(offense.check)) {
           return { ...offense, severity: 1 };
        }
        return offense;
      });

      const preExistingWarningCount = offenses.filter(o => o.severity === 1 && preExistingChecks.includes(o.check)).length;
      if (preExistingWarningCount > 0) {
        warnings.push(`Gevonden ${preExistingWarningCount} pre-existing referentie(s) in het target thema (MissingSnippet/MissingAsset). Linter faalt hier niet meer hard op.`);
      }

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
        files: files.map((file) => ({ 
          key: file.key, 
          value: file.value, 
          ...(file.checksum ? { checksum: file.checksum } : {}) 
        })),
        verifyAfterWrite: true,
      });

      const failedPreviewWrites = getUpsertFailures(upsertResult);
      if (failedPreviewWrites.length > 0 || Number(upsertResult?.summary?.applied || 0) !== files.length) {
        const classified = classifyPreviewUpsertFailures(upsertResult, files);
        draftRecord = await updateThemeDraftRecord(draftId, {
          status: "preview_failed",
          verifyResult: {
            summary: upsertResult.verifySummary || null,
            results: upsertResult.results || [],
          },
        });
        return buildFailureResponse({
          status: "preview_failed",
          draftId,
          message: classified.message,
          warnings,
          errors: failedPreviewWrites,
          draft: buildDraftPayload(draftRecord, {
            verifySummary: upsertResult.verifySummary || null,
            verifyResults: upsertResult.results || [],
            warnings,
          }),
          errorCode: classified.errorCode,
          retryable: classified.retryable,
          suggestedFixes: [...suggestedFixes, ...classified.suggestedFixes],
          shouldNarrowScope: classified.shouldNarrowScope,
        });
      }

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
