import { gql } from "../lib/shopifyGraphqlClient.js";
import { requireShopifyClient } from "./_context.js";
import { buildShopifyUserErrorResponse } from "../lib/shopifyToolErrors.js";
import { z } from "zod";
import { resolveOrderIdentifier } from "../lib/orderIdentifier.js";

const TrackingInputSchema = z
  .object({
    fulfillmentId: z.string().optional(),
    number: z.string().optional(),
    url: z.string().url().optional(),
    company: z.string().optional(),
    notifyCustomer: z.boolean().optional(),
  })
  .optional();

const UpdateOrderInputSchema = z.object({
  id: z.string().min(1),
  confirmation: z
    .literal("UPDATE_ORDER")
    .describe("Verplicht type: 'UPDATE_ORDER' ter bevestiging voor LLM hallucinatie-preventie."),
  reason: z.string().min(5).describe("Reden voor het aanpassen van de order (voor audit trail)."),
  tags: z.array(z.string()).optional(),
  email: z.string().email().optional(),
  note: z.string().optional(),
  customAttributes: z
    .array(
      z.object({
        key: z.string(),
        value: z.string(),
      })
    )
    .optional(),
  metafields: z
    .array(
      z.object({
        id: z.string().optional(),
        namespace: z.string().optional(),
        key: z.string().optional(),
        value: z.string(),
        type: z.string().optional(),
      })
    )
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
      zip: z.string().optional(),
    })
    .optional(),
  tracking: TrackingInputSchema,
  fulfillmentId: z.string().optional(),
  trackingNumber: z.string().optional(),
  trackingUrl: z.string().url().optional(),
  trackingCompany: z.string().optional(),
  notifyCustomer: z.boolean().optional(),
});

const LEGACY_TRACKING_CUSTOM_ATTRIBUTE_KEYS = new Set([
  "tracking_number",
  "trackingnumber",
  "tracking-number",
  "carrier",
  "tracking_company",
  "trackingcompany",
  "tracking-company",
  "tracking_url",
  "trackingurl",
  "tracking-url",
]);

const LEGACY_TRACKING_METAFIELD_KEYS = new Set([
  "tracking_number",
  "trackingnumber",
  "tracking-number",
  "carrier",
  "tracking_company",
  "trackingcompany",
  "tracking-company",
  "tracking_url",
  "trackingurl",
  "tracking-url",
]);

const ORDER_UPDATE_MUTATION = gql`
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

const isLegacyTrackingCustomAttribute = (attribute) => {
  const key = String(attribute?.key || "").trim().toLowerCase();
  return key ? LEGACY_TRACKING_CUSTOM_ATTRIBUTE_KEYS.has(key) : false;
};

const isLegacyTrackingMetafield = (metafield) => {
  const key = String(metafield?.key || "").trim().toLowerCase();
  if (!key || !LEGACY_TRACKING_METAFIELD_KEYS.has(key)) {
    return false;
  }
  const namespace = String(metafield?.namespace || "").trim().toLowerCase();
  return !namespace || namespace === "shipping";
};

const firstDefinedString = (...values) => {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return null;
};

const firstDefinedBoolean = (...values) => {
  for (const value of values) {
    if (typeof value === "boolean") {
      return value;
    }
  }
  return undefined;
};

const formatOrderResponse = (order) => ({
  id: order.id,
  name: order.name,
  email: order.email,
  note: order.note,
  tags: order.tags,
  customAttributes: order.customAttributes,
  metafields: normalizeGraphQLList(order.metafields),
  shippingAddress: order.shippingAddress,
});

const buildOrderUpdatePayload = (input) => {
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
  if (input.customAttributes !== undefined) {
    payload.customAttributes = input.customAttributes;
  }
  if (input.metafields !== undefined) {
    payload.metafields = input.metafields;
  }
  if (input.shippingAddress !== undefined) {
    payload.shippingAddress = input.shippingAddress;
  }

  return payload;
};

const buildTrackingRepairResponse = ({
  resolvedOrderId,
  input,
  legacyCustomAttributes,
  legacyMetafields,
}) => {
  const trackingNumber = firstDefinedString(
    input.tracking?.number,
    input.trackingNumber,
    ...legacyCustomAttributes.map((entry) => entry?.value),
    ...legacyMetafields.map((entry) => entry?.value)
  );
  const trackingUrl = firstDefinedString(
    input.tracking?.url,
    input.trackingUrl,
    ...legacyCustomAttributes
      .filter((entry) => String(entry?.key || "").toLowerCase().includes("url"))
      .map((entry) => entry?.value),
    ...legacyMetafields
      .filter((entry) => String(entry?.key || "").toLowerCase().includes("url"))
      .map((entry) => entry?.value)
  );
  const trackingCompany = firstDefinedString(
    input.tracking?.company,
    input.trackingCompany,
    ...legacyCustomAttributes
      .filter((entry) => String(entry?.key || "").toLowerCase().includes("carrier") || String(entry?.key || "").toLowerCase().includes("company"))
      .map((entry) => entry?.value),
    ...legacyMetafields
      .filter((entry) => String(entry?.key || "").toLowerCase().includes("carrier") || String(entry?.key || "").toLowerCase().includes("company"))
      .map((entry) => entry?.value)
  );
  const fulfillmentId = firstDefinedString(
    input.tracking?.fulfillmentId,
    input.fulfillmentId
  );
  const notifyCustomer = firstDefinedBoolean(
    input.tracking?.notifyCustomer,
    input.notifyCustomer
  );

  const nextTool = fulfillmentId ? "update-fulfillment-tracking" : "set-order-tracking";
  const nextArgsTemplate =
    nextTool === "update-fulfillment-tracking"
      ? {
          orderId: resolvedOrderId,
          ...(trackingNumber ? { trackingNumber } : {}),
          ...(trackingCompany ? { trackingCompany } : {}),
          ...(trackingUrl ? { trackingUrl } : {}),
          ...(notifyCustomer !== undefined ? { notifyCustomer } : {}),
          ...(fulfillmentId ? { fulfillmentId } : {}),
        }
      : {
          order: resolvedOrderId,
          ...(trackingNumber ? { trackingCode: trackingNumber } : {}),
          ...(trackingCompany ? { carrier: trackingCompany } : {}),
          ...(trackingUrl ? { trackingUrl } : {}),
          ...(notifyCustomer !== undefined ? { notifyCustomer } : {}),
          ...(fulfillmentId ? { fulfillmentId } : {}),
        };

  return {
    success: false,
    status: "tracking_requires_dedicated_tool",
    message:
      "Tracking hoort niet meer thuis in update-order. Gebruik set-order-tracking of update-fulfillment-tracking zodat fulfillments de enige bron van waarheid blijven.",
    errorCode: "tracking_requires_dedicated_tool",
    retryable: true,
    nextAction: "use_dedicated_tracking_tool",
    nextTool,
    retryMode: "separate_tracking_call",
    normalizedArgs: {
      id: resolvedOrderId,
      reason: input.reason,
      trackingRequested: true,
    },
    nextArgsTemplate,
    suggestedFixes: [
      "Verplaats tracking-updates naar set-order-tracking of update-fulfillment-tracking.",
      "Gebruik update-order alleen nog voor ordervelden zoals note, tags, email of shippingAddress.",
    ],
    errors: [
      {
        path: ["tracking"],
        problem:
          "update-order schrijft geen tracking meer via tracking, customAttributes of metafields.",
        fixSuggestion:
          "Gebruik de fulfillment tracking tools zodat fulfillments.trackingInfo de bron van waarheid blijft.",
      },
    ],
    legacySignals: {
      customAttributes: legacyCustomAttributes,
      metafields: legacyMetafields,
    },
  };
};

const updateOrder = {
  name: "update-order",
  description:
    "Update an existing order with new information. Gebruik voor shipment tracking set-order-tracking of update-fulfillment-tracking; update-order schrijft geen tracking meer.",
  schema: UpdateOrderInputSchema,
  execute: async (input, context = {}) => {
    const shopifyClient = requireShopifyClient(context);
    try {
      const resolvedOrder = await resolveOrderIdentifier(shopifyClient, input.id);
      const resolvedOrderId = resolvedOrder.id;

      const legacyCustomAttributes = Array.isArray(input.customAttributes)
        ? input.customAttributes.filter(isLegacyTrackingCustomAttribute)
        : [];
      const legacyMetafields = Array.isArray(input.metafields)
        ? input.metafields.filter(isLegacyTrackingMetafield)
        : [];

      const trackingRequested =
        Boolean(input.tracking) ||
        Boolean(input.fulfillmentId) ||
        Boolean(input.trackingNumber) ||
        Boolean(input.trackingUrl) ||
        Boolean(input.trackingCompany) ||
        input.notifyCustomer !== undefined ||
        legacyCustomAttributes.length > 0 ||
        legacyMetafields.length > 0;

      if (trackingRequested) {
        return buildTrackingRepairResponse({
          resolvedOrderId,
          input,
          legacyCustomAttributes,
          legacyMetafields,
        });
      }

      const orderFields = buildOrderUpdatePayload(input);
      if (Object.keys(orderFields).length === 0) {
        throw new Error("No order fields were provided to update.");
      }

      const orderUpdateResponse = await shopifyClient.request(ORDER_UPDATE_MUTATION, {
        input: {
          id: resolvedOrderId,
          ...orderFields,
        },
      });
      const userErrorResponse = buildShopifyUserErrorResponse(
        orderUpdateResponse.orderUpdate.userErrors,
        {
          actionMessage: "Failed to update order",
          operation: "orderUpdate",
        }
      );
      if (userErrorResponse) {
        return {
          ...userErrorResponse,
          resolvedOrder: {
            input: input.id,
            resolvedId: resolvedOrderId,
            source: resolvedOrder.source,
            matchedByQuery: resolvedOrder.matchedByQuery || null,
          },
        };
      }

      return {
        order: formatOrderResponse(orderUpdateResponse.orderUpdate.order),
        resolvedOrder: {
          input: input.id,
          resolvedId: resolvedOrderId,
          source: resolvedOrder.source,
          matchedByQuery: resolvedOrder.matchedByQuery || null,
        },
      };
    } catch (error) {
      console.error("Error updating order:", error);
      throw new Error(
        `Failed to update order: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  },
};

export { updateOrder };
