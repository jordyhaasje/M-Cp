import { InspectReferenceSectionInputSchema } from "../section-workflow/contracts.js";
import { getSectionWorkflowOrchestrator } from "../section-workflow/orchestrator.js";

const inspectReferenceSection = {
  name: "inspect-reference-section",
  description: "Inspect a reference URL and optional shared image via Chrome/browser capabilities.",
  schema: InspectReferenceSectionInputSchema,
  initialize() {
    // No-op; runtime dependencies are injected via orchestrator singleton.
  },
  execute: async (input, executionContext = {}) => {
    const orchestrator = getSectionWorkflowOrchestrator();
    if (!orchestrator) {
      throw new Error("Section workflow orchestrator is niet geconfigureerd.");
    }
    return orchestrator.inspect(input, executionContext);
  },
};

export { inspectReferenceSection };
