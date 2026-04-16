import { z } from "zod";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { check } from "@shopify/theme-check-node";
import { createThemeDraftRecord, updateThemeDraftRecord } from "../lib/db.js";
import { parseJsonLike } from "../lib/jsonLike.js";
import { getShopDomainFromClient, upsertThemeFiles, getThemeFiles, searchThemeFiles } from "../lib/themeFiles.js";
import { requireShopifyClient } from "./_context.js";
import {
  extractThemeToolSummary,
  inferSingleThemeFile,
  inferThemeTargetFromSummary,
} from "./_themeToolCompatibility.js";

export const toolName = "draft-theme-artifact";
export const description = `Draft and validate Shopify theme files through the guarded pipeline.

Modes:
- mode="create": Volledige inspectie voor nieuwe sections (geldig schema, presets, renderbare markup en Shopify-veilige range settings). Templates/config geblokkeerd.
- mode="edit": Lichtere inspectie voor wijzigingen aan bestaande bestanden. Templates/config TOEGESTAAN met JSON/JSONC-validatie, en sections/blocks met schema krijgen ook range-validatie.

Zet mode altijd expliciet op top-level. Alleen voor backwards compatibility infereren patch/patches automatisch mode="edit"; value-only writes zonder mode worden eerst tegen het doeltheme geprobed zodat bestaande bestanden niet stilzwijgend als create-flow worden behandeld.

Beide modes: Liquid-in-stylesheet check, theme-check linting, layout/theme.liquid bescherming.

Belangrijk: themeRole of themeId is verplicht. Vraag de gebruiker welk thema als dit niet is opgegeven.

Theme-aware section regels:
- Gebruik voor bestaande single-file edits bij voorkeur patch-theme-file. Gebruik draft-theme-artifact vooral voor multi-file edits, nieuwe sections en volledige rewrites.
- Compatibele shorthand: voor één file mag een client ook top-level key + value of key + searchString/replaceString aanleveren; dit wordt intern naar files[] genormaliseerd. Als een compatibele client alleen _tool_input_summary meestuurt, infereren we daaruit hooguit theme target en exact file path. Vrije summary-tekst vervangt NOOIT gestructureerde write-velden zoals files[], value, content, liquid, patch of patches. Legacy aliases zoals summary, prompt, request en tool_input_summary blijven alleen voor backwards compatibility ondersteund.
- Gebruik plan-theme-edit voordat je native product-blocks, theme blocks of template placement probeert. Zo weet je eerst of het theme een single-file patch, multi-file edit of losse section-flow nodig heeft.
- Nieuwe sections worden vooraf gecontroleerd op Shopify schema-basisregels, waaronder geldige range defaults binnen min/max, geldige step-alignment en maximaal 101 stappen per range setting.
- richtext defaults moeten Shopify-veilige HTML gebruiken. Gebruik top-level <p> of <ul>; tags zoals <mark> in richtext.default worden door Shopify afgewezen.
- Nieuwe blocks/*.liquid files krijgen in create mode ook een basisinspectie op geldige schema JSON en block-veilige markup.
- Gebruik setting type "video" voor merchant-uploaded video bestanden. Gebruik "video_url" alleen voor externe YouTube/Vimeo URLs.
- Gebruik "color_scheme" alleen als het doeltheme al globale color schemes heeft in config/settings_schema.json + config/settings_data.json. Anders: gebruik simpele "color" settings of patch die config eerst in een aparte mode="edit" call.
- Voor native blocks binnen een bestaande section (bijv. product-info of main-product): gebruik mode="edit" en patch de bestaande schema.blocks plus de render markup/snippet. Dit is geen los blocks/*.liquid bestand.
- Als de gebruiker een nieuwe section ook op een homepage/productpagina geplaatst wil hebben, maak eerst sections/<handle>.liquid in mode="create" en doe daarna alleen bij expliciete placement-vraag een aparte mode="edit" call voor templates/*.json op hetzelfde expliciet gekozen thema. Gebruik config/settings_data.json alleen als uitzonderingsroute.
- Gebruik voor nieuwe sections bij voorkeur enabled_on/disabled_on in de schema in plaats van legacy "templates" wanneer je beschikbaarheid per template wilt sturen.

Rules for valid Shopify Liquid:

Do not place Liquid inside {% stylesheet %} or {% javascript %}

Use <style> or markup-level CSS variables for section.id scoping`;

const ThemeRoleSchema = z.enum(["main", "unpublished", "demo", "development"]);

const ThemeDraftPatchSchema = z.object({
  searchString: z.string().min(1).describe("De te vervangen string in het originele bestand. Gebruik een unieke literal anchor die exact één keer voorkomt in het doelbestand."),
  replaceString: z.string().describe("De nieuwe string"),
}).strict();

const ThemeDraftPatchesSchema = z
  .array(ThemeDraftPatchSchema)
  .min(1)
  .max(10)
  .describe("Voer meerdere patches sequentieel uit binnen hetzelfde bestand. Gebruik dit wanneer een bestaand bestand meerdere losse wijzigingen nodig heeft of wanneer één unieke patch-anchor niet genoeg is.");

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
}).strict().refine((data) => {
  const hasValue = data.value !== undefined;
  const hasPatch = data.patch !== undefined;
  const hasPatches = Array.isArray(data.patches) && data.patches.length > 0;
  return [hasValue, hasPatch, hasPatches].filter(Boolean).length === 1;
}, {
  message: "Provide exactly one of 'value', 'patch', or 'patches'",
});

const SummaryFieldSchema = z.string().max(4000).optional();

const DraftThemeArtifactPublicObjectSchema = z
  .object({
    files: z
      .array(ThemeDraftFileSchema)
      .min(1)
      .max(10)
      .optional()
      .describe(
        "Canonieke file batch. Maximale file batch is 10 items conform veiligheidsregels."
      ),
    file: ThemeDraftFileSchema
      .optional()
      .describe("Compat shorthand voor één file-object; wordt intern naar files[] genormaliseerd."),
    key: z
      .string()
      .min(1)
      .optional()
      .describe("Compat shorthand voor één targetbestand; alleen veilig in combinatie met value/content/liquid of patch-data."),
    targetFile: z
      .string()
      .min(1)
      .optional()
      .describe("Compat alias van key voor single-file flows."),
    value: z
      .string()
      .optional()
      .describe("Compat single-file shorthand. Heeft prioriteit boven content en liquid."),
    content: z
      .string()
      .optional()
      .describe("Compat alias van value voor single-file flows."),
    liquid: z
      .string()
      .optional()
      .describe("Compat alias van value voor single-file Liquid writes."),
    searchString: z
      .string()
      .optional()
      .describe("Compat shorthand. Alleen samen met replaceString wordt dit intern naar patch genormaliseerd."),
    replaceString: z
      .string()
      .optional()
      .describe("Compat shorthand. Alleen samen met searchString wordt dit intern naar patch genormaliseerd."),
    patch: ThemeDraftPatchSchema.optional(),
    patches: ThemeDraftPatchesSchema.optional(),
    baseChecksumMd5: z
      .string()
      .optional()
      .describe("Compat shorthand voor single-file optimistic locking."),
    _tool_input_summary: SummaryFieldSchema.describe(
      "Compat summary voor beperkte clients. Alleen veilige inferentie voor theme target en exact één file path."
    ),
    tool_input_summary: SummaryFieldSchema.describe(
      "Legacy alias van _tool_input_summary voor backwards compatibility."
    ),
    summary: SummaryFieldSchema.describe(
      "Legacy alias van _tool_input_summary voor backwards compatibility."
    ),
    prompt: SummaryFieldSchema.describe(
      "Legacy alias van _tool_input_summary voor backwards compatibility."
    ),
    request: SummaryFieldSchema.describe(
      "Legacy alias van _tool_input_summary voor backwards compatibility."
    ),
    themeId: z
      .string()
      .or(z.number())
      .optional()
      .describe("Optioneel expliciet doel theme ID. Laat weg om via themeRole te resolven."),
    themeRole: ThemeRoleSchema
      .optional()
      .describe("Target theme role. Verplicht als themeId niet is opgegeven. Vraag de gebruiker welk thema."),
    mode: z
      .enum(["create", "edit"])
      .optional()
      .describe(
        "'create' = nieuw sectionbestand met volledige inspectie. 'edit' = bestaand bestand fixen met lichtere checks. Zet mode altijd op het TOP-LEVEL request, nooit in files[]. Als mode ontbreekt en je patch/patches gebruikt, behandelt de pipeline dit automatisch als edit; value-only writes worden dan eerst tegen het doeltheme geprobed om create/edit veilig af te leiden."
      ),
    isStandalone: z.boolean().optional().describe("Mark as standalone workflow"),
  })
  .strict();

const DraftThemeArtifactPublicShape = DraftThemeArtifactPublicObjectSchema
  .superRefine((data, ctx) => {
    if (data.themeId && data.themeRole) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["themeId"],
        message: "Gebruik themeId of themeRole, niet allebei tegelijk.",
      });
    }
  });

const NormalizedThemeDraftArtifactShape = z
  .object({
    files: z
      .array(ThemeDraftFileSchema)
      .min(1)
      .max(10)
      .optional(),
    themeId: z.string().or(z.number()).optional(),
    themeRole: ThemeRoleSchema.optional(),
    mode: z.enum(["create", "edit"]).optional(),
    isStandalone: z.boolean().optional(),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (data.themeId && data.themeRole) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["themeId"],
        message: "Gebruik themeId of themeRole, niet allebei tegelijk.",
      });
    }

    if (data.mode !== "create" || !Array.isArray(data.files)) {
      return;
    }

    data.files.forEach((file, index) => {
      const hasPatch = file.patch !== undefined;
      const hasPatches = Array.isArray(file.patches) && file.patches.length > 0;
      if (!hasPatch && !hasPatches) {
        return;
      }

      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["files", index, hasPatch ? "patch" : "patches"],
        message:
          "mode='create' ondersteunt alleen volledige value-writes. Gebruik mode='edit' voor patch of patches.",
      });
    });
  });

const normalizeDraftThemeArtifactInput = (rawInput) => {
  if (!rawInput || typeof rawInput !== "object" || Array.isArray(rawInput)) {
    return rawInput;
  }

  const summary = extractThemeToolSummary(rawInput);
  let normalized = {
    files: rawInput.files,
    themeId: rawInput.themeId,
    themeRole: rawInput.themeRole,
    mode: rawInput.mode,
    isStandalone: rawInput.isStandalone,
  };

  if (summary) {
    normalized = inferThemeTargetFromSummary(normalized, summary);
  }

  const singlePatch =
    rawInput.searchString !== undefined &&
    rawInput.replaceString !== undefined &&
    !rawInput.patch &&
    !rawInput.patches
      ? {
          searchString: rawInput.searchString,
          replaceString: rawInput.replaceString,
        }
      : rawInput.patch;

  if (!normalized.files) {
    if (rawInput.file && typeof rawInput.file === "object" && !Array.isArray(rawInput.file)) {
      normalized.files = [rawInput.file];
    }
  }

  if (!normalized.files) {
    const inferredKey =
      rawInput.key || rawInput.targetFile || (summary ? inferSingleThemeFile(summary) : null);
    if (
      inferredKey &&
      (rawInput.value !== undefined ||
        rawInput.content !== undefined ||
        rawInput.liquid !== undefined ||
        singlePatch !== undefined ||
        rawInput.patches !== undefined)
    ) {
      normalized.files = [
        {
          key: inferredKey,
          ...(rawInput.value !== undefined
            ? { value: rawInput.value }
            : rawInput.content !== undefined
              ? { value: rawInput.content }
              : rawInput.liquid !== undefined
                ? { value: rawInput.liquid }
                : {}),
          ...(singlePatch !== undefined ? { patch: singlePatch } : {}),
          ...(rawInput.patches !== undefined ? { patches: rawInput.patches } : {}),
          ...(rawInput.baseChecksumMd5 ? { baseChecksumMd5: rawInput.baseChecksumMd5 } : {}),
        },
      ];
    }
  }

  return normalized;
};

export const inputSchema = z.preprocess(
  normalizeDraftThemeArtifactInput,
  DraftThemeArtifactPublicShape
);

const NormalizedThemeDraftArtifactInputSchema = z.preprocess(
  normalizeDraftThemeArtifactInput,
  NormalizedThemeDraftArtifactShape
);

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

const RANGE_ALIGNMENT_EPSILON = 1e-9;

function isRangeValueAlignedToStep(value, min, step) {
  const stepsFromMin = (value - min) / step;
  return Math.abs(stepsFromMin - Math.round(stepsFromMin)) < RANGE_ALIGNMENT_EPSILON;
}

function buildRangeIssueSuggestedFixes(issue) {
  switch (issue?.code) {
    case "range_too_few_steps":
      return [
        `Gebruik voor ${issue.label} liever een select-setting. De huidige range levert maar ${issue.stepCount} discrete waarden op.`,
        `Of verlaag step / vergroot het bereik zodat ${issue.label} minstens 3 keuzes biedt.`,
        "Controleer alle range settings in de section schema voordat je opnieuw schrijft.",
      ];
    case "range_default_not_on_step":
      return [
        `Pas default van ${issue.label} aan zodat deze exact op het step-raster valt vanaf min ${issue.min} met step ${issue.step}.`,
        `Of wijzig min/step zodat default ${issue.defaultValue} een geldige stap binnen ${issue.min}-${issue.max} wordt.`,
        "Controleer alle range settings in de section schema voordat je opnieuw schrijft.",
      ];
    case "range_too_many_steps":
      return [
        `Beperk ${issue.label} tot maximaal 101 bereikstappen. De huidige configuratie levert ${issue.stepCount} waarden op.`,
        issue.suggestedMinStep
          ? `Verhoog step naar minimaal ${issue.suggestedMinStep} of verklein het bereik ${issue.min}-${issue.max} voordat je opnieuw schrijft.`
          : `Verhoog step of verklein het bereik ${issue.min}-${issue.max} voordat je opnieuw schrijft.`,
        "Controleer alle range settings in de section schema voordat je opnieuw schrijft.",
      ];
    default:
      return [
        `Pas default van ${issue.label} aan zodat deze binnen min/max valt.`,
        `Of wijzig min/max zodat default ${issue.defaultValue} geldig wordt binnen het bereik ${issue.min}-${issue.max}.`,
        "Controleer alle range settings in de section schema voordat je opnieuw schrijft.",
      ];
  }
}

function collectSchemaRangeIssues(schema) {
  const issues = [];
  const addIssue = (setting, ownerLabel, basePath) => {
    if (!setting || setting.type !== "range") {
      return;
    }

    const id = String(setting.id || "unknown");
    const label = `${ownerLabel} setting '${id}'`;
    const path = [...basePath, "settings", id];
    const min = setting.min;
    const max = setting.max;
    const defaultValue = setting.default;
    const rawStep = setting.step;
    const step = rawStep === undefined ? 1 : rawStep;

    if (
      typeof min !== "number" ||
      typeof max !== "number" ||
      typeof defaultValue !== "number" ||
      typeof step !== "number" ||
      !Number.isFinite(min) ||
      !Number.isFinite(max) ||
      !Number.isFinite(defaultValue) ||
      !Number.isFinite(step)
    ) {
      issues.push({
        code: "range_non_numeric",
        label,
        path,
        min,
        max,
        defaultValue,
        step,
        message:
          `${label} moet numerieke min/max/default waarden hebben. Shopify accepteert hier geen strings of lege waardes.`,
      });
      return;
    }

    if (step <= 0) {
      issues.push({
        code: "range_invalid_step",
        label,
        path,
        min,
        max,
        defaultValue,
        step,
        message: `${label} heeft een ongeldige step (${step}). Gebruik een positief numeriek step-formaat.`,
      });
      return;
    }

    if (min > max) {
      issues.push({
        code: "range_min_gt_max",
        label,
        path,
        min,
        max,
        defaultValue,
        step,
        message: `${label} heeft min (${min}) groter dan max (${max}).`,
      });
      return;
    }

    if (defaultValue < min || defaultValue > max) {
      issues.push({
        code: "range_default_out_of_bounds",
        label,
        path,
        min,
        max,
        defaultValue,
        step,
        message:
          `${label} heeft default ${defaultValue}, maar deze moet tussen min ${min} en max ${max} vallen.`,
      });
      return;
    }

    if (!isRangeValueAlignedToStep(defaultValue, min, step)) {
      issues.push({
        code: "range_default_not_on_step",
        label,
        path,
        min,
        max,
        defaultValue,
        step,
        message:
          `${label} heeft default ${defaultValue}, maar deze moet exact op een geldige step vanaf min ${min} liggen (step ${step}).`,
      });
      return;
    }

    const stepCount = Math.floor((max - min) / step) + 1;
    if (stepCount < 3) {
      issues.push({
        code: "range_too_few_steps",
        label,
        path,
        min,
        max,
        defaultValue,
        step,
        stepCount,
        message:
          `${label} gebruikt maar ${stepCount} discrete waarden. Gebruik voor zulke kleine keuzes liever een select-setting.`,
        preferSelect: true,
      });
      return;
    }

    if (stepCount > 101) {
      const suggestedMinStep =
        max > min ? Math.ceil((max - min) / 100) : null;
      issues.push({
        code: "range_too_many_steps",
        label,
        path,
        min,
        max,
        defaultValue,
        step,
        stepCount,
        suggestedMinStep,
        message:
          `${label} gebruikt ${stepCount} bereikstappen. Hazify blokkeert ranges met meer dan 101 stappen/waarden als preflight-guard voor Shopify theme schemas.`,
      });
    }
  };

  const sectionSettings = Array.isArray(schema?.settings) ? schema.settings : [];
  for (const setting of sectionSettings) {
    addIssue(setting, "Section", ["section"]);
  }

  const blocks = Array.isArray(schema?.blocks) ? schema.blocks : [];
  for (const block of blocks) {
    const blockType = String(block?.type || block?.name || "unknown");
    const blockSettings = Array.isArray(block?.settings) ? block.settings : [];
    for (const setting of blockSettings) {
      addIssue(setting, `Block '${blockType}'`, ["blocks", blockType]);
    }
  }

  return issues;
}

function collectSchemaSettingTypes(schema) {
  return new Set(
    collectSchemaSettings(schema).map((setting) => String(setting?.type || ""))
  );
}

function buildRangeIssueDiagnostic(issue) {
  const base = {
    path: issue.path || [],
    problem: issue.message,
    fixSuggestion: buildRangeIssueSuggestedFixes(issue)[0],
    issueCode: "inspection_failed_schema_range",
  };

  if (issue.code === "range_too_many_steps" && issue.suggestedMinStep) {
    return {
      ...base,
      suggestedReplacement: {
        step: issue.suggestedMinStep,
      },
    };
  }

  if (issue.code === "range_too_few_steps") {
    return {
      ...base,
      suggestedReplacement: {
        type: "select",
      },
    };
  }

  return base;
}

function buildRangeIssueSchemaRewrites(issue) {
  if (issue.code === "range_too_few_steps") {
    return [
      {
        path: issue.path || [],
        currentType: "range",
        suggestedType: "select",
        reason: `${issue.label} heeft maar ${issue.stepCount} discrete waarden.`,
      },
    ];
  }

  if (issue.code === "range_too_many_steps" && issue.suggestedMinStep) {
    return [
      {
        path: issue.path || [],
        currentType: "range",
        suggestedStep: issue.suggestedMinStep,
        reason: `${issue.label} overschrijdt de Hazify preflight-guard van maximaal 101 waarden.`,
      },
    ];
  }

  return [];
}

function buildPreferSelectEntry(issue) {
  if (issue.code !== "range_too_few_steps") {
    return null;
  }

  return {
    path: issue.path || [],
    valuesCount: issue.stepCount,
    reason: `${issue.label} heeft te weinig discrete waarden voor een zinvolle range.`,
  };
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
    parsedSettingsSchema = parseJsonLike(String(settingsSchemaValue || ""));
  } catch (error) {
    return {
      ok: false,
      reason: `config/settings_schema.json bevat ongeldige JSON: ${error.message}`,
      missing: "settings_schema",
    };
  }

  try {
    parsedSettingsData = parseJsonLike(String(settingsDataValue || ""));
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
  const { patch, patches: rawPatches, ...rest } = file;
  const patches = Array.isArray(rawPatches) && rawPatches.length > 0
    ? rawPatches
    : patch
      ? [patch]
      : [];

  return {
    ...rest,
    patches,
  };
}

function getDraftFileModeCount(file) {
  const hasValue = file.value !== undefined;
  const hasPatches = Array.isArray(file.patches) && file.patches.length > 0;
  return [hasValue, hasPatches].filter(Boolean).length;
}

function countLiteralOccurrences(source, needle) {
  const haystack = String(source || "");
  const target = String(needle || "");
  if (!target) {
    return 0;
  }

  let count = 0;
  let fromIndex = 0;
  while (fromIndex < haystack.length) {
    const matchIndex = haystack.indexOf(target, fromIndex);
    if (matchIndex < 0) {
      break;
    }
    count += 1;
    fromIndex = matchIndex + target.length;
  }
  return count;
}

function resolveDraftMode(requestedMode, files = []) {
  if (requestedMode === "create" || requestedMode === "edit") {
    return { mode: requestedMode, inferred: false, warning: null, probeExistingFiles: false };
  }

  const hasPatchLikeFile = files.some(
    (file) =>
      file?.patch !== undefined ||
      (Array.isArray(file?.patches) && file.patches.length > 0)
  );

  if (hasPatchLikeFile) {
    return {
      mode: "edit",
      inferred: true,
      warning:
        "Geen top-level mode opgegeven; omdat deze request patch/patches gebruikt behandelt de pipeline dit als mode='edit'. Zet mode voortaan expliciet op top-level en niet in files[].",
      probeExistingFiles: false,
    };
  }

  return { mode: "create", inferred: true, warning: null, probeExistingFiles: true };
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

function removeLiquidBlock(value, tagName) {
  return String(value || "").replace(
    new RegExp(`{%-?\\s*${escapeRegExp(tagName)}\\s*-?%}[\\s\\S]*?{%-?\\s*end${escapeRegExp(tagName)}\\s*-?%}`, "gi"),
    ""
  );
}

function hasRenderableContentOutsideSchema(value) {
  let source = String(value || "");
  for (const tagName of ["schema", "stylesheet", "javascript", "style", "doc", "comment"]) {
    source = removeLiquidBlock(source, tagName);
  }
  source = source.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "");
  source = source.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
  return source.trim().length > 0;
}

function createInspectionIssue({
  path = [],
  problem,
  fixSuggestion,
  suggestedReplacement,
  issueCode = "inspection_failed_local_validation",
}) {
  return {
    path,
    problem,
    fixSuggestion,
    issueCode,
    ...(suggestedReplacement !== undefined ? { suggestedReplacement } : {}),
  };
}

function buildInspectionResult({
  issues = [],
  warnings = [],
  suggestedFixes = [],
  shouldNarrowScope = false,
  suggestedSchemaRewrites = [],
  preferSelectFor = [],
  qualityWarnings = [],
}) {
  const flattenedIssues = (issues || []).filter(Boolean);
  return {
    ok: flattenedIssues.length === 0,
    issues: flattenedIssues,
    warnings: uniqueStrings([...(warnings || []), ...(qualityWarnings || [])]),
    suggestedFixes: uniqueStrings([
      ...(suggestedFixes || []),
      ...flattenedIssues.map((issue) => issue.fixSuggestion).filter(Boolean),
    ]),
    shouldNarrowScope,
    suggestedSchemaRewrites: (suggestedSchemaRewrites || []).filter(Boolean),
    preferSelectFor: (preferSelectFor || []).filter(Boolean),
    qualityWarnings: uniqueStrings(qualityWarnings || []),
  };
}

function summarizeMinimalSectionQuality(value, schema) {
  const warnings = [];
  const source = String(value || "");
  const settings = collectSchemaSettings(schema);
  const hasScopedCss = /{%\s*stylesheet\s*%}|<style\b/i.test(source);
  const hasResponsive = /@media\b|clamp\(/i.test(source);
  const hasLayoutPrimitive =
    /display\s*:\s*(?:grid|flex|inline-grid|inline-flex)/i.test(source) ||
    /grid-template-columns\s*:/i.test(source) ||
    /flex-direction\s*:/i.test(source);
  const hasSpacing = /(?:padding|margin|gap)\s*:/i.test(source);
  const hasVisualTreatment = /(?:border-radius|box-shadow|background(?:-color)?|border)\s*:/i.test(source);
  const settingCount = settings.length;
  const markupLength = removeLiquidBlock(source, "schema").trim().length;

  if (!hasScopedCss && settingCount <= 1 && markupLength < 160) {
    warnings.push(
      "likely_minimal_scaffold: de section is uploadbaar, maar nog erg minimaal en waarschijnlijk alleen een scaffold."
    );
  }

  if (!hasResponsive && !hasVisualTreatment && settingCount <= 2) {
    warnings.push(
      "likely_minimal_scaffold: voeg responsieve en visuele afwerking toe voordat deze section als afgerond wordt beschouwd."
    );
  }

  if (!hasLayoutPrimitive && !hasSpacing && markupLength < 220) {
    warnings.push(
      "likely_minimal_scaffold: de section bevat weinig layout-signaal; controleer of dit niet alleen een minimale stub is."
    );
  }

  return uniqueStrings(warnings);
}

function inspectEditableLiquidSchema(value, fileLabel) {
  if (!hasLiquidBlockTag(value, "schema")) {
    return buildInspectionResult({});
  }

  const { schema, error } = parseSectionSchema(value);
  if (error || !schema) {
    return buildInspectionResult({
      issues: [
        createInspectionIssue({
          path: ["schema"],
          problem: `${fileLabel} bevat een ongeldig {% schema %} block: ${error || "Schema ontbreekt."}`,
          fixSuggestion: "Controleer of de schema JSON parsebaar is en behoud een geldig {% schema %} block.",
          issueCode: "inspection_failed_schema",
        }),
      ],
      suggestedFixes: [
        "Controleer of de schema JSON parsebaar is.",
        "Behoud een geldig {% schema %} block in section- en block-bestanden.",
      ],
    });
  }

  const rangeIssues = collectSchemaRangeIssues(schema);
  if (rangeIssues.length > 0) {
    return buildInspectionResult({
      issues: rangeIssues.map((issue) => buildRangeIssueDiagnostic(issue)),
      suggestedFixes: rangeIssues.flatMap((issue) =>
        buildRangeIssueSuggestedFixes(issue)
      ),
      suggestedSchemaRewrites: rangeIssues.flatMap((issue) =>
        buildRangeIssueSchemaRewrites(issue)
      ),
      preferSelectFor: rangeIssues
        .map((issue) => buildPreferSelectEntry(issue))
        .filter(Boolean),
    });
  }

  return buildInspectionResult({});
}

function inspectConfigFile(file) {
  let parsed;
  try {
    parsed = parseJsonLike(file.value);
  } catch (e) {
    return buildInspectionResult({
      issues: [
        createInspectionIssue({
          path: [file.key],
          problem: `Config bestand '${file.key}' bevat ongeldige JSON: ${e.message}`,
          fixSuggestion: "Controleer de JSON syntax en probeer opnieuw.",
          issueCode: "inspection_failed_json",
        }),
      ],
      suggestedFixes: ["Controleer de JSON syntax en probeer opnieuw."],
    });
  }

  if (file.key === "config/settings_data.json") {
    if (!parsed || typeof parsed.current !== "object") {
      return buildInspectionResult({
        issues: [
          createInspectionIssue({
            path: [file.key, "current"],
            problem: "settings_data.json moet een 'current' object bevatten (Shopify vereiste).",
            fixSuggestion: "Voeg een 'current' object toe aan de root van settings_data.json.",
            issueCode: "inspection_failed_json",
          }),
        ],
        suggestedFixes: ["Voeg een 'current' object toe aan de root van settings_data.json."],
      });
    }
  }

  return buildInspectionResult({
    warnings: [`⚠️ Config write (${file.key}): wijzigingen zijn direct zichtbaar op het thema.`],
  });
}

function inspectTemplateFile(file) {
  let parsed;
  try {
    parsed = parseJsonLike(file.value);
  } catch (e) {
    return buildInspectionResult({
      issues: [
        createInspectionIssue({
          path: [file.key],
          problem: `Template bestand '${file.key}' bevat ongeldige JSON/JSONC: ${e.message}`,
          fixSuggestion: "Controleer de JSON/JSONC syntax en probeer opnieuw.",
          issueCode: "inspection_failed_json",
        }),
      ],
      suggestedFixes: ["Controleer de JSON/JSONC syntax en probeer opnieuw."],
    });
  }

  if (!parsed || typeof parsed.sections !== "object") {
    return buildInspectionResult({
      issues: [
        createInspectionIssue({
          path: [file.key, "sections"],
          problem: `Template '${file.key}' moet een 'sections' object bevatten (Shopify vereiste).`,
          fixSuggestion: "Voeg een 'sections' object toe aan de root van het template JSON bestand.",
          issueCode: "inspection_failed_json",
        }),
      ],
      suggestedFixes: ["Voeg een 'sections' object toe aan de root van het template JSON bestand."],
    });
  }
  if (!Array.isArray(parsed.order)) {
    return buildInspectionResult({
      issues: [
        createInspectionIssue({
          path: [file.key, "order"],
          problem: `Template '${file.key}' moet een 'order' array bevatten (Shopify vereiste).`,
          fixSuggestion: "Voeg een 'order' array toe die de section-volgorde definieert.",
          issueCode: "inspection_failed_json",
        }),
      ],
      suggestedFixes: ["Voeg een 'order' array toe die de section-volgorde definieert."],
    });
  }

  return buildInspectionResult({
    warnings: [`⚠️ Template write (${file.key}): dit wijzigt de pagina-layout direct.`],
  });
}

function inspectSectionFile(file) {
  const value = String(file.value || "");
  const warnings = [];
  const suggestedFixes = [];
  const issues = [];
  const suggestedSchemaRewrites = [];
  const preferSelectFor = [];

  if (/^(templates|config)\//.test(file.key)) {
    return buildInspectionResult({
      issues: [
        createInspectionIssue({
          path: [file.key],
          problem:
            "Template/config writes zijn niet toegestaan in create mode. Gebruik mode='edit' voor wijzigingen aan bestaande template/config bestanden.",
          fixSuggestion:
            "Gebruik mode='edit' voor template/config-writes en beperk create mode tot nieuwe sections/<handle>.liquid bestanden.",
          issueCode: "inspection_failed_schema",
        }),
      ],
      suggestedFixes: [
        "Gebruik mode='edit' als je een bestaand template of config bestand wilt wijzigen.",
        "Beperk nieuwe section writes in create mode tot sections/<handle>.liquid.",
      ],
      shouldNarrowScope: true,
    });
  }

  if (containsLiquidInSpecialBlock(value, "stylesheet") || containsLiquidInSpecialBlock(value, "javascript")) {
    issues.push(
      createInspectionIssue({
        path: [file.key],
        problem:
          "Shopify rendert geen Liquid binnen {% stylesheet %} of {% javascript %}. Gebruik <style> of markup-level CSS variables wanneer section.id-scoping nodig is.",
        fixSuggestion: "Verplaats Liquid-afhankelijke CSS naar een <style> block.",
        issueCode: "inspection_failed_css",
      })
    );
    suggestedFixes.push(
      "Verplaats Liquid-afhankelijke CSS naar een <style> block.",
      "Laat {% stylesheet %} en {% javascript %} alleen statische CSS/JS bevatten."
    );
  }

  const { schema, error } = parseSectionSchema(value);
  if (error || !schema) {
    issues.push(
      createInspectionIssue({
        path: [file.key, "schema"],
        problem:
          "Building Inspection Failed: section files moeten een geldige {% schema %} JSON-definitie bevatten.",
        fixSuggestion: "Voeg een valide {% schema %} block toe en controleer of de schema JSON parsebaar is.",
        suggestedReplacement: error || "Schema ontbreekt volledig.",
        issueCode: "inspection_failed_schema",
      })
    );
    suggestedFixes.push(
      "Voeg een valide {% schema %} block toe.",
      "Controleer of de schema JSON parsebaar is en presets bevat.",
      error || "Schema ontbreekt volledig."
    );
    return buildInspectionResult({
      issues,
      warnings,
      suggestedFixes,
      shouldNarrowScope: false,
    });
  }

  const blocks = Array.isArray(schema.blocks) ? schema.blocks : [];
  const presets = Array.isArray(schema.presets) ? schema.presets : [];

  if (hasRawImgWithoutDimensions(value)) {
    issues.push(
      createInspectionIssue({
        path: [file.key],
        problem:
          "Building Inspection Failed: raw <img> tags zonder width en height veroorzaken instabiele Shopify sections. Gebruik image_url + image_tag of geef expliciete afmetingen mee.",
        fixSuggestion:
          "Vervang raw <img> door Shopify image_url + image_tag zodat width/height automatisch goed mee kunnen komen.",
        issueCode: "inspection_failed_media",
      })
    );
    suggestedFixes.push(
      "Vervang raw <img> door Shopify image_url + image_tag zodat width/height automatisch goed mee kunnen komen.",
      "Gebruik image_picker, collection of andere Shopify resource settings voor merchant-editable media."
    );
  }

  if (presets.length === 0) {
    issues.push(
      createInspectionIssue({
        path: [file.key, "schema", "presets"],
        problem:
          "Building Inspection Failed: nieuwe sections moeten presets bevatten zodat ze zichtbaar zijn in de Theme Editor.",
        fixSuggestion: "Voeg minimaal één preset toe aan de schema JSON.",
        issueCode: "inspection_failed_schema",
      })
    );
    suggestedFixes.push(
      "Voeg minimaal één preset toe aan de schema JSON.",
      "Geef de preset default blocks mee wanneer de section herhaalbare content gebruikt."
    );
  }

  if (!hasRenderableContentOutsideSchema(value)) {
    issues.push(
      createInspectionIssue({
        path: [file.key],
        problem:
          "Building Inspection Failed: nieuwe sections moeten renderbare markup of block-rendering bevatten. Een schema-only of style-only stub is niet toegestaan.",
        fixSuggestion: "Voeg daadwerkelijke section-markup toe buiten het {% schema %} block.",
        issueCode: "inspection_failed_incomplete_section",
      })
    );
    suggestedFixes.push(
      "Voeg daadwerkelijke section-markup toe buiten het {% schema %} block.",
      "Gebruik desnoods {% content_for 'blocks' %} of renderbare HTML/Liquid in de section body."
    );
  }

  const rangeIssues = collectSchemaRangeIssues(schema);
  if (rangeIssues.length > 0) {
    issues.push(...rangeIssues.map((issue) => buildRangeIssueDiagnostic(issue)));
    suggestedFixes.push(
      ...rangeIssues.flatMap((issue) => buildRangeIssueSuggestedFixes(issue))
    );
    suggestedSchemaRewrites.push(
      ...rangeIssues.flatMap((issue) => buildRangeIssueSchemaRewrites(issue))
    );
    preferSelectFor.push(
      ...rangeIssues.map((issue) => buildPreferSelectEntry(issue)).filter(Boolean)
    );
  }

  const settingTypes = collectSchemaSettingTypes(schema);

  if (settingTypes.has("color_scheme_group")) {
    issues.push(
      createInspectionIssue({
        path: [file.key, "schema", "settings"],
        problem:
          "Building Inspection Failed: color_scheme_group hoort in config/settings_schema.json en niet in een section schema.",
        fixSuggestion: "Verwijder color_scheme_group uit de section schema settings.",
        issueCode: "inspection_failed_schema",
      })
    );
    suggestedFixes.push(
      "Verwijder color_scheme_group uit de section schema settings.",
      "Gebruik in sections alleen color_scheme wanneer het theme al globale color schemes heeft."
    );
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
    issues.push(
      createInspectionIssue({
        path: [file.key],
        problem:
          "Building Inspection Failed: de section bevat lokale CSS, maar die is te minimaal om als premium standalone section te slagen.",
        fixSuggestion:
          "Voeg responsieve regels, spacing en een duidelijke layout primitive toe zodat de section meer dan een minimale CSS-stub bevat.",
        issueCode: "standalone_section_too_minimal",
      })
    );
    suggestedFixes.push(
      "Voeg responsieve regels, spacing en een duidelijke layout primitive toe.",
      "Laat standalone sections meer dan een minimale CSS-stub zien: combineer bij voorkeur responsiviteit, layout, spacing en visuele afwerking.",
      "Gebruik grid/flex wanneer de section een meerkoloms of card-based layout heeft.",
      "Geef de section een visuele afwerking zoals border-radius, borders of background treatment."
    );
  }

  if (!hasScopedCss) {
    warnings.push("No local <style> or {% stylesheet %} block detected. Zorg dat standalone sections hun eigen component-styling meenemen.");
  }
  if (!hasResponsive) {
    warnings.push("No explicit responsive hint detected. Voeg waar nodig @media of clamp() toe.");
    suggestedFixes.push("Voeg responsieve spacing en stacking toe voor mobiele breakpoints.");
  }
  if (!settingTypes.has("range")) {
    warnings.push(
      "Schema mist een merchant-editable spacing/layout control. Dit is optioneel; gebruik alleen een range of select als die layoutkeuze echt door merchants verstelbaar moet zijn."
    );
    suggestedFixes.push(
      "Voeg alleen een range of select toe voor spacing/layout als deze controle daadwerkelijk merchant-editable moet zijn."
    );
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
  if (schema && Object.prototype.hasOwnProperty.call(schema, "templates")) {
    warnings.push(
      "Schema gebruikt legacy 'templates' voor template-beschikbaarheid. Gebruik bij voorkeur enabled_on/disabled_on voor nieuwe sections."
    );
    suggestedFixes.push(
      "Vervang de legacy 'templates' property door enabled_on/disabled_on wanneer je een nieuwe section aan specifieke templates wilt koppelen."
    );
  }

  return buildInspectionResult({
    issues,
    warnings,
    suggestedFixes,
    shouldNarrowScope: false,
    suggestedSchemaRewrites,
    preferSelectFor,
    qualityWarnings: summarizeMinimalSectionQuality(value, schema),
  });
}

function inspectThemeBlockFile(file) {
  const value = String(file.value || "");
  const warnings = [];
  const suggestedFixes = [];
  const issues = [];
  const suggestedSchemaRewrites = [];
  const preferSelectFor = [];

  if (containsLiquidInSpecialBlock(value, "stylesheet") || containsLiquidInSpecialBlock(value, "javascript")) {
    issues.push(
      createInspectionIssue({
        path: [file.key],
        problem:
          "Shopify rendert geen Liquid binnen {% stylesheet %} of {% javascript %} in blocks/*.liquid. Gebruik <style> of markup-level CSS variables wanneer dynamic block styling nodig is.",
        fixSuggestion: "Verplaats Liquid-afhankelijke CSS naar een <style> block.",
        issueCode: "inspection_failed_css",
      })
    );
    suggestedFixes.push(
      "Verplaats Liquid-afhankelijke CSS naar een <style> block.",
      "Laat {% stylesheet %} en {% javascript %} alleen statische CSS/JS bevatten."
    );
  }

  const { schema, error } = parseSectionSchema(value);
  if (error || !schema) {
    issues.push(
      createInspectionIssue({
        path: [file.key, "schema"],
        problem:
          "Building Inspection Failed: blocks/*.liquid bestanden moeten een geldige {% schema %} JSON-definitie bevatten.",
        fixSuggestion: "Voeg een valide {% schema %} block toe aan het block-bestand.",
        suggestedReplacement: error || "Schema ontbreekt volledig.",
        issueCode: "inspection_failed_schema",
      })
    );
    suggestedFixes.push(
      "Voeg een valide {% schema %} block toe aan het block-bestand.",
      error || "Schema ontbreekt volledig."
    );
    return buildInspectionResult({
      issues,
      warnings,
      suggestedFixes,
    });
  }

  const rangeIssues = collectSchemaRangeIssues(schema);
  if (rangeIssues.length > 0) {
    issues.push(...rangeIssues.map((issue) => buildRangeIssueDiagnostic(issue)));
    suggestedFixes.push(
      ...rangeIssues.flatMap((issue) => buildRangeIssueSuggestedFixes(issue))
    );
    suggestedSchemaRewrites.push(
      ...rangeIssues.flatMap((issue) => buildRangeIssueSchemaRewrites(issue))
    );
    preferSelectFor.push(
      ...rangeIssues.map((issue) => buildPreferSelectEntry(issue)).filter(Boolean)
    );
  }

  const settingTypes = collectSchemaSettingTypes(schema);
  if (settingTypes.has("video_url") && !settingTypes.has("video")) {
    warnings.push(
      "Schema gebruikt video_url. Dit ondersteunt externe YouTube/Vimeo URLs; gebruik type 'video' voor merchant-uploaded videobestanden."
    );
    suggestedFixes.push(
      "Gebruik een video setting in plaats van video_url wanneer de gebruiker een video moet uploaden in het theme."
    );
  }

  if (hasRawImgWithoutDimensions(value)) {
    issues.push(
      createInspectionIssue({
        path: [file.key],
        problem:
          "Building Inspection Failed: raw <img> tags zonder width en height veroorzaken instabiele Shopify blocks. Gebruik image_url + image_tag of geef expliciete afmetingen mee.",
        fixSuggestion:
          "Vervang raw <img> door Shopify image_url + image_tag zodat width/height automatisch goed mee kunnen komen.",
        issueCode: "inspection_failed_media",
      })
    );
    suggestedFixes.push(
      "Vervang raw <img> door Shopify image_url + image_tag zodat width/height automatisch goed mee kunnen komen."
    );
  }

  if (!hasLiquidBlockTag(value, "doc")) {
    warnings.push(
      "Theme block mist een {% doc %} block. Dit is aanbevolen voor tooling en vereist wanneer het block statisch via content_for 'block' wordt gerenderd."
    );
    suggestedFixes.push(
      "Voeg een compact {% doc %} block toe bovenaan het block-bestand wanneer dit block tooling- of static-rendered gebruik krijgt."
    );
  }

  return buildInspectionResult({
    issues,
    warnings,
    suggestedFixes,
    suggestedSchemaRewrites,
    preferSelectFor,
  });
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

function summarizeNormalizedDraftArgs(input = {}) {
  return {
    themeId: input.themeId ?? null,
    themeRole: input.themeRole || null,
    mode: input.mode || null,
    isStandalone: Boolean(input.isStandalone),
    files: Array.isArray(input.files)
      ? input.files.map((file) => ({
          key: file.key,
          writeMode:
            file.value !== undefined
              ? "value"
              : Array.isArray(file.patches) && file.patches.length > 1
                ? "patches"
                : "patch",
          patchCount: Array.isArray(file.patches) ? file.patches.length : 0,
          valueLength:
            typeof file.value === "string" ? file.value.length : undefined,
          hasBaseChecksumMd5: Boolean(file.baseChecksumMd5),
        }))
      : [],
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
  nextAction,
  retryMode,
  normalizedArgs,
  suggestedSchemaRewrites = [],
  preferSelectFor = [],
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
    ...(nextAction ? { nextAction } : {}),
    ...(retryMode ? { retryMode } : {}),
    ...(normalizedArgs ? { normalizedArgs } : {}),
    ...(suggestedSchemaRewrites.length > 0
      ? { suggestedSchemaRewrites }
      : {}),
    ...(preferSelectFor.length > 0 ? { preferSelectFor } : {}),
  };
}

function uniqueStrings(values) {
  return Array.from(new Set((values || []).filter(Boolean)));
}

function buildAggregatedInspectionFailure({
  normalizedArgs,
  warnings = [],
  issues = [],
  suggestedFixes = [],
  suggestedSchemaRewrites = [],
  preferSelectFor = [],
  shouldNarrowScope = false,
}) {
  const normalizedIssues = (issues || []).filter(Boolean);
  const primaryIssue = normalizedIssues[0];
  const primaryProblem =
    primaryIssue?.problem ||
    "Lokale validatie van de section-artifact faalde.";
  const distinctIssueCodes = Array.from(
    new Set(normalizedIssues.map((issue) => issue?.issueCode).filter(Boolean))
  );
  const errorCode =
    normalizedIssues.length > 1
      ? "inspection_failed_multiple"
      : distinctIssueCodes[0] ||
        (preferSelectFor.length > 0
          ? "inspection_failed_schema_range"
          : "inspection_failed_local_validation");

  return buildFailureResponse({
    status: "inspection_failed",
    message: `Building Inspection Failed: ${primaryProblem}`,
    warnings,
    errors: normalizedIssues,
    errorCode,
    retryable: true,
    suggestedFixes,
    shouldNarrowScope,
    nextAction: "fix_local_validation",
    retryMode: "same_request_after_fix",
    normalizedArgs,
    suggestedSchemaRewrites,
    preferSelectFor,
  });
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

function buildDraftInputError({
  path = [],
  problem,
  fixSuggestion,
  suggestedReplacement,
  issueCode,
}) {
  return {
    path,
    problem,
    fixSuggestion,
    ...(issueCode ? { issueCode } : {}),
    ...(suggestedReplacement !== undefined ? { suggestedReplacement } : {}),
  };
}

function mergeInspectionIntoAccumulator(accumulator, inspection = {}) {
  accumulator.issues.push(...(inspection.issues || []));
  accumulator.warnings.push(...(inspection.warnings || []));
  accumulator.suggestedFixes.push(...(inspection.suggestedFixes || []));
  accumulator.suggestedSchemaRewrites.push(
    ...(inspection.suggestedSchemaRewrites || [])
  );
  accumulator.preferSelectFor.push(...(inspection.preferSelectFor || []));
  accumulator.shouldNarrowScope =
    accumulator.shouldNarrowScope || Boolean(inspection.shouldNarrowScope);
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

function parseRichtextDefaultFailure(message) {
  const source = String(message || "");
  if (!/invalid richtext/i.test(source)) {
    return null;
  }

  const forbiddenTagMatch = source.match(/Tag '<([^>]+)>' is not permitted/i);
  const blockMatch = source.match(/Invalid block '([^']+)'/i);
  const settingMatch = source.match(/setting with id="([^"]+)"/i);
  const topLevelNodeViolation = /top[- ]level nodes must be '<(?:p|ul)>' tags/i.test(source);

  return {
    source,
    forbiddenTag: forbiddenTagMatch?.[1] || null,
    blockId: blockMatch?.[1] || null,
    settingId: settingMatch?.[1] || null,
    topLevelNodeViolation,
  };
}

function buildRichtextDefaultFailurePath(key, violation) {
  const path = [key];
  if (violation?.blockId) {
    path.push("schema", "blocks", violation.blockId, "settings");
  } else {
    path.push("schema", "settings");
  }
  if (violation?.settingId) {
    path.push(violation.settingId, "default");
  }
  return path;
}

function classifyRichtextDefaultFailure({ message, failedKeys = [] } = {}) {
  const violation = parseRichtextDefaultFailure(message);
  if (!violation) {
    return null;
  }

  const failedKey = failedKeys[0] || "files";
  const topLevelHint = violation.topLevelNodeViolation
    ? "Gebruik `<p>` of `<ul>` als top-level richtext node."
    : "Wrap richtext defaults bij voorkeur in `<p>` of `<ul>`.";
  const forbiddenTagHint = violation.forbiddenTag
    ? `Vervang \`<${violation.forbiddenTag}>\` door platte tekst of een toegestane richtext tag zoals \`<strong>\`, \`<em>\`, \`<u>\`, \`<span>\` of \`<a>\`.`
    : "Gebruik alleen Shopify-toegestane richtext tags in richtext defaults.";
  const issueCode = violation.forbiddenTag
    ? "richtext_default_forbidden_tag"
    : "richtext_default_invalid_html";

  return {
    errorCode: issueCode,
    retryable: true,
    shouldNarrowScope: false,
    message: `Na linten is de preview niet volledig toegepast: ${violation.source}`,
    suggestedFixes: uniqueStrings([
      forbiddenTagHint,
      topLevelHint,
      "Gebruik `html` of `liquid` settings als je bewust rijkere markup nodig hebt dan Shopify richtext defaults toestaan.",
    ]),
    nextAction: "fix_richtext_default",
    retryMode: "same_request_after_fix",
    errors: [
      buildDraftInputError({
        path: buildRichtextDefaultFailurePath(failedKey, violation),
        problem: violation.forbiddenTag
          ? `Shopify accepteert \`<${violation.forbiddenTag}>\` niet in richtext.default.`
          : "Shopify accepteert deze richtext.default niet.",
        fixSuggestion: `${forbiddenTagHint} ${topLevelHint}`,
        suggestedReplacement: violation.forbiddenTag
          ? "<p>Gebruik platte tekst of <strong>nadruk</strong> binnen de richtext default.</p>"
          : "<p>Gebruik alleen toegestane richtext HTML binnen de default.</p>",
        issueCode,
      }),
    ],
  };
}

function classifyPreviewUploadError(error, files) {
  const message = String(error?.message || error || "");
  const richtextFailure = classifyRichtextDefaultFailure({
    message,
    failedKeys: files.map((file) => file.key).filter(Boolean),
  });
  if (richtextFailure) {
    return richtextFailure;
  }

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
  const richtextFailure = classifyRichtextDefaultFailure({
    message: firstFailureMessage,
    failedKeys,
  });

  if (richtextFailure) {
    return {
      failures,
      ...richtextFailure,
    };
  }

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

function fileUsesTranslations(file) {
  const value = String(file?.value || "");
  return (
    String(file?.key || "").startsWith("locales/") ||
    /\|\s*(?:t|translate)\b/i.test(value) ||
    /["']t:[^"']+["']/i.test(value)
  );
}

function needsLocaleLintContext(files = []) {
  return files.some((file) => fileUsesTranslations(file));
}

async function fetchLocaleLintSupportFiles({
  files,
  shopifyClient,
  apiVersion,
  themeId,
  themeRole,
}) {
  if (!needsLocaleLintContext(files)) {
    return [];
  }

  const draftKeys = new Set(
    files.map((file) => String(file.key || "").trim()).filter(Boolean)
  );

  const result = await searchThemeFiles(shopifyClient, apiVersion, {
    themeId,
    themeRole,
    patterns: ["locales/*.default.json", "locales/*.default.schema.json"],
    includeContent: true,
    resultLimit: 10,
  });

  return (result.files || []).filter(
    (file) =>
      file &&
      file.found &&
      typeof file.value === "string" &&
      !draftKeys.has(String(file.key || "").trim())
  );
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
  inputSchema: DraftThemeArtifactPublicObjectSchema,
  schema: inputSchema,
  execute: async (rawArgs, context = {}) => {
    const normalizedCandidate = normalizeDraftThemeArtifactInput(rawArgs);
    const normalizedCandidateArgs =
      normalizedCandidate &&
      typeof normalizedCandidate === "object" &&
      !Array.isArray(normalizedCandidate)
        ? summarizeNormalizedDraftArgs(normalizedCandidate)
        : summarizeNormalizedDraftArgs({});

    const normalizedParse =
      NormalizedThemeDraftArtifactInputSchema.safeParse(rawArgs);
    if (!normalizedParse.success) {
      return buildFailureResponse({
        status: "needs_input",
        message:
          "De draft kon deze compat-input niet veilig normaliseren. Corrigeer de conflicterende velden en probeer opnieuw.",
        errorCode: "invalid_draft_theme_artifact_input",
        retryable: true,
        nextAction: "fix_input",
        retryMode: "same_request_with_structured_fields",
        normalizedArgs: normalizedCandidateArgs,
        errors: normalizedParse.error.issues.map((issue) =>
          buildDraftInputError({
            path: issue.path,
            problem: issue.message,
            fixSuggestion:
              issue.path.join(".") === "themeId"
                ? "Stuur alleen themeId of alleen themeRole mee."
                : issue.path.join(".").includes("patch") &&
                    issue.message.includes("mode='create'")
                  ? "Gebruik mode='edit' voor patch/patches of stuur in create mode een volledige value-write."
                  : "Corrigeer dit invoerveld en probeer dezelfde toolcall opnieuw.",
          })
        ),
      });
    }

    const input = normalizedParse.data;
    let {
      files = [],
      themeId,
      themeRole,
      mode: requestedMode,
    } = input;
    let mode = requestedMode;
    const warnings = [];
    const suggestedFixes = [];
    const getNormalizedArgs = () =>
      summarizeNormalizedDraftArgs({
        themeId,
        themeRole,
        mode,
        isStandalone: input.isStandalone,
        files,
      });

    if (!themeId && !themeRole) {
      return buildFailureResponse({
        status: "missing_theme_target",
        message:
          "Geef aan op welk thema je wilt schrijven via themeRole ('main', 'development', 'unpublished') of themeId. Vraag dit aan de gebruiker als het niet is opgegeven.",
        errorCode: "missing_theme_target",
        retryable: true,
        suggestedFixes: [
          "Vraag de gebruiker: 'Op welk thema wil je dit toepassen?'",
        ],
        shouldNarrowScope: false,
        nextAction: "provide_theme_target",
        retryMode: "same_request_with_theme_target",
        normalizedArgs: getNormalizedArgs(),
        errors: [
          buildDraftInputError({
            path: ["themeRole"],
            problem:
              "Er ontbreekt een expliciet theme target. Deze tool kiest nooit stilzwijgend een theme.",
            fixSuggestion:
              "Voeg themeRole of themeId toe, bijvoorbeeld themeRole='main' of themeId=123456789.",
          }),
        ],
      });
    }

    if (!Array.isArray(files) || files.length === 0) {
      return buildFailureResponse({
        status: "needs_write_payload",
        message:
          "Deze draft mist gestructureerde write-inhoud. Summary-only input mag hooguit theme target en exact één file path infereren.",
        errorCode: "missing_draft_files",
        retryable: true,
        suggestedFixes: [
          "Geef files[] mee voor canonieke multi-file writes.",
          "Of gebruik een veilige single-file shorthand: key + value/content/liquid of key + patch/patches.",
          "Vrije summary-tekst mag nooit de daadwerkelijke file-inhoud vervangen.",
        ],
        shouldNarrowScope: false,
        nextAction: "provide_structured_write_payload",
        retryMode: "same_request_with_structured_fields",
        normalizedArgs: getNormalizedArgs(),
        errors: [
          buildDraftInputError({
            path: ["files"],
            problem:
              "De draft bevat geen files[] payload en ook geen veilige single-file shorthand met write-inhoud.",
            fixSuggestion:
              "Stuur files[] mee of gebruik key + value/content/liquid of key + patch/patches.",
          }),
        ],
      });
    }

    const shopifyClient = requireShopifyClient(context);
    const resolvedMode = resolveDraftMode(requestedMode, files);
    const shouldProbeExistingFiles = resolvedMode.probeExistingFiles;
    mode = resolvedMode.mode;

    if (resolvedMode.warning) {
      warnings.push(resolvedMode.warning);
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
        nextAction: "deduplicate_file_entries",
        retryMode: "same_request_after_fix",
        normalizedArgs: getNormalizedArgs(),
        errors: [
          buildDraftInputError({
            path: ["files"],
            problem: `Dubbele file key gedetecteerd: '${duplicateKey}'.`,
            fixSuggestion:
              "Gebruik per key precies één files[] entry en combineer meerdere vervangingen desnoods met patches[].",
          }),
        ],
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
          nextAction: "fix_file_write_mode",
          retryMode: "same_request_after_fix",
          normalizedArgs: getNormalizedArgs(),
          errors: [
            buildDraftInputError({
              path: ["files", files.indexOf(file)],
              problem: `Bestand '${file.key}' gebruikt geen eenduidige write-mode.`,
              fixSuggestion:
                "Gebruik precies één van value, patch of patches per bestand.",
            }),
          ],
        });
      }
    }

    let resolvedFiles = [];
    let needsOriginal =
      files.some((f) => f.patches.length > 0) || mode === "edit" || shouldProbeExistingFiles;
    
    if (needsOriginal) {
      try {
        const apiVersion = process.env.SHOPIFY_API_VERSION || "2026-01";
        const keysToFetch = files.map(f => f.key);
        const fetchedFiles = await getThemeFiles(shopifyClient, apiVersion, { themeId, themeRole, keys: keysToFetch, includeContent: true });
        
        const fetchedByKey = new Map(fetchedFiles.files.map(f => [f.key, f]));

        if (shouldProbeExistingFiles) {
          const existingCount = files.filter((file) => {
            const original = fetchedByKey.get(file.key);
            return Boolean(original && !original.missing);
          }).length;

          if (existingCount === files.length) {
            mode = "edit";
            warnings.push(
              "Geen top-level mode opgegeven; omdat alle doelbestanden al bestaan behandelt de pipeline deze value-write als mode='edit'. Zet mode voortaan expliciet op top-level en niet in files[]."
            );
          } else if (existingCount === 0) {
            warnings.push(
              "Geen top-level mode opgegeven; omdat de doelbestanden nog niet bestaan behandelt de pipeline deze value-write als mode='create'. Zet mode voortaan expliciet op top-level en niet in files[]."
            );
          } else {
            return buildFailureResponse({
              status: "inspection_failed",
              message:
                "Deze request combineert bestaande en nieuwe bestanden terwijl top-level mode ontbreekt. Daardoor kan de pipeline niet veilig bepalen of dit een create- of edit-flow is.",
              errorCode: "inspection_failed_missing_mode",
              retryable: true,
              suggestedFixes: [
                "Zet top-level mode expliciet op 'edit' als je bestaande bestanden wijzigt.",
                "Zet top-level mode expliciet op 'create' als alle bestanden nieuw zijn, of splits create/edit in aparte requests.",
              ],
              shouldNarrowScope: false,
              nextAction: "set_explicit_mode",
              retryMode: "same_request_after_fix",
              normalizedArgs: getNormalizedArgs(),
            });
          }
        }

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
               const matchCount = countLiteralOccurrences(newValue, searchString);
               if (matchCount === 0) {
                return buildFailureResponse({
                  status: "inspection_failed",
                  message: `Patch ${index + 1} failed: De searchString '${searchString.substring(0, 50)}...' werd niet gevonden in '${file.key}'.`,
                  errorCode: "patch_failed_nomatch",
                  retryable: true,
                 suggestedFixes: [
                   "Gebruik search-theme-files om de exacte string of omliggende context te achterhalen.",
                   "Zorg dat witruimte, quotes en inspringing exact overeenkomen met het doelbestand.",
                 ],
                 shouldNarrowScope: false,
                 nextAction: "refresh_patch_anchor",
                 retryMode: "same_request_after_fix",
                 normalizedArgs: getNormalizedArgs(),
                 errors: [
                   buildDraftInputError({
                     path: ["files", files.indexOf(file), "patches", index, "searchString"],
                     problem: `De searchString voor '${file.key}' matchte niet in het huidige doelbestand.`,
                     fixSuggestion:
                       "Lees het doelbestand opnieuw of maak de anchor nauwkeuriger met unieke omliggende context.",
                   }),
                 ],
                });
               }
               if (matchCount > 1) {
                return buildFailureResponse({
                  status: "inspection_failed",
                  message: `Patch ${index + 1} failed: De searchString '${searchString.substring(0, 50)}...' matchte ${matchCount} keer in '${file.key}', waardoor de patch niet veilig uniek toepasbaar is.`,
                  errorCode: "patch_failed_ambiguous_match",
                  retryable: true,
                  suggestedFixes: [
                    `Maak de searchString unieker zodat deze maar één keer voorkomt in '${file.key}'.`,
                    "Gebruik search-theme-files of get-theme-file om extra omliggende context mee te nemen in de literal anchor.",
                    "Voor section schema patches: kies een anchor die alleen in het {% schema %} block voorkomt, niet alleen een block type of setting-id.",
                  ],
                  shouldNarrowScope: false,
                  nextAction: "make_patch_anchor_unique",
                  retryMode: "same_request_after_fix",
                  normalizedArgs: getNormalizedArgs(),
                  errors: [
                    buildDraftInputError({
                      path: ["files", files.indexOf(file), "patches", index, "searchString"],
                      problem: `De searchString voor '${file.key}' matchte ${matchCount} keer en is daardoor niet veilig uniek.`,
                      fixSuggestion:
                        "Maak de anchor specifieker zodat deze exact één keer voorkomt.",
                    }),
                  ],
                });
               }
               newValue = newValue.replace(searchString, patch.replaceString);
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
                  nextAction: "send_complete_file_or_patch",
                  retryMode: "same_request_after_fix",
                  normalizedArgs: getNormalizedArgs(),
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
                   nextAction: "restore_schema_block",
                   retryMode: "same_request_after_fix",
                   normalizedArgs: getNormalizedArgs(),
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
          nextAction: "retry_after_read",
          retryMode: "same_request_after_fix",
          normalizedArgs: getNormalizedArgs(),
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
          nextAction: "rewrite_color_scheme_settings",
          retryMode: "same_request_after_fix",
          normalizedArgs: getNormalizedArgs(),
          errors: [
            buildDraftInputError({
              path: ["files"],
              problem: themeCompatibility.reason,
              fixSuggestion:
                "Gebruik simpele color settings of maak eerst het theme compatibel met color_scheme via een aparte edit-flow.",
            }),
          ],
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
        nextAction: "retry_theme_compatibility_check",
        retryMode: "same_request_after_fix",
        normalizedArgs: getNormalizedArgs(),
      });
    }

    const localInspection = {
      issues: [],
      warnings: [...warnings],
      suggestedFixes: [...suggestedFixes],
      suggestedSchemaRewrites: [],
      preferSelectFor: [],
      shouldNarrowScope: false,
    };

    for (const file of files) {
      const isTemplateConfig = /^(templates|config)\//.test(file.key);
      const isSectionFile = file.key.endsWith(".liquid") && file.key.startsWith("sections/");
      const isBlockFile = file.key.endsWith(".liquid") && file.key.startsWith("blocks/");
      let inspection = null;

      if (isTemplateConfig) {
        if (mode === "create") {
          inspection = inspectSectionFile(file);
        } else {
          inspection = file.key.startsWith("config/")
            ? inspectConfigFile(file)
            : inspectTemplateFile(file);
        }
      } else if (isSectionFile) {
        if (mode === "create") {
          inspection = inspectSectionFile(file);
        } else {
          const value = String(file.value || "");
          const editIssues = [];
          const editWarnings = [];
          const editSuggestedFixes = [];
          const editSchemaRewrites = [];
          const editPreferSelectFor = [];

          if (containsLiquidInSpecialBlock(value, "stylesheet") || containsLiquidInSpecialBlock(value, "javascript")) {
            editIssues.push(
              createInspectionIssue({
                path: [file.key],
                problem:
                  "Liquid binnen {% stylesheet %} of {% javascript %} is niet toegestaan. Gebruik <style> of markup-level CSS variables.",
                fixSuggestion:
                  "Verplaats Liquid-afhankelijke CSS naar een <style> block.",
                issueCode: "inspection_failed_css",
              })
            );
            editSuggestedFixes.push(
              "Verplaats Liquid-afhankelijke CSS naar een <style> block.",
              "Laat {% stylesheet %} en {% javascript %} alleen statische CSS/JS bevatten."
            );
          }
          const schemaInspection = inspectEditableLiquidSchema(value, `Section '${file.key}'`);
          editIssues.push(...(schemaInspection.issues || []));
          editWarnings.push(...(schemaInspection.warnings || []));
          editSuggestedFixes.push(...(schemaInspection.suggestedFixes || []));
          editSchemaRewrites.push(
            ...(schemaInspection.suggestedSchemaRewrites || [])
          );
          editPreferSelectFor.push(...(schemaInspection.preferSelectFor || []));

          inspection = buildInspectionResult({
            issues: editIssues,
            warnings: editWarnings,
            suggestedFixes: editSuggestedFixes,
            suggestedSchemaRewrites: editSchemaRewrites,
            preferSelectFor: editPreferSelectFor,
          });
        }
      } else if (isBlockFile) {
        if (mode === "create") {
          inspection = inspectThemeBlockFile(file);
        } else {
          const value = String(file.value || "");
          const editIssues = [];
          const editWarnings = [];
          const editSuggestedFixes = [];
          const editSchemaRewrites = [];
          const editPreferSelectFor = [];

          if (containsLiquidInSpecialBlock(value, "stylesheet") || containsLiquidInSpecialBlock(value, "javascript")) {
            editIssues.push(
              createInspectionIssue({
                path: [file.key],
                problem:
                  "Liquid binnen {% stylesheet %} of {% javascript %} is niet toegestaan. Gebruik <style> of markup-level CSS variables.",
                fixSuggestion:
                  "Verplaats Liquid-afhankelijke CSS naar een <style> block.",
                issueCode: "inspection_failed_css",
              })
            );
            editSuggestedFixes.push(
              "Verplaats Liquid-afhankelijke CSS naar een <style> block.",
              "Laat {% stylesheet %} en {% javascript %} alleen statische CSS/JS bevatten."
            );
          }
          const schemaInspection = inspectEditableLiquidSchema(value, `Block '${file.key}'`);
          editIssues.push(...(schemaInspection.issues || []));
          editWarnings.push(...(schemaInspection.warnings || []));
          editSuggestedFixes.push(...(schemaInspection.suggestedFixes || []));
          editSchemaRewrites.push(
            ...(schemaInspection.suggestedSchemaRewrites || [])
          );
          editPreferSelectFor.push(...(schemaInspection.preferSelectFor || []));

          inspection = buildInspectionResult({
            issues: editIssues,
            warnings: editWarnings,
            suggestedFixes: editSuggestedFixes,
            suggestedSchemaRewrites: editSchemaRewrites,
            preferSelectFor: editPreferSelectFor,
          });
        }
      }

      if (inspection) {
        mergeInspectionIntoAccumulator(localInspection, inspection);
      }
      // Snippets, assets, locales: geen aanvullende inspectie nodig
    }

    if (localInspection.issues.length > 0) {
      return buildAggregatedInspectionFailure({
        normalizedArgs: getNormalizedArgs(),
        warnings: uniqueStrings(localInspection.warnings),
        issues: localInspection.issues,
        suggestedFixes: uniqueStrings(localInspection.suggestedFixes),
        suggestedSchemaRewrites: localInspection.suggestedSchemaRewrites,
        preferSelectFor: localInspection.preferSelectFor,
        shouldNarrowScope: localInspection.shouldNarrowScope,
      });
    }

    warnings.splice(0, warnings.length, ...uniqueStrings(localInspection.warnings));
    suggestedFixes.splice(
      0,
      suggestedFixes.length,
      ...uniqueStrings(localInspection.suggestedFixes)
    );

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
    let lintSupportWarnings = [];
    let lintSupportFiles = [];

    try {
      try {
        lintSupportFiles = await fetchLocaleLintSupportFiles({
          files,
          shopifyClient,
          apiVersion: process.env.SHOPIFY_API_VERSION || "2026-01",
          themeId,
          themeRole,
        });

        if (needsLocaleLintContext(files) && lintSupportFiles.length === 0) {
          lintSupportWarnings.push(
            "Geen default locale files opgehaald voor de lint-sandbox. Translation checks kunnen daardoor strenger uitvallen dan in het echte theme."
          );
        }
      } catch (error) {
        lintSupportWarnings.push(
          `Kon default locale files niet ophalen voor de lint-sandbox: ${error.message}`
        );
      }

      await fs.mkdir(path.join(tmpDir, "locales"), { recursive: true });
      for (const file of [...lintSupportFiles, ...files]) {
        const fullPath = path.join(tmpDir, file.key);
        await fs.mkdir(path.dirname(fullPath), { recursive: true });
        await fs.writeFile(fullPath, file.value, "utf8");
      }
      warnings.push(...lintSupportWarnings);

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
        nextAction: "fix_lint_errors",
        retryMode: "same_request_after_fix",
        normalizedArgs: getNormalizedArgs(),
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
          errors: classified.errors || failedPreviewWrites,
          draft: buildDraftPayload(draftRecord, {
            verifySummary: upsertResult.verifySummary || null,
            verifyResults: upsertResult.results || [],
            warnings,
          }),
          errorCode: classified.errorCode,
          retryable: classified.retryable,
          suggestedFixes: [...suggestedFixes, ...classified.suggestedFixes],
          shouldNarrowScope: classified.shouldNarrowScope,
          nextAction:
            classified.nextAction ||
            (classified.errorCode === "preview_failed_precondition"
              ? "refresh_checksum_and_retry"
              : "retry_preview_upload"),
          retryMode:
            classified.retryMode ||
            (classified.errorCode === "preview_failed_precondition"
              ? "same_request_after_refresh"
              : "same_request_after_fix"),
          normalizedArgs: getNormalizedArgs(),
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
        normalizedArgs: getNormalizedArgs(),
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
        message:
          classified.message || `Na linten faalde de Shopify preview upload: ${error.message}`,
        warnings,
        errors: classified.errors,
        draft: buildDraftPayload(draftRecord, { warnings }),
        errorCode: classified.errorCode,
        retryable: classified.retryable,
        suggestedFixes: [...suggestedFixes, ...classified.suggestedFixes],
        shouldNarrowScope: classified.shouldNarrowScope,
        nextAction: classified.nextAction || "retry_preview_upload",
        retryMode: classified.retryMode || "same_request_after_fix",
        normalizedArgs: getNormalizedArgs(),
      });
    }
  },
};
