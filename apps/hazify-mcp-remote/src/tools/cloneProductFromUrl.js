import { gql } from "graphql-request";
import { z } from "zod";
import { fetchWithSafeRedirects } from "../lib/urlSecurity.js";

const CloneProductFromUrlInputSchema = z.object({
  sourceUrl: z.string().url().describe("Public Shopify product URL"),
  status: z.enum(["ACTIVE", "DRAFT", "ARCHIVED"]).default("DRAFT"),
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

function normalizeComparableUrl(url) {
  if (!url || typeof url !== "string") return null;
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    parsed.search = "";
    return parsed.toString();
  } catch {
    return url.trim();
  }
}

function urlsLikelyMatch(left, right) {
  const a = normalizeComparableUrl(left);
  const b = normalizeComparableUrl(right);
  return !!a && !!b && a === b;
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
      "User-Agent": "hazify-mcp-remote-clone/1.0",
      Accept: "application/json",
    },
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch source product JSON (${res.status}) from ${jsonUrl}`);
  }

  return await res.json();
}

function extractSourceImageEntries(source) {
  const entries = [];
  const add = (item) => {
    const src =
      typeof item === "string"
        ? item
        : item?.src || item?.url || item?.originalSource || item?.image?.src || item?.image?.url;
    const absSrc = toAbsoluteUrl(src);
    if (!absSrc) return;
    entries.push({
      id:
        item && typeof item === "object" && item.id !== undefined && item.id !== null
          ? String(item.id)
          : null,
      src: absSrc,
      alt: item && typeof item === "object" && typeof item.alt === "string" ? item.alt : null,
    });
  };

  if (Array.isArray(source.images)) {
    source.images.forEach(add);
  }
  if (Array.isArray(source.media)) {
    source.media
      .filter((item) => item?.media_type === "image" || item?.mediaContentType === "IMAGE")
      .forEach(add);
  }

  return entries.filter((entry, index, arr) => arr.findIndex((ref) => ref.src === entry.src) === index);
}

function resolveSourceVariantImageUrl(variant, sourceImagesById) {
  const featuredImageSrc =
    variant?.featured_image?.src ||
    variant?.featured_image?.url ||
    variant?.image?.src ||
    variant?.image?.url ||
    null;
  const absoluteFeaturedImage = toAbsoluteUrl(featuredImageSrc);
  if (absoluteFeaturedImage) {
    return absoluteFeaturedImage;
  }
  const imageId =
    variant?.image_id !== undefined && variant?.image_id !== null ? String(variant.image_id) : null;
  if (imageId && sourceImagesById.has(imageId)) {
    return sourceImagesById.get(imageId);
  }
  return null;
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

      const sourceImageEntries = extractSourceImageEntries(source);
      const sourceImagesById = new Map(
        sourceImageEntries.filter((entry) => entry.id).map((entry) => [entry.id, entry.src])
      );
      const altBySrc = new Map(sourceImageEntries.map((entry) => [entry.src, entry.alt || null]));

      const media = input.importMedia
        ? sourceImageEntries.map((entry) => {
            const abs = entry.src;
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

      const variantPlans = (source.variants || []).map((v, index) => {
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

        const sourceImageUrl = input.importMedia
          ? resolveSourceVariantImageUrl(v, sourceImagesById)
          : null;
        const variantInput = {
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
        if (sourceImageUrl) {
          variantInput.mediaSrc = [sourceImageUrl];
        }
        return {
          sourceIndex: index,
          sourceVariantId:
            v?.id !== undefined && v?.id !== null ? String(v.id) : `source_variant_${index + 1}`,
          sourceTitle: typeof v?.title === "string" ? v.title : null,
          sourceImageUrl,
          variantInput,
        };
      });
      const variants = variantPlans.map((plan) => plan.variantInput);
      const createdVariants = [];

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
                title
                selectedOptions {
                  name
                  value
                }
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
          createdVariants.push(...(data.productVariantsBulkCreate.productVariants || []));
        }
      }

      let verifiedVariantMediaById = new Map();
      let mediaVerificationWarning = null;
      if (input.importMedia && createdVariants.length > 0) {
        const verificationQuery = gql`
          query VerifyVariantMedia($ids: [ID!]!) {
            nodes(ids: $ids) {
              ... on ProductVariant {
                id
                image {
                  url
                }
              }
            }
          }
        `;
        try {
          const verificationData = await shopifyClient.request(verificationQuery, {
            ids: createdVariants.map((variant) => variant.id),
          });
          const nodes = Array.isArray(verificationData?.nodes) ? verificationData.nodes : [];
          verifiedVariantMediaById = new Map(
            nodes
              .filter((node) => node?.id)
              .map((node) => [node.id, node?.image?.url ? toAbsoluteUrl(node.image.url) : null])
          );
        } catch (verificationError) {
          mediaVerificationWarning =
            verificationError instanceof Error ? verificationError.message : String(verificationError);
        }
      }

      const variantMediaMappings = variantPlans.map((plan) => {
        const created = createdVariants[plan.sourceIndex] || null;
        const verifiedImageUrl = created ? verifiedVariantMediaById.get(created.id) || null : null;
        let status = "no_source_image";
        if (plan.sourceImageUrl) {
          if (!created?.id) {
            status = "variant_not_created";
          } else if (!input.importMedia) {
            status = "media_import_disabled";
          } else if (verifiedImageUrl && urlsLikelyMatch(plan.sourceImageUrl, verifiedImageUrl)) {
            status = "verified";
          } else if (verifiedImageUrl && !urlsLikelyMatch(plan.sourceImageUrl, verifiedImageUrl)) {
            status = "mismatch";
          } else {
            status = "unverified";
          }
        }
        return {
          sourceVariantId: plan.sourceVariantId,
          sourceTitle: plan.sourceTitle,
          sourceImageUrl: plan.sourceImageUrl,
          createdVariantId: created?.id || null,
          createdVariantTitle: created?.title || null,
          verifiedVariantImageUrl: verifiedImageUrl,
          status,
        };
      });

      const mappingSummary = {
        totalVariants: variantMediaMappings.length,
        withSourceImage: variantMediaMappings.filter((row) => !!row.sourceImageUrl).length,
        verified: variantMediaMappings.filter((row) => row.status === "verified").length,
        mismatched: variantMediaMappings.filter((row) => row.status === "mismatch").length,
        unverified: variantMediaMappings.filter((row) => row.status === "unverified").length,
        noSourceImage: variantMediaMappings.filter((row) => row.status === "no_source_image").length,
      };

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
        variantMediaMapping: {
          summary: mappingSummary,
          warning: mediaVerificationWarning,
          mappings: variantMediaMappings,
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
