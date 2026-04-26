#!/usr/bin/env node
import { AsyncLocalStorage } from "async_hooks";
import crypto from "crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import {
    MCP_SCOPE_TOOLS,
    MCP_SCOPE_TOOLS_WRITE,
    getDefaultMcpScopesSupported,
    getMcpScopeCapabilities,
    isOriginAllowed,
    normalizeBaseUrl,
    parseCommaSeparatedList,
    sha256Hex
} from "@hazify/mcp-common";
import {
    normalizeShopDomain
} from "@hazify/shopify-core";
import dotenv from "dotenv";
import { GraphQLClient } from "graphql-request";
import minimist from "minimist";
import { createHazifyToolRegistry, registerHazifyTools } from "./tools/registry.js";
// Parse command line arguments
const argv = minimist(process.argv.slice(2));
// Load environment variables from .env file (if it exists)
dotenv.config();
const normalizeAllowedHostname = (value) => {
    const raw = String(value || "").trim();
    if (!raw) {
        return null;
    }
    try {
        const parsed = new URL(raw.includes("://") ? raw : `http://${raw}`);
        return parsed.hostname ? parsed.hostname.toLowerCase() : null;
    }
    catch {
        return raw.replace(/:\d+$/, "").toLowerCase() || null;
    }
};
const normalizeAllowedHostnames = (values) => Array.from(new Set((Array.isArray(values) ? values : [])
    .map(normalizeAllowedHostname)
    .filter(Boolean)));
const HTTP_HOST = argv.host || process.env.HAZIFY_MCP_HTTP_HOST || "0.0.0.0";
const HTTP_PORT = Number(argv.port || process.env.PORT || process.env.HAZIFY_MCP_HTTP_PORT || 8788);
const HAZIFY_MCP_INTROSPECTION_URL = argv.mcpIntrospectionUrl || process.env.HAZIFY_MCP_INTROSPECTION_URL;
const HAZIFY_MCP_API_KEY = argv.mcpApiKey || process.env.HAZIFY_MCP_API_KEY;
const DEFAULT_CONTEXT_TTL_MS = 120000;
const HAZIFY_MCP_CONTEXT_TTL_MS = Number(
    argv.mcpContextTtlMs || process.env.HAZIFY_MCP_CONTEXT_TTL_MS || DEFAULT_CONTEXT_TTL_MS
);
const HAZIFY_MCP_PUBLIC_URL = argv.mcpPublicUrl || process.env.HAZIFY_MCP_PUBLIC_URL || "";
const HAZIFY_MCP_AUTH_SERVER_URL = argv.oauthAuthServerUrl || process.env.HAZIFY_MCP_AUTH_SERVER_URL || "";
const HAZIFY_MCP_ALLOWED_ORIGINS = parseCommaSeparatedList(argv.allowedOrigins || process.env.HAZIFY_MCP_ALLOWED_ORIGINS || "");
const HAZIFY_MCP_ALLOWED_HOSTS = normalizeAllowedHostnames([
    ...parseCommaSeparatedList(argv.allowedHosts || process.env.HAZIFY_MCP_ALLOWED_HOSTS || ""),
    HAZIFY_MCP_PUBLIC_URL,
    process.env.RAILWAY_PUBLIC_DOMAIN || "",
    process.env.RAILWAY_STATIC_URL || "",
    "localhost",
    "127.0.0.1",
    "[::1]",
]);
const MCP_SESSION_MODE = String(argv.sessionMode || process.env.MCP_SESSION_MODE || "stateless").trim().toLowerCase();
const MCP_STATEFUL_DEPLOYMENT_SAFE = String(argv.statefulDeploymentSafe || process.env.MCP_STATEFUL_DEPLOYMENT_SAFE || "")
    .trim()
    .toLowerCase() === "true";
const SERVER_VERSION = "1.1.0";
const API_VERSION = argv.apiVersion || process.env.SHOPIFY_API_VERSION || "2026-01";
const requestContextStore = new AsyncLocalStorage();
const remoteContextCache = new Map();
const remoteShopifyClientCache = new Map();
if (!["stateless", "stateful"].includes(MCP_SESSION_MODE)) {
    console.error("Error: MCP_SESSION_MODE must be 'stateless' or 'stateful'.");
    process.exit(1);
}
if (!HAZIFY_MCP_INTROSPECTION_URL || !HAZIFY_MCP_API_KEY) {
    console.error("Error: HTTP transport requires MCP introspection config.");
    console.error("Provide:");
    console.error("  --mcpIntrospectionUrl=https://... or HAZIFY_MCP_INTROSPECTION_URL");
    console.error("  --mcpApiKey=... or HAZIFY_MCP_API_KEY");
    process.exit(1);
}
if (MCP_SESSION_MODE === "stateful" && String(process.env.NODE_ENV || "").toLowerCase() === "production" && !MCP_STATEFUL_DEPLOYMENT_SAFE) {
    console.error("Error: stateful MCP session mode in production requires explicit confirmation.");
    console.error("Set MCP_STATEFUL_DEPLOYMENT_SAFE=true only when sticky sessions or shared session store are guaranteed.");
    process.exit(1);
}
if (String(process.env.NODE_ENV || "").toLowerCase() === "production" && String(HAZIFY_MCP_API_KEY || "").trim().length < 16) {
    console.error("Error: HAZIFY_MCP_API_KEY must be set to a strong secret in production.");
    process.exit(1);
}
// Set up MCP server
const createServerInstance = () => new McpServer({
    name: "Hazify MCP",
    version: SERVER_VERSION,
    description: "Hazify Shopify MCP with paid licensing, BYO Shopify credentials, and fulfillment-safe operations"
});
const toMcpResponse = (result) => {
    const structuredContent = result && typeof result === "object" ? result : { result };
    const isError = structuredContent?.success === false;
    return {
        content: [{ type: "text", text: JSON.stringify(structuredContent) }],
        structuredContent,
        isError,
    };
};
const normalizeIsoDate = (value) => {
    if (!value || typeof value !== "string") {
        return null;
    }
    const ms = Date.parse(value);
    return Number.isNaN(ms) ? null : new Date(ms).toISOString();
};
const defaultMcpScopeCapabilities = Object.freeze(getMcpScopeCapabilities(MCP_SCOPE_TOOLS));
const evaluateRemoteLicenseAccess = (license, { toolName, canonicalToolName, mutating }) => {
    if (toolName === "get-license-status") {
        return { allowed: true, reason: "diagnostic tool always allowed" };
    }
    const status = typeof license?.status === "string" ? license.status : "invalid";
    const entitlements = license?.entitlements && typeof license.entitlements === "object" ? license.entitlements : {};
    if (entitlements.tools && typeof entitlements.tools === "object") {
        const namesToCheck = Array.from(new Set([toolName, canonicalToolName].filter(Boolean)));
        const disabledName = namesToCheck.find((name) => entitlements.tools[name] === false);
        if (disabledName) {
            return { allowed: false, reason: `Tool '${disabledName}' is disabled by license entitlements` };
        }
    }
    if (mutating && entitlements.mutations === false) {
        return { allowed: false, reason: "Mutation tools disabled by license entitlements" };
    }
    if (status === "active") {
        return { allowed: true, reason: "active" };
    }
    const now = Date.now();
    if (status === "past_due") {
        const graceUntilMs = Date.parse(license?.graceUntil || "");
        if (!Number.isNaN(graceUntilMs) && now <= graceUntilMs) {
            return { allowed: true, reason: "past_due within grace window" };
        }
        if (mutating) {
            return { allowed: false, reason: "past_due grace expired for mutation tools" };
        }
        return { allowed: true, reason: "past_due grace expired; read-only access retained" };
    }
    if (status === "canceled" || status === "unpaid") {
        const readOnlyGraceUntilMs = Date.parse(license?.readOnlyGraceUntil || "");
        if (!mutating && !Number.isNaN(readOnlyGraceUntilMs) && now <= readOnlyGraceUntilMs) {
            return { allowed: true, reason: "canceled/unpaid read-only grace active" };
        }
        return { allowed: false, reason: "canceled/unpaid license blocks this operation" };
    }
    return { allowed: false, reason: "invalid license status" };
};
const freezeExecutionContext = (context) => {
    const safeLicense = context?.license && typeof context.license === "object"
        ? Object.freeze({ ...context.license })
        : Object.freeze({});
    const grantedScope = typeof context?.grantedScope === "string" && context.grantedScope.trim()
        ? context.grantedScope.trim()
        : null;
    const scopeCapabilities = context?.scopeCapabilities && typeof context.scopeCapabilities === "object"
        ? Object.freeze({
            read: Boolean(context.scopeCapabilities.read),
            write: Boolean(context.scopeCapabilities.write),
            legacyFullAccess: Boolean(context.scopeCapabilities.legacyFullAccess),
        })
        : defaultMcpScopeCapabilities;
    return Object.freeze({
        mcpToken: context?.mcpToken || null,
        tokenHash: context?.tokenHash || null,
        requestId: context?.requestId || null,
        tokenId: context?.tokenId || null,
        tenantId: String(context?.tenantId || "unknown"),
        licenseKey: context?.licenseKey || null,
        license: safeLicense,
        shopifyDomain: context?.shopifyDomain || null,
        shopifyClient: context?.shopifyClient || null,
        grantedScope,
        scopeCapabilities,
        targetResource: context?.targetResource || null,
    });
};
const cacheRemoteContext = (tokenHash, context) => {
    if (!tokenHash || HAZIFY_MCP_CONTEXT_TTL_MS <= 0) {
        return;
    }
    remoteContextCache.set(tokenHash, {
        context,
        expiresAtMs: Date.now() + Math.max(HAZIFY_MCP_CONTEXT_TTL_MS, 1000),
    });
};
const resolveRemoteShopifyAccessToken = async (bearerToken) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
        const response = await fetch(`${HAZIFY_MCP_INTROSPECTION_URL.replace(/\/+$/, "")}/v1/mcp/token/exchange`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Accept": "application/json",
                "x-mcp-api-key": HAZIFY_MCP_API_KEY,
            },
            body: JSON.stringify({
                token: bearerToken,
                timestamp: new Date().toISOString(),
            }),
            signal: controller.signal,
        });
        const text = await response.text();
        const payload = text ? JSON.parse(text) : {};
        if (!response.ok) {
            const reason = typeof payload.reason === "string" ? payload.reason : null;
            const message = typeof payload.message === "string" ? payload.message : null;
            const code = typeof payload.error === "string" ? payload.error : null;
            throw new Error(reason || message || code || `HTTP ${response.status}`);
        }
        if (!payload?.active) {
            throw new Error("Token exchange rejected inactive token");
        }
        const domain = normalizeShopDomain(payload?.shopify?.domain || "");
        if (!domain || !domain.endsWith(".myshopify.com")) {
            throw new Error("Token exchange response missing valid shopify domain");
        }
        const accessToken = typeof payload?.shopify?.accessToken === "string" && payload.shopify.accessToken.trim()
            ? payload.shopify.accessToken.trim()
            : null;
        if (!accessToken) {
            throw new Error("Token exchange response missing Shopify access token");
        }
        const expiresInSeconds = Number(payload?.shopify?.expiresInSeconds || 0);
        return {
            tokenId: payload?.tokenId || null,
            tenantId: payload?.tenantId || null,
            domain,
            accessToken,
            expiresAtMs: Number.isFinite(expiresInSeconds) && expiresInSeconds > 0
                ? Date.now() + Math.max(expiresInSeconds * 1000 - 5 * 60 * 1000, 60 * 1000)
                : Date.now() + 10 * 60 * 1000,
        };
    }
    finally {
        clearTimeout(timeout);
    }
};
const resolveRemoteContext = async (bearerToken, req = null) => {
    const tokenHash = sha256Hex(bearerToken);
    const cachedContext = remoteContextCache.get(tokenHash);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    let introspection;
    try {
        const response = await fetch(`${HAZIFY_MCP_INTROSPECTION_URL.replace(/\/+$/, "")}/v1/mcp/token/introspect`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Accept": "application/json",
                "x-mcp-api-key": HAZIFY_MCP_API_KEY,
            },
            body: JSON.stringify({
                token: bearerToken,
                timestamp: new Date().toISOString(),
            }),
            signal: controller.signal,
        });
        const text = await response.text();
        introspection = text ? JSON.parse(text) : {};
        if (!response.ok) {
            throw new Error(typeof introspection.message === "string" ? introspection.message : `HTTP ${response.status}`);
        }
    }
    finally {
        clearTimeout(timeout);
    }
    if (!introspection?.active) {
        throw new Error("Token is invalid or inactive");
    }
    const domain = normalizeShopDomain(introspection?.shopify?.domain || "");
    if (!domain || !domain.endsWith(".myshopify.com")) {
        throw new Error("Introspection response missing valid shopify domain");
    }
    const tenantId = String(introspection.tenantId || "unknown");
    const tokenId = typeof introspection.tokenId === "string" ? introspection.tokenId : null;
    const rawGrantedScope = String(introspection?.scope || introspection?.grantedScope || "").trim();
    const scopeCapabilities = rawGrantedScope
        ? getMcpScopeCapabilities(rawGrantedScope)
        : defaultMcpScopeCapabilities;
    const grantedScope = scopeCapabilities.normalizedScope || "";
    if (!scopeCapabilities.read) {
        throw new Error("Introspection response contains unsupported MCP scope");
    }
    const targetResource = normalizeBaseUrl(introspection?.resource || introspection?.targetResource || introspection?.aud || "");
    const expectedResource = req ? normalizeBaseUrl(resolvePublicMcpUrl(req)) : "";
    if (targetResource && expectedResource && targetResource !== expectedResource) {
        throw new Error("Token resource does not match this MCP resource");
    }
    let cachedShopifyClient = null;
    if (HAZIFY_MCP_CONTEXT_TTL_MS > 0 && cachedContext && cachedContext.expiresAtMs > Date.now()) {
        const cached = cachedContext.context;
        const tokenMatches = !tokenId || !cached?.tokenId || cached.tokenId === tokenId;
        if (cached?.tenantId === tenantId && cached?.shopifyDomain === domain && tokenMatches && cached?.shopifyClient) {
            cachedShopifyClient = cached.shopifyClient;
        }
    }
    const context = freezeExecutionContext({
        mcpToken: bearerToken,
        tokenHash,
        tokenId,
        tenantId,
        licenseKey: introspection.licenseKey || null,
        license: introspection.license || {},
        shopifyDomain: domain,
        shopifyClient: cachedShopifyClient,
        grantedScope,
        scopeCapabilities,
        targetResource,
    });
    cacheRemoteContext(tokenHash, context);
    return context;
};
const ensureRemoteShopifyClient = async (context) => {
    if (context?.shopifyClient) {
        return context;
    }
    const tokenHash = context?.tokenHash || null;
    const domain = normalizeShopDomain(context?.shopifyDomain || "");
    if (!domain || !domain.endsWith(".myshopify.com")) {
        throw new Error("Request context missing valid shopify domain");
    }
    const tenantId = String(context?.tenantId || "unknown");
    const tokenId = typeof context?.tokenId === "string" ? context.tokenId : null;
    if (tokenHash && HAZIFY_MCP_CONTEXT_TTL_MS > 0) {
        const cachedContext = remoteContextCache.get(tokenHash);
        if (cachedContext && cachedContext.expiresAtMs > Date.now()) {
            const cached = cachedContext.context;
            const tokenMatches = !tokenId || !cached?.tokenId || cached.tokenId === tokenId;
            if (cached?.shopifyClient && cached?.tenantId === tenantId && cached?.shopifyDomain === domain && tokenMatches) {
                const hydratedContext = freezeExecutionContext({
                    ...context,
                    shopifyClient: cached.shopifyClient,
                });
                cacheRemoteContext(tokenHash, hydratedContext);
                return hydratedContext;
            }
        }
    }
    const cacheKey = `${tenantId}:${domain}`;
    let cachedShopifyClient = remoteShopifyClientCache.get(cacheKey);
    if (cachedShopifyClient && cachedShopifyClient.expiresAtMs > Date.now()) {
        const hydratedContext = freezeExecutionContext({
            ...context,
            shopifyClient: cachedShopifyClient.client,
        });
        cacheRemoteContext(tokenHash, hydratedContext);
        return hydratedContext;
    }
    if (!context?.mcpToken) {
        throw new Error("Missing MCP token in request context");
    }
    const exchange = await resolveRemoteShopifyAccessToken(context.mcpToken);
    if (exchange.tenantId && String(exchange.tenantId) !== tenantId) {
        throw new Error("Token exchange tenant mismatch");
    }
    if (exchange.tokenId && tokenId && exchange.tokenId !== tokenId) {
        throw new Error("Token exchange token mismatch");
    }
    if (exchange.domain !== domain) {
        throw new Error("Token exchange domain mismatch");
    }
    const credentialFingerprint = sha256Hex(exchange.accessToken);
    cachedShopifyClient = remoteShopifyClientCache.get(cacheKey);
    if (!cachedShopifyClient ||
        cachedShopifyClient.credentialFingerprint !== credentialFingerprint ||
        cachedShopifyClient.expiresAtMs <= Date.now()) {
        const shopifyClient = new GraphQLClient(`https://${domain}/admin/api/${API_VERSION}/graphql.json`, {
            headers: {
                "X-Shopify-Access-Token": exchange.accessToken,
                "Content-Type": "application/json"
            }
        });
        cachedShopifyClient = {
            client: shopifyClient,
            credentialFingerprint,
            expiresAtMs: exchange.expiresAtMs,
        };
        remoteShopifyClientCache.set(cacheKey, cachedShopifyClient);
    }
    const hydratedContext = freezeExecutionContext({
        ...context,
        shopifyClient: cachedShopifyClient.client,
    });
    cacheRemoteContext(tokenHash, hydratedContext);
    return hydratedContext;
};
const tenantToolExecutionLocks = new Map();
let hazifyToolRegistry = null;
const getRegisteredTool = (toolName) => hazifyToolRegistry?.byName.get(toolName) || null;
const runSerializedByKey = async (key, work) => {
    const lockKey = key || "__default__";
    const previous = tenantToolExecutionLocks.get(lockKey) || Promise.resolve();
    const next = previous.then(work, work);
    const settled = next.then(() => undefined, () => undefined);
    tenantToolExecutionLocks.set(lockKey, settled);
    try {
        return await next;
    }
    finally {
        if (tenantToolExecutionLocks.get(lockKey) === settled) {
            tenantToolExecutionLocks.delete(lockKey);
        }
    }
};
const buildToolExecutionContext = (context = null) => freezeExecutionContext({
    tenantId: String(context?.tenantId || "unknown"),
    tokenHash: context?.tokenHash || null,
    requestId: context?.requestId || null,
    tokenId: context?.tokenId || null,
    licenseKey: context?.licenseKey || null,
    license: context?.license || {},
    shopifyDomain: context?.shopifyDomain || null,
    shopifyClient: context?.shopifyClient || null,
    grantedScope: context?.grantedScope || null,
    scopeCapabilities: context?.scopeCapabilities || defaultMcpScopeCapabilities,
    targetResource: context?.targetResource || null,
});
const toolRequiresShopifyClient = (toolName) => getRegisteredTool(toolName)?.requiresShopifyClient !== false;
const createInsufficientScopeError = (toolName, requiredScope = MCP_SCOPE_TOOLS_WRITE) => {
    const error = new Error(`Tool '${toolName}' requires scope '${requiredScope}'.`);
    error.status = 403;
    error.errorCode = "insufficient_scope";
    error.requiredScope = requiredScope;
    return error;
};
const createGetLicenseStatusExecute = () => async (_input, explicitContext = null) => {
    const context = explicitContext || requestContextStore.getStore();
    if (!context) {
        throw new Error("Missing request context");
    }
    const readDecision = evaluateRemoteLicenseAccess(context.license, {
        toolName: "status-read-check",
        mutating: false,
    });
    const writeDecision = evaluateRemoteLicenseAccess(context.license, {
        toolName: "status-write-check",
        mutating: true,
    });
    return {
        license: {
            status: context.license?.status || "invalid",
            entitlements: context.license?.entitlements || {},
            expiresAt: normalizeIsoDate(context.license?.expiresAt),
            graceUntil: normalizeIsoDate(context.license?.graceUntil),
            readOnlyGraceUntil: normalizeIsoDate(context.license?.readOnlyGraceUntil),
            source: "remote-introspection",
        },
        access: {
            read: readDecision.allowed,
            write: writeDecision.allowed,
            readReason: readDecision.reason,
            writeReason: writeDecision.reason,
        },
        mcpScope: {
            grantedScope: context.grantedScope,
            read: Boolean(context.scopeCapabilities?.read),
            write: Boolean(context.scopeCapabilities?.write),
            legacyFullAccess: Boolean(context.scopeCapabilities?.legacyFullAccess),
            source: "remote-introspection",
        },
        tenant: {
            id: context.tenantId,
            licenseKey: context.licenseKey,
            shopDomain: context.shopifyDomain,
            targetResource: context.targetResource || null,
        },
        server: {
            name: "Hazify MCP",
            version: SERVER_VERSION,
            transport: "http",
            sessionMode: MCP_SESSION_MODE,
        },
    };
};
async function runLicensedTool(tool, args) {
    const toolName = tool.name;
    const mutating = Boolean(tool.writeScopeRequired);
    const context = requestContextStore.getStore();
    if (!context) {
        throw new Error("Missing request context");
    }
    if (mutating && !context.scopeCapabilities?.write) {
        throw createInsufficientScopeError(toolName);
    }
    const decision = evaluateRemoteLicenseAccess(context.license, {
        toolName,
        canonicalToolName: tool.canonicalName,
        mutating,
    });
    if (!decision.allowed) {
        throw new Error(`License gate blocked '${toolName}': ${decision.reason}`);
    }
    const executeTool = async () => {
        const startedAt = Date.now();
        logHttpEvent("mcp_http_tool_call_started", {
            toolName,
            requestId: context.requestId || null,
            tenantId: context.tenantId || null,
            tokenId: context.tokenId || null,
            shopifyDomain: context.shopifyDomain || null,
            mutating,
        });
        let effectiveContext = context;
        try {
            if (toolRequiresShopifyClient(toolName) && !effectiveContext.shopifyClient) {
                effectiveContext = await ensureRemoteShopifyClient(effectiveContext);
            }
            const executionContext = buildToolExecutionContext(effectiveContext);
            if (!executionContext.shopifyClient && toolRequiresShopifyClient(toolName)) {
                throw new Error("Missing Shopify client in request execution context");
            }
            const result = await tool.execute(args, executionContext);
            const resultSummary = summarizeToolResultForLog(result);
            const logEvent = resultSummary.success === false
                ? "mcp_http_tool_call_domain_failed"
                : "mcp_http_tool_call_finished";
            logHttpEvent(logEvent, {
                toolName,
                requestId: context.requestId || null,
                tenantId: context.tenantId || null,
                tokenId: context.tokenId || null,
                shopifyDomain: context.shopifyDomain || null,
                durationMs: Date.now() - startedAt,
                ...resultSummary,
            });
            return toMcpResponse(result);
        }
        catch (error) {
            logHttpEvent("mcp_http_tool_call_failed", {
                toolName,
                requestId: context.requestId || null,
                tenantId: context.tenantId || null,
                tokenId: context.tokenId || null,
                shopifyDomain: context.shopifyDomain || null,
                durationMs: Date.now() - startedAt,
                error: error instanceof Error ? error.message : String(error),
            });
            throw error;
        }
    };
    if (!mutating) {
        return executeTool();
    }
    return runSerializedByKey(context.tenantId || context.tokenHash, executeTool);
}
hazifyToolRegistry = createHazifyToolRegistry({
    getLicenseStatusExecute: createGetLicenseStatusExecute(),
});
const createHazifyServer = () => {
    const server = createServerInstance();
    registerHazifyTools(server, hazifyToolRegistry, (tool, args) => runLicensedTool(tool, args));
    return server;
};
let shuttingDown = false;
let httpServer = null;
const shutdown = async () => {
    if (shuttingDown) {
        return;
    }
    shuttingDown = true;
    try {
        if (httpServer) {
            await new Promise((resolve) => httpServer.close(resolve));
        }
    }
    finally {
        process.exit(0);
    }
};
process.on("SIGINT", () => {
    shutdown().catch(() => process.exit(0));
});
process.on("SIGTERM", () => {
    shutdown().catch(() => process.exit(0));
});
const resolveAuthServerBaseUrl = () => {
    const fromEnv = normalizeBaseUrl(HAZIFY_MCP_AUTH_SERVER_URL);
    if (fromEnv) {
        return fromEnv;
    }
    return normalizeBaseUrl(HAZIFY_MCP_INTROSPECTION_URL || "");
};
const firstHeaderValue = (value) => {
    if (Array.isArray(value)) {
        return String(value[0] || "").split(",")[0].trim();
    }
    return typeof value === "string" ? value.split(",")[0].trim() : "";
};
const isAllowedMetadataHost = (value) => {
    const normalized = normalizeAllowedHostname(value);
    return Boolean(normalized && HAZIFY_MCP_ALLOWED_HOSTS.includes(normalized));
};
const resolveRequestBaseUrl = (req) => {
    const protoHeader = firstHeaderValue(req.headers["x-forwarded-proto"]);
    const forwardedHost = firstHeaderValue(req.headers["x-forwarded-host"]);
    const requestHost = firstHeaderValue(req.headers.host);
    const protocol = ["http", "https"].includes(protoHeader) ? protoHeader : "http";
    const host = forwardedHost && isAllowedMetadataHost(forwardedHost)
        ? forwardedHost
        : requestHost || `${HTTP_HOST}:${HTTP_PORT}`;
    return `${protocol}://${host}`;
};
const resolvePublicMcpUrl = (req) => {
    const explicit = normalizeBaseUrl(HAZIFY_MCP_PUBLIC_URL);
    if (explicit) {
        if (explicit.endsWith("/mcp")) {
            return explicit;
        }
        return explicit.endsWith("/") ? `${explicit}mcp` : `${explicit}/mcp`;
    }
    return `${resolveRequestBaseUrl(req)}/mcp`;
};
const buildAuthorizationServerMetadata = (req) => {
    const issuer = resolveAuthServerBaseUrl() || resolveRequestBaseUrl(req);
    return {
        issuer,
        authorization_endpoint: `${issuer}/oauth/authorize`,
        token_endpoint: `${issuer}/oauth/token`,
        registration_endpoint: `${issuer}/oauth/register`,
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code", "refresh_token"],
        token_endpoint_auth_methods_supported: ["none", "client_secret_post", "client_secret_basic"],
        code_challenge_methods_supported: ["S256"],
        scopes_supported: getDefaultMcpScopesSupported(),
        service_documentation: `${issuer}/onboarding`,
    };
};
const buildProtectedResourceMetadata = (req) => {
    const authServer = resolveAuthServerBaseUrl() || resolveRequestBaseUrl(req);
    return {
        resource: resolvePublicMcpUrl(req),
        authorization_servers: [authServer],
        scopes_supported: getDefaultMcpScopesSupported(),
        bearer_methods_supported: ["header"],
        resource_documentation: `${authServer}/onboarding`,
    };
};
const buildWwwAuthenticateHeader = (req, errorCode, description, scope = MCP_SCOPE_TOOLS) => {
    const metadataUrl = `${resolveRequestBaseUrl(req)}/.well-known/oauth-protected-resource`;
    const safeDescription = String(description || "").replace(/"/g, "'");
    return `Bearer realm="Hazify MCP", resource_metadata="${metadataUrl}", scope="${scope}", error="${errorCode}", error_description="${safeDescription}"`;
};
const logHttpEvent = (event, details = {}) => {
    try {
        console.log(JSON.stringify({
            ts: new Date().toISOString(),
            event,
            ...details,
        }));
    }
    catch {
        // Logging should never break MCP responses.
    }
};
const uniqueLogStrings = (values, limit = 5) => Array.from(new Set((Array.isArray(values) ? values : [])
    .filter((value) => typeof value === "string" && value.trim())
    .map((value) => value.trim()))).slice(0, limit);
const summarizeLogPath = (value) => {
    if (Array.isArray(value)) {
        const normalized = value
            .map((entry) => String(entry ?? "").trim())
            .filter(Boolean);
        return normalized.length > 0 ? normalized.join(".") : null;
    }
    if (typeof value === "string" && value.trim()) {
        return value.trim();
    }
    return null;
};
const summarizeToolFailureForLog = (result) => {
    const errors = Array.isArray(result?.errors)
        ? result.errors.filter((entry) => entry && typeof entry === "object")
        : [];
    const lintIssues = Array.isArray(result?.lintIssues)
        ? result.lintIssues.filter((entry) => entry && typeof entry === "object")
        : [];
    const warnings = Array.isArray(result?.warnings) ? result.warnings.filter(Boolean) : [];
    const suggestedFixes = Array.isArray(result?.suggestedFixes)
        ? result.suggestedFixes.filter(Boolean)
        : [];
    const primaryError = errors[0] || null;
    const primaryLintIssue = lintIssues[0] || null;
    return {
        primaryIssueCode: typeof primaryError?.code === "string"
            ? primaryError.code
            : typeof primaryLintIssue?.code === "string"
                ? primaryLintIssue.code
                : typeof primaryLintIssue?.check === "string"
                    ? primaryLintIssue.check
                    : typeof result?.errorCode === "string"
                        ? result.errorCode
                        : null,
        primaryPath: summarizeLogPath(primaryError?.path ?? primaryLintIssue?.path),
        primaryCheck: typeof primaryLintIssue?.check === "string" ? primaryLintIssue.check : null,
        primaryLine: Number.isInteger(primaryLintIssue?.line) ? primaryLintIssue.line : null,
        primaryColumn: Number.isInteger(primaryLintIssue?.column) ? primaryLintIssue.column : null,
        errorCount: errors.length,
        lintIssueCount: lintIssues.length,
        lintChecks: uniqueLogStrings(lintIssues.map((entry) => entry?.check)),
        warningCount: warnings.length,
        suggestedFixCount: suggestedFixes.length,
        failedKeys: uniqueLogStrings(result?.failedKeys),
    };
};
const summarizeToolResultForLog = (result) => {
    const summary = {
        success: typeof result?.success === "boolean" ? result.success : true,
        status: typeof result?.status === "string" ? result.status : null,
        errorCode: typeof result?.errorCode === "string" ? result.errorCode : null,
        retryable: typeof result?.retryable === "boolean" ? result.retryable : null,
        draftId: typeof result?.draftId === "string" ? result.draftId : null,
        themeId: result?.themeId ?? null,
        themeRole: typeof result?.themeRole === "string" ? result.themeRole : null,
        analysisId: typeof result?.analysisId === "string" ? result.analysisId : null,
        nextTool: typeof result?.nextTool === "string"
            ? result.nextTool
            : typeof result?.nextAction?.tool === "string"
                ? result.nextAction.tool
                : null,
        warningCount: Array.isArray(result?.warnings) ? result.warnings.filter(Boolean).length : 0,
    };
    if (summary.success === false) {
        summary.failureSummary = summarizeToolFailureForLog(result);
    }
    return summary;
};
const requestLogContext = (req) => ({
    requestId: typeof req?.hazifyRequestId === "string" ? req.hazifyRequestId : null,
    method: req.method || null,
    path: req.originalUrl || req.url || null,
    origin: typeof req.headers.origin === "string" ? req.headers.origin : null,
    userAgent: typeof req.headers["user-agent"] === "string" ? req.headers["user-agent"] : null,
});
const parseBearerToken = (authorizationHeader) => {
    if (typeof authorizationHeader !== "string") {
        return null;
    }
    const match = authorizationHeader.match(/^Bearer\s+(.+)$/i);
    if (!match?.[1]) {
        return null;
    }
    return match[1].trim();
};
const parseRawToken = (value) => {
    if (typeof value !== "string") {
        return null;
    }
    const token = value.trim();
    if (!token) {
        return null;
    }
    return token;
};
const resolveRequestToken = (req) => {
    const bearer = parseBearerToken(req.headers.authorization);
    if (bearer) {
        return bearer;
    }
    const xApiKeyHeader = req.headers["x-api-key"];
    const xApiKey = Array.isArray(xApiKeyHeader) ? parseRawToken(xApiKeyHeader[0]) : parseRawToken(xApiKeyHeader);
    if (xApiKey) {
        return xApiKey;
    }
    return null;
};
const ensureCompatibleStreamableAcceptHeader = (req) => {
    const headerValue = Array.isArray(req.headers.accept)
        ? req.headers.accept.join(", ")
        : typeof req.headers.accept === "string"
            ? req.headers.accept
            : "";
    const applyHeader = (nextValue) => {
        req.headers.accept = nextValue;
        if (Array.isArray(req.rawHeaders)) {
            let replaced = false;
            for (let index = 0; index < req.rawHeaders.length - 1; index += 2) {
                const key = String(req.rawHeaders[index] || "").toLowerCase();
                if (key === "accept") {
                    req.rawHeaders[index + 1] = nextValue;
                    replaced = true;
                    break;
                }
            }
            if (!replaced) {
                req.rawHeaders.push("accept", nextValue);
            }
        }
    };
    const normalized = headerValue.toLowerCase();
    const hasWildcard = normalized.includes("*/*");
    if (hasWildcard) {
        applyHeader("application/json, text/event-stream");
        return;
    }
    const hasJson = hasWildcard || normalized.includes("application/json");
    const hasSse = hasWildcard || normalized.includes("text/event-stream");
    if (hasJson && hasSse) {
        return;
    }
    if (hasJson && !hasSse) {
        applyHeader(headerValue
            ? `${headerValue}, text/event-stream`
            : "application/json, text/event-stream");
        return;
    }
    if (!hasJson && hasSse) {
        applyHeader(headerValue
            ? `${headerValue}, application/json`
            : "application/json, text/event-stream");
        return;
    }
    applyHeader("application/json, text/event-stream");
};
const isRequestOriginAllowed = (req) => {
    return isOriginAllowed({
        originHeader: req.headers.origin,
        requestBaseUrl: resolveRequestBaseUrl(req),
        allowedOrigins: HAZIFY_MCP_ALLOWED_ORIGINS
    });
};
{
    const app = createMcpExpressApp({
        host: HTTP_HOST,
        allowedHosts: HAZIFY_MCP_ALLOWED_HOSTS,
    });
    app.use((req, res, next) => {
        const forwardedRequestId = typeof req.headers["x-request-id"] === "string" && req.headers["x-request-id"].trim()
            ? req.headers["x-request-id"].trim().slice(0, 200)
            : null;
        req.hazifyRequestId = forwardedRequestId || crypto.randomUUID();
        res.setHeader("X-Request-Id", req.hazifyRequestId);
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.setHeader("Referrer-Policy", "no-referrer");
        res.setHeader("X-Frame-Options", "DENY");
        res.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
        next();
    });
    const useStatefulSessions = MCP_SESSION_MODE === "stateful";
    const sessions = new Map();
    const respondJsonRpcError = (res, statusCode, message, code = -32000) => {
        res.status(statusCode).json({
            jsonrpc: "2.0",
            error: { code, message },
            id: null,
        });
    };
    const respondUnauthorized = (req, res, message) => {
        logHttpEvent("mcp_http_unauthorized", {
            ...requestLogContext(req),
            reason: message,
        });
        res.setHeader("WWW-Authenticate", buildWwwAuthenticateHeader(req, "invalid_token", message));
        respondJsonRpcError(res, 401, message, -32001);
    };
    const respondInsufficientScope = (req, res, message, requiredScope = MCP_SCOPE_TOOLS_WRITE) => {
        logHttpEvent("mcp_http_insufficient_scope", {
            ...requestLogContext(req),
            reason: message,
            requiredScope,
        });
        res.setHeader("WWW-Authenticate", buildWwwAuthenticateHeader(req, "insufficient_scope", message, requiredScope));
        respondJsonRpcError(res, 403, message, -32001);
    };
    const respondMethodNotAllowed = (res, message, allowedMethods = []) => {
        if (Array.isArray(allowedMethods) && allowedMethods.length) {
            res.setHeader("Allow", allowedMethods.join(", "));
        }
        respondJsonRpcError(res, 405, message, -32000);
    };
    const assertAllowedOrigin = (req, res) => {
        const decision = isRequestOriginAllowed(req);
        if (!decision.allowed) {
            logHttpEvent("mcp_http_origin_rejected", {
                ...requestLogContext(req),
                reason: decision.reason,
            });
            respondJsonRpcError(res, 403, `Forbidden: ${decision.reason}`);
            return false;
        }
        return true;
    };
    const redirectCompatToAuthServer = (req, res, targetPath, statusCode = 307) => {
        const authBase = resolveAuthServerBaseUrl();
        if (!authBase) {
            respondJsonRpcError(res, 500, "OAuth authorization server is not configured", -32603);
            return;
        }
        const currentUrl = new URL(req.originalUrl || req.url || "/", "http://localhost");
        const target = new URL(`${authBase}${targetPath}`);
        currentUrl.searchParams.forEach((value, key) => target.searchParams.append(key, value));
        res.redirect(statusCode, target.toString());
    };
    app.get("/.well-known/oauth-authorization-server", (req, res) => {
        res.setHeader("Cache-Control", "no-store");
        res.json(buildAuthorizationServerMetadata(req));
    });
    // Compatibility route for clients that resolve metadata under /mcp/.well-known/*
    app.get("/mcp/.well-known/oauth-authorization-server", (req, res) => {
        res.setHeader("Cache-Control", "no-store");
        res.json(buildAuthorizationServerMetadata(req));
    });
    app.get("/.well-known/openid-configuration", (req, res) => {
        res.setHeader("Cache-Control", "no-store");
        res.json({
            ...buildAuthorizationServerMetadata(req),
            subject_types_supported: ["public"],
            id_token_signing_alg_values_supported: ["none"],
            claims_supported: [],
        });
    });
    // Compatibility route for clients that resolve metadata under /mcp/.well-known/*
    app.get("/mcp/.well-known/openid-configuration", (req, res) => {
        res.setHeader("Cache-Control", "no-store");
        res.json({
            ...buildAuthorizationServerMetadata(req),
            subject_types_supported: ["public"],
            id_token_signing_alg_values_supported: ["none"],
            claims_supported: [],
        });
    });
    app.get(/^\/\.well-known\/oauth-protected-resource(\/.*)?$/, (req, res) => {
        res.setHeader("Cache-Control", "no-store");
        res.json(buildProtectedResourceMetadata(req));
    });
    // Compatibility route for clients that resolve metadata under /mcp/.well-known/*
    app.get(/^\/mcp\/\.well-known\/oauth-protected-resource(\/.*)?$/, (req, res) => {
        res.setHeader("Cache-Control", "no-store");
        res.json(buildProtectedResourceMetadata(req));
    });
    app.get("/authorize", (req, res) => redirectCompatToAuthServer(req, res, "/oauth/authorize", 302));
    app.post("/authorize", (req, res) => redirectCompatToAuthServer(req, res, "/oauth/authorize", 307));
    app.post("/register", (req, res) => redirectCompatToAuthServer(req, res, "/oauth/register", 307));
    app.post("/token", (req, res) => redirectCompatToAuthServer(req, res, "/oauth/token", 307));
    const resolveRequestAuthContext = async (req, res) => {
        const token = resolveRequestToken(req);
        if (!token) {
            respondUnauthorized(req, res, "Missing API token (use Authorization: Bearer or x-api-key)");
            return null;
        }
        try {
            const resolvedContext = await resolveRemoteContext(token, req);
            return freezeExecutionContext({
                ...resolvedContext,
                requestId: typeof req?.hazifyRequestId === "string" ? req.hazifyRequestId : null,
            });
        }
        catch (error) {
            respondUnauthorized(req, res, error instanceof Error ? error.message : String(error));
            return null;
        }
    };
    const resolveScopeBlockedTool = (body, context) => {
        if (!body || Array.isArray(body) || body.method !== "tools/call") {
            return null;
        }
        const toolName = typeof body?.params?.name === "string" ? body.params.name : "";
        if (!toolName) {
            return null;
        }
        const tool = getRegisteredTool(toolName);
        if (!tool?.writeScopeRequired || context?.scopeCapabilities?.write) {
            return null;
        }
        return {
            toolName,
            requiredScope: MCP_SCOPE_TOOLS_WRITE,
        };
    };
    app.post("/mcp", async (req, res) => {
        if (!assertAllowedOrigin(req, res)) {
            return;
        }
        // Some clients send narrow Accept headers (e.g. application/json only).
        // Streamable HTTP transport validation expects both JSON and SSE tokens.
        ensureCompatibleStreamableAcceptHeader(req);
        const context = await resolveRequestAuthContext(req, res);
        if (!context) {
            return;
        }
        const scopeBlockedTool = resolveScopeBlockedTool(req.body, context);
        if (scopeBlockedTool) {
            respondInsufficientScope(req, res, `Tool '${scopeBlockedTool.toolName}' requires write scope.`, scopeBlockedTool.requiredScope);
            return;
        }
        if (isInitializeRequest(req.body)) {
            logHttpEvent("mcp_http_initialize", {
                ...requestLogContext(req),
                sessionMode: MCP_SESSION_MODE,
                tokenId: context.tokenId || null,
                tenantId: context.tenantId || null,
                shopifyDomain: context.shopifyDomain || null,
            });
        }
        if (!useStatefulSessions) {
            if (typeof req.headers["mcp-session-id"] === "string") {
                respondJsonRpcError(res, 400, "Bad Request: stateless mode does not accept mcp-session-id");
                return;
            }
            const statelessServer = createHazifyServer();
            const transport = new StreamableHTTPServerTransport({
                sessionIdGenerator: undefined,
                enableJsonResponse: true,
            });
            try {
                await statelessServer.connect(transport);
                await requestContextStore.run(context, async () => {
                    await transport.handleRequest(req, res, req.body);
                });
            }
            catch (error) {
                if (!res.headersSent) {
                    respondJsonRpcError(res, 500, error instanceof Error ? error.message : String(error), -32603);
                }
            }
            return;
        }
        const sessionIdHeader = req.headers["mcp-session-id"];
        const sessionId = typeof sessionIdHeader === "string" ? sessionIdHeader : null;
        if (sessionId) {
            const existing = sessions.get(sessionId);
            if (!existing) {
                respondJsonRpcError(res, 400, "Bad Request: invalid or expired mcp-session-id");
                return;
            }
            if (existing.tokenHash !== context.tokenHash) {
                respondJsonRpcError(res, 403, "Forbidden: token does not match active session");
                return;
            }
            existing.context = context;
            try {
                await requestContextStore.run(context, async () => {
                    await existing.transport.handleRequest(req, res, req.body);
                });
            }
            catch (error) {
                if (!res.headersSent) {
                    respondJsonRpcError(res, 500, error instanceof Error ? error.message : String(error), -32603);
                }
            }
            return;
        }
        if (!isInitializeRequest(req.body)) {
            respondJsonRpcError(res, 400, "Bad Request: initialize request required when no mcp-session-id is provided (use Streamable HTTP transport)");
            return;
        }
        const sessionServer = createHazifyServer();
        const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => crypto.randomUUID(),
            enableJsonResponse: true,
            onsessioninitialized: (sessionId) => {
                sessions.set(sessionId, {
                    tokenHash: context.tokenHash,
                    context,
                    transport,
                    server: sessionServer,
                });
            },
        });
        transport.onclose = () => {
            const sid = transport.sessionId;
            if (sid) {
                sessions.delete(sid);
            }
        };
        try {
            await sessionServer.connect(transport);
            await requestContextStore.run(context, async () => {
                await transport.handleRequest(req, res, req.body);
            });
        }
        catch (error) {
            if (!res.headersSent) {
                respondJsonRpcError(res, 500, error instanceof Error ? error.message : String(error), -32603);
            }
        }
    });
    app.get("/mcp", async (req, res) => {
        if (!assertAllowedOrigin(req, res)) {
            return;
        }
        if (!useStatefulSessions) {
            respondMethodNotAllowed(res, "Method Not Allowed: stateless mode only supports POST /mcp", ["POST"]);
            return;
        }
        const context = await resolveRequestAuthContext(req, res);
        if (!context) {
            return;
        }
        const sessionIdHeader = req.headers["mcp-session-id"];
        const sessionId = typeof sessionIdHeader === "string" ? sessionIdHeader : null;
        if (!sessionId) {
            respondJsonRpcError(res, 400, "Bad Request: missing mcp-session-id (client likely using wrong transport; choose Streamable HTTP)");
            return;
        }
        const existing = sessions.get(sessionId);
        if (!existing) {
            respondJsonRpcError(res, 400, "Bad Request: invalid or expired mcp-session-id");
            return;
        }
        if (existing.tokenHash !== context.tokenHash) {
            respondJsonRpcError(res, 403, "Forbidden: token does not match active session");
            return;
        }
        existing.context = context;
        try {
            await requestContextStore.run(context, async () => {
                await existing.transport.handleRequest(req, res);
            });
        }
        catch (error) {
            if (!res.headersSent) {
                respondJsonRpcError(res, 500, error instanceof Error ? error.message : String(error), -32603);
            }
        }
    });
    app.delete("/mcp", async (req, res) => {
        if (!assertAllowedOrigin(req, res)) {
            return;
        }
        if (!useStatefulSessions) {
            respondMethodNotAllowed(res, "Method Not Allowed: stateless mode does not use DELETE /mcp sessions", ["POST"]);
            return;
        }
        const context = await resolveRequestAuthContext(req, res);
        if (!context) {
            return;
        }
        const sessionIdHeader = req.headers["mcp-session-id"];
        const sessionId = typeof sessionIdHeader === "string" ? sessionIdHeader : null;
        if (!sessionId) {
            respondJsonRpcError(res, 400, "Bad Request: missing mcp-session-id (client likely using wrong transport; choose Streamable HTTP)");
            return;
        }
        const existing = sessions.get(sessionId);
        if (!existing) {
            respondJsonRpcError(res, 400, "Bad Request: invalid or expired mcp-session-id");
            return;
        }
        if (existing.tokenHash !== context.tokenHash) {
            respondJsonRpcError(res, 403, "Forbidden: token does not match active session");
            return;
        }
        existing.context = context;
        try {
            await requestContextStore.run(context, async () => {
                await existing.transport.handleRequest(req, res);
            });
        }
        catch (error) {
            if (!res.headersSent) {
                respondJsonRpcError(res, 500, error instanceof Error ? error.message : String(error), -32603);
            }
        }
    });
    httpServer = app.listen(HTTP_PORT, HTTP_HOST, () => {
        console.log(`Hazify MCP HTTP server listening on ${HTTP_HOST}:${HTTP_PORT} (session mode: ${MCP_SESSION_MODE})`);
    });
    if (httpServer && typeof httpServer.ref === "function") {
        // Some runtimes expose unref'd servers; keep the process alive in remote HTTP mode.
        httpServer.ref();
    }
}
export { httpServer };
