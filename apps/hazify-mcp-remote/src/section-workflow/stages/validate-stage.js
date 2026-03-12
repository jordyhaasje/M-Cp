import { ValidateShopifySectionBundleInputSchema } from "../contracts.js";
import { createIssue, normalizeUnknownError, toBlockingAndWarnings } from "../error-model.js";
import { generateArtifactId } from "../artifacts/artifact-id.js";
import { expiresAtIso } from "../artifacts/artifact-ttl.js";

const isoNow = () => new Date().toISOString();

const collectIssues = (...groups) => {
  const all = [];
  for (const group of groups) {
    if (!Array.isArray(group)) {
      continue;
    }
    for (const issue of group) {
      if (issue && typeof issue === "object") {
        all.push(issue);
      }
    }
  }
  return all;
};

export const runValidateStage = async ({ input, runtime }) => {
  const parsedInput = ValidateShopifySectionBundleInputSchema.safeParse(input);
  if (!parsedInput.success) {
    const errors = parsedInput.error.issues.map((entry) =>
      createIssue({
        code: "invalid_input",
        stage: "validation",
        severity: "error",
        blocking: true,
        source: "hazify",
        message: `Input '${entry.path.join(".") || "root"}' is ongeldig: ${entry.message}`,
      })
    );
    return {
      action: "validate_shopify_section_bundle",
      stage: "validation",
      status: "fail",
      performedBy: ["shopify-dev-mcp", "chrome-mcp", "hazify"],
      validationId: null,
      bundleId: String(input?.bundleId || ""),
      resolvedTheme: null,
      schemaValidation: { status: "fail", source: "shopify-dev-mcp", issues: errors },
      visualValidation: {
        status: "fail",
        source: "chrome-mcp",
        perViewport: [],
        issues: [],
      },
      importReadiness: { ready: false, blockingIssues: errors, warnings: [] },
      errors,
      warnings: [],
      nextRecommendedTool: "none",
    };
  }

  const normalizedInput = parsedInput.data;
  const tenantId = String(runtime.executionContext?.tenantId || "stdio-local");
  const shopifyClient = runtime.executionContext?.shopifyClient;

  if (!shopifyClient) {
    const issue = createIssue({
      code: "unauthorized",
      stage: "validation",
      severity: "error",
      blocking: true,
      source: "hazify",
      message: "Geen Shopify context beschikbaar voor validatie.",
    });
    return {
      action: "validate_shopify_section_bundle",
      stage: "validation",
      status: "fail",
      performedBy: ["shopify-dev-mcp", "chrome-mcp", "hazify"],
      validationId: null,
      bundleId: normalizedInput.bundleId,
      resolvedTheme: null,
      schemaValidation: { status: "fail", source: "shopify-dev-mcp", issues: [issue] },
      visualValidation: { status: "fail", source: "chrome-mcp", perViewport: [], issues: [] },
      importReadiness: { ready: false, blockingIssues: [issue], warnings: [] },
      errors: [issue],
      warnings: [],
      nextRecommendedTool: "none",
    };
  }

  try {
    const bundleArtifact = await runtime.artifactStore.get(tenantId, normalizedInput.bundleId);
    if (!bundleArtifact || bundleArtifact.type !== "bundle") {
      const issue = createIssue({
        code: "artifact_not_found",
        stage: "validation",
        severity: "error",
        blocking: true,
        source: "hazify",
        message: `bundleId '${normalizedInput.bundleId}' niet gevonden voor deze tenant.`,
      });
      return {
        action: "validate_shopify_section_bundle",
        stage: "validation",
        status: "fail",
        performedBy: ["shopify-dev-mcp", "chrome-mcp", "hazify"],
        validationId: null,
        bundleId: normalizedInput.bundleId,
        resolvedTheme: null,
        schemaValidation: { status: "fail", source: "shopify-dev-mcp", issues: [issue] },
        visualValidation: { status: "fail", source: "chrome-mcp", perViewport: [], issues: [] },
        importReadiness: { ready: false, blockingIssues: [issue], warnings: [] },
        errors: [issue],
        warnings: [],
        nextRecommendedTool: "none",
      };
    }

    const bundle = bundleArtifact.payload?.bundle;
    const inspectionId = bundleArtifact.payload?.inspectionId;
    const inspectionArtifact = inspectionId
      ? await runtime.artifactStore.get(tenantId, inspectionId)
      : null;

    const resolvedTheme = await runtime.themeImportAdapter.resolveThemeTarget({
      shopifyClient,
      themeId: normalizedInput.themeId,
      themeRole: normalizedInput.themeRole,
    });

    const schemaValidation = await runtime.shopifyDevValidator.validateBundleSchema({
      bundle,
      strict: normalizedInput.strict,
      themeContext: {
        themeId: resolvedTheme.id,
        themeRole: resolvedTheme.role,
        templateKey: normalizedInput.templateKey,
      },
    });

    const templateInstallability = await runtime.shopifyDevValidator.validateTemplateInstallability({
      bundle,
      strict: normalizedInput.strict,
      themeContext: {
        themeId: resolvedTheme.id,
        themeRole: resolvedTheme.role,
        templateKey: normalizedInput.templateKey,
      },
    });

    const candidateVisual = await runtime.chromeInspector.renderCandidate({
      bundle,
      visualMode: normalizedInput.visualMode,
      viewports: ["desktop", "mobile"],
      inspection: inspectionArtifact?.payload || null,
    });

    const visualValidation = await runtime.chromeInspector.compareVisual({
      inspection: inspectionArtifact?.payload || null,
      candidate: candidateVisual,
      thresholds: normalizedInput.thresholds,
    });

    const allIssues = collectIssues(
      schemaValidation?.issues,
      templateInstallability?.issues,
      visualValidation?.issues
    );

    const { errors, warnings } = toBlockingAndWarnings(allIssues);

    const now = isoNow();
    const validationId = generateArtifactId("validation");

    const record = {
      artifactId: validationId,
      tenantId,
      type: "validation",
      status: errors.length ? "fail" : warnings.length ? "partial" : "pass",
      parentIds: [normalizedInput.bundleId],
      payload: {
        bundleId: normalizedInput.bundleId,
        resolvedTheme,
        schemaValidation,
        templateInstallability,
        visualValidation,
        importReadiness: {
          ready: errors.length === 0,
          blockingIssues: errors,
          warnings,
        },
      },
      createdAt: now,
      updatedAt: now,
      lastAccessedAt: now,
      expiresAt: expiresAtIso({ type: "validation", ttlConfig: runtime.ttlConfig }),
      version: "section-workflow-v1",
    };

    await runtime.artifactStore.upsert(record);

    return {
      action: "validate_shopify_section_bundle",
      stage: "validation",
      status: errors.length ? "fail" : "pass",
      performedBy: ["shopify-dev-mcp", "chrome-mcp", "hazify"],
      validationId,
      bundleId: normalizedInput.bundleId,
      resolvedTheme: {
        id: resolvedTheme.id,
        name: resolvedTheme.name,
        role: resolvedTheme.role,
        resolutionSource: resolvedTheme.resolutionSource,
      },
      schemaValidation: {
        status: schemaValidation?.status || "pass",
        source: "shopify-dev-mcp",
        issues: Array.isArray(schemaValidation?.issues) ? schemaValidation.issues : [],
      },
      visualValidation: {
        status: visualValidation?.status || "pass",
        source: "chrome-mcp",
        perViewport: Array.isArray(visualValidation?.perViewport) ? visualValidation.perViewport : [],
        issues: Array.isArray(visualValidation?.issues) ? visualValidation.issues : [],
      },
      importReadiness: {
        ready: errors.length === 0,
        blockingIssues: errors,
        warnings,
      },
      errors,
      warnings,
      nextRecommendedTool: errors.length === 0 ? "import-shopify-section-bundle" : "none",
    };
  } catch (error) {
    const normalizedCode =
      String(error?.code || "").trim().toLowerCase() === "artifact_quota_exceeded"
        ? "artifact_quota_exceeded"
        : "runtime_error";
    const issue = normalizeUnknownError({
      stage: "validation",
      source: "hazify",
      error,
      code: normalizedCode,
    });
    return {
      action: "validate_shopify_section_bundle",
      stage: "validation",
      status: "fail",
      performedBy: ["shopify-dev-mcp", "chrome-mcp", "hazify"],
      validationId: null,
      bundleId: normalizedInput.bundleId,
      resolvedTheme: null,
      schemaValidation: { status: "fail", source: "shopify-dev-mcp", issues: [issue] },
      visualValidation: { status: "fail", source: "chrome-mcp", perViewport: [], issues: [] },
      importReadiness: {
        ready: false,
        blockingIssues: [issue],
        warnings: [],
      },
      errors: [issue],
      warnings: [],
      nextRecommendedTool: "none",
    };
  }
};
