import { ApplySectionReplicaInputSchema, applySectionReplicaPlan } from "../lib/sectionReplica.js";

const API_VERSION = process.env.SHOPIFY_API_VERSION || "2026-01";

let shopifyClient;

const applySectionReplica = {
  name: "apply-section-replica",
  description:
    "Deterministic phase 2 for section replication: applies a previously prepared plan and writes section/template/assets.",
  schema: ApplySectionReplicaInputSchema,
  initialize(client) {
    shopifyClient = client;
  },
  execute: async (input) => {
    try {
      return await applySectionReplicaPlan({
        shopifyClient,
        apiVersion: API_VERSION,
        input,
      });
    } catch (error) {
      console.error("Error applying section replica:", error);
      throw new Error(
        `Failed to apply section replica: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  },
};

export { applySectionReplica };
