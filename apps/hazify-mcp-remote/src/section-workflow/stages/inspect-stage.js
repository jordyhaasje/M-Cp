import { InspectReferenceSectionInputSchema } from "../contracts.js";
import { createIssue, deriveStageStatus, normalizeUnknownError, toBlockingAndWarnings } from "../error-model.js";
import { generateArtifactId } from "../artifacts/artifact-id.js";
import { expiresAtIso } from "../artifacts/artifact-ttl.js";

const isoNow = () => new Date().toISOString();
const DEFAULT_REQUIRED_VIEWPORTS = Object.freeze(["desktop", "mobile"]);
const MIN_TEXT_CANDIDATES = 1;

const toStringArray = (values) =>
  Array.isArray(values) ? values.filter((entry) => typeof entry === "string" && entry.trim().length > 0) : [];

const hasCaptureData = (capture) =>
  Boolean(
    capture &&
      typeof capture === "object" &&
      typeof capture.screenshotBase64 === "string" &&
      capture.screenshotBase64.trim().length > 0 &&
      Number(capture.width) > 0 &&
      Number(capture.height) > 0
  );

const hasSharedImageInput = (input) =>
  Boolean(
    input?.sharedImage &&
      ((typeof input.sharedImage.imageUrl === "string" && input.sharedImage.imageUrl.trim()) ||
        (typeof input.sharedImage.imageBase64 === "string" && input.sharedImage.imageBase64.trim()))
  );

const buildInspectionQuality = ({ input, inspected }) => {
  const requestedViewports =
    Array.isArray(input?.viewports) && input.viewports.length
      ? [...new Set(input.viewports.map((entry) => String(entry)))]
      : [...DEFAULT_REQUIRED_VIEWPORTS];

  const captures = inspected?.captures && typeof inspected.captures === "object" ? inspected.captures : {};
  const extractedTextCandidates = toStringArray(inspected?.extracted?.textCandidates);
  const extractedImageCandidates = toStringArray(inspected?.extracted?.imageCandidates);
  const target = inspected?.target && typeof inspected.target === "object" ? inspected.target : {};
  const targetViewports = Array.isArray(target.viewports) ? target.viewports : [];

  const minImageCandidates = hasSharedImageInput(input) ? 1 : 0;
  const missingCaptureViewports = requestedViewports.filter((viewportId) => !hasCaptureData(captures[viewportId]));

  const checks = {
    requestedViewports,
    captureCoverage: missingCaptureViewports.length === 0,
    missingCaptureViewports,
    textCandidatesCount: extractedTextCandidates.length,
    textCandidatesMinRequired: MIN_TEXT_CANDIDATES,
    imageCandidatesCount: extractedImageCandidates.length,
    imageCandidatesMinRequired: minImageCandidates,
    targetConfirmed:
      (typeof target.selector === "string" && target.selector.trim().length > 0) ||
      (typeof target.reasoning === "string" && target.reasoning.trim().length > 0),
    targetViewportCoverage:
      targetViewports.length > 0 &&
      requestedViewports.every((viewportId) =>
        targetViewports.some((entry) => String(entry?.id || "").trim() === viewportId)
      ),
  };

  const failureReasons = [];
  if (!checks.captureCoverage) {
    failureReasons.push(
      `Missing screenshot captures for required viewport(s): ${checks.missingCaptureViewports.join(", ")}.`
    );
  }
  if (checks.textCandidatesCount < checks.textCandidatesMinRequired) {
    failureReasons.push(
      `Expected at least ${checks.textCandidatesMinRequired} extracted text candidate(s), got ${checks.textCandidatesCount}.`
    );
  }
  if (checks.imageCandidatesCount < checks.imageCandidatesMinRequired) {
    failureReasons.push(
      `Expected at least ${checks.imageCandidatesMinRequired} extracted image candidate(s), got ${checks.imageCandidatesCount}.`
    );
  }
  if (!checks.targetConfirmed || !checks.targetViewportCoverage) {
    failureReasons.push("Target confirmation is insufficient for reliable section replication.");
  }

  return {
    ready: failureReasons.length === 0,
    checks,
    failureReasons,
    extracted: {
      textCandidates: extractedTextCandidates,
      imageCandidates: extractedImageCandidates,
    },
  };
};

export const runInspectStage = async ({ input, runtime }) => {
  const parsedInput = InspectReferenceSectionInputSchema.safeParse(input);
  if (!parsedInput.success) {
    const errors = parsedInput.error.issues.map((entry) =>
      createIssue({
        code:
          entry.path.join(".") === "sharedImage.imageBase64" && entry.code === "too_big"
            ? "shared_image_payload_too_large"
            : "invalid_input",
        stage: "inspection",
        severity: "error",
        blocking: true,
        source: "hazify",
        message: `Input '${entry.path.join(".") || "root"}' is ongeldig: ${entry.message}`,
      })
    );

    return {
      action: "inspect_reference_section",
      stage: "inspection",
      status: "fail",
      performedBy: "chrome-mcp",
      inspectionId: null,
      reference: { url: String(input?.referenceUrl || ""), normalizedUrl: null },
      target: { selector: null, reasoning: null, viewports: [] },
      extracted: { domSummary: {}, styleTokens: {}, textCandidates: [], imageCandidates: [] },
      captures: {},
      errors,
      warnings: [],
      nextRecommendedTool: "none",
    };
  }

  const normalizedInput = parsedInput.data;
  const tenantId = String(runtime.executionContext?.tenantId || "stdio-local");
  const now = isoNow();

  try {
    const inspected = await runtime.chromeInspector.inspectReference(normalizedInput);
    const issues = Array.isArray(inspected?.issues) ? [...inspected.issues] : [];

    if (String(inspected?.status || "").toLowerCase() === "fail" && !issues.some((entry) => entry?.blocking)) {
      issues.push(
        createIssue({
          code: "runtime_error",
          stage: "inspection",
          severity: "error",
          blocking: true,
          source: inspected?.source || "chrome-mcp",
          message: "Browser inspectie faalde zonder expliciete blocking foutmelding.",
        })
      );
    }

    const quality = buildInspectionQuality({ input: normalizedInput, inspected });
    if (!quality.ready) {
      issues.push(
        createIssue({
          code: "inspection_quality_insufficient",
          stage: "inspection",
          severity: "error",
          blocking: true,
          source: "hazify",
          message: "Inspectie leverde onvoldoende betrouwbare data op; generatie is geblokkeerd.",
          details: {
            checks: quality.checks,
            failureReasons: quality.failureReasons,
          },
        })
      );
    }

    const { errors, warnings } = toBlockingAndWarnings(issues);
    const status = deriveStageStatus(errors);

    const inspectionId = generateArtifactId("inspection");
    const record = {
      artifactId: inspectionId,
      tenantId,
      type: "inspection",
      status: status === "pass" ? "pass" : "fail",
      parentIds: [],
      payload: {
        input: normalizedInput,
        source: inspected?.source || "chrome-mcp",
        reference: {
          url: normalizedInput.referenceUrl,
          normalizedUrl: (() => {
            try {
              return new URL(normalizedInput.referenceUrl).toString();
            } catch (_error) {
              return normalizedInput.referenceUrl;
            }
          })(),
        },
        target: inspected?.target || { selector: null, viewports: [] },
        extracted: {
          domSummary: inspected?.domSummary || {},
          styleTokens: inspected?.styleTokens || {},
          textCandidates: quality.extracted.textCandidates,
          imageCandidates: quality.extracted.imageCandidates,
        },
        captures: inspected?.captures || {},
        quality: {
          ready: quality.ready,
          checks: quality.checks,
          failureReasons: quality.failureReasons,
        },
        issues,
      },
      createdAt: now,
      updatedAt: now,
      lastAccessedAt: now,
      expiresAt: expiresAtIso({ type: "inspection", ttlConfig: runtime.ttlConfig }),
      version: "section-workflow-v1",
    };

    await runtime.artifactStore.upsert(record);

    return {
      action: "inspect_reference_section",
      stage: "inspection",
      status,
      performedBy: "chrome-mcp",
      inspectionId,
      reference: record.payload.reference,
      target: {
        selector: record.payload.target?.selector || null,
        reasoning: record.payload.target?.reasoning || null,
        viewports: Array.isArray(record.payload.target?.viewports) ? record.payload.target.viewports : [],
      },
      extracted: record.payload.extracted,
      captures: record.payload.captures,
      quality: record.payload.quality,
      errors,
      warnings,
      nextRecommendedTool: status === "pass" ? "generate-shopify-section-bundle" : "none",
    };
  } catch (error) {
    const normalizedCode =
      String(error?.code || "").trim().toLowerCase() === "artifact_quota_exceeded"
        ? "artifact_quota_exceeded"
        : "runtime_error";
    const normalized = normalizeUnknownError({
      stage: "inspection",
      source: "hazify",
      error,
      code: normalizedCode,
    });

    return {
      action: "inspect_reference_section",
      stage: "inspection",
      status: "fail",
      performedBy: "chrome-mcp",
      inspectionId: null,
      reference: {
        url: normalizedInput.referenceUrl,
        normalizedUrl: normalizedInput.referenceUrl,
      },
      target: { selector: null, reasoning: null, viewports: [] },
      extracted: { domSummary: {}, styleTokens: {}, textCandidates: [], imageCandidates: [] },
      captures: {},
      errors: [normalized],
      warnings: [],
      nextRecommendedTool: "none",
    };
  }
};
