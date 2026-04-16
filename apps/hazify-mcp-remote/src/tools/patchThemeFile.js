import { z } from "zod";
import { requireShopifyClient } from "./_context.js";
import { draftThemeArtifact } from "./draftThemeArtifact.js";
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

const patchThemeFileTool = {
  name: "patch-theme-file",
  description:
    "Patch one existing theme file met één of meer letterlijke vervangingen. Gebruik dit voor kleine single-file fixes nadat je eerst met `search-theme-files` en zo nodig `get-theme-file` de exacte anchor hebt bepaald. Geef altijd hetzelfde expliciete themeId of themeRole mee als in je read-flow. Gebruik een unieke searchString die exact één keer voorkomt; bij twijfel eerst plan-theme-edit. Niet bedoeld voor native product-block flows die section + snippet tegelijk raken. Compatibele shorthand: `key + searchString + replaceString` op top-level wordt automatisch naar `patch` genormaliseerd, en legacy `replacements[{ find, replace }]` wordt naar `patches` vertaald. Vrije tekst zoals `_tool_input_summary` blijft alleen een compat-fallback voor theme target of exact file path; die vrije tekst mag nooit een vage key of patch-body construeren.",
  schema: PatchThemeFileInputSchema,
  execute: async (input, context = {}) => {
    requireShopifyClient(context);
    return draftThemeArtifact.execute(
      {
        themeId: input.themeId,
        themeRole: input.themeRole,
        mode: "edit",
        files: [
          {
            key: input.key,
            ...(input.patch ? { patch: input.patch } : {}),
            ...(input.patches ? { patches: input.patches } : {}),
            ...(input.baseChecksumMd5 ? { baseChecksumMd5: input.baseChecksumMd5 } : {}),
          },
        ],
      },
      context
    );
  },
};

export { PatchThemeFileInputSchema, patchThemeFileTool };
