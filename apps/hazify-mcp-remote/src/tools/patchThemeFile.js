import { z } from "zod";
import { requireShopifyClient } from "./_context.js";
import { draftThemeArtifact } from "./draftThemeArtifact.js";
import { getRecentThemeRead } from "../lib/themeEditMemory.js";
import { hydrateExactThemeReads } from "../lib/themeReadHydration.js";
import {
  extractThemeToolSummary,
  inferSingleThemeFile,
  inferThemeTargetFromSummary,
} from "./_themeToolCompatibility.js";

const ThemeRoleSchema = z.enum(["main", "unpublished", "demo", "development"]);

const ThemePatchSchema = z.object({
  searchString: z
    .string()
    .min(1)
    .describe("De exacte string die in het bestaande bestand moet worden gevonden."),
  replaceString: z.string().describe("De nieuwe string die de searchString vervangt."),
});

const PatchThemeFileInputShape = z
  .object({
    themeId: z
      .string()
      .or(z.number())
      .optional()
      .describe("Optioneel expliciet doel theme ID. Laat weg om via themeRole te resolven."),
    themeRole: ThemeRoleSchema
      .optional()
      .describe("Target theme role. Verplicht als themeId niet is opgegeven. Vraag de gebruiker welk thema."),
    key: z.string().min(1).describe("Het exacte bestaande theme-bestand dat gepatcht moet worden."),
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
  })
  .refine((data) => Boolean(data.patch) !== Boolean(data.patches), {
    message: "Provide exactly one of 'patch' or 'patches'.",
  });

const normalizePatchThemeFileInput = (rawInput) => {
  if (!rawInput || typeof rawInput !== "object" || Array.isArray(rawInput)) {
    return rawInput;
  }

  const summary = extractThemeToolSummary(rawInput);
  let normalized = { ...rawInput };

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

const patchThemeFileTool = {
  name: "patch-theme-file",
  description:
    "Patch one existing theme file met één of meer letterlijke vervangingen. Gebruik dit alleen voor kleine single-file fixes nadat je eerst met `search-theme-files` en daarna `get-theme-file` de exacte anchor hebt bepaald. Wanneer exact hetzelfde bestand nog niet in deze flow is gelezen, probeert de tool nu eerst veilig zelf een exacte read met includeContent=true te hydrateren. Daarna weigert hij nog steeds generieke of niet-unieke anchors en blokkeert hij bredere CSS/JS/schema rewrites die eigenlijk via draft-theme-artifact mode='edit' horen te lopen.",
  schema: PatchThemeFileInputSchema,
  execute: async (input, context = {}) => {
    const shopifyClient = requireShopifyClient(context);
    const normalizedArgs = {
      themeId: input.themeId ?? null,
      themeRole: input.themeRole || null,
      key: input.key,
      patchCount: input.patch ? 1 : Array.isArray(input.patches) ? input.patches.length : 0,
      hasBaseChecksumMd5: Boolean(input.baseChecksumMd5),
    };
    const warnings = [];
    let recentRead = getRecentThemeRead(context, {
      key: input.key,
      themeId: input.themeId,
      themeRole: input.themeRole,
      requireContent: true,
    });
    const readArgsTemplate = {
      ...(input.themeId !== undefined ? { themeId: input.themeId } : {}),
      ...(input.themeRole ? { themeRole: input.themeRole } : {}),
      key: input.key,
      includeContent: true,
    };

    if (!recentRead?.content) {
      try {
        const hydrationResult = await hydrateExactThemeReads(context, {
          shopifyClient,
          apiVersion: process.env.SHOPIFY_API_VERSION || "2026-01",
          themeId: input.themeId,
          themeRole: input.themeRole,
          keys: [input.key],
        });
        if ((hydrationResult.hydratedKeys || []).length > 0) {
          warnings.push(
            `Exacte target-read is automatisch opgehaald voor patch-theme-file: ${hydrationResult.hydratedKeys.join(", ")}.`
          );
        }
        recentRead = getRecentThemeRead(context, {
          key: input.key,
          themeId: input.themeId,
          themeRole: input.themeRole,
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
            problem: `Bestand '${input.key}' is nog niet met includeContent=true gelezen in deze flow.`,
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

    if (looksLikeBroadThemePatch(input.key, patches)) {
      return buildPatchThemeFailure({
        message:
          "Deze patch lijkt breder dan een kleine literal fix. Gebruik voor grotere section/snippet rewrites liever draft-theme-artifact mode='edit'.",
        errorCode: "patch_scope_too_large",
        normalizedArgs,
        nextAction: "rewrite_with_draft_tool",
        nextTool: "draft-theme-artifact",
        nextArgsTemplate: {
          ...(input.themeId !== undefined ? { themeId: input.themeId } : {}),
          ...(input.themeRole ? { themeRole: input.themeRole } : {}),
          mode: "edit",
          key: input.key,
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
          ? `Patch anchor '${shortAnchor}' is niet veilig uniek in '${input.key}'.`
          : `Patch anchor '${shortAnchor}' werd niet gevonden in de laatst gelezen inhoud van '${input.key}'.`,
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
              ? `De gekozen searchString matcht ${patchValidation.occurrenceCount} keer in '${input.key}'.`
              : `De gekozen searchString matcht niet meer in '${input.key}'.`,
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
        themeId: input.themeId,
        themeRole: input.themeRole,
        mode: "edit",
        files: [
          {
            key: input.key,
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
