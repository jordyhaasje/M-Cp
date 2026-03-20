import { gql } from "graphql-request";
import { requireShopifyClient } from "./_context.js";
import { z } from "zod";
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
            if (data.productDelete.userErrors.length > 0) {
                throw new Error(`Failed to delete product: ${data.productDelete.userErrors
                    .map((e) => `${e.field}: ${e.message}`)
                    .join(", ")}`);
            }
            return { deletedProductId: data.productDelete.deletedProductId };
        }
        catch (error) {
            console.error("Error deleting product:", error);
            throw new Error(`Failed to delete product: ${error instanceof Error ? error.message : String(error)}`);
        }
    },
};
export { deleteProduct };
