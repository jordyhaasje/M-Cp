import { resolveArtifactTtlConfig } from "./artifacts/artifact-ttl.js";
import { runInspectStage } from "./stages/inspect-stage.js";
import { runGenerateStage } from "./stages/generate-stage.js";
import { runValidateStage } from "./stages/validate-stage.js";
import { runImportStage } from "./stages/import-stage.js";

export class SectionWorkflowOrchestrator {
  constructor({ artifactStore, chromeInspector, shopifyDevValidator, themeImportAdapter, ttlConfig } = {}) {
    this.artifactStore = artifactStore;
    this.chromeInspector = chromeInspector;
    this.shopifyDevValidator = shopifyDevValidator;
    this.themeImportAdapter = themeImportAdapter;
    this.ttlConfig = ttlConfig || resolveArtifactTtlConfig();
  }

  buildRuntime(executionContext = {}) {
    return {
      artifactStore: this.artifactStore,
      chromeInspector: this.chromeInspector,
      shopifyDevValidator: this.shopifyDevValidator,
      themeImportAdapter: this.themeImportAdapter,
      ttlConfig: this.ttlConfig,
      executionContext,
    };
  }

  async inspect(input, executionContext = {}) {
    return runInspectStage({ input, runtime: this.buildRuntime(executionContext) });
  }

  async generate(input, executionContext = {}) {
    return runGenerateStage({ input, runtime: this.buildRuntime(executionContext) });
  }

  async validate(input, executionContext = {}) {
    return runValidateStage({ input, runtime: this.buildRuntime(executionContext) });
  }

  async importBundle(input, executionContext = {}) {
    return runImportStage({ input, runtime: this.buildRuntime(executionContext) });
  }

  async runCompat(input, executionContext = {}) {
    const inspectResult = await this.inspect(
      {
        referenceUrl: input.referenceUrl,
        visionHints: input.visionHints,
        targetHint: input.sectionHandle,
        sharedImage: null,
      },
      executionContext
    );

    if (inspectResult.status !== "pass" || !inspectResult.inspectionId) {
      return {
        status: "fail",
        inspectResult,
        generateResult: null,
        validateResult: null,
        importResult: null,
      };
    }

    const generateResult = await this.generate(
      {
        inspectionId: inspectResult.inspectionId,
        sectionHandle: input.sectionHandle,
        sectionName: input.sectionHandle,
        templateHint: input.templateKey || "templates/index.json",
      },
      executionContext
    );

    if (generateResult.status !== "pass" || !generateResult.bundleId) {
      return {
        status: "fail",
        inspectResult,
        generateResult,
        validateResult: null,
        importResult: null,
      };
    }

    const validateResult = await this.validate(
      {
        bundleId: generateResult.bundleId,
        themeId: input.themeId,
        themeRole: input.themeRole || "main",
        templateKey: input.templateKey || "templates/index.json",
        visualMode: "reference-only",
        strict: true,
      },
      executionContext
    );

    if (validateResult.status !== "pass" || !validateResult.validationId) {
      return {
        status: "fail",
        inspectResult,
        generateResult,
        validateResult,
        importResult: null,
      };
    }

    const importResult = await this.importBundle(
      {
        validationId: validateResult.validationId,
        bundleId: generateResult.bundleId,
        themeId: input.themeId,
        themeRole: input.themeRole || "main",
        templateKey: input.templateKey || "templates/index.json",
        insertPosition: input.insertPosition || "end",
        referenceSectionId: input.referenceSectionId,
        sectionInstanceId: input.sectionInstanceId,
        sectionSettings: input.sectionSettings,
        overwriteSection: Boolean(input.overwriteSection),
        verify: input.verify !== false,
        rollbackOnFailure: true,
      },
      executionContext
    );

    return {
      status: importResult.status,
      inspectResult,
      generateResult,
      validateResult,
      importResult,
    };
  }
}

let orchestratorSingleton = null;

export const setSectionWorkflowOrchestrator = (orchestrator) => {
  orchestratorSingleton = orchestrator;
};

export const getSectionWorkflowOrchestrator = () => orchestratorSingleton;
