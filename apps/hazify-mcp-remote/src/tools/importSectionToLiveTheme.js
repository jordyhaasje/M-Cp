import { z } from "zod";
import {
  applySectionReplicaPlan,
  parseLegacySectionLiquid,
  prepareSectionReplicaPlan,
} from "../lib/sectionReplica.js";

const API_VERSION = process.env.SHOPIFY_API_VERSION || "2026-01";
const ENABLE_LEGACY_SECTION_WRAPPERS =
  String(process.env.HAZIFY_ENABLE_LEGACY_SECTION_WRAPPERS || "false").toLowerCase() === "true";
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

let shopifyClient;

const importSectionToLiveTheme = {
  name: "import-section-to-live-theme",
  description:
    "Legacy compatibility wrapper. Uses Section Replication v2 (prepare/apply) internally and returns deprecation metadata.",
  schema: ImportSectionToLiveThemeInputSchema,
  initialize(client) {
    shopifyClient = client;
  },
  execute: async (input) => {
    try {
      if (!ENABLE_LEGACY_SECTION_WRAPPERS) {
        throw new Error(
          "import-section-to-live-theme is uitgeschakeld. Gebruik prepare-section-replica gevolgd door apply-section-replica."
        );
      }

      const parsedInput = ImportSectionToLiveThemeInputSchema.parse(input);

      const sectionSpec = parseLegacySectionLiquid({
        liquid: parsedInput.liquid,
        sectionHandle: parsedInput.sectionHandle,
        validateSchema: parsedInput.validateSchema,
        requirePresets: parsedInput.requirePresets,
      });

      const prepared = await prepareSectionReplicaPlan({
        shopifyClient,
        apiVersion: API_VERSION,
        input: {
          referenceUrl: "https://example.com/",
          imageUrls: [],
          previewRequired: false,
          sectionHandle: parsedInput.sectionHandle,
          sectionSpec,
          themeId: parsedInput.themeId,
          themeRole: parsedInput.themeRole,
          overwriteSection: parsedInput.overwrite,
          addToTemplate: parsedInput.addToTemplate,
          templateKey: parsedInput.templateKey,
          sectionInstanceId: parsedInput.sectionInstanceId,
          insertPosition: parsedInput.insertPosition,
          referenceSectionId: parsedInput.referenceSectionId,
          sectionSettings: parsedInput.sectionSettings,
          additionalFiles: [],
          applyOn: "warn",
          sourceTool: "import-section-to-live-theme",
        },
      });

      const applied = await applySectionReplicaPlan({
        shopifyClient,
        apiVersion: API_VERSION,
        input: {
          planId: prepared.planId,
          allowWarn: true,
          verify: true,
        },
      });

      return {
        action: "imported_section",
        theme: applied.theme,
        section: {
          handle: applied.section.handle,
          key: applied.section.key,
          overwritten: parsedInput.overwrite,
        },
        schema: applied.section.schema,
        template: applied.template,
        sectionReplica: {
          planId: prepared.planId,
          preflight: prepared.validation.preflight,
        },
        deprecation: {
          status: "deprecated_wrapper",
          message:
            "import-section-to-live-theme is deprecated. Gebruik prepare-section-replica + apply-section-replica.",
          replacementTools: ["prepare-section-replica", "apply-section-replica"],
          sunset: "TBD",
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
