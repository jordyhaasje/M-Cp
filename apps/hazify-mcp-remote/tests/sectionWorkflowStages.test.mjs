import assert from "assert";
import { runInspectStage } from "../src/section-workflow/stages/inspect-stage.js";
import { runGenerateStage } from "../src/section-workflow/stages/generate-stage.js";
import { runValidateStage } from "../src/section-workflow/stages/validate-stage.js";
import { runImportStage } from "../src/section-workflow/stages/import-stage.js";
import { MemoryArtifactStore } from "../src/section-workflow/artifacts/memory-artifact-store.js";
import { resolveArtifactTtlConfig } from "../src/section-workflow/artifacts/artifact-ttl.js";
import { SHARED_IMAGE_BASE64_MAX_CHARS } from "../src/section-workflow/contracts.js";

const artifactStore = new MemoryArtifactStore({ maxPerTenant: 50, sweepIntervalMs: 60000 });
const ttlConfig = resolveArtifactTtlConfig();
const ONE_BY_ONE_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4AWP4DwQACfsD/c8LaHIAAAAASUVORK5CYII=";

const runtime = {
  artifactStore,
  ttlConfig,
  executionContext: {
    tenantId: "tenant_stage_test",
    shopifyClient: { url: "https://unit-test-shop.myshopify.com/admin/api/2026-01/graphql.json" },
  },
  chromeInspector: {
    async inspectReference() {
      return {
        source: "chrome-mcp",
        status: "pass",
        target: {
          selector: ".hero",
          reasoning: "largest section",
          viewports: [
            { id: "desktop", clip: { x: 0, y: 0, width: 1440, height: 900 } },
            { id: "mobile", clip: { x: 0, y: 0, width: 390, height: 844 } },
          ],
        },
        domSummary: { title: "Reference page" },
        styleTokens: { colors: ["#111111"] },
        captures: {
          desktop: { screenshotBase64: ONE_BY_ONE_PNG_BASE64, width: 1440, height: 900 },
          mobile: { screenshotBase64: ONE_BY_ONE_PNG_BASE64, width: 390, height: 844 },
        },
        extracted: {
          textCandidates: ["Hero heading", "Hero body copy"],
          imageCandidates: ["https://cdn.example.com/hero.jpg"],
        },
        issues: [],
      };
    },
    async renderCandidate() {
      return { source: "chrome-mcp", status: "pass", captures: {}, issues: [] };
    },
    async compareVisual() {
      return {
        source: "chrome-mcp",
        status: "pass",
        perViewport: [
          { id: "desktop", mismatchRatio: 0.05, threshold: 0.12, pass: true },
          { id: "mobile", mismatchRatio: 0.08, threshold: 0.15, pass: true },
        ],
        issues: [],
      };
    },
  },
  shopifyDevValidator: {
    async validateBundleSchema() {
      return {
        source: "shopify-dev-mcp",
        status: "pass",
        schema: { status: "pass", issues: [] },
        template: { status: "pass", issues: [] },
        issues: [],
      };
    },
    async validateTemplateInstallability() {
      return {
        source: "shopify-dev-mcp",
        status: "pass",
        template: { status: "pass", issues: [] },
        issues: [],
      };
    },
  },
  themeImportAdapter: {
    async resolveThemeTarget({ themeId, themeRole }) {
      return {
        id: themeId || 111,
        name: "Main Theme",
        role: themeRole || "main",
        resolutionSource: themeId ? "themeId" : "default-live",
      };
    },
    async applyBundle() {
      return {
        resolvedTheme: {
          id: 111,
          name: "Main Theme",
          role: "main",
          resolutionSource: "default-live",
        },
        sectionHandle: "hero-section",
        writes: {
          section: { key: "sections/hero-section.liquid", checksum: "abc" },
          template: { key: "templates/index.json", sectionId: "hero_section", checksum: "def" },
          additionalFiles: [],
        },
        snapshots: {
          section: null,
          template: null,
          additional: [],
        },
      };
    },
    async verifyImport() {
      return {
        status: "pass",
        readback: { status: "pass", issues: [] },
        templateInstall: { status: "pass", issues: [] },
        themeRender: { status: "pass", issues: [] },
        issues: [],
      };
    },
    async rollback() {
      return { attempted: true, status: "pass", results: [] };
    },
  },
};

try {
  const inspectResult = await runInspectStage({
    input: {
      referenceUrl: "https://example.com/hero",
      viewports: ["desktop", "mobile"],
    },
    runtime,
  });
  assert.equal(inspectResult.status, "pass");
  assert.match(inspectResult.inspectionId || "", /^ins_/);

  const degradedInspect = await runInspectStage({
    input: {
      referenceUrl: "https://example.com/hero",
      viewports: ["desktop", "mobile"],
      targetHint: "hero top banner",
    },
    runtime: {
      ...runtime,
      chromeInspector: {
        ...runtime.chromeInspector,
        async inspectReference() {
          return {
            source: "chrome-mcp",
            status: "pass",
            target: { selector: null, reasoning: null, viewports: [] },
            domSummary: {},
            styleTokens: {},
            captures: {
              desktop: { screenshotBase64: "", width: 1440, height: 900 },
              mobile: { screenshotBase64: "", width: 390, height: 844 },
            },
            extracted: { textCandidates: [], imageCandidates: [] },
            issues: [],
          };
        },
      },
    },
  });
  assert.equal(degradedInspect.status, "fail");
  assert.equal(degradedInspect.nextRecommendedTool, "none");
  assert.ok(
    degradedInspect.errors.some((entry) => entry.code === "inspection_quality_insufficient"),
    "inspection should fail with inspection_quality_insufficient when captures/extracted data is empty"
  );

  const blockedGenerate = await runGenerateStage({
    input: {
      inspectionId: degradedInspect.inspectionId,
      sectionHandle: "blocked-section",
      templateHint: "templates/index.json",
    },
    runtime,
  });
  assert.equal(blockedGenerate.status, "fail");
  assert.equal(blockedGenerate.nextRecommendedTool, "none");
  assert.ok(
    blockedGenerate.errors.some((entry) => entry.code === "inspection_quality_insufficient"),
    "generation should be blocked when inspection quality is insufficient"
  );

  const oversizedInspect = await runInspectStage({
    input: {
      referenceUrl: "https://example.com/hero",
      sharedImage: {
        imageBase64: "A".repeat(SHARED_IMAGE_BASE64_MAX_CHARS + 1),
        mimeType: "image/png",
      },
    },
    runtime,
  });
  assert.equal(oversizedInspect.status, "fail");
  assert.ok(
    oversizedInspect.errors.some((entry) => entry.code === "shared_image_payload_too_large"),
    "oversized sharedImage.imageBase64 should return canonical payload-too-large error"
  );

  const generateResult = await runGenerateStage({
    input: {
      inspectionId: inspectResult.inspectionId,
      sectionHandle: "hero-section",
      templateHint: "templates/index.json",
    },
    runtime,
  });
  assert.equal(generateResult.status, "pass");
  assert.match(generateResult.bundleId || "", /^bun_/);
  assert.equal(generateResult.bundle.sectionHandle, "hero-section");

  const validateResult = await runValidateStage({
    input: {
      bundleId: generateResult.bundleId,
      templateKey: "templates/index.json",
      strict: true,
    },
    runtime,
  });
  assert.equal(validateResult.status, "pass");
  assert.match(validateResult.validationId || "", /^val_/);
  assert.equal(validateResult.importReadiness.ready, true);

  const importResult = await runImportStage({
    input: {
      validationId: validateResult.validationId,
      verify: true,
      rollbackOnFailure: true,
    },
    runtime,
  });
  assert.equal(importResult.status, "pass");
  assert.match(importResult.importId || "", /^imp_/);
  assert.equal(importResult.rollback.status, "not_needed");

  const invalidImport = await runImportStage({
    input: {},
    runtime,
  });
  assert.equal(invalidImport.status, "fail");
  assert.ok(invalidImport.errors.some((entry) => entry.code === "invalid_input"));
} finally {
  await artifactStore.destroy();
}

console.log("sectionWorkflowStages.test.mjs passed");
