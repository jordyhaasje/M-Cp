const VALID_TYPES = new Set(["inspection", "bundle", "validation", "import"]);
const VALID_STATUSES = new Set(["pass", "fail", "partial"]);

const normalizeIso = (value, fallback = null) => {
  if (typeof value !== "string" || !value.trim()) {
    return fallback;
  }
  const parsedMs = Date.parse(value);
  return Number.isNaN(parsedMs) ? fallback : new Date(parsedMs).toISOString();
};

const normalizeStringArray = (value) => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter(Boolean);
};

export const mcpArtifactKey = (tenantId, artifactId) =>
  `${String(tenantId || "").trim()}:${String(artifactId || "").trim()}`;

export function ensureMcpArtifactsBucket(state) {
  if (!state.mcpArtifacts || typeof state.mcpArtifacts !== "object") {
    state.mcpArtifacts = {};
  }
  return state.mcpArtifacts;
}

export function ensureMcpArtifactRecordShape(record) {
  if (!record || typeof record !== "object") {
    throw new Error("artifact is required");
  }

  const tenantId = String(record.tenantId || "").trim();
  const artifactId = String(record.artifactId || "").trim();
  const type = String(record.type || "").trim();
  const status = String(record.status || "").trim();

  if (!tenantId) {
    throw new Error("artifact.tenantId is required");
  }
  if (!artifactId) {
    throw new Error("artifact.artifactId is required");
  }
  if (!VALID_TYPES.has(type)) {
    throw new Error("artifact.type is invalid");
  }
  if (!VALID_STATUSES.has(status)) {
    throw new Error("artifact.status is invalid");
  }
  if (!record.payload || typeof record.payload !== "object" || Array.isArray(record.payload)) {
    throw new Error("artifact.payload must be an object");
  }

  const now = new Date().toISOString();
  const createdAt = normalizeIso(record.createdAt, now);
  const updatedAt = normalizeIso(record.updatedAt, now);
  const lastAccessedAt = normalizeIso(record.lastAccessedAt, updatedAt || now);
  const expiresAt = normalizeIso(record.expiresAt);

  if (!expiresAt) {
    throw new Error("artifact.expiresAt must be a valid ISO date");
  }

  return {
    artifactId,
    tenantId,
    type,
    status,
    parentIds: normalizeStringArray(record.parentIds),
    payload: record.payload,
    createdAt,
    updatedAt,
    lastAccessedAt,
    expiresAt,
    version: typeof record.version === "string" && record.version.trim() ? record.version.trim() : "section-workflow-v1",
  };
}

export function isMcpArtifactExpired(record, nowMs = Date.now()) {
  const parsedMs = Date.parse(String(record?.expiresAt || ""));
  return Number.isNaN(parsedMs) || parsedMs <= nowMs;
}
