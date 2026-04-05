import { z } from "zod";
import { cloneProductFromUrl } from "./cloneProductFromUrl.js";
import { createProduct } from "./createProduct.js";
import { deleteProduct } from "./deleteProduct.js";
import { deleteProductVariants } from "./deleteProductVariants.js";
import { deleteThemeFileTool } from "./deleteThemeFile.js";
import { applyThemeDraft } from "./applyThemeDraft.js";
import { draftThemeArtifact } from "./draftThemeArtifact.js";

import { getCustomerOrders } from "./getCustomerOrders.js";
import { getCustomers } from "./getCustomers.js";
import { createGetLicenseStatusTool } from "./getLicenseStatus.js";
import { getOrderById } from "./getOrderById.js";
import { getOrders } from "./getOrders.js";
import { getProductById } from "./getProductById.js";
import { getProducts } from "./getProducts.js";
import { getSupportedTrackingCompanies } from "./getSupportedTrackingCompanies.js";
import { getThemeFileTool } from "./getThemeFile.js";
import { getThemeFilesTool } from "./getThemeFiles.js";
import { getThemes } from "./getThemes.js";
import { manageProductOptions } from "./manageProductOptions.js";
import { manageProductVariants } from "./manageProductVariants.js";
import { refundOrder } from "./refundOrder.js";
import { searchThemeFilesTool } from "./searchThemeFiles.js";
import { setOrderTracking } from "./setOrderTracking.js";
import { updateCustomer } from "./updateCustomer.js";
import { updateFulfillmentTracking } from "./updateFulfillmentTracking.js";
import { updateOrder } from "./updateOrder.js";
import { updateProduct } from "./updateProduct.js";
import { verifyThemeFilesTool } from "./verifyThemeFiles.js";

const passthroughObject = () => z.object({}).passthrough();
const nullableString = () => z.string().nullable();
const moneySchema = z
  .object({
    amount: z.string(),
    currencyCode: z.string(),
  })
  .passthrough();
const themeSummarySchema = z
  .object({
    id: z.number(),
    name: z.string().nullable(),
    role: z.string().nullable(),
  })
  .passthrough();

const getOrdersOutputSchema = z
  .object({
    orders: z.array(
      z
        .object({
          id: z.string(),
          name: z.string(),
          cursor: z.string(),
          totalPrice: moneySchema.optional(),
        })
        .passthrough()
    ),
    pagination: z
      .object({
        requestedLimit: z.number(),
        appliedLimit: z.number(),
        hasNextPage: z.boolean(),
        nextCursor: nullableString(),
      })
      .passthrough(),
  })
  .passthrough();

const getOrderByIdOutputSchema = z
  .object({
    order: z
      .object({
        id: z.string(),
        name: z.string(),
        tracking: z
          .object({
            sourceOfTruth: z.string(),
            shipments: z.array(passthroughObject()),
          })
          .passthrough(),
      })
      .passthrough(),
  })
  .passthrough();

const getCustomersOutputSchema = z
  .object({
    customers: z.array(
      z
        .object({
          id: z.string(),
          email: z.string().nullable().optional(),
        })
        .passthrough()
    ),
  })
  .passthrough();

const getThemeFileOutputSchema = z
  .object({
    theme: themeSummarySchema,
    asset: z
      .object({
        key: z.string(),
        found: z.boolean(),
        missing: z.boolean(),
      })
      .passthrough(),
  })
  .passthrough();

const getThemeFilesOutputSchema = z
  .object({
    theme: themeSummarySchema,
    files: z.array(
      z
        .object({
          key: z.string(),
          found: z.boolean(),
          missing: z.boolean(),
        })
        .passthrough()
    ),
  })
  .passthrough();

const getLicenseStatusOutputSchema = z
  .object({
    license: passthroughObject(),
    access: passthroughObject(),
    tenant: passthroughObject(),
    server: passthroughObject(),
  })
  .passthrough();

const updateFulfillmentTrackingOutputSchema = z
  .object({
    order: z
      .object({
        id: z.string(),
        name: z.string(),
      })
      .passthrough(),
    resolvedOrder: passthroughObject(),
    action: z.string(),
    previousTracking: z.array(passthroughObject()),
    updatedTracking: z.array(passthroughObject()),
    carrierInput: z.string().nullable(),
    carrierResolved: z.string().nullable(),
    carrierIsShopifySupported: z.boolean().nullable(),
  })
  .passthrough();

const setOrderTrackingOutputSchema = z
  .object({
    order: z
      .object({
        id: z.string(),
        name: z.string(),
      })
      .passthrough(),
    action: z.string(),
    request: z
      .object({
        order: z.string(),
        trackingCode: z.string(),
      })
      .passthrough(),
    verification: z
      .object({
        success: z.boolean(),
        orderId: z.string(),
        orderName: z.string(),
        shipment: passthroughObject(),
      })
      .passthrough(),
  })
  .passthrough();

const searchThemeFilesOutputSchema = z
  .object({
    theme: themeSummarySchema,
    query: z.string(),
    mode: z.enum(["literal", "regex"]),
    filePatterns: z.array(z.string()),
    hits: z.array(
      z
        .object({
          key: z.string(),
          snippets: z.array(z.string()),
        })
        .passthrough()
    ),
    truncated: z.boolean(),
  })
  .passthrough();

const draftThemeArtifactOutputSchema = z
  .object({
    success: z.boolean(),
    status: z.string(),
    draftId: z.string().optional(),
    themeId: z.union([z.number(), z.string()]).nullable().optional(),
    editorUrl: z.string().nullable().optional(),
    message: z.string(),
    verify: passthroughObject().optional(),
    target: passthroughObject().optional(),
    warnings: z.array(z.string()).optional(),
    draft: passthroughObject().optional(),
    errors: z.array(passthroughObject()).optional(),
    errorCode: z.string().optional(),
    retryable: z.boolean().optional(),
    suggestedFixes: z.array(z.string()).optional(),
    shouldNarrowScope: z.boolean().optional(),
  })
  .passthrough();

const applyThemeDraftOutputSchema = z
  .object({
    success: z.boolean(),
    status: z.string(),
    draftId: z.string(),
    theme: passthroughObject().nullable().optional(),
    verify: passthroughObject().optional(),
    message: z.string(),
    editorUrl: z.string().nullable().optional(),
    draft: passthroughObject().nullable().optional(),
  })
  .passthrough();

const getProductsOutputSchema = z
  .object({
    products: z.array(
      z.object({ id: z.string(), title: z.string() }).passthrough()
    ),
  })
  .passthrough();

const getProductByIdOutputSchema = z
  .object({
    product: z.object({ id: z.string(), title: z.string() }).passthrough(),
  })
  .passthrough();

const productMutationOutputSchema = z
  .object({
    product: z.object({ id: z.string(), title: z.string() }).passthrough(),
  })
  .passthrough();

const deleteProductOutputSchema = z
  .object({ deletedProductId: z.string() })
  .passthrough();

const deleteProductVariantsOutputSchema = z
  .object({ deletedVariantIds: z.array(z.string()) })
  .passthrough();

const updateOrderOutputSchema = z
  .object({
    order: z.object({ id: z.string(), name: z.string() }).passthrough(),
    resolvedOrder: passthroughObject(),
  })
  .passthrough();

const getCustomerOrdersOutputSchema = z
  .object({
    orders: z.array(
      z.object({ id: z.string(), name: z.string() }).passthrough()
    ),
  })
  .passthrough();

const updateCustomerOutputSchema = z
  .object({
    customer: z.object({ id: z.string() }).passthrough(),
  })
  .passthrough();

const manageProductVariantsOutputSchema = z
  .object({
    variants: z.array(
      z.object({ id: z.string() }).passthrough()
    ),
  })
  .passthrough();

const manageProductOptionsOutputSchema = z
  .object({
    product: z.object({ id: z.string() }).passthrough(),
  })
  .passthrough();

const refundOrderOutputSchema = z
  .object({
    refund: z.object({ id: z.string() }).passthrough(),
    order: z.object({ id: z.string(), name: z.string() }).passthrough().nullable(),
    resolvedOrder: passthroughObject(),
    audit: passthroughObject(),
  })
  .passthrough();

const cloneProductOutputSchema = z
  .object({
    product: z.object({ id: z.string(), title: z.string() }).passthrough(),
  })
  .passthrough();

const getThemesOutputSchema = z
  .object({
    themes: z.array(themeSummarySchema),
  })
  .passthrough();

const deleteThemeFileOutputSchema = z
  .object({
    action: z.literal("deleted"),
    theme: themeSummarySchema,
    deletedKey: z.string(),
  })
  .passthrough();

const verifyThemeFilesOutputSchema = z
  .object({
    theme: themeSummarySchema,
    results: z.array(passthroughObject()),
    summary: passthroughObject(),
  })
  .passthrough();

const createAnnotations = ({ writeScopeRequired = false, destructive = false, idempotent } = {}) => ({
  readOnlyHint: !writeScopeRequired,
  destructiveHint: destructive,
  idempotentHint: typeof idempotent === "boolean" ? idempotent : !writeScopeRequired,
});

const defineToolManifest = (tool, options = {}) => ({
  name: tool.name,
  canonicalName: options.canonicalName || tool.name,
  description: options.description || tool.description,
  inputSchema: options.inputSchema || tool.inputSchema || tool.schema || z.object({}),
  ...(options.outputSchema ? { outputSchema: options.outputSchema } : {}),
  annotations: options.annotations || createAnnotations(options),
  requiresShopifyClient:
    typeof options.requiresShopifyClient === "boolean" ? options.requiresShopifyClient : true,
  writeScopeRequired: Boolean(options.writeScopeRequired),
  execute: options.execute || tool.execute,
});

const defineAliasManifest = (name, sourceTool, options = {}) =>
  defineToolManifest(
    {
      ...sourceTool,
      name,
      description: options.description || sourceTool.description,
    },
    {
      ...options,
      canonicalName: sourceTool.name,
    }
  );

const buildCanonicalToolDefinitions = ({ getLicenseStatusExecute }) => [
  defineToolManifest(getProducts, { outputSchema: getProductsOutputSchema }),
  defineToolManifest(getProductById, { outputSchema: getProductByIdOutputSchema }),
  defineToolManifest(getCustomers, { outputSchema: getCustomersOutputSchema }),
  defineToolManifest(getOrders, { outputSchema: getOrdersOutputSchema }),
  defineToolManifest(getOrderById, { outputSchema: getOrderByIdOutputSchema }),
  defineToolManifest(updateOrder, {
    writeScopeRequired: true,
    idempotent: false,
    outputSchema: updateOrderOutputSchema,
  }),
  defineToolManifest(updateFulfillmentTracking, {
    writeScopeRequired: true,
    idempotent: false,
    outputSchema: updateFulfillmentTrackingOutputSchema,
  }),
  defineToolManifest(setOrderTracking, {
    writeScopeRequired: true,
    idempotent: false,
    outputSchema: setOrderTrackingOutputSchema,
  }),
  defineToolManifest(getSupportedTrackingCompanies, { requiresShopifyClient: false }),
  defineToolManifest(getCustomerOrders, { outputSchema: getCustomerOrdersOutputSchema }),
  defineToolManifest(updateCustomer, {
    writeScopeRequired: true,
    idempotent: false,
    outputSchema: updateCustomerOutputSchema,
  }),
  defineToolManifest(createProduct, {
    writeScopeRequired: true,
    idempotent: false,
    outputSchema: productMutationOutputSchema,
  }),
  defineToolManifest(updateProduct, {
    writeScopeRequired: true,
    idempotent: false,
    outputSchema: productMutationOutputSchema,
  }),
  defineToolManifest(manageProductVariants, {
    writeScopeRequired: true,
    idempotent: false,
    outputSchema: manageProductVariantsOutputSchema,
  }),
  defineToolManifest(manageProductOptions, {
    writeScopeRequired: true,
    idempotent: false,
    outputSchema: manageProductOptionsOutputSchema,
  }),
  defineToolManifest(deleteProduct, {
    writeScopeRequired: true,
    destructive: true,
    idempotent: false,
    outputSchema: deleteProductOutputSchema,
  }),
  defineToolManifest(deleteProductVariants, {
    writeScopeRequired: true,
    destructive: true,
    idempotent: false,
    outputSchema: deleteProductVariantsOutputSchema,
  }),
  defineToolManifest(refundOrder, {
    writeScopeRequired: true,
    destructive: true,
    idempotent: false,
    outputSchema: refundOrderOutputSchema,
  }),
  defineToolManifest(cloneProductFromUrl, {
    writeScopeRequired: true,
    idempotent: false,
    outputSchema: cloneProductOutputSchema,
  }),
  defineToolManifest(getThemes, { outputSchema: getThemesOutputSchema }),

  defineToolManifest(searchThemeFilesTool, {
    outputSchema: searchThemeFilesOutputSchema,
  }),
  defineToolManifest(getThemeFileTool, { outputSchema: getThemeFileOutputSchema }),
  defineToolManifest(getThemeFilesTool, { outputSchema: getThemeFilesOutputSchema }),

  defineToolManifest(deleteThemeFileTool, {
    writeScopeRequired: true,
    destructive: true,
    idempotent: false,
    outputSchema: deleteThemeFileOutputSchema,
  }),
  defineToolManifest(verifyThemeFilesTool, { outputSchema: verifyThemeFilesOutputSchema }),
  defineToolManifest(createGetLicenseStatusTool(getLicenseStatusExecute), {
    requiresShopifyClient: false,
    outputSchema: getLicenseStatusOutputSchema,
  }),
  defineToolManifest(draftThemeArtifact, {
    writeScopeRequired: true,
    idempotent: false,
    outputSchema: draftThemeArtifactOutputSchema,
  }),
  defineToolManifest(applyThemeDraft, {
    writeScopeRequired: true,
    idempotent: false,
    outputSchema: applyThemeDraftOutputSchema,
  }),
];

const buildAliasToolDefinitions = (canonicalDefinitions) => {
  const canonicalMap = new Map(canonicalDefinitions.map((tool) => [tool.name, tool]));
  const setOrderTrackingManifest = canonicalMap.get("set-order-tracking");
  return [
    defineAliasManifest("update-order-tracking", setOrderTrackingManifest, {
      description: "Alias of set-order-tracking. Kept for compatibility.",
      writeScopeRequired: true,
      idempotent: false,
      outputSchema: setOrderTrackingOutputSchema,
    }),
    defineAliasManifest("add-tracking-to-order", setOrderTrackingManifest, {
      description: "Alias of set-order-tracking. Kept for compatibility.",
      writeScopeRequired: true,
      idempotent: false,
      outputSchema: setOrderTrackingOutputSchema,
    }),
  ];
};

const createHazifyToolRegistry = ({ getLicenseStatusExecute }) => {
  const canonicalTools = buildCanonicalToolDefinitions({ getLicenseStatusExecute });
  const tools = [...canonicalTools, ...buildAliasToolDefinitions(canonicalTools)];
  const byName = new Map(tools.map((tool) => [tool.name, tool]));
  return {
    canonicalTools,
    tools,
    byName,
  };
};

const registerHazifyTools = (server, registry, executeTool) => {
  for (const tool of registry.tools) {
    const definition = {
      description: tool.description,
      inputSchema: tool.inputSchema,
      annotations: tool.annotations,
      ...(tool.outputSchema ? { outputSchema: tool.outputSchema } : {}),
    };
    server.registerTool(tool.name, definition, async (args) => executeTool(tool, args));
  }
};

export {
  createHazifyToolRegistry,
  registerHazifyTools,
};
