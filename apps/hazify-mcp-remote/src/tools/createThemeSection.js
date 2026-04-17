import { z } from "zod";
import { requireShopifyClient } from "./_context.js";
import { draftThemeArtifact } from "./draftThemeArtifact.js";
import { planThemeEdit } from "../lib/themePlanning.js";
import { getThemeFiles } from "../lib/themeFiles.js";
import { inferTemplateSurfaceFromSectionLiquid } from "../lib/themeSectionContext.js";
import {
  extractThemeToolSummary,
  inferSingleThemeFile,
  inferThemeTargetFromSummary,
} from "./_themeToolCompatibility.js";

const API_VERSION = process.env.SHOPIFY_API_VERSION || "2026-01";
const ThemeRoleSchema = z.enum(["main", "unpublished", "demo", "development"]);
const SummaryFieldSchema = z.string().max(4000).optional();
const SECTION_KEY_PATTERN = /^sections\/[A-Za-z0-9._-]+\.liquid$/;
const SECTION_HANDLE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9-]*$/;

const normalizeCreateThemeSectionInput = (rawInput) => {
  if (!rawInput || typeof rawInput !== "object" || Array.isArray(rawInput)) {
    return rawInput;
  }

  const summary = extractThemeToolSummary(rawInput);
  const explicitKey =
    typeof rawInput.key === "string" && rawInput.key.trim()
      ? rawInput.key.trim()
      : typeof rawInput.targetFile === "string" && rawInput.targetFile.trim()
        ? rawInput.targetFile.trim()
        : null;
  const explicitHandle =
    typeof rawInput.handle === "string" && rawInput.handle.trim()
      ? rawInput.handle.trim()
      : typeof rawInput.sectionHandle === "string" && rawInput.sectionHandle.trim()
        ? rawInput.sectionHandle.trim()
        : null;

  let normalized = {
    themeId: rawInput.themeId,
    themeRole: rawInput.themeRole,
    key:
      explicitKey ||
      (explicitHandle && SECTION_HANDLE_PATTERN.test(explicitHandle)
        ? `sections/${explicitHandle}.liquid`
        : undefined),
    liquid:
      rawInput.value !== undefined
        ? rawInput.value
        : rawInput.content !== undefined
          ? rawInput.content
          : rawInput.liquid,
    isStandalone: rawInput.isStandalone,
  };

  if (summary) {
    normalized = inferThemeTargetFromSummary(normalized, summary);
    if (!normalized.key) {
      const inferredKey = inferSingleThemeFile(summary);
      if (inferredKey && SECTION_KEY_PATTERN.test(inferredKey)) {
        normalized.key = inferredKey;
      }
    }
  }

  return normalized;
};

const CreateThemeSectionPublicObjectSchema = z
  .object({
    themeId: z
      .string()
      .or(z.number())
      .optional()
      .describe("Optioneel expliciet doel theme ID. Laat weg om via themeRole te resolven."),
    themeRole: ThemeRoleSchema
      .optional()
      .describe("Target theme role. Verplicht als themeId niet is opgegeven. Vraag de gebruiker welk thema."),
    key: z
      .string()
      .min(1)
      .optional()
      .describe("Exact nieuw sectionbestand, bijvoorbeeld sections/review-replica.liquid."),
    targetFile: z
      .string()
      .min(1)
      .optional()
      .describe("Compat alias van key voor clients die targetFile gebruiken."),
    handle: z
      .string()
      .min(1)
      .optional()
      .describe("Compat shorthand voor alleen de section-handle, bijvoorbeeld review-replica."),
    sectionHandle: z
      .string()
      .min(1)
      .optional()
      .describe("Compat alias van handle."),
    value: z
      .string()
      .optional()
      .describe("Volledige Liquid-inhoud van de nieuwe section. Heeft prioriteit boven content en liquid."),
    content: z
      .string()
      .optional()
      .describe("Compat alias van value."),
    liquid: z
      .string()
      .optional()
      .describe("Compat alias van value."),
    _tool_input_summary: SummaryFieldSchema.describe(
      "Compat summary voor beperkte clients. Alleen veilige inferentie voor theme target en exact één sections/<handle>.liquid path."
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
    isStandalone: z
      .boolean()
      .optional()
      .describe("Optionele hint voor standalone section-workflows."),
  })
  .strict();

const CreateThemeSectionPublicShape = CreateThemeSectionPublicObjectSchema
  .superRefine((input, ctx) => {
    if (input.themeId && input.themeRole) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["themeId"],
        message: "Gebruik themeId of themeRole, niet allebei tegelijk.",
      });
    }
  });

const CreateThemeSectionNormalizedShape = z
  .object({
    themeId: z.string().or(z.number()).optional(),
    themeRole: ThemeRoleSchema.optional(),
    key: z.string().optional(),
    liquid: z.string().optional(),
    isStandalone: z.boolean().optional(),
  })
  .strict()
  .superRefine((input, ctx) => {
    if (input.themeId && input.themeRole) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["themeId"],
        message: "Gebruik themeId of themeRole, niet allebei tegelijk.",
      });
    }
  });

const CreateThemeSectionInputSchema = z.preprocess(
  normalizeCreateThemeSectionInput,
  CreateThemeSectionPublicShape
);

const CreateThemeSectionNormalizedSchema = z.preprocess(
  normalizeCreateThemeSectionInput,
  CreateThemeSectionNormalizedShape
);

const summarizeNormalizedCreateArgs = (input = {}) => ({
  themeId: input.themeId ?? null,
  themeRole: input.themeRole || null,
  key: input.key || null,
  isStandalone: Boolean(input.isStandalone),
  hasLiquid: typeof input.liquid === "string" && input.liquid.length > 0,
});

const buildCreateSectionError = ({
  path,
  problem,
  fixSuggestion,
  suggestedReplacement,
}) => ({
  path,
  problem,
  fixSuggestion,
  ...(suggestedReplacement !== undefined ? { suggestedReplacement } : {}),
});

const buildCreateSectionRepairResponse = ({
  status = "needs_input",
  message,
  errorCode,
  normalizedArgs,
  errors = [],
  nextAction,
  retryMode = "same_request_after_fix",
  nextArgsTemplate,
  nextTool = "create-theme-section",
  warnings = [],
  themeContext,
  sectionBlueprint,
}) => ({
  success: false,
  status,
  message,
  errorCode,
  retryable: true,
  nextAction,
  retryMode,
  nextTool,
  normalizedArgs,
  warnings,
  errors,
  ...(themeContext ? { themeContext } : {}),
  ...(sectionBlueprint ? { sectionBlueprint } : {}),
  ...(nextArgsTemplate ? { nextArgsTemplate } : {}),
});

const buildCreateSectionArgsTemplate = (input = {}) => ({
  ...(input.themeId !== undefined ? { themeId: input.themeId } : {}),
  ...(input.themeRole ? { themeRole: input.themeRole } : {}),
  key: input.key || "sections/<new-section>.liquid",
  liquid: "<complete Shopify Liquid section with valid {% schema %}>",
  ...(input.isStandalone ? { isStandalone: true } : {}),
});

const createThemeSectionTool = {
  name: "create-theme-section",
  title: "Create Theme Section",
  description:
    "Primary write tool for a brand-new Shopify section file in sections/<handle>.liquid. Use this as the first write for a new section. Do not use apply-theme-draft first. Required: explicit themeId or themeRole, one section file path or handle, and the complete Liquid file with a valid {% schema %}. After plan-theme-edit, read the exact nextReadKeys first. Internally the create-flow derives compact theme context, section-category guardrails and scale/parser/media preflight before validating. For small edits to existing files use patch-theme-file.",
  docsDescription:
    "Maak een nieuwe Shopify section in `sections/<handle>.liquid`. Dit is de primaire eerste write-tool voor nieuwe sections en een duidelijke wrapper rond de guarded create-flow. Gebruik deze dus vóór `apply-theme-draft`; die tool is alleen bedoeld voor een bestaand opgeslagen draftId. Vereist: expliciet `themeId` of `themeRole`, exact één section-bestand (`key` of `handle`) en de volledige Liquid-inhoud. Lees na `plan-theme-edit` bij voorkeur eerst de exacte `nextReadKeys` in één compacte `get-theme-files` call, zodat de generatie bestaande wrappers, helpers en schaalconventies spiegelt. De tool normaliseert veilige compat-velden zoals `targetFile`, `content`, `liquid` en `_tool_input_summary`, maar vrije summary-tekst mag nooit de daadwerkelijke code vervangen. Intern leidt de tool eerst compacte theme-context én section-category metadata af via `plan-theme-edit`-achtige logica, zodat create-validatie niet blind op hero-schaal aannames of parser-onveilige JS/Liquid patronen schrijft. Daarna gebruikt deze tool `draft-theme-artifact mode=\"create\"`, inclusief lokale schema-inspectie, theme-check lint, theme-scale sanity checks, interactieve/media guardrails en preview-write validatie.",
  inputSchema: CreateThemeSectionPublicObjectSchema,
  schema: CreateThemeSectionInputSchema,
  execute: async (rawInput, context = {}) => {
    const normalizedParse = CreateThemeSectionNormalizedSchema.safeParse(rawInput);
    if (!normalizedParse.success) {
      const normalizedArgs = summarizeNormalizedCreateArgs(
        normalizeCreateThemeSectionInput(rawInput)
      );
      return buildCreateSectionRepairResponse({
        message:
          "De create-section tool kon deze compat-input niet veilig normaliseren. Corrigeer de conflicterende velden en probeer opnieuw.",
        errorCode: "invalid_create_theme_section_input",
        nextAction: "fix_input",
        normalizedArgs,
        nextArgsTemplate: buildCreateSectionArgsTemplate(normalizedArgs),
        errors: normalizedParse.error.issues.map((issue) =>
          buildCreateSectionError({
            path: issue.path,
            problem: issue.message,
            fixSuggestion:
              issue.path.join(".") === "themeId"
                ? "Stuur alleen themeId of alleen themeRole mee."
                : "Corrigeer dit invoerveld en probeer dezelfde toolcall opnieuw.",
          })
        ),
      });
    }

    const input = normalizedParse.data;
    const normalizedArgs = summarizeNormalizedCreateArgs(input);
    const nextArgsTemplate = buildCreateSectionArgsTemplate({
      ...input,
      ...normalizedArgs,
    });

    if (!input.themeId && !input.themeRole) {
      return buildCreateSectionRepairResponse({
        message:
          "Geef aan op welk thema je deze nieuwe section wilt schrijven via themeRole of themeId.",
        errorCode: "missing_theme_target",
        nextAction: "provide_theme_target",
        retryMode: "same_request_with_theme_target",
        normalizedArgs,
        nextArgsTemplate,
        errors: [
          buildCreateSectionError({
            path: ["themeRole"],
            problem:
              "Er ontbreekt een expliciet theme target. Deze tool kiest nooit stilzwijgend een theme.",
            fixSuggestion:
              "Voeg themeRole of themeId toe, bijvoorbeeld themeRole='main' of themeId=123456789.",
          }),
        ],
      });
    }

    if (!input.key) {
      return buildCreateSectionRepairResponse({
        message:
          "Geef exact aan welk nieuw sectionbestand gemaakt moet worden, bijvoorbeeld sections/review-replica.liquid.",
        errorCode: "missing_section_key",
        nextAction: "provide_section_key",
        retryMode: "same_request_with_section_key",
        normalizedArgs,
        nextArgsTemplate,
        errors: [
          buildCreateSectionError({
            path: ["key"],
            problem:
              "De create-flow mist een exact sectionbestand. Deze tool raadt nooit zelf een vaag bestandspad.",
            fixSuggestion:
              "Voeg key='sections/<handle>.liquid' toe of gebruik handle='review-replica'.",
          }),
        ],
      });
    }

    if (!SECTION_KEY_PATTERN.test(input.key)) {
      return buildCreateSectionRepairResponse({
        message:
          "Nieuwe sections mogen alleen naar sections/<handle>.liquid schrijven.",
        errorCode: "invalid_section_key",
        nextAction: "fix_section_key",
        normalizedArgs,
        nextArgsTemplate,
        errors: [
          buildCreateSectionError({
            path: ["key"],
            problem: `Bestand '${input.key}' is geen geldig nieuw section-pad.`,
            fixSuggestion:
              "Gebruik exact een pad als sections/review-replica.liquid.",
            suggestedReplacement: "sections/<new-section>.liquid",
          }),
        ],
      });
    }

    if (typeof input.liquid !== "string" || input.liquid.trim().length === 0) {
      return buildCreateSectionRepairResponse({
        message:
          "Deze create-flow mist de volledige Liquid-inhoud van de nieuwe section.",
        errorCode: "missing_section_liquid",
        nextAction: "provide_complete_section_liquid",
        retryMode: "same_request_with_section_liquid",
        normalizedArgs,
        nextArgsTemplate,
        errors: [
          buildCreateSectionError({
            path: ["liquid"],
            problem:
              "Er ontbreekt een volledige value/content/liquid payload voor de nieuwe section.",
            fixSuggestion:
              "Stuur de complete sections/<handle>.liquid inhoud mee via value, content of liquid.",
          }),
        ],
      });
    }

    const shopifyClient = requireShopifyClient(context);
    let themeSectionContext = null;
    let sectionBlueprint = null;
    const internalWarnings = [];

    try {
      const existingResult = await getThemeFiles(shopifyClient, API_VERSION, {
        themeId: input.themeId,
        themeRole: input.themeRole,
        keys: [input.key],
        includeContent: false,
      });
      const existingFile = existingResult.files?.find((file) => file.key === input.key);
      if (existingFile && !existingFile.missing && existingFile.found !== false) {
        return buildCreateSectionRepairResponse({
          status: "inspection_failed",
          message:
            `Nieuwe section-create geblokkeerd: '${input.key}' bestaat al in het doeltheme. Gebruik een edit/patch-flow in plaats van create.`,
          errorCode: "existing_section_key_conflict",
          normalizedArgs,
          nextAction: "switch_to_edit_flow",
          retryMode: "switch_tool_after_fix",
          nextTool: "plan-theme-edit",
          nextArgsTemplate: {
            ...(input.themeId !== undefined ? { themeId: input.themeId } : {}),
            ...(input.themeRole ? { themeRole: input.themeRole } : {}),
            intent: "existing_edit",
            template: inferTemplateSurfaceFromSectionLiquid(input.liquid),
            targetFile: input.key,
            query: input.key,
          },
          errors: [
            buildCreateSectionError({
              path: ["key"],
              problem:
                `Bestand '${input.key}' bestaat al. create-theme-section mag geen bestaande section overschrijven.`,
              fixSuggestion:
                "Gebruik plan-theme-edit met intent='existing_edit' en schrijf daarna via patch-theme-file of draft-theme-artifact mode='edit'.",
            }),
          ],
        });
      }
    } catch (error) {
      internalWarnings.push(
        `Kon niet vooraf controleren of '${input.key}' al bestaat in het doeltheme: ${error.message}`
      );
    }

    try {
      const planningResult = await planThemeEdit(shopifyClient, API_VERSION, {
        themeId: input.themeId,
        themeRole: input.themeRole,
        intent: "new_section",
        template: inferTemplateSurfaceFromSectionLiquid(input.liquid),
        query: input.key,
      });

      themeSectionContext = planningResult?.themeContext || null;
      sectionBlueprint = planningResult?.sectionBlueprint || null;
      if (!themeSectionContext) {
        internalWarnings.push(
          "Kon geen compacte theme-context afleiden vóór create-validatie; de write-flow valt terug op generieke section-validatie."
        );
      }
    } catch (error) {
      internalWarnings.push(
        `Kon geen compacte theme-context afleiden vóór create-validatie: ${error.message}`
      );
    }

    const result = await draftThemeArtifact.execute(
      {
        themeId: input.themeId,
        themeRole: input.themeRole,
        mode: "create",
        isStandalone: input.isStandalone,
        files: [
          {
            key: input.key,
            value: input.liquid,
          },
        ],
      },
      {
        ...context,
        themeSectionContext,
        sectionBlueprint,
        themeContextWarnings: internalWarnings,
      }
    );

    if (result && typeof result === "object" && result.success === false) {
      return {
        ...result,
        ...(internalWarnings.length > 0
          ? {
              warnings: Array.from(
                new Set([...(result.warnings || []), ...internalWarnings])
              ),
            }
          : {}),
        ...(themeSectionContext && !result.themeContext
          ? { themeContext: themeSectionContext }
          : {}),
        ...(sectionBlueprint && !result.sectionBlueprint
          ? { sectionBlueprint }
          : {}),
        nextTool: "create-theme-section",
        nextArgsTemplate,
      };
    }

    if (result && typeof result === "object" && internalWarnings.length > 0) {
      return {
        ...result,
        warnings: Array.from(
          new Set([...(result.warnings || []), ...internalWarnings])
        ),
        ...(themeSectionContext && !result.themeContext
          ? { themeContext: themeSectionContext }
          : {}),
        ...(sectionBlueprint && !result.sectionBlueprint
          ? { sectionBlueprint }
          : {}),
      };
    }

    if (result && typeof result === "object") {
      return {
        ...result,
        ...(themeSectionContext && !result.themeContext
          ? { themeContext: themeSectionContext }
          : {}),
        ...(sectionBlueprint && !result.sectionBlueprint
          ? { sectionBlueprint }
          : {}),
      };
    }

    return result;
  },
};

export {
  CreateThemeSectionInputSchema,
  CreateThemeSectionNormalizedSchema,
  createThemeSectionTool,
};
