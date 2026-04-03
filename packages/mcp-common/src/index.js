import crypto from "crypto";
import dns from "dns/promises";
import net from "net";

export const MCP_SCOPE_TOOLS = "mcp:tools";
const MCP_SCOPE_TOOLS_READ = "mcp:tools:read";
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

function normalizeOrigin(value) {
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

const PRIVATE_IPV4_RANGES = [
  ["10.0.0.0", 8],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.168.0.0", 16],
  ["0.0.0.0", 8],
];

function ipv4ToInt(ip) {
  return ip.split(".").reduce((acc, octet) => (acc << 8) + Number(octet), 0) >>> 0;
}

function isPrivateIPv4(ip) {
  const ipInt = ipv4ToInt(ip);
  for (const [base, prefix] of PRIVATE_IPV4_RANGES) {
    const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
    const baseInt = ipv4ToInt(base);
    if ((ipInt & mask) === (baseInt & mask)) {
      return true;
    }
  }
  return false;
}

function isPrivateIPv6(ip) {
  const normalized = ip.toLowerCase();
  if (normalized === "::1") {
    return true;
  }
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) {
    return true;
  }
  if (normalized.startsWith("fe8") || normalized.startsWith("fe9") || normalized.startsWith("fea") || normalized.startsWith("feb")) {
    return true;
  }
  return normalized === "::";
}

export function assertPublicHttpsUrl(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("Invalid URL format");
  }

  if (parsed.protocol !== "https:") {
    throw new Error("Only https URLs are allowed");
  }
  if (parsed.username || parsed.password) {
    throw new Error("Credentials in URLs are not allowed");
  }

  const hostname = parsed.hostname.toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".local")) {
    throw new Error("Local/internal hostnames are not allowed");
  }

  const ipType = net.isIP(hostname);
  if (ipType === 4 && isPrivateIPv4(hostname)) {
    throw new Error("Private/internal IPv4 addresses are not allowed");
  }
  if (ipType === 6 && isPrivateIPv6(hostname)) {
    throw new Error("Private/internal IPv6 addresses are not allowed");
  }

  return parsed;
}

export async function assertPublicHttpsUrlResolved(value) {
  const parsed = assertPublicHttpsUrl(value);
  if (!net.isIP(parsed.hostname)) {
    await assertHostResolvesPublic(parsed.hostname);
  }
  return parsed;
}

async function assertHostResolvesPublic(hostname) {
  const results = await dns.lookup(hostname, { all: true });
  if (!results.length) {
    throw new Error("Hostname does not resolve");
  }

  for (const result of results) {
    if (result.family === 4 && isPrivateIPv4(result.address)) {
      throw new Error("Hostname resolves to private/internal IPv4");
    }
    if (result.family === 6 && isPrivateIPv6(result.address)) {
      throw new Error("Hostname resolves to private/internal IPv6");
    }
  }
}

export async function fetchWithSafeRedirects(inputUrl, options = {}) {
  const timeoutMs = typeof options.timeoutMs === "number" ? options.timeoutMs : 10000;
  const maxRedirects = typeof options.maxRedirects === "number" ? options.maxRedirects : 4;
  const headers = options.headers || {};
  const method = typeof options.method === "string" ? options.method : "GET";

  let currentUrl = inputUrl;
  for (let i = 0; i <= maxRedirects; i += 1) {
    const parsed = assertPublicHttpsUrl(currentUrl);
    if (!net.isIP(parsed.hostname)) {
      await assertHostResolvesPublic(parsed.hostname);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try {
      response = await fetch(parsed.toString(), {
        method,
        headers,
        redirect: "manual",
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    const status = response.status;
    if (status >= 300 && status < 400) {
      const location = response.headers.get("location");
      if (!location) {
        throw new Error("Redirect response without location header");
      }
      currentUrl = new URL(location, parsed).toString();
      continue;
    }

    return response;
  }

  throw new Error("Too many redirects");
}
