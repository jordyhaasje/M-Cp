import { z } from "zod";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { check } from "@shopify/theme-check-node";
import { createThemeDraftRecord, updateThemeDraftRecord } from "../lib/db.js";
import { parseJsonLike } from "../lib/jsonLike.js";
import {
  analyzeSectionScale,
  classifySectionGeneration,
  inspectSectionScaleAgainstTheme,
} from "../lib/themeSectionContext.js";
import {
  getRecentThemeRead,
  getThemeEditMemory,
  haveRecentThemeReads,
  rememberThemeWrite,
  themeTargetsCompatible,
} from "../lib/themeEditMemory.js";
import { hydrateExactThemeReads } from "../lib/themeReadHydration.js";
import { getShopDomainFromClient, upsertThemeFiles, getThemeFiles, searchThemeFiles } from "../lib/themeFiles.js";
import { requireShopifyClient } from "./_context.js";
import {
  extractThemeToolSummary,
  inferSingleThemeFile,
  inferThemeTargetFromSummary,
} from "./_themeToolCompatibility.js";

export const toolName = "draft-theme-artifact";
export const title = "Write Theme Files";
export const description = `Advanced write tool for Shopify theme files. Use this for multi-file edits, full rewrites, or broader theme changes. For a brand-new section prefer create-theme-section first. For small single-file literal fixes prefer patch-theme-file. For broad visual refinements of an existing section, prefer mode='edit' with a full rewrite over long patch arrays. In mode='edit', files[].value must contain the full rewritten file content, not a placeholder like REWRITE_ALREADY_APPLIED_IN_CONTEXT. Do not use apply-theme-draft for the first write.`;
export const docsDescription = `Draft and validate Shopify theme files through the guarded pipeline.

Modes:
- mode="create": Volledige inspectie voor nieuwe sections (geldig schema, presets, renderbare markup en Shopify-veilige range settings). Templates/config geblokkeerd.
- mode="edit": Lichtere inspectie voor wijzigingen aan bestaande bestanden. Templates/config TOEGESTAAN met JSON/JSONC-validatie, en sections/blocks met schema krijgen ook range-validatie.

Zet mode altijd expliciet op top-level. Alleen voor backwards compatibility infereren patch/patches automatisch mode="edit"; value-only writes zonder mode worden eerst tegen het doeltheme geprobed zodat bestaande bestanden niet stilzwijgend als create-flow worden behandeld.

Beide modes: Liquid-in-stylesheet check, theme-check linting, layout/theme.liquid bescherming.

Belangrijk: themeRole of themeId is verplicht. Vraag de gebruiker welk thema als dit niet is opgegeven.

Theme-aware section regels:
- Gebruik voor bestaande single-file edits bij voorkeur patch-theme-file. Gebruik draft-theme-artifact vooral voor multi-file edits, nieuwe sections en volledige rewrites.
- Compatibele shorthand: voor één file mag een client ook top-level key + value/content/liquid of key + searchString/replaceString aanleveren; dit wordt intern naar files[] genormaliseerd. Binnen files[] worden value/content/liquid nu ook veilig naar dezelfde canonieke value-write genormaliseerd. Als een compatibele client alleen _tool_input_summary meestuurt, infereren we daaruit hooguit theme target en exact file path. Vrije summary-tekst vervangt NOOIT gestructureerde write-velden zoals files[], value, content, liquid, patch of patches. Legacy aliases zoals summary, prompt, request en tool_input_summary blijven alleen voor backwards compatibility ondersteund.
- Gebruik in mode="edit" voor full rewrites altijd de volledige nieuwe bestandsinhoud in files[].value. Context-placeholders of samenvattingen zoals REWRITE_ALREADY_APPLIED_IN_CONTEXT zijn ongeldig; gebruik anders een letterlijke patch/patches.
- Gebruik plan-theme-edit voordat je native product-blocks, theme blocks of template placement probeert. Zo weet je eerst of het theme een single-file patch, multi-file edit of losse section-flow nodig heeft.
- Wanneer plan-theme-edit eerst exact nextReadKeys voorschrijft, probeert deze tool die planner-reads nu eerst veilig exact te hydrateren. Alleen als vereiste reads daarna nog ontbreken, blijft dezelfde write-flow geblokkeerd en krijgt de client een expliciete read-repair terug.
- Nieuwe sections worden vooraf gecontroleerd op Shopify schema-basisregels, waaronder verplichte velden zoals setting/block labels, types, ids, names en content waar relevant, plus geldige range defaults binnen min/max, geldige step-alignment en maximaal 101 stappen per range setting. Bij range-fouten geeft de tool exacte suggestedReplacement/default-hints terug.
- Nieuwe sections/blocks én nieuwe edit-writes op bestaande sections/blocks moeten blank-safe resource rendering gebruiken. Optionele settings zoals image_picker, video en video_url mogen niet onbeschermd door image_url, video_tag of external_video_* lopen; gebruik eerst een if/unless-guard of een expliciete default/fallback. Bestaande legacy-markup elders in het bestand blijft bewerkbaar zolang de nieuwe write geen extra onveilige resource-chain introduceert.
- Wanneer de create-flow compacte theme-context heeft afgeleid, controleert de pipeline ook op hero-achtige oversizing van typography, spacing, gaps en min-heights ten opzichte van representatieve content sections in het doeltheme.
- richtext defaults moeten Shopify-veilige HTML gebruiken. Gebruik top-level <p> of <ul>; tags zoals <mark> in richtext.default worden door Shopify afgewezen.
- Nieuwe blocks/*.liquid files krijgen in create mode ook een basisinspectie op geldige schema JSON en block-veilige markup.
- Presets moeten render-safe blijven: preset blocks zonder ingevulde merchant-media mogen geen Liquid runtime error veroorzaken.
- Exacte screenshot-replica's met expliciete bronmedia blijven streng: placeholder_svg_tag als hoofdmedia blokkeert dan nog steeds de eerste preview-write. Screenshot-only replica's zonder losse bron-assets mogen nu wel door met een waarschuwing en een suggested fix richting renderbare demo-media of een gestileerde media shell.
- Exact-match comparison/shell replica's worden nu ook expliciet gecontroleerd op onderscheidende decoratieve anchors uit de referentie, zoals floating productmedia of badges/seals, plus op dubbele background-shells wanneer theme wrappers zoals section-properties al een outer surface impliceren.
- Renderer-veilige Liquid blijft verplicht: geen geneste {{ ... }} of {% ... %} binnen dezelfde output-tag of filter-argumentstring; bouw zulke waarden eerst op via assign/capture en geef daarna de variabele door.
- Gebruik setting type "video" voor merchant-uploaded video bestanden. Gebruik "video_url" alleen voor externe YouTube/Vimeo URLs.
- Gebruik "color_scheme" alleen als het doeltheme al globale color schemes heeft in config/settings_schema.json + config/settings_data.json. Anders: gebruik simpele "color" settings of patch die config eerst in een aparte mode="edit" call.
- Voor native blocks binnen een bestaande section (bijv. product-info of main-product): gebruik mode="edit" en patch de bestaande schema.blocks plus de render markup/snippet. Dit is geen los blocks/*.liquid bestand.
- Native-block snippet-writes gebruiken nu ook planner-architectuur en het gerelateerde section-schema voor extra preflight: nieuwe block types of block.settings refs moeten echt in het parent schema bestaan, optionele block-media moet blank-safe blijven, en @theme/content_for('blocks') flows vereisen een echt blocks/*.liquid bestand.
- Als de gebruiker een nieuwe section ook op een homepage/productpagina geplaatst wil hebben, maak eerst sections/<handle>.liquid in mode="create" en doe daarna alleen bij expliciete placement-vraag een aparte mode="edit" call voor het relevante templates/*.json of templates/*.liquid bestand op hetzelfde expliciet gekozen thema. Gebruik config/settings_data.json alleen als uitzonderingsroute.
- Gebruik voor nieuwe sections bij voorkeur enabled_on/disabled_on in de schema in plaats van legacy "templates" wanneer je beschikbaarheid per template wilt sturen.
- Lokale inspectie en theme-check lint worden waar mogelijk samen als lokale preflight teruggegeven, zodat een retry meerdere deterministische fouten tegelijk kan repareren. Wanneer plannerHandoff aanwezig is, gebruikt deze tool nu ook de planner-afgeleide theme-context en sectionBlueprint zodat stateless clients minder context verliezen.

Rules for valid Shopify Liquid:

Do not place Liquid inside {% stylesheet %} or {% javascript %}

Use <style> or markup-level CSS variables for section.id scoping`;

const ThemeRoleSchema = z.enum(["main", "unpublished", "demo", "development"]);
const PlannerHandoffSchema = z.object({}).passthrough();

const ThemeDraftPatchSchema = z.object({
  searchString: z.string().min(1).describe("De te vervangen string in het originele bestand. Gebruik een unieke literal anchor die exact één keer voorkomt in het doelbestand."),
  replaceString: z.string().describe("De nieuwe string"),
}).strict();

const ThemeDraftPatchesSchema = z
  .array(ThemeDraftPatchSchema)
  .min(1)
  .max(10)
  .describe("Voer meerdere patches sequentieel uit binnen hetzelfde bestand. Gebruik dit wanneer een bestaand bestand meerdere losse wijzigingen nodig heeft of wanneer één unieke patch-anchor niet genoeg is.");

const SummaryFieldSchema = z.string().max(4000).optional();

const ThemeDraftFilePublicSchema = z
  .object({
    key: z.string().min(1).describe("De exacte filelocatie (bijv. sections/feature-sandbox.liquid)"),
    value: z
      .string()
      .optional()
      .describe(
        "De volledige inhoud / broncode. Voor mode='edit' full rewrites moet dit de complete nieuwe bestandsinhoud zijn, niet een context-placeholder of verkorte samenvatting. Payloads falen als ze niet Shopify OS 2.0 proof zijn: geldige schema settings en een presets-array zijn verplicht."
      ),
    content: z
      .string()
      .optional()
      .describe("Compat alias van value binnen files[]."),
    liquid: z
      .string()
      .optional()
      .describe("Compat alias van value binnen files[]."),
    value_summary: SummaryFieldSchema.describe(
      "Compat placeholderveld voor wrappers die abusievelijk een samenvatting meesturen. Dit vervangt nooit echte file-inhoud."
    ),
    content_summary: SummaryFieldSchema.describe(
      "Compat placeholderveld voor wrappers die abusievelijk een samenvatting meesturen. Dit vervangt nooit echte file-inhoud."
    ),
    liquid_summary: SummaryFieldSchema.describe(
      "Compat placeholderveld voor wrappers die abusievelijk een samenvatting meesturen. Dit vervangt nooit echte file-inhoud."
    ),
    patch: ThemeDraftPatchSchema.optional().describe("Verander een specifieke string zonder het hele bestand in te sturen. Bespaart tokens en voorkomt truncated writes."),
    patches: ThemeDraftPatchesSchema.optional(),
    baseChecksumMd5: z.string().optional().describe("Optioneel MD5 checksum voor optimistic locking. De write faalt als het bestand tussentijds is gewijzigd."),
  })
  .strict()
  .refine((data) => {
    const hasValueLike =
      data.value !== undefined ||
      data.content !== undefined ||
      data.liquid !== undefined;
    const hasValueSummaryLike =
      data.value_summary !== undefined ||
      data.content_summary !== undefined ||
      data.liquid_summary !== undefined;
    const hasPatch = data.patch !== undefined;
    const hasPatches = Array.isArray(data.patches) && data.patches.length > 0;
    return [hasValueLike || hasValueSummaryLike, hasPatch, hasPatches].filter(Boolean).length === 1;
  }, {
    message:
      "Provide exactly one logical write mode: one of 'value'/'content'/'liquid', 'patch', or 'patches'",
  });

const ThemeDraftFileSchema = z
  .object({
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
  })
  .strict()
  .refine((data) => {
    const hasValue = data.value !== undefined;
    const hasPatch = data.patch !== undefined;
    const hasPatches = Array.isArray(data.patches) && data.patches.length > 0;
    return [hasValue, hasPatch, hasPatches].filter(Boolean).length === 1;
  }, {
    message: "Provide exactly one of 'value', 'patch', or 'patches'",
  });

const DraftThemeArtifactPublicObjectSchema = z
  .object({
    files: z
      .array(ThemeDraftFilePublicSchema)
      .min(1)
      .max(10)
      .optional()
      .describe(
        "Canonieke file batch. Maximale file batch is 10 items conform veiligheidsregels."
      ),
    file: ThemeDraftFilePublicSchema
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
    target_file: z
      .string()
      .min(1)
      .optional()
      .describe("Compat alias van targetFile voor generieke wrappers."),
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
    value_summary: SummaryFieldSchema.describe(
      "Compat placeholderveld voor wrappers die abusievelijk een samenvatting meesturen. Dit vervangt nooit echte file-inhoud."
    ),
    content_summary: SummaryFieldSchema.describe(
      "Compat placeholderveld voor wrappers die abusievelijk een samenvatting meesturen. Dit vervangt nooit echte file-inhoud."
    ),
    liquid_summary: SummaryFieldSchema.describe(
      "Compat placeholderveld voor wrappers die abusievelijk een samenvatting meesturen. Dit vervangt nooit echte file-inhoud."
    ),
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
    theme_id: z
      .string()
      .or(z.number())
      .optional()
      .describe("Compat alias van themeId voor generieke wrappers."),
    themeRole: ThemeRoleSchema
      .optional()
      .describe("Target theme role. Verplicht als themeId niet is opgegeven. Vraag de gebruiker welk thema."),
    theme_role: ThemeRoleSchema
      .optional()
      .describe("Compat alias van themeRole voor generieke wrappers."),
    role: ThemeRoleSchema
      .optional()
      .describe("Compat alias van themeRole voor generieke wrappers."),
    mode: z
      .enum(["create", "edit"])
      .optional()
      .describe(
        "'create' = nieuw sectionbestand met volledige inspectie. 'edit' = bestaand bestand fixen met lichtere checks. Zet mode altijd op het TOP-LEVEL request, nooit in files[]. Als mode ontbreekt en je patch/patches gebruikt, behandelt de pipeline dit automatisch als edit; value-only writes worden dan eerst tegen het doeltheme geprobed om create/edit veilig af te leiden."
      ),
    isStandalone: z.boolean().optional().describe("Mark as standalone workflow"),
    is_standalone: z.boolean().optional().describe("Compat alias van isStandalone voor generieke wrappers."),
    plannerHandoff: PlannerHandoffSchema.optional().describe(
      "Optionele planner-handoff uit plan-theme-edit met volledige brief, reference signals en required reads. Gebruik dit om de write-flow semantisch aan het plannerresultaat te binden."
    ),
    planner_handoff: PlannerHandoffSchema.optional().describe(
      "Compat alias van plannerHandoff voor generieke wrappers."
    ),
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
    plannerHandoff: PlannerHandoffSchema.optional(),
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

const normalizeDraftFileInput = (file) => {
  if (!file || typeof file !== "object" || Array.isArray(file)) {
    return file;
  }

  const normalized = {
    key: file.key,
    ...(file.value !== undefined
      ? { value: file.value }
      : file.content !== undefined
        ? { value: file.content }
        : file.liquid !== undefined
          ? { value: file.liquid }
          : {}),
    ...(file.patch !== undefined ? { patch: file.patch } : {}),
    ...(file.patches !== undefined ? { patches: file.patches } : {}),
    ...(file.baseChecksumMd5 !== undefined
      ? { baseChecksumMd5: file.baseChecksumMd5 }
      : {}),
  };

  return normalized;
};

const hasNormalizedDraftFileWriteMode = (file) =>
  Boolean(
    file &&
      (
        typeof file.value === "string" ||
        file.patch !== undefined ||
        (Array.isArray(file.patches) && file.patches.length > 0)
      )
  );

const normalizeDraftThemeArtifactInput = (rawInput) => {
  if (!rawInput || typeof rawInput !== "object" || Array.isArray(rawInput)) {
    return rawInput;
  }

  const summary = extractThemeToolSummary(rawInput);
  const normalizedFiles = Array.isArray(rawInput.files)
    ? rawInput.files
        .map((file) => normalizeDraftFileInput(file))
        .filter((file) => hasNormalizedDraftFileWriteMode(file))
    : rawInput.files;
  let normalized = {
    files:
      Array.isArray(normalizedFiles) && normalizedFiles.length > 0
        ? normalizedFiles
        : undefined,
    themeId: rawInput.themeId ?? rawInput.theme_id,
    themeRole:
      rawInput.themeRole ?? rawInput.theme_role ?? rawInput.role,
    mode: rawInput.mode,
    isStandalone: rawInput.isStandalone ?? rawInput.is_standalone,
    plannerHandoff: rawInput.plannerHandoff ?? rawInput.planner_handoff,
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
      const normalizedFile = normalizeDraftFileInput(rawInput.file);
      if (hasNormalizedDraftFileWriteMode(normalizedFile)) {
        normalized.files = [normalizedFile];
      }
    }
  }

  if (!normalized.files) {
    const inferredKey =
      rawInput.key ||
      rawInput.targetFile ||
      rawInput.target_file ||
      (summary ? inferSingleThemeFile(summary) : null);
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
  const schemaBlocks = getLiquidBlockContents(value, "schema");
  if (schemaBlocks.length > 1) {
    return {
      schema: null,
      error: "Multiple {% schema %} blocks gevonden. Gebruik exact één schema block per section file.",
    };
  }

  const [schemaJsonRaw] = schemaBlocks;
  const schemaJson = schemaJsonRaw === undefined ? null : String(schemaJsonRaw).trim();
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

const SETTING_TYPES_WITH_CONTENT_ONLY = new Set(["header", "paragraph"]);

function humanizeSchemaFieldLabel(value, fallback = "Setting") {
  const normalized = String(value || "")
    .trim()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
  if (!normalized) {
    return fallback;
  }
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function settingRequiresLabel(setting) {
  const type = String(setting?.type || "").trim();
  if (!type) {
    return false;
  }
  return !SETTING_TYPES_WITH_CONTENT_ONLY.has(type);
}

function buildSchemaPathSegment(setting, index) {
  return String(setting?.id || setting?.type || `index_${index}`);
}

function collectSchemaRequiredFieldIssues(schema, fileKey, { rootOwner = "section" } = {}) {
  const issues = [];

  const pushIssue = ({
    path,
    problem,
    fixSuggestion,
    suggestedReplacement,
  }) => {
    issues.push(
      createInspectionIssue({
        path,
        problem,
        fixSuggestion,
        suggestedReplacement,
        issueCode: "inspection_failed_schema",
      })
    );
  };

  const sectionSettings = Array.isArray(schema?.settings) ? schema.settings : [];
  sectionSettings.forEach((setting, index) => {
    const type = String(setting?.type || "").trim();
    const id = String(setting?.id || "").trim();
    const label = String(setting?.label || "").trim();
    const content = String(setting?.content || "").trim();
    const pathSegment = buildSchemaPathSegment(setting, index);
    const settingLabel = humanizeSchemaFieldLabel(id || type, "Section setting");

    if (!type) {
      pushIssue({
        path: [fileKey, "schema", "settings", pathSegment, "type"],
        problem: `Section schema setting '${pathSegment}' mist verplichte property 'type'.`,
        fixSuggestion:
          "Voeg een geldig Shopify setting type toe, bijvoorbeeld text, image_picker, color of range.",
      });
      return;
    }

    if (settingRequiresLabel(setting)) {
      if (!id) {
        pushIssue({
          path: [fileKey, "schema", "settings", pathSegment, "id"],
          problem: `Section schema setting van type '${type}' mist verplichte property 'id'.`,
          fixSuggestion:
            "Voeg een stabiele setting-id toe, bijvoorbeeld heading, image of background_color.",
        });
      }

      if (!label) {
        pushIssue({
          path: [fileKey, "schema", "settings", pathSegment, "label"],
          problem: `Section schema setting '${id || type}' mist verplichte property 'label'. Shopify Theme Editor en theme-check verwachten hier een label.`,
          fixSuggestion: `Voeg een label toe, bijvoorbeeld '${settingLabel}'.`,
          suggestedReplacement: {
            label: settingLabel,
          },
        });
      }
      return;
    }

    if (!content) {
      pushIssue({
        path: [fileKey, "schema", "settings", pathSegment, "content"],
        problem: `Section schema setting '${id || type}' van type '${type}' mist verplichte property 'content'.`,
        fixSuggestion:
          "Gebruik voor header- of paragraph-settings een content property met de zichtbare editor-tekst.",
      });
    }
  });

  const blocks = Array.isArray(schema?.blocks) ? schema.blocks : [];
  blocks.forEach((block, blockIndex) => {
    const blockType = String(block?.type || "").trim();
    const blockName = String(block?.name || "").trim();
    const blockPathSegment = blockType || `block_${blockIndex}`;
    const blockSettings = Array.isArray(block?.settings) ? block.settings : [];

    if (rootOwner === "section") {
      if (!blockType) {
        pushIssue({
          path: [fileKey, "schema", "blocks", blockPathSegment, "type"],
          problem: `Section block definitie op positie ${blockIndex + 1} mist verplichte property 'type'.`,
          fixSuggestion:
            "Voeg een stabiele block type string toe, bijvoorbeeld testimonial, slide of item.",
        });
      }

      if (!blockName && (!blockType || !blockType.startsWith("@"))) {
        pushIssue({
          path: [fileKey, "schema", "blocks", blockPathSegment, "name"],
          problem: `Section block '${blockType || `block_${blockIndex + 1}`}' mist verplichte property 'name'.`,
          fixSuggestion:
            "Voeg een merchant-zichtbare block name toe, bijvoorbeeld 'Testimonial' of 'Slide'.",
        });
      }
    }

    blockSettings.forEach((setting, settingIndex) => {
      const type = String(setting?.type || "").trim();
      const id = String(setting?.id || "").trim();
      const label = String(setting?.label || "").trim();
      const content = String(setting?.content || "").trim();
      const settingPathSegment = buildSchemaPathSegment(setting, settingIndex);
      const settingLabel = humanizeSchemaFieldLabel(id || type, "Block setting");

      if (!type) {
        pushIssue({
          path: [fileKey, "schema", "blocks", blockPathSegment, "settings", settingPathSegment, "type"],
          problem: `Block setting '${settingPathSegment}' in '${blockType || blockPathSegment}' mist verplichte property 'type'.`,
          fixSuggestion:
            "Voeg een geldig Shopify setting type toe, bijvoorbeeld text, image_picker, color of range.",
        });
        return;
      }

      if (settingRequiresLabel(setting)) {
        if (!id) {
          pushIssue({
            path: [fileKey, "schema", "blocks", blockPathSegment, "settings", settingPathSegment, "id"],
            problem: `Block setting van type '${type}' in '${blockType || blockPathSegment}' mist verplichte property 'id'.`,
            fixSuggestion:
              "Voeg een stabiele block setting-id toe, bijvoorbeeld quote, image of author_name.",
          });
        }

        if (!label) {
          pushIssue({
            path: [fileKey, "schema", "blocks", blockPathSegment, "settings", settingPathSegment, "label"],
            problem: `Block setting '${id || type}' in '${blockType || blockPathSegment}' mist verplichte property 'label'. Shopify Theme Editor en theme-check verwachten hier een label.`,
            fixSuggestion: `Voeg een label toe, bijvoorbeeld '${settingLabel}'.`,
            suggestedReplacement: {
              label: settingLabel,
            },
          });
        }
        return;
      }

      if (!content) {
        pushIssue({
          path: [fileKey, "schema", "blocks", blockPathSegment, "settings", settingPathSegment, "content"],
          problem: `Block setting '${id || type}' van type '${type}' in '${blockType || blockPathSegment}' mist verplichte property 'content'.`,
          fixSuggestion:
            "Gebruik voor header- of paragraph-settings een content property met de zichtbare editor-tekst.",
        });
      }
    });
  });

  return issues;
}

const RANGE_ALIGNMENT_EPSILON = 1e-9;

function isRangeValueAlignedToStep(value, min, step) {
  const stepsFromMin = (value - min) / step;
  return Math.abs(stepsFromMin - Math.round(stepsFromMin)) < RANGE_ALIGNMENT_EPSILON;
}

function normalizeRangeNumericValue(value) {
  if (!Number.isFinite(value)) {
    return value;
  }
  return Number(value.toFixed(6));
}

function getAlignedRangeEndpoints(min, max, step) {
  if (
    !Number.isFinite(min) ||
    !Number.isFinite(max) ||
    !Number.isFinite(step) ||
    step <= 0 ||
    min > max
  ) {
    return { first: null, last: null };
  }

  const maxSteps = Math.floor((max - min) / step);
  return {
    first: normalizeRangeNumericValue(min),
    last: normalizeRangeNumericValue(min + maxSteps * step),
  };
}

function getRangeDefaultRepairHints({ min, max, step, defaultValue }) {
  const { first, last } = getAlignedRangeEndpoints(min, max, step);
  if (first === null || last === null) {
    return {
      suggestedDefault: null,
      validDefaultCandidates: [],
    };
  }

  let rawCandidates = [];
  if (defaultValue <= first) {
    rawCandidates = [first];
  } else if (defaultValue >= last) {
    rawCandidates = [last];
  } else {
    const lowerSteps = Math.floor((defaultValue - min) / step);
    const higherSteps = Math.ceil((defaultValue - min) / step);
    rawCandidates = [min + lowerSteps * step, min + higherSteps * step];
  }

  const validDefaultCandidates = Array.from(
    new Set(
      rawCandidates
        .map((candidate) => normalizeRangeNumericValue(candidate))
        .filter(
          (candidate) =>
            Number.isFinite(candidate) &&
            candidate >= first - RANGE_ALIGNMENT_EPSILON &&
            candidate <= last + RANGE_ALIGNMENT_EPSILON &&
            isRangeValueAlignedToStep(candidate, min, step)
        )
    )
  ).sort((a, b) => a - b);

  const suggestedDefault =
    validDefaultCandidates.length === 0
      ? null
      : validDefaultCandidates.reduce((best, candidate) => {
          if (best === null) {
            return candidate;
          }
          const bestDistance = Math.abs(best - defaultValue);
          const candidateDistance = Math.abs(candidate - defaultValue);
          if (candidateDistance < bestDistance) {
            return candidate;
          }
          if (
            Math.abs(candidateDistance - bestDistance) < RANGE_ALIGNMENT_EPSILON &&
            candidate < best
          ) {
            return candidate;
          }
          return best;
        }, null);

  return {
    suggestedDefault,
    validDefaultCandidates,
  };
}

function formatRangeCandidateList(candidates = []) {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return null;
  }

  if (candidates.length === 1) {
    return String(candidates[0]);
  }

  if (candidates.length === 2) {
    return `${candidates[0]} of ${candidates[1]}`;
  }

  return `${candidates.slice(0, -1).join(", ")} of ${candidates.at(-1)}`;
}

function buildRangeIssueSuggestedFixes(issue) {
  const candidateList = formatRangeCandidateList(issue?.validDefaultCandidates);
  switch (issue?.code) {
    case "range_too_few_steps":
      return [
        `Gebruik voor ${issue.label} liever een select-setting. De huidige range levert maar ${issue.stepCount} discrete waarden op.`,
        `Of verlaag step / vergroot het bereik zodat ${issue.label} minstens 3 keuzes biedt.`,
        "Controleer alle range settings in de section schema voordat je opnieuw schrijft.",
      ];
    case "range_default_not_on_step":
      return [
        `Pas default van ${issue.label} aan zodat deze exact op het step-raster valt vanaf min ${issue.min} met step ${issue.step}${candidateList ? `, bijvoorbeeld ${candidateList}` : ""}.`,
        issue.suggestedDefault !== null
          ? `Een veilige retry is default ${issue.suggestedDefault}.${candidateList && issue.validDefaultCandidates.length > 1 ? ` Andere geldige defaults zijn ${candidateList}.` : ""}`
          : `Of wijzig min/step zodat default ${issue.defaultValue} een geldige stap binnen ${issue.min}-${issue.max} wordt.`,
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
        `Pas default van ${issue.label} aan zodat deze binnen min/max valt${candidateList ? `, bijvoorbeeld ${candidateList}` : ""}.`,
        issue.suggestedDefault !== null
          ? `Een veilige retry is default ${issue.suggestedDefault} binnen het bereik ${issue.min}-${issue.max}.`
          : `Of wijzig min/max zodat default ${issue.defaultValue} geldig wordt binnen het bereik ${issue.min}-${issue.max}.`,
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
    const defaultRepairHints = getRangeDefaultRepairHints({
      min,
      max,
      step,
      defaultValue,
    });

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
        ...defaultRepairHints,
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
        ...defaultRepairHints,
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

function collectSchemaSettingRefs(schema, { rootOwner = "section" } = {}) {
  const refs = [];

  for (const setting of Array.isArray(schema?.settings) ? schema.settings : []) {
    const id = String(setting?.id || "").trim();
    const type = String(setting?.type || "").trim();
    if (!id || !type) {
      continue;
    }
    refs.push({
      owner: rootOwner,
      blockType: rootOwner === "block" ? "__theme_block__" : null,
      id,
      type,
      ref: `${rootOwner}.settings.${id}`,
    });
  }

  for (const block of Array.isArray(schema?.blocks) ? schema.blocks : []) {
    const blockType = String(block?.type || block?.name || "").trim() || null;
    for (const setting of Array.isArray(block?.settings) ? block.settings : []) {
      const id = String(setting?.id || "").trim();
      const type = String(setting?.type || "").trim();
      if (!id || !type) {
        continue;
      }
      refs.push({
        owner: "block",
        blockType,
        id,
        type,
        ref: `block.settings.${id}`,
      });
    }
  }

  return refs;
}

function collectLiquidOutputExpressions(source) {
  return Array.from(
    String(source || "").matchAll(/{{-?\s*([\s\S]*?)\s*-?}}/g),
    (match) => ({
      expression: String(match[1] || ""),
      index: match.index ?? 0,
      raw: String(match[0] || ""),
    })
  );
}

function collectLiquidAttributeExpressions(source) {
  const attributes = [];
  const attributeMatches = String(source || "").matchAll(
    /\b(href|src|poster|action|formaction)\s*=\s*["']([\s\S]*?)["']/gi
  );

  for (const match of attributeMatches) {
    const attrName = String(match[1] || "").toLowerCase();
    const attrValue = String(match[2] || "");
    const baseIndex = match.index ?? 0;
    for (const outputMatch of attrValue.matchAll(/{{-?\s*([\s\S]*?)\s*-?}}/g)) {
      attributes.push({
        attrName,
        expression: String(outputMatch[1] || ""),
        index: baseIndex + (outputMatch.index ?? 0),
        raw: String(outputMatch[0] || ""),
      });
    }
  }

  return attributes;
}

function normalizeInlineWhitespace(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function hasInlineDefaultFallback(expression) {
  return /\|\s*default\s*:/.test(String(expression || ""));
}

function expandAliasesInLiquidExpression(expression, aliasMap = new Map()) {
  let expanded = String(expression || "");
  const aliasEntries = Array.from(aliasMap.entries()).sort(
    (left, right) => right[0].length - left[0].length
  );

  for (const [alias, target] of aliasEntries) {
    expanded = expanded.replace(
      new RegExp(`\\b${escapeRegExp(alias)}\\b`, "g"),
      target
    );
  }

  return expanded;
}

function resolveSimpleLiquidReference(expression, aliasMap = new Map()) {
  const expanded = expandAliasesInLiquidExpression(
    String(expression || "").trim(),
    aliasMap
  );
  return /^[A-Za-z_][\w-]*(?:\.[A-Za-z_][\w-]*)*$/.test(expanded)
    ? expanded
    : null;
}

function collectConditionGuardRefs(condition, refs, mode) {
  const normalizedCondition = normalizeInlineWhitespace(condition);
  const normalizedRefs = Array.isArray(refs)
    ? Array.from(new Set(refs.map((ref) => String(ref || "").trim()).filter(Boolean)))
    : [];

  if (normalizedRefs.length === 0 || /\bor\b/i.test(normalizedCondition)) {
    return new Set();
  }

  const guardedRefs = new Set();
  for (const ref of normalizedRefs) {
    const escapedRef = escapeRegExp(ref);
    const explicitPresentPattern = new RegExp(
      `\\b${escapedRef}\\s*!=\\s*(?:blank|nil)\\b`,
      "i"
    );
    const explicitBlankPattern = new RegExp(
      `\\b${escapedRef}\\s*==\\s*(?:blank|nil)\\b`,
      "i"
    );
    const barePresencePattern = new RegExp(
      `(^|[^\\w.-])${escapedRef}(?!\\s*(?:==|!=|contains|>|<))(?:\\s|$|\\)|\\])`,
      "i"
    );
    const isMatch =
      mode === "present"
        ? explicitPresentPattern.test(normalizedCondition) ||
          barePresencePattern.test(normalizedCondition)
        : explicitBlankPattern.test(normalizedCondition);
    if (isMatch) {
      guardedRefs.add(ref);
    }
  }

  return guardedRefs;
}

function classifyConditionalBranchSafety(tagName, condition, refs) {
  const presentGuardRefs = collectConditionGuardRefs(condition, refs, "present");
  const blankGuardRefs = collectConditionGuardRefs(condition, refs, "blank");

  if (tagName === "unless") {
    return {
      mainSafeRefs: blankGuardRefs,
      elseSafeRefs: presentGuardRefs,
    };
  }

  return {
    mainSafeRefs: presentGuardRefs,
    elseSafeRefs: blankGuardRefs,
  };
}

function collectRelevantLiquidTags(source) {
  return Array.from(
    String(source || "").matchAll(
      /{%-?\s*(assign|if|unless|elsif|else|endif|endunless)\b([\s\S]*?)\s*-?%}/gi
    ),
    (match) => ({
      name: String(match[1] || "").toLowerCase(),
      body: String(match[2] || ""),
      index: match.index ?? 0,
    })
  );
}

function collectActiveConditionalGuardRefs(conditionalStack) {
  const activeRefs = new Set();
  for (const entry of conditionalStack) {
    for (const ref of entry.currentSafeRefs || []) {
      activeRefs.add(ref);
    }
  }
  return activeRefs;
}

function applyLiquidTagToState(tag, aliasMap, conditionalStack, refs) {
  switch (tag.name) {
    case "assign": {
      const assignMatch = String(tag.body || "")
        .trim()
        .match(/^([A-Za-z_][\w-]*)\s*=\s*([\s\S]+)$/);
      if (!assignMatch) {
        return;
      }
      const [, aliasName, aliasExpression] = assignMatch;
      const resolvedReference = resolveSimpleLiquidReference(aliasExpression, aliasMap);
      if (resolvedReference) {
        aliasMap.set(aliasName, resolvedReference);
      } else {
        aliasMap.delete(aliasName);
      }
      return;
    }
    case "if":
    case "unless": {
      const expandedCondition = expandAliasesInLiquidExpression(tag.body, aliasMap);
      const branchSafety = classifyConditionalBranchSafety(
        tag.name,
        expandedCondition,
        refs
      );
      conditionalStack.push({
        currentSafeRefs: new Set(branchSafety.mainSafeRefs),
        elseSafeRefs: new Set(branchSafety.elseSafeRefs),
      });
      return;
    }
    case "elsif": {
      if (conditionalStack.length === 0) {
        return;
      }
      const expandedCondition = expandAliasesInLiquidExpression(tag.body, aliasMap);
      const branchSafety = classifyConditionalBranchSafety(
        "if",
        expandedCondition,
        refs
      );
      const current = conditionalStack[conditionalStack.length - 1];
      current.currentSafeRefs = new Set(branchSafety.mainSafeRefs);
      current.elseSafeRefs = new Set();
      return;
    }
    case "else": {
      if (conditionalStack.length === 0) {
        return;
      }
      const current = conditionalStack[conditionalStack.length - 1];
      current.currentSafeRefs = new Set(current.elseSafeRefs || []);
      current.elseSafeRefs = new Set();
      return;
    }
    case "endif":
    case "endunless":
      if (conditionalStack.length > 0) {
        conditionalStack.pop();
      }
      return;
    default:
      return;
  }
}

function buildLiquidOccurrenceContexts(source, occurrences, refs) {
  const contexts = new Map();
  const normalizedRefs = Array.isArray(refs)
    ? Array.from(new Set(refs.map((ref) => String(ref || "").trim()).filter(Boolean)))
    : [];
  const relevantOccurrences = Array.isArray(occurrences)
    ? [...occurrences].sort((left, right) => (left.index ?? 0) - (right.index ?? 0))
    : [];
  const tags = collectRelevantLiquidTags(source);
  const aliasMap = new Map();
  const conditionalStack = [];
  let tagIndex = 0;

  for (const occurrence of relevantOccurrences) {
    const occurrenceIndex = Number(occurrence?.index || 0);
    while (tagIndex < tags.length && (tags[tagIndex].index ?? 0) < occurrenceIndex) {
      applyLiquidTagToState(tags[tagIndex], aliasMap, conditionalStack, normalizedRefs);
      tagIndex += 1;
    }

    const aliasSnapshot = new Map(aliasMap);
    contexts.set(occurrence, {
      expandedExpression: expandAliasesInLiquidExpression(
        occurrence.expression,
        aliasSnapshot
      ),
      activeGuardRefs: collectActiveConditionalGuardRefs(conditionalStack),
    });
  }

  return contexts;
}

function expressionContainsLiquidRef(expression, ref) {
  if (!expression || !ref) {
    return false;
  }
  return new RegExp(
    `(^|[^\\w.-])${escapeRegExp(ref)}(?![\\w.-])`
  ).test(String(expression));
}

function buildOptionalResourceDetectionKey(
  candidate,
  occurrence,
  source,
  expandedExpression
) {
  const occurrenceIndex = Number(occurrence?.index || 0);
  const rawLength = String(occurrence?.raw || occurrence?.expression || "").length;
  const contextStart = Math.max(0, occurrenceIndex - 80);
  const contextEnd = Math.min(
    String(source || "").length,
    occurrenceIndex + rawLength + 80
  );
  const contextExcerpt = normalizeInlineWhitespace(
    String(source || "").slice(contextStart, contextEnd)
  );
  return [
    candidate.riskKind,
    candidate.ref,
    occurrence?.attrName || "",
    normalizeInlineWhitespace(expandedExpression || occurrence?.expression || ""),
    contextExcerpt,
  ].join("|");
}

function filterNewOptionalResourceDetections(
  currentDetections = [],
  baselineDetections = []
) {
  const baselineCounts = new Map();
  for (const detection of baselineDetections || []) {
    const key = String(detection?.key || "");
    if (!key) {
      continue;
    }
    baselineCounts.set(key, (baselineCounts.get(key) || 0) + 1);
  }

  const newDetections = [];
  for (const detection of currentDetections || []) {
    const key = String(detection?.key || "");
    const remaining = baselineCounts.get(key) || 0;
    if (remaining > 0) {
      baselineCounts.set(key, remaining - 1);
      continue;
    }
    newDetections.push(detection);
  }

  return newDetections;
}

function filterOptionalResourceInspectionAgainstBaseline(
  currentInspection,
  baselineInspection
) {
  if (!baselineInspection) {
    return currentInspection;
  }

  const issueDetections = filterNewOptionalResourceDetections(
    currentInspection?.issueDetections || [],
    baselineInspection?.issueDetections || []
  );
  const warningDetections = filterNewOptionalResourceDetections(
    currentInspection?.warningDetections || [],
    baselineInspection?.warningDetections || []
  );

  return {
    issues: issueDetections.map((detection) => detection.diagnostic).filter(Boolean),
    warnings: warningDetections.map((detection) => detection.message).filter(Boolean),
    suggestedFixes:
      issueDetections.length > 0 || warningDetections.length > 0
        ? currentInspection?.suggestedFixes || []
        : [],
    unsafeRefs: Array.from(
      new Map(
        issueDetections
          .map((detection) => detection.candidate)
          .filter(Boolean)
          .map((candidate) => [
            `${candidate.riskKind}:${candidate.ref}:${candidate.settingId}`,
            candidate,
          ])
      ).values()
    ),
    issueDetections,
    warningDetections,
  };
}

function collectIncrementalOptionalResourceRuntimeSafety(
  value,
  fileKey,
  schema,
  {
    rootOwner = "section",
    originalValue = null,
  } = {}
) {
  const currentInspection = collectOptionalResourceRuntimeSafety(value, fileKey, schema, {
    rootOwner,
  });

  if (
    typeof originalValue !== "string" ||
    originalValue.length === 0 ||
    !hasLiquidBlockTag(originalValue, "schema")
  ) {
    return currentInspection;
  }

  const { schema: originalSchema } = parseSectionSchema(originalValue);
  if (!originalSchema) {
    return currentInspection;
  }

  const baselineInspection = collectOptionalResourceRuntimeSafety(
    originalValue,
    fileKey,
    originalSchema,
    { rootOwner }
  );

  return filterOptionalResourceInspectionAgainstBaseline(
    currentInspection,
    baselineInspection
  );
}

function buildOptionalResourceCandidates(entry) {
  const base = {
    settingId: entry.id,
    owner: entry.owner,
    blockType: entry.blockType || null,
    settingType: entry.type,
  };
  const ref = entry.ref;

  switch (entry.type) {
    case "image_picker":
      return [
        {
          ...base,
          ref,
          guardRefs: [ref],
          riskKind: "image_filter",
        },
      ];
    case "video":
      return [
        {
          ...base,
          ref,
          guardRefs: [ref],
          riskKind: "video_filter",
        },
      ];
    case "video_url":
      return [
        {
          ...base,
          ref,
          guardRefs: [ref],
          riskKind: "external_video_filter",
        },
        {
          ...base,
          ref,
          guardRefs: [ref],
          riskKind: "url_attribute",
        },
      ];
    case "url":
      return [
        {
          ...base,
          ref,
          guardRefs: [ref],
          riskKind: "url_attribute",
        },
      ];
    case "collection":
      return [
        {
          ...base,
          ref,
          guardRefs: [ref],
          riskKind: "image_filter",
        },
        {
          ...base,
          ref: `${ref}.image`,
          guardRefs: [ref, `${ref}.image`],
          riskKind: "image_filter",
        },
        {
          ...base,
          ref: `${ref}.url`,
          guardRefs: [ref, `${ref}.url`],
          riskKind: "url_attribute",
        },
      ];
    case "product":
      return [
        {
          ...base,
          ref,
          guardRefs: [ref],
          riskKind: "image_filter",
        },
        {
          ...base,
          ref: `${ref}.featured_image`,
          guardRefs: [ref, `${ref}.featured_image`],
          riskKind: "image_filter",
        },
        {
          ...base,
          ref: `${ref}.featured_media`,
          guardRefs: [ref, `${ref}.featured_media`],
          riskKind: "image_filter",
        },
        {
          ...base,
          ref: `${ref}.featured_media.preview_image`,
          guardRefs: [ref, `${ref}.featured_media`, `${ref}.featured_media.preview_image`],
          riskKind: "image_filter",
        },
        {
          ...base,
          ref: `${ref}.url`,
          guardRefs: [ref, `${ref}.url`],
          riskKind: "url_attribute",
        },
      ];
    case "article":
      return [
        {
          ...base,
          ref,
          guardRefs: [ref],
          riskKind: "image_filter",
        },
        {
          ...base,
          ref: `${ref}.image`,
          guardRefs: [ref, `${ref}.image`],
          riskKind: "image_filter",
        },
        {
          ...base,
          ref: `${ref}.url`,
          guardRefs: [ref, `${ref}.url`],
          riskKind: "url_attribute",
        },
      ];
    case "blog":
    case "page":
      return [
        {
          ...base,
          ref: `${ref}.url`,
          guardRefs: [ref, `${ref}.url`],
          riskKind: "url_attribute",
        },
      ];
    default:
      return [];
  }
}

function collectOptionalResourceRuntimeSafety(
  value,
  fileKey,
  schema,
  { rootOwner = "section" } = {}
) {
  const source = String(value || "");
  const issues = [];
  const warnings = [];
  const suggestedFixes = [];
  const unsafeRefs = [];
  const issueDetections = [];
  const warningDetections = [];
  const outputExpressions = collectLiquidOutputExpressions(source);
  const attributeExpressions = collectLiquidAttributeExpressions(source);
  const seenIssueKeys = new Set();
  const seenWarningKeys = new Set();

  const candidates = collectSchemaSettingRefs(schema, { rootOwner }).flatMap(
    (entry) => buildOptionalResourceCandidates(entry)
  );
  const guardRefs = Array.from(
    new Set(
      candidates
        .flatMap((candidate) => candidate.guardRefs || [])
        .map((ref) => String(ref || "").trim())
        .filter(Boolean)
    )
  );
  const occurrenceContexts = buildLiquidOccurrenceContexts(
    source,
    [...outputExpressions, ...attributeExpressions],
    guardRefs
  );

  const maybeAddIssue = (
    candidate,
    occurrence,
    expandedExpression,
    problem,
    fixSuggestion
  ) => {
    const dedupeKey = buildOptionalResourceDetectionKey(
      candidate,
      occurrence,
      source,
      expandedExpression
    );
    if (seenIssueKeys.has(dedupeKey)) {
      return;
    }
    seenIssueKeys.add(dedupeKey);
    const diagnostic = createInspectionIssue({
      path: [fileKey],
      problem,
      fixSuggestion,
      issueCode: "inspection_failed_unguarded_optional_resource",
    });
    issues.push(diagnostic);
    issueDetections.push({
      key: dedupeKey,
      candidate,
      occurrence,
      expandedExpression,
      diagnostic,
    });
    unsafeRefs.push(candidate);
  };

  const maybeAddWarning = (candidate, occurrence, expandedExpression, message) => {
    const dedupeKey = buildOptionalResourceDetectionKey(
      candidate,
      occurrence,
      source,
      expandedExpression
    );
    if (seenWarningKeys.has(dedupeKey)) {
      return;
    }
    seenWarningKeys.add(dedupeKey);
    warnings.push(message);
    warningDetections.push({
      key: dedupeKey,
      candidate,
      occurrence,
      expandedExpression,
      message,
    });
  };

  for (const candidate of candidates) {
    if (candidate.riskKind === "image_filter") {
      for (const occurrence of outputExpressions) {
        const occurrenceContext =
          occurrenceContexts.get(occurrence) || {};
        const expandedExpression =
          occurrenceContext.expandedExpression || occurrence.expression;
        const activeGuardRefs = occurrenceContext.activeGuardRefs || new Set();
        if (
          !expressionContainsLiquidRef(expandedExpression, candidate.ref) ||
          !/\|\s*image_url\b/i.test(expandedExpression) ||
          hasInlineDefaultFallback(expandedExpression) ||
          candidate.guardRefs.some((ref) => activeGuardRefs.has(ref))
        ) {
          continue;
        }

        maybeAddIssue(
          candidate,
          occurrence,
          expandedExpression,
          `${candidate.ref} wordt direct door image_url gehaald zonder blank guard of inline fallback. Shopify kan dan een runtime error geven zodra de merchant deze setting leeg laat.`,
          `Wrap ${candidate.guardRefs[0]} in {% if ${candidate.guardRefs[0]} != blank %} ... {% else %} veilige fallback markup {% endif %}, of gebruik eerst assign/capture met een default image voordat je image_url aanroept.`
        );
      }

      continue;
    }

    if (candidate.riskKind === "video_filter") {
      for (const occurrence of outputExpressions) {
        const occurrenceContext =
          occurrenceContexts.get(occurrence) || {};
        const expandedExpression =
          occurrenceContext.expandedExpression || occurrence.expression;
        const activeGuardRefs = occurrenceContext.activeGuardRefs || new Set();
        if (
          !expressionContainsLiquidRef(expandedExpression, candidate.ref) ||
          !/\|\s*video_tag\b/i.test(expandedExpression) ||
          hasInlineDefaultFallback(expandedExpression) ||
          candidate.guardRefs.some((ref) => activeGuardRefs.has(ref))
        ) {
          continue;
        }

        maybeAddIssue(
          candidate,
          occurrence,
          expandedExpression,
          `${candidate.ref} wordt direct door video_tag gehaald zonder blank guard of inline fallback. Shopify kan dan breken zodra de merchant nog geen video heeft ingevuld.`,
          `Guard ${candidate.guardRefs[0]} eerst op != blank en render anders een veilige fallback.`
        );
      }

      continue;
    }

    if (candidate.riskKind === "external_video_filter") {
      for (const occurrence of outputExpressions) {
        const occurrenceContext =
          occurrenceContexts.get(occurrence) || {};
        const expandedExpression =
          occurrenceContext.expandedExpression || occurrence.expression;
        const activeGuardRefs = occurrenceContext.activeGuardRefs || new Set();
        if (
          !expressionContainsLiquidRef(expandedExpression, candidate.ref) ||
          !/\|\s*(?:external_video_url|external_video_tag)\b/i.test(
            expandedExpression
          ) ||
          hasInlineDefaultFallback(expandedExpression) ||
          candidate.guardRefs.some((ref) => activeGuardRefs.has(ref))
        ) {
          continue;
        }

        maybeAddIssue(
          candidate,
          occurrence,
          expandedExpression,
          `${candidate.ref} wordt direct gebruikt voor een externe video-render zonder blank guard of inline fallback. Dat maakt de section fragiel zodra de video_url leeg is.`,
          `Guard ${candidate.guardRefs[0]} eerst op != blank en render anders geen iframe/video-output of een veilige placeholder-state.`
        );
      }

      continue;
    }

    if (candidate.riskKind === "url_attribute") {
      for (const occurrence of attributeExpressions) {
        const occurrenceContext =
          occurrenceContexts.get(occurrence) || {};
        const expandedExpression =
          occurrenceContext.expandedExpression || occurrence.expression;
        const activeGuardRefs = occurrenceContext.activeGuardRefs || new Set();
        if (
          !expressionContainsLiquidRef(expandedExpression, candidate.ref) ||
          hasInlineDefaultFallback(expandedExpression) ||
          candidate.guardRefs.some((ref) => activeGuardRefs.has(ref))
        ) {
          continue;
        }

        maybeAddWarning(
          candidate,
          occurrence,
          expandedExpression,
          `${candidate.ref} wordt direct gebruikt in ${occurrence.attrName} zonder blank guard of inline fallback. Voeg bij voorkeur een if-guard of default toe zodat lege merchant-settings geen fragiele links of embeds opleveren.`
        );
      }
    }
  }

  if (unsafeRefs.length > 0) {
    suggestedFixes.push(
      "Gebruik voor optionele Shopify resource-settings altijd een blank-safe renderpad: eerst if/unless of assign met default, daarna pas image_url, video_tag of external_video_url.",
      "Laat section- en block-markup foutloos renderen wanneer merchants net een nieuwe preset toevoegen en nog geen media hebben ingevuld."
    );
  }
  if (warnings.length > 0) {
    suggestedFixes.push(
      "Guard optionele href/src/action/formaction waarden met if != blank of gebruik een veilige default, zodat lege settings geen fragiele URL-attributen opleveren."
    );
  }

  return {
    issues,
    warnings,
    suggestedFixes,
    unsafeRefs,
    issueDetections,
    warningDetections,
  };
}

function collectSnippetOptionalResourceRuntimeSafety(
  value,
  fileKey,
  relatedSchema,
  {
    rootOwner = "section",
    originalValue = null,
  } = {}
) {
  if (!relatedSchema) {
    return buildInspectionResult({});
  }

  const currentInspection = collectOptionalResourceRuntimeSafety(
    value,
    fileKey,
    relatedSchema,
    { rootOwner }
  );

  if (typeof originalValue !== "string" || originalValue.length === 0) {
    return currentInspection;
  }

  const baselineInspection = collectOptionalResourceRuntimeSafety(
    originalValue,
    fileKey,
    relatedSchema,
    { rootOwner }
  );

  return filterOptionalResourceInspectionAgainstBaseline(
    currentInspection,
    baselineInspection
  );
}

function collectLiquidSettingReferences(source) {
  return uniqueStrings(
    Array.from(
      String(source || "").matchAll(/\b(section|block)\.settings\.([A-Za-z_][\w-]*)\b/g),
      (match) => `${String(match[1] || "").trim()}.settings.${String(match[2] || "").trim()}`
    ).filter(Boolean)
  );
}

function collectBlockTypeReferences(source) {
  const references = [];
  const normalizedSource = String(source || "");

  if (/case\s+block\.type/i.test(normalizedSource)) {
    references.push(
      ...Array.from(
        normalizedSource.matchAll(/{%-?\s*when\s+['"]([^'"]+)['"]/gi),
        (match) => String(match[1] || "").trim()
      )
    );
  }

  references.push(
    ...Array.from(
      normalizedSource.matchAll(/\bblock\.type\s*(?:==|!=|contains)\s*['"]([^'"]+)['"]/gi),
      (match) => String(match[1] || "").trim()
    )
  );

  return uniqueStrings(references.filter(Boolean));
}

function filterNewReferenceValues(currentValues, baselineValues = []) {
  const baseline = new Set(
    (Array.isArray(baselineValues) ? baselineValues : [])
      .map((value) => String(value || "").trim())
      .filter(Boolean)
  );

  return uniqueStrings(
    (Array.isArray(currentValues) ? currentValues : []).filter((value) => {
      const normalized = String(value || "").trim();
      return normalized && !baseline.has(normalized);
    })
  );
}

function collectRelatedSchemaReferenceIntegrity(
  value,
  fileKey,
  relatedSchema,
  {
    relatedSchemaKey = null,
    rootOwner = "section",
    originalValue = null,
  } = {}
) {
  if (!relatedSchema) {
    return buildInspectionResult({});
  }

  const issues = [];
  const suggestedFixes = [];
  const schemaRefs = collectSchemaSettingRefs(relatedSchema, { rootOwner });
  const knownSettingRefs = new Set(schemaRefs.map((entry) => entry.ref));
  const baselineUnknownSettingRefs = collectLiquidSettingReferences(originalValue).filter(
    (ref) => !knownSettingRefs.has(ref)
  );
  const currentUnknownSettingRefs = collectLiquidSettingReferences(value).filter(
    (ref) => !knownSettingRefs.has(ref)
  );
  const newUnknownSettingRefs = filterNewReferenceValues(
    currentUnknownSettingRefs,
    baselineUnknownSettingRefs
  );

  for (const ref of newUnknownSettingRefs) {
    issues.push(
      createInspectionIssue({
        path: [fileKey],
        problem:
          `${ref} wordt in '${fileKey}' gebruikt, maar staat niet in het gerelateerde schema van '${relatedSchemaKey || "de parent section"}'. Daardoor blijft de native-block write onvolledig of onwaar.`,
        fixSuggestion:
          "Werk ook het gerelateerde section/block schema bij zodat deze setting echt bestaat, of verwijder de ongeldige ref uit de snippet.",
        issueCode: "inspection_failed_unknown_setting_ref",
        suggestedReplacement: {
          missingSettingRef: ref,
          relatedSchemaKey,
        },
      })
    );
  }

  const knownBlockTypes = new Set(
    (Array.isArray(relatedSchema?.blocks) ? relatedSchema.blocks : [])
      .map((block) => String(block?.type || "").trim())
      .filter(Boolean)
  );
  const baselineUnknownBlockTypes = collectBlockTypeReferences(originalValue).filter(
    (type) => !knownBlockTypes.has(type)
  );
  const currentUnknownBlockTypes = collectBlockTypeReferences(value).filter(
    (type) => !knownBlockTypes.has(type)
  );
  const newUnknownBlockTypes = filterNewReferenceValues(
    currentUnknownBlockTypes,
    baselineUnknownBlockTypes
  );

  for (const blockType of newUnknownBlockTypes) {
    issues.push(
      createInspectionIssue({
        path: [fileKey],
        problem:
          `Block type '${blockType}' wordt in '${fileKey}' gerenderd, maar bestaat niet in het gerelateerde schema van '${relatedSchemaKey || "de parent section"}'. Daardoor kan deze native block-flow niet volledig werken.`,
        fixSuggestion:
          "Voeg het block type toe aan het gerelateerde section schema, of verwijder de renderer-case totdat de schema-write meekomt.",
        issueCode: "inspection_failed_unknown_block_type",
        suggestedReplacement: {
          missingBlockType: blockType,
          relatedSchemaKey,
        },
      })
    );
  }

  if (issues.length > 0) {
    suggestedFixes.push(
      "Houd snippet-renderers, block types en schema settings altijd in sync binnen dezelfde native-block flow.",
      "Werk bij nieuwe block.types of block.settings ook het parent section-schema of theme block-schema bij."
    );
  }

  return buildInspectionResult({
    issues,
    suggestedFixes,
  });
}

function collectSnippetRendererContractSafety(
  value,
  fileKey,
  { treatAsNativeBlockRenderer = false } = {}
) {
  const source = String(value || "");
  const issues = [];
  const warnings = [];
  const suggestedFixes = [];
  const rendersSectionBlocks = /for\s+block\s+in\s+section\.blocks/i.test(source);
  const rendersStaticThemeBlock = /content_for\s+['"]block['"]/i.test(source);
  const usesBlockContext =
    rendersSectionBlocks ||
    /\bblock\.settings\b|\bblock\.type\b|content_for\s+['"]block['"]/i.test(source);

  if (!treatAsNativeBlockRenderer && !usesBlockContext) {
    return buildInspectionResult({});
  }

  if (
    (treatAsNativeBlockRenderer || rendersSectionBlocks || rendersStaticThemeBlock) &&
    !/block\.shopify_attributes/.test(source) &&
    !/{%\s*render\s+block\s*%}/i.test(source)
  ) {
    issues.push(
      createInspectionIssue({
        path: [fileKey],
        problem:
          `Building Inspection Failed: native block renderer snippet '${fileKey}' mist block.shopify_attributes. Daardoor breken Theme Editor drag-and-drop en block-selectie sneller.`,
        fixSuggestion:
          "Zet {{ block.shopify_attributes }} op de top-level block wrapper wanneer een snippet block-markup rendert.",
        issueCode: "inspection_failed_block_shopify_attributes",
      })
    );
    suggestedFixes.push(
      "Zet {{ block.shopify_attributes }} op de top-level block wrapper wanneer een snippet block-markup rendert."
    );
  }

  if (usesBlockContext && !hasLiquidBlockTag(source, "doc")) {
    warnings.push(
      `Native block renderer snippet '${fileKey}' mist een {% doc %} block. Shopify LiquidDoc helpt hier parameters, tooling en renderer-contracten eerlijker te houden.`
    );
    suggestedFixes.push(
      "Voeg een compact {% doc %} block toe met de verwachte snippet-parameters of block-context."
    );
  }

  return buildInspectionResult({
    issues,
    warnings,
    suggestedFixes,
  });
}

function extractSchemaFromCandidateValue(value) {
  if (typeof value !== "string" || value.length === 0 || !hasLiquidBlockTag(value, "schema")) {
    return null;
  }

  const parsed = parseSectionSchema(value);
  if (!parsed?.schema) {
    return null;
  }

  return parsed.schema;
}

function resolveSnippetRelatedSchema({
  file,
  files = [],
  context,
  themeId,
  themeRole,
  plannerArchitecture = null,
  plannedReadKeys = [],
  plannedWriteKeys = [],
} = {}) {
  const candidateKeys = uniqueStrings([
    plannerArchitecture?.primarySectionFile,
    ...(Array.isArray(plannedWriteKeys) ? plannedWriteKeys : []).filter((key) =>
      /^sections\/.+\.liquid$/i.test(String(key || ""))
    ),
    ...(Array.isArray(plannedReadKeys) ? plannedReadKeys : []).filter((key) =>
      /^sections\/.+\.liquid$/i.test(String(key || ""))
    ),
    ...(Array.isArray(files) ? files : []).map((entry) => entry?.key).filter((key) =>
      /^sections\/.+\.liquid$/i.test(String(key || ""))
    ),
  ]);

  for (const candidateKey of candidateKeys) {
    if (!candidateKey || candidateKey === file?.key) {
      continue;
    }

    const batchFile = (Array.isArray(files) ? files : []).find(
      (entry) => entry?.key === candidateKey
    );
    const batchSchema =
      extractSchemaFromCandidateValue(batchFile?.value) ||
      extractSchemaFromCandidateValue(batchFile?.originalValue);
    if (batchSchema) {
      return {
        schema: batchSchema,
        key: candidateKey,
        rootOwner: "section",
      };
    }

    const recentRead = getRecentThemeRead(context, {
      key: candidateKey,
      themeId,
      themeRole,
      requireContent: true,
    });
    const readSchema = extractSchemaFromCandidateValue(recentRead?.content);
    if (readSchema) {
      return {
        schema: readSchema,
        key: candidateKey,
        rootOwner: "section",
      };
    }
  }

  return {
    schema: null,
    key: null,
    rootOwner: "section",
  };
}

function collectPresetRenderabilityIssues(fileKey, schema, unsafeRefs = []) {
  const issues = [];
  const suggestedFixes = [];
  const presets = Array.isArray(schema?.presets) ? schema.presets : [];
  const blockUnsafeRefs = (Array.isArray(unsafeRefs) ? unsafeRefs : []).filter(
    (entry) => entry.owner === "block" && entry.blockType && entry.settingId
  );

  const seen = new Set();
  for (const preset of presets) {
    const presetName = String(preset?.name || "Preset").trim();
    for (const presetBlock of Array.isArray(preset?.blocks) ? preset.blocks : []) {
      const blockType = String(presetBlock?.type || "").trim();
      if (!blockType) {
        continue;
      }

      for (const unsafeRef of blockUnsafeRefs) {
        if (unsafeRef.blockType !== blockType) {
          continue;
        }
        const presetBlockSettings =
          presetBlock?.settings && typeof presetBlock.settings === "object"
            ? presetBlock.settings
            : {};
        if (presetBlockSettings[unsafeRef.settingId]) {
          continue;
        }

        const dedupeKey = `${presetName}:${blockType}:${unsafeRef.settingId}`;
        if (seen.has(dedupeKey)) {
          continue;
        }
        seen.add(dedupeKey);

        issues.push(
          createInspectionIssue({
            path: [fileKey, "schema", "presets"],
            problem: `Preset '${presetName}' voegt een block van type '${blockType}' toe zonder renderbare '${unsafeRef.settingId}' waarde, terwijl de markup die setting onveilig als verplichte resource behandelt.`,
            fixSuggestion:
              "Maak de block-rendering blank-safe of geef de preset een echte renderbare fallback-route voordat de block resource-filters gebruikt.",
            issueCode: "inspection_failed_unrenderable_preset",
          })
        );
      }
    }
  }

  if (issues.length > 0) {
    suggestedFixes.push(
      "Presets moeten ook foutloos renderen wanneer blocks nog geen merchant-media hebben. Voeg dus altijd een veilige fallback of guard toe rond block.settings resource-usage."
    );
  }

  return {
    issues,
    warnings: [],
    suggestedFixes,
  };
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

  if (
    (issue.code === "range_default_not_on_step" ||
      issue.code === "range_default_out_of_bounds") &&
    (issue.suggestedDefault !== null ||
      (Array.isArray(issue.validDefaultCandidates) &&
        issue.validDefaultCandidates.length > 0))
  ) {
    return {
      ...base,
      suggestedReplacement: {
        ...(issue.suggestedDefault !== null
          ? { default: issue.suggestedDefault }
          : {}),
        ...(Array.isArray(issue.validDefaultCandidates) &&
        issue.validDefaultCandidates.length > 0
          ? { validDefaultCandidates: issue.validDefaultCandidates }
          : {}),
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

  if (
    (issue.code === "range_default_not_on_step" ||
      issue.code === "range_default_out_of_bounds") &&
    issue.suggestedDefault !== null
  ) {
    return [
      {
        path: issue.path || [],
        currentType: "range",
        suggestedDefault: issue.suggestedDefault,
        ...(Array.isArray(issue.validDefaultCandidates) &&
        issue.validDefaultCandidates.length > 0
          ? { validDefaultCandidates: issue.validDefaultCandidates }
          : {}),
        reason: `${issue.label} heeft een default die niet geldig is voor de huidige min/max/step configuratie.`,
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

function buildAlternateThemeFileSuggestions(key) {
  const normalized = String(key || "").trim();
  if (!normalized || !normalized.includes("/")) {
    return [];
  }
  const lastSlashIndex = normalized.lastIndexOf("/");
  const directory = normalized.slice(0, lastSlashIndex + 1);
  const filename = normalized.slice(lastSlashIndex + 1);
  const dotIndex = filename.lastIndexOf(".");
  const basename = dotIndex >= 0 ? filename.slice(0, dotIndex) : filename;
  const extension = dotIndex >= 0 ? filename.slice(dotIndex) : "";
  return Array.from(
    new Set(
      [`${directory}${basename}-v2${extension}`, `${directory}${basename}-alt${extension}`].filter(
        (candidate) => candidate !== normalized
      )
    )
  );
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
  return Array.from(String(value || "").matchAll(/<img\b([^>]*)>/gi), (match) => ({
    tag: String(match[0] || ""),
    attributes: String(match[1] || ""),
  }));
}

function hasRawImgWithoutDimensions(value) {
  return collectRawImgTags(value).some(
    ({ attributes }) =>
      !/\bwidth\s*=\s*["'][^"']+["']/i.test(attributes) ||
      !/\bheight\s*=\s*["'][^"']+["']/i.test(attributes)
  );
}

function hasShopifyResourceBackedRawImg(value) {
  return collectRawImgTags(value).some(({ tag }) =>
    /\b(?:src|srcset)\s*=\s*["'][^"']*{{[\s\S]*?\|\s*(?:image_url|img_url)\b[\s\S]*?}}[^"']*["']/i.test(
      tag
    )
  );
}

function collectRawImgSafetyIssues(
  value,
  fileKey,
  {
    surfaceLabel = "Shopify sections",
    extraSuggestedFixes = [],
  } = {}
) {
  const issues = [];
  const suggestedFixes = [];

  if (hasRawImgWithoutDimensions(value)) {
    issues.push(
      createInspectionIssue({
        path: [fileKey],
        problem:
          `Building Inspection Failed: raw <img> tags zonder width en height veroorzaken instabiele ${surfaceLabel}. Gebruik image_url + image_tag of geef expliciete afmetingen mee.`,
        fixSuggestion:
          "Vervang raw <img> door Shopify image_url + image_tag zodat width/height automatisch goed mee kunnen komen.",
        issueCode: "inspection_failed_media",
      })
    );
    suggestedFixes.push(
      "Vervang raw <img> door Shopify image_url + image_tag zodat width/height automatisch goed mee kunnen komen."
    );
  }

  if (hasShopifyResourceBackedRawImg(value)) {
    issues.push(
      createInspectionIssue({
        path: [fileKey],
        problem:
          `Building Inspection Failed: raw <img> tags die een Shopify image_url/img_url renderen horen image_tag te gebruiken in ${surfaceLabel}. Anders verlies je Shopify-dimensies, srcset-gedrag en theme-correcte image rendering.`,
        fixSuggestion:
          "Gebruik het Liquid-patroon image_url | image_tag in plaats van een raw <img> met Shopify media-output.",
        issueCode: "inspection_failed_shopify_raw_img",
      })
    );
    suggestedFixes.push(
      "Gebruik image_url | image_tag in plaats van een raw <img> wanneer de src uit Shopify Liquid image_url/img_url komt."
    );
  }

  suggestedFixes.push(...extraSuggestedFixes);

  return {
    issues,
    suggestedFixes: uniqueStrings(suggestedFixes),
  };
}

function removeLiquidBlock(value, tagName) {
  return String(value || "").replace(
    new RegExp(`{%-?\\s*${escapeRegExp(tagName)}\\s*-?%}[\\s\\S]*?{%-?\\s*end${escapeRegExp(tagName)}\\s*-?%}`, "gi"),
    ""
  );
}

function maskSourcePreservingNewlines(value) {
  return String(value || "").replace(/[^\n]/g, " ");
}

function maskLiquidBlockPreservingNewlines(value, tagName) {
  return String(value || "").replace(
    new RegExp(
      `{%-?\\s*${escapeRegExp(tagName)}\\s*-?%}[\\s\\S]*?{%-?\\s*end${escapeRegExp(tagName)}\\s*-?%}`,
      "gi"
    ),
    (match) => maskSourcePreservingNewlines(match)
  );
}

function maskEmbeddedCodeClosers(value) {
  const source = String(value || "");
  const keepRanges = [];
  const completeLiquidTokenPattern = /({{-[\s\S]*?-}}|{{[\s\S]*?}}|{%-[\s\S]*?-%}|{%[\s\S]*?%})/g;

  for (const match of source.matchAll(completeLiquidTokenPattern)) {
    const start = match.index ?? 0;
    keepRanges.push([start, start + String(match[0] || "").length]);
  }

  if (keepRanges.length === 0) {
    return source.replace(/-}}|}}|-%}|%}/g, (token) => " ".repeat(token.length));
  }

  keepRanges.sort((left, right) => left[0] - right[0]);
  let sanitized = "";
  let cursor = 0;

  for (const [start, end] of keepRanges) {
    if (start > cursor) {
      sanitized += source
        .slice(cursor, start)
        .replace(/-}}|}}|-%}|%}/g, (token) => " ".repeat(token.length));
    }
    sanitized += source.slice(start, end);
    cursor = end;
  }

  if (cursor < source.length) {
    sanitized += source
      .slice(cursor)
      .replace(/-}}|}}|-%}|%}/g, (token) => " ".repeat(token.length));
  }

  return sanitized;
}

function sanitizeEmbeddedHtmlBlockContents(value, tagName) {
  return String(value || "").replace(
    new RegExp(`(<${escapeRegExp(tagName)}\\b[^>]*>)([\\s\\S]*?)(</${escapeRegExp(tagName)}>)`, "gi"),
    (_match, openTag, blockContent, closeTag) =>
      `${openTag}${maskEmbeddedCodeClosers(blockContent)}${closeTag}`
  );
}

function sanitizeEmbeddedLiquidBlockContents(value, tagName) {
  return String(value || "").replace(
    new RegExp(
      `({%-?\\s*${escapeRegExp(tagName)}\\s*-?%})([\\s\\S]*?)({%-?\\s*end${escapeRegExp(tagName)}\\s*-?%})`,
      "gi"
    ),
    (_match, openTag, blockContent, closeTag) =>
      `${openTag}${maskEmbeddedCodeClosers(blockContent)}${closeTag}`
  );
}

function sanitizeSourceForLiquidDelimiterBalance(value) {
  let sanitized = String(value || "");

  for (const tagName of ["raw", "comment", "schema", "doc"]) {
    sanitized = maskLiquidBlockPreservingNewlines(sanitized, tagName);
  }

  for (const tagName of ["style", "script"]) {
    sanitized = sanitizeEmbeddedHtmlBlockContents(sanitized, tagName);
  }

  for (const tagName of ["stylesheet", "javascript"]) {
    sanitized = sanitizeEmbeddedLiquidBlockContents(sanitized, tagName);
  }

  return sanitized;
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

function extractInlineScriptContents(value) {
  return Array.from(
    String(value || "").matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi),
    (match) => String(match[1] || "")
  );
}

function extractLiquidOutputTags(value) {
  return Array.from(
    String(value || "").matchAll(/{{[\s\S]*?}}/g),
    (match) => String(match[0] || "")
  );
}

function getLineNumberAtIndex(source, index) {
  return String(source || "")
    .slice(0, Math.max(0, Number(index) || 0))
    .split("\n").length;
}

function collectLiquidDelimiterBalanceIssues(value, fileKey) {
  const issues = [];
  const suggestedFixes = [];
  const source = String(value || "");
  const sanitizedSource = sanitizeSourceForLiquidDelimiterBalance(source);
  const tokenPattern = /({{[-]?|{%-?|[-]?}}|[-]?%})/g;
  const stack = [];

  for (const match of sanitizedSource.matchAll(tokenPattern)) {
    const token = String(match[0] || "");
    const index = match.index ?? 0;

    if (token === "{{" || token === "{{-") {
      stack.push({ kind: "output", index });
      continue;
    }

    if (token === "{%" || token === "{%-") {
      stack.push({ kind: "tag", index });
      continue;
    }

    if (token === "}}" || token === "-}}") {
      const current = stack.pop();
      if (!current || current.kind !== "output") {
        issues.push(
          createInspectionIssue({
            path: [fileKey],
            problem:
              `Building Inspection Failed: een Liquid output-delimiter sluit niet correct rond regel ${getLineNumberAtIndex(sanitizedSource, index)}.`,
            fixSuggestion:
              "Controleer of alle {{ ... }} output-tags correct openen en sluiten en dat er geen losse }} of -}} overblijven.",
            issueCode: "inspection_failed_liquid_delimiter_balance",
          })
        );
        suggestedFixes.push(
          "Sluit elke {{ of {{- af met een bijpassende }} of -}}.",
          "Controleer of HTML, SVG of JavaScript geen losse Liquid-sluiters bevat."
        );
        return { issues, suggestedFixes };
      }
      continue;
    }

    if (token === "%}" || token === "-%}") {
      const current = stack.pop();
      if (!current || current.kind !== "tag") {
        issues.push(
          createInspectionIssue({
            path: [fileKey],
            problem:
              `Building Inspection Failed: een Liquid tag-delimiter sluit niet correct rond regel ${getLineNumberAtIndex(sanitizedSource, index)}.`,
            fixSuggestion:
              "Controleer of alle {% ... %} tags correct openen en sluiten en dat er geen losse %} of -%} overblijven.",
            issueCode: "inspection_failed_liquid_delimiter_balance",
          })
        );
        suggestedFixes.push(
          "Sluit elke {% of {%- af met een bijpassende %} of -%}.",
          "Controleer vooral for/if/schema/style/javascript blokken op kapotte delimiters."
        );
        return { issues, suggestedFixes };
      }
    }
  }

  if (stack.length > 0) {
    const unclosed = stack[stack.length - 1];
    issues.push(
      createInspectionIssue({
        path: [fileKey],
        problem:
          `Building Inspection Failed: ongesloten Liquid ${unclosed.kind === "tag" ? "tag" : "output"} gedetecteerd rond regel ${getLineNumberAtIndex(sanitizedSource, unclosed.index)}.`,
        fixSuggestion:
          unclosed.kind === "tag"
            ? "Voeg de ontbrekende %} of -%} toe en controleer of alle {% ... %} blokken volledig zijn."
            : "Voeg de ontbrekende }} of -}} toe en controleer of alle {{ ... }} expressies volledig zijn.",
        issueCode: "inspection_failed_liquid_delimiter_balance",
      })
    );
    suggestedFixes.push(
      "Controleer of geen enkele {{ ... }} of {% ... %} expressie halverwege is afgebroken.",
      "Laat de client altijd een volledige filebody genereren in plaats van een afgekorte samenvatting."
    );
  }

  return {
    issues,
    suggestedFixes,
  };
}

function collectLiquidRendererSafety(value, fileKey) {
  const issues = [];
  const warnings = [];
  const suggestedFixes = [];
  const delimiterInspection = collectLiquidDelimiterBalanceIssues(value, fileKey);
  issues.push(...(delimiterInspection.issues || []));
  suggestedFixes.push(...(delimiterInspection.suggestedFixes || []));
  const outputTags = extractLiquidOutputTags(value);
  const nestedLiquidOutput = outputTags.find((tag) => /{{|{%-?\s*|{%\s*/.test(tag.slice(2, -2)));

  if (nestedLiquidOutput) {
    issues.push(
      createInspectionIssue({
        path: [fileKey],
        problem:
          "Building Inspection Failed: een Liquid output-tag bevat opnieuw {{ ... }} of {% ... %} binnen dezelfde expressie. Bouw dynamische strings eerst op via assign/capture/append en geef daarna alleen de variabele door.",
        fixSuggestion:
          "Haal geneste Liquid uit dezelfde {{ ... }} expressie en gebruik eerst assign/capture voor dynamische classnames, URLs of filter-argumenten.",
        issueCode: "inspection_failed_liquid_output_nesting",
      })
    );
    suggestedFixes.push(
      "Gebruik bijvoorbeeld eerst {% assign avatar_class = 'review-avatars-' | append: block.id | append: '__avatar-image' %} en geef daarna avatar_class door aan image_tag.",
      "Vermijd strings zoals class: 'foo-{{ block.id }}' binnen dezelfde {{ ... }} output-tag."
    );
  }

  if (
    /for\s+block\s+in\s+section\.blocks/i.test(String(value || "")) &&
    !/block\.shopify_attributes/.test(String(value || ""))
  ) {
    issues.push(
      createInspectionIssue({
        path: [fileKey],
        problem:
          "Building Inspection Failed: renderer loop over section.blocks mist block.shopify_attributes. Daardoor werkt Theme Editor drag-and-drop en block-selectie niet betrouwbaar.",
        fixSuggestion:
          "Zet {{ block.shopify_attributes }} op de block-wrapper wanneer je over section.blocks rendert.",
        issueCode: "inspection_failed_block_shopify_attributes",
      })
    );
    suggestedFixes.push(
      "Zet {{ block.shopify_attributes }} op de block-wrapper wanneer je over section.blocks rendert."
    );
  }

  return {
    issues,
    warnings,
    suggestedFixes,
  };
}

function detectLiquidInsideJsTemplateInterpolation(scriptSource) {
  return /\$\{[\s\S]{0,200}?(?:{{|{%)[\s\S]{0,200}?(?:}}|%})[\s\S]{0,120}?\}/.test(
    String(scriptSource || "")
  );
}

function usesGlobalJsSelector(scriptSource) {
  return /document\.(querySelector(?:All)?|getElementById|getElementsByClassName|getElementsByTagName)\s*\(/.test(
    String(scriptSource || "")
  );
}

function usesLocallyScopedJsSelector(scriptSource) {
  return /\b(root|sectionRoot|sectionEl|container|sliderRoot|accordionRoot|host)\.(querySelector(?:All)?|getElementById)\s*\(/.test(
    String(scriptSource || "")
  );
}

function hasSectionScopeMarker(source) {
  return /{{\s*section\.id\b|shopify-section-|data-section-id|data-section-root|dataset\.sectionId|document\.currentScript\.closest|closest\([^)]*(?:shopify-section|data-section-id|data-section-root)/i.test(
    String(source || "")
  );
}

function collectInteractiveSectionSafety(value, fileKey) {
  const issues = [];
  const warnings = [];
  const suggestedFixes = [];
  const source = String(value || "");
  const scriptBodies = [
    ...extractInlineScriptContents(value),
    ...getSpecialBlockContents(value, "javascript"),
  ].filter((entry) => entry.trim().length > 0);

  if (scriptBodies.length === 0) {
    return { issues, warnings, suggestedFixes };
  }

  if (scriptBodies.some((scriptBody) => detectLiquidInsideJsTemplateInterpolation(scriptBody))) {
    issues.push(
      createInspectionIssue({
        path: [fileKey],
        problem:
          "Building Inspection Failed: interactieve section-JS mixt JavaScript template interpolation (${...}) met Liquid-output ({{ ... }} of {% ... %}) in dezelfde expressie. Dat breekt Liquid parsing of levert onvoorspelbare output op.",
        fixSuggestion:
          "Zet Liquid-waarden eerst in losse JS-variabelen of data-attributen, en gebruik daarna alleen pure JS-interpolatie binnen template literals.",
        issueCode: "inspection_failed_js_liquid_interpolation",
      })
    );
    suggestedFixes.push(
      "Zet bijvoorbeeld const sectionId = {{ section.id | json }}; en gebruik daarna `...${sectionId}...` in plaats van Liquid binnen ${...}.",
      "Of gebruik data-section-id/data-* attributen op de markup en lees die in JavaScript uit."
    );
  }

  const hasScopeMarker = hasSectionScopeMarker(value);
  const hasGlobalSelector = scriptBodies.some((scriptBody) =>
    usesGlobalJsSelector(scriptBody)
  );
  const hasScopedSelector = hasScopeMarker || scriptBodies.some((scriptBody) =>
    usesLocallyScopedJsSelector(scriptBody)
  );

  if (hasGlobalSelector && !hasScopedSelector) {
    issues.push(
      createInspectionIssue({
        path: [fileKey],
        problem:
          "Building Inspection Failed: interactieve section-JS gebruikt globale selectors zonder duidelijke section-scoping. Daardoor kunnen meerdere instances op dezelfde pagina elkaar beïnvloeden.",
        fixSuggestion:
          "Scope alle selectors per section-root via section.id, data-section-id of een lokaal root-element voordat je querySelector gebruikt.",
        issueCode: "inspection_failed_unscoped_js",
      })
    );
    suggestedFixes.push(
      "Maak eerst een lokaal root-element, bijvoorbeeld const root = document.getElementById(`shopify-section-${sectionId}`), en query daarna alleen binnen root.",
      "Gebruik data-section-id of data-section-root op de section-wrapper als stabiele JS-scope."
    );
  } else if (!hasScopedSelector) {
    warnings.push(
      "Interactieve section bevat JS maar geen duidelijke section-scope marker zoals section.id of data-section-id. Controleer of meerdere section instances elkaar niet kunnen raken."
    );
    suggestedFixes.push(
      "Scope JS per section-root met section.id of data-section-id om instance-conflicten te voorkomen."
    );
  }

  const sliderLikeSignal =
    /slider|carousel|scrollby|snap|prev|next|track|arrow/i.test(
      `${source} ${scriptBodies.join("\n")}`
    );
  const hasSemanticControls =
    /<button\b|<summary\b|role\s*=\s*["']button["']/i.test(source);
  if (sliderLikeSignal && !hasSemanticControls) {
    warnings.push(
      "Interactieve section lijkt slider/carousel controls te hebben zonder semantische button-markup. Gebruik bij voorkeur echte <button> elementen voor prev/next of andere controls."
    );
    suggestedFixes.push(
      "Gebruik echte <button type=\"button\"> controls met aria-label voor prev/next of andere slider-acties."
    );
  }

  const hasCustomizerLifecycleHook = scriptBodies.some((scriptBody) =>
    /shopify:section:load|shopify:section:select|shopify:block:select|Shopify\.designMode/i.test(
      scriptBody
    )
  );
  if (scriptBodies.length > 0 && !hasCustomizerLifecycleHook) {
    warnings.push(
      "Interactieve section-JS mist expliciete Shopify Theme Editor lifecycle hooks. Controleer of re-initialisatie werkt na section reloads in de customizer."
    );
    suggestedFixes.push(
      "Ondersteun waar nodig Shopify Theme Editor events zoals shopify:section:load of gebruik een veilige re-init per section-root."
    );
  }

  return {
    issues,
    warnings,
    suggestedFixes,
  };
}

function collectMediaSectionSafety(value, fileKey, settingTypes) {
  const issues = [];
  const warnings = [];
  const suggestedFixes = [];
  const source = String(value || "");
  const hasHostedVideoMarkup = /<video\b|video_tag\b/i.test(source);
  const hasIframeEmbed = /<iframe\b|external_video_url\b|external_video_tag\b/i.test(source);
  const hasMediaMarkup =
    /image_tag\b|<img\b|<video\b|video_tag\b|external_video_tag\b|<iframe\b|placeholder_svg_tag\b/i.test(
      source
    );

  if (
    hasHostedVideoMarkup &&
    settingTypes.has("video_url") &&
    !settingTypes.has("video")
  ) {
    issues.push(
      createInspectionIssue({
        path: [fileKey, "schema", "settings"],
        problem:
          `Building Inspection Failed: de media-heavy section '${fileKey}' rendert Shopify-hosted video markup, maar schema biedt alleen video_url. Dat is bedoeld voor externe YouTube/Vimeo URLs, niet voor merchant-uploaded video-bestanden.`,
        fixSuggestion:
          "Gebruik setting type 'video' voor merchant-uploaded video-bestanden en reserveer video_url alleen voor externe embeds.",
        issueCode: "inspection_failed_video_setting_mismatch",
      })
    );
    suggestedFixes.push(
      "Gebruik setting type 'video' voor merchant-uploaded videobestanden en houd video_url alleen voor externe YouTube/Vimeo embeds."
    );
  }

  if (hasHostedVideoMarkup && !settingTypes.has("video") && !settingTypes.has("video_url")) {
    warnings.push(
      `De media-heavy section '${fileKey}' rendert video markup, maar schema mist een video of video_url setting.`
    );
    suggestedFixes.push(
      "Gebruik type 'video' voor merchant-uploaded videobestanden of video_url voor externe YouTube/Vimeo embeds."
    );
  }

  if (hasIframeEmbed && !settingTypes.has("video_url")) {
    warnings.push(
      `De media-heavy section '${fileKey}' gebruikt een iframe embed zonder video_url setting.`
    );
    suggestedFixes.push(
      "Gebruik een video_url setting voor externe video-embeds zodat merchants de bron veilig kunnen beheren."
    );
  }

  if (
    hasMediaMarkup &&
    !settingTypes.has("image_picker") &&
    !settingTypes.has("video") &&
    !settingTypes.has("video_url")
  ) {
    warnings.push(
      `De media-heavy section '${fileKey}' gebruikt media-rendering zonder merchant-editable image/video setting.`
    );
    suggestedFixes.push(
      "Voeg image_picker, video of video_url settings toe wanneer imagery of video merchant-editable moet zijn."
    );
  }

  return {
    issues,
    warnings,
    suggestedFixes,
  };
}

function collectExactMatchReferenceSafety(
  value,
  fileKey,
  { sectionBlueprint = null, themeContext = null } = {}
) {
  const referenceSignals = sectionBlueprint?.referenceSignals || null;
  if (!referenceSignals?.exactReplicaRequested) {
    return {
      issues: [],
      warnings: [],
      suggestedFixes: [],
    };
  }

  const source = String(value || "");
  const layoutContract = sectionBlueprint?.layoutContract || null;
  const themeWrapperStrategy = sectionBlueprint?.themeWrapperStrategy || null;
  const schema = parseSectionSchema(source).schema;
  const schemaSettings = collectSchemaSettings(schema);
  const issues = [];
  const warnings = [];
  const suggestedFixes = [];
  const scaleAnalysis = analyzeSectionScale(source, { key: fileKey });
  const requestedDecorativeMediaAnchors = Array.isArray(
    referenceSignals.requestedDecorativeMediaAnchors
  )
    ? referenceSignals.requestedDecorativeMediaAnchors
    : [];
  const requestedDecorativeBadgeAnchors = Array.isArray(
    referenceSignals.requestedDecorativeBadgeAnchors
  )
    ? referenceSignals.requestedDecorativeBadgeAnchors
    : [];
  const hasMerchantEditableImageSetting = schemaSettings.some(
    (setting) => String(setting?.type || "").trim() === "image_picker"
  );
  const hasMerchantEditableBadgeSetting = schemaSettings.some((setting) =>
    /\b(badge|seal|sticker)\b/i.test(
      `${String(setting?.id || "")} ${String(setting?.label || "")}`
    )
  );
  const hasMediaMarkup =
    /image_tag\b|image_url\b|<img\b|<picture\b|placeholder_svg_tag\b|video_tag\b|<video\b|<iframe\b/i.test(
      source
    );
  const hasDecorativeBadgeMarkup =
    /\b(badge|seal|sticker|eyebrow|gluten[-_ ]?free)\b/i.test(source) ||
    /border-radius\s*:\s*999(?:px|rem|em)?/i.test(source);
  const hasRatingStarMarkup =
    /★|☆|&#9733;|&#9734;|&starf;|&star;|rating[-_ ]?star|star[-_ ]?(?:icon|row|rating)|aria-label\s*=\s*["'][^"']*star/i.test(
      source
    ) ||
    (/\b(rating|trustpilot|review[-_ ]?rating)\b/i.test(source) && /<svg\b/i.test(source));
  const hasComparisonIconography =
    /[✔✓✕✖✗]|check(?:mark|marks?)\b|thumbs?[-_ ]?down\b|cross(?:es)?\b|x[-_ ]?mark\b|aria-label\s*=\s*["'][^"']*(?:check|thumb|cross|x)/i.test(
      source
    ) ||
    (/\b(check|thumb|cross|comparison)\b/i.test(source) && /<svg\b/i.test(source));
  const hasResponsiveViewportHandling =
    /@media\b|@container\b|clamp\(|repeat\(\s*auto-fit|repeat\(\s*auto-fill|minmax\(/i.test(
      source
    );
  const usesSectionPropertiesBackground =
    /render\s+['"]section-properties['"][^%]*\bbackground\s*:/i.test(source);
  const rootSectionMatch = source.match(
    /<(?:section|div)\b[^>]*class\s*=\s*["']([^"']+)["']/i
  );
  const rootClassTokens = Array.from(
    new Set(
      String(rootSectionMatch?.[1] || "")
        .split(/\s+/)
        .map((token) => token.trim())
        .filter((token) => token && /^[A-Za-z0-9_-]+$/.test(token))
    )
  );
  const hasRootBackgroundShell = rootClassTokens.some((className) =>
    new RegExp(
      `\\.${escapeRegExp(className)}\\b[^{}]*\\{[^}]*background(?:-color)?\\s*:`,
      "i"
    ).test(source)
  );
  const rootUsesOuterContainer = rootClassTokens.some((className) =>
    /^(?:page-width|container|content-container)$/i.test(className)
  );
  const hasSplitLayoutSignals =
    /grid-template-columns\s*:[^;]*(?:minmax\([^;]+?\)|\b1fr\b)[^;]*(?:minmax\([^;]+?\)|\b1fr\b)/i.test(
      source
    ) ||
    /class\s*=\s*["'][^"']*(?:split|two[-_ ]column|two[-_ ]up|side[-_ ]by[-_ ]side)[^"']*["']/i.test(
      source
    ) ||
    /\b(?:media|image|visual|photo|video)[-_ ]?(?:column|col|pane|panel)\b/i.test(source);
  const hasBackgroundLayerSignals =
    /background-image\s*:|class\s*=\s*["'][^"']*(?:overlay|media-layer|image-layer|background-media|hero__media|hero__overlay)[^"']*["']/i.test(
      source
    ) ||
    /position\s*:\s*absolute[\s\S]{0,180}?inset\s*:\s*0/i.test(source) ||
    /linear-gradient|radial-gradient|conic-gradient/i.test(source);
  const hasConditionalMediaFallback =
    /{%\s*if[\s\S]{0,240}?(?:section\.settings|block\.settings|hero_image|media|image|video)[\s\S]*?{%\s*else\s*%}[\s\S]*?{%\s*endif\s*%}/i.test(
      source
    );
  const hasSharedMediaSlotWrapper =
    /<([a-z]+)\b[^>]*class\s*=\s*["'][^"']*(?:media|visual|image|video|hero__media)[^"']*["'][^>]*>\s*{%\s*if[\s\S]*?{%\s*endif\s*%}\s*<\/\1>/i.test(
      source
    );

  if (
    referenceSignals.requiresRenderablePreviewMedia &&
    /placeholder_svg_tag\b/i.test(source)
  ) {
    issues.push(
      createInspectionIssue({
        path: [fileKey],
        problem:
          "Exacte referentie-sections mogen in de eerste preview geen placeholder_svg_tag of lege placeholder-cards als hoofdmedia tonen.",
        fixSuggestion:
          "Zorg voor direct renderbare preview-media in de eerste write, bijvoorbeeld via collection/product fallbacks of andere echte media-bronnen. Vertrouw niet alleen op image_picker placeholders voor een screenshot-replica.",
        issueCode: "exact_match_placeholder_media",
      })
    );
    suggestedFixes.push(
      "Gebruik voor screenshot-replica's direct renderbare preview-media in plaats van placeholder_svg_tag.",
      "Gebruik image_picker alleen als merchant-editable override; voeg daarnaast een echte fallback render-path toe voor de eerste preview."
    );
  } else if (
    referenceSignals.allowStylizedPreviewFallbacks &&
    /placeholder_svg_tag\b/i.test(source)
  ) {
    warnings.push(
      "De exacte referentie lijkt alleen screenshot-gedreven te zijn zonder losse bronmedia. Placeholder_svg_tag blokkeert de create-write niet meer hard, maar een renderbare demo-media fallback of gestileerde media shell geeft een betrouwbaarder eerste resultaat."
    );
    suggestedFixes.push(
      "Vervang placeholder_svg_tag bij screenshot-only replica's liever door een renderbare demo-media fallback of een gestileerde media shell met juiste aspect-ratio.",
      "Behoud merchant-editable image_picker/video settings, maar laat de eerste write niet alleen op placeholders steunen als de compositie sterk media-gedreven is."
    );
  }

  if (
    referenceSignals.requiresTitleAccent &&
    !/<em\b|<i\b|font-style\s*:\s*italic/i.test(source)
  ) {
    issues.push(
      createInspectionIssue({
        path: [fileKey],
        problem:
          "De referentie vraagt om een expliciete accent- of cursief-typografie in de titel, maar de section bevat geen herkenbare italic/emphasis markup of styling.",
        fixSuggestion:
          "Splits het accentwoord of accentdeel uit en geef het expliciet <em>, <i> of font-style: italic mee.",
        issueCode: "exact_match_missing_title_accent",
      })
    );
    suggestedFixes.push(
      "Gebruik expliciete italic/emphasis markup of styling voor het accentwoord in de titel."
    );
  }

  if (
    referenceSignals.requiresDecorativeMediaAnchors &&
    !hasMerchantEditableImageSetting &&
    !hasMediaMarkup
  ) {
    issues.push(
      createInspectionIssue({
        path: [fileKey],
        problem:
          "De exacte referentie bevat onderscheidende decoratieve media-anchors, maar de section bevat geen merchant-editable image setting of renderbare media-markup om die compositie te benaderen.",
        fixSuggestion:
          "Voeg minstens één image_picker setting en een renderbare decoratieve media-anchor toe, bijvoorbeeld een floating product-afbeelding of mockupbeeld met betrouwbare aspect-ratio en positioning.",
        issueCode: "exact_match_missing_reference_media_anchor",
        suggestedReplacement: {
          requestedDecorativeMediaAnchors,
        },
      })
    );
    suggestedFixes.push(
      "Voeg een merchant-editable image_picker toe voor het onderscheidende decoratieve referentiebeeld.",
      "Render een zichtbare decoratieve media-anchor in de eerste write in plaats van alleen een generieke tabel- of tekstlayout."
    );
  }

  if (
    referenceSignals.requiresDecorativeBadgeAnchors &&
    !hasMerchantEditableBadgeSetting &&
    !hasDecorativeBadgeMarkup
  ) {
    issues.push(
      createInspectionIssue({
        path: [fileKey],
        problem:
          "De exacte referentie bevat badge- of seal-achtige compositie-elementen, maar de section bevat geen herkenbare badge-setting of badge-markup.",
        fixSuggestion:
          "Voeg een badge/seal-achtige anchor toe in de eerste write, bijvoorbeeld via een image_picker of tekstsetting met bijpassende badge-markup en positioning.",
        issueCode: "exact_match_missing_reference_badge_anchor",
        suggestedReplacement: {
          requestedDecorativeBadgeAnchors,
        },
      })
    );
    suggestedFixes.push(
      "Voeg een badge- of seal-anchor toe die merchants later kunnen aanpassen.",
      "Laat onderscheidende badge-elementen uit de referentie niet weg als de flow om een exacte match vraagt."
    );
  }

  if (referenceSignals.requiresRatingStars && !hasRatingStarMarkup) {
    issues.push(
      createInspectionIssue({
        path: [fileKey],
        problem:
          "De exacte referentie bevat een ster- of rating-strip, maar de section bevat geen herkenbare ster- of rating-iconografie.",
        fixSuggestion:
          "Gebruik echte sterren of semantische rating-iconen, bijvoorbeeld via sterglyphs, SVG-sterren of toegankelijke rating-markup in plaats van generieke blokjes.",
        issueCode: "exact_match_missing_rating_stars",
      })
    );
    suggestedFixes.push(
      "Gebruik echte ster- of rating-iconografie voor de rating-strip.",
      "Vervang generieke blokjes of abstracte vormen door herkenbare sterren of toegankelijke rating-markup."
    );
  }

  if (
    referenceSignals.requiresComparisonIconography &&
    !hasComparisonIconography
  ) {
    issues.push(
      createInspectionIssue({
        path: [fileKey],
        problem:
          "De exacte comparison-referentie verwacht herkenbare check/x/thumb-iconografie, maar de section bevat geen duidelijke vergelijking-iconen.",
        fixSuggestion:
          "Gebruik echte check/x/thumb-achtige iconografie, bijvoorbeeld via SVG, glyphs of semantische icon-markup in plaats van generieke cirkels of lege vakken.",
        issueCode: "exact_match_missing_comparison_iconography",
      })
    );
    suggestedFixes.push(
      "Gebruik echte check/x/thumb-achtige vergelijking-iconen.",
      "Vervang generieke cirkels of lege vakken door herkenbare iconografie die de referentie beter benadert."
    );
  }

  if (
    referenceSignals.requiresResponsiveViewportParity &&
    !hasResponsiveViewportHandling
  ) {
    issues.push(
      createInspectionIssue({
        path: [fileKey],
        problem:
          "De exacte referentie noemt expliciet desktop en mobile, maar de section bevat geen duidelijke responsive breakpoint- of viewportlogica.",
        fixSuggestion:
          "Voeg expliciete responsive viewportlogica toe, bijvoorbeeld via @media of container-query gedrag dat de mobile compositie zichtbaar afwijkt van desktop.",
        issueCode: "exact_match_missing_viewport_parity",
      })
    );
    suggestedFixes.push(
      "Voeg expliciete desktop/mobile breakpointlogica toe in plaats van alleen een generieke schaalbare layout."
    );
  }

  if (referenceSignals.requiresNavButtons && !/<button\b/i.test(source)) {
    issues.push(
      createInspectionIssue({
        path: [fileKey],
        problem:
          "De referentie vraagt om zichtbare navigatie-controls, maar de section bevat geen semantische <button>-controls voor prev/next of vergelijkbare acties.",
        fixSuggestion:
          "Gebruik echte <button type=\"button\"> controls met aria-label voor slider- of carousel-navigatie.",
        issueCode: "exact_match_missing_nav_buttons",
      })
    );
    suggestedFixes.push(
      "Gebruik semantische <button type=\"button\"> controls voor prev/next navigatie."
    );
  }

  if (
    referenceSignals.requiresThemeEditorLifecycleHooks &&
    /<script\b/i.test(source) &&
    !/shopify:section:load|shopify:section:select|shopify:block:select|Shopify\.designMode/i.test(
      source
    )
  ) {
    issues.push(
      createInspectionIssue({
        path: [fileKey],
        problem:
          "Een precision-first interactieve replica mist Shopify Theme Editor lifecycle hooks. Daardoor kan de eerste versie in de customizer onbetrouwbaar re-initialiseren.",
        fixSuggestion:
          "Ondersteun shopify:section:load, shopify:section:select of een vergelijkbare veilige re-init per section-root in de eerste write.",
        issueCode: "exact_match_missing_theme_editor_hooks",
      })
    );
    suggestedFixes.push(
      "Voeg Shopify Theme Editor lifecycle hooks toe aan slider- of carousel-JS in de eerste write."
    );
  }

  if (
    referenceSignals.requiresThemeWrapperMirror &&
    themeContext?.usesPageWidth &&
    !scaleAnalysis.hasPageWidthClass
  ) {
    issues.push(
      createInspectionIssue({
        path: [fileKey],
        problem:
          "De referentie-flow verwacht dezelfde content-width wrapper als het doeltheme, maar deze section mist een herkenbare page-width/container wrapper.",
        fixSuggestion:
          "Spiegel de bestaande content-width wrapper van het doeltheme, zoals page-width of container, zodat typography en cardbreedtes beter aansluiten.",
        issueCode: "exact_match_missing_theme_wrapper",
      })
    );
    suggestedFixes.push(
      "Gebruik dezelfde content-width wrapper als de representatieve theme section."
    );
  }

  if (
    layoutContract?.avoidOuterContainer ||
    themeWrapperStrategy?.allowOuterThemeContainer === false
  ) {
    if (rootUsesOuterContainer) {
      issues.push(
        createInspectionIssue({
          path: [fileKey],
          problem:
            "De exacte media-first/full-bleed hero zet een page-width/container op de outer hero-shell. Daardoor wordt een full-bleed referentie onterecht boxed.",
          fixSuggestion:
            "Laat de outer hero-shell full-bleed en verplaats page-width/container alleen naar een inner content-laag.",
          issueCode: "exact_match_hero_outer_container",
        })
      );
      suggestedFixes.push(
        "Laat de outer hero-shell full-bleed en verplaats page-width/container alleen naar een inner content-laag."
      );
    }
  }

  if (layoutContract?.requiresBackgroundMediaArchitecture) {
    if (hasSplitLayoutSignals && !hasBackgroundLayerSignals) {
      issues.push(
        createInspectionIssue({
          path: [fileKey],
          problem:
            "De exacte hero-referentie vraagt om een media-first/background-media architectuur, maar de huidige markup oogt als een split two-column layout zonder duidelijke media layer, overlay layer en content layer.",
          fixSuggestion:
            "Gebruik de hero-architectuur media layer -> overlay layer -> content layer en vermijd een losse inline media-kolom als primaire shell.",
          issueCode: "exact_match_media_first_split_mismatch",
        })
      );
      suggestedFixes.push(
        "Gebruik voor media-first heroes een media layer, overlay layer en content layer in plaats van een split two-column shell."
      );
    }
  }

  if (layoutContract?.sharedMediaSlotRequired) {
    if (hasConditionalMediaFallback && !hasSharedMediaSlotWrapper) {
      issues.push(
        createInspectionIssue({
          path: [fileKey],
          problem:
            "De exacte media-first hero gebruikt verschillende DOM-slots of wrappers voor uploaded media en fallback-media. Daardoor wijkt de compositie tussen beide states zichtbaar af.",
          fixSuggestion:
            "Laat uploaded media en fallback-media exact hetzelfde primaire media-slot en dezelfde wrapper-hiërarchie delen.",
          issueCode: "exact_match_media_slot_mismatch",
        })
      );
      suggestedFixes.push(
        "Laat uploaded media en fallback-media exact hetzelfde primaire media-slot en dezelfde wrapper-hiërarchie delen."
      );
    }
  }

  if (
    referenceSignals.avoidDoubleSectionShell &&
    usesSectionPropertiesBackground &&
    hasRootBackgroundShell
  ) {
    issues.push(
      createInspectionIssue({
        path: [fileKey],
        problem:
          "De section combineert een eigen root background-shell met een section-properties background-helper. Dat geeft snel een dubbele outer shell en laat de sectie groter of losser ogen dan de referentie.",
        fixSuggestion:
          "Kies precies één outer surface-strategie: laat ofwel de theme wrapper/helper de outer achtergrond dragen, of houd de helper neutraal en plaats de decoratieve shell op een bounded inner container.",
        issueCode: "exact_match_double_background_shell",
      })
    );
    suggestedFixes.push(
      "Vermijd een dubbele outer shell wanneer section-properties al een background-helper krijgt.",
      "Plaats de decoratieve reference-shell op een bounded inner container of maak de root background transparant."
    );
  }

  if (
    referenceSignals.requiresOverlayTreatment &&
    !/linear-gradient|radial-gradient|conic-gradient/i.test(source)
  ) {
    warnings.push(
      "De referentie noemt een overlay of gradient, maar er is geen duidelijke gradient-behandeling in de section gedetecteerd."
    );
    suggestedFixes.push(
      "Voeg een duidelijke gradient of overlay-behandeling toe wanneer de referentie daarom vraagt."
    );
  }

  return {
    issues,
    warnings,
    suggestedFixes,
  };
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

function inspectEditableLiquidSchema(value, fileLabel, { fileKey = null, rootOwner = "section" } = {}) {
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

  const requiredFieldIssues = collectSchemaRequiredFieldIssues(
    schema,
    fileKey || fileLabel,
    { rootOwner }
  );
  if (requiredFieldIssues.length > 0) {
    return buildInspectionResult({
      issues: requiredFieldIssues,
      suggestedFixes: requiredFieldIssues.map((issue) => issue.fixSuggestion).filter(Boolean),
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
  if (file.key.endsWith(".liquid")) {
    const value = String(file.value || "");
    const issues = [];
    const warnings = [`⚠️ Template write (${file.key}): dit wijzigt de pagina-layout direct.`];
    const suggestedFixes = [];

    if (
      containsLiquidInSpecialBlock(value, "stylesheet") ||
      containsLiquidInSpecialBlock(value, "javascript")
    ) {
      issues.push(
        createInspectionIssue({
          path: [file.key],
          problem:
            "Liquid binnen {% stylesheet %} of {% javascript %} is niet toegestaan. Gebruik <style> of markup-level CSS variables.",
          fixSuggestion:
            "Verplaats Liquid-afhankelijke CSS of JS naar reguliere <style>/<script>-markup of naar veilige vooraf berekende assigns.",
          issueCode: "inspection_failed_css",
        })
      );
      suggestedFixes.push(
        "Verplaats Liquid-afhankelijke CSS of JS uit {% stylesheet %}/{% javascript %} naar reguliere markup."
      );
    }

    const rendererSafety = collectLiquidRendererSafety(value, file.key);
    issues.push(...(rendererSafety.issues || []));
    warnings.push(...(rendererSafety.warnings || []));
    suggestedFixes.push(...(rendererSafety.suggestedFixes || []));

    if (!hasRenderableContentOutsideSchema(value)) {
      issues.push(
        createInspectionIssue({
          path: [file.key],
          problem:
            `Template '${file.key}' moet renderbare Liquid bevatten, bijvoorbeeld één of meer {% section '...' %} tags.`,
          fixSuggestion:
            "Voeg ten minste één renderbare {% section '...' %} tag of andere geldige template-markup toe.",
          issueCode: "inspection_failed_incomplete_template",
        })
      );
      suggestedFixes.push(
        "Voeg ten minste één renderbare {% section '...' %} tag of andere geldige template-markup toe."
      );
    }

    return buildInspectionResult({
      issues,
      warnings,
      suggestedFixes,
    });
  }

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

function inspectSectionFile(file, { themeContext = null, sectionBlueprint = null } = {}) {
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

  const rendererInspection = collectLiquidRendererSafety(value, file.key);
  issues.push(...(rendererInspection.issues || []));
  warnings.push(...(rendererInspection.warnings || []));
  suggestedFixes.push(...(rendererInspection.suggestedFixes || []));

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
  const requiredFieldIssues = collectSchemaRequiredFieldIssues(schema, file.key, {
    rootOwner: "section",
  });
  if (requiredFieldIssues.length > 0) {
    issues.push(...requiredFieldIssues);
  }
  const sectionProfile = classifySectionGeneration({
    fileKey: file.key,
    source: value,
    schema,
    query:
      sectionBlueprint?.category && sectionBlueprint.category !== "hybrid"
        ? sectionBlueprint.category
        : "",
  });

  const rawImgInspection = collectRawImgSafetyIssues(value, file.key, {
    surfaceLabel: "Shopify sections",
    extraSuggestedFixes: [
      "Gebruik image_picker, collection of andere Shopify resource settings voor merchant-editable media.",
    ],
  });
  issues.push(...(rawImgInspection.issues || []));
  suggestedFixes.push(...(rawImgInspection.suggestedFixes || []));

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

  if (themeContext) {
    const themeScaleInspection = inspectSectionScaleAgainstTheme({
      value,
      fileKey: file.key,
      themeContext,
    });
    issues.push(...(themeScaleInspection.issues || []));
    warnings.push(...(themeScaleInspection.warnings || []));
    suggestedFixes.push(...(themeScaleInspection.suggestedFixes || []));
  }

  const settingTypes = collectSchemaSettingTypes(schema);
  const optionalResourceInspection = collectOptionalResourceRuntimeSafety(
    value,
    file.key,
    schema,
    { rootOwner: "section" }
  );
  issues.push(...(optionalResourceInspection.issues || []));
  warnings.push(...(optionalResourceInspection.warnings || []));
  suggestedFixes.push(...(optionalResourceInspection.suggestedFixes || []));

  const presetRenderabilityInspection = collectPresetRenderabilityIssues(
    file.key,
    schema,
    optionalResourceInspection.unsafeRefs
  );
  issues.push(...(presetRenderabilityInspection.issues || []));
  warnings.push(...(presetRenderabilityInspection.warnings || []));
  suggestedFixes.push(...(presetRenderabilityInspection.suggestedFixes || []));

  const isInteractiveSection =
    sectionProfile.category === "interactive" ||
    sectionProfile.category === "hybrid" ||
    sectionProfile.categorySignals.includes("interactive");
  const isMediaHeavySection =
    sectionProfile.category === "media" ||
    sectionProfile.category === "hybrid" ||
    sectionProfile.categorySignals.includes("media");

  if (isInteractiveSection) {
    const interactiveInspection = collectInteractiveSectionSafety(value, file.key);
    issues.push(...(interactiveInspection.issues || []));
    warnings.push(...(interactiveInspection.warnings || []));
    suggestedFixes.push(...(interactiveInspection.suggestedFixes || []));
  }

  if (isMediaHeavySection) {
    const mediaInspection = collectMediaSectionSafety(
      value,
      file.key,
      settingTypes
    );
    issues.push(...(mediaInspection.issues || []));
    warnings.push(...(mediaInspection.warnings || []));
    suggestedFixes.push(...(mediaInspection.suggestedFixes || []));
  }

  const exactMatchInspection = collectExactMatchReferenceSafety(value, file.key, {
    sectionBlueprint,
    themeContext,
  });
  issues.push(...(exactMatchInspection.issues || []));
  warnings.push(...(exactMatchInspection.warnings || []));
  suggestedFixes.push(...(exactMatchInspection.suggestedFixes || []));

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
  const hasMerchantEditableMediaMarkup =
    /<img\b|<picture\b|image_tag\b|image_url\b|video_tag\b|<video\b|<iframe\b|placeholder_svg_tag\b/i.test(
      value
    );
  if (!settingTypes.has("image_picker") && hasMerchantEditableMediaMarkup) {
    warnings.push("De section lijkt media te gebruiken, maar schema bevat geen image_picker.");
    suggestedFixes.push("Voeg een image_picker toe wanneer imagery of logo's merchant-editable moeten zijn.");
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

  const rendererInspection = collectLiquidRendererSafety(value, file.key);
  issues.push(...(rendererInspection.issues || []));
  warnings.push(...(rendererInspection.warnings || []));
  suggestedFixes.push(...(rendererInspection.suggestedFixes || []));

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
  const requiredFieldIssues = collectSchemaRequiredFieldIssues(schema, file.key, {
    rootOwner: "block",
  });
  if (requiredFieldIssues.length > 0) {
    issues.push(...requiredFieldIssues);
  }
  const optionalResourceInspection = collectOptionalResourceRuntimeSafety(
    value,
    file.key,
    schema,
    { rootOwner: "block" }
  );
  issues.push(...(optionalResourceInspection.issues || []));
  warnings.push(...(optionalResourceInspection.warnings || []));
  suggestedFixes.push(...(optionalResourceInspection.suggestedFixes || []));

  const mediaInspection = collectMediaSectionSafety(value, file.key, settingTypes);
  issues.push(...(mediaInspection.issues || []));
  warnings.push(...(mediaInspection.warnings || []));
  suggestedFixes.push(...(mediaInspection.suggestedFixes || []));

  const rawImgInspection = collectRawImgSafetyIssues(value, file.key, {
    surfaceLabel: "Shopify blocks",
  });
  issues.push(...(rawImgInspection.issues || []));
  suggestedFixes.push(...(rawImgInspection.suggestedFixes || []));

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

function inspectSnippetFile(
  file,
  {
    relatedSchema = null,
    relatedSchemaKey = null,
    rootOwner = "section",
    originalValue = null,
    treatAsNativeBlockRenderer = false,
  } = {}
) {
  const value = String(file.value || "");
  const issues = [];
  const warnings = [];
  const suggestedFixes = [];

  if (containsLiquidInSpecialBlock(value, "stylesheet") || containsLiquidInSpecialBlock(value, "javascript")) {
    issues.push(
      createInspectionIssue({
        path: [file.key],
        problem:
          "Liquid binnen {% stylesheet %} of {% javascript %} is niet toegestaan. Gebruik <style> of markup-level CSS variables.",
        fixSuggestion:
          "Verplaats Liquid-afhankelijke CSS naar een <style> block.",
        issueCode: "inspection_failed_css",
      })
    );
    suggestedFixes.push(
      "Verplaats Liquid-afhankelijke CSS naar een <style> block.",
      "Laat {% stylesheet %} en {% javascript %} alleen statische CSS/JS bevatten."
    );
  }

  const rendererInspection = collectLiquidRendererSafety(value, file.key);
  issues.push(...(rendererInspection.issues || []));
  warnings.push(...(rendererInspection.warnings || []));
  suggestedFixes.push(...(rendererInspection.suggestedFixes || []));

  const rendererContractInspection = collectSnippetRendererContractSafety(value, file.key, {
    treatAsNativeBlockRenderer,
  });
  issues.push(...(rendererContractInspection.issues || []));
  warnings.push(...(rendererContractInspection.warnings || []));
  suggestedFixes.push(...(rendererContractInspection.suggestedFixes || []));

  if (relatedSchema) {
    const relatedSchemaIntegrity = collectRelatedSchemaReferenceIntegrity(
      value,
      file.key,
      relatedSchema,
      {
        relatedSchemaKey,
        rootOwner,
        originalValue,
      }
    );
    issues.push(...(relatedSchemaIntegrity.issues || []));
    warnings.push(...(relatedSchemaIntegrity.warnings || []));
    suggestedFixes.push(...(relatedSchemaIntegrity.suggestedFixes || []));

    const optionalResourceInspection = collectSnippetOptionalResourceRuntimeSafety(
      value,
      file.key,
      relatedSchema,
      {
        rootOwner,
        originalValue,
      }
    );
    issues.push(...(optionalResourceInspection.issues || []));
    warnings.push(...(optionalResourceInspection.warnings || []));
    suggestedFixes.push(...(optionalResourceInspection.suggestedFixes || []));

    const relatedSettingTypes = collectSchemaSettingTypes(relatedSchema);
    const interactiveInspection = collectInteractiveSectionSafety(value, file.key);
    issues.push(...(interactiveInspection.issues || []));
    warnings.push(...(interactiveInspection.warnings || []));
    suggestedFixes.push(...(interactiveInspection.suggestedFixes || []));

    const mediaInspection = collectMediaSectionSafety(
      value,
      file.key,
      relatedSettingTypes
    );
    issues.push(...(mediaInspection.issues || []));
    warnings.push(...(mediaInspection.warnings || []));
    suggestedFixes.push(...(mediaInspection.suggestedFixes || []));
  }

  const rawImgInspection = collectRawImgSafetyIssues(value, file.key, {
    surfaceLabel: "Shopify renders",
  });
  issues.push(...(rawImgInspection.issues || []));
  suggestedFixes.push(...(rawImgInspection.suggestedFixes || []));

  if (!hasLiquidBlockTag(value, "doc")) {
    warnings.push(
      "Snippet mist een {% doc %} block. Dit is aanbevolen voor tooling en maakt snippet-contracten duidelijker."
    );
    suggestedFixes.push(
      "Voeg een compact {% doc %} block toe bovenaan snippets die render-parameters accepteren."
    );
  }

  return buildInspectionResult({
    issues,
    warnings,
    suggestedFixes,
  });
}

function normalizeLintErrors(offenses, tmpDir) {
  return offenses.map((offense) => ({
    file: offense.uri ? offense.uri.replace(`file://${tmpDir}/`, "") : "root",
    check: offense.check || "Unknown",
    message: offense.message,
    severity: offense.severity === 0 ? "error" : "warning",
    start: offense.start || null,
    line:
      offense.start && Number.isInteger(offense.start.line)
        ? offense.start.line
        : null,
    column:
      offense.start &&
      (Number.isInteger(offense.start.character)
        ? offense.start.character
        : Number.isInteger(offense.start.column)
          ? offense.start.column
          : null),
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

const CONTEXT_PLACEHOLDER_WRITE_PATTERN =
  /^(?:[A-Z0-9]+(?:_[A-Z0-9]+)*)_ALREADY_APPLIED_IN_CONTEXT$/;

function isContextPlaceholderWrite(value) {
  const normalized = String(value || "").trim();
  return Boolean(normalized) && CONTEXT_PLACEHOLDER_WRITE_PATTERN.test(normalized);
}

function buildFullRewriteRetryArgsTemplate({
  themeId,
  themeRole,
  key,
  plannerHandoff,
} = {}) {
  return {
    ...(themeId !== undefined && themeId !== null ? { themeId } : {}),
    ...(themeRole ? { themeRole } : {}),
    mode: "edit",
    files: [
      {
        key: key || "<theme-file>",
        value: "<full rewritten file content>",
      },
    ],
    ...(plannerHandoff && typeof plannerHandoff === "object"
      ? { plannerHandoff }
      : {}),
  };
}

function buildLiteralPatchRetryArgsTemplate({
  themeId,
  themeRole,
  key,
  plannerHandoff,
} = {}) {
  return {
    ...(themeId !== undefined && themeId !== null ? { themeId } : {}),
    ...(themeRole ? { themeRole } : {}),
    mode: "edit",
    files: [
      {
        key: key || "<theme-file>",
        patch: {
          searchString: "<exact literal anchor from the current file>",
          replaceString: "<updated markup/liquid>",
        },
      },
    ],
    ...(plannerHandoff && typeof plannerHandoff === "object"
      ? { plannerHandoff }
      : {}),
  };
}

function buildFailureResponse({
  status,
  message,
  draftId,
  warnings = [],
  errors,
  lintIssues,
  draft,
  errorCode,
  retryable,
  suggestedFixes = [],
  shouldNarrowScope = false,
  nextAction,
  nextTool = "draft-theme-artifact",
  nextArgsTemplate,
  retryMode,
  normalizedArgs,
  suggestedSchemaRewrites = [],
  preferSelectFor = [],
  themeContext,
  sectionBlueprint,
  plannerHandoff,
  newFileSuggestions,
  alternativeNextArgsTemplates,
}) {
  return {
    success: false,
    status,
    ...(draftId ? { draftId } : {}),
    message,
    ...(errors ? { errors } : {}),
    ...(lintIssues ? { lintIssues } : {}),
    warnings,
    ...(draft ? { draft } : {}),
    errorCode,
    retryable,
    suggestedFixes: uniqueStrings(suggestedFixes),
    shouldNarrowScope,
    ...(nextAction ? { nextAction } : {}),
    ...(nextTool ? { nextTool } : {}),
    ...(nextArgsTemplate ? { nextArgsTemplate } : {}),
    ...(Array.isArray(newFileSuggestions) && newFileSuggestions.length > 0
      ? { newFileSuggestions }
      : {}),
    ...(alternativeNextArgsTemplates ? { alternativeNextArgsTemplates } : {}),
    ...(retryMode ? { retryMode } : {}),
    ...(normalizedArgs ? { normalizedArgs } : {}),
    ...(themeContext ? { themeContext } : {}),
    ...(sectionBlueprint ? { sectionBlueprint } : {}),
    ...(plannerHandoff ? { plannerHandoff } : {}),
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
  lintIssues = [],
  suggestedFixes = [],
  suggestedSchemaRewrites = [],
  preferSelectFor = [],
  shouldNarrowScope = false,
  nextAction = "fix_local_validation",
  themeContext = null,
  sectionBlueprint = null,
  plannerHandoff = null,
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
    ...(lintIssues.length > 0 ? { lintIssues } : {}),
    errorCode,
    retryable: true,
    suggestedFixes,
    shouldNarrowScope,
    nextAction,
    retryMode: "same_request_after_fix",
    normalizedArgs,
    themeContext,
    sectionBlueprint,
    plannerHandoff,
    suggestedSchemaRewrites,
    preferSelectFor,
  });
}

function extractExpectedTokenFromLintMessage(message) {
  return String(message || "").match(/expected "([^"]+)"/i)?.[1] || null;
}

function describeLintLocation(error) {
  if (Number.isInteger(error?.line) && Number.isInteger(error?.column)) {
    return `${error.file}:${error.line}:${error.column}`;
  }

  if (Number.isInteger(error?.line)) {
    return `${error.file}:${error.line}`;
  }

  return error?.file || "root";
}

function buildLintFixSuggestions(error) {
  const location = describeLintLocation(error);
  const expectedToken = extractExpectedTokenFromLintMessage(error?.message);

  switch (error?.check) {
    case "ImgWidthAndHeight":
      return [
        `${location}: gebruik image_url + image_tag in plaats van een raw <img> zonder betrouwbare afmetingen.`,
        `${location}: als een raw <img> toch nodig is, voeg dan expliciete width en height attributen toe.`,
      ];
    case "LiquidHTMLSyntaxError":
      return [
        `${location}: herstel de Liquid-syntax door alle {{ ... }}, {% ... %} en HTML-tags correct te sluiten${expectedToken ? `; theme-check verwacht hier ${expectedToken}` : ""}.`,
        `${location}: controleer op een afgebroken expressie, een ontbrekende end-tag of een niet-afgesloten haakje/string in Liquid markup.`,
      ];
    case "UnsupportedDocTag":
      return [
        `${location}: gebruik alleen ondersteunde {% doc %} annotaties of verwijder de ongeldige doc-tag.`,
        `${location}: houd doc-blokken compact en syntactisch geldig zodat theme-check ze kan parsen.`,
      ];
    case "UnknownObject":
    case "UnknownFilter":
      return [
        `${location}: controleer of het gebruikte Liquid object of filter echt in Shopify beschikbaar is binnen deze theme-context.`,
      ];
    case "theme-check-runtime":
      return [
        `${location}: de lint-sandbox zelf faalde. Controleer de gegenereerde bestanden op ongeldige paden of corrupte Liquid/JSON inhoud en probeer daarna opnieuw.`,
      ];
    default:
      return [`${location}: ${error?.message}`];
  }
}

function buildLintDiagnostic(error) {
  const expectedToken = extractExpectedTokenFromLintMessage(error?.message);
  let issueCode = "lint_failed_liquid";

  switch (error?.check) {
    case "ImgWidthAndHeight":
      issueCode = "lint_failed_img_dimensions";
      break;
    case "LiquidHTMLSyntaxError":
      issueCode = "lint_failed_liquid_syntax";
      break;
    case "UnsupportedDocTag":
      issueCode = "lint_failed_unsupported_doc_tag";
      break;
    case "UnknownObject":
    case "UnknownFilter":
      issueCode = "lint_failed_unknown_reference";
      break;
    case "theme-check-runtime":
      issueCode = "lint_failed_runtime";
      break;
    default:
      break;
  }

  return {
    path: error?.file ? [error.file] : ["root"],
    problem: error?.message || "theme-check vond een lintfout.",
    fixSuggestion: buildLintFixSuggestions(error)[0],
    issueCode,
    check: error?.check || "Unknown",
    severity: error?.severity || "error",
    ...(Number.isInteger(error?.line) ? { line: error.line } : {}),
    ...(Number.isInteger(error?.column) ? { column: error.column } : {}),
    ...(expectedToken ? { suggestedReplacement: { expectedToken } } : {}),
  };
}

function buildLintDiagnostics(lintErrors = []) {
  return lintErrors.map((error) => buildLintDiagnostic(error));
}

function suggestFixesFromLintErrors(lintErrors = []) {
  return uniqueStrings(
    lintErrors.slice(0, 5).flatMap((error) => buildLintFixSuggestions(error))
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
  if (lintErrors.some((error) => error.check === "LiquidHTMLSyntaxError")) {
    return {
      errorCode: "lint_failed_liquid_syntax",
      retryable: true,
      shouldNarrowScope: files.length > 3,
      suggestedFixes: suggestFixesFromLintErrors(lintErrors),
      nextAction: "rewrite_liquid_syntax",
    };
  }

  if (lintErrors.some((error) => error.check === "ImgWidthAndHeight")) {
    return {
      errorCode: "lint_failed_img_dimensions",
      retryable: true,
      shouldNarrowScope: false,
      suggestedFixes: suggestFixesFromLintErrors(lintErrors),
      nextAction: "fix_image_dimensions",
    };
  }

  if (lintErrors.some((error) => error.check === "UnsupportedDocTag")) {
    return {
      errorCode: "lint_failed_unsupported_doc_tag",
      retryable: true,
      shouldNarrowScope: false,
      suggestedFixes: suggestFixesFromLintErrors(lintErrors),
      nextAction: "fix_doc_tag_usage",
    };
  }

  if (
    lintErrors.some(
      (error) =>
        error.check === "UnknownObject" || error.check === "UnknownFilter"
    )
  ) {
    return {
      errorCode: "lint_failed_unknown_reference",
      retryable: true,
      shouldNarrowScope: files.length > 3,
      suggestedFixes: suggestFixesFromLintErrors(lintErrors),
      nextAction: "fix_unknown_reference",
    };
  }

  if (lintErrors.some((error) => error.check === "theme-check-runtime")) {
    return {
      errorCode: "lint_failed_runtime",
      retryable: true,
      shouldNarrowScope: false,
      suggestedFixes: suggestFixesFromLintErrors(lintErrors),
      nextAction: "retry_lint_after_runtime_fix",
    };
  }

  return {
    errorCode: "lint_failed_liquid",
    retryable: true,
    shouldNarrowScope: files.length > 3,
    suggestedFixes: suggestFixesFromLintErrors(lintErrors),
    nextAction: "fix_lint_errors",
  };
}

async function runThemeCheckSandbox({
  files,
  shopifyClient,
  apiVersion,
  themeId,
  themeRole,
}) {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "hazify-sandbox-"));
  let lintErrors = null;
  const warnings = [];
  let lintSupportFiles = [];

  try {
    try {
      lintSupportFiles = await fetchLocaleLintSupportFiles({
        files,
        shopifyClient,
        apiVersion,
        themeId,
        themeRole,
      });

      if (needsLocaleLintContext(files) && lintSupportFiles.length === 0) {
        warnings.push(
          "Geen default locale files opgehaald voor de lint-sandbox. Translation checks kunnen daardoor strenger uitvallen dan in het echte theme."
        );
      }
    } catch (error) {
      warnings.push(
        `Kon default locale files niet ophalen voor de lint-sandbox: ${error.message}`
      );
    }

    await fs.mkdir(path.join(tmpDir, "locales"), { recursive: true });
    for (const file of [...lintSupportFiles, ...files]) {
      const fullPath = path.join(tmpDir, file.key);
      await fs.mkdir(path.dirname(fullPath), { recursive: true });
      await fs.writeFile(fullPath, file.value, "utf8");
    }

    let offenses = await check(tmpDir);

    const preExistingChecks = [
      "MissingSnippet",
      "MissingAsset",
      "MissingTemplate",
      "UnknownObject",
      "UnknownFilter",
    ];

    offenses = offenses.map((offense) => {
      if (offense.severity === 0 && preExistingChecks.includes(offense.check)) {
        return { ...offense, severity: 1 };
      }
      return offense;
    });

    const preExistingWarningCount = offenses.filter(
      (offense) =>
        offense.severity === 1 && preExistingChecks.includes(offense.check)
    ).length;
    if (preExistingWarningCount > 0) {
      warnings.push(
        `Gevonden ${preExistingWarningCount} pre-existing referentie(s) in het target thema (MissingSnippet/MissingAsset). Linter faalt hier niet meer hard op.`
      );
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
        line: null,
        column: null,
      },
    ];
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }

  return {
    lintErrors,
    warnings,
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
  title,
  description,
  docsDescription,
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
      const patchOverflowIssue = normalizedParse.error.issues.find(
        (issue) =>
          issue.path.includes("patches") &&
          (issue.code === "too_big" ||
            /at most|max/i.test(issue.message || ""))
      );
      const patchOverflowIndex =
        patchOverflowIssue && Number.isInteger(patchOverflowIssue.path?.[1])
          ? Number(patchOverflowIssue.path[1])
          : null;
      const patchOverflowKey =
        patchOverflowIndex !== null
          ? normalizedCandidateArgs.files?.[patchOverflowIndex]?.key || null
          : normalizedCandidateArgs.files?.[0]?.key || null;
      const patchOverflowTemplate = patchOverflowIssue
        ? {
            ...(normalizedCandidateArgs.themeId !== null
              ? { themeId: normalizedCandidateArgs.themeId }
              : {}),
            ...(normalizedCandidateArgs.themeRole
              ? { themeRole: normalizedCandidateArgs.themeRole }
              : {}),
            mode: "edit",
            files: [
              {
                key: patchOverflowKey || "<theme-file>",
                value: "<full rewritten file content>",
              },
            ],
          }
        : undefined;
      return buildFailureResponse({
        status: "needs_input",
        message:
          patchOverflowIssue
            ? "Deze draft-edit bevat te veel losse patches voor een veilige retry. Gebruik liever één volledige rewrite van hetzelfde bestand."
            : "De draft kon deze compat-input niet veilig normaliseren. Corrigeer de conflicterende velden en probeer opnieuw.",
        errorCode: "invalid_draft_theme_artifact_input",
        retryable: true,
        nextAction: patchOverflowIssue ? "rewrite_with_full_value" : "fix_input",
        nextArgsTemplate: patchOverflowTemplate,
        retryMode: patchOverflowIssue
          ? "same_request_with_full_rewrite"
          : "same_request_with_structured_fields",
        normalizedArgs: normalizedCandidateArgs,
        errors: normalizedParse.error.issues.map((issue) =>
          buildDraftInputError({
            path: issue.path,
            problem: issue.message,
            issueCode:
              issue.path.includes("patches") &&
              (issue.code === "too_big" || /at most|max/i.test(issue.message || ""))
                ? "patch_batch_too_large"
                : undefined,
            fixSuggestion:
              issue.path.join(".") === "themeId"
                ? "Stuur alleen themeId of alleen themeRole mee."
                : issue.path.includes("patches") &&
                    (issue.code === "too_big" ||
                      /at most|max/i.test(issue.message || ""))
                  ? "Gebruik voor een bredere visual/markup rewrite liever één volledige value-write in draft-theme-artifact mode='edit' in plaats van een lange patches-array."
                : issue.path.join(".").includes("patch") &&
                    issue.message.includes("mode='create'")
                  ? "Gebruik mode='edit' voor patch/patches of stuur in create mode een volledige value-write."
                  : "Corrigeer dit invoerveld en probeer dezelfde toolcall opnieuw.",
          })
        ),
        suggestedFixes: patchOverflowIssue
          ? [
              "Gebruik voor bredere section-refinements liever één volledige rewrite in draft-theme-artifact mode='edit'.",
              "Reserveer patch/patches voor kleine, unieke literal fixes.",
            ]
          : [],
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
          "Vrije summary-tekst of velden zoals value_summary/liquid_summary mogen nooit de daadwerkelijke file-inhoud vervangen.",
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
              "Stuur files[] mee of gebruik key + value/content/liquid of key + patch/patches. Samenvattingsvelden zoals value_summary of liquid_summary zijn niet genoeg.",
          }),
        ],
      });
    }

    const shopifyClient = requireShopifyClient(context);
    const resolvedMode = resolveDraftMode(requestedMode, files);
    const shouldProbeExistingFiles = resolvedMode.probeExistingFiles;
    mode = resolvedMode.mode;
    const themeEditState = getThemeEditMemory(context);
    const effectivePlannerHandoff =
      input.plannerHandoff && typeof input.plannerHandoff === "object"
        ? input.plannerHandoff
        : context?.plannerHandoff && typeof context.plannerHandoff === "object"
          ? context.plannerHandoff
          : themeEditState?.lastPlan?.plannerHandoff &&
              typeof themeEditState.lastPlan.plannerHandoff === "object"
            ? themeEditState.lastPlan.plannerHandoff
            : null;

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

    if (mode === "create" && !shouldProbeExistingFiles) {
      try {
        const existingCreateTargets = await getThemeFiles(shopifyClient, process.env.SHOPIFY_API_VERSION || "2026-01", {
          themeId,
          themeRole,
          keys: files.map((file) => file.key),
          includeContent: false,
        });
        const conflictingKeys = (existingCreateTargets.files || [])
          .filter((file) => file && !file.missing && file.found !== false)
          .map((file) => String(file.key || "").trim())
          .filter(Boolean);

        if (conflictingKeys.length > 0) {
          const primaryConflict = conflictingKeys[0];
          const alternateKeySuggestions = buildAlternateThemeFileSuggestions(primaryConflict);
          return buildFailureResponse({
            status: "inspection_failed",
            message:
              conflictingKeys.length === 1
                ? `Create mode is geblokkeerd: '${primaryConflict}' bestaat al in het doeltheme. Gebruik edit mode voor bestaande files of kies een nieuwe bestandsnaam.`
                : `Create mode is geblokkeerd: ${conflictingKeys.length} doelbestanden bestaan al in het doeltheme (${conflictingKeys.join(", ")}). Gebruik edit mode of kies nieuwe bestandsnamen.`,
            errorCode: "existing_create_key_conflict",
            retryable: true,
            suggestedFixes: [
              "Gebruik mode='edit' als je bestaande theme files wilt wijzigen.",
              "Of kies voor create mode volledig nieuwe keys die nog niet in het doeltheme bestaan.",
              ...(alternateKeySuggestions.length > 0
                ? [`Voor '${primaryConflict}' kun je bijvoorbeeld '${alternateKeySuggestions[0]}' gebruiken als aparte nieuwe file.`]
                : []),
            ],
            shouldNarrowScope: false,
            nextAction: "choose_edit_or_new_key",
            retryMode: "same_request_after_fix",
            normalizedArgs: getNormalizedArgs(),
            errors: conflictingKeys.map((key) =>
              buildDraftInputError({
                path: ["files", files.findIndex((file) => file.key === key), "key"],
                problem: `Create mode mag bestaand bestand '${key}' niet overschrijven.`,
                fixSuggestion:
                  key === primaryConflict && alternateKeySuggestions.length > 0
                    ? `Gebruik mode='edit' voor '${key}', of kies een nieuwe key zoals '${alternateKeySuggestions[0]}'.`
                    : "Gebruik mode='edit' voor bestaande bestanden of kies een nieuwe file key.",
                issueCode: "existing_create_key_conflict",
                ...(key === primaryConflict && alternateKeySuggestions.length > 0
                  ? { suggestedReplacement: alternateKeySuggestions[0] }
                  : {}),
              })
            ),
            ...(alternateKeySuggestions.length > 0
              ? {
                  newFileSuggestions: alternateKeySuggestions,
                  nextArgsTemplate: {
                    ...getNormalizedArgs(),
                    files: files.map((file) =>
                      file.key === primaryConflict
                        ? { ...file, key: alternateKeySuggestions[0] }
                        : file
                    ),
                  },
                }
              : {}),
          });
        }
      } catch (error) {
        warnings.push(
          `Kon niet vooraf controleren of create-targets al bestaan in het doeltheme: ${error.message}`
        );
      }
    }

    const plannerHandoffThemeTarget =
      effectivePlannerHandoff?.themeTarget &&
      typeof effectivePlannerHandoff.themeTarget === "object"
        ? effectivePlannerHandoff.themeTarget
        : null;
    const plannerHandoffReadKeys = Array.isArray(effectivePlannerHandoff?.requiredReadKeys)
      ? effectivePlannerHandoff.requiredReadKeys.filter(Boolean)
      : [];
    const plannerHandoffWriteKeys = Array.isArray(effectivePlannerHandoff?.nextWriteKeys)
      ? effectivePlannerHandoff.nextWriteKeys.filter(Boolean)
      : [];
    const plannerHandoffIntent = String(effectivePlannerHandoff?.intent || "").trim();
    const rememberedPlanReadKeys = Array.isArray(themeEditState?.lastPlan?.nextReadKeys)
      ? themeEditState.lastPlan.nextReadKeys.filter(Boolean)
      : [];
    const rememberedPlanWriteKeys = Array.isArray(themeEditState?.lastPlan?.nextWriteKeys)
      ? themeEditState.lastPlan.nextWriteKeys.filter(Boolean)
      : [];
    const rememberedPlanIntent = String(themeEditState?.lastPlan?.intent || "").trim();
    const rememberedPlanTargetCompatible = themeTargetsCompatible(themeEditState?.themeTarget, {
      themeId,
      themeRole,
    });
    const handoffTargetCompatible =
      !plannerHandoffThemeTarget ||
      themeTargetsCompatible(plannerHandoffThemeTarget, {
        themeId,
        themeRole,
      });
    const plannedReadKeys =
      rememberedPlanTargetCompatible && rememberedPlanReadKeys.length > 0
        ? rememberedPlanReadKeys
        : handoffTargetCompatible
          ? plannerHandoffReadKeys
          : [];
    const plannedWriteKeys =
      rememberedPlanTargetCompatible && rememberedPlanWriteKeys.length > 0
        ? rememberedPlanWriteKeys
        : handoffTargetCompatible
          ? plannerHandoffWriteKeys
          : [];
    const effectivePlanIntent =
      rememberedPlanTargetCompatible && rememberedPlanIntent
        ? rememberedPlanIntent
        : handoffTargetCompatible
          ? plannerHandoffIntent
          : "";
    const effectiveThemeSectionContext =
      context?.themeSectionContext &&
      typeof context.themeSectionContext === "object"
        ? context.themeSectionContext
        : handoffTargetCompatible &&
            effectivePlannerHandoff?.themeContext &&
            typeof effectivePlannerHandoff.themeContext === "object"
          ? effectivePlannerHandoff.themeContext
          : null;
    const effectiveSectionBlueprint =
      context?.sectionBlueprint &&
      typeof context.sectionBlueprint === "object"
        ? context.sectionBlueprint
        : handoffTargetCompatible &&
            effectivePlannerHandoff?.sectionBlueprint &&
            typeof effectivePlannerHandoff.sectionBlueprint === "object"
          ? effectivePlannerHandoff.sectionBlueprint
          : null;
    const effectivePlannerArchitecture =
      effectivePlannerHandoff?.architecture &&
      typeof effectivePlannerHandoff.architecture === "object"
        ? effectivePlannerHandoff.architecture
        : null;
    const shouldEnforcePlannedReads =
      plannedReadKeys.length > 0 &&
      (
        (mode === "edit" &&
          plannedWriteKeys.length > 0 &&
          files.every((file) => plannedWriteKeys.includes(file.key))) ||
        (mode === "create" &&
          effectivePlanIntent === "new_section" &&
          files.every((file) => String(file.key || "").startsWith("sections/")))
      );

    let missingPlannedReadKeys = [];
    if (shouldEnforcePlannedReads) {
      const alreadySatisfied = haveRecentThemeReads(context, {
        keys: plannedReadKeys,
        themeId,
        themeRole,
      });

      if (!alreadySatisfied) {
        try {
          const hydrationResult = await hydrateExactThemeReads(context, {
            shopifyClient,
            apiVersion: process.env.SHOPIFY_API_VERSION || "2026-01",
            themeId,
            themeRole,
            keys: plannedReadKeys,
          });
          missingPlannedReadKeys = hydrationResult.missingKeys || [];
          if ((hydrationResult.hydratedKeys || []).length > 0) {
            warnings.push(
              `Planner-required theme-context reads zijn automatisch opgehaald: ${hydrationResult.hydratedKeys.join(", ")}.`
            );
          }
        } catch (error) {
          missingPlannedReadKeys = plannedReadKeys;
          warnings.push(
            `Automatisch ophalen van planner-required theme-context reads mislukte: ${error.message}`
          );
        }
      }
    }

    if (missingPlannedReadKeys.length > 0) {
      return buildFailureResponse({
        status: "inspection_failed",
        message:
          "Deze edit-flow mist nog de planner-reads met includeContent=true. Lees eerst de exact voorgestelde bestanden in voordat je schrijft.",
        errorCode: "missing_theme_context_reads",
        retryable: true,
        suggestedFixes: [
          "Lees eerst de exacte nextReadKeys uit plan-theme-edit in met includeContent=true.",
          "Gebruik daarna pas patch-theme-file of draft-theme-artifact voor de write.",
        ],
        shouldNarrowScope: false,
        nextAction: "read_theme_context",
        nextTool:
          missingPlannedReadKeys.length === 1
            ? "get-theme-file"
            : "get-theme-files",
        nextArgsTemplate:
          missingPlannedReadKeys.length === 1
            ? {
                ...(themeId !== undefined ? { themeId } : {}),
                ...(themeRole ? { themeRole } : {}),
                key: missingPlannedReadKeys[0],
                includeContent: true,
              }
            : {
                ...(themeId !== undefined ? { themeId } : {}),
                ...(themeRole ? { themeRole } : {}),
                keys: missingPlannedReadKeys,
                includeContent: true,
              },
        retryMode: "switch_tool_after_fix",
        normalizedArgs: getNormalizedArgs(),
        errors: missingPlannedReadKeys.map((key) =>
          buildDraftInputError({
            path: ["files"],
            problem: `Vereiste planner-read '${key}' ontbreekt nog in deze flow.`,
            fixSuggestion:
              "Lees eerst de planner-bestanden met includeContent=true zodat anchors, schema en renderer-context uit het echte theme komen.",
            issueCode: "missing_theme_context_reads",
          })
        ),
        themeContext: effectiveThemeSectionContext,
        sectionBlueprint: effectiveSectionBlueprint,
        ...(effectivePlannerHandoff ? { plannerHandoff: effectivePlannerHandoff } : {}),
      });
    }

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
            resolvedFiles.push({
              key: file.key,
              value: file.value || "",
              checksum: file.baseChecksumMd5,
              originalValue: null,
            });
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
             if (isContextPlaceholderWrite(newValue)) {
                const placeholderValue = String(newValue || "").trim();
                return buildFailureResponse({
                  status: "inspection_failed",
                  message: `Existing section edit voor '${file.key}' bevat geen echte bestandsinhoud maar de context-placeholder '${placeholderValue}'. draft-theme-artifact kan eerdere chatcontext niet als file body reconstrueren.`,
                  errorCode: "inspection_failed_context_placeholder",
                  retryable: true,
                  suggestedFixes: [
                    "Stuur voor een full rewrite het VOLLEDIGE herschreven bestand in files[].value mee.",
                    "Of gebruik files[].patch / files[].patches met een letterlijke unieke anchor als je maar een gerichte wijziging nodig hebt.",
                    `Gebruik create-theme-section niet opnieuw voor '${file.key}' nu dit bestand al bestaat.`,
                  ],
                  shouldNarrowScope: false,
                  nextAction: "replace_context_placeholder_with_full_rewrite_or_patch",
                  nextArgsTemplate: buildFullRewriteRetryArgsTemplate({
                    themeId,
                    themeRole,
                    key: file.key,
                    plannerHandoff: effectivePlannerHandoff,
                  }),
                  alternativeNextArgsTemplates: {
                    patchExisting: buildLiteralPatchRetryArgsTemplate({
                      themeId,
                      themeRole,
                      key: file.key,
                      plannerHandoff: effectivePlannerHandoff,
                    }),
                  },
                  retryMode: "same_request_with_full_rewrite_or_patch",
                  normalizedArgs: getNormalizedArgs(),
                  plannerHandoff: effectivePlannerHandoff,
                  errors: [
                    buildDraftInputError({
                      path: ["files", files.indexOf(file), "value"],
                      problem:
                        `files[].value voor '${file.key}' bevat alleen de context-placeholder '${placeholderValue}' in plaats van volledige Liquid-inhoud.`,
                      fixSuggestion:
                        "Stuur het volledige herschreven bestand terug of gebruik een letterlijke patch/patches op het bestaande bestand.",
                      issueCode: "inspection_failed_context_placeholder",
                    }),
                  ],
                });
             }

             if (newValue.length < originalValue.length * 0.5) {
                return buildFailureResponse({
                  status: "inspection_failed",
                  message: `Existing section edit appears incomplete. De nieuwe content van '${file.key}' is minder dan 50% van het origineel. Dit duidt mogelijk op truncation.`,
                  errorCode: "inspection_failed_truncated",
                  retryable: true,
                  suggestedFixes: [
                    "Stuur het VOLLEDIGE bestand terug, of gebruik het nieuwe 'patch' argument om een specifieke regel aan te passen.",
                    "Gebruik geen context-placeholders of samenvattingen als files[].value; deze tool verwacht echte bestandsinhoud.",
                  ],
                  shouldNarrowScope: false,
                  nextAction: "send_complete_file_or_patch",
                  nextArgsTemplate: buildFullRewriteRetryArgsTemplate({
                    themeId,
                    themeRole,
                    key: file.key,
                    plannerHandoff: effectivePlannerHandoff,
                  }),
                  alternativeNextArgsTemplates: {
                    patchExisting: buildLiteralPatchRetryArgsTemplate({
                      themeId,
                      themeRole,
                      key: file.key,
                      plannerHandoff: effectivePlannerHandoff,
                    }),
                  },
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
            checksum: file.baseChecksumMd5 || null,
            originalValue,
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
      resolvedFiles = files.map((f) => ({
        key: f.key,
        value: f.value || "",
        checksum: f.baseChecksumMd5,
        originalValue: null,
      }));
    }

    files = resolvedFiles;

    if (
      effectivePlanIntent === "native_block" &&
      effectivePlannerArchitecture?.usesThemeBlocks === true &&
      files.every((file) => !String(file.key || "").startsWith("blocks/"))
    ) {
      const suggestedBlockFile =
        Array.isArray(effectivePlannerHandoff?.newFileSuggestions) &&
        effectivePlannerHandoff.newFileSuggestions.find((key) =>
          String(key || "").startsWith("blocks/")
        );
      return buildFailureResponse({
        status: "inspection_failed",
        message:
          "Deze native block-flow draait via @theme/content_for('blocks'). Een section/snippet-only write is hier onvolledig; voeg minstens één blocks/*.liquid bestand toe.",
        errorCode: "native_block_requires_theme_block_file",
        retryable: true,
        suggestedFixes: [
          "Maak of wijzig het theme block in blocks/*.liquid.",
          "Gebruik sections/ of snippets/ alleen als aanvulling op de block-route, niet als vervanging ervan.",
        ],
        shouldNarrowScope: false,
        nextAction: "add_theme_block_file",
        retryMode: "same_request_after_fix",
        normalizedArgs: getNormalizedArgs(),
        plannerHandoff: effectivePlannerHandoff,
        ...(suggestedBlockFile
          ? {
              nextArgsTemplate: {
                ...getNormalizedArgs(),
                files: [
                  ...files,
                  {
                    key: suggestedBlockFile,
                    value: "<complete Shopify theme block with {% doc %} and {% schema %}>",
                  },
                ],
              },
            }
          : {}),
      });
    }

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
      warnings: [
        ...warnings,
        ...((Array.isArray(context?.themeContextWarnings)
          ? context.themeContextWarnings
          : [])),
      ],
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
          inspection = inspectSectionFile(file, {
            themeContext: effectiveThemeSectionContext,
            sectionBlueprint: effectiveSectionBlueprint,
          });
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
          const schemaInspection = inspectEditableLiquidSchema(value, `Section '${file.key}'`, {
            fileKey: file.key,
            rootOwner: "section",
          });
          const rendererInspection = collectLiquidRendererSafety(value, file.key);
          editIssues.push(...(schemaInspection.issues || []));
          editIssues.push(...(rendererInspection.issues || []));
          editWarnings.push(...(schemaInspection.warnings || []));
          editWarnings.push(...(rendererInspection.warnings || []));
          editSuggestedFixes.push(...(schemaInspection.suggestedFixes || []));
          editSuggestedFixes.push(...(rendererInspection.suggestedFixes || []));
          editSchemaRewrites.push(
            ...(schemaInspection.suggestedSchemaRewrites || [])
          );
          editPreferSelectFor.push(...(schemaInspection.preferSelectFor || []));

          if (hasLiquidBlockTag(value, "schema")) {
            const { schema } = parseSectionSchema(value);
            if (schema) {
              const optionalResourceInspection =
                collectIncrementalOptionalResourceRuntimeSafety(
                  value,
                  file.key,
                  schema,
                  {
                    rootOwner: "section",
                    originalValue:
                      typeof file.originalValue === "string"
                        ? file.originalValue
                        : null,
                  }
                );
              editIssues.push(...(optionalResourceInspection.issues || []));
              editWarnings.push(...(optionalResourceInspection.warnings || []));
              editSuggestedFixes.push(
                ...(optionalResourceInspection.suggestedFixes || [])
              );
            }
          }

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
          const schemaInspection = inspectEditableLiquidSchema(value, `Block '${file.key}'`, {
            fileKey: file.key,
            rootOwner: "block",
          });
          const rendererInspection = collectLiquidRendererSafety(value, file.key);
          editIssues.push(...(schemaInspection.issues || []));
          editIssues.push(...(rendererInspection.issues || []));
          editWarnings.push(...(schemaInspection.warnings || []));
          editWarnings.push(...(rendererInspection.warnings || []));
          editSuggestedFixes.push(...(schemaInspection.suggestedFixes || []));
          editSuggestedFixes.push(...(rendererInspection.suggestedFixes || []));
          editSchemaRewrites.push(
            ...(schemaInspection.suggestedSchemaRewrites || [])
          );
          editPreferSelectFor.push(...(schemaInspection.preferSelectFor || []));

          if (hasLiquidBlockTag(value, "schema")) {
            const { schema } = parseSectionSchema(value);
            if (schema) {
              const optionalResourceInspection =
                collectIncrementalOptionalResourceRuntimeSafety(
                  value,
                  file.key,
                  schema,
                  {
                    rootOwner: "block",
                    originalValue:
                      typeof file.originalValue === "string"
                        ? file.originalValue
                        : null,
                  }
                );
              editIssues.push(...(optionalResourceInspection.issues || []));
              editWarnings.push(...(optionalResourceInspection.warnings || []));
              editSuggestedFixes.push(
                ...(optionalResourceInspection.suggestedFixes || [])
              );
            }
          }

          inspection = buildInspectionResult({
            issues: editIssues,
            warnings: editWarnings,
            suggestedFixes: editSuggestedFixes,
            suggestedSchemaRewrites: editSchemaRewrites,
            preferSelectFor: editPreferSelectFor,
          });
        }
      } else if (file.key.endsWith(".liquid") && file.key.startsWith("snippets/")) {
        const relatedSnippetSchema = resolveSnippetRelatedSchema({
          file,
          files,
          context,
          themeId,
          themeRole,
          plannerArchitecture: effectivePlannerArchitecture,
          plannedReadKeys,
          plannedWriteKeys,
        });
        inspection = inspectSnippetFile(file, {
          relatedSchema: relatedSnippetSchema.schema,
          relatedSchemaKey: relatedSnippetSchema.key,
          rootOwner: relatedSnippetSchema.rootOwner,
          originalValue:
            typeof file.originalValue === "string" ? file.originalValue : null,
          treatAsNativeBlockRenderer:
            effectivePlanIntent === "native_block" ||
            (Array.isArray(effectivePlannerArchitecture?.snippetRendererKeys) &&
              effectivePlannerArchitecture.snippetRendererKeys.includes(file.key)),
        });
      }

      if (inspection) {
        mergeInspectionIntoAccumulator(localInspection, inspection);
      }
      // Snippets, assets, locales: geen aanvullende inspectie nodig
    }

    const {
      lintErrors,
      warnings: lintSupportWarnings,
    } = await runThemeCheckSandbox({
      files,
      shopifyClient,
      apiVersion: process.env.SHOPIFY_API_VERSION || "2026-01",
      themeId,
      themeRole,
    });
    const lintDiagnostics = lintErrors ? buildLintDiagnostics(lintErrors) : [];
    const classifiedLint = lintErrors
      ? classifyLintErrors(lintErrors, files)
      : null;
    const preflightWarnings = uniqueStrings([
      ...warnings,
      ...localInspection.warnings,
      ...lintSupportWarnings,
    ]);
    const preflightSuggestedFixes = uniqueStrings([
      ...localInspection.suggestedFixes,
      ...(classifiedLint?.suggestedFixes || []),
    ]);

    if (localInspection.issues.length > 0) {
      return buildAggregatedInspectionFailure({
        normalizedArgs: getNormalizedArgs(),
        warnings: preflightWarnings,
        issues: [...localInspection.issues, ...lintDiagnostics],
        lintIssues: lintDiagnostics,
        suggestedFixes: preflightSuggestedFixes,
        suggestedSchemaRewrites: localInspection.suggestedSchemaRewrites,
        preferSelectFor: localInspection.preferSelectFor,
        themeContext: effectiveThemeSectionContext,
        sectionBlueprint: effectiveSectionBlueprint,
        plannerHandoff: effectivePlannerHandoff,
        shouldNarrowScope:
          localInspection.shouldNarrowScope ||
          Boolean(classifiedLint?.shouldNarrowScope),
        nextAction: lintDiagnostics.length > 0
          ? "fix_local_preflight"
          : "fix_local_validation",
      });
    }

    warnings.splice(0, warnings.length, ...preflightWarnings);
    suggestedFixes.splice(
      0,
      suggestedFixes.length,
      ...preflightSuggestedFixes
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
      return buildFailureResponse({
        status: "lint_failed",
        draftId,
        message: "Linter heeft syntaxfouten gevonden in de Liquid code. Fix deze bestanden voordat ze naar een preview theme worden gepusht.",
        errors: lintDiagnostics,
        lintIssues: lintDiagnostics,
        warnings,
        draft: buildDraftPayload(draftRecord, { warnings }),
        errorCode: classifiedLint.errorCode,
        retryable: classifiedLint.retryable,
        suggestedFixes,
        shouldNarrowScope: classifiedLint.shouldNarrowScope,
        nextAction: classifiedLint.nextAction,
        retryMode: "same_request_after_fix",
        normalizedArgs: getNormalizedArgs(),
        themeContext: effectiveThemeSectionContext,
        sectionBlueprint: effectiveSectionBlueprint,
        plannerHandoff: effectivePlannerHandoff,
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
          themeContext: effectiveThemeSectionContext,
          sectionBlueprint: effectiveSectionBlueprint,
          plannerHandoff: effectivePlannerHandoff,
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

      rememberThemeWrite(context, {
        themeId,
        themeRole,
        mode,
        files: files.map((file) => ({ key: file.key })),
        createdSectionFile:
          mode === "create" && files.length === 1 && files[0].key.startsWith("sections/")
            ? files[0].key
            : null,
      });

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
        ...(effectiveThemeSectionContext
          ? { themeContext: effectiveThemeSectionContext }
          : {}),
        ...(effectiveSectionBlueprint
          ? { sectionBlueprint: effectiveSectionBlueprint }
          : {}),
        ...(effectivePlannerHandoff ? { plannerHandoff: effectivePlannerHandoff } : {}),
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
        themeContext: effectiveThemeSectionContext,
        sectionBlueprint: effectiveSectionBlueprint,
        plannerHandoff: effectivePlannerHandoff,
      });
    }
  },
};
