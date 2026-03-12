import assert from "assert";
import { replicateSectionFromReferenceCompat } from "../src/tools/replicateSectionFromReferenceCompat.js";
import { setSectionWorkflowOrchestrator } from "../src/section-workflow/orchestrator.js";

const previousMode = process.env.HAZIFY_SECTION_COMPAT_MODE;
process.env.HAZIFY_SECTION_COMPAT_MODE = "staged";

replicateSectionFromReferenceCompat.initialize({
  url: "https://unit-test-shop.myshopify.com/admin/api/2026-01/graphql.json",
});

try {
  setSectionWorkflowOrchestrator({
    async runCompat() {
      return {
        status: "pass",
        inspectResult: { inspectionId: "ins_01TESTINSPECTION0000000000", errors: [] },
        generateResult: {
          bundleId: "bun_01TESTBUNDLE000000000000",
          errors: [],
          bundle: { sectionHandle: "hero-section" },
        },
        validateResult: {
          validationId: "val_01TESTVALIDATION000000000",
          status: "pass",
          errors: [],
          warnings: [],
          resolvedTheme: { id: 111, role: "main" },
          schemaValidation: { status: "pass", issues: [] },
          visualValidation: { status: "pass", perViewport: [], issues: [] },
        },
        importResult: {
          importId: "imp_01TESTIMPORT0000000000000",
          status: "pass",
          errors: [],
          warnings: [],
          resolvedTheme: { id: 111, name: "Main Theme", role: "main", resolutionSource: "default-live" },
          writes: { section: { key: "sections/hero-section.liquid" }, template: null, additionalFiles: [] },
          verification: {
            readback: { status: "pass", issues: [] },
            templateInstall: { status: "pass", issues: [] },
            themeRender: { status: "pass", issues: [] },
          },
          rollback: { attempted: false, status: "not_needed", results: [] },
        },
      };
    },
  });

  const success = await replicateSectionFromReferenceCompat.execute({
    referenceUrl: "https://example.com/hero",
  });
  assert.equal(success.status, "pass");
  assert.equal(success.compat.deprecated, true);
  assert.equal(success.compat.replacementTools.includes("inspect-reference-section"), true);
  assert.equal(success.artifacts.inspectionId.startsWith("ins_"), true);
  assert.equal(success.writes.section.key, "sections/hero-section.liquid");

  setSectionWorkflowOrchestrator({
    async runCompat() {
      return {
        status: "fail",
        inspectResult: {
          inspectionId: "ins_01FAIL",
          errors: [
            {
              code: "reference_unreachable",
              stage: "inspection",
              severity: "error",
              blocking: true,
              source: "chrome-mcp",
              message: "Reference URL unreachable",
            },
          ],
        },
        generateResult: null,
        validateResult: null,
        importResult: null,
      };
    },
  });

  const failed = await replicateSectionFromReferenceCompat.execute({
    referenceUrl: "https://example.com/hero",
  });
  assert.equal(failed.status, "fail");
  assert.equal(failed.errorCode, "reference_unreachable");
  assert.equal(failed.policy.writesAllowed, false);
  assert.equal(failed.compat.deprecated, true);
} finally {
  setSectionWorkflowOrchestrator(null);
  if (previousMode === undefined) {
    delete process.env.HAZIFY_SECTION_COMPAT_MODE;
  } else {
    process.env.HAZIFY_SECTION_COMPAT_MODE = previousMode;
  }
}

console.log("replicateSectionCompat.test.mjs passed");
