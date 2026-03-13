import { z } from "zod";
import { updateFulfillmentTracking } from "./updateFulfillmentTracking.js";
import { getOrderById } from "./getOrderById.js";
const SetOrderTrackingInputSchema = z.object({
    order: z.string().min(1).describe("Order referentie: #1004, 1004, numerieke Shopify id of gid://shopify/Order/..."),
    trackingCode: z.string().min(1).describe("Nieuwe trackingcode"),
    carrier: z.string().optional().describe("Vervoerdernaam (bij voorkeur exact uit get-supported-tracking-companies)"),
    trackingUrl: z.string().url().optional().describe("Optionele expliciete tracking URL"),
    notifyCustomer: z.boolean().default(false),
    fulfillmentId: z.string().optional()
});
const setOrderTracking = {
    name: "set-order-tracking",
    description: "One-shot tracking update tool for LLMs: resolves order reference, updates fulfillment tracking, and returns verification-ready output.",
    schema: SetOrderTrackingInputSchema,
    execute: async (input, context = {}) => {
        if (!context?.shopifyClient) {
            throw new Error("Missing Shopify client in execution context");
        }
        const result = await updateFulfillmentTracking.execute({
            orderId: input.order,
            trackingNumber: input.trackingCode,
            trackingCompany: input.carrier,
            trackingUrl: input.trackingUrl,
            notifyCustomer: input.notifyCustomer,
            fulfillmentId: input.fulfillmentId
        }, context);
        const verificationOrder = await getOrderById.execute({ orderId: result.order.id }, context);
        const shipments = verificationOrder.order?.tracking?.shipments || [];
        const normalizedTrackingCode = input.trackingCode.trim();
        const verificationMatch = shipments.find((shipment) => shipment.number === normalizedTrackingCode);
        if (!verificationMatch) {
            throw new Error(`Tracking verification failed: code '${normalizedTrackingCode}' was not found in order shipment tracking after update.`);
        }
        if (input.carrier) {
            const expectedCarrier = result.carrierResolved || input.carrier;
            if (verificationMatch.company !== expectedCarrier) {
                throw new Error(`Tracking verification failed: expected carrier '${expectedCarrier}', got '${verificationMatch.company || "unknown"}'.`);
            }
        }
        return {
            ...result,
            request: {
                order: input.order,
                trackingCode: input.trackingCode,
                carrier: input.carrier || null,
                trackingUrl: input.trackingUrl || null,
                notifyCustomer: input.notifyCustomer,
                fulfillmentId: input.fulfillmentId || null
            },
            verification: {
                success: true,
                orderId: verificationOrder.order.id,
                orderName: verificationOrder.order.name,
                shipment: verificationMatch
            }
        };
    }
};
export { setOrderTracking };
