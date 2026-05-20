import { createMutationAuditLog } from "./db.js";

export function resolveMutationShopDomain(context, shopifyClient) {
  if (typeof context?.shopifyDomain === "string" && context.shopifyDomain.trim()) {
    return context.shopifyDomain.trim();
  }
  const rawUrl = typeof shopifyClient?.url === "string" ? shopifyClient.url : "";
  if (!rawUrl) {
    return null;
  }
  try {
    return new URL(rawUrl).hostname || null;
  } catch {
    return null;
  }
}

export function shouldRecordMutationAudit(context = {}) {
  return Boolean(context?.tenantId || context?.tokenHash || context?.requestId);
}

export async function recordMutationAudit({
  context = {},
  shopifyClient,
  toolName,
  reason,
  targetIds = [],
  payload = null,
} = {}) {
  if (!shouldRecordMutationAudit(context)) {
    return { auditLog: null, auditWarning: null };
  }

  try {
    const auditLog = await createMutationAuditLog({
      toolName,
      tenantId: context?.tenantId || null,
      shopDomain: resolveMutationShopDomain(context, shopifyClient),
      requestId: context?.requestId || null,
      reason,
      targetIds,
      payload,
    });
    return { auditLog, auditWarning: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Error writing mutation audit log for ${toolName}:`, error);
    return {
      auditLog: null,
      auditWarning: `Mutation succeeded, but audit logging failed: ${message}`,
    };
  }
}

export function buildMutationAuditResponse({ auditLog, auditWarning, context, shopDomain, reason, targetIds = [] } = {}) {
  if (!auditLog && !auditWarning) {
    return undefined;
  }
  return {
    auditLogId: auditLog?.id || null,
    ...(auditWarning ? { warning: auditWarning } : {}),
    reason: reason || null,
    requestId: context?.requestId || null,
    tenantId: context?.tenantId || null,
    shopDomain: shopDomain || null,
    targetIds,
  };
}
