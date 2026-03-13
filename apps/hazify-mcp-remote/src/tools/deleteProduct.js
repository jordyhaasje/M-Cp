import { gql } from "graphql-request";
import { z } from "zod";
// Input schema for deleteProduct
const DeleteProductInputSchema = z.object({
    id: z.string().min(1).describe("Shopify product GID, e.g. gid://shopify/Product/123"),
});
// Will be initialized in index.ts
const deleteProduct = {
    name: "delete-product",
    description: "Delete a product",
    schema: DeleteProductInputSchema,
    execute: async (input, context = {}) => {
        const shopifyClient = context?.shopifyClient;
        if (!shopifyClient) {
            throw new Error("Missing Shopify client in execution context");
        }
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
