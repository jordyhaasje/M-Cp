import { gql } from "graphql-request";
import { z } from "zod";

const RefundLineItemSchema = z.object({
  lineItemId: z.string().min(1),
  quantity: z.number().int().positive(),
  restockType: z.string().optional(),
  locationId: z.string().optional(),
});

const RefundTransactionSchema = z.object({
  amount: z.string().min(1).describe("Refund amount, e.g. '10.00'"),
  gateway: z.string().min(1).describe("Gateway name from the order transaction"),
  kind: z.string().default("REFUND").describe("Order transaction kind, usually REFUND"),
  parentId: z.string().optional().describe("Parent transaction ID from a CAPTURE/SALE"),
});

const RefundOrderInputSchema = z.object({
  orderId: z.string().min(1).describe("Shopify order GID, e.g. gid://shopify/Order/123"),
  note: z.string().optional(),
  notify: z.boolean().default(false),
  currency: z.string().optional().describe("Presentment currency code, e.g. EUR"),
  allowOverRefunding: z.boolean().optional(),
  refundLineItems: z.array(RefundLineItemSchema).optional(),
  shipping: z
    .object({
      amount: z.string().optional().describe("Shipping refund amount, e.g. '4.95'"),
      fullRefund: z.boolean().optional(),
    })
    .optional(),
  transactions: z.array(RefundTransactionSchema).optional(),
});

let shopifyClient;

const refundOrder = {
  name: "refund-order",
  description: "Create a full or partial refund for an order using Shopify refundCreate.",
  schema: RefundOrderInputSchema,
  initialize(client) {
    shopifyClient = client;
  },
  execute: async (input) => {
    try {
      const mutation = gql`
        mutation RefundOrder($input: RefundInput!) {
          refundCreate(input: $input) {
            refund {
              id
              createdAt
              note
              totalRefundedSet {
                shopMoney {
                  amount
                  currencyCode
                }
                presentmentMoney {
                  amount
                  currencyCode
                }
              }
            }
            order {
              id
              name
            }
            userErrors {
              field
              message
            }
          }
        }
      `;

      const refundInput = {
        orderId: input.orderId,
        note: input.note,
        notify: input.notify,
        currency: input.currency,
        allowOverRefunding: input.allowOverRefunding,
        refundLineItems: input.refundLineItems,
        shipping: input.shipping,
        transactions: input.transactions?.map((t) => ({
          orderId: input.orderId,
          amount: t.amount,
          gateway: t.gateway,
          kind: t.kind,
          parentId: t.parentId,
        })),
      };

      const data = await shopifyClient.request(mutation, { input: refundInput });
      const payload = data.refundCreate;

      if (payload.userErrors?.length) {
        throw new Error(
          payload.userErrors.map((e) => `${e.field}: ${e.message}`).join(", ")
        );
      }

      return {
        refund: {
          id: payload.refund?.id,
          createdAt: payload.refund?.createdAt,
          note: payload.refund?.note,
          totalRefundedSet: payload.refund?.totalRefundedSet,
        },
        order: payload.order
          ? {
              id: payload.order.id,
              name: payload.order.name,
            }
          : null,
      };
    } catch (error) {
      console.error("Error creating refund:", error);
      throw new Error(
        `Failed to create refund: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  },
};

export { refundOrder };
