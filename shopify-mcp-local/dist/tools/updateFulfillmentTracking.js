import { gql } from "graphql-request";
import { z } from "zod";
import { isSupportedTrackingCompany, resolveTrackingCompany } from "../lib/trackingCompanies.js";
import { resolveOrderIdentifier } from "../lib/orderIdentifier.js";
let shopifyClient;
const UpdateFulfillmentTrackingInputSchema = z.object({
    orderId: z.string().min(1).describe("Shopify order GID, e.g. gid://shopify/Order/123"),
    trackingNumber: z.string().min(1).describe("Shipment tracking number"),
    trackingCompany: z.string().optional().describe("Carrier name, preferably from get-supported-tracking-companies"),
    trackingUrl: z.string().url().optional().describe("Optional explicit tracking URL"),
    notifyCustomer: z.boolean().default(false).describe("Send shipping update email to customer"),
    fulfillmentId: z.string().optional().describe("Optional explicit fulfillment GID. If omitted, latest non-cancelled fulfillment is used"),
});
const isNodesShapeError = (error) => {
    const message = error instanceof Error ? error.message : String(error);
    return message.includes("Field 'nodes' doesn't exist on type");
};
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
const ORDER_TRACKING_CONTEXT_QUERY_CONNECTION = gql `
  query getOrderTrackingContext($id: ID!) {
    order(id: $id) {
      id
      name
      fulfillments(first: 50) {
        nodes {
          id
          status
          createdAt
          trackingInfo {
            company
            number
            url
          }
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
const ORDER_TRACKING_CONTEXT_QUERY_LIST_FULFILLMENTS = gql `
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
const ORDER_TRACKING_CONTEXT_QUERY_LIST_ALL = gql `
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
      fulfillmentOrders {
        id
        status
        lineItems {
          id
          remainingQuantity
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
const fetchOrderTrackingContext = async (orderId) => {
    const variables = { id: orderId };
    try {
        return await shopifyClient.request(ORDER_TRACKING_CONTEXT_QUERY_CONNECTION, variables);
    }
    catch (firstError) {
        if (!isNodesShapeError(firstError)) {
            throw firstError;
        }
        try {
            return await shopifyClient.request(ORDER_TRACKING_CONTEXT_QUERY_LIST_FULFILLMENTS, variables);
        }
        catch (secondError) {
            if (!isNodesShapeError(secondError)) {
                throw secondError;
            }
            return await shopifyClient.request(ORDER_TRACKING_CONTEXT_QUERY_LIST_ALL, variables);
        }
    }
};
const updateFulfillmentTracking = {
    name: "update-fulfillment-tracking",
    description: "Update order shipment tracking in the actual fulfillment record (not custom attributes/metafields). fulfillmentId is optional; when omitted, the latest non-cancelled fulfillment is updated automatically.",
    schema: UpdateFulfillmentTrackingInputSchema,
    initialize(client) {
        shopifyClient = client;
    },
    execute: async (input) => {
        try {
            const resolvedOrder = await resolveOrderIdentifier(shopifyClient, input.orderId);
            const contextResponse = (await fetchOrderTrackingContext(resolvedOrder.id));
            const orderContext = contextResponse.order;
            if (!orderContext) {
                throw new Error(`Order ${input.orderId} not found.`);
            }
            const fulfillments = normalizeGraphQLList(orderContext.fulfillments);
            const fulfillmentOrders = normalizeGraphQLList(orderContext.fulfillmentOrders);
            const resolvedCompany = resolveTrackingCompany(input.trackingCompany);
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
                if (response.fulfillmentTrackingInfoUpdate.userErrors.length > 0) {
                    throw new Error(`Failed to update fulfillment tracking: ${response.fulfillmentTrackingInfoUpdate.userErrors
                        .map((error) => `${error.field}: ${error.message}`)
                        .join(", ")}`);
                }
                fulfillment = response.fulfillmentTrackingInfoUpdate.fulfillment;
                action = "updated_existing_fulfillment";
            }
            else {
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
                if (response.fulfillmentCreate.userErrors.length > 0) {
                    throw new Error(`Failed to create fulfillment with tracking: ${response.fulfillmentCreate.userErrors
                        .map((error) => `${error.field}: ${error.message}`)
                        .join(", ")}`);
                }
                fulfillment = response.fulfillmentCreate.fulfillment;
                action = "created_fulfillment_with_tracking";
            }
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
                carrierIsShopifySupported: resolvedCompany ? isSupportedTrackingCompany(resolvedCompany) : null
            };
        }
        catch (error) {
            console.error("Error updating fulfillment tracking:", error);
            throw new Error(`Failed to update fulfillment tracking: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
};
export { updateFulfillmentTracking };
