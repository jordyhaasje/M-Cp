import { ImportShopifySectionBundleInputSchema } from "../section-workflow/contracts.js";
import { getSectionWorkflowOrchestrator } from "../section-workflow/orchestrator.js";

const importShopifySectionBundle = {
  name: "import-shopify-section-bundle",
  description: "Import a validated Shopify section bundle into a target theme.",
  schema: ImportShopifySectionBundleInputSchema,
  initialize() {
    // No-op; runtime dependencies are injected via orchestrator singleton.
  },
  execute: async (input, executionContext = {}) => {
    const orchestrator = getSectionWorkflowOrchestrator();
    if (!orchestrator) {
      throw new Error("Section workflow orchestrator is niet geconfigureerd.");
    }
    return orchestrator.importBundle(input, executionContext);
  },
};

export { importShopifySectionBundle };
