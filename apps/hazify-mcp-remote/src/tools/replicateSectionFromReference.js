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
      throw new Error(
        `Failed to replicate section from reference: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  },
};

export { replicateSectionFromReference };
