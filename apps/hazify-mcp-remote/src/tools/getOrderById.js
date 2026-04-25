import { gql } from "graphql-request";
import { requireShopifyClient } from "./_context.js";
import { z } from "zod";
import { resolveOrderIdentifier } from "../lib/orderIdentifier.js";
// Input schema for getOrderById
const GetOrderByIdInputSchema = z.object({
    orderId: z.string().min(1)
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
const GET_ORDER_BY_ID_QUERY = gql `
  query GetOrderById($id: ID!) {
    order(id: $id) {
      id
      name
      createdAt
      displayFinancialStatus
      displayFulfillmentStatus
      totalPriceSet {
        shopMoney {
          amount
          currencyCode
        }
      }
      subtotalPriceSet {
        shopMoney {
          amount
          currencyCode
        }
      }
      totalShippingPriceSet {
        shopMoney {
          amount
          currencyCode
        }
      }
      totalTaxSet {
        shopMoney {
          amount
          currencyCode
        }
      }
      customer {
        id
        firstName
        lastName
        defaultEmailAddress {
          emailAddress
        }
        defaultPhoneNumber {
          phoneNumber
        }
      }
      shippingAddress {
        address1
        address2
        city
        provinceCode
        zip
        country
        phone
      }
      lineItems(first: 20) {
        edges {
          node {
            id
            title
            quantity
            originalTotalSet {
              shopMoney {
                amount
                currencyCode
              }
            }
            variant {
              id
              title
              sku
            }
          }
        }
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
      tags
      note
      customAttributes {
        key
        value
      }
      metafields(first: 20) {
        edges {
          node {
            id
            namespace
            key
            value
            type
          }
        }
      }
    }
  }
`;
// Will be initialized in index.ts
const getOrderById = {
    name: "get-order-by-id",
    description: "READ-ONLY: fetch a specific order and tracking status. Does not update anything.",
    schema: GetOrderByIdInputSchema,
    // Add initialize method to set up the GraphQL client
    execute: async (input, context = {}) => {
      const shopifyClient = requireShopifyClient(context);
        try {
            const { orderId } = input;
            const resolvedOrder = await resolveOrderIdentifier(shopifyClient, orderId);
            const variables = {
                id: resolvedOrder.id
            };
            let data;
            data = (await shopifyClient.request(GET_ORDER_BY_ID_QUERY, variables));
            if (!data.order) {
                throw new Error(`Order with ID ${orderId} not found`);
            }
            // Extract and format order data
            const order = data.order;
            const lineItemNodes = normalizeGraphQLList(order.lineItems);
            const fulfillmentNodes = normalizeGraphQLList(order.fulfillments);
            const metafieldNodes = normalizeGraphQLList(order.metafields);
            // Format line items
            const lineItems = lineItemNodes.map((lineItem) => {
                return {
                    id: lineItem.id,
                    title: lineItem.title,
                    quantity: lineItem.quantity,
                    originalTotal: lineItem.originalTotalSet?.shopMoney,
                    variant: lineItem.variant
                        ? {
                            id: lineItem.variant.id,
                            title: lineItem.variant.title,
                            sku: lineItem.variant.sku
                        }
                        : null
                };
            });
            // Format metafields
            const metafields = metafieldNodes.map((metafield) => {
                return {
                    id: metafield.id,
                    namespace: metafield.namespace,
                    key: metafield.key,
                    value: metafield.value,
                    type: metafield.type
                };
            });
            const formattedOrder = {
                id: order.id,
                name: order.name,
                resolvedFrom: {
                    input: orderId,
                    resolvedId: resolvedOrder.id,
                    source: resolvedOrder.source,
                    matchedByQuery: resolvedOrder.matchedByQuery || null
                },
                createdAt: order.createdAt,
                financialStatus: order.displayFinancialStatus,
                fulfillmentStatus: order.displayFulfillmentStatus,
                totalPrice: order.totalPriceSet.shopMoney,
                subtotalPrice: order.subtotalPriceSet.shopMoney,
                totalShippingPrice: order.totalShippingPriceSet.shopMoney,
                totalTax: order.totalTaxSet.shopMoney,
                customer: order.customer
                    ? {
                        id: order.customer.id,
                        firstName: order.customer.firstName,
                        lastName: order.customer.lastName,
                        email: order.customer.defaultEmailAddress?.emailAddress || null,
                        phone: order.customer.defaultPhoneNumber?.phoneNumber || null
                    }
                    : null,
                shippingAddress: order.shippingAddress,
                fulfillments: fulfillmentNodes.map((fulfillment) => ({
                    id: fulfillment.id,
                    status: fulfillment.status,
                    createdAt: fulfillment.createdAt,
                    trackingInfo: fulfillment.trackingInfo || []
                })),
                tracking: {
                    sourceOfTruth: "fulfillments.trackingInfo",
                    shipments: fulfillmentNodes.flatMap((fulfillment) => (fulfillment.trackingInfo || []).map((tracking) => ({
                        fulfillmentId: fulfillment.id,
                        company: tracking.company,
                        number: tracking.number,
                        url: tracking.url
                    }))),
                    legacySignals: {
                        deprecated: true,
                        message: "Legacy tracking in customAttributes/metafields is read-only and no longer a write path. Gebruik fulfillments.trackingInfo als bron van waarheid.",
                        customAttributes: (order.customAttributes || []).filter((attribute) => {
                            const key = attribute?.key?.trim()?.toLowerCase();
                            return !!key && ["tracking_number", "trackingnumber", "tracking-number", "carrier", "tracking_company", "trackingcompany", "tracking-company", "tracking_url", "trackingurl", "tracking-url"].includes(key);
                        }),
                        metafields: metafields.filter((metafield) => metafield.namespace === "shipping" &&
                            ["tracking_number", "carrier", "tracking_url"].includes(metafield.key))
                    }
                },
                lineItems,
                tags: order.tags,
                note: order.note,
                customAttributes: order.customAttributes || [],
                metafields
            };
            return { order: formattedOrder };
        }
        catch (error) {
            console.error("Error fetching order by ID:", error);
            throw new Error(`Failed to fetch order: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
};
export { getOrderById };
