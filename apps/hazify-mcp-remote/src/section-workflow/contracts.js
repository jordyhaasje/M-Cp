import { z } from "zod";

export const SHARED_IMAGE_BASE64_MAX_CHARS = 8 * 1024 * 1024;

const ThemeRoleSchema = z.enum(["main", "unpublished", "demo", "development"]);

const SharedImageSchema = z
  .object({
    imageUrl: z.string().url().optional(),
    imageBase64: z
      .string()
      .min(1)
      .max(
        SHARED_IMAGE_BASE64_MAX_CHARS,
        `imageBase64 is te groot (max ${SHARED_IMAGE_BASE64_MAX_CHARS} tekens).`
      )
      .optional(),
    mimeType: z.enum(["image/png", "image/jpeg", "image/webp"]).optional(),
  })
  .superRefine((value, ctx) => {
    const hasUrl = typeof value.imageUrl === "string" && value.imageUrl.length > 0;
    const hasBase64 = typeof value.imageBase64 === "string" && value.imageBase64.length > 0;

    if (hasUrl && hasBase64) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["imageBase64"],
        message: "Gebruik ofwel imageUrl of imageBase64, niet allebei.",
      });
    }

    if (hasBase64 && !value.mimeType) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["mimeType"],
        message: "mimeType is verplicht wanneer imageBase64 is opgegeven.",
      });
    }
  });

export const InspectReferenceSectionInputSchema = z.object({
  referenceUrl: z.string().url(),
  sharedImage: SharedImageSchema.optional(),
  visionHints: z.string().max(12000).optional(),
  targetHint: z.string().max(400).optional(),
  viewports: z.array(z.enum(["desktop", "mobile"])) .min(1).max(2).default(["desktop", "mobile"]),
  timeoutMs: z.number().int().min(5000).max(60000).default(30000),
});

export const GenerateShopifySectionBundleInputSchema = z.object({
  inspectionId: z.string().min(1),
  sectionHandle: z.string().min(1).optional(),
  sectionName: z.string().min(1).optional(),
  templateHint: z.string().default("templates/index.json"),
  generationHints: z.record(z.unknown()).optional(),
  maxBlocks: z.number().int().min(1).max(24).default(12),
});

export const ValidateShopifySectionBundleInputSchema = z.object({
  bundleId: z.string().min(1),
  themeId: z.coerce.number().int().positive().optional(),
  themeRole: ThemeRoleSchema.default("main"),
  templateKey: z.string().default("templates/index.json"),
  visualMode: z.enum(["reference-only", "theme-preview"]).default("reference-only"),
  strict: z.boolean().default(true),
  thresholds: z
    .object({
      desktopMismatch: z.number().min(0).max(1).default(0.12),
      mobileMismatch: z.number().min(0).max(1).default(0.15),
    })
    .default({ desktopMismatch: 0.12, mobileMismatch: 0.15 }),
});

export const ImportShopifySectionBundleInputSchema = z
  .object({
    validationId: z.string().min(1).optional(),
    bundleId: z.string().min(1).optional(),
    themeId: z.coerce.number().int().positive().optional(),
    themeRole: ThemeRoleSchema.default("main"),
    templateKey: z.string().default("templates/index.json"),
    insertPosition: z.enum(["start", "end", "before", "after"]).default("end"),
    referenceSectionId: z.string().optional(),
    sectionInstanceId: z.string().optional(),
    sectionSettings: z.record(z.unknown()).optional(),
    overwriteSection: z.boolean().default(false),
    verify: z.boolean().default(true),
    rollbackOnFailure: z.boolean().default(true),
  })
  .superRefine((value, ctx) => {
    if (!value.validationId && !value.bundleId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["validationId"],
        message: "Geef validationId of bundleId op.",
      });
    }
    if (value.insertPosition === "before" || value.insertPosition === "after") {
      if (!value.referenceSectionId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["referenceSectionId"],
          message: "referenceSectionId is verplicht bij insertPosition before/after.",
        });
      }
    }
  });

export const ArtifactTypeSchema = z.enum(["inspection", "bundle", "validation", "import"]);

export const ArtifactRecordSchema = z.object({
  artifactId: z.string().min(1),
  tenantId: z.string().min(1),
  type: ArtifactTypeSchema,
  status: z.enum(["pass", "fail", "partial"]),
  parentIds: z.array(z.string()).default([]),
  payload: z.record(z.unknown()),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  lastAccessedAt: z.string().min(1),
  expiresAt: z.string().min(1),
  version: z.string().default("section-workflow-v1"),
});

export const CompatibilityMetadata = Object.freeze({
  deprecated: true,
  replacementTools: [
    "inspect-reference-section",
    "generate-shopify-section-bundle",
    "validate-shopify-section-bundle",
    "import-shopify-section-bundle",
  ],
});
