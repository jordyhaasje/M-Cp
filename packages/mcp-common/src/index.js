import crypto from "crypto";

export const MCP_SCOPE_TOOLS = "mcp:tools";
export const MCP_SCOPE_TOOLS_READ = "mcp:tools:read";
export const MCP_SCOPE_TOOLS_WRITE = "mcp:tools:write";

const MCP_KNOWN_SCOPES = new Set([MCP_SCOPE_TOOLS, MCP_SCOPE_TOOLS_READ, MCP_SCOPE_TOOLS_WRITE]);

export function sha256Hex(value) {
  return crypto.createHash("sha256").update(String(value ?? ""), "utf8").digest("hex");
}

export function normalizeBaseUrl(value) {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim().replace(/\/+$/, "");
}

export function parseCommaSeparatedList(value, fallback = []) {
  const source = typeof value === "string" && value.trim() ? value : fallback.join(",");
  return source
    .split(",")
    .map((entry) => String(entry || "").trim())
    .filter(Boolean);
}

export function parseSpaceSeparatedScopes(value, fallback = []) {
  const source =
    typeof value === "string" && value.trim()
      ? value
      : Array.isArray(fallback)
      ? fallback.join(" ")
      : String(fallback || "");
  return Array.from(
    new Set(
      source
        .split(/\s+/)
        .map((entry) => String(entry || "").trim())
        .filter(Boolean)
    )
  );
}

export function normalizeMcpScopeString(value, fallback = MCP_SCOPE_TOOLS) {
  const scopes = parseSpaceSeparatedScopes(value, [fallback]).filter((scope) => MCP_KNOWN_SCOPES.has(scope));
  if (scopes.includes(MCP_SCOPE_TOOLS)) {
    return MCP_SCOPE_TOOLS;
  }
  if (scopes.includes(MCP_SCOPE_TOOLS_WRITE) && !scopes.includes(MCP_SCOPE_TOOLS_READ)) {
    return MCP_SCOPE_TOOLS_WRITE;
  }
  if (scopes.includes(MCP_SCOPE_TOOLS_READ) && !scopes.includes(MCP_SCOPE_TOOLS_WRITE)) {
    return MCP_SCOPE_TOOLS_READ;
  }
  if (scopes.includes(MCP_SCOPE_TOOLS_WRITE) && scopes.includes(MCP_SCOPE_TOOLS_READ)) {
    return `${MCP_SCOPE_TOOLS_READ} ${MCP_SCOPE_TOOLS_WRITE}`;
  }
  return fallback;
}

export function getMcpScopeCapabilities(value) {
  const normalized = normalizeMcpScopeString(value);
  const grantedScopes = parseSpaceSeparatedScopes(normalized).filter((scope) => MCP_KNOWN_SCOPES.has(scope));
  const hasLegacy = grantedScopes.includes(MCP_SCOPE_TOOLS);
  const hasWrite = hasLegacy || grantedScopes.includes(MCP_SCOPE_TOOLS_WRITE);
  const hasRead = hasLegacy || hasWrite || grantedScopes.includes(MCP_SCOPE_TOOLS_READ);
  return {
    grantedScopes,
    normalizedScope: normalized,
    legacyFullAccess: hasLegacy,
    read: hasRead,
    write: hasWrite,
    canRead: hasRead,
    canWrite: hasWrite,
  };
}

export function getDefaultMcpScopesSupported() {
  return [MCP_SCOPE_TOOLS, MCP_SCOPE_TOOLS_READ, MCP_SCOPE_TOOLS_WRITE];
}

export function normalizeOrigin(value) {
  if (typeof value !== "string" || !value.trim()) {
    return "";
  }
  if (value.trim().toLowerCase() === "null") {
    // Explicit allowlist marker for opaque/native origins (e.g. vscode-webview://, file://).
    return "null";
  }
  try {
    return new URL(value.trim()).origin;
  } catch {
    return "";
  }
}

export function isOriginAllowed({ originHeader, requestBaseUrl, allowedOrigins = [] }) {
  if (typeof originHeader !== "string" || !originHeader.trim()) {
    return { allowed: true, reason: "Origin header missing (non-browser client)" };
  }

  const requestOrigin = normalizeOrigin(requestBaseUrl);
  const normalizedAllowed = (allowedOrigins.length ? allowedOrigins : [requestOrigin])
    .map((value) => normalizeOrigin(value))
    .filter(Boolean);

  if (!normalizedAllowed.length) {
    return { allowed: false, reason: "No valid allowed origins configured for MCP endpoint" };
  }

  const receivedOrigin = normalizeOrigin(originHeader);
  if (!receivedOrigin) {
    return { allowed: false, reason: "Invalid Origin header" };
  }

  if (!normalizedAllowed.includes(receivedOrigin)) {
    return { allowed: false, reason: `Origin '${receivedOrigin}' is not allowed` };
  }

  return { allowed: true, reason: "Origin allowed" };
}
