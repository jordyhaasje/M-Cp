import { gql } from "graphql-request";
import { requireShopifyClient } from "./_context.js";
import { assertNoUserErrors } from "@hazify/shopify-core";
import { z } from "zod";
import { createMutationAuditLog } from "../lib/db.js";

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
// Input schema for deleteProduct
const DeleteProductInputSchema = z.object({
    id: z.string().min(1).describe("Shopify product GID, e.g. gid://shopify/Product/123"),
    confirmation: z.literal("DELETE_PRODUCT").describe("Verplicht type: 'DELETE_PRODUCT' als dubbele bevestiging (ter preventie LLM hallucinaties)."),
    reason: z.string().min(5).describe("Korte audit rede voor productverwijdering."),
});
// Will be initialized in index.ts
const deleteProduct = {
    name: "delete-product",
    description: "Delete a product",
    schema: DeleteProductInputSchema,
    execute: async (input, context = {}) => {
      const shopifyClient = requireShopifyClient(context);
        try {
            const query = gql `
        mutation productDelete($input: ProductDeleteInput!) {
          productDelete(input: $input) {
            deletedProductId
            userErrors {
              field
              message
            }
          }
        }
      `;
            const data = (await shopifyClient.request(query, {
                input: { id: input.id },
            }));
            assertNoUserErrors(data.productDelete.userErrors, "Failed to delete product");
            const auditLog = await createMutationAuditLog({
                toolName: "delete-product",
                tenantId: context?.tenantId || null,
                shopDomain: resolveShopDomain(context, shopifyClient),
                requestId: context?.requestId || null,
                reason: input.reason,
                targetIds: [input.id],
                payload: {
                    confirmation: input.confirmation,
                    deletedProductId: data.productDelete.deletedProductId || null,
                },
            });
            return {
                deletedProductId: data.productDelete.deletedProductId,
                audit: {
                    auditLogId: auditLog?.id || null,
                    reason: input.reason,
                    requestId: context?.requestId || null,
                    tenantId: context?.tenantId || null,
                    shopDomain: resolveShopDomain(context, shopifyClient),
                    targetIds: [input.id],
                },
            };
        }
        catch (error) {
            console.error("Error deleting product:", error);
            throw new Error(`Failed to delete product: ${error instanceof Error ? error.message : String(error)}`);
        }
    },
};
export { deleteProduct };
