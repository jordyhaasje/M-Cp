import {
  ReplicateSectionFromReferenceInputSchema,
  replicateSectionFromReferencePipeline,
} from "../lib/sectionReplicationV3.js";
import { CompatibilityMetadata } from "../section-workflow/contracts.js";
import { getSectionWorkflowOrchestrator } from "../section-workflow/orchestrator.js";

const API_VERSION = process.env.SHOPIFY_API_VERSION || "2026-01";

const compatMode = () => String(process.env.HAZIFY_SECTION_COMPAT_MODE || "staged").trim().toLowerCase();

const mapStageToLegacyFailure = (staged) => {
  const importResult = staged.importResult;
  const validateResult = staged.validateResult;
  const generateResult = staged.generateResult;
  const inspectResult = staged.inspectResult;

  const errorSource =
    importResult?.errors?.[0] ||
    validateResult?.errors?.[0] ||
    generateResult?.errors?.[0] ||
    inspectResult?.errors?.[0] ||
    null;

  const errorCode = errorSource?.code || "runtime_error";

  return {
    action: "replicate_section_from_reference",
    status: "fail",
    errorCode,
    message: `Section replicatie faalde: ${errorCode}`,
    archetype: null,
    confidence: 0,
    validation: {
      status: "fail",
      checks: {
        themeContext: {
          name: "themeContext",
          status: "fail",
          issues: [],
        },
        schema: {
          name: "schema",
          status: "fail",
          issues: [],
        },
        bundle: {
          name: "bundle",
          status: "fail",
          issues: [],
        },
        visual: {
          name: "visual",
          status: "fail",
          issues: [],
        },
      },
      issues: [errorSource].filter(Boolean),
    },
    visualGate: {
      status: "fail",
      perViewport: [
        { id: "desktop", pass: false, mismatchRatio: 1, threshold: 0.12, error: errorCode },
        { id: "mobile", pass: false, mismatchRatio: 1, threshold: 0.15, error: errorCode },
      ],
    },
    writes: null,
    policy: {
      writesAllowed: false,
      manualFallbackAllowed: false,
      nextAction: "stop_and_report_failure",
    },
    compat: CompatibilityMetadata,
    artifacts: {
      inspectionId: inspectResult?.inspectionId || null,
      bundleId: generateResult?.bundleId || null,
      validationId: validateResult?.validationId || null,
      importId: importResult?.importId || null,
    },
  };
};

const mapStageToLegacySuccess = (staged) => {
  const validateResult = staged.validateResult;
  const importResult = staged.importResult;
  const visual = validateResult?.visualValidation || {};

  return {
    action: "replicate_section_from_reference",
    status: "pass",
    archetype: "staged-orchestration",
    confidence: 1,
    validation: {
      status: validateResult?.status === "pass" ? "pass" : "fail",
      checks: {
        themeContext: {
          name: "themeContext",
          status: validateResult?.resolvedTheme ? "pass" : "fail",
          issues: [],
        },
        schema: {
          name: "schema",
          status: validateResult?.schemaValidation?.status || "pass",
          issues: validateResult?.schemaValidation?.issues || [],
        },
        bundle: {
          name: "bundle",
          status: "pass",
          issues: [],
        },
        visual: {
          name: "visual",
          status: visual.status || "pass",
          issues: visual.issues || [],
        },
      },
      issues: [...(validateResult?.errors || []), ...(validateResult?.warnings || [])],
    },
    visualGate: {
      status: visual.status || "pass",
      perViewport: visual.perViewport || [],
    },
    writes: {
      theme: importResult?.resolvedTheme || null,
      section: importResult?.writes?.section || null,
      template: importResult?.writes?.template || null,
      additionalFiles: importResult?.writes?.additionalFiles || [],
      verification: importResult?.verification || null,
      rollback: importResult?.rollback || null,
    },
    policy: {
      writesAllowed: true,
      manualFallbackAllowed: false,
      nextAction: "verify_readback",
    },
    compat: CompatibilityMetadata,
    artifacts: {
      inspectionId: staged.inspectResult?.inspectionId || null,
      bundleId: staged.generateResult?.bundleId || null,
      validationId: staged.validateResult?.validationId || null,
      importId: staged.importResult?.importId || null,
    },
  };
};

let shopifyClient;
let legacyExecutor = replicateSectionFromReferencePipeline;

export const __setReplicateSectionCompatRuntimeForTests = ({ legacyExecutorOverride } = {}) => {
  legacyExecutor = legacyExecutorOverride || replicateSectionFromReferencePipeline;
};

const replicateSectionFromReferenceCompat = {
  name: "replicate-section-from-reference",
  description:
    "Compatibility wrapper: routes replicate-section-from-reference to staged orchestration (or legacy v3 fallback during migration).",
  schema: ReplicateSectionFromReferenceInputSchema,
  initialize(client) {
    shopifyClient = client;
  },
  execute: async (input, executionContext = {}) => {
    const parsed = ReplicateSectionFromReferenceInputSchema.parse(input);
    const mode = compatMode();

    if (mode !== "staged") {
      const result = await legacyExecutor({
        shopifyClient: executionContext?.shopifyClient || shopifyClient,
        apiVersion: API_VERSION,
        input: parsed,
      });
      return {
        ...result,
        compat: CompatibilityMetadata,
        artifacts: {
          inspectionId: null,
          bundleId: null,
          validationId: null,
          importId: null,
        },
      };
    }

    const orchestrator = getSectionWorkflowOrchestrator();
    if (!orchestrator) {
      const fallback = await legacyExecutor({
        shopifyClient: executionContext?.shopifyClient || shopifyClient,
        apiVersion: API_VERSION,
        input: parsed,
      });
      return {
        ...fallback,
        compat: CompatibilityMetadata,
        artifacts: {
          inspectionId: null,
          bundleId: null,
          validationId: null,
          importId: null,
        },
      };
    }

    const staged = await orchestrator.runCompat(parsed, executionContext);
    if (staged.status !== "pass") {
      return mapStageToLegacyFailure(staged);
    }
    return mapStageToLegacySuccess(staged);
  },
};

export { replicateSectionFromReferenceCompat };
