import crypto from "crypto";
import { gql } from "../lib/shopifyGraphqlClient.js";
import { requireShopifyClient } from "./_context.js";
import { buildShopifyUserErrorResponse } from "../lib/shopifyToolErrors.js";
import { z } from "zod";
import { resolveOrderIdentifier } from "../lib/orderIdentifier.js";

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
  orderId: z.string().min(1).describe("Accepts Shopify GID, numeric order id, or order number like 1004/#1004"),
  confirmation: z.literal("REFUND_ORDER").describe("Verplicht type: 'REFUND_ORDER' ter bevestiging om accidentele refunds te voorkomen."),
  idempotencyKey: z.string().min(8).max(255).optional().describe("Optionele Shopify idempotency key. Als deze ontbreekt, genereert de server een deterministische sleutel."),
  note: z.string().optional(),
  audit: z.object({
    amount: z.string().min(1).describe("Refund amount for audit trail, e.g. '19.95'"),
    reason: z.string().min(3).describe("Reason for refund, e.g. 'damaged item'"),
    scope: z.enum(["full", "partial"]).describe("Refund scope"),
  }),
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

const buildDeterministicRefundIdempotencyKey = ({ resolvedOrderId, input, refundInput }) => {
  const hash = crypto
    .createHash("sha256")
    .update(
      JSON.stringify({
        resolvedOrderId,
        audit: input.audit,
        note: refundInput.note || null,
        notify: refundInput.notify,
        currency: refundInput.currency || null,
        allowOverRefunding: refundInput.allowOverRefunding ?? null,
        refundLineItems: refundInput.refundLineItems || [],
        shipping: refundInput.shipping || null,
        transactions: refundInput.transactions || [],
      })
    )
    .digest("hex");
  return `refund-${hash.slice(0, 48)}`;
};


const refundOrder = {
  name: "refund-order",
  description: "Create a full or partial refund for an order using Shopify refundCreate.",
  schema: RefundOrderInputSchema,
  execute: async (input, context = {}) => {
      const shopifyClient = requireShopifyClient(context);
    try {
      const resolvedOrder = await resolveOrderIdentifier(shopifyClient, input.orderId);
      const resolvedOrderId = resolvedOrder.id;
      const audit = input.audit;
      const auditNote = `[Refund audit] amount=${audit.amount}; scope=${audit.scope}; reason=${audit.reason}`;
      const finalNote =
        typeof input.note === "string" && input.note.trim()
          ? `${input.note.trim()}\n${auditNote}`
          : auditNote;

      const mutation = gql`
        mutation RefundOrder($input: RefundInput!, $idempotencyKey: String!) {
          refundCreate(input: $input) @idempotent(key: $idempotencyKey) {
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
        orderId: resolvedOrderId,
        note: finalNote,
        notify: input.notify,
        currency: input.currency,
        allowOverRefunding: input.allowOverRefunding,
        refundLineItems: input.refundLineItems,
        shipping: input.shipping,
        transactions: input.transactions?.map((t) => ({
          orderId: resolvedOrderId,
          amount: t.amount,
          gateway: t.gateway,
          kind: t.kind,
          parentId: t.parentId,
        })),
      };
      const idempotencyKey =
        typeof input.idempotencyKey === "string" && input.idempotencyKey.trim()
          ? input.idempotencyKey.trim()
          : buildDeterministicRefundIdempotencyKey({
              resolvedOrderId,
              input,
              refundInput,
            });

      const data = await shopifyClient.request(mutation, {
        input: refundInput,
        idempotencyKey,
      });
      const payload = data.refundCreate;

      const userErrorResponse = buildShopifyUserErrorResponse(payload.userErrors, {
        actionMessage: "Failed to create refund",
        operation: "refundCreate",
      });
      if (userErrorResponse) {
        return {
          ...userErrorResponse,
          resolvedOrder: {
            input: input.orderId,
            resolvedId: resolvedOrderId,
            source: resolvedOrder.source,
            matchedByQuery: resolvedOrder.matchedByQuery || null,
          },
          audit: input.audit,
          idempotencyKey,
        };
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
        resolvedOrder: {
          input: input.orderId,
          resolvedId: resolvedOrderId,
          source: resolvedOrder.source,
          matchedByQuery: resolvedOrder.matchedByQuery || null,
        },
        audit: input.audit,
        idempotencyKey,
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
