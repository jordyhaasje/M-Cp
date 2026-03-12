export const DEFAULT_ARTIFACT_TTL_MS = Object.freeze({
  inspection: 2 * 60 * 60 * 1000,
  bundle: 24 * 60 * 60 * 1000,
  validation: 24 * 60 * 60 * 1000,
  import: 30 * 24 * 60 * 60 * 1000,
});

const clampTtl = (value, fallback) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return fallback;
  }
  return Math.max(60 * 1000, numeric);
};

export const resolveArtifactTtlConfig = (env = process.env) => ({
  inspection: clampTtl(env.HAZIFY_SECTION_ARTIFACT_TTL_INSPECTION_MS, DEFAULT_ARTIFACT_TTL_MS.inspection),
  bundle: clampTtl(env.HAZIFY_SECTION_ARTIFACT_TTL_BUNDLE_MS, DEFAULT_ARTIFACT_TTL_MS.bundle),
  validation: clampTtl(env.HAZIFY_SECTION_ARTIFACT_TTL_VALIDATION_MS, DEFAULT_ARTIFACT_TTL_MS.validation),
  import: clampTtl(env.HAZIFY_SECTION_ARTIFACT_TTL_IMPORT_MS, DEFAULT_ARTIFACT_TTL_MS.import),
});

export const expiresAtIso = ({ type, nowMs = Date.now(), ttlConfig = DEFAULT_ARTIFACT_TTL_MS }) => {
  const ttlMs = ttlConfig[type] || DEFAULT_ARTIFACT_TTL_MS[type] || DEFAULT_ARTIFACT_TTL_MS.bundle;
  return new Date(nowMs + ttlMs).toISOString();
};

export const isExpiredIso = (isoValue, nowMs = Date.now()) => {
  const parsedMs = Date.parse(String(isoValue || ""));
  return Number.isNaN(parsedMs) || parsedMs <= nowMs;
};
