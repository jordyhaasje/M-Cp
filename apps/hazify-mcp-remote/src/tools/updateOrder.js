import { gql } from "graphql-request";
import { requireShopifyClient } from "./_context.js";
import { assertNoUserErrors } from "@hazify/shopify-core";
import { z } from "zod";
import { isSupportedTrackingCompany, assertSupportedTrackingCompany } from "../lib/trackingCompanies.js";
import { resolveOrderIdentifier } from "../lib/orderIdentifier.js";
// Will be initialized in index.ts
const TrackingInputSchema = z
    .object({
    fulfillmentId: z.string().optional(),
    number: z.string().optional(),
    url: z.string().url().optional(),
    company: z.string().optional(),
    notifyCustomer: z.boolean().optional()
})
    .optional();
// Input schema for updateOrder
// Based on https://shopify.dev/docs/api/admin-graphql/latest/mutations/orderupdate
const UpdateOrderInputSchema = z.object({
    id: z.string().min(1),
    confirmation: z.literal("UPDATE_ORDER").describe("Verplicht type: 'UPDATE_ORDER' ter bevestiging voor LLM hallucinatie-preventie."),
    reason: z.string().min(5).describe("Reden voor het aanpassen van de order (voor audit trail)."),
    tags: z.array(z.string()).optional(),
    email: z.string().email().optional(),
    note: z.string().optional(),
    customAttributes: z
        .array(z.object({
        key: z.string(),
        value: z.string()
    }))
        .optional(),
    metafields: z
        .array(z.object({
        id: z.string().optional(),
        namespace: z.string().optional(),
        key: z.string().optional(),
        value: z.string(),
        type: z.string().optional()
    }))
        .optional(),
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
    // Preferred tracking payload
    tracking: TrackingInputSchema,
    // Backwards-compatible tracking fields
    fulfillmentId: z.string().optional(),
    trackingNumber: z.string().optional(),
    trackingUrl: z.string().url().optional(),
    trackingCompany: z.string().optional(),
    notifyCustomer: z.boolean().optional()
});
const LEGACY_TRACKING_CUSTOM_ATTRIBUTE_KEYS = {
    trackingNumber: new Set(["tracking_number", "trackingnumber", "tracking-number"]),
    trackingCompany: new Set(["carrier", "tracking_company", "trackingcompany", "tracking-company"]),
    trackingUrl: new Set(["tracking_url", "trackingurl", "tracking-url"])
};
const LEGACY_TRACKING_METAFIELD_KEYS = {
    trackingNumber: new Set(["tracking_number", "trackingnumber", "tracking-number"]),
    trackingCompany: new Set(["carrier", "tracking_company", "trackingcompany", "tracking-company"]),
    trackingUrl: new Set(["tracking_url", "trackingurl", "tracking-url"])
};
const isLegacyTrackingCustomAttributeKey = (key) => {
    if (!key) {
        return false;
    }
    const normalized = key.trim().toLowerCase();
    return (LEGACY_TRACKING_CUSTOM_ATTRIBUTE_KEYS.trackingNumber.has(normalized) ||
        LEGACY_TRACKING_CUSTOM_ATTRIBUTE_KEYS.trackingCompany.has(normalized) ||
        LEGACY_TRACKING_CUSTOM_ATTRIBUTE_KEYS.trackingUrl.has(normalized));
};
const isLegacyTrackingMetafield = (metafield) => {
    const key = metafield?.key?.trim()?.toLowerCase();
    if (!key) {
        return false;
    }
    if (metafield?.namespace && metafield.namespace.trim().toLowerCase() !== "shipping") {
        return false;
    }
    return (LEGACY_TRACKING_METAFIELD_KEYS.trackingNumber.has(key) ||
        LEGACY_TRACKING_METAFIELD_KEYS.trackingCompany.has(key) ||
        LEGACY_TRACKING_METAFIELD_KEYS.trackingUrl.has(key));
};
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
const ORDER_UPDATE_MUTATION = gql `
  mutation orderUpdate($input: OrderInput!) {
    orderUpdate(input: $input) {
      order {
        id
        name
        email
        note
        tags
        customAttributes {
          key
          value
        }
        metafields(first: 10) {
          edges {
            node {
              id
              namespace
              key
              value
            }
          }
        }
        shippingAddress {
          address1
          address2
          city
          company
          country
          firstName
          lastName
          phone
          province
          zip
        }
      }
      userErrors {
        field
        message
      }
    }
  }
`;
const ORDER_TRACKING_CONTEXT_QUERY_CONNECTION = gql `
  query getOrderTrackingContext($id: ID!) {
    order(id: $id) {
      id
      name
      customAttributes {
        key
        value
      }
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
      customAttributes {
        key
        value
      }
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
      customAttributes {
        key
        value
      }
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
const fetchOrderTrackingContext = async (shopifyClient, orderId) => {
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
const getDefinedValue = (...candidates) => {
    for (const candidate of candidates) {
        if (candidate !== undefined && candidate !== null) {
            return candidate;
        }
    }
    return undefined;
};
const parseLegacyTrackingCustomAttributes = (customAttributes) => {
    if (!Array.isArray(customAttributes) || customAttributes.length === 0) {
        return {
            remainingCustomAttributes: customAttributes,
            extracted: {}
        };
    }
    const extracted = {};
    const remainingCustomAttributes = [];
    for (const customAttribute of customAttributes) {
        const key = customAttribute?.key?.trim()?.toLowerCase();
        const value = customAttribute?.value;
        if (!key || typeof value !== "string") {
            remainingCustomAttributes.push(customAttribute);
            continue;
        }
        if (LEGACY_TRACKING_CUSTOM_ATTRIBUTE_KEYS.trackingNumber.has(key)) {
            if (!extracted.trackingNumber) {
                extracted.trackingNumber = value;
            }
            continue;
        }
        if (LEGACY_TRACKING_CUSTOM_ATTRIBUTE_KEYS.trackingCompany.has(key)) {
            if (!extracted.trackingCompany) {
                extracted.trackingCompany = value;
            }
            continue;
        }
        if (LEGACY_TRACKING_CUSTOM_ATTRIBUTE_KEYS.trackingUrl.has(key)) {
            if (!extracted.trackingUrl) {
                extracted.trackingUrl = value;
            }
            continue;
        }
        remainingCustomAttributes.push(customAttribute);
    }
    return {
        remainingCustomAttributes,
        extracted
    };
};
const parseLegacyTrackingMetafields = (metafields) => {
    if (!Array.isArray(metafields) || metafields.length === 0) {
        return {
            remainingMetafields: metafields,
            extracted: {}
        };
    }
    const extracted = {};
    const remainingMetafields = [];
    for (const metafield of metafields) {
        const key = metafield?.key?.trim()?.toLowerCase();
        const value = metafield?.value;
        if (!isLegacyTrackingMetafield(metafield) || typeof value !== "string") {
            remainingMetafields.push(metafield);
            continue;
        }
        if (LEGACY_TRACKING_METAFIELD_KEYS.trackingNumber.has(key) && !extracted.trackingNumber) {
            extracted.trackingNumber = value;
            continue;
        }
        if (LEGACY_TRACKING_METAFIELD_KEYS.trackingCompany.has(key) && !extracted.trackingCompany) {
            extracted.trackingCompany = value;
            continue;
        }
        if (LEGACY_TRACKING_METAFIELD_KEYS.trackingUrl.has(key) && !extracted.trackingUrl) {
            extracted.trackingUrl = value;
            continue;
        }
        remainingMetafields.push(metafield);
    }
    return {
        remainingMetafields,
        extracted
    };
};
const formatOrderResponse = (order) => ({
    id: order.id,
    name: order.name,
    email: order.email,
    note: order.note,
    tags: order.tags,
    customAttributes: order.customAttributes,
    metafields: order.metafields?.edges.map((edge) => edge.node) || [],
    shippingAddress: order.shippingAddress
});
const hasTrackingPayload = (trackingPayload) => {
    return !!(trackingPayload.number || trackingPayload.url || trackingPayload.company);
};
const buildOrderUpdatePayload = (input, parsedCustomAttributes, parsedMetafields) => {
    const payload = {};
    if (input.tags !== undefined) {
        payload.tags = input.tags;
    }
    if (input.email !== undefined) {
        payload.email = input.email;
    }
    if (input.note !== undefined) {
        payload.note = input.note;
    }
    if (input.metafields !== undefined) {
        // Prevent writing legacy tracking metafields (shipping.tracking_number / shipping.carrier / shipping.tracking_url).
        if (Array.isArray(input.metafields) && input.metafields.length > 0) {
            if (parsedMetafields.remainingMetafields.length > 0) {
                payload.metafields = parsedMetafields.remainingMetafields;
            }
        }
        else {
            payload.metafields = input.metafields;
        }
    }
    if (input.shippingAddress !== undefined) {
        payload.shippingAddress = input.shippingAddress;
    }
    if (input.customAttributes !== undefined) {
        // Prevent writing tracking fields to "Aanvullende gegevens".
        if (Array.isArray(input.customAttributes) && input.customAttributes.length > 0) {
            if (parsedCustomAttributes.remainingCustomAttributes.length > 0) {
                payload.customAttributes = parsedCustomAttributes.remainingCustomAttributes;
            }
        }
        else {
            payload.customAttributes = input.customAttributes;
        }
    }
    return payload;
};
const buildTrackingRequest = (input, parsedCustomAttributes, parsedMetafields) => {
    const tracking = input.tracking || {};
    const trackingNumber = getDefinedValue(tracking.number, input.trackingNumber, parsedCustomAttributes.extracted.trackingNumber, parsedMetafields.extracted.trackingNumber);
    const trackingUrl = getDefinedValue(tracking.url, input.trackingUrl, parsedCustomAttributes.extracted.trackingUrl, parsedMetafields.extracted.trackingUrl);
    const rawCompany = getDefinedValue(tracking.company, input.trackingCompany, parsedCustomAttributes.extracted.trackingCompany, parsedMetafields.extracted.trackingCompany);
    const resolvedCompany = rawCompany ? assertSupportedTrackingCompany(rawCompany, "carrier") : undefined;
    const notifyCustomer = getDefinedValue(tracking.notifyCustomer, input.notifyCustomer);
    const fulfillmentId = getDefinedValue(tracking.fulfillmentId, input.fulfillmentId);
    const trackingInfoInput = {};
    if (trackingNumber) {
        trackingInfoInput.number = trackingNumber.trim();
    }
    if (trackingUrl) {
        trackingInfoInput.url = trackingUrl.trim();
    }
    if (resolvedCompany) {
        trackingInfoInput.company = resolvedCompany;
    }
    const trackingRequested = !!(input.tracking ||
        input.trackingNumber ||
        input.trackingUrl ||
        input.trackingCompany ||
        input.fulfillmentId ||
        input.notifyCustomer !== undefined ||
        parsedCustomAttributes.extracted.trackingNumber ||
        parsedCustomAttributes.extracted.trackingCompany ||
        parsedCustomAttributes.extracted.trackingUrl ||
        parsedMetafields.extracted.trackingNumber ||
        parsedMetafields.extracted.trackingCompany ||
        parsedMetafields.extracted.trackingUrl);
    return {
        trackingRequested,
        trackingInfoInput,
        fulfillmentId,
        notifyCustomer,
        rawCompany,
        resolvedCompany,
        mappedFromLegacyCustomAttributes: !!(parsedCustomAttributes.extracted.trackingNumber ||
            parsedCustomAttributes.extracted.trackingCompany ||
            parsedCustomAttributes.extracted.trackingUrl),
        mappedFromLegacyMetafields: !!(parsedMetafields.extracted.trackingNumber ||
            parsedMetafields.extracted.trackingCompany ||
            parsedMetafields.extracted.trackingUrl)
    };
};
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
const updateOrder = {
    name: "update-order",
    description: "Update an existing order with new information. Gebruik voor shipment tracking bij voorkeur set-order-tracking of update-fulfillment-tracking; gebruik deze tool niet als primaire tracking workflow.",
    schema: UpdateOrderInputSchema,
    // Add initialize method to set up the GraphQL client
    execute: async (input, context = {}) => {
      const shopifyClient = requireShopifyClient(context);
        try {
            const { id } = input;
            const resolvedOrder = await resolveOrderIdentifier(shopifyClient, id);
            const resolvedOrderId = resolvedOrder.id;
            const parsedCustomAttributes = parseLegacyTrackingCustomAttributes(input.customAttributes);
            const parsedMetafields = parseLegacyTrackingMetafields(input.metafields);
            const orderFields = buildOrderUpdatePayload(input, parsedCustomAttributes, parsedMetafields);
            const trackingRequest = buildTrackingRequest(input, parsedCustomAttributes, parsedMetafields);
            let orderResult = null;
            let trackingResult = null;
            if (Object.keys(orderFields).length > 0) {
                const orderUpdateResponse = (await shopifyClient.request(ORDER_UPDATE_MUTATION, {
                    input: {
                        id: resolvedOrderId,
                        ...orderFields
                    }
                }));
                assertNoUserErrors(orderUpdateResponse.orderUpdate.userErrors, "Failed to update order");
                orderResult = formatOrderResponse(orderUpdateResponse.orderUpdate.order);
            }
            if (trackingRequest.trackingRequested) {
                if (!hasTrackingPayload(trackingRequest.trackingInfoInput)) {
                    throw new Error("Tracking update requested, but no tracking number, URL or carrier was provided.");
                }
                const contextResponse = (await fetchOrderTrackingContext(shopifyClient, resolvedOrderId));
                const orderContext = contextResponse.order;
                if (!orderContext) {
                    throw new Error(`Order with ID ${resolvedOrderId} not found.`);
                }
                const fulfillments = normalizeGraphQLList(orderContext.fulfillments);
                const fulfillmentOrders = normalizeGraphQLList(orderContext.fulfillmentOrders);
                const targetFulfillment = findFulfillmentToUpdate(fulfillments, trackingRequest.fulfillmentId);
                if (targetFulfillment) {
                    const trackingUpdateResponse = (await shopifyClient.request(FULFILLMENT_TRACKING_UPDATE_MUTATION, {
                        fulfillmentId: targetFulfillment.id,
                        trackingInfoInput: trackingRequest.trackingInfoInput,
                        notifyCustomer: trackingRequest.notifyCustomer
                    }));
                    assertNoUserErrors(trackingUpdateResponse.fulfillmentTrackingInfoUpdate.userErrors, "Failed to update fulfillment tracking");
                    trackingResult = {
                        action: "updated_existing_fulfillment",
                        fulfillmentId: targetFulfillment.id,
                        trackingInfo: trackingUpdateResponse.fulfillmentTrackingInfoUpdate.fulfillment?.trackingInfo || null
                    };
                }
                else {
                    const lineItemsByFulfillmentOrder = buildFulfillmentCreateLineItems(fulfillmentOrders);
                    if (lineItemsByFulfillmentOrder.length === 0) {
                        throw new Error("No fulfillable fulfillment orders found. Tracking cannot be set because there is no active fulfillment.");
                    }
                    const fulfillmentInput = {
                        lineItemsByFulfillmentOrder,
                        trackingInfo: trackingRequest.trackingInfoInput
                    };
                    if (trackingRequest.notifyCustomer !== undefined) {
                        fulfillmentInput.notifyCustomer = trackingRequest.notifyCustomer;
                    }
                    const createFulfillmentResponse = (await shopifyClient.request(FULFILLMENT_CREATE_MUTATION, {
                        fulfillment: fulfillmentInput
                    }));
                    assertNoUserErrors(createFulfillmentResponse.fulfillmentCreate.userErrors, "Failed to create fulfillment with tracking");
                    trackingResult = {
                        action: "created_fulfillment_with_tracking",
                        fulfillmentId: createFulfillmentResponse.fulfillmentCreate.fulfillment?.id || null,
                        trackingInfo: createFulfillmentResponse.fulfillmentCreate.fulfillment?.trackingInfo || null
                    };
                }
                trackingResult = {
                    ...trackingResult,
                    carrierInput: trackingRequest.rawCompany || null,
                    carrierResolved: trackingRequest.resolvedCompany || null,
                    carrierIsShopifySupported: trackingRequest.resolvedCompany
                        ? isSupportedTrackingCompany(trackingRequest.resolvedCompany)
                        : null,
                    mappedFromLegacyCustomAttributes: trackingRequest.mappedFromLegacyCustomAttributes,
                    mappedFromLegacyMetafields: trackingRequest.mappedFromLegacyMetafields
                };
                // Cleanup old tracking fields from "Aanvullende gegevens" when they exist.
                const existingCustomAttributes = orderContext.customAttributes || [];
                const cleanedCustomAttributes = existingCustomAttributes.filter((attribute) => !isLegacyTrackingCustomAttributeKey(attribute?.key));
                const removedCount = existingCustomAttributes.length - cleanedCustomAttributes.length;
                if (removedCount > 0) {
                    const cleanupResponse = (await shopifyClient.request(ORDER_UPDATE_MUTATION, {
                            input: {
                                id: resolvedOrderId,
                                customAttributes: cleanedCustomAttributes
                            }
                        }));
                    assertNoUserErrors(cleanupResponse.orderUpdate.userErrors, "Failed to cleanup legacy tracking custom attributes");
                    if (!orderResult) {
                        orderResult = formatOrderResponse(cleanupResponse.orderUpdate.order);
                    }
                    trackingResult = {
                        ...trackingResult,
                        removedLegacyTrackingCustomAttributes: removedCount
                    };
                }
            }
            if (!orderResult && !trackingResult) {
                throw new Error("No order fields or tracking fields were provided to update.");
            }
            return {
                order: orderResult,
                tracking: trackingResult,
                resolvedOrder: {
                    input: id,
                    resolvedId: resolvedOrderId,
                    source: resolvedOrder.source,
                    matchedByQuery: resolvedOrder.matchedByQuery || null
                }
            };
        }
        catch (error) {
            console.error("Error updating order:", error);
            throw new Error(`Failed to update order: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
};
export { updateOrder };
