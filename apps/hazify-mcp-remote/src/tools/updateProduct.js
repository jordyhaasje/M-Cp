import { gql } from "graphql-request";
import { requireShopifyClient } from "./_context.js";
import { assertNoUserErrors } from "@hazify/shopify-core";
import { z } from "zod";
// Input schema for updateProduct
const UpdateProductInputSchema = z.object({
    id: z.string().min(1).describe("Shopify product GID, e.g. gid://shopify/Product/123"),
    title: z.string().optional(),
    descriptionHtml: z.string().optional(),
    handle: z.string().optional().describe("URL slug for the product"),
    vendor: z.string().optional(),
    productType: z.string().optional(),
    tags: z.array(z.string()).optional(),
    status: z.enum(["ACTIVE", "DRAFT", "ARCHIVED"]).optional(),
    seo: z
        .object({
        title: z.string().optional(),
        description: z.string().optional(),
    })
        .optional()
        .describe("SEO title and description for search engines"),
    metafields: z
        .array(z.object({
        id: z.string().optional(),
        namespace: z.string().optional(),
        key: z.string().optional(),
        value: z.string(),
        type: z.string().optional(),
    }))
        .optional(),
    media: z
        .array(z.object({
        originalSource: z.string().url(),
        mediaContentType: z.enum(["IMAGE", "VIDEO", "EXTERNAL_VIDEO", "MODEL_3D"]),
        alt: z.string().optional(),
    }))
        .optional()
        .describe("New media to add to the product"),
}).strict();
// Will be initialized in index.ts
const updateProduct = {
    name: "update-product",
    description: "Update an existing product's fields (title, description, status, tags, etc.)",
    schema: UpdateProductInputSchema,
    execute: async (input, context = {}) => {
      const shopifyClient = requireShopifyClient(context);
        try {
            const { id, media, ...productFields } = input;
            const query = gql `
        mutation productUpdate($product: ProductUpdateInput!, $media: [CreateMediaInput!]) {
          productUpdate(product: $product, media: $media) {
            product {
              id
              title
              handle
              descriptionHtml
              vendor
              productType
              status
              tags
              seo {
                title
                description
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
            const variables = {
                product: {
                    id,
                    ...productFields,
                },
                ...(media?.length ? { media } : {}),
            };
            const data = (await shopifyClient.request(query, variables));
            assertNoUserErrors(data.productUpdate.userErrors, "Failed to update product");
            const product = data.productUpdate.product;
            return {
                product: {
                    id: product.id,
                    title: product.title,
                    handle: product.handle,
                    descriptionHtml: product.descriptionHtml,
                    vendor: product.vendor,
                    productType: product.productType,
                    status: product.status,
                    tags: product.tags,
                    seo: product.seo,
                    metafields: product.metafields?.edges.map((e) => e.node) || [],
                    variants: product.variants?.edges.map((e) => ({
                        id: e.node.id,
                        title: e.node.title,
                        price: e.node.price,
                        sku: e.node.sku,
                        options: e.node.selectedOptions,
                    })) || [],
                },
            };
        }
        catch (error) {
            console.error("Error updating product:", error);
            throw new Error(`Failed to update product: ${error instanceof Error ? error.message : String(error)}`);
        }
    },
};
export { updateProduct };
