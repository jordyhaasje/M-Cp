import { PrepareSectionReplicaInputSchema, prepareSectionReplicaPlan } from "../lib/sectionReplica.js";

const API_VERSION = process.env.SHOPIFY_API_VERSION || "2026-01";

let shopifyClient;

const prepareSectionReplica = {
  name: "prepare-section-replica",
  description:
    "Deterministic phase 1 for section replication: accepts referenceUrl + optional imageUrls, auto-generates SectionSpec when omitted, and stores a validated plan.",
  schema: PrepareSectionReplicaInputSchema,
  initialize(client) {
    shopifyClient = client;
  },
  execute: async (input) => {
    try {
      return await prepareSectionReplicaPlan({
        shopifyClient,
        apiVersion: API_VERSION,
        input,
      });
    } catch (error) {
      console.error("Error preparing section replica:", error);
      throw new Error(
        `Failed to prepare section replica: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  },
};

export { prepareSectionReplica };
