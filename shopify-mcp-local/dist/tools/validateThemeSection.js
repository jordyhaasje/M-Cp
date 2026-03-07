import { z } from "zod";
import { validateThemeSectionInput } from "../lib/themeSections.js";

const ValidateThemeSectionInputSchema = z.object({
  sectionHandle: z.string().min(1),
  liquid: z.string().min(1),
  targetTemplate: z.string().optional(),
});

const validateThemeSection = {
  name: "validate-theme-section",
  description: "Preflight validation for Shopify section Liquid before writing theme files.",
  schema: ValidateThemeSectionInputSchema,
  initialize() {},
  execute: async (input) => {
    const validation = validateThemeSectionInput(input);
    return {
      valid: validation.valid,
      errors: validation.errors,
      warnings: validation.warnings,
      sectionHandle: validation.sectionHandle,
      sectionFilename: validation.sectionFilename,
      targetTemplate: validation.targetTemplate,
      schema: validation.schema,
      sizeBytes: validation.sizeBytes,
      readyForWrite: validation.valid,
    };
  },
};

export { validateThemeSection };
