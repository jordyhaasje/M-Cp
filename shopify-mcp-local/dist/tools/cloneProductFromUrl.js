import { gql } from "graphql-request";
import { z } from "zod";
import { fetchWithSafeRedirects } from "../lib/urlSecurity.js";

const CloneProductFromUrlInputSchema = z.object({
  sourceUrl: z.string().url().describe("Public Shopify product URL"),
  status: z.enum(["ACTIVE", "DRAFT", "ARCHIVED"]).default("ACTIVE"),
  titleOverride: z.string().optional(),
  handleOverride: z.string().optional(),
  vendorOverride: z.string().optional(),
  importDescription: z.boolean().default(true),
  importMedia: z.boolean().default(true),
  taxable: z.boolean().default(true),
  tracked: z.boolean().default(true),
});

let shopifyClient;

function toAbsoluteUrl(url) {
  if (!url) return url;
  if (url.startsWith("//")) return `https:${url}`;
  return url;
}

function centsToMoneyString(cents) {
  if (cents === null || cents === undefined) return undefined;
  return (Number(cents) / 100).toFixed(2);
}

function makeProductJsonUrl(sourceUrl) {
  const u = new URL(sourceUrl);
  const cleanPath = u.pathname.endsWith("/") ? u.pathname.slice(0, -1) : u.pathname;
  u.pathname = cleanPath.endsWith(".js") ? cleanPath : `${cleanPath}.js`;
  u.search = "";
  u.hash = "";
  return u.toString();
}

async function fetchSourceProduct(sourceUrl) {
  const jsonUrl = makeProductJsonUrl(sourceUrl);
  const res = await fetchWithSafeRedirects(jsonUrl, {
    timeoutMs: 10000,
    maxRedirects: 4,
    headers: {
      "User-Agent": "shopify-mcp-local-clone/1.0",
      Accept: "application/json",
    },
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch source product JSON (${res.status}) from ${jsonUrl}`);
  }

  return await res.json();
}

const cloneProductFromUrl = {
  name: "clone-product-from-url",
  description:
    "Clone a public Shopify product URL into your connected store with options, variants, prices and media.",
  schema: CloneProductFromUrlInputSchema,
  initialize(client) {
    shopifyClient = client;
  },
  execute: async (input) => {
    try {
      const source = await fetchSourceProduct(input.sourceUrl);

      const optionDefs = (source.options || []).map((opt) => ({
        name: opt.name,
        values: (opt.values || []).map((value) => ({ name: value })),
      }));

      const altBySrc = new Map(
        (source.media || [])
          .filter((m) => m?.media_type === "image" && m?.src)
          .map((m) => [toAbsoluteUrl(m.src), m.alt || null])
      );

      const media = input.importMedia
        ? (source.images || []).map((src) => {
            const abs = toAbsoluteUrl(src);
            return {
              originalSource: abs,
              mediaContentType: "IMAGE",
              alt: altBySrc.get(abs) || null,
            };
          })
        : [];

      const createMutation = gql`
        mutation ProductCreate($product: ProductCreateInput!, $media: [CreateMediaInput!]) {
          productCreate(product: $product, media: $media) {
            product {
              id
              title
              handle
            }
            userErrors {
              field
              message
            }
          }
        }
      `;

      const createVariables = {
        product: {
          title: input.titleOverride || source.title,
          handle: input.handleOverride || source.handle,
          vendor: input.vendorOverride || source.vendor || undefined,
          status: input.status,
          descriptionHtml: input.importDescription ? source.description || "" : undefined,
          productOptions: optionDefs.length ? optionDefs : undefined,
        },
        media: media.length ? media : undefined,
      };

      const createData = await shopifyClient.request(createMutation, createVariables);
      const createPayload = createData.productCreate;

      if (createPayload.userErrors?.length) {
        throw new Error(
          createPayload.userErrors.map((e) => `${e.field}: ${e.message}`).join(", ")
        );
      }

      const productId = createPayload.product.id;

      const variants = (source.variants || []).map((v) => {
        const optionValues = [];

        if (source.options?.[0]?.name && v.option1) {
          optionValues.push({ optionName: source.options[0].name, name: v.option1 });
        }
        if (source.options?.[1]?.name && v.option2) {
          optionValues.push({ optionName: source.options[1].name, name: v.option2 });
        }
        if (source.options?.[2]?.name && v.option3) {
          optionValues.push({ optionName: source.options[2].name, name: v.option3 });
        }

        return {
          price: centsToMoneyString(v.price),
          compareAtPrice: centsToMoneyString(v.compare_at_price),
          taxable: v.taxable ?? input.taxable,
          inventoryItem: {
            sku: v.sku || undefined,
            tracked:
              v.inventory_management === null || v.inventory_management === undefined
                ? input.tracked
                : Boolean(v.inventory_management),
          },
          optionValues: optionValues.length ? optionValues : undefined,
        };
      });

      if (variants.length > 0) {
        const bulkCreateMutation = gql`
          mutation ProductVariantsBulkCreate(
            $productId: ID!
            $variants: [ProductVariantsBulkInput!]!
            $strategy: ProductVariantsBulkCreateStrategy
          ) {
            productVariantsBulkCreate(
              productId: $productId
              variants: $variants
              strategy: $strategy
            ) {
              productVariants {
                id
              }
              userErrors {
                field
                message
              }
            }
          }
        `;

        const chunkSize = 100;
        for (let i = 0; i < variants.length; i += chunkSize) {
          const chunk = variants.slice(i, i + chunkSize);
          const data = await shopifyClient.request(bulkCreateMutation, {
            productId,
            variants: chunk,
            strategy: "REMOVE_STANDALONE_VARIANT",
          });

          const errors = data.productVariantsBulkCreate.userErrors;
          if (errors?.length) {
            throw new Error(errors.map((e) => `${e.field}: ${e.message}`).join(", "));
          }
        }
      }

      return {
        product: {
          id: productId,
          title: createPayload.product.title,
          handle: createPayload.product.handle,
        },
        imported: {
          options: optionDefs.length,
          variants: variants.length,
          media: media.length,
        },
      };
    } catch (error) {
      console.error("Error cloning product from URL:", error);
      throw new Error(
        `Failed to clone product from URL: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  },
};

export { cloneProductFromUrl };
