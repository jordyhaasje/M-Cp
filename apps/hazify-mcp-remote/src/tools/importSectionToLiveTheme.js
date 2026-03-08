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
  validateSchema: z
    .boolean()
    .default(true)
    .describe("Validate that the section contains a valid {% schema %} JSON block"),
  requirePresets: z
    .boolean()
    .default(true)
    .describe("Require at least one schema preset so the section is addable in Theme Editor"),
  addToTemplate: z
    .boolean()
    .default(false)
    .describe("Also insert this section into a JSON template sections/order"),
  templateKey: z
    .string()
    .default("templates/index.json")
    .describe("Template key for insertion, e.g. templates/index.json"),
  sectionInstanceId: z
    .string()
    .optional()
    .describe("Optional explicit section instance ID used inside the JSON template"),
  insertPosition: z
    .enum(["start", "end", "before", "after"])
    .default("end")
    .describe("Where to place the section in template.order"),
  referenceSectionId: z
    .string()
    .optional()
    .describe("Required when insertPosition is 'before' or 'after'"),
  sectionSettings: z
    .record(z.unknown())
    .optional()
    .describe("Optional initial settings for the section instance in template JSON"),
});

const SCHEMA_BLOCK_REGEX = /{%\s*schema\s*%}([\s\S]*?){%\s*endschema\s*%}/i;

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

const ensureSectionSchema = (liquid, { requirePresets }) => {
  const match = String(liquid || "").match(SCHEMA_BLOCK_REGEX);
  if (!match) {
    throw new Error(
      "Section Liquid mist een {% schema %} ... {% endschema %} blok. Zonder schema is Theme Editor-configuratie niet mogelijk."
    );
  }

  let schema;
  try {
    schema = JSON.parse(String(match[1] || "").trim());
  } catch (_error) {
    throw new Error("Section schema bevat ongeldige JSON.");
  }

  const sectionName = typeof schema?.name === "string" ? schema.name.trim() : "";
  if (!sectionName) {
    throw new Error("Section schema mist verplicht veld 'name'.");
  }

  const presets = Array.isArray(schema?.presets) ? schema.presets : [];
  if (requirePresets && presets.length === 0) {
    throw new Error(
      "Section schema mist 'presets'. Voeg minimaal 1 preset toe zodat de section in Theme Editor > Add section verschijnt."
    );
  }

  return {
    name: sectionName,
    presetsCount: presets.length,
  };
};

const ensureJsonTemplateStructure = (rawValue, templateKey) => {
  let parsed;
  try {
    parsed = JSON.parse(String(rawValue || ""));
  } catch (_error) {
    throw new Error(`Template '${templateKey}' bevat ongeldige JSON.`);
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Template '${templateKey}' heeft geen geldig object root.`);
  }

  if (!parsed.sections || typeof parsed.sections !== "object" || Array.isArray(parsed.sections)) {
    parsed.sections = {};
  }

  if (!Array.isArray(parsed.order)) {
    parsed.order = Object.keys(parsed.sections);
  }

  return parsed;
};

const normalizeTemplateSectionId = (rawId) => {
  const normalized = String(rawId || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "");
  return normalized || "";
};

const pickSectionInstanceId = (sectionHandle, explicitId, templateJson) => {
  const requested = normalizeTemplateSectionId(explicitId);
  if (requested) {
    return requested;
  }

  const existing = templateJson?.sections || {};
  const base = normalizeTemplateSectionId(sectionHandle).replace(/-/g, "_") || "custom_section";
  let candidate = base;
  let index = 2;
  while (Object.prototype.hasOwnProperty.call(existing, candidate)) {
    candidate = `${base}_${index}`;
    index += 1;
  }
  return candidate;
};

const insertSectionOrder = (order, sectionId, insertPosition, referenceSectionId) => {
  const nextOrder = Array.isArray(order) ? [...order] : [];
  const withoutCurrent = nextOrder.filter((entry) => entry !== sectionId);

  if (insertPosition === "start") {
    return [sectionId, ...withoutCurrent];
  }

  if (insertPosition === "end") {
    return [...withoutCurrent, sectionId];
  }

  const anchorId = String(referenceSectionId || "").trim();
  if (!anchorId) {
    throw new Error(`referenceSectionId is verplicht bij insertPosition='${insertPosition}'.`);
  }

  const anchorIndex = withoutCurrent.indexOf(anchorId);
  if (anchorIndex < 0) {
    throw new Error(`referenceSectionId '${anchorId}' niet gevonden in template.order.`);
  }

  if (insertPosition === "before") {
    withoutCurrent.splice(anchorIndex, 0, sectionId);
    return withoutCurrent;
  }

  withoutCurrent.splice(anchorIndex + 1, 0, sectionId);
  return withoutCurrent;
};

let shopifyClient;

const importSectionToLiveTheme = {
  name: "import-section-to-live-theme",
  description:
    "Import a generated Shopify section directly into a theme, with optional schema validation and template insertion.",
  schema: ImportSectionToLiveThemeInputSchema,
  initialize(client) {
    shopifyClient = client;
  },
  execute: async (input) => {
    try {
      const parsedInput = ImportSectionToLiveThemeInputSchema.parse(input);
      const normalizedHandle = normalizeSectionHandle(parsedInput.sectionHandle);
      const key = `sections/${normalizedHandle}.liquid`;
      const schemaSummary = parsedInput.validateSchema
        ? ensureSectionSchema(parsedInput.liquid, { requirePresets: parsedInput.requirePresets })
        : null;

      if (!parsedInput.overwrite) {
        try {
          await getThemeFile(shopifyClient, API_VERSION, {
            themeId: parsedInput.themeId,
            themeRole: parsedInput.themeRole,
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
        themeId: parsedInput.themeId,
        themeRole: parsedInput.themeRole,
        key,
        value: parsedInput.liquid,
      });

      let templateUpdate = null;
      if (parsedInput.addToTemplate) {
        const templateFile = await getThemeFile(shopifyClient, API_VERSION, {
          themeId: parsedInput.themeId,
          themeRole: parsedInput.themeRole,
          key: parsedInput.templateKey,
        });

        if (typeof templateFile?.asset?.value !== "string" || !templateFile.asset.value.trim()) {
          throw new Error(
            `Template '${parsedInput.templateKey}' bevat geen leesbare JSON tekst (asset.value ontbreekt).`
          );
        }

        const templateJson = ensureJsonTemplateStructure(templateFile.asset.value, parsedInput.templateKey);
        const sectionId = pickSectionInstanceId(normalizedHandle, parsedInput.sectionInstanceId, templateJson);

        templateJson.sections[sectionId] = {
          type: normalizedHandle,
          settings:
            parsedInput.sectionSettings && typeof parsedInput.sectionSettings === "object"
              ? parsedInput.sectionSettings
              : {},
        };
        templateJson.order = insertSectionOrder(
          templateJson.order,
          sectionId,
          parsedInput.insertPosition,
          parsedInput.referenceSectionId
        );

        const templateValue = `${JSON.stringify(templateJson, null, 2)}\n`;
        const templateWrite = await upsertThemeFile(shopifyClient, API_VERSION, {
          themeId: parsedInput.themeId,
          themeRole: parsedInput.themeRole,
          key: parsedInput.templateKey,
          value: templateValue,
        });

        templateUpdate = {
          key: parsedInput.templateKey,
          sectionId,
          position: parsedInput.insertPosition,
          referenceSectionId: parsedInput.referenceSectionId || null,
          orderLength: Array.isArray(templateJson.order) ? templateJson.order.length : null,
          checksum: templateWrite.asset?.checksum || null,
        };
      }

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
          overwritten: parsedInput.overwrite,
        },
        schema: schemaSummary,
        template: templateUpdate,
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
