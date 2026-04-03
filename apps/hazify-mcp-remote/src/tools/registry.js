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
import { listThemeImportTools } from "./listThemeImportTools.js";
import { manageProductOptions } from "./manageProductOptions.js";
import { manageProductVariants } from "./manageProductVariants.js";
import { refundOrder } from "./refundOrder.js";
import { analyzeReferenceUi } from "./analyzeReferenceUi.js";
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

const analyzeReferenceUiOutputSchema = z
  .object({
    success: z.boolean(),
    url: z.string().nullable().optional(),
    selector: z.string().nullable().optional(),
    contentLength: z.number().optional(),
    markup: z.string().optional(),
    referenceSpec: passthroughObject().optional(),
    analysisMode: z.string().optional(),
    fidelityWarnings: z.array(z.string()).optional(),
    sources: z.array(passthroughObject()).optional(),
    sectionPlan: passthroughObject().optional(),
    errorCode: z.string().nullable().optional(),
    retryable: z.boolean().optional(),
    nextAction: passthroughObject().optional(),
    suggestedFiles: z.array(passthroughObject()).optional(),
    requiredInputs: z.array(z.string()).optional(),
    generationHints: z.array(z.string()).optional(),
    usedVisualWorker: z.boolean().optional(),
    fidelityUpgradeApplied: z.boolean().optional(),
    workerWarnings: z.array(z.string()).optional(),
    error: z.string().optional(),
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
  defineToolManifest(getProducts),
  defineToolManifest(getProductById),
  defineToolManifest(getCustomers, { outputSchema: getCustomersOutputSchema }),
  defineToolManifest(getOrders, { outputSchema: getOrdersOutputSchema }),
  defineToolManifest(getOrderById, { outputSchema: getOrderByIdOutputSchema }),
  defineToolManifest(updateOrder, { writeScopeRequired: true, idempotent: false }),
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
  defineToolManifest(getCustomerOrders),
  defineToolManifest(updateCustomer, { writeScopeRequired: true, idempotent: false }),
  defineToolManifest(createProduct, { writeScopeRequired: true, idempotent: false }),
  defineToolManifest(updateProduct, { writeScopeRequired: true, idempotent: false }),
  defineToolManifest(manageProductVariants, { writeScopeRequired: true, idempotent: false }),
  defineToolManifest(manageProductOptions, { writeScopeRequired: true, idempotent: false }),
  defineToolManifest(deleteProduct, {
    writeScopeRequired: true,
    destructive: true,
    idempotent: false,
  }),
  defineToolManifest(deleteProductVariants, {
    writeScopeRequired: true,
    destructive: true,
    idempotent: false,
  }),
  defineToolManifest(refundOrder, {
    writeScopeRequired: true,
    destructive: true,
    idempotent: false,
  }),
  defineToolManifest(cloneProductFromUrl, { writeScopeRequired: true, idempotent: false }),
  defineToolManifest(getThemes),

  defineToolManifest(searchThemeFilesTool, {
    outputSchema: searchThemeFilesOutputSchema,
  }),
  defineToolManifest(getThemeFileTool, { outputSchema: getThemeFileOutputSchema }),
  defineToolManifest(getThemeFilesTool, { outputSchema: getThemeFilesOutputSchema }),

  defineToolManifest(deleteThemeFileTool, {
    writeScopeRequired: true,
    destructive: true,
    idempotent: false,
  }),
  defineToolManifest(verifyThemeFilesTool),
  defineToolManifest(listThemeImportTools, { requiresShopifyClient: false }),
  defineToolManifest(createGetLicenseStatusTool(getLicenseStatusExecute), {
    requiresShopifyClient: false,
    outputSchema: getLicenseStatusOutputSchema,
  }),
  defineToolManifest(analyzeReferenceUi, {
    requiresShopifyClient: false,
    outputSchema: analyzeReferenceUiOutputSchema,
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
