import { gql } from "graphql-request";
import { z } from "zod";
// Input schema for getOrders
const GetOrdersInputSchema = z.object({
    status: z.enum(["any", "open", "closed", "cancelled"]).default("any"),
    limit: z.number().int().min(1).max(250).default(50).describe("Max 250 per Shopify request"),
    cursor: z.string().optional().describe("Pagination cursor from previous get-orders response")
});
// Will be initialized in index.ts
const getOrders = {
    name: "get-orders",
    description: "READ-ONLY: get orders with optional filtering by status. Supports cursor pagination.",
    schema: GetOrdersInputSchema,
    // Add initialize method to set up the GraphQL client
    execute: async (input, context = {}) => {
        const shopifyClient = context?.shopifyClient;
        if (!shopifyClient) {
            throw new Error("Missing Shopify client in execution context");
        }
        try {
            const { status, limit, cursor } = input;
            // Build query filters
            let queryFilter = "";
            if (status !== "any") {
                queryFilter = `status:${status}`;
            }
            const first = Math.min(limit, 250);
            const query = gql `
        query GetOrders($first: Int!, $query: String, $after: String) {
          orders(first: $first, query: $query, after: $after) {
            pageInfo {
              hasNextPage
              endCursor
            }
            edges {
              cursor
              node {
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
                  email
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
                lineItems(first: 10) {
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
                tags
                note
              }
            }
          }
        }
      `;
            const variables = {
                first,
                query: queryFilter || undefined,
                after: cursor || undefined
            };
            const data = (await shopifyClient.request(query, variables));
            const pageInfo = data.orders.pageInfo || { hasNextPage: false, endCursor: null };
            // Extract and format order data
            const orders = data.orders.edges.map((edge) => {
                const order = edge.node;
                // Format line items
                const lineItems = order.lineItems.edges.map((lineItemEdge) => {
                    const lineItem = lineItemEdge.node;
                    return {
                        id: lineItem.id,
                        title: lineItem.title,
                        quantity: lineItem.quantity,
                        originalTotal: lineItem.originalTotalSet.shopMoney,
                        variant: lineItem.variant
                            ? {
                                id: lineItem.variant.id,
                                title: lineItem.variant.title,
                                sku: lineItem.variant.sku
                            }
                            : null
                    };
                });
                return {
                    id: order.id,
                    name: order.name,
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
                            email: order.customer.email
                        }
                        : null,
                    shippingAddress: order.shippingAddress,
                    lineItems,
                    tags: order.tags,
                    note: order.note,
                    cursor: edge.cursor
                };
            });
            return {
                orders,
                pagination: {
                    requestedLimit: limit,
                    appliedLimit: first,
                    hasNextPage: !!pageInfo.hasNextPage,
                    nextCursor: pageInfo.endCursor || null
                }
            };
        }
        catch (error) {
            console.error("Error fetching orders:", error);
            throw new Error(`Failed to fetch orders: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
};
export { getOrders };
