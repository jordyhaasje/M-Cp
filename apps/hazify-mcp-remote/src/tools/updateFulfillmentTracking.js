import { gql } from "../lib/shopifyGraphqlClient.js";
import { requireShopifyClient } from "./_context.js";
import { buildShopifyUserErrorResponse } from "../lib/shopifyToolErrors.js";
import { z } from "zod";
import { isSupportedTrackingCompany, assertSupportedTrackingCompany } from "../lib/trackingCompanies.js";
import { resolveOrderIdentifier } from "../lib/orderIdentifier.js";
import { createMutationAuditLog } from "../lib/db.js";
const UpdateFulfillmentTrackingInputSchema = z.object({
    orderId: z.string().min(1).describe("Shopify order GID, e.g. gid://shopify/Order/123"),
    trackingNumber: z.string().min(1).describe("Shipment tracking number"),
    trackingCompany: z.string().optional().describe("Carrier name, preferably from get-supported-tracking-companies"),
    trackingUrl: z.string().url().optional().describe("Optional explicit tracking URL"),
    notifyCustomer: z.boolean().default(false).describe("Send shipping update email to customer"),
    fulfillmentId: z.string().optional().describe("Optional explicit fulfillment GID. If omitted, latest non-cancelled fulfillment is used"),
    createFulfillmentIfMissing: z
        .boolean()
        .default(false)
        .describe("Set true only when the user explicitly wants to create a fulfillment if none exists."),
    confirmation: z
        .literal("CREATE_FULFILLMENT_WITH_TRACKING")
        .optional()
        .describe("Required when createFulfillmentIfMissing=true."),
    reason: z.string().optional().describe("Auditable reason required when createFulfillmentIfMissing=true."),
}).superRefine((input, ctx) => {
    if (!input.createFulfillmentIfMissing) {
        return;
    }
    if (input.confirmation !== "CREATE_FULFILLMENT_WITH_TRACKING") {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["confirmation"],
            message: "confirmation must be CREATE_FULFILLMENT_WITH_TRACKING when createFulfillmentIfMissing=true",
        });
    }
    if (typeof input.reason !== "string" || input.reason.trim().length < 5) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["reason"],
            message: "reason is required when createFulfillmentIfMissing=true",
        });
    }
});
const normalizeGraphQLList = (value) => {
    if (Array.isArray(value)) {
        return value;
    }
    if (value && Array.isArray(value.nodes)) {
        return value.nodes;
    }
    if (value && Array.isArray(value.edges)) {
        return value.edges.map((edge) => edge.node).filter(Boolean);
    }
    return [];
};
const ORDER_TRACKING_CONTEXT_QUERY = gql `
  query getOrderTrackingContext($id: ID!) {
    order(id: $id) {
      id
      name
      fulfillments {
        id
        status
        createdAt
        trackingInfo {
          company
          number
          url
        }
      }
      fulfillmentOrders(first: 50) {
        nodes {
          id
          status
          lineItems(first: 50) {
            nodes {
              id
              remainingQuantity
            }
          }
        }
      }
    }
  }
`;
const FULFILLMENT_TRACKING_UPDATE_MUTATION = gql `
  mutation fulfillmentTrackingInfoUpdate(
    $fulfillmentId: ID!
    $trackingInfoInput: FulfillmentTrackingInput!
    $notifyCustomer: Boolean
  ) {
    fulfillmentTrackingInfoUpdate(
      fulfillmentId: $fulfillmentId
      trackingInfoInput: $trackingInfoInput
      notifyCustomer: $notifyCustomer
    ) {
      fulfillment {
        id
        status
        trackingInfo {
          company
          number
          url
        }
      }
      userErrors {
        field
        message
      }
    }
  }
`;
const FULFILLMENT_CREATE_MUTATION = gql `
  mutation fulfillmentCreate($fulfillment: FulfillmentInput!) {
    fulfillmentCreate(fulfillment: $fulfillment) {
      fulfillment {
        id
        status
        trackingInfo {
          company
          number
          url
        }
      }
      userErrors {
        field
        message
      }
    }
  }
`;
const findFulfillmentToUpdate = (fulfillments, explicitFulfillmentId) => {
    if (!Array.isArray(fulfillments) || fulfillments.length === 0) {
        return null;
    }
    if (explicitFulfillmentId) {
        const explicit = fulfillments.find((fulfillment) => fulfillment.id === explicitFulfillmentId);
        if (!explicit) {
            throw new Error(`Fulfillment ${explicitFulfillmentId} is not part of this order.`);
        }
        return explicit;
    }
    const eligible = fulfillments.filter((fulfillment) => fulfillment.status !== "CANCELLED");
    if (eligible.length === 0) {
        return null;
    }
    return eligible
        .slice()
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
};
const buildFulfillmentCreateLineItems = (fulfillmentOrders) => {
    if (!Array.isArray(fulfillmentOrders)) {
        return [];
    }
    return fulfillmentOrders
        .filter((fulfillmentOrder) => {
        const lineItems = normalizeGraphQLList(fulfillmentOrder.lineItems);
        const hasRemainingItems = lineItems.some((lineItem) => lineItem.remainingQuantity > 0);
        return fulfillmentOrder.status !== "CLOSED" && hasRemainingItems;
    })
        .map((fulfillmentOrder) => ({
        fulfillmentOrderId: fulfillmentOrder.id
    }));
};
const fetchOrderTrackingContext = async (shopifyClient, orderId) => {
    const variables = { id: orderId };
    return shopifyClient.request(ORDER_TRACKING_CONTEXT_QUERY, variables);
};
const resolveShopDomain = (context, shopifyClient) => {
    if (typeof context?.shopifyDomain === "string" && context.shopifyDomain.trim()) {
        return context.shopifyDomain.trim();
    }
    const rawUrl = typeof shopifyClient?.url === "string" ? shopifyClient.url : "";
    if (!rawUrl) {
        return null;
    }
    try {
        return new URL(rawUrl).hostname || null;
    }
    catch {
        return null;
    }
};
const updateFulfillmentTracking = {
    name: "update-fulfillment-tracking",
    description: "Update order shipment tracking in the actual fulfillment record (not custom attributes/metafields). fulfillmentId is optional; when omitted, the latest non-cancelled fulfillment is updated automatically.",
    schema: UpdateFulfillmentTrackingInputSchema,
    execute: async (input, context = {}) => {
      const shopifyClient = requireShopifyClient(context);
        try {
            const resolvedCompany = assertSupportedTrackingCompany(input.trackingCompany, "carrier");
            const resolvedOrder = await resolveOrderIdentifier(shopifyClient, input.orderId);
            const contextResponse = (await fetchOrderTrackingContext(shopifyClient, resolvedOrder.id));
            const orderContext = contextResponse.order;
            if (!orderContext) {
                throw new Error(`Order ${input.orderId} not found.`);
            }
            const fulfillments = normalizeGraphQLList(orderContext.fulfillments);
            const fulfillmentOrders = normalizeGraphQLList(orderContext.fulfillmentOrders);
            const trackingInfoInput = {
                number: input.trackingNumber.trim()
            };
            if (input.trackingUrl) {
                trackingInfoInput.url = input.trackingUrl;
            }
            if (resolvedCompany) {
                trackingInfoInput.company = resolvedCompany;
            }
            const previous = fulfillments.flatMap((fulfillment) => (fulfillment.trackingInfo || []).map((tracking) => ({
                fulfillmentId: fulfillment.id,
                company: tracking.company,
                number: tracking.number,
                url: tracking.url
            })));
            const targetFulfillment = findFulfillmentToUpdate(fulfillments, input.fulfillmentId);
            let action;
            let fulfillment;
            if (targetFulfillment) {
                const response = (await shopifyClient.request(FULFILLMENT_TRACKING_UPDATE_MUTATION, {
                    fulfillmentId: targetFulfillment.id,
                    trackingInfoInput,
                    notifyCustomer: input.notifyCustomer
                }));
                const userErrorResponse = buildShopifyUserErrorResponse(
                    response.fulfillmentTrackingInfoUpdate.userErrors,
                    {
                        actionMessage: "Failed to update fulfillment tracking",
                        operation: "fulfillmentTrackingInfoUpdate",
                    }
                );
                if (userErrorResponse) {
                    return userErrorResponse;
                }
                fulfillment = response.fulfillmentTrackingInfoUpdate.fulfillment;
                action = "updated_existing_fulfillment";
            }
            else {
                if (!input.createFulfillmentIfMissing) {
                    return {
                        success: false,
                        status: "needs_confirmation",
                        message:
                            "Er bestaat geen actieve fulfillment om tracking op te zetten. Een nieuwe fulfillment aanmaken vereist expliciete bevestiging.",
                        errorCode: "fulfillment_create_confirmation_required",
                        retryable: true,
                        nextAction: "confirm_create_fulfillment_or_choose_fulfillment",
                        nextTool: "update-fulfillment-tracking",
                        nextArgsTemplate: {
                            orderId: input.orderId,
                            trackingNumber: input.trackingNumber,
                            ...(input.trackingCompany ? { trackingCompany: input.trackingCompany } : {}),
                            ...(input.trackingUrl ? { trackingUrl: input.trackingUrl } : {}),
                            notifyCustomer: input.notifyCustomer,
                            createFulfillmentIfMissing: true,
                            confirmation: "CREATE_FULFILLMENT_WITH_TRACKING",
                            reason: "<why creating a fulfillment is intended>",
                        },
                    };
                }
                const lineItemsByFulfillmentOrder = buildFulfillmentCreateLineItems(fulfillmentOrders);
                if (lineItemsByFulfillmentOrder.length === 0) {
                    throw new Error("No fulfillable fulfillment orders found. Tracking cannot be set because there is no active fulfillment.");
                }
                const response = (await shopifyClient.request(FULFILLMENT_CREATE_MUTATION, {
                    fulfillment: {
                        lineItemsByFulfillmentOrder,
                        notifyCustomer: input.notifyCustomer,
                        trackingInfo: trackingInfoInput
                    }
                }));
                const userErrorResponse = buildShopifyUserErrorResponse(
                    response.fulfillmentCreate.userErrors,
                    {
                        actionMessage: "Failed to create fulfillment with tracking",
                        operation: "fulfillmentCreate",
                    }
                );
                if (userErrorResponse) {
                    return userErrorResponse;
                }
                fulfillment = response.fulfillmentCreate.fulfillment;
                action = "created_fulfillment_with_tracking";
            }
            const auditLog = action === "created_fulfillment_with_tracking"
                ? await createMutationAuditLog({
                    toolName: "update-fulfillment-tracking",
                    tenantId: context?.tenantId || null,
                    shopDomain: resolveShopDomain(context, shopifyClient),
                    requestId: context?.requestId || null,
                    reason: input.reason,
                    targetIds: [
                        orderContext.id,
                        fulfillment?.id,
                    ].filter(Boolean),
                    payload: {
                        action,
                        confirmation: input.confirmation,
                        trackingCompany: resolvedCompany || null,
                        notifyCustomer: input.notifyCustomer,
                    },
                })
                : null;
            return {
                order: {
                    id: orderContext.id,
                    name: orderContext.name
                },
                resolvedOrder: {
                    input: input.orderId,
                    resolvedId: resolvedOrder.id,
                    source: resolvedOrder.source,
                    matchedByQuery: resolvedOrder.matchedByQuery || null
                },
                action,
                previousTracking: previous,
                updatedTracking: fulfillment?.trackingInfo || [],
                carrierInput: input.trackingCompany || null,
                carrierResolved: resolvedCompany || null,
                carrierIsShopifySupported: resolvedCompany ? isSupportedTrackingCompany(resolvedCompany) : null,
                ...(auditLog
                    ? {
                        audit: {
                            auditLogId: auditLog.id || null,
                            reason: input.reason,
                            requestId: context?.requestId || null,
                            tenantId: context?.tenantId || null,
                            shopDomain: resolveShopDomain(context, shopifyClient),
                            targetIds: [
                                orderContext.id,
                                fulfillment?.id,
                            ].filter(Boolean),
                        },
                    }
                    : {})
            };
        }
        catch (error) {
            console.error("Error updating fulfillment tracking:", error);
            throw new Error(`Failed to update fulfillment tracking: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
};
export { updateFulfillmentTracking };
