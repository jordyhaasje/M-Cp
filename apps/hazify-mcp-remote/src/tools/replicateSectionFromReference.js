import {
  ReplicateSectionFromReferenceInputSchema,
  replicateSectionFromReferencePipeline,
} from "../lib/sectionReplicationV3.js";

const API_VERSION = process.env.SHOPIFY_API_VERSION || "2026-01";

let shopifyClient;

const replicateSectionFromReference = {
  name: "replicate-section-from-reference",
  description:
    "Section Replication v3 autopipeline: capture -> detect archetype -> generate bundle -> strict visual gate -> apply to Shopify theme.",
  schema: ReplicateSectionFromReferenceInputSchema,
  initialize(client) {
    shopifyClient = client;
  },
  execute: async (input) => {
    try {
      return await replicateSectionFromReferencePipeline({
        shopifyClient,
        apiVersion: API_VERSION,
        input,
      });
    } catch (error) {
      console.error("Error replicating section from reference:", error);
      const message = error instanceof Error ? error.message : String(error);
      return {
        action: "replicate_section_from_reference",
        status: "fail",
        errorCode: "reference_unreachable",
        message: `Section replication v3 faalde door onverwachte runtime fout: ${message}`,
        archetype: null,
        confidence: 0,
        validation: {
          status: "fail",
          checks: {
            themeContext: { name: "themeContext", status: "pass", issues: [] },
            schema: { name: "schema", status: "pass", issues: [] },
            bundle: {
              name: "bundle",
              status: "fail",
              issues: [{ severity: "error", code: "runtime_error", message }],
            },
            visual: { name: "visual", status: "pass", issues: [] },
          },
          issues: [{ severity: "error", code: "runtime_error", message }],
        },
        visualGate: {
          status: "fail",
          perViewport: [
            { id: "desktop", pass: false, mismatchRatio: 1, threshold: 0.12, error: "runtime_error" },
            { id: "mobile", pass: false, mismatchRatio: 1, threshold: 0.15, error: "runtime_error" },
          ],
        },
        writes: null,
        policy: {
          writesAllowed: false,
          manualFallbackAllowed: false,
          nextAction: "stop_and_report_failure",
        },
        attempts: [],
        telemetry: {
          pipeline: "section-replication-v3",
          generatedAt: new Date().toISOString(),
        },
      };
    }
  },
};

export { replicateSectionFromReference };
