import { InspectReferenceSectionInputSchema } from "../contracts.js";
import { createIssue, deriveStageStatus, normalizeUnknownError, toBlockingAndWarnings } from "../error-model.js";
import { generateArtifactId } from "../artifacts/artifact-id.js";
import { expiresAtIso } from "../artifacts/artifact-ttl.js";

const isoNow = () => new Date().toISOString();

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
    const issues = Array.isArray(inspected?.issues) ? inspected.issues : [];
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
          textCandidates: Array.isArray(inspected?.extracted?.textCandidates)
            ? inspected.extracted.textCandidates
            : [],
          imageCandidates: Array.isArray(inspected?.extracted?.imageCandidates)
            ? inspected.extracted.imageCandidates
            : [],
        },
        captures: inspected?.captures || {},
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
