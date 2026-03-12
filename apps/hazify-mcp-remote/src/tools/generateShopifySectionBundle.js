import { GenerateShopifySectionBundleInputSchema } from "../section-workflow/contracts.js";
import { getSectionWorkflowOrchestrator } from "../section-workflow/orchestrator.js";

const generateShopifySectionBundle = {
  name: "generate-shopify-section-bundle",
  description: "Generate a Shopify section bundle from an inspection artifact.",
  schema: GenerateShopifySectionBundleInputSchema,
  initialize() {
    // No-op; runtime dependencies are injected via orchestrator singleton.
  },
  execute: async (input, executionContext = {}) => {
    const orchestrator = getSectionWorkflowOrchestrator();
    if (!orchestrator) {
      throw new Error("Section workflow orchestrator is niet geconfigureerd.");
    }
    return orchestrator.generate(input, executionContext);
  },
};

export { generateShopifySectionBundle };
