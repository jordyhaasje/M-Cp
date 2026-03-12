import { ImportShopifySectionBundleInputSchema } from "../contracts.js";
import { createIssue, normalizeUnknownError, toBlockingAndWarnings } from "../error-model.js";
import { generateArtifactId } from "../artifacts/artifact-id.js";
import { expiresAtIso } from "../artifacts/artifact-ttl.js";

const isoNow = () => new Date().toISOString();

export const runImportStage = async ({ input, runtime }) => {
  const parsedInput = ImportShopifySectionBundleInputSchema.safeParse(input);
  if (!parsedInput.success) {
    const errors = parsedInput.error.issues.map((entry) =>
      createIssue({
        code: "invalid_input",
        stage: "import",
        severity: "error",
        blocking: true,
        source: "hazify",
        message: `Input '${entry.path.join(".") || "root"}' is ongeldig: ${entry.message}`,
      })
    );

    return {
      action: "import_shopify_section_bundle",
      stage: "import",
      status: "fail",
      performedBy: "shopify-admin",
      importId: null,
      resolvedTheme: null,
      writes: null,
      verification: null,
      rollback: { attempted: false, status: "not_needed", results: [] },
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
      stage: "import",
      severity: "error",
      blocking: true,
      source: "hazify",
      message: "Geen Shopify context beschikbaar voor import.",
    });
    return {
      action: "import_shopify_section_bundle",
      stage: "import",
      status: "fail",
      performedBy: "shopify-admin",
      importId: null,
      resolvedTheme: null,
      writes: null,
      verification: null,
      rollback: { attempted: false, status: "not_needed", results: [] },
      errors: [issue],
      warnings: [],
      nextRecommendedTool: "none",
    };
  }

  try {
    let resolvedBundleId = normalizedInput.bundleId || null;
    let validationArtifact = null;

    if (normalizedInput.validationId) {
      validationArtifact = await runtime.artifactStore.get(tenantId, normalizedInput.validationId);
      if (!validationArtifact || validationArtifact.type !== "validation") {
        const issue = createIssue({
          code: "artifact_not_found",
          stage: "import",
          severity: "error",
          blocking: true,
          source: "hazify",
          message: `validationId '${normalizedInput.validationId}' niet gevonden voor deze tenant.`,
        });
        return {
          action: "import_shopify_section_bundle",
          stage: "import",
          status: "fail",
          performedBy: "shopify-admin",
          importId: null,
          resolvedTheme: null,
          writes: null,
          verification: null,
          rollback: { attempted: false, status: "not_needed", results: [] },
          errors: [issue],
          warnings: [],
          nextRecommendedTool: "none",
        };
      }

      const fromValidation = String(validationArtifact.payload?.bundleId || "").trim() || null;
      if (normalizedInput.bundleId && fromValidation && normalizedInput.bundleId !== fromValidation) {
        const issue = createIssue({
          code: "invalid_input",
          stage: "import",
          severity: "error",
          blocking: true,
          source: "hazify",
          message: "validationId verwijst naar een andere bundleId dan opgegeven in input.",
        });
        return {
          action: "import_shopify_section_bundle",
          stage: "import",
          status: "fail",
          performedBy: "shopify-admin",
          importId: null,
          resolvedTheme: null,
          writes: null,
          verification: null,
          rollback: { attempted: false, status: "not_needed", results: [] },
          errors: [issue],
          warnings: [],
          nextRecommendedTool: "none",
        };
      }

      resolvedBundleId = fromValidation || resolvedBundleId;
    }

    if (!resolvedBundleId) {
      const issue = createIssue({
        code: "invalid_input",
        stage: "import",
        severity: "error",
        blocking: true,
        source: "hazify",
        message: "Geen bruikbare bundleId beschikbaar voor import.",
      });
      return {
        action: "import_shopify_section_bundle",
        stage: "import",
        status: "fail",
        performedBy: "shopify-admin",
        importId: null,
        resolvedTheme: null,
        writes: null,
        verification: null,
        rollback: { attempted: false, status: "not_needed", results: [] },
        errors: [issue],
        warnings: [],
        nextRecommendedTool: "none",
      };
    }

    const bundleArtifact = await runtime.artifactStore.get(tenantId, resolvedBundleId);
    if (!bundleArtifact || bundleArtifact.type !== "bundle") {
      const issue = createIssue({
        code: "artifact_not_found",
        stage: "import",
        severity: "error",
        blocking: true,
        source: "hazify",
        message: `bundleId '${resolvedBundleId}' niet gevonden voor deze tenant.`,
      });
      return {
        action: "import_shopify_section_bundle",
        stage: "import",
        status: "fail",
        performedBy: "shopify-admin",
        importId: null,
        resolvedTheme: null,
        writes: null,
        verification: null,
        rollback: { attempted: false, status: "not_needed", results: [] },
        errors: [issue],
        warnings: [],
        nextRecommendedTool: "none",
      };
    }

    const bundle = bundleArtifact.payload?.bundle;

    const applied = await runtime.themeImportAdapter.applyBundle({
      shopifyClient,
      bundle,
      themeTarget: {
        themeId: normalizedInput.themeId,
        themeRole: normalizedInput.themeRole,
      },
      importOptions: {
        templateKey: normalizedInput.templateKey,
        insertPosition: normalizedInput.insertPosition,
        referenceSectionId: normalizedInput.referenceSectionId,
        sectionInstanceId: normalizedInput.sectionInstanceId,
        sectionSettings: normalizedInput.sectionSettings,
        overwriteSection: normalizedInput.overwriteSection,
      },
    });

    const verification = await runtime.themeImportAdapter.verifyImport({
      shopifyClient,
      resolvedTheme: applied.resolvedTheme,
      sectionHandle: applied.sectionHandle,
      writes: applied.writes,
      importOptions: {
        verify: normalizedInput.verify,
      },
    });

    let rollback = {
      attempted: false,
      status: "not_needed",
      results: [],
    };

    if (verification.status === "fail" && normalizedInput.rollbackOnFailure) {
      rollback = await runtime.themeImportAdapter.rollback({
        shopifyClient,
        resolvedTheme: applied.resolvedTheme,
        snapshots: applied.snapshots,
        writes: applied.writes,
      });
      if (rollback.status !== "pass") {
        verification.issues.push(
          createIssue({
            code: "rollback_failed",
            stage: "import",
            severity: "error",
            blocking: true,
            source: "shopify-admin",
            message: "Rollback kon niet volledig worden uitgevoerd.",
            details: { results: rollback.results },
          })
        );
      }
    }

    const { errors, warnings } = toBlockingAndWarnings(verification.issues || []);

    const now = isoNow();
    const importId = generateArtifactId("import");
    const record = {
      artifactId: importId,
      tenantId,
      type: "import",
      status: errors.length ? "fail" : warnings.length ? "partial" : "pass",
      parentIds: [resolvedBundleId, ...(normalizedInput.validationId ? [normalizedInput.validationId] : [])],
      payload: {
        bundleId: resolvedBundleId,
        validationId: normalizedInput.validationId || null,
        resolvedTheme: applied.resolvedTheme,
        writes: applied.writes,
        verification,
        rollback,
      },
      createdAt: now,
      updatedAt: now,
      lastAccessedAt: now,
      expiresAt: expiresAtIso({ type: "import", ttlConfig: runtime.ttlConfig }),
      version: "section-workflow-v1",
    };

    await runtime.artifactStore.upsert(record);

    return {
      action: "import_shopify_section_bundle",
      stage: "import",
      status: errors.length ? "fail" : "pass",
      performedBy: "shopify-admin",
      importId,
      resolvedTheme: {
        id: applied.resolvedTheme.id,
        name: applied.resolvedTheme.name,
        role: applied.resolvedTheme.role,
        resolutionSource: applied.resolvedTheme.resolutionSource,
      },
      writes: applied.writes,
      verification: {
        readback: verification.readback,
        templateInstall: verification.templateInstall,
        themeRender: verification.themeRender,
      },
      rollback,
      errors,
      warnings,
      nextRecommendedTool: "none",
    };
  } catch (error) {
    const normalizedCode =
      String(error?.code || "").trim().toLowerCase() === "artifact_quota_exceeded"
        ? "artifact_quota_exceeded"
        : "theme_write_failed";
    const issue = normalizeUnknownError({
      stage: "import",
      source: "hazify",
      error,
      code: normalizedCode,
    });

    return {
      action: "import_shopify_section_bundle",
      stage: "import",
      status: "fail",
      performedBy: "shopify-admin",
      importId: null,
      resolvedTheme: null,
      writes: null,
      verification: null,
      rollback: {
        attempted: false,
        status: "not_needed",
        results: [],
      },
      errors: [issue],
      warnings: [],
      nextRecommendedTool: "none",
    };
  }
};
