export const STAGE_NAMES = Object.freeze(["inspection", "generation", "validation", "import", "compat"]);

export const ISSUE_SEVERITIES = Object.freeze(["error", "warn"]);

export const CORE_ERROR_CODES = Object.freeze([
  "invalid_input",
  "unauthorized",
  "license_denied",
  "artifact_not_found",
  "artifact_expired",
  "artifact_persistence_degraded",
  "adapter_unavailable",
  "adapter_timeout",
  "runtime_error",
  "reference_unreachable",
  "target_detection_failed",
  "shared_image_unreadable",
  "shared_image_payload_too_large",
  "generation_failed",
  "section_handle_invalid",
  "schema_invalid",
  "template_insert_invalid",
  "visual_gate_fail",
  "theme_context_preflight_failed",
  "theme_not_found",
  "section_exists_overwrite_false",
  "theme_write_failed",
  "import_readback_failed",
  "theme_context_render_failed",
  "rollback_failed",
  "artifact_quota_exceeded",
]);

export const deriveStageStatus = (errors = []) => ((errors || []).length > 0 ? "fail" : "pass");

export const createIssue = ({
  code,
  stage,
  severity,
  blocking,
  source,
  message,
  details = null,
}) => ({
  code: String(code || "runtime_error"),
  stage: STAGE_NAMES.includes(stage) ? stage : "compat",
  severity: severity === "warn" ? "warn" : "error",
  blocking: typeof blocking === "boolean" ? blocking : severity !== "warn",
  source: String(source || "hazify"),
  message: String(message || "Onbekende fout"),
  details: details && typeof details === "object" ? details : null,
});

export const createStageFailure = ({
  action,
  stage,
  performedBy,
  artifactId = null,
  errors = [],
  warnings = [],
  nextRecommendedTool = "none",
  extras = {},
}) => ({
  action,
  stage,
  status: "fail",
  performedBy,
  ...(artifactId ? { [`${stage}Id`]: artifactId } : {}),
  errors,
  warnings,
  nextRecommendedTool,
  ...extras,
});

export const toBlockingAndWarnings = (issues = []) => {
  const warnings = [];
  const errors = [];

  for (const issue of issues || []) {
    const normalized = createIssue(issue || {});
    if (normalized.severity === "warn" || !normalized.blocking) {
      warnings.push(normalized);
      continue;
    }
    errors.push(normalized);
  }

  return { errors, warnings };
};

export const normalizeUnknownError = ({ stage, source, error, code = "runtime_error" }) =>
  createIssue({
    code,
    stage,
    severity: "error",
    blocking: true,
    source,
    message: error instanceof Error ? error.message : String(error || "Onbekende fout"),
  });
