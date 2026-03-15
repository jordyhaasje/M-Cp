#!/usr/bin/env node
import { AsyncLocalStorage } from "async_hooks";
import crypto from "crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import {
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
import { z } from "zod";
// Import tools
import { getCustomerOrders } from "./tools/getCustomerOrders.js";
import { getCustomers } from "./tools/getCustomers.js";
import { getOrderById } from "./tools/getOrderById.js";
import { getOrders } from "./tools/getOrders.js";
import { getProductById } from "./tools/getProductById.js";
import { getProducts } from "./tools/getProducts.js";
import { updateCustomer } from "./tools/updateCustomer.js";
import { updateOrder } from "./tools/updateOrder.js";
import { createProduct } from "./tools/createProduct.js";
import { updateProduct } from "./tools/updateProduct.js";
import { manageProductVariants } from "./tools/manageProductVariants.js";
import { deleteProductVariants } from "./tools/deleteProductVariants.js";
import { deleteProduct } from "./tools/deleteProduct.js";
import { manageProductOptions } from "./tools/manageProductOptions.js";
import { refundOrder } from "./tools/refundOrder.js";
import { cloneProductFromUrl } from "./tools/cloneProductFromUrl.js";
import { getSupportedTrackingCompanies } from "./tools/getSupportedTrackingCompanies.js";
import { updateFulfillmentTracking } from "./tools/updateFulfillmentTracking.js";
import { setOrderTracking } from "./tools/setOrderTracking.js";
import { getThemes } from "./tools/getThemes.js";
import { getThemeFileTool } from "./tools/getThemeFile.js";
import { getThemeFilesTool } from "./tools/getThemeFiles.js";
import { upsertThemeFileTool } from "./tools/upsertThemeFile.js";
import { upsertThemeFilesTool } from "./tools/upsertThemeFiles.js";
import { deleteThemeFileTool } from "./tools/deleteThemeFile.js";
import { verifyThemeFilesTool } from "./tools/verifyThemeFiles.js";
import { listThemeImportTools } from "./tools/listThemeImportTools.js";
import { ShopifyAuth } from "./lib/shopifyAuth.js";
import { LicenseManager } from "./lib/licenseManager.js";
import { createMachineFingerprint } from "./lib/machineFingerprint.js";
// Parse command line arguments
const argv = minimist(process.argv.slice(2));
// Load environment variables from .env file (if it exists)
dotenv.config();
const TRANSPORT = String(argv.transport || process.env.HAZIFY_MCP_TRANSPORT || "http").toLowerCase();
const IS_HTTP_TRANSPORT = TRANSPORT === "http" || TRANSPORT === "streamable-http";
const HTTP_HOST = argv.host || process.env.HAZIFY_MCP_HTTP_HOST || "0.0.0.0";
const HTTP_PORT = Number(argv.port || process.env.PORT || process.env.HAZIFY_MCP_HTTP_PORT || 8788);
// Define environment variables - from command line or .env file
const SHOPIFY_ACCESS_TOKEN = argv.accessToken || process.env.SHOPIFY_ACCESS_TOKEN;
const SHOPIFY_CLIENT_ID = argv.clientId || process.env.SHOPIFY_CLIENT_ID;
const SHOPIFY_CLIENT_SECRET = argv.clientSecret || process.env.SHOPIFY_CLIENT_SECRET;
const MYSHOPIFY_DOMAIN = argv.domain || process.env.MYSHOPIFY_DOMAIN;
const HAZIFY_LICENSE_KEY = argv.licenseKey || process.env.HAZIFY_LICENSE_KEY;
const HAZIFY_LICENSE_API_BASE_URL = argv.licenseApiBaseUrl || process.env.HAZIFY_LICENSE_API_BASE_URL;
const HAZIFY_LICENSE_GRACE_HOURS = Number(argv.licenseGraceHours || process.env.HAZIFY_LICENSE_GRACE_HOURS || 72);
const HAZIFY_LICENSE_HEARTBEAT_HOURS = Number(argv.licenseHeartbeatHours || process.env.HAZIFY_LICENSE_HEARTBEAT_HOURS || 6);
const HAZIFY_MCP_INTROSPECTION_URL = argv.mcpIntrospectionUrl || process.env.HAZIFY_MCP_INTROSPECTION_URL;
const HAZIFY_MCP_API_KEY = argv.mcpApiKey || process.env.HAZIFY_MCP_API_KEY;
const DEFAULT_CONTEXT_TTL_MS = IS_HTTP_TRANSPORT ? 120000 : 0;
const HAZIFY_MCP_CONTEXT_TTL_MS = Number(
    argv.mcpContextTtlMs || process.env.HAZIFY_MCP_CONTEXT_TTL_MS || DEFAULT_CONTEXT_TTL_MS
);
const HAZIFY_MCP_PUBLIC_URL = argv.mcpPublicUrl || process.env.HAZIFY_MCP_PUBLIC_URL || "";
const HAZIFY_MCP_AUTH_SERVER_URL = argv.oauthAuthServerUrl || process.env.HAZIFY_MCP_AUTH_SERVER_URL || "";
const HAZIFY_MCP_ALLOWED_ORIGINS = parseCommaSeparatedList(argv.allowedOrigins || process.env.HAZIFY_MCP_ALLOWED_ORIGINS || "");
const MCP_SESSION_MODE = String(argv.sessionMode || process.env.MCP_SESSION_MODE || "stateless").trim().toLowerCase();
const MCP_STATEFUL_DEPLOYMENT_SAFE = String(argv.statefulDeploymentSafe || process.env.MCP_STATEFUL_DEPLOYMENT_SAFE || "")
    .trim()
    .toLowerCase() === "true";
const useClientCredentials = !!(SHOPIFY_CLIENT_ID && SHOPIFY_CLIENT_SECRET);
const SERVER_VERSION = "1.1.0";
const API_VERSION = argv.apiVersion || process.env.SHOPIFY_API_VERSION || "2026-01";
const requestContextStore = new AsyncLocalStorage();
const remoteContextCache = new Map();
const remoteShopifyClientCache = new Map();
if (!["stateless", "stateful"].includes(MCP_SESSION_MODE)) {
    console.error("Error: MCP_SESSION_MODE must be 'stateless' or 'stateful'.");
    process.exit(1);
}
if (!IS_HTTP_TRANSPORT) {
    // Store in process.env for backwards compatibility
    process.env.MYSHOPIFY_DOMAIN = MYSHOPIFY_DOMAIN;
}
if (IS_HTTP_TRANSPORT) {
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
}
else {
    if (!HAZIFY_LICENSE_KEY || !HAZIFY_LICENSE_API_BASE_URL) {
        console.error("Error: Hazify license config is required.");
        console.error("Provide:");
        console.error("  --licenseKey=... or HAZIFY_LICENSE_KEY");
        console.error("  --licenseApiBaseUrl=https://... or HAZIFY_LICENSE_API_BASE_URL");
        process.exit(1);
    }
    // Validate required environment variables
    if (!SHOPIFY_ACCESS_TOKEN && !useClientCredentials) {
        console.error("Error: Authentication credentials are required.");
        console.error("");
        console.error("Option 1 — Static access token (legacy apps):");
        console.error("  --accessToken=shpat_xxxxx");
        console.error("");
        console.error("Option 2 — Client credentials (Dev Dashboard apps, Jan 2026+):");
        console.error("  --clientId=your_client_id --clientSecret=your_client_secret");
        process.exit(1);
    }
    if (!MYSHOPIFY_DOMAIN) {
        console.error("Error: MYSHOPIFY_DOMAIN is required.");
        console.error("Please provide it via command line argument or .env file.");
        console.error("  Command line: --domain=your-store.myshopify.com");
        process.exit(1);
    }
}
let localShopifyClient = null;
let licenseManager = null;
let auth = null;
if (!IS_HTTP_TRANSPORT) {
    licenseManager = new LicenseManager({
        licenseKey: HAZIFY_LICENSE_KEY,
        apiBaseUrl: HAZIFY_LICENSE_API_BASE_URL.replace(/\/+$/, ""),
        graceHours: Number.isFinite(HAZIFY_LICENSE_GRACE_HOURS) && HAZIFY_LICENSE_GRACE_HOURS > 0 ? HAZIFY_LICENSE_GRACE_HOURS : 72,
        heartbeatHours: Number.isFinite(HAZIFY_LICENSE_HEARTBEAT_HOURS) && HAZIFY_LICENSE_HEARTBEAT_HOURS > 0 ? HAZIFY_LICENSE_HEARTBEAT_HOURS : 6,
        machineFingerprint: createMachineFingerprint(),
        mcpVersion: SERVER_VERSION,
        requestTimeoutMs: 10000,
    });
    try {
        await licenseManager.initialize();
    }
    catch (error) {
        console.error("License validation failed:", error instanceof Error ? error.message : String(error));
        process.exit(1);
    }
    // Resolve access token (client credentials or static)
    let accessToken;
    if (useClientCredentials) {
        auth = new ShopifyAuth({
            clientId: SHOPIFY_CLIENT_ID,
            clientSecret: SHOPIFY_CLIENT_SECRET,
            shopDomain: MYSHOPIFY_DOMAIN,
        });
        accessToken = await auth.initialize();
    }
    else {
        accessToken = SHOPIFY_ACCESS_TOKEN;
    }
    process.env.SHOPIFY_ACCESS_TOKEN = accessToken;
    // Create Shopify GraphQL client
    const shopifyClient = new GraphQLClient(`https://${MYSHOPIFY_DOMAIN}/admin/api/${API_VERSION}/graphql.json`, {
        headers: {
            "X-Shopify-Access-Token": accessToken,
            "Content-Type": "application/json"
        }
    });
    // Let the auth manager hot-swap the token header on refresh
    if (auth) {
        auth.setGraphQLClient(shopifyClient);
    }
    localShopifyClient = shopifyClient;
}
// Set up MCP server
const createServerInstance = () => new McpServer({
    name: "Hazify MCP",
    version: SERVER_VERSION,
    description: "Hazify Shopify MCP with paid licensing, BYO Shopify credentials, and fulfillment-safe operations"
});
const toMcpResponse = (result) => {
    const structuredContent = result && typeof result === "object" ? result : { result };
    return {
        content: [{ type: "text", text: JSON.stringify(structuredContent) }],
        structuredContent,
        isError: false,
    };
};
const normalizeIsoDate = (value) => {
    if (!value || typeof value !== "string") {
        return null;
    }
    const ms = Date.parse(value);
    return Number.isNaN(ms) ? null : new Date(ms).toISOString();
};
const evaluateRemoteLicenseAccess = (license, { toolName, mutating }) => {
    if (toolName === "get-license-status") {
        return { allowed: true, reason: "diagnostic tool always allowed" };
    }
    const status = typeof license?.status === "string" ? license.status : "invalid";
    const entitlements = license?.entitlements && typeof license.entitlements === "object" ? license.entitlements : {};
    if (entitlements.tools && typeof entitlements.tools === "object" && entitlements.tools[toolName] === false) {
        return { allowed: false, reason: `Tool '${toolName}' is disabled by license entitlements` };
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
    return Object.freeze({
        tokenHash: context?.tokenHash || null,
        tokenId: context?.tokenId || null,
        tenantId: String(context?.tenantId || "unknown"),
        licenseKey: context?.licenseKey || null,
        license: safeLicense,
        shopifyDomain: context?.shopifyDomain || null,
        shopifyClient: context?.shopifyClient || null,
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
            throw new Error(typeof payload.message === "string" ? payload.message : `HTTP ${response.status}`);
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
const resolveRemoteContext = async (bearerToken) => {
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
    if (HAZIFY_MCP_CONTEXT_TTL_MS > 0 && cachedContext && cachedContext.expiresAtMs > Date.now()) {
        const cached = cachedContext.context;
        const tokenMatches = !tokenId || !cached?.tokenId || cached.tokenId === tokenId;
        if (cached?.shopifyClient && cached.tenantId === tenantId && cached.shopifyDomain === domain && tokenMatches) {
            const context = freezeExecutionContext({
                tokenHash,
                tokenId,
                tenantId,
                licenseKey: introspection.licenseKey || null,
                license: introspection.license || {},
                shopifyDomain: domain,
                shopifyClient: cached.shopifyClient,
            });
            remoteContextCache.set(tokenHash, {
                context,
                expiresAtMs: Date.now() + Math.max(HAZIFY_MCP_CONTEXT_TTL_MS, 1000),
            });
            return context;
        }
    }
    const exchange = await resolveRemoteShopifyAccessToken(bearerToken);
    if (exchange.tenantId && String(exchange.tenantId) !== tenantId) {
        throw new Error("Token exchange tenant mismatch");
    }
    if (exchange.tokenId && tokenId && exchange.tokenId !== tokenId) {
        throw new Error("Token exchange token mismatch");
    }
    if (exchange.domain !== domain) {
        throw new Error("Token exchange domain mismatch");
    }
    const cacheKey = `${tenantId}:${domain}`;
    const credentialFingerprint = sha256Hex(exchange.accessToken);
    let cachedShopifyClient = remoteShopifyClientCache.get(cacheKey);
    if (cachedShopifyClient &&
        cachedShopifyClient.credentialFingerprint === credentialFingerprint &&
        cachedShopifyClient.expiresAtMs > Date.now()) {
        const context = freezeExecutionContext({
            tokenHash,
            tokenId,
            tenantId,
            licenseKey: introspection.licenseKey || null,
            license: introspection.license || {},
            shopifyDomain: domain,
            shopifyClient: cachedShopifyClient.client,
        });
        if (HAZIFY_MCP_CONTEXT_TTL_MS > 0) {
            remoteContextCache.set(tokenHash, {
                context,
                expiresAtMs: Date.now() + Math.max(HAZIFY_MCP_CONTEXT_TTL_MS, 1000),
            });
        }
        return context;
    }
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
    const context = freezeExecutionContext({
        tokenHash,
        tokenId,
        tenantId,
        licenseKey: introspection.licenseKey || null,
        license: introspection.license || {},
        shopifyDomain: domain,
        shopifyClient: cachedShopifyClient.client,
    });
    if (HAZIFY_MCP_CONTEXT_TTL_MS > 0) {
        remoteContextCache.set(tokenHash, {
            context,
            expiresAtMs: Date.now() + Math.max(HAZIFY_MCP_CONTEXT_TTL_MS, 1000),
        });
    }
    return context;
};
const tenantToolExecutionLocks = new Map();
const CONTEXT_FREE_TOOLS = new Set([
    "list_theme_import_tools",
    "get-supported-tracking-companies",
    "get-license-status",
]);
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
    tenantId: String(context?.tenantId || "stdio-local"),
    tokenHash: context?.tokenHash || null,
    tokenId: context?.tokenId || null,
    licenseKey: context?.licenseKey || null,
    license: context?.license || {},
    shopifyDomain: context?.shopifyDomain || null,
    shopifyClient: context?.shopifyClient || localShopifyClient || null,
});
const toolRequiresShopifyClient = (toolName) => !CONTEXT_FREE_TOOLS.has(toolName);
async function runLicensedTool(toolName, mutating, executor, args) {
    if (!IS_HTTP_TRANSPORT) {
        await licenseManager.assertToolAllowed(toolName, { mutating });
        const executionContext = buildToolExecutionContext();
        if (!executionContext.shopifyClient && toolRequiresShopifyClient(toolName)) {
            throw new Error("Missing Shopify client in stdio execution context");
        }
        const result = await executor(args, executionContext);
        return toMcpResponse(result);
    }
    const context = requestContextStore.getStore();
    if (!context) {
        throw new Error("Missing request context");
    }
    const decision = evaluateRemoteLicenseAccess(context.license, { toolName, mutating });
    if (!decision.allowed) {
        throw new Error(`License gate blocked '${toolName}': ${decision.reason}`);
    }
    const executeTool = async () => {
        const executionContext = buildToolExecutionContext(context);
        if (!executionContext.shopifyClient && toolRequiresShopifyClient(toolName)) {
            throw new Error("Missing Shopify client in request execution context");
        }
        const result = await executor(args, executionContext);
        return toMcpResponse(result);
    };
    if (!mutating) {
        return executeTool();
    }
    return runSerializedByKey(context.tenantId || context.tokenHash, executeTool);
}
// Add tools individually, using their schemas directly
const createHazifyServer = () => {
    const server = createServerInstance();
    const mutatingTools = new Set([
        "update-order",
        "update-fulfillment-tracking",
        "set-order-tracking",
        "update-order-tracking",
        "add-tracking-to-order",
        "update-customer",
        "create-product",
        "update-product",
        "manage-product-variants",
        "manage-product-options",
        "delete-product",
        "delete-product-variants",
        "refund-order",
        "clone-product-from-url",
        "upsert-theme-file",
        "upsert-theme-files",
        "delete-theme-file",
    ]);
    const destructiveTools = new Set([
        "delete-product",
        "delete-product-variants",
        "refund-order",
        "delete-theme-file",
    ]);
    const toolDescriptions = {
        "get-products": "List Shopify products with optional title search.",
        "get-product-by-id": "Fetch a single Shopify product by GID.",
        "get-customers": "List Shopify customers with optional search query.",
        "get-orders": "List Shopify orders by status.",
        "get-order-by-id": "Fetch a single order by GID, numeric ID, or order number like #1004.",
        "update-order": "Update order metadata or shipping details. For tracking, prefer set-order-tracking.",
        "update-fulfillment-tracking": "Update fulfillment tracking directly with tracking number and carrier.",
        "set-order-tracking": "Preferred one-shot tracking update flow (order, trackingCode, carrier).",
        "update-order-tracking": "Alias of set-order-tracking. Kept for compatibility.",
        "add-tracking-to-order": "Alias of set-order-tracking. Kept for compatibility.",
        "get-supported-tracking-companies": "List supported carrier names to use in tracking updates.",
        "get-customer-orders": "List orders for a specific customer ID.",
        "update-customer": "Update customer profile fields, tags, or metafields.",
        "create-product": "Create a Shopify product with options, collections, metafields, and media.",
        "update-product": "Update an existing Shopify product and optionally add media.",
        "manage-product-variants": "Create or update product variants in bulk.",
        "manage-product-options": "Create, update, or delete product options.",
        "delete-product": "Delete a product by GID.",
        "delete-product-variants": "Delete one or more variants from a product.",
        "refund-order": "Create a full or partial refund on an order.",
        "clone-product-from-url": "Import a product from a public Shopify product URL.",
        "get-themes": "List Shopify themes and identify the live theme.",
        "get-theme-file": "Read a specific file from a Shopify theme.",
        "get-theme-files": "Read multiple files from a Shopify theme.",
        "upsert-theme-file": "Create or update a file in a Shopify theme.",
        "upsert-theme-files": "Create or update multiple files in a Shopify theme.",
        "delete-theme-file": "Delete a specific file from a Shopify theme.",
        "verify-theme-files": "Verify multiple theme files by expected metadata.",
        "list_theme_import_tools": "List metadata/advice for external tooling that can review or import generated sections outside this remote MCP.",
        "get-license-status": "Return current license/access status and effective capabilities.",
    };
    const originalTool = server.tool.bind(server);
    server.tool = (name, ...rest) => {
        if (rest.length === 2 && typeof rest[0] === "object" && typeof rest[1] === "function") {
            const mutating = mutatingTools.has(name);
            return originalTool(name, toolDescriptions[name] || name, rest[0], {
                readOnlyHint: !mutating,
                destructiveHint: destructiveTools.has(name),
                idempotentHint: !mutating,
            }, rest[1]);
        }
        return originalTool(name, ...rest);
    };
server.tool("get-products", {
    searchTitle: z.string().optional(),
    limit: z.number().default(10)
}, async (args) => {
    return runLicensedTool("get-products", false, getProducts.execute, args);
});
server.tool("get-product-by-id", {
    productId: z.string().min(1)
}, async (args) => {
    return runLicensedTool("get-product-by-id", false, getProductById.execute, args);
});
server.tool("get-customers", {
    searchQuery: z.string().optional(),
    limit: z.number().default(10)
}, async (args) => {
    return runLicensedTool("get-customers", false, getCustomers.execute, args);
});
server.tool("get-orders", {
    status: z.enum(["any", "open", "closed", "cancelled"]).default("any"),
    limit: z.number().default(10)
}, async (args) => {
    return runLicensedTool("get-orders", false, getOrders.execute, args);
});
// Add the getOrderById tool
server.tool("get-order-by-id", {
    orderId: z.string().min(1).describe("Accepts Shopify GID, numeric order id, or ordernummer like 1004/#1004")
}, async (args) => {
    return runLicensedTool("get-order-by-id", false, getOrderById.execute, args);
});
// Add the updateOrder tool
server.tool("update-order", {
    id: z.string().min(1).describe("Accepts Shopify GID, numeric order id, or ordernummer like 1004/#1004"),
    tags: z.array(z.string()).optional(),
    email: z.string().email().optional(),
    note: z.string().optional(),
    customAttributes: z
        .array(z.object({
        key: z.string(),
        value: z.string()
    }))
        .optional()
        .describe("Order aanvullende gegevens. Gebruik NIET voor tracking; legacy tracking keys worden automatisch omgezet naar fulfillment-tracking."),
    metafields: z
        .array(z.object({
        id: z.string().optional(),
        namespace: z.string().optional(),
        key: z.string().optional(),
        value: z.string(),
        type: z.string().optional()
    }))
        .optional()
        .describe("Order metafields. tracking_number/carrier/tracking_url worden niet naar metafields geschreven maar omgezet naar fulfillment-tracking."),
    shippingAddress: z
        .object({
        address1: z.string().optional(),
        address2: z.string().optional(),
        city: z.string().optional(),
        company: z.string().optional(),
        country: z.string().optional(),
        firstName: z.string().optional(),
        lastName: z.string().optional(),
        phone: z.string().optional(),
        province: z.string().optional(),
        zip: z.string().optional()
    })
        .optional(),
    tracking: z
        .object({
        fulfillmentId: z.string().optional(),
        number: z.string().optional(),
        url: z.string().url().optional(),
        company: z.string().optional(),
        notifyCustomer: z.boolean().optional()
    })
        .optional()
        .describe("Use this for real fulfillment tracking updates. Do NOT use customAttributes for tracking."),
    fulfillmentId: z.string().optional(),
    trackingNumber: z.string().optional().describe("Deprecated alias. Gebruik bij voorkeur tracking.number of update-fulfillment-tracking."),
    trackingUrl: z.string().url().optional(),
    trackingCompany: z.string().optional().describe("Deprecated alias. Gebruik exact carriernaam uit get-supported-tracking-companies."),
    notifyCustomer: z.boolean().optional()
}, async (args) => {
    return runLicensedTool("update-order", true, updateOrder.execute, args);
});
server.tool("update-fulfillment-tracking", {
    orderId: z.string().min(1).describe("Accepts Shopify GID, numeric order id, or ordernummer like 1004/#1004"),
    trackingNumber: z.string().min(1),
    trackingCompany: z.string().optional().describe("Prefer exact value from get-supported-tracking-companies"),
    trackingUrl: z.string().url().optional(),
    notifyCustomer: z.boolean().default(false),
    fulfillmentId: z.string().optional().describe("Optional. If omitted, the tool automatically updates the latest non-cancelled fulfillment on the order."),
}, async (args) => {
    return runLicensedTool("update-fulfillment-tracking", true, updateFulfillmentTracking.execute, args);
});
server.tool("set-order-tracking", {
    order: z.string().min(1).describe("Order reference, e.g. #1004 / 1004 / gid://shopify/Order/..."),
    trackingCode: z.string().min(1),
    carrier: z.string().optional(),
    trackingUrl: z.string().url().optional(),
    notifyCustomer: z.boolean().default(false),
    fulfillmentId: z.string().optional()
}, async (args) => {
    return runLicensedTool("set-order-tracking", true, setOrderTracking.execute, args);
});
server.tool("update-order-tracking", {
    order: z.string().min(1).describe("Order reference, e.g. #1004 / 1004 / gid://shopify/Order/..."),
    trackingCode: z.string().min(1),
    carrier: z.string().optional(),
    trackingUrl: z.string().url().optional(),
    notifyCustomer: z.boolean().default(false),
    fulfillmentId: z.string().optional()
}, async (args) => {
    return runLicensedTool("update-order-tracking", true, setOrderTracking.execute, args);
});
server.tool("add-tracking-to-order", {
    order: z.string().min(1).describe("Order reference, e.g. #1004 / 1004 / gid://shopify/Order/..."),
    trackingCode: z.string().min(1),
    carrier: z.string().optional(),
    trackingUrl: z.string().url().optional(),
    notifyCustomer: z.boolean().default(false),
    fulfillmentId: z.string().optional()
}, async (args) => {
    return runLicensedTool("add-tracking-to-order", true, setOrderTracking.execute, args);
});
server.tool("get-supported-tracking-companies", {
    search: z.string().optional(),
    limit: z.number().default(250)
}, async (args) => {
    return runLicensedTool("get-supported-tracking-companies", false, getSupportedTrackingCompanies.execute, args);
});
// Add the getCustomerOrders tool
server.tool("get-customer-orders", {
    customerId: z
        .string()
        .regex(/^\d+$/, "Customer ID must be numeric")
        .describe("Shopify customer ID, numeric excluding gid prefix"),
    limit: z.number().default(10)
}, async (args) => {
    return runLicensedTool("get-customer-orders", false, getCustomerOrders.execute, args);
});
// Add the updateCustomer tool
server.tool("update-customer", {
    id: z
        .string()
        .regex(/^\d+$/, "Customer ID must be numeric")
        .describe("Shopify customer ID, numeric excluding gid prefix"),
    firstName: z.string().optional(),
    lastName: z.string().optional(),
    email: z.string().email().optional(),
    phone: z.string().optional(),
    tags: z.array(z.string()).optional(),
    note: z.string().optional(),
    taxExempt: z.boolean().optional(),
    metafields: z
        .array(z.object({
        id: z.string().optional(),
        namespace: z.string().optional(),
        key: z.string().optional(),
        value: z.string(),
        type: z.string().optional()
    }))
        .optional()
}, async (args) => {
    return runLicensedTool("update-customer", true, updateCustomer.execute, args);
});
// Add the createProduct tool
server.tool("create-product", {
    title: z.string().min(1),
    descriptionHtml: z.string().optional(),
    handle: z.string().optional().describe("URL slug. Auto-generated from title if omitted."),
    vendor: z.string().optional(),
    productType: z.string().optional(),
    tags: z.array(z.string()).optional(),
    status: z.enum(["ACTIVE", "DRAFT", "ARCHIVED"]).default("DRAFT"),
    seo: z
        .object({
        title: z.string().optional(),
        description: z.string().optional(),
    })
        .optional()
        .describe("SEO title and description"),
    metafields: z
        .array(z.object({
        namespace: z.string(),
        key: z.string(),
        value: z.string(),
        type: z.string().describe("e.g. 'single_line_text_field', 'json', 'number_integer'"),
    }))
        .optional(),
    productOptions: z
        .array(z.object({
        name: z.string().describe("Option name, e.g. 'Size'"),
        values: z.array(z.object({ name: z.string() })).optional(),
    }))
        .optional()
        .describe("Product options to create inline (max 3)"),
    collectionsToJoin: z.array(z.string()).optional().describe("Collection GIDs to add product to"),
    media: z
        .array(z.object({
        originalSource: z.string().url(),
        mediaContentType: z.enum(["IMAGE", "VIDEO", "EXTERNAL_VIDEO", "MODEL_3D"]),
        alt: z.string().optional(),
    }))
        .optional()
        .describe("Product media to create inline"),
}, async (args) => {
    return runLicensedTool("create-product", true, createProduct.execute, args);
});
// Add the updateProduct tool
server.tool("update-product", {
    id: z.string().min(1).describe("Shopify product GID, e.g. gid://shopify/Product/123"),
    title: z.string().optional(),
    descriptionHtml: z.string().optional(),
    handle: z.string().optional().describe("URL slug for the product"),
    vendor: z.string().optional(),
    productType: z.string().optional(),
    tags: z.array(z.string()).optional(),
    status: z.enum(["ACTIVE", "DRAFT", "ARCHIVED"]).optional(),
    seo: z
        .object({
        title: z.string().optional(),
        description: z.string().optional(),
    })
        .optional()
        .describe("SEO title and description"),
    metafields: z
        .array(z.object({
        id: z.string().optional(),
        namespace: z.string().optional(),
        key: z.string().optional(),
        value: z.string(),
        type: z.string().optional(),
    }))
        .optional(),
    collectionsToJoin: z.array(z.string()).optional().describe("Collection GIDs to add product to"),
    collectionsToLeave: z.array(z.string()).optional().describe("Collection GIDs to remove product from"),
    redirectNewHandle: z.boolean().optional().describe("If true, old handle redirects to new handle"),
    media: z
        .array(z.object({
        originalSource: z.string().url(),
        mediaContentType: z.enum(["IMAGE", "VIDEO", "EXTERNAL_VIDEO", "MODEL_3D"]),
        alt: z.string().optional(),
    }))
        .optional()
        .describe("New media to add to the product"),
}, async (args) => {
    return runLicensedTool("update-product", true, updateProduct.execute, args);
});
// Add the manageProductVariants tool
server.tool("manage-product-variants", {
    productId: z.string().min(1).describe("Shopify product GID"),
    variants: z
        .array(z.object({
        id: z.string().optional().describe("Variant GID for updates. Omit to create new."),
        price: z.string().optional().describe("Price as string, e.g. '49.00'"),
        compareAtPrice: z.string().optional().describe("Compare-at price for showing discounts"),
        sku: z.string().optional().describe("SKU (mapped to inventoryItem.sku)"),
        tracked: z.boolean().optional().describe("Whether inventory is tracked. Set false for print-on-demand."),
        taxable: z.boolean().optional(),
        barcode: z.string().optional(),
        optionValues: z
            .array(z.object({
            optionName: z.string().describe("Option name, e.g. 'Size'"),
            name: z.string().describe("Option value, e.g. '8x10'"),
        }))
            .optional(),
    }))
        .min(1)
        .describe("Variants to create or update"),
    strategy: z
        .enum(["DEFAULT", "REMOVE_STANDALONE_VARIANT", "PRESERVE_STANDALONE_VARIANT"])
        .optional()
        .describe("How to handle the Default Title variant when creating. DEFAULT removes it automatically."),
}, async (args) => {
    return runLicensedTool("manage-product-variants", true, manageProductVariants.execute, args);
});
// Add the manageProductOptions tool
server.tool("manage-product-options", {
    productId: z.string().min(1).describe("Shopify product GID"),
    action: z.enum(["create", "update", "delete"]),
    options: z
        .array(z.object({
        name: z.string().describe("Option name, e.g. 'Size'"),
        position: z.number().optional(),
        values: z.array(z.string()).optional().describe("Option values, e.g. ['A4', 'A3']"),
    }))
        .optional()
        .describe("Options to create (action=create)"),
    optionId: z.string().optional().describe("Option GID to update (action=update)"),
    name: z.string().optional().describe("New name for the option (action=update)"),
    position: z.number().optional().describe("New position (action=update)"),
    valuesToAdd: z.array(z.string()).optional().describe("Values to add (action=update)"),
    valuesToDelete: z.array(z.string()).optional().describe("Value GIDs to delete (action=update)"),
    optionIds: z.array(z.string()).optional().describe("Option GIDs to delete (action=delete)"),
}, async (args) => {
    return runLicensedTool("manage-product-options", true, manageProductOptions.execute, args);
});
// Add the deleteProduct tool
server.tool("delete-product", {
    id: z.string().min(1).describe("Shopify product GID, e.g. gid://shopify/Product/123"),
}, async (args) => {
    return runLicensedTool("delete-product", true, deleteProduct.execute, args);
});
// Add the deleteProductVariants tool
server.tool("delete-product-variants", {
    productId: z.string().min(1).describe("Shopify product GID"),
    variantIds: z.array(z.string().min(1)).min(1).describe("Array of variant GIDs to delete"),
}, async (args) => {
    return runLicensedTool("delete-product-variants", true, deleteProductVariants.execute, args);
});
server.tool("refund-order", {
    orderId: z.string().min(1).describe("Shopify order GID, e.g. gid://shopify/Order/123"),
    note: z.string().optional(),
    audit: z.object({
        amount: z.string().min(1).describe("Refund amount for audit trail, e.g. 19.95"),
        reason: z.string().min(3).describe("Reason for refund, e.g. damaged item"),
        scope: z.enum(["full", "partial"]).describe("Refund scope"),
    }),
    notify: z.boolean().default(false),
    currency: z.string().optional(),
    allowOverRefunding: z.boolean().optional(),
    refundLineItems: z
        .array(z.object({
        lineItemId: z.string().min(1),
        quantity: z.number().int().positive(),
        restockType: z.string().optional(),
        locationId: z.string().optional(),
    }))
        .optional(),
    shipping: z
        .object({
        amount: z.string().optional(),
        fullRefund: z.boolean().optional(),
    })
        .optional(),
    transactions: z
        .array(z.object({
        amount: z.string().min(1),
        gateway: z.string().min(1),
        kind: z.string().default("REFUND"),
        parentId: z.string().optional(),
    }))
        .optional(),
}, async (args) => {
    return runLicensedTool("refund-order", true, refundOrder.execute, args);
});
server.tool("clone-product-from-url", {
    sourceUrl: z.string().url().describe("Public Shopify product URL"),
    status: z.enum(["ACTIVE", "DRAFT", "ARCHIVED"]).default("DRAFT"),
    titleOverride: z.string().optional(),
    handleOverride: z.string().optional(),
    vendorOverride: z.string().optional(),
    importDescription: z.boolean().default(true),
    importMedia: z.boolean().default(true),
    taxable: z.boolean().default(true),
    tracked: z.boolean().default(true),
}, async (args) => {
    return runLicensedTool("clone-product-from-url", true, cloneProductFromUrl.execute, args);
});
server.tool("get-themes", {
    role: z.enum(["main", "unpublished", "demo", "development"]).optional(),
    limit: z.number().int().positive().max(250).default(100),
}, async (args) => {
    const parsedArgs = getThemes.schema.parse(args);
    return runLicensedTool("get-themes", false, getThemes.execute, parsedArgs);
});
server.tool("get-theme-file", {
    themeId: z.coerce.number().int().positive().optional().describe("Optional explicit Shopify theme ID"),
    themeRole: z.enum(["main", "unpublished", "demo", "development"]).default("main"),
    key: z.string().min(1).describe("Theme file key, e.g. sections/custom-banner.liquid"),
    includeContent: z.boolean().default(true),
}, async (args) => {
    const parsedArgs = getThemeFileTool.schema.parse(args);
    return runLicensedTool("get-theme-file", false, getThemeFileTool.execute, parsedArgs);
});
server.tool("get-theme-files", {
    themeId: z.coerce.number().int().positive().optional().describe("Optional explicit Shopify theme ID"),
    themeRole: z.enum(["main", "unpublished", "demo", "development"]).default("main"),
    keys: z.array(z.string().min(1)).min(1).max(200).describe("Theme file keys"),
    includeContent: z.boolean().default(false).describe("Include file content (value/attachment) in response"),
}, async (args) => {
    const parsedArgs = getThemeFilesTool.schema.parse(args);
    return runLicensedTool("get-theme-files", false, getThemeFilesTool.execute, parsedArgs);
});
server.tool("upsert-theme-file", {
    themeId: z.coerce.number().int().positive().optional().describe("Optional explicit Shopify theme ID"),
    themeRole: z.enum(["main", "unpublished", "demo", "development"]).default("main"),
    key: z.string().min(1).describe("Theme file key, e.g. sections/custom-banner.liquid"),
    value: z.string().optional().describe("Text content for Liquid/JSON/CSS/JS assets"),
    attachment: z.string().optional().describe("Base64 payload for binary assets"),
    checksum: z.string().optional(),
}, async (args) => {
    const parsedArgs = upsertThemeFileTool.schema.parse(args);
    return runLicensedTool("upsert-theme-file", true, upsertThemeFileTool.execute, parsedArgs);
});
server.tool("upsert-theme-files", {
    themeId: z.coerce.number().int().positive().optional().describe("Optional explicit Shopify theme ID"),
    themeRole: z.enum(["main", "unpublished", "demo", "development"]).default("main"),
    files: z.array(z.object({
        key: z.string().min(1),
        value: z.string().optional(),
        attachment: z.string().optional(),
        checksum: z.string().optional(),
    })).min(1).max(200).describe("Batch of theme files to upsert"),
    verifyAfterWrite: z.boolean().default(false),
}, async (args) => {
    const parsedArgs = upsertThemeFilesTool.schema.parse(args);
    return runLicensedTool("upsert-theme-files", true, upsertThemeFilesTool.execute, parsedArgs);
});
server.tool("delete-theme-file", {
    themeId: z.coerce.number().int().positive().optional().describe("Optional explicit Shopify theme ID"),
    themeRole: z.enum(["main", "unpublished", "demo", "development"]).default("main"),
    key: z.string().min(1).describe("Theme file key to delete"),
}, async (args) => {
    const parsedArgs = deleteThemeFileTool.schema.parse(args);
    return runLicensedTool("delete-theme-file", true, deleteThemeFileTool.execute, parsedArgs);
});
server.tool("verify-theme-files", {
    themeId: z.coerce.number().int().positive().optional().describe("Optional explicit Shopify theme ID"),
    themeRole: z.enum(["main", "unpublished", "demo", "development"]).default("main"),
    expected: z.array(z.object({
        key: z.string().min(1),
        size: z.number().int().nonnegative().optional(),
        checksumMd5: z.string().optional(),
    })).min(1).max(200).describe("Expected metadata per file"),
}, async (args) => {
    const parsedArgs = verifyThemeFilesTool.schema.parse(args);
    return runLicensedTool("verify-theme-files", false, verifyThemeFilesTool.execute, parsedArgs);
});
server.tool("list_theme_import_tools", {}, async (args) => {
    return runLicensedTool("list_theme_import_tools", false, listThemeImportTools.execute, args);
});
server.tool("get-license-status", {}, async () => {
    if (!IS_HTTP_TRANSPORT) {
        await licenseManager.assertToolAllowed("get-license-status", { mutating: false });
        return toMcpResponse({
            license: licenseManager.getStatus(),
            server: {
                name: "Hazify MCP",
                version: SERVER_VERSION,
                transport: "stdio",
            },
        });
    }
    const context = requestContextStore.getStore();
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
    return toMcpResponse({
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
        tenant: {
            id: context.tenantId,
            licenseKey: context.licenseKey,
            shopDomain: context.shopifyDomain,
        },
        server: {
            name: "Hazify MCP",
            version: SERVER_VERSION,
            transport: "http",
            sessionMode: MCP_SESSION_MODE,
        },
    });
});
    return server;
};
const stdioServer = !IS_HTTP_TRANSPORT ? createHazifyServer() : null;
let shuttingDown = false;
let httpServer = null;
const shutdown = async () => {
    if (shuttingDown) {
        return;
    }
    shuttingDown = true;
    try {
        if (auth) {
            auth.destroy();
        }
        if (licenseManager) {
            await licenseManager.destroy();
        }
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
const resolveRequestBaseUrl = (req) => {
    const protoHeader = req.headers["x-forwarded-proto"];
    const hostHeader = req.headers["x-forwarded-host"] || req.headers.host;
    const protocol = typeof protoHeader === "string" && protoHeader.trim()
        ? protoHeader.split(",")[0].trim()
        : "http";
    const host = typeof hostHeader === "string" && hostHeader.trim()
        ? hostHeader.split(",")[0].trim()
        : `${HTTP_HOST}:${HTTP_PORT}`;
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
        scopes_supported: ["mcp:tools"],
        service_documentation: `${issuer}/onboarding`,
    };
};
const buildProtectedResourceMetadata = (req) => {
    const authServer = resolveAuthServerBaseUrl() || resolveRequestBaseUrl(req);
    return {
        resource: resolvePublicMcpUrl(req),
        authorization_servers: [authServer],
        scopes_supported: ["mcp:tools"],
        bearer_methods_supported: ["header"],
        resource_documentation: `${authServer}/onboarding`,
    };
};
const buildWwwAuthenticateHeader = (req, errorCode, description) => {
    const metadataUrl = `${resolveRequestBaseUrl(req)}/.well-known/oauth-protected-resource`;
    const safeDescription = String(description || "").replace(/"/g, "'");
    return `Bearer realm="Hazify MCP", resource_metadata="${metadataUrl}", scope="mcp:tools", error="${errorCode}", error_description="${safeDescription}"`;
};
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
const isRequestOriginAllowed = (req) => {
    return isOriginAllowed({
        originHeader: req.headers.origin,
        requestBaseUrl: resolveRequestBaseUrl(req),
        allowedOrigins: HAZIFY_MCP_ALLOWED_ORIGINS
    });
};
if (!IS_HTTP_TRANSPORT) {
    // Start stdio server
    const transport = new StdioServerTransport();
    stdioServer
        .connect(transport)
        .then(() => { })
        .catch((error) => {
        console.error("Failed to start Shopify MCP Server:", error);
    });
}
else {
    const app = createMcpExpressApp({ host: HTTP_HOST });
    app.use((req, res, next) => {
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
        res.setHeader("WWW-Authenticate", buildWwwAuthenticateHeader(req, "invalid_token", message));
        respondJsonRpcError(res, 401, message, -32001);
    };
    const assertAllowedOrigin = (req, res) => {
        const decision = isRequestOriginAllowed(req);
        if (!decision.allowed) {
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
            return await resolveRemoteContext(token);
        }
        catch (error) {
            respondUnauthorized(req, res, error instanceof Error ? error.message : String(error));
            return null;
        }
    };
    app.post("/mcp", async (req, res) => {
        if (!assertAllowedOrigin(req, res)) {
            return;
        }
        const context = await resolveRequestAuthContext(req, res);
        if (!context) {
            return;
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
            respondJsonRpcError(res, 400, "Bad Request: stateless mode only supports POST /mcp");
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
            respondJsonRpcError(res, 400, "Bad Request: stateless mode does not use DELETE /mcp sessions");
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
