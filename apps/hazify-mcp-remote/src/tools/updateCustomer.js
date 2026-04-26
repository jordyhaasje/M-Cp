import { gql } from "../lib/shopifyGraphqlClient.js";
import { requireShopifyClient } from "./_context.js";
import { buildShopifyUserErrorResponse } from "../lib/shopifyToolErrors.js";
import { z } from "zod";
import { normalizeCustomerIdentifier } from "../lib/customerIdentifier.js";
// Input schema for updating a customer
const UpdateCustomerInputSchema = z.object({
    id: z.string().min(1),
    firstName: z.string().optional(),
    lastName: z.string().optional(),
    email: z.string().email().optional(),
    phone: z.string().optional(),
    tags: z.array(z.string()).optional(),
    note: z.string().optional(),
    acceptsMarketing: z.boolean().optional().describe("Deprecated: Shopify negeert dit veld in deze mutation; heeft momenteel geen effect."),
    taxExempt: z.boolean().optional(),
    metafields: z
        .array(z.object({
        id: z.string().optional(),
        namespace: z.string().optional(),
        key: z.string().optional(),
        value: z.string(),
        type: z.string().optional()
    }))
        .optional()
});
// Will be initialized in index.ts
const updateCustomer = {
    name: "update-customer",
    description: "Update a customer's information. Let op: acceptsMarketing wordt momenteel door Shopify genegeerd in deze mutation.",
    schema: UpdateCustomerInputSchema,
    // Add initialize method to set up the GraphQL client
    execute: async (input, context = {}) => {
      const shopifyClient = requireShopifyClient(context);
        try {
            const { id, acceptsMarketing, ...customerFields } = input;
            const resolvedCustomer = normalizeCustomerIdentifier(id);
            // Log a warning if acceptsMarketing was provided
            if (acceptsMarketing !== undefined) {
                console.warn("The acceptsMarketing field is not supported by the Shopify API and will be ignored");
            }
            const query = gql `
        mutation customerUpdate($input: CustomerInput!) {
          customerUpdate(input: $input) {
            customer {
              id
              firstName
              lastName
              email
              phone
              tags
              note
              taxExempt
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
            }
            userErrors {
              field
              message
            }
          }
        }
      `;
            const variables = {
                input: {
                    id: resolvedCustomer.gid,
                    ...customerFields
                }
            };
            const data = (await shopifyClient.request(query, variables));
            const userErrorResponse = buildShopifyUserErrorResponse(data.customerUpdate.userErrors, {
                actionMessage: "Failed to update customer",
                operation: "customerUpdate",
            });
            if (userErrorResponse) {
                return userErrorResponse;
            }
            // Format and return the updated customer
            const customer = data.customerUpdate.customer;
            // Format metafields if they exist
            const metafields = customer.metafields?.edges.map((edge) => edge.node) || [];
            return {
                customer: {
                    id: customer.id,
                    firstName: customer.firstName,
                    lastName: customer.lastName,
                    email: customer.email,
                    phone: customer.phone,
                    tags: customer.tags,
                    note: customer.note,
                    taxExempt: customer.taxExempt,
                    metafields
                }
            };
        }
        catch (error) {
            console.error("Error updating customer:", error);
            throw new Error(`Failed to update customer: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
};
export { updateCustomer };
