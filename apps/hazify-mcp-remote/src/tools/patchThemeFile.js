import { z } from "zod";
import { requireShopifyClient } from "./_context.js";
import { draftThemeArtifact } from "./draftThemeArtifact.js";
import {
  getRecentThemeRead,
  getThemeEditMemory,
  themeTargetsCompatible,
} from "../lib/themeEditMemory.js";
import { hydrateExactThemeReads } from "../lib/themeReadHydration.js";
import {
  extractThemeToolSummary,
  inferSingleThemeFile,
  inferThemeTargetFromSummary,
} from "./_themeToolCompatibility.js";

const ThemeRoleSchema = z.enum(["main", "unpublished", "demo", "development"]);
const SUMMARY_MAX_LENGTH = 4000;

const SummaryAliasFieldDescriptions = {
  _tool_input_summary:
    "Compat summary voor beperkte clients. Alleen veilige inferentie voor theme target en exact één targetbestand; anders volgt een gestructureerde repair response.",
  tool_input_summary:
    "Legacy alias van _tool_input_summary voor backwards compatibility.",
  summary:
    "Legacy alias van _tool_input_summary voor backwards compatibility.",
  prompt:
    "Legacy alias van _tool_input_summary voor backwards compatibility.",
  request:
    "Legacy alias van _tool_input_summary voor backwards compatibility.",
};

const ThemePatchSchema = z.object({
  searchString: z
    .string()
    .min(1)
    .describe("De exacte string die in het bestaande bestand moet worden gevonden."),
  replaceString: z.string().describe("De nieuwe string die de searchString vervangt."),
});

const PatchThemeFilePublicObjectSchema = z
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
      .describe(
        "Het exacte bestaande theme-bestand dat gepatcht moet worden. Compatibele clients mogen dit leeg laten als hetzelfde target veilig exact uit summary of recente planner-memory afleidbaar is; anders volgt een repair response."
      ),
    patch: ThemePatchSchema
      .optional()
      .describe("Eén gerichte vervanging in een bestaand bestand."),
    patches: z
      .array(ThemePatchSchema)
      .min(1)
      .max(10)
      .optional()
      .describe("Meerdere sequentiële vervangingen in hetzelfde bestaande bestand."),
    baseChecksumMd5: z
      .string()
      .optional()
      .describe("Optionele MD5 checksum voor conflict-safe writes."),
    _tool_input_summary: z
      .string()
      .max(SUMMARY_MAX_LENGTH)
      .optional()
      .describe(SummaryAliasFieldDescriptions._tool_input_summary),
    tool_input_summary: z
      .string()
      .max(SUMMARY_MAX_LENGTH)
      .optional()
      .describe(SummaryAliasFieldDescriptions.tool_input_summary),
    summary: z
      .string()
      .max(SUMMARY_MAX_LENGTH)
      .optional()
      .describe(SummaryAliasFieldDescriptions.summary),
    prompt: z
      .string()
      .max(SUMMARY_MAX_LENGTH)
      .optional()
      .describe(SummaryAliasFieldDescriptions.prompt),
    request: z
      .string()
      .max(SUMMARY_MAX_LENGTH)
      .optional()
      .describe(SummaryAliasFieldDescriptions.request),
  })
  .strict();

const PatchThemeFileInputShape = PatchThemeFilePublicObjectSchema.refine(
  (data) => Boolean(data.patch) !== Boolean(data.patches),
  {
    message: "Provide exactly one of 'patch' or 'patches'.",
  }
);

const normalizePatchThemeFileInput = (rawInput) => {
  if (!rawInput || typeof rawInput !== "object" || Array.isArray(rawInput)) {
    return rawInput;
  }

  const summary = extractThemeToolSummary(rawInput);
  let normalized = {
    themeId: rawInput.themeId,
    themeRole: rawInput.themeRole,
    key: rawInput.key,
    patch: rawInput.patch,
    patches: rawInput.patches,
    baseChecksumMd5: rawInput.baseChecksumMd5,
    _tool_input_summary: rawInput._tool_input_summary,
    tool_input_summary: rawInput.tool_input_summary,
    summary: rawInput.summary,
    prompt: rawInput.prompt,
    request: rawInput.request,
  };

  if (!normalized.key && typeof rawInput.targetFile === "string" && rawInput.targetFile.trim()) {
    normalized.key = rawInput.targetFile.trim();
  }

  if (!normalized.key && typeof rawInput.file === "string" && rawInput.file.trim()) {
    normalized.key = rawInput.file.trim();
  }

  if (rawInput.searchString !== undefined && rawInput.replaceString !== undefined && !rawInput.patch && !rawInput.patches) {
    normalized.patch = {
      searchString: rawInput.searchString,
      replaceString: rawInput.replaceString,
    };
  }

  if (rawInput.find !== undefined && rawInput.replace !== undefined && !rawInput.patch && !rawInput.patches) {
    normalized.patch = {
      searchString: rawInput.find,
      replaceString: rawInput.replace,
    };
  }

  if (Array.isArray(rawInput.replacements) && !rawInput.patch && !rawInput.patches) {
    normalized.patches = rawInput.replacements.map((entry) => ({
      searchString: entry?.searchString ?? entry?.find ?? "",
      replaceString: entry?.replaceString ?? entry?.replace ?? "",
    }));
  }

  if (summary) {
    normalized = inferThemeTargetFromSummary(normalized, summary);
    if (!normalized.key) {
      normalized.key = inferSingleThemeFile(summary) || normalized.targetFile || normalized.key;
    }
  }

  return normalized;
};

const PatchThemeFileInputSchema = z.preprocess(
  normalizePatchThemeFileInput,
  PatchThemeFileInputShape
);

const countLiteralOccurrences = (source, needle) => {
  const haystack = String(source || "");
  const search = String(needle || "");
  if (!search) {
    return 0;
  }

  let count = 0;
  let cursor = 0;
  while (cursor <= haystack.length) {
    const index = haystack.indexOf(search, cursor);
    if (index === -1) {
      break;
    }
    count += 1;
    cursor = index + search.length;
  }
  return count;
};

const countPatchLines = (value) => String(value || "").split(/\r?\n/).length;

const looksLikeBroadThemePatch = (key, patches = []) => {
  const normalizedKey = String(key || "");
  if (!/^(sections|snippets|blocks)\//.test(normalizedKey)) {
    return false;
  }

  const structuralPattern =
    /<script\b|<style\b|{%\s*(?:schema|javascript|stylesheet)\s*%}|{%\s*end(?:schema|javascript|stylesheet)\s*%}|block\.shopify_attributes|addEventListener\s*\(|scrollBy\s*\(/i;
  const combinedReplaceLength = patches.reduce(
    (total, patch) => total + String(patch?.replaceString || "").length,
    0
  );
  const hasLargeMultilinePatch = patches.some(
    (patch) =>
      countPatchLines(patch?.replaceString) > 8 ||
      countPatchLines(patch?.searchString) > 8
  );
  const touchesStructure = patches.some(
    (patch) =>
      structuralPattern.test(String(patch?.replaceString || "")) ||
      structuralPattern.test(String(patch?.searchString || ""))
  );

  return (
    touchesStructure ||
    combinedReplaceLength > 900 ||
    patches.length > 3 ||
    (hasLargeMultilinePatch && combinedReplaceLength > 320)
  );
};

const buildPatchThemeFailure = ({
  message,
  errorCode,
  normalizedArgs,
  nextAction,
  nextTool = "patch-theme-file",
  nextArgsTemplate,
  retryMode = "same_request_after_fix",
  errors = [],
  suggestedFixes = [],
}) => ({
  success: false,
  status: "inspection_failed",
  message,
  errorCode,
  retryable: true,
  nextAction,
  nextTool,
  nextArgsTemplate,
  retryMode,
  normalizedArgs,
  errors,
  suggestedFixes,
  shouldNarrowScope: false,
});

const validatePatchesAgainstRead = (patches, source) => {
  let workingSource = String(source || "");

  for (const [index, patch] of patches.entries()) {
    const searchString = String(patch?.searchString || "");
    const occurrenceCount = countLiteralOccurrences(workingSource, searchString);
    if (occurrenceCount !== 1) {
      return {
        ok: false,
        patchIndex: index,
        searchString,
        occurrenceCount,
      };
    }
    workingSource = workingSource.replace(searchString, String(patch?.replaceString || ""));
  }

  return { ok: true };
};

const pickRememberedPatchTarget = (memoryState = {}, { themeId, themeRole } = {}) => {
  if (!memoryState || !themeTargetsCompatible(memoryState.themeTarget, { themeId, themeRole })) {
    return null;
  }

  const planTarget =
    memoryState.lastPlan?.intent === "existing_edit" &&
    typeof memoryState.lastPlan?.targetFile === "string" &&
    memoryState.lastPlan.targetFile.trim()
      ? memoryState.lastPlan.targetFile.trim()
      : null;

  if (planTarget) {
    return {
      key: planTarget,
      source: "recent_plan_target",
    };
  }

  const lastTarget =
    memoryState.lastIntent === "existing_edit" &&
    typeof memoryState.lastTargetFile === "string" &&
    memoryState.lastTargetFile.trim()
      ? memoryState.lastTargetFile.trim()
      : null;

  if (lastTarget) {
    return {
      key: lastTarget,
      source: "recent_existing_edit_target",
    };
  }

  return null;
};

const patchThemeFileTool = {
  name: "patch-theme-file",
  description:
    "Patch one existing theme file met één of meer letterlijke vervangingen. Gebruik dit alleen voor kleine single-file fixes nadat je eerst met `search-theme-files` en daarna `get-theme-file` de exacte anchor hebt bepaald. Compatibele clients mogen een summary meesturen; de tool inferreert alleen een exact targetbestand als dat veilig kan en geeft anders een repair response via `plan-theme-edit`. Wanneer exact hetzelfde bestand nog niet in deze flow is gelezen, probeert de tool nu eerst veilig zelf een exacte read met includeContent=true te hydrateren. Daarna weigert hij nog steeds generieke of niet-unieke anchors en blokkeert hij bredere CSS/JS/schema rewrites die eigenlijk via draft-theme-artifact mode='edit' horen te lopen.",
  inputSchema: PatchThemeFilePublicObjectSchema,
  schema: PatchThemeFileInputSchema,
  execute: async (input, context = {}) => {
    const shopifyClient = requireShopifyClient(context);
    const memoryState = getThemeEditMemory(context);
    const warnings = [];
    const summary = extractThemeToolSummary(input);
    let effectiveThemeId = input.themeId;
    let effectiveThemeRole = input.themeRole;
    if (
      memoryState?.themeTarget &&
      themeTargetsCompatible(memoryState.themeTarget, {
        themeId: effectiveThemeId,
        themeRole: effectiveThemeRole,
      })
    ) {
      if (
        effectiveThemeId === undefined &&
        memoryState.themeTarget.themeId !== null &&
        memoryState.themeTarget.themeId !== undefined
      ) {
        effectiveThemeId = memoryState.themeTarget.themeId;
        warnings.push(
          `Theme target is automatisch overgenomen uit de recente theme-flow: themeId ${effectiveThemeId}.`
        );
      } else if (!effectiveThemeRole && memoryState.themeTarget.themeRole) {
        effectiveThemeRole = memoryState.themeTarget.themeRole;
        warnings.push(
          `Theme target is automatisch overgenomen uit de recente theme-flow: themeRole '${effectiveThemeRole}'.`
        );
      }
    }

    let effectiveKey = input.key;
    if (!effectiveKey) {
      const rememberedTarget = pickRememberedPatchTarget(memoryState, {
        themeId: effectiveThemeId,
        themeRole: effectiveThemeRole,
      });
      if (rememberedTarget?.key) {
        effectiveKey = rememberedTarget.key;
        warnings.push(
          `Patch target is automatisch overgenomen uit de recente theme-flow (${rememberedTarget.source}): ${effectiveKey}.`
        );
      }
    }

    const normalizedArgs = {
      themeId: effectiveThemeId ?? null,
      themeRole: effectiveThemeRole || null,
      key: effectiveKey || null,
      patchCount: input.patch ? 1 : Array.isArray(input.patches) ? input.patches.length : 0,
      hasBaseChecksumMd5: Boolean(input.baseChecksumMd5),
    };

    if (!effectiveKey) {
      return buildPatchThemeFailure({
        message:
          "Patch-theme-file mist een exact targetbestand. Gebruik eerst plan-theme-edit om het bestaande bestand veilig te identificeren, of geef direct een expliciete key mee.",
        errorCode: "missing_patch_target_file",
        normalizedArgs,
        nextAction: "identify_target_file",
        nextTool: "plan-theme-edit",
        nextArgsTemplate: {
          ...(effectiveThemeId !== undefined ? { themeId: effectiveThemeId } : {}),
          ...(effectiveThemeRole ? { themeRole: effectiveThemeRole } : {}),
          intent: "existing_edit",
          ...(summary ? { query: summary } : {}),
        },
        retryMode: "switch_tool_after_fix",
        errors: [
          {
            path: ["key"],
            problem:
              "Geen exact theme-bestand opgegeven of veilig afleidbaar voor deze patch-flow.",
            fixSuggestion:
              "Gebruik eerst plan-theme-edit met intent='existing_edit' of geef direct de exacte sections/... of snippets/... key mee.",
          },
        ],
        suggestedFixes: [
          "Gebruik plan-theme-edit om eerst exact te bepalen welk bestand moet worden aangepast.",
          "Geef daarna patch-theme-file een expliciete key en een unieke literal searchString uit de echte filecontent.",
        ],
      });
    }

    let recentRead = getRecentThemeRead(context, {
      key: effectiveKey,
      themeId: effectiveThemeId,
      themeRole: effectiveThemeRole,
      requireContent: true,
    });
    const readArgsTemplate = {
      ...(effectiveThemeId !== undefined ? { themeId: effectiveThemeId } : {}),
      ...(effectiveThemeRole ? { themeRole: effectiveThemeRole } : {}),
      key: effectiveKey,
      includeContent: true,
    };

    if (!recentRead?.content) {
      try {
        const hydrationResult = await hydrateExactThemeReads(context, {
          shopifyClient,
          apiVersion: process.env.SHOPIFY_API_VERSION || "2026-01",
          themeId: effectiveThemeId,
          themeRole: effectiveThemeRole,
          keys: [effectiveKey],
        });
        if ((hydrationResult.hydratedKeys || []).length > 0) {
          warnings.push(
            `Exacte target-read is automatisch opgehaald voor patch-theme-file: ${hydrationResult.hydratedKeys.join(", ")}.`
          );
        }
        recentRead = getRecentThemeRead(context, {
          key: effectiveKey,
          themeId: effectiveThemeId,
          themeRole: effectiveThemeRole,
          requireContent: true,
        });
      } catch (_error) {
        // Val terug op de bestaande repair response hieronder.
      }
    }

    if (!recentRead?.content) {
      return buildPatchThemeFailure({
        message:
          "Patch-theme-file vereist eerst een exacte file-read met includeContent=true. Zo kan de agent een unieke literal anchor kiezen en conflict-safe patchen.",
        errorCode: "patch_requires_read_context",
        normalizedArgs,
        nextAction: "read_target_file",
        nextTool: "get-theme-file",
        nextArgsTemplate: readArgsTemplate,
        retryMode: "switch_tool_after_fix",
        errors: [
          {
            path: ["key"],
            problem: `Bestand '${effectiveKey}' is nog niet met includeContent=true gelezen in deze flow.`,
            fixSuggestion:
              "Lees eerst exact dit bestand in via get-theme-file en kies daarna een unieke searchString uit de echte filecontent.",
          },
        ],
        suggestedFixes: [
          "Gebruik eerst get-theme-file met includeContent=true op exact hetzelfde theme target.",
          "Kies daarna een unieke anchor uit de echte filecontent in plaats van een generieke term.",
        ],
      });
    }

    const patches = input.patch ? [input.patch] : input.patches || [];

    if (looksLikeBroadThemePatch(effectiveKey, patches)) {
      return buildPatchThemeFailure({
        message:
          "Deze patch lijkt breder dan een kleine literal fix. Gebruik voor grotere section/snippet rewrites liever draft-theme-artifact mode='edit'.",
        errorCode: "patch_scope_too_large",
        normalizedArgs,
        nextAction: "rewrite_with_draft_tool",
        nextTool: "draft-theme-artifact",
        nextArgsTemplate: {
          ...(effectiveThemeId !== undefined ? { themeId: effectiveThemeId } : {}),
          ...(effectiveThemeRole ? { themeRole: effectiveThemeRole } : {}),
          mode: "edit",
          key: effectiveKey,
          value: "<full rewritten file content>",
          ...(input.baseChecksumMd5 || recentRead?.checksumMd5
            ? { baseChecksumMd5: input.baseChecksumMd5 || recentRead.checksumMd5 }
            : {}),
        },
        retryMode: "switch_tool_after_fix",
        errors: [
          {
            path: input.patch ? ["patch"] : ["patches"],
            problem:
              "De gevraagde patch raakt structurele CSS/JS/schema-inhoud of is te groot voor een veilige anchor-based patch-flow.",
            fixSuggestion:
              "Gebruik draft-theme-artifact mode='edit' met een volledige rewrite of een compact files[] edit-contract wanneer je grotere structurele wijzigingen wilt doorvoeren.",
          },
        ],
        suggestedFixes: [
          "Gebruik patch-theme-file alleen voor kleine, unieke literal vervangingen.",
          "Gebruik draft-theme-artifact mode='edit' zodra je CSS, JS, schema of bredere markup in één keer wilt herschrijven.",
        ],
      });
    }

    const patchValidation = validatePatchesAgainstRead(patches, recentRead.content);

    if (!patchValidation.ok) {
      const ambiguous = patchValidation.occurrenceCount > 1;
      const shortAnchor = `${patchValidation.searchString.slice(0, 60)}${
        patchValidation.searchString.length > 60 ? "..." : ""
      }`;
      return buildPatchThemeFailure({
        message: ambiguous
          ? `Patch anchor '${shortAnchor}' is niet veilig uniek in '${effectiveKey}'.`
          : `Patch anchor '${shortAnchor}' werd niet gevonden in de laatst gelezen inhoud van '${effectiveKey}'.`,
        errorCode: ambiguous
          ? "patch_failed_ambiguous_match"
          : "patch_failed_nomatch",
        normalizedArgs,
        nextAction: ambiguous ? "make_patch_anchor_unique" : "refresh_patch_anchor",
        nextTool: "get-theme-file",
        nextArgsTemplate: readArgsTemplate,
        errors: [
          {
            path: input.patch
              ? ["patch", "searchString"]
              : ["patches", patchValidation.patchIndex, "searchString"],
            problem: ambiguous
              ? `De gekozen searchString matcht ${patchValidation.occurrenceCount} keer in '${effectiveKey}'.`
              : `De gekozen searchString matcht niet meer in '${effectiveKey}'.`,
            fixSuggestion: ambiguous
              ? "Gebruik meer omliggende context zodat de anchor exact één keer voorkomt."
              : "Lees het bestand opnieuw in en kies een exacte literal uit de huidige filecontent.",
          },
        ],
        suggestedFixes: ambiguous
          ? [
              "Gebruik een langere literal anchor met omliggende markup of Liquid.",
              "Vermijd generieke termen zoals trustpilot, button, rating of schema zonder extra context.",
            ]
          : [
              "Lees het bestand opnieuw in en controleer of de anchor nog exact overeenkomt.",
              "Gebruik desnoods search-theme-files om eerst een compact, uniek snippet te vinden.",
            ],
      });
    }

    const result = await draftThemeArtifact.execute(
      {
        themeId: effectiveThemeId,
        themeRole: effectiveThemeRole,
        mode: "edit",
        files: [
          {
            key: effectiveKey,
            ...(input.patch ? { patch: input.patch } : {}),
            ...(input.patches ? { patches: input.patches } : {}),
            ...(input.baseChecksumMd5 || recentRead?.checksumMd5
              ? { baseChecksumMd5: input.baseChecksumMd5 || recentRead.checksumMd5 }
              : {}),
          },
        ],
      },
      context
    );

    if (result && typeof result === "object" && warnings.length > 0) {
      return {
        ...result,
        warnings: Array.from(new Set([...(result.warnings || []), ...warnings])),
      };
    }

    return result;
  },
};

export { PatchThemeFileInputSchema, patchThemeFileTool };
