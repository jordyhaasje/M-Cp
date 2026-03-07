import { z } from "zod";
import { getThemeFile, upsertThemeFile } from "../lib/themeFiles.js";

const API_VERSION = process.env.SHOPIFY_API_VERSION || "2026-01";
const ThemeRoleSchema = z.enum(["main", "unpublished", "demo", "development"]);

const ImportSectionToLiveThemeInputSchema = z.object({
  sectionHandle: z
    .string()
    .min(1)
    .describe("Section handle, e.g. cloudpillo-risk-free (writes to sections/<handle>.liquid)"),
  liquid: z.string().min(1).describe("Full Liquid content of the section"),
  themeId: z.coerce.number().int().positive().optional().describe("Optional explicit Shopify theme ID"),
  themeRole: ThemeRoleSchema.default("main").describe("Theme role fallback when themeId is omitted"),
  overwrite: z.boolean().default(true).describe("When false, fail if the section file already exists"),
});

const normalizeSectionHandle = (rawHandle) => {
  const normalized = String(rawHandle || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "");
  if (!normalized) {
    throw new Error("sectionHandle is ongeldig na normalisatie; gebruik letters/cijfers en optioneel '-'.");
  }
  return normalized;
};

let shopifyClient;

const importSectionToLiveTheme = {
  name: "import-section-to-live-theme",
  description: "Import a generated Shopify section directly into the live theme (or specified theme).",
  schema: ImportSectionToLiveThemeInputSchema,
  initialize(client) {
    shopifyClient = client;
  },
  execute: async (input) => {
    try {
      const normalizedHandle = normalizeSectionHandle(input.sectionHandle);
      const key = `sections/${normalizedHandle}.liquid`;

      if (!input.overwrite) {
        try {
          await getThemeFile(shopifyClient, API_VERSION, {
            themeId: input.themeId,
            themeRole: input.themeRole,
            key,
          });
          throw new Error(`Section '${key}' bestaat al. Zet overwrite=true om te overschrijven.`);
        } catch (error) {
          if (error?.status !== 404) {
            throw error;
          }
        }
      }

      const result = await upsertThemeFile(shopifyClient, API_VERSION, {
        themeId: input.themeId,
        themeRole: input.themeRole,
        key,
        value: input.liquid,
      });

      return {
        action: "imported_section",
        theme: {
          id: result.theme.id,
          name: result.theme.name,
          role: result.theme.role,
        },
        section: {
          handle: normalizedHandle,
          key,
          overwritten: input.overwrite,
        },
      };
    } catch (error) {
      console.error("Error importing section into live theme:", error);
      throw new Error(
        `Failed to import section into live theme: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  },
};

export { importSectionToLiveTheme };
