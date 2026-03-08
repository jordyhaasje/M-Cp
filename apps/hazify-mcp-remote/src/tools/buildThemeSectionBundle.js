import { z } from "zod";
import { getThemeFile, upsertThemeFile } from "../lib/themeFiles.js";
import { importSectionToLiveTheme } from "./importSectionToLiveTheme.js";

const API_VERSION = process.env.SHOPIFY_API_VERSION || "2026-01";
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

const ALLOWED_ADDITIONAL_PREFIXES = ["assets/", "snippets/", "locales/", "blocks/"];
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

function assertAllowedAdditionalKey(key) {
  const normalized = String(key || "").trim().toLowerCase();
  const allowed = ALLOWED_ADDITIONAL_PREFIXES.some((prefix) => normalized.startsWith(prefix));

  if (!allowed) {
    throw new Error(
      `additionalFiles key '${key}' is niet toegestaan. Gebruik alleen: ${ALLOWED_ADDITIONAL_PREFIXES.join(", ")}`
    );
  }

  if (normalized.startsWith("sections/") || normalized.startsWith("templates/")) {
    throw new Error(
      `Gebruik section/template velden van build-theme-section-bundle voor '${key}', niet additionalFiles.`
    );
  }
}

const summarizeAssetRead = (asset) => {
  const valueSize = typeof asset?.value === "string" ? Buffer.byteLength(asset.value, "utf8") : null;
  const attachmentSize = typeof asset?.attachment === "string" ? asset.attachment.length : null;

  return {
    key: asset?.key || null,
    checksum: asset?.checksum || null,
    valueBytes: valueSize,
    hasAttachment: Boolean(asset?.attachment),
    attachmentLength: attachmentSize,
  };
};

let shopifyClient;

const buildThemeSectionBundle = {
  name: "build-theme-section-bundle",
  description:
    "Primary AI workflow for Shopify sections: writes section, maps template order, writes supporting assets/snippets, and verifies output.",
  schema: BuildThemeSectionBundleInputSchema,
  initialize(client) {
    shopifyClient = client;
    importSectionToLiveTheme.initialize(client);
  },
  execute: async (input) => {
    try {
      const parsed = BuildThemeSectionBundleInputSchema.parse(input);

      const sectionResult = await importSectionToLiveTheme.execute({
        sectionHandle: parsed.sectionHandle,
        liquid: parsed.sectionLiquid,
        themeId: parsed.themeId,
        themeRole: parsed.themeRole,
        overwrite: parsed.overwriteSection,
        validateSchema: true,
        requirePresets: true,
        addToTemplate: parsed.addToTemplate,
        templateKey: parsed.templateKey,
        sectionInstanceId: parsed.sectionInstanceId,
        insertPosition: parsed.insertPosition,
        referenceSectionId: parsed.referenceSectionId,
        sectionSettings: parsed.sectionSettings,
      });

      const additionalWrites = [];
      for (const file of parsed.additionalFiles) {
        assertAllowedAdditionalKey(file.key);

        const writeResult = await upsertThemeFile(shopifyClient, API_VERSION, {
          themeId: parsed.themeId,
          themeRole: parsed.themeRole,
          key: file.key,
          value: file.value,
          attachment: file.attachment,
          checksum: file.checksum,
        });

        additionalWrites.push({
          key: file.key,
          checksum: writeResult.asset?.checksum || null,
          mode: typeof file.value === "string" ? "value" : "attachment",
        });
      }

      if (!parsed.verify) {
        return {
          action: "built_theme_section_bundle",
          theme: sectionResult.theme,
          section: sectionResult.section,
          template: sectionResult.template,
          additionalFiles: additionalWrites,
          verification: { skipped: true },
          references: {
            sourceUrl: parsed.referenceUrl || null,
            designNotes: parsed.designNotes || null,
          },
          docs: SHOPIFY_THEME_DOCS,
        };
      }

      const verification = {
        section: null,
        template: null,
        additionalFiles: [],
      };

      const sectionRead = await getThemeFile(shopifyClient, API_VERSION, {
        themeId: parsed.themeId,
        themeRole: parsed.themeRole,
        key: sectionResult.section.key,
      });
      verification.section = summarizeAssetRead(sectionRead.asset);

      if (parsed.addToTemplate) {
        const templateRead = await getThemeFile(shopifyClient, API_VERSION, {
          themeId: parsed.themeId,
          themeRole: parsed.themeRole,
          key: parsed.templateKey,
        });

        verification.template = summarizeAssetRead(templateRead.asset);
      }

      for (const write of additionalWrites) {
        const fileRead = await getThemeFile(shopifyClient, API_VERSION, {
          themeId: parsed.themeId,
          themeRole: parsed.themeRole,
          key: write.key,
        });

        verification.additionalFiles.push(summarizeAssetRead(fileRead.asset));
      }

      return {
        action: "built_theme_section_bundle",
        theme: sectionResult.theme,
        section: sectionResult.section,
        template: sectionResult.template,
        additionalFiles: additionalWrites,
        verification,
        references: {
          sourceUrl: parsed.referenceUrl || null,
          designNotes: parsed.designNotes || null,
        },
        docs: SHOPIFY_THEME_DOCS,
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
