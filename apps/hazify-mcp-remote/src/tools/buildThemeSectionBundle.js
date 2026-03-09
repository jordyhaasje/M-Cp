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

const BundleFileSchema = z
  .object({
    key: z.string().min(1).describe("Theme file key, e.g. assets/section-bubble-menu.css"),
    value: z.string().optional().describe("Text content for Liquid/JSON/CSS/JS files"),
    attachment: z.string().optional().describe("Base64 content for binary files"),
    checksum: z.string().optional(),
  })
  .superRefine((input, ctx) => {
    const hasValue = typeof input.value === "string";
    const hasAttachment = typeof input.attachment === "string";

    if (!hasValue && !hasAttachment) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["value"],
        message: "Provide either 'value' or 'attachment' for additional files.",
      });
    }

    if (hasValue && hasAttachment) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["attachment"],
        message: "Use either 'value' or 'attachment', not both.",
      });
    }
  });

const BuildThemeSectionBundleInputSchema = z.object({
  sectionHandle: z.string().min(1).describe("Section handle, e.g. bubble-navigation"),
  sectionLiquid: z.string().min(1).describe("Full section Liquid including {% schema %} and presets"),
  themeId: z.coerce.number().int().positive().optional(),
  themeRole: ThemeRoleSchema.default("main"),
  overwriteSection: z.boolean().default(false).describe("Overwrite existing section file when true"),
  addToTemplate: z.boolean().default(true).describe("Insert section into JSON template sections + order"),
  templateKey: z.string().default("templates/index.json"),
  sectionInstanceId: z.string().optional(),
  insertPosition: z.enum(["start", "end", "before", "after"]).default("end"),
  referenceSectionId: z.string().optional(),
  sectionSettings: z.record(z.unknown()).optional(),
  additionalFiles: z
    .array(BundleFileSchema)
    .max(20)
    .default([])
    .describe("Optional supporting files like assets/*.css, assets/*.js, snippets/*.liquid"),
  verify: z.boolean().default(true).describe("Re-read written files to confirm they exist"),
  referenceUrl: z.string().url().optional().describe("Reference URL used by AI for design extraction"),
  designNotes: z.string().optional().describe("Optional brief/context from user request"),
});

const SHOPIFY_THEME_DOCS = [
  {
    title: "Shopify Sections architecture",
    url: "https://shopify.dev/docs/storefronts/themes/architecture/sections",
  },
  {
    title: "Shopify Section schema",
    url: "https://shopify.dev/docs/storefronts/themes/architecture/sections/section-schema",
  },
  {
    title: "Shopify JSON templates",
    url: "https://shopify.dev/docs/storefronts/themes/architecture/templates/json-templates",
  },
  {
    title: "Shopify Liquid reference",
    url: "https://shopify.dev/docs/api/liquid",
  },
];

let shopifyClient;

const buildThemeSectionBundle = {
  name: "build-theme-section-bundle",
  description:
    "Legacy compatibility wrapper. Uses Section Replication v2 (prepare/apply) internally and returns deprecation metadata.",
  schema: BuildThemeSectionBundleInputSchema,
  initialize(client) {
    shopifyClient = client;
  },
  execute: async (input) => {
    try {
      if (!ENABLE_LEGACY_SECTION_WRAPPERS) {
        throw new Error(
          "build-theme-section-bundle is uitgeschakeld. Gebruik prepare-section-replica gevolgd door apply-section-replica."
        );
      }

      const parsed = BuildThemeSectionBundleInputSchema.parse(input);

      const sectionSpec = parseLegacySectionLiquid({
        liquid: parsed.sectionLiquid,
        sectionHandle: parsed.sectionHandle,
        validateSchema: true,
        requirePresets: true,
      });

      const prepared = await prepareSectionReplicaPlan({
        shopifyClient,
        apiVersion: API_VERSION,
        input: {
          referenceUrl: parsed.referenceUrl || "https://example.com/",
          imageUrls: [],
          previewRequired: false,
          sectionHandle: parsed.sectionHandle,
          sectionSpec,
          themeId: parsed.themeId,
          themeRole: parsed.themeRole,
          overwriteSection: parsed.overwriteSection,
          addToTemplate: parsed.addToTemplate,
          templateKey: parsed.templateKey,
          sectionInstanceId: parsed.sectionInstanceId,
          insertPosition: parsed.insertPosition,
          referenceSectionId: parsed.referenceSectionId,
          sectionSettings: parsed.sectionSettings,
          additionalFiles: parsed.additionalFiles,
          applyOn: "warn",
          sourceTool: "build-theme-section-bundle",
        },
      });

      const applied = await applySectionReplicaPlan({
        shopifyClient,
        apiVersion: API_VERSION,
        input: {
          planId: prepared.planId,
          allowWarn: true,
          verify: parsed.verify,
        },
      });

      return {
        action: "built_theme_section_bundle",
        theme: applied.theme,
        section: applied.section,
        template: applied.template,
        additionalFiles: applied.additionalFiles,
        verification: applied.verification,
        references: {
          sourceUrl: parsed.referenceUrl || null,
          designNotes: parsed.designNotes || null,
        },
        docs: SHOPIFY_THEME_DOCS,
        sectionReplica: {
          planId: prepared.planId,
          preflight: prepared.validation.preflight,
          previewTargets: prepared.previewTargets,
        },
        deprecation: {
          status: "deprecated_wrapper",
          message:
            "build-theme-section-bundle is deprecated. Gebruik prepare-section-replica + apply-section-replica.",
          replacementTools: ["prepare-section-replica", "apply-section-replica"],
          sunset: "TBD",
        },
      };
    } catch (error) {
      console.error("Error building theme section bundle:", error);
      throw new Error(
        `Failed to build theme section bundle: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  },
};

export { buildThemeSectionBundle };
