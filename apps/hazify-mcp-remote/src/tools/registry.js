import { z } from "zod";
import { cloneProductFromUrl } from "./cloneProductFromUrl.js";
import { createThemeSectionTool } from "./createThemeSection.js";
import { createProduct } from "./createProduct.js";
import { deleteProduct } from "./deleteProduct.js";
import { deleteProductVariants } from "./deleteProductVariants.js";
import { deleteThemeFileTool } from "./deleteThemeFile.js";
import { findThemeSectionByNameTool } from "./findThemeSectionByName.js";
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
import { resolveTemplateSectionsTool } from "./resolveTemplateSections.js";
import { searchThemeFilesTool } from "./searchThemeFiles.js";
import { setOrderTracking } from "./setOrderTracking.js";
import { updateCustomer } from "./updateCustomer.js";
import { updateFulfillmentTracking } from "./updateFulfillmentTracking.js";
import { updateOrder } from "./updateOrder.js";
import { updateProduct } from "./updateProduct.js";
import { upsertThemeFileTool } from "./upsertThemeFile.js";
import { upsertThemeFilesTool } from "./upsertThemeFiles.js";
import { verifyThemeFilesTool } from "./verifyThemeFiles.js";

const passthroughObject = () => z.object({}).passthrough();
const nullableString = () => z.string().nullable();
const themeRoleSchema = z.enum(["main", "unpublished", "demo", "development"]);
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

const resolveTemplateSectionsOutputSchema = z
  .object({
    theme: themeSummarySchema,
    pageType: z.string(),
    sourceFiles: z.array(
      z
        .object({
          key: z.string(),
          kind: z.string(),
          found: z.boolean(),
          used: z.boolean(),
        })
        .passthrough()
    ),
    sections: z.array(
      z
        .object({
          instanceId: z.string(),
          type: z.string(),
          displayTitle: z.string().nullable(),
          schemaName: z.string().nullable(),
          presetNames: z.array(z.string()),
          sectionFile: z.string().nullable(),
          originFile: z.string(),
          position: z.number(),
          confidence: z.number(),
        })
        .passthrough()
    ),
    notes: z.array(z.string()),
  })
  .passthrough();

const resolveHomepageSectionsInputSchema = z.object({
  themeId: z.coerce.number().int().positive().optional().describe("Optional explicit Shopify theme ID"),
  themeRole: themeRoleSchema.default("main").describe("Theme role fallback when themeId is omitted"),
  page: z.literal("homepage").default("homepage"),
});

const resolveHomepageSectionsOutputSchema = resolveTemplateSectionsOutputSchema
  .extend({
    page: z.literal("homepage"),
  })
  .passthrough();

const findThemeSectionByNameOutputSchema = z
  .object({
    query: z.string(),
    exactMatches: z.array(passthroughObject()),
    fuzzyMatches: z.array(passthroughObject()),
    confidence: z.number(),
    lookupOnly: z.boolean(),
    recommendedFlow: z.enum(["edit_existing", "create_new"]),
    creationSuggested: z.boolean(),
    relevantFiles: z.array(z.string()),
    nextSteps: z.array(z.string()),
  })
  .passthrough();

const createThemeSectionOutputSchema = z
  .object({
    theme: themeSummarySchema,
    targetFile: z.string(),
    sectionFile: z.string(),
    sectionInstanceId: z.string(),
    placement: z.enum(["append", "prepend", "before", "after"]),
    createdFiles: z.array(z.string()),
    verifySummary: passthroughObject().nullable().optional(),
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
  defineToolManifest(createThemeSectionTool, {
    writeScopeRequired: true,
    idempotent: false,
    outputSchema: createThemeSectionOutputSchema,
  }),
  defineToolManifest(resolveTemplateSectionsTool, {
    outputSchema: resolveTemplateSectionsOutputSchema,
  }),
  defineToolManifest(findThemeSectionByNameTool, {
    outputSchema: findThemeSectionByNameOutputSchema,
  }),
  defineToolManifest(searchThemeFilesTool, {
    outputSchema: searchThemeFilesOutputSchema,
  }),
  defineToolManifest(getThemeFileTool, { outputSchema: getThemeFileOutputSchema }),
  defineToolManifest(getThemeFilesTool, { outputSchema: getThemeFilesOutputSchema }),
  defineToolManifest(upsertThemeFileTool, { writeScopeRequired: true, idempotent: false }),
  defineToolManifest(upsertThemeFilesTool, { writeScopeRequired: true, idempotent: false }),
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
];

const buildAliasToolDefinitions = (canonicalDefinitions) => {
  const canonicalMap = new Map(canonicalDefinitions.map((tool) => [tool.name, tool]));
  const setOrderTrackingManifest = canonicalMap.get("set-order-tracking");
  const resolveTemplateSectionsManifest = canonicalMap.get("resolve-template-sections");
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
    defineAliasManifest("resolve-homepage-sections", resolveTemplateSectionsManifest, {
      description:
        "Legacy alias of resolve-template-sections limited to the homepage. Kept for compatibility.",
      inputSchema: resolveHomepageSectionsInputSchema,
      outputSchema: resolveHomepageSectionsOutputSchema,
      execute: async (input, context = {}) => {
        const result = await resolveTemplateSectionsManifest.execute(
          { themeId: input.themeId, themeRole: input.themeRole, pageType: "homepage" },
          context
        );
        return {
          ...result,
          page: "homepage",
          pageType: "homepage",
        };
      },
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
  createAnnotations,
  defineToolManifest,
  registerHazifyTools,
};
