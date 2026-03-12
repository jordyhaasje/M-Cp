import { ValidateShopifySectionBundleInputSchema } from "../section-workflow/contracts.js";
import { getSectionWorkflowOrchestrator } from "../section-workflow/orchestrator.js";

const validateShopifySectionBundle = {
  name: "validate-shopify-section-bundle",
  description: "Validate generated Shopify section bundles with schema and visual checks.",
  schema: ValidateShopifySectionBundleInputSchema,
  initialize() {
    // No-op; runtime dependencies are injected via orchestrator singleton.
  },
  execute: async (input, executionContext = {}) => {
    const orchestrator = getSectionWorkflowOrchestrator();
    if (!orchestrator) {
      throw new Error("Section workflow orchestrator is niet geconfigureerd.");
    }
    return orchestrator.validate(input, executionContext);
  },
};

export { validateShopifySectionBundle };
