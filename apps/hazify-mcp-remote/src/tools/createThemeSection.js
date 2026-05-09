import { z } from "zod";
import { requireShopifyClient } from "./_context.js";
import {
  draftThemeArtifact,
  inspectThemeSectionCreatePreflight,
} from "./draftThemeArtifact.js";
import { planThemeEdit } from "../lib/themePlanning.js";
import { getThemeFiles } from "../lib/themeFiles.js";
import {
  buildCodegenContract,
  buildSectionRepairPrompt,
  normalizeShopifySectionLiquidForWrite,
  preflightSectionLiquid,
  repairTrailingSchemaBlockClosure,
} from "../lib/themeCodegenContract.js";
import {
  buildSectionContract,
  buildSingleMediaStorySection,
  classifyArchetype,
  detectGeneratedArchetype,
  validateContractAgainstPrompt,
} from "../lib/themePromptFidelity.js";
import {
  buildSectionGenerationBlueprint,
  inferTemplateSurfaceFromSectionLiquid,
} from "../lib/themeSectionContext.js";
import {
  getRecentThemeRead,
  getThemeEditMemory,
  haveRecentThemeReads,
  rememberThemeWrite,
  themeTargetsCompatible,
} from "../lib/themeEditMemory.js";
import { hydrateThemeReadsWithRepresentativeFallback } from "../lib/themeReadHydration.js";
import {
  extractThemeToolSummary,
  extractThemeToolVisualBrief,
  inferSingleThemeFile,
  inferThemeTargetFromSummary,
  mergeThemeToolBrief,
} from "./_themeToolCompatibility.js";

const API_VERSION = process.env.SHOPIFY_API_VERSION || "2026-01";
const ThemeRoleSchema = z.enum(["main"]);
const SummaryFieldSchema = z.string().max(4000).optional();
const PlannerHandoffSchema = z.object({}).passthrough();
const ResponseVerbositySchema = z.enum(["compact", "debug"]);
const VisualBriefSchema = z
  .union([z.string().max(4000), z.record(z.unknown())])
  .optional();
const SECTION_KEY_PATTERN = /^sections\/[A-Za-z0-9._-]+\.liquid$/;
const SECTION_HANDLE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9-]*$/;
const FOLLOW_UP_REFINEMENT_PATTERNS = [
  /\b(pixel[- ]?perfect|pixelperfect)\b/i,
  /\b(polish|polished|refine|refined|finesse|tighten)\b/i,
  /\b(verbeter|verfijn|optimaliseer|maak.*beter|maak.*exact)\b/i,
  /\b(improve|upgrade|restyle|redesign|exact(?:er|ly)?|closer)\b/i,
  /\b(mobile|desktop|spacing|typography|icons?|badge|sachet|mockup)\b/i,
];

const normalizeCreateThemeSectionInput = (rawInput) => {
  if (!rawInput || typeof rawInput !== "object" || Array.isArray(rawInput)) {
    return rawInput;
  }

  const summary = extractThemeToolSummary(rawInput);
  const explicitKey =
    typeof rawInput.key === "string" && rawInput.key.trim()
      ? rawInput.key.trim()
      : typeof (rawInput.targetFile ?? rawInput.target_file) === "string" &&
            String(rawInput.targetFile ?? rawInput.target_file).trim()
        ? String(rawInput.targetFile ?? rawInput.target_file).trim()
        : null;
  const explicitHandle =
    typeof rawInput.handle === "string" && rawInput.handle.trim()
      ? rawInput.handle.trim()
      : typeof (rawInput.sectionHandle ?? rawInput.section_handle) === "string" &&
            String(rawInput.sectionHandle ?? rawInput.section_handle).trim()
        ? String(rawInput.sectionHandle ?? rawInput.section_handle).trim()
        : null;

  let normalized = {
    themeId: rawInput.themeId ?? rawInput.theme_id,
    themeRole:
      rawInput.themeRole ?? rawInput.theme_role ?? rawInput.role,
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
    isStandalone: rawInput.isStandalone ?? rawInput.is_standalone,
    plannerHandoff: rawInput.plannerHandoff ?? rawInput.planner_handoff,
    verbosity: rawInput.verbosity,
    includeContracts: rawInput.includeContracts ?? rawInput.include_contracts,
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
    theme_id: z
      .string()
      .or(z.number())
      .optional()
      .describe("Compat alias van themeId voor generieke wrappers."),
    themeRole: ThemeRoleSchema
      .optional()
      .describe("Target theme role. Alleen 'main' is role-only toegestaan; gebruik themeId voor development/unpublished/demo themes."),
    theme_role: ThemeRoleSchema
      .optional()
      .describe("Compat alias van themeRole voor generieke wrappers. Alleen 'main' is role-only toegestaan."),
    role: ThemeRoleSchema
      .optional()
      .describe("Compat alias van themeRole voor generieke wrappers. Alleen 'main' is role-only toegestaan."),
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
    target_file: z
      .string()
      .min(1)
      .optional()
      .describe("Compat alias van targetFile voor generieke wrappers."),
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
    section_handle: z
      .string()
      .min(1)
      .optional()
      .describe("Compat alias van sectionHandle voor generieke wrappers."),
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
    value_summary: SummaryFieldSchema.describe(
      "Compat placeholderveld voor wrappers die abusievelijk een samenvatting meesturen. Dit vervangt nooit echte Liquid-inhoud."
    ),
    content_summary: SummaryFieldSchema.describe(
      "Compat placeholderveld voor wrappers die abusievelijk een samenvatting meesturen. Dit vervangt nooit echte Liquid-inhoud."
    ),
    liquid_summary: SummaryFieldSchema.describe(
      "Compat placeholderveld voor wrappers die abusievelijk een samenvatting meesturen. Dit vervangt nooit echte Liquid-inhoud."
    ),
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
    visualBrief: VisualBriefSchema.describe(
      "Optionele visuele analyse van een screenshot/referentie. Gebruik dit voor facts zoals feature rows, slider counter, peek cards, active-card styling of media anchors."
    ),
    visual_brief: VisualBriefSchema.describe("Compat alias van visualBrief."),
    referenceAnalysis: VisualBriefSchema.describe(
      "Compat alias van visualBrief voor screenshot-derived facts."
    ),
    reference_analysis: VisualBriefSchema.describe(
      "Compat alias van referenceAnalysis."
    ),
    designBrief: VisualBriefSchema.describe("Compat alias van visualBrief."),
    design_brief: VisualBriefSchema.describe("Compat alias van designBrief."),
    isStandalone: z
      .boolean()
      .optional()
      .describe("Optionele hint voor standalone section-workflows."),
    is_standalone: z
      .boolean()
      .optional()
      .describe("Compat alias van isStandalone voor generieke wrappers."),
    plannerHandoff: PlannerHandoffSchema.optional().describe(
      "Optionele planner-handoff uit plan-theme-edit met volledige brief, reference signals en required reads. Gebruik dit om write-context portable te houden over meerdere toolcalls."
    ),
    planner_handoff: PlannerHandoffSchema.optional().describe(
      "Compat alias van plannerHandoff voor generieke wrappers."
    ),
    verbosity: ResponseVerbositySchema
      .optional()
      .describe("Optioneel. Default is compact voor failure responses; gebruik 'debug' voor volledige planner/codegen/theme payloads."),
    includeContracts: z
      .boolean()
      .optional()
      .describe("Opt-in om volledige planner/codegen/theme context in failure responses terug te krijgen."),
    include_contracts: z
      .boolean()
      .optional()
      .describe("Compat alias van includeContracts."),
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
    plannerHandoff: PlannerHandoffSchema.optional(),
    verbosity: ResponseVerbositySchema.optional(),
    includeContracts: z.boolean().optional(),
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
  ...(input.verbosity ? { verbosity: input.verbosity } : {}),
  ...(input.includeContracts === true ? { includeContracts: true } : {}),
  hasLiquid: typeof input.liquid === "string" && input.liquid.length > 0,
  hasPlannerHandoff:
    input.plannerHandoff &&
    typeof input.plannerHandoff === "object" &&
    Object.keys(input.plannerHandoff).length > 0,
});

const uniqueStrings = (values) =>
  Array.from(new Set((values || []).filter(Boolean)));

const isSectionReadKey = (key) =>
  /^sections\/[A-Za-z0-9._-]+\.liquid$/.test(String(key || ""));

const getRepresentativeFallbackReadKeys = (requiredReads = [], readKeys = []) => {
  const explicit = uniqueStrings(
    (Array.isArray(requiredReads) ? requiredReads : [])
      .filter((entry) => /representative/i.test(String(entry?.reason || "")))
      .map((entry) => entry?.key)
  );
  return explicit.length > 0
    ? explicit
    : uniqueStrings(readKeys.filter(isSectionReadKey));
};

const buildCreateSectionError = ({
  path,
  problem,
  fixSuggestion,
  suggestedReplacement,
  issueCode,
  details,
  diagnostics,
}) => ({
  path,
  problem,
  fixSuggestion,
  ...(issueCode ? { issueCode } : {}),
  ...(suggestedReplacement !== undefined ? { suggestedReplacement } : {}),
  ...(details !== undefined ? { details } : {}),
  ...(diagnostics !== undefined ? { diagnostics } : {}),
});

const normalizeCreateSectionPreflightIssue = (issue = {}, stage = "preflight") => {
  const issueCode = issue.issueCode || issue.code || "preflight_issue";
  return {
    stage,
    ...(issue.code ? { code: issue.code } : {}),
    issueCode,
    path: Array.isArray(issue.path) ? issue.path : [],
    problem: issue.problem || issue.message || "Fix the reported preflight issue.",
    message: issue.message || issue.problem || "Fix the reported preflight issue.",
    fixSuggestion: issue.fixSuggestion || "Apply the smallest targeted fix and retry.",
    ...(issue.suggestedReplacement !== undefined
      ? { suggestedReplacement: issue.suggestedReplacement }
      : {}),
    ...(issue.details !== undefined ? { details: issue.details } : {}),
    ...(issue.diagnostics !== undefined ? { diagnostics: issue.diagnostics } : {}),
    ...(issue.severity ? { severity: issue.severity } : {}),
  };
};

const dedupeCreateSectionIssues = (issues = []) => {
  const seen = new Set();
  return (issues || []).filter((issue) => {
    const fingerprint = JSON.stringify([
      issue.issueCode || issue.code,
      issue.stage,
      issue.path || [],
      issue.problem || issue.message,
    ]);
    if (seen.has(fingerprint)) {
      return false;
    }
    seen.add(fingerprint);
    return true;
  });
};

const shouldIncludeCreateDebugPayloads = ({
  verbosity = "compact",
  includeContracts = false,
} = {}) => includeContracts === true || verbosity === "debug";

const summarizeCreateDebugPayloadOmissions = ({
  codegenContract,
  themeContext,
  sectionBlueprint,
  plannerHandoff,
} = {}) =>
  [
    codegenContract ? "codegenContract" : null,
    themeContext ? "themeContext" : null,
    sectionBlueprint ? "sectionBlueprint" : null,
    plannerHandoff ? "plannerHandoff" : null,
  ].filter(Boolean);

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
  newFileSuggestions,
  alternativeNextArgsTemplates,
  writeTool,
  writeArgsTemplate,
  plannerHandoff,
  requiredToolNames,
  repairSequence,
  repairPrompt,
  codegenContract,
  preflight,
  verbosity = "compact",
  includeContracts = false,
}) => {
  const includeDebugPayloads = shouldIncludeCreateDebugPayloads({
    verbosity: normalizedArgs?.verbosity || verbosity,
    includeContracts: includeContracts || normalizedArgs?.includeContracts === true,
  });
  const omittedDebugPayloads = includeDebugPayloads
    ? []
    : summarizeCreateDebugPayloadOmissions({
        codegenContract,
        themeContext,
        sectionBlueprint,
        plannerHandoff,
      });
  const semanticTaskFailureCodes = new Set([
    "prompt_fidelity_failed",
    "planner_contract_conflict",
    "prompt_coverage_partial",
    "section_recipe_missing_theme_container",
  ]);
  const failureCodes = (errors || [])
    .map((issue) => issue.issueCode || issue.code || issue.errorCode)
    .filter(Boolean);
  const schemaSuccess =
    semanticTaskFailureCodes.has(errorCode) ||
    (preflight?.promptFidelity?.schemaSuccess === true &&
      failureCodes.length > 0 &&
      failureCodes.every((code) => semanticTaskFailureCodes.has(code)));

  return {
    success: false,
    status,
    writeApplied: false,
    technicalSuccess: false,
    schemaSuccess,
    taskSuccess: false,
    ...(preflight?.promptFidelity
      ? {
          promptFidelity: preflight.promptFidelity.promptFidelity,
          expectedArchetype: preflight.promptFidelity.expectedArchetype,
          detectedArchetype:
            preflight.promptFidelity.actualArchetypeDetected ||
            preflight.promptFidelity.generatedArchetype,
          missingRequiredFeatures:
            preflight.promptFidelity.missingRequiredFeatures ||
            preflight.promptFidelity.missingAnchors ||
            [],
          unexpectedFeatures:
            preflight.promptFidelity.unexpectedFeatures ||
            preflight.promptFidelity.unexpectedArtifacts ||
            [],
        }
      : {}),
    message,
    errorCode,
    retryable: true,
    nextAction,
    retryMode,
    nextTool,
    normalizedArgs,
    warnings,
    errors,
    ...(repairPrompt ? { repairPrompt } : {}),
    ...(includeDebugPayloads && codegenContract ? { codegenContract } : {}),
    ...(preflight ? { preflight } : {}),
    ...(includeDebugPayloads && themeContext ? { themeContext } : {}),
    ...(includeDebugPayloads && sectionBlueprint ? { sectionBlueprint } : {}),
    ...(sectionBlueprint?.completionPolicy
      ? { completionPolicy: sectionBlueprint.completionPolicy }
      : {}),
    ...(omittedDebugPayloads.length > 0
      ? {
          debugPayloadsOmitted: omittedDebugPayloads,
          debugPayloadHint:
            "Retry with verbosity='debug' or includeContracts=true to include full planner/codegen/theme context.",
        }
      : {}),
    ...(Array.isArray(newFileSuggestions) && newFileSuggestions.length > 0
      ? { newFileSuggestions }
      : {}),
    ...(alternativeNextArgsTemplates
      ? { alternativeNextArgsTemplates }
      : {}),
    ...(writeTool ? { writeTool } : {}),
    ...(writeArgsTemplate ? { writeArgsTemplate } : {}),
    ...(includeDebugPayloads && plannerHandoff ? { plannerHandoff } : {}),
    ...(Array.isArray(requiredToolNames) && requiredToolNames.length > 0
      ? { requiredToolNames }
      : {}),
    ...(Array.isArray(repairSequence) && repairSequence.length > 0
      ? { repairSequence }
      : {}),
    ...(nextArgsTemplate ? { nextArgsTemplate } : {}),
  };
};

const buildCreateSectionArgsTemplate = (input = {}) => ({
  ...(input.themeId !== undefined ? { themeId: input.themeId } : {}),
  ...(input.themeRole ? { themeRole: input.themeRole } : {}),
  key: input.key || "sections/<new-section>.liquid",
  liquid:
    "<complete Shopify Liquid section with the final requested styling and valid {% schema %}; do not send a rough baseline>",
  ...(input.isStandalone ? { isStandalone: true } : {}),
});

const buildAlternateSectionKeySuggestions = (key) => {
  const normalized = String(key || "").trim();
  if (!SECTION_KEY_PATTERN.test(normalized)) {
    return [];
  }
  const handle = normalized.replace(/^sections\//, "").replace(/\.liquid$/, "");
  return Array.from(
    new Set(
      [`sections/${handle}-v2.liquid`, `sections/${handle}-alt.liquid`].filter(
        (candidate) => candidate !== normalized
      )
    )
  );
};

const looksLikeFollowUpRefinement = (value) =>
  FOLLOW_UP_REFINEMENT_PATTERNS.some((pattern) => pattern.test(String(value || "")));

const buildExistingEditContinuation = ({
  input,
  planningQuery,
  recentPlan,
  plannerHandoff,
}) => {
  const explicitThemeTarget = {
    ...(input.themeId !== undefined ? { themeId: input.themeId } : {}),
    ...(input.themeRole ? { themeRole: input.themeRole } : {}),
  };
  const fallbackTemplate =
    recentPlan?.template ||
    plannerHandoff?.template ||
    inferTemplateSurfaceFromSectionLiquid(input.liquid);
  const editPlanArgsTemplate = {
    ...explicitThemeTarget,
    intent: "existing_edit",
    ...(fallbackTemplate ? { template: fallbackTemplate } : {}),
    targetFile: input.key,
    query: planningQuery,
  };
  const editWriteArgsTemplate = {
    ...explicitThemeTarget,
    mode: "edit",
    files: [
      {
        key: input.key,
        value: "<full rewritten file content>",
      },
    ],
  };
  const editPlannerHandoff = {
    brief: planningQuery,
    plannerQuery: planningQuery,
    intent: "existing_edit",
    template: fallbackTemplate || null,
    themeTarget: {
      themeId:
        input.themeId === undefined || input.themeId === null
          ? null
          : Number(input.themeId),
      themeRole: String(input.themeRole || "").trim() || null,
    },
    targetFile: input.key,
    themeContext:
      recentPlan?.themeContext && typeof recentPlan.themeContext === "object"
        ? recentPlan.themeContext
        : plannerHandoff?.themeContext && typeof plannerHandoff.themeContext === "object"
          ? plannerHandoff.themeContext
          : null,
    sectionBlueprint:
      recentPlan?.sectionBlueprint && typeof recentPlan.sectionBlueprint === "object"
        ? recentPlan.sectionBlueprint
        : plannerHandoff?.sectionBlueprint &&
            typeof plannerHandoff.sectionBlueprint === "object"
          ? plannerHandoff.sectionBlueprint
          : null,
    requiredReadKeys: [input.key],
    readTool: "plan-theme-edit",
    writeTool: "draft-theme-artifact",
    requiredToolNames: [
      "plan-theme-edit",
      "get-theme-file",
      "get-theme-files",
      "draft-theme-artifact",
    ],
    nextWriteKeys: [input.key],
    newFileSuggestions: buildAlternateSectionKeySuggestions(input.key),
  };

  return {
    explicitThemeTarget,
    fallbackTemplate,
    editPlanArgsTemplate,
    editWriteArgsTemplate,
    editPlannerHandoff,
  };
};

const buildRefinementRouteMetadata = ({
  input,
  planningQuery,
  recentPlan,
  plannerHandoff,
}) => {
  const {
    editPlanArgsTemplate,
    editWriteArgsTemplate,
    editPlannerHandoff,
  } = buildExistingEditContinuation({
    input,
    planningQuery,
    recentPlan,
    plannerHandoff,
  });

  return {
    recommendedFollowUpTool: "plan-theme-edit",
    recommendedFollowUpArgsTemplate: editPlanArgsTemplate,
    recommendedFollowUpWriteTool: "draft-theme-artifact",
    recommendedFollowUpWriteArgsTemplate: editWriteArgsTemplate,
    followUpPlannerHandoff: editPlannerHandoff,
    followUpRepairSequence: [
      {
        tool: "plan-theme-edit",
        purpose: "refine_existing_section",
        argsTemplate: editPlanArgsTemplate,
      },
      {
        tool: "get-theme-file",
        purpose: "read_existing_section_before_edit",
        argsTemplate: {
          ...(input.themeId !== undefined ? { themeId: input.themeId } : {}),
          ...(input.themeRole ? { themeRole: input.themeRole } : {}),
          key: input.key,
          includeContent: true,
        },
      },
      {
        tool: "draft-theme-artifact",
        purpose: "apply_existing_edit",
        argsTemplate: editWriteArgsTemplate,
      },
    ],
  };
};

const createThemeSectionTool = {
  name: "create-theme-section",
  title: "Create Theme Section",
  description:
    "Primary write tool for a brand-new Shopify section file in sections/<handle>.liquid. Use this as the first write for a new section. Never use this tool to modify a section file that already exists, even if that file was just created earlier in the same conversation. Do not use apply-theme-draft first. Required: explicit themeId or themeRole='main', one section file path or handle, and the complete Liquid file with a valid {% schema %}. Use themeId for development/unpublished/demo themes. After plan-theme-edit, pass the compact plannerHandoff when available and keep screenshot/URL facts in visualBrief/referenceAnalysis/designBrief so exact replica signals survive stateless clients. The tool prefers exact nextReadKeys and auto-hydrates them when safely derivable; for net-new standalone sections, a missing representative planner read can be replaced by an existing section/snippet/layout read with includeContent=true and is returned as substituteRepresentativeRead instead of blocking on stale context. Non-representative required context remains protected. Preflight bundles deterministic codegen, recipe, editor-contract and local create issues before write; default failure responses stay compact and omit full planner/codegen/theme payloads unless verbosity='debug' or includeContracts=true. For screenshot/design-replica requests: lever de finale styling in de eerste create-write, niet eerst een veilige baseline gevolgd door een vraag of het pixel-perfect moet worden gemaakt. Screenshot-only replica's zonder losse bron-assets mogen nu wel renderbare demo-media of gestileerde media shells gebruiken zolang de layout, styling en merchant settings exact blijven gericht op de referentie. Exact-match comparison/shell replica's moeten daarnaast hun decoratieve anchors, ster-rating en vergelijking-iconografie direct goed meenemen; feature-54-achtige feature/media sections moeten grote media plus icon rows behouden, en Slider 7-achtige sliders moeten counter, peek cards, active state en echte controls bevatten. Als een gewone chatclient per ongeluk nog eens create-theme-section op exact dezelfde net aangemaakte section-key aanroept voor een refinement, kan de runtime die follow-up nu veilig omzetten naar een existing_edit rewrite in plaats van opnieuw op create vast te lopen.",
  docsDescription:
    "Maak een nieuwe Shopify section in `sections/<handle>.liquid`. Dit is de primaire eerste write-tool voor nieuwe sections en een duidelijke wrapper rond de guarded create-flow. Gebruik deze dus vóór `apply-theme-draft`; die tool is alleen bedoeld voor een bestaand opgeslagen draftId. Gebruik deze tool nooit om een bestaand section-bestand te wijzigen, ook niet als dat bestand net in dezelfde sessie is aangemaakt. Zodra de target-key al bestaat moet de flow omschakelen naar `plan-theme-edit intent='existing_edit'` en daarna naar `draft-theme-artifact mode=\"edit\"` of `patch-theme-file`. Voor gewone stateless chatclients zet de runtime een herhaalde create op exact dezelfde net aangemaakte section-key nu ook veilig om naar een existing_edit rewrite wanneer duidelijk is dat het om een refinement-follow-up gaat. Vereist: expliciet `themeId` of `themeRole='main'`, exact één section-bestand (`key` of `handle`) en de volledige Liquid-inhoud. Gebruik themeId voor development/unpublished/demo themes. Geef na `plan-theme-edit` de compacte `plannerHandoff` door wanneer die beschikbaar is, en geef screenshot-, URL- of referentie-analyse mee via `visualBrief`, `referenceAnalysis` of `designBrief` zodat stateless clients geen replica-context verliezen. Lees na `plan-theme-edit` bij voorkeur eerst de exacte `nextReadKeys` in; wanneer die planner-reads veilig exact afleidbaar zijn probeert deze tool ze nu eerst automatisch met `includeContent=true` te hydrateren. Als zo'n planner-read alleen representatieve theme-context voor een net-new standalone section was en ontbreekt in het doeltheme, accepteert de tool een bestaande section/snippet/layout-read op hetzelfde theme als `substituteRepresentativeRead` in plaats van te blijven blokkeren op de stale key. Wanneer er helemaal geen fallback bestaat, gaat de net-new standalone create door met generieke Shopify OS 2.0-validatie en een waarschuwing; exacte contextreads voor bestaande edits/native flows blijven hard beschermd. Zo blijft de generatie afgestemd op bestaande wrappers, helpers, schaalconventies en inherited classes van het doeltheme zonder willekeurige section-creatie te blokkeren op een niet-bestaand voorbeeldbestand. De tool normaliseert veilige compat-velden zoals `targetFile`, `content`, `liquid` en `_tool_input_summary`, maar vrije summary-tekst mag nooit de daadwerkelijke code vervangen. Intern leidt de tool eerst compacte theme-context én section-category metadata af via `plan-theme-edit`-achtige logica of recente planner-memory, zodat create-validatie niet blind op hero-schaal aannames of parser-onveilige JS/Liquid patronen schrijft. De preflight bundelt deterministische codegen-, recipe-, editor-contract- en lokale create-fouten vóór de write; failure responses blijven standaard compact en laten zware planner/codegen/theme payloads weg tenzij `verbosity='debug'` of `includeContracts=true` wordt gebruikt. Exacte screenshot/design-replica prompts blijven daardoor in precision-first mode wanneer dezelfde flow net al gepland was. Voor zulke replica-prompts verwacht deze tool directe finale styling in de eerste create-write; vraag dus niet eerst om extra toestemming om het daarna pixel-perfect te maken. Als de referentie alleen screenshot-gedreven is en er geen losse bron-assets zijn, mag de eerste write nu wel renderbare demo-media of een gestileerde media shell gebruiken zolang de compositie, styling en merchant-editable settings trouw aan de referentie blijven. Bij exact-match comparison/shell replica's moeten ook onderscheidende decoratieve anchors zoals floating productmedia, badges/seals, echte ster-ratings, vergelijking-iconografie en de juiste outer-shell strategie in de eerste write aanwezig zijn; te generieke tabel-baselines, blokjes als sterren of dubbele background-shells worden nu expliciet teruggestuurd door de validator. Feature-54-achtige replica's moeten als feature/media-list worden behandeld met grote productmedia en icon-feature-rows. Slider 7-achtige replica's moeten counter, peek-neighbour cards, active-slide contrast, zes preset-slides en echte slidercontrols bevatten. Daarna gebruikt deze tool `draft-theme-artifact mode=\"create\"`, inclusief lokale schema-inspectie, theme-check lint, theme-scale sanity checks, interactieve/media guardrails en preview-write validatie.",
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

    let input = normalizedParse.data;
    const summary = mergeThemeToolBrief(
      extractThemeToolSummary(rawInput),
      extractThemeToolVisualBrief(rawInput)
    );
    const normalizedArgs = summarizeNormalizedCreateArgs(input);
    const nextArgsTemplate = buildCreateSectionArgsTemplate({
      ...input,
      ...normalizedArgs,
    });

    if (!input.themeId && !input.themeRole) {
      return buildCreateSectionRepairResponse({
        message:
          "Geef aan op welk thema je deze nieuwe section wilt schrijven via themeRole='main' of een exact themeId. Gebruik themeId voor development/unpublished/demo themes.",
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
      const fallbackClassification = classifyArchetype({
        prompt:
          summary ||
          input.plannerHandoff?.brief ||
          input.plannerHandoff?.plannerQuery ||
          input.key,
      });
      if (fallbackClassification.archetype === "single_media_story") {
        input = {
          ...input,
          liquid: buildSingleMediaStorySection({ handle: input.key }),
        };
      }
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
              "Stuur de complete sections/<handle>.liquid inhoud mee via value, content of liquid. Velden zoals liquid_summary of andere samenvattingen zijn niet genoeg.",
          }),
        ],
      });
    }

    const liquidNormalizationWarnings = [];
    const normalizedLiquid = normalizeShopifySectionLiquidForWrite(input.liquid);
    const repairedLiquid = repairTrailingSchemaBlockClosure(normalizedLiquid);
    if (repairedLiquid.changed) {
      input = {
        ...input,
        liquid: repairedLiquid.value,
      };
      liquidNormalizationWarnings.push(
        ...(repairedLiquid.repairs || []).includes("appended_missing_trailing_endschema")
          ? "Liquid schema-tag normalisatie: ontbrekende trailing {% endschema %} veilig toegevoegd omdat de schema JSON tot einde bestand valide was."
          : "Liquid schema-tag normalisatie toegepast vóór validatie."
      );
    } else if (normalizedLiquid !== input.liquid) {
      input = {
        ...input,
        liquid: normalizedLiquid,
      };
      liquidNormalizationWarnings.push(
        "Liquid schema-tag normalisatie toegepast vóór validatie."
      );
    }

    const shopifyClient = requireShopifyClient(context);
    const memoryState = getThemeEditMemory(context);
    const providedPlannerHandoff =
      input.plannerHandoff && typeof input.plannerHandoff === "object"
        ? input.plannerHandoff
        : null;
    const recentPlan =
      memoryState?.lastPlan &&
      memoryState.lastPlan.intent === "new_section" &&
      themeTargetsCompatible(memoryState.themeTarget, {
        themeId: input.themeId,
        themeRole: input.themeRole,
      })
        ? memoryState.lastPlan
        : null;
    const plannerHandoff =
      providedPlannerHandoff ||
      (recentPlan?.plannerHandoff && typeof recentPlan.plannerHandoff === "object"
        ? recentPlan.plannerHandoff
        : null);
    const plannerHandoffThemeTarget =
      plannerHandoff?.themeTarget && typeof plannerHandoff.themeTarget === "object"
        ? plannerHandoff.themeTarget
        : null;
    const plannerHandoffTargetCompatible =
      !plannerHandoffThemeTarget ||
      themeTargetsCompatible(plannerHandoffThemeTarget, {
        themeId: input.themeId,
        themeRole: input.themeRole,
      });
    const planningQuery =
      summary ||
      plannerHandoff?.brief ||
      plannerHandoff?.plannerQuery ||
      recentPlan?.query ||
      input.key;
    let themeSectionContext = null;
    let sectionBlueprint = null;
    const internalWarnings = [...liquidNormalizationWarnings];
    const plannerArchetype =
      plannerHandoff?.archetype ||
      plannerHandoff?.codegenContract?.archetype ||
      plannerHandoff?.codegenContract?.sectionDataContract?.archetype ||
      plannerHandoff?.codegenContract?.sectionKind ||
      null;
    if (plannerArchetype) {
      const promptClassification = classifyArchetype({
        prompt: planningQuery,
      });
      const contractCheck = validateContractAgainstPrompt({
        contract: buildSectionContract({
          archetype: plannerArchetype,
          facts: promptClassification.facts,
          prompt: planningQuery,
        }),
        promptFacts: promptClassification.facts,
      });
      if (!contractCheck.ok) {
        return buildCreateSectionRepairResponse({
          status: "inspection_failed",
          message: contractCheck.errors[0]?.message || "Planner contract conflicts with user intent.",
          errorCode: "planner_contract_conflict",
          nextAction: "replan_with_archetype_override",
          retryMode: "replan_with_archetype_override",
          nextTool: "plan-theme-edit",
          normalizedArgs,
          nextArgsTemplate: {
            themeId: input.themeId,
            themeRole: input.themeRole,
            intent: "new_section",
            query: planningQuery,
            archetypeOverride: "single_media_story",
            blockModelOverride: "none",
            interactionKindOverride: "none",
          },
          errors: contractCheck.errors.map((entry) =>
            buildCreateSectionError({
              path: ["plannerHandoff", "archetype"],
              problem: entry.message,
              fixSuggestion:
                "Corrigeer het plannercontract met archetypeOverride='single_media_story' in plaats van logo/card blocks toe te voegen.",
            })
          ),
          warnings: internalWarnings,
        });
      }
    }

    try {
      const existingResult = await getThemeFiles(shopifyClient, API_VERSION, {
        themeId: input.themeId,
        themeRole: input.themeRole,
        keys: [input.key],
        includeContent: false,
      });
      const existingFile = existingResult.files?.find((file) => file.key === input.key);
      if (existingFile && !existingFile.missing && existingFile.found !== false) {
        const alternateKeySuggestions = buildAlternateSectionKeySuggestions(input.key);
        const {
          explicitThemeTarget,
          editPlanArgsTemplate,
          editWriteArgsTemplate,
          editPlannerHandoff,
        } = buildExistingEditContinuation({
          input,
          planningQuery,
          recentPlan,
          plannerHandoff: plannerHandoffTargetCompatible ? plannerHandoff : null,
        });
        const recentlyCreatedSameSection =
          memoryState?.lastCreatedSectionFile === input.key &&
          themeTargetsCompatible(memoryState.themeTarget, {
            themeId: input.themeId,
            themeRole: input.themeRole,
          });
        const recentlyReadSameSection = Boolean(
          getRecentThemeRead(context, {
            key: input.key,
            themeId: input.themeId,
            themeRole: input.themeRole,
            requireContent: true,
          })
        );
        const followUpRefinementRequested =
          looksLikeFollowUpRefinement(summary || planningQuery) ||
          recentlyReadSameSection ||
          plannerHandoff?.intent === "existing_edit";

        if (recentlyCreatedSameSection && followUpRefinementRequested) {
          const autoSwitchWarning =
            "create-theme-section heeft deze follow-up veilig omgezet naar een existing_edit rewrite, omdat dezelfde section net in deze flow is aangemaakt en daarna opnieuw op exact dezelfde key werd verfijnd.";
          const autoSwitchedResult = await draftThemeArtifact.execute(
            {
              ...explicitThemeTarget,
              mode: "edit",
              files: [
                {
                  key: input.key,
                  value: input.liquid,
                },
              ],
            },
            {
              ...context,
              themeSectionContext:
                editPlannerHandoff.themeContext &&
                typeof editPlannerHandoff.themeContext === "object"
                  ? editPlannerHandoff.themeContext
                  : null,
              sectionBlueprint:
                editPlannerHandoff.sectionBlueprint &&
                typeof editPlannerHandoff.sectionBlueprint === "object"
                  ? editPlannerHandoff.sectionBlueprint
                  : null,
              plannerHandoff: editPlannerHandoff,
              themeContextWarnings: [autoSwitchWarning],
            }
          );

          if (autoSwitchedResult && typeof autoSwitchedResult === "object") {
            if (autoSwitchedResult.success === true) {
              rememberThemeWrite(context, {
                themeId: input.themeId,
                themeRole: input.themeRole,
                intent: "existing_edit",
                mode: "edit",
                files: [{ key: input.key }],
              });
            }
            return {
              ...autoSwitchedResult,
              autoSwitchedToEdit: true,
              autoSwitchReason: "recent_same_section_refinement",
              requestedCreateKeyExisted: true,
              originalRequestedTool: "create-theme-section",
              writeToolUsed: "draft-theme-artifact",
              writeModeUsed: "edit",
              warnings: Array.from(
                new Set([...(autoSwitchedResult.warnings || []), autoSwitchWarning])
              ),
              ...buildRefinementRouteMetadata({
                input,
                planningQuery,
                recentPlan,
                plannerHandoff: editPlannerHandoff,
              }),
            };
          }
        }

        return buildCreateSectionRepairResponse({
          status: "inspection_failed",
          message:
            `Nieuwe section-create geblokkeerd: '${input.key}' bestaat al in het doeltheme. Gebruik een edit/patch-flow in plaats van create.`,
          errorCode: "existing_section_key_conflict",
          normalizedArgs,
          nextAction: "choose_edit_or_alternate_key",
          retryMode: "switch_tool_after_fix",
          nextTool: "plan-theme-edit",
          nextArgsTemplate: {
            ...editPlanArgsTemplate,
          },
          writeTool: "draft-theme-artifact",
          writeArgsTemplate: editWriteArgsTemplate,
          plannerHandoff: editPlannerHandoff,
          requiredToolNames: uniqueStrings([
            "plan-theme-edit",
            "get-theme-file",
            "get-theme-files",
            "draft-theme-artifact",
          ]),
          newFileSuggestions: alternateKeySuggestions,
          alternativeNextArgsTemplates:
            {
              editExistingFullRewrite: editWriteArgsTemplate,
              ...(alternateKeySuggestions.length > 0
                ? {
                  createAlternateSection: {
                    ...explicitThemeTarget,
                    key: alternateKeySuggestions[0],
                    liquid: input.liquid,
                    ...(input.isStandalone ? { isStandalone: true } : {}),
                  },
                }
                : {}),
            },
          repairSequence: [
            {
              tool: "plan-theme-edit",
              purpose: "switch_to_existing_edit",
              argsTemplate: editPlanArgsTemplate,
            },
            {
              tool: "get-theme-file",
              purpose: "read_exact_target_or_follow_planner_reads",
              argsTemplate: {
                ...explicitThemeTarget,
                key: input.key,
                includeContent: true,
              },
              note:
                "Als plan-theme-edit meerdere nextReadKeys teruggeeft, gebruik dan get-theme-files met exact die keys.",
            },
            {
              tool: "draft-theme-artifact",
              purpose: "rewrite_existing_file",
              argsTemplate: editWriteArgsTemplate,
              note:
                "Stuur het volledige herschreven bestand of gebruik een letterlijke patch/patches. Gebruik create-theme-section niet opnieuw zodra de key al bestaat.",
            },
          ],
          errors: [
            buildCreateSectionError({
              path: ["key"],
              problem:
                `Bestand '${input.key}' bestaat al. create-theme-section mag geen bestaande section overschrijven.`,
              fixSuggestion:
                alternateKeySuggestions.length > 0
                  ? `Gebruik plan-theme-edit met intent='existing_edit' om het bestaande bestand te wijzigen, of kies een nieuw bestand zoals '${alternateKeySuggestions[0]}' als je toch een aparte nieuwe section wilt.`
                  : "Gebruik plan-theme-edit met intent='existing_edit' en schrijf daarna via patch-theme-file of draft-theme-artifact mode='edit'.",
              suggestedReplacement:
                alternateKeySuggestions.length > 0 ? alternateKeySuggestions[0] : undefined,
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
      themeSectionContext =
        recentPlan?.themeContext && typeof recentPlan.themeContext === "object"
          ? recentPlan.themeContext
          : plannerHandoffTargetCompatible &&
              plannerHandoff?.themeContext &&
              typeof plannerHandoff.themeContext === "object"
            ? plannerHandoff.themeContext
          : null;
      sectionBlueprint =
        recentPlan?.sectionBlueprint && typeof recentPlan.sectionBlueprint === "object"
          ? recentPlan.sectionBlueprint
          : plannerHandoffTargetCompatible &&
              plannerHandoff?.sectionBlueprint &&
              typeof plannerHandoff.sectionBlueprint === "object"
            ? plannerHandoff.sectionBlueprint
          : null;

      if (!themeSectionContext || !sectionBlueprint) {
        const planningResult = await planThemeEdit(shopifyClient, API_VERSION, {
          themeId: input.themeId,
          themeRole: input.themeRole,
          intent: "new_section",
          template: inferTemplateSurfaceFromSectionLiquid(input.liquid),
          query: planningQuery,
        });

        themeSectionContext = planningResult?.themeContext || themeSectionContext;
        sectionBlueprint = planningResult?.sectionBlueprint || sectionBlueprint;
      }

      const promptArchetype = classifyArchetype({ prompt: planningQuery });
      const generatedArchetype = detectGeneratedArchetype(input.liquid);
      if (
        sectionBlueprint?.archetype !== "single_media_story" &&
        (promptArchetype.archetype === "single_media_story" ||
          generatedArchetype === "single_media_story")
      ) {
        sectionBlueprint = buildSectionGenerationBlueprint({
          templateSurface: inferTemplateSurfaceFromSectionLiquid(input.liquid),
          query: planningQuery,
          sectionTypeHint: "single_media_story",
          themeContext: themeSectionContext,
          archetypeOverride: "single_media_story",
        });
        internalWarnings.push(
          "Planner sectionBlueprint gecorrigeerd naar single_media_story omdat de actuele prompt of gegenereerde Liquid een statische media story beschrijft."
        );
      }

      const exactReplicaRequested =
        sectionBlueprint?.completionPolicy?.treatReferenceImagesAsFinalTarget === true;

      if (!themeSectionContext) {
        if (exactReplicaRequested) {
          return buildCreateSectionRepairResponse({
            status: "inspection_failed",
            message:
              "Deze exacte replica-create mist nog echte theme-context. Plan de section opnieuw en lees eerst representatieve theme files in voordat je schrijft.",
            errorCode: "missing_precision_first_context",
            nextAction: "plan_theme_edit",
            retryMode: "switch_tool_after_fix",
            nextTool: "plan-theme-edit",
            normalizedArgs,
            nextArgsTemplate: {
              ...(input.themeId !== undefined ? { themeId: input.themeId } : {}),
              ...(input.themeRole ? { themeRole: input.themeRole } : {}),
              intent: "new_section",
              template: inferTemplateSurfaceFromSectionLiquid(input.liquid),
              query: planningQuery,
            },
            warnings: internalWarnings,
            sectionBlueprint,
            errors: [
              buildCreateSectionError({
                path: ["plannerHandoff"],
                problem:
                  "Voor een precision-first replica kon geen bruikbare themeContext worden afgeleid uit de planner-flow.",
                fixSuggestion:
                  "Voer eerst plan-theme-edit uit voor hetzelfde theme en lees daarna alle required reads met includeContent=true in.",
              }),
            ],
          });
        }
        internalWarnings.push(
          "Kon geen compacte theme-context afleiden vóór create-validatie; de write-flow valt terug op generieke section-validatie."
        );
      }

      const requiredReadKeys = Array.isArray(sectionBlueprint?.requiredReads)
        ? Array.from(
            new Set(
              sectionBlueprint.requiredReads
                .map((entry) => entry?.key)
                .filter(Boolean)
            )
          )
        : [];
      const representativeFallbackReadKeys = getRepresentativeFallbackReadKeys(
        sectionBlueprint?.requiredReads,
        requiredReadKeys
      );

      let missingRequiredReadKeys = [];
      if (requiredReadKeys.length > 0) {
        const alreadySatisfied = haveRecentThemeReads(context, {
          keys: requiredReadKeys,
          themeId: input.themeId,
          themeRole: input.themeRole,
        });

        if (!alreadySatisfied) {
          try {
            const hydrationResult = await hydrateThemeReadsWithRepresentativeFallback(context, {
              shopifyClient,
              apiVersion: API_VERSION,
              themeId: input.themeId,
              themeRole: input.themeRole,
              keys: requiredReadKeys,
              allowRepresentativeFallback: true,
              representativeFallbackKeys: representativeFallbackReadKeys,
            });
            missingRequiredReadKeys = hydrationResult.missingKeys || [];
            if ((hydrationResult.hydratedKeys || []).length > 0) {
              internalWarnings.push(
                `Planner-required theme-context reads zijn automatisch opgehaald: ${hydrationResult.hydratedKeys.join(", ")}.`
              );
            }
            if (hydrationResult.substituteRepresentativeRead?.key) {
              internalWarnings.push(
                `Planner-required representative read '${(hydrationResult.staleMissingKeys || []).join(", ")}' bestaat niet in dit theme; '${hydrationResult.substituteRepresentativeRead.key}' telt als substituteRepresentativeRead voor deze net-new section create.`
              );
              if (sectionBlueprint && typeof sectionBlueprint === "object") {
                sectionBlueprint = {
                  ...sectionBlueprint,
                  requiredReads: [
                    ...(Array.isArray(sectionBlueprint.requiredReads)
                      ? sectionBlueprint.requiredReads.filter(
                          (entry) =>
                            !hydrationResult.staleMissingKeys?.includes(entry?.key)
                        )
                      : []),
                    {
                      key: hydrationResult.substituteRepresentativeRead.key,
                      reason: "substitute representative content section",
                      substitutedFor: hydrationResult.staleMissingKeys || [],
                    },
                  ],
                  substituteRepresentativeRead: hydrationResult.substituteRepresentativeRead,
                };
              }
              if (themeSectionContext && typeof themeSectionContext === "object") {
                themeSectionContext = {
                  ...themeSectionContext,
                  substituteRepresentativeRead: hydrationResult.substituteRepresentativeRead,
                };
              }
            } else if (
              hydrationResult.representativeFallbackAttempted &&
              (hydrationResult.unsatisfiedRepresentativeReadKeys || []).length > 0
            ) {
              internalWarnings.push(
                `Planner-required representative reads ontbreken (${hydrationResult.unsatisfiedRepresentativeReadKeys.join(", ")}), maar er is geen fallback representative section gevonden. De net-new section create gaat voor die representatieve context door met generieke Shopify OS 2.0-validatie.`
              );
            }
          } catch (error) {
            const representativeFallbackSet = new Set(representativeFallbackReadKeys);
            const strictRequiredReadKeys = requiredReadKeys.filter(
              (key) => !representativeFallbackSet.has(key)
            );
            if (strictRequiredReadKeys.length > 0) {
              missingRequiredReadKeys = strictRequiredReadKeys;
              internalWarnings.push(
                `Automatisch ophalen van planner-required theme-context reads mislukte: ${error.message}. Niet-representatieve required reads blijven verplicht: ${strictRequiredReadKeys.join(", ")}.`
              );
            } else {
              internalWarnings.push(
                `Automatisch ophalen van planner-required representative reads mislukte: ${error.message}. De net-new section create gaat door met generieke Shopify OS 2.0-validatie.`
              );
              missingRequiredReadKeys = [];
            }
          }
        }
      }

      if (missingRequiredReadKeys.length > 0) {
        const nextReadArgs =
          missingRequiredReadKeys.length === 1
            ? {
                ...(input.themeId !== undefined ? { themeId: input.themeId } : {}),
                ...(input.themeRole ? { themeRole: input.themeRole } : {}),
                key: missingRequiredReadKeys[0],
                includeContent: true,
              }
            : {
                ...(input.themeId !== undefined ? { themeId: input.themeId } : {}),
                ...(input.themeRole ? { themeRole: input.themeRole } : {}),
                keys: missingRequiredReadKeys,
                includeContent: true,
              };

        return buildCreateSectionRepairResponse({
          status: "inspection_failed",
          message:
            "Deze section-create mist nog verplichte theme-context reads. Lees eerst de planner-bestanden in zodat wrappers, helpers en schaalconventies van het doeltheme gespiegeld kunnen worden.",
          errorCode: "missing_theme_context_reads",
          nextAction: "read_theme_context",
          retryMode: "switch_tool_after_fix",
          nextTool:
            missingRequiredReadKeys.length === 1
              ? "get-theme-file"
              : "get-theme-files",
          normalizedArgs,
          nextArgsTemplate: nextReadArgs,
          warnings: internalWarnings,
          themeContext: themeSectionContext,
          sectionBlueprint,
          errors: missingRequiredReadKeys.map((key) =>
            buildCreateSectionError({
              path: ["key"],
              problem: `Vereiste theme-context file '${key}' is nog niet met includeContent=true gelezen in deze flow.`,
              fixSuggestion:
                "Lees eerst de exacte planner-reads in en genereer daarna pas de volledige sectioncode.",
            })
          ),
        });
      }

      if (exactReplicaRequested && requiredReadKeys.length === 0) {
        return buildCreateSectionRepairResponse({
          status: "inspection_failed",
          message:
            "Deze exacte replica-create mist planner-required reads. Zonder representatieve theme reads wordt de output te generiek.",
          errorCode: "missing_precision_first_context",
          nextAction: "plan_theme_edit",
          retryMode: "switch_tool_after_fix",
          nextTool: "plan-theme-edit",
          normalizedArgs,
          nextArgsTemplate: {
            ...(input.themeId !== undefined ? { themeId: input.themeId } : {}),
            ...(input.themeRole ? { themeRole: input.themeRole } : {}),
            intent: "new_section",
            template: inferTemplateSurfaceFromSectionLiquid(input.liquid),
            query: planningQuery,
          },
          warnings: internalWarnings,
          themeContext: themeSectionContext,
          sectionBlueprint,
          errors: [
            buildCreateSectionError({
              path: ["plannerHandoff"],
              problem:
                "De planner leverde geen required reads op voor een exact-match section.",
              fixSuggestion:
                "Plan de section opnieuw met een volledige referentie-brief en lees daarna de geretourneerde theme files in voordat je schrijft.",
            }),
          ],
        });
      }
    } catch (error) {
      internalWarnings.push(
        `Kon geen compacte theme-context afleiden vóór create-validatie: ${error.message}`
      );
    }

    const createCodegenContract =
      plannerHandoff?.codegenContract && typeof plannerHandoff.codegenContract === "object"
        ? plannerHandoff.codegenContract
        : buildCodegenContract({
            intent: "new_section",
            mode: "create",
            targetFile: input.key,
            themeTarget: {
              themeId:
                input.themeId === undefined || input.themeId === null
                  ? null
                  : Number(input.themeId),
              themeRole: String(input.themeRole || "").trim() || null,
            },
            sectionBlueprint,
            themeContext: themeSectionContext,
            requestText: planningQuery,
            value: input.liquid,
          });

    const codegenPreflight = preflightSectionLiquid(input.liquid, {
      fileKey: input.key,
      mode: "create",
      intent: "new_section",
      requestText: planningQuery,
      themeTarget: {
        themeId:
          input.themeId === undefined || input.themeId === null
            ? null
            : Number(input.themeId),
        themeRole: String(input.themeRole || "").trim() || null,
      },
      themeContext: themeSectionContext,
      sectionBlueprint,
      codegenContract: createCodegenContract,
    });
    if ((codegenPreflight.warnings || []).length > 0) {
      internalWarnings.push(
        ...(codegenPreflight.warnings || []).map(
          (warning) => warning.message || warning.problem || String(warning)
        )
      );
    }
    const effectiveCreateCodegenContract =
      codegenPreflight.codegenContract || createCodegenContract;
    const hasSchemaBlockingIssue = (codegenPreflight.issues || []).some((issue) =>
      String(issue.code || issue.issueCode || "").startsWith("schema_")
    );

    const localPreflight = hasSchemaBlockingIssue
      ? {
          issues: [],
          warnings: [],
          suggestedFixes: [],
        }
      : inspectThemeSectionCreatePreflight(
          {
            key: input.key,
            value: input.liquid,
          },
          {
            themeContext: themeSectionContext,
            sectionBlueprint,
          }
        );
    const preflightErrors = dedupeCreateSectionIssues([
      ...(codegenPreflight.issues || []).map((issue) =>
        normalizeCreateSectionPreflightIssue(issue, "codegen_preflight")
      ),
      ...(localPreflight.issues || []).map((issue) =>
        normalizeCreateSectionPreflightIssue(issue, "local_theme_preflight")
      ),
    ]);

    if (preflightErrors.length > 0) {
      const primaryIssue = preflightErrors[0] || {};
      const groupedStages = uniqueStrings(
        preflightErrors.map((issue) => issue.stage).filter(Boolean)
      );
      const suggestedFixes = uniqueStrings([
        ...(codegenPreflight.suggestedFixes || []),
        ...(localPreflight.suggestedFixes || []),
      ]);
      return buildCreateSectionRepairResponse({
        status: "inspection_failed",
        message:
          preflightErrors.length === 1
            ? `Create-section preflight failed before write: ${primaryIssue.problem}`
            : `Create-section preflight found ${preflightErrors.length} blocking issues before write. Fix them in one retry; first issue: ${primaryIssue.problem}`,
        errorCode:
          preflightErrors.length === 1
            ? primaryIssue.issueCode || primaryIssue.code || "preflight_failed"
            : "preflight_failed_multiple",
        nextAction:
          groupedStages.length === 1 && groupedStages[0] === "codegen_preflight"
            ? "fix_codegen_preflight"
            : "fix_create_section_preflight",
        retryMode: "same_request_after_fix",
        nextTool: "create-theme-section",
        normalizedArgs,
        nextArgsTemplate: {
          ...nextArgsTemplate,
          liquid:
            suggestedFixes.length > 0
              ? `<complete corrected Shopify Liquid section; fix all reported preflight issues before retrying: ${suggestedFixes.join(" ")}>`
              : "<complete corrected Shopify Liquid section; fix all reported preflight issues before retrying>",
        },
        warnings: uniqueStrings([
          ...internalWarnings,
          ...(localPreflight.warnings || []),
        ]),
        errors: preflightErrors,
        repairPrompt: buildSectionRepairPrompt(preflightErrors),
        themeContext: themeSectionContext,
        sectionBlueprint,
        plannerHandoff,
        codegenContract: codegenPreflight.codegenContract || createCodegenContract,
        preflight: {
          validationProfile: codegenPreflight.validationProfile,
          sectionKind: codegenPreflight.sectionKind,
          architectureDiagnostics: codegenPreflight.architectureDiagnostics,
          promptCoverage: codegenPreflight.promptCoverage,
          promptFidelity: codegenPreflight.promptFidelity,
          stages: groupedStages,
          issueCount: preflightErrors.length,
        },
      });
    }

    const result = await draftThemeArtifact.execute(
      {
        themeId: input.themeId,
        themeRole: input.themeRole,
        mode: "create",
        isStandalone: input.isStandalone,
        verbosity: input.verbosity || "compact",
        includeContracts: input.includeContracts === true,
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
        plannerHandoff,
        codegenContract: effectiveCreateCodegenContract,
        themeContextWarnings: internalWarnings,
        responseVerbosity: input.verbosity || "compact",
        includeContracts: input.includeContracts === true,
      }
    );

    if (result && typeof result === "object" && result.success === false) {
      const includeDebugPayloads = shouldIncludeCreateDebugPayloads({
        verbosity: input.verbosity || "compact",
        includeContracts: input.includeContracts === true,
      });
      if (!includeDebugPayloads) {
        const {
          themeContext: resultThemeContext,
          sectionBlueprint: resultSectionBlueprint,
          plannerHandoff: resultPlannerHandoff,
          codegenContract: resultCodegenContract,
          ...compactResult
        } = result;
        const omittedDebugPayloads = uniqueStrings([
          ...(result.debugPayloadsOmitted || []),
          ...summarizeCreateDebugPayloadOmissions({
            codegenContract: resultCodegenContract || createCodegenContract,
            themeContext: resultThemeContext || themeSectionContext,
            sectionBlueprint: resultSectionBlueprint || sectionBlueprint,
            plannerHandoff: resultPlannerHandoff || plannerHandoff,
          }),
        ]);
        return {
          ...compactResult,
          ...(sectionBlueprint?.completionPolicy && !result.completionPolicy
            ? { completionPolicy: sectionBlueprint.completionPolicy }
            : {}),
          ...(internalWarnings.length > 0
            ? {
                warnings: Array.from(
                  new Set([...(result.warnings || []), ...internalWarnings])
                ),
              }
            : {}),
          ...(omittedDebugPayloads.length > 0
            ? {
                debugPayloadsOmitted: omittedDebugPayloads,
                debugPayloadHint:
                  "Retry with verbosity='debug' or includeContracts=true to include full planner/codegen/theme context.",
              }
            : {}),
          nextTool: "create-theme-section",
          nextArgsTemplate: result.nextArgsTemplate || nextArgsTemplate,
        };
      }
      return {
        ...result,
        ...(sectionBlueprint?.completionPolicy && !result.completionPolicy
          ? { completionPolicy: sectionBlueprint.completionPolicy }
          : {}),
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
        ...(plannerHandoff ? { plannerHandoff } : {}),
        ...(createCodegenContract && !result.codegenContract
          ? { codegenContract: createCodegenContract }
          : {}),
        nextTool: "create-theme-section",
        nextArgsTemplate: result.nextArgsTemplate || nextArgsTemplate,
      };
    }

    if (result && typeof result === "object" && internalWarnings.length > 0) {
      if (result.success === true) {
        rememberThemeWrite(context, {
          themeId: input.themeId,
          themeRole: input.themeRole,
          intent: "new_section",
          mode: "create",
          files: [{ key: input.key }],
          createdSectionFile: input.key,
        });
      }
      return {
        ...result,
        ...(sectionBlueprint?.completionPolicy && !result.completionPolicy
          ? { completionPolicy: sectionBlueprint.completionPolicy }
          : {}),
        warnings: Array.from(
          new Set([...(result.warnings || []), ...internalWarnings])
        ),
        ...(themeSectionContext && !result.themeContext
          ? { themeContext: themeSectionContext }
          : {}),
        ...(sectionBlueprint && !result.sectionBlueprint
          ? { sectionBlueprint }
          : {}),
        ...(plannerHandoff ? { plannerHandoff } : {}),
        ...(createCodegenContract && !result.codegenContract
          ? { codegenContract: createCodegenContract }
          : {}),
        ...buildRefinementRouteMetadata({
          input,
          planningQuery,
          recentPlan,
          plannerHandoff,
        }),
      };
    }

    if (result && typeof result === "object") {
      if (result.success === true) {
        rememberThemeWrite(context, {
          themeId: input.themeId,
          themeRole: input.themeRole,
          intent: "new_section",
          mode: "create",
          files: [{ key: input.key }],
          createdSectionFile: input.key,
        });
      }
      return {
        ...result,
        ...(sectionBlueprint?.completionPolicy && !result.completionPolicy
          ? { completionPolicy: sectionBlueprint.completionPolicy }
          : {}),
        ...(themeSectionContext && !result.themeContext
          ? { themeContext: themeSectionContext }
          : {}),
        ...(sectionBlueprint && !result.sectionBlueprint
          ? { sectionBlueprint }
          : {}),
        ...(plannerHandoff ? { plannerHandoff } : {}),
        ...(createCodegenContract && !result.codegenContract
          ? { codegenContract: createCodegenContract }
          : {}),
        ...buildRefinementRouteMetadata({
          input,
          planningQuery,
          recentPlan,
          plannerHandoff,
        }),
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
