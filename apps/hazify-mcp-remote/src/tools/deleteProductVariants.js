import { gql } from "../lib/shopifyGraphqlClient.js";
import { requireShopifyClient } from "./_context.js";
import { buildShopifyUserErrorResponse } from "../lib/shopifyToolErrors.js";
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
// Input schema for deleteProductVariants
const DeleteProductVariantsInputSchema = z.object({
    productId: z.string().min(1).describe("Shopify product GID"),
    variantIds: z.array(z.string().min(1)).min(1).describe("Array of variant GIDs to delete"),
    confirmation: z.literal("DELETE_VARIANTS").describe("Verplicht type: 'DELETE_VARIANTS' als dubbele bevestiging."),
    reason: z.string().min(5).describe("Auditable reden waarom de varianten verdwijnen."),
});
// Will be initialized in index.ts
const deleteProductVariants = {
    name: "delete-product-variants",
    description: "Delete one or more variants from a product",
    schema: DeleteProductVariantsInputSchema,
    execute: async (input, context = {}) => {
      const shopifyClient = requireShopifyClient(context);
        try {
            const { productId, variantIds } = input;
            const query = gql `
        mutation productVariantsBulkDelete(
          $productId: ID!
          $variantsIds: [ID!]!
        ) {
          productVariantsBulkDelete(
            productId: $productId
            variantsIds: $variantsIds
          ) {
            product {
              id
              title
              variants(first: 20) {
                edges {
                  node {
                    id
                    title
                    price
                    sku
                    selectedOptions {
                      name
                      value
                    }
                  }
                }
              }
            }
            userErrors {
              field
              message
            }
          }
        }
      `;
            const data = (await shopifyClient.request(query, {
                productId,
                variantsIds: variantIds,
            }));
            const userErrorResponse = buildShopifyUserErrorResponse(
                data.productVariantsBulkDelete.userErrors,
                {
                    actionMessage: "Failed to delete variants",
                    operation: "productVariantsBulkDelete",
                }
            );
            if (userErrorResponse) {
                return userErrorResponse;
            }
            const product = data.productVariantsBulkDelete.product;
            const auditLog = await createMutationAuditLog({
                toolName: "delete-product-variants",
                tenantId: context?.tenantId || null,
                shopDomain: resolveShopDomain(context, shopifyClient),
                requestId: context?.requestId || null,
                reason: input.reason,
                targetIds: [productId, ...variantIds],
                payload: {
                    confirmation: input.confirmation,
                    productId,
                    variantIds,
                    remainingVariantIds: product?.variants?.edges.map((edge) => edge?.node?.id).filter(Boolean) || [],
                },
            });
            return {
                product: {
                    id: product.id,
                    title: product.title,
                    remainingVariants: product.variants.edges.map((e) => ({
                        id: e.node.id,
                        title: e.node.title,
                        price: e.node.price,
                        sku: e.node.sku,
                        options: e.node.selectedOptions,
                    })),
                },
                audit: {
                    auditLogId: auditLog?.id || null,
                    reason: input.reason,
                    requestId: context?.requestId || null,
                    tenantId: context?.tenantId || null,
                    shopDomain: resolveShopDomain(context, shopifyClient),
                    targetIds: [productId, ...variantIds],
                },
            };
        }
        catch (error) {
            console.error("Error deleting product variants:", error);
            throw new Error(`Failed to delete product variants: ${error instanceof Error ? error.message : String(error)}`);
        }
    },
};
export { deleteProductVariants };
