import { z } from "zod";
import { requireShopifyClient } from "./_context.js";
import { draftThemeArtifact } from "./draftThemeArtifact.js";

const ThemeRoleSchema = z.enum(["main", "unpublished", "demo", "development"]);

const ThemePatchSchema = z.object({
  searchString: z
    .string()
    .min(1)
    .describe("De exacte string die in het bestaande bestand moet worden gevonden."),
  replaceString: z.string().describe("De nieuwe string die de searchString vervangt."),
});

const PatchThemeFileInputSchema = z
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

const patchThemeFileTool = {
  name: "patch-theme-file",
  description:
    "Patch one existing theme file met één of meer letterlijke vervangingen. Dit is de voorkeursroute voor smalle single-file edits in bestaande snippets, sections, assets, config of templates wanneer je het exacte targetbestand al weet. Gebruik een unieke searchString die exact één keer voorkomt; bij twijfel eerst plan-theme-edit. Niet bedoeld voor native product-block flows die section + snippet tegelijk raken. Geef altijd hetzelfde expliciete themeId of themeRole mee als in je read-flow.",
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
