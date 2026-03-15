import crypto from "crypto";

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
