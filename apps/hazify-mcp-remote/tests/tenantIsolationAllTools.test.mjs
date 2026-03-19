import assert from "assert";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { cloneProductFromUrl } from "../src/tools/cloneProductFromUrl.js";
import { createProduct } from "../src/tools/createProduct.js";
import { deleteProduct } from "../src/tools/deleteProduct.js";
import { deleteProductVariants } from "../src/tools/deleteProductVariants.js";
import { deleteThemeFileTool } from "../src/tools/deleteThemeFile.js";
import { getCustomerOrders } from "../src/tools/getCustomerOrders.js";
import { getCustomers } from "../src/tools/getCustomers.js";
import { getOrderById } from "../src/tools/getOrderById.js";
import { getOrders } from "../src/tools/getOrders.js";
import { getProductById } from "../src/tools/getProductById.js";
import { getProducts } from "../src/tools/getProducts.js";
import { getSupportedTrackingCompanies } from "../src/tools/getSupportedTrackingCompanies.js";
import { getThemeFileTool } from "../src/tools/getThemeFile.js";
import { getThemeFilesTool } from "../src/tools/getThemeFiles.js";
import { getThemes } from "../src/tools/getThemes.js";
import { listThemeImportTools } from "../src/tools/listThemeImportTools.js";
import { manageProductOptions } from "../src/tools/manageProductOptions.js";
import { manageProductVariants } from "../src/tools/manageProductVariants.js";
import { refundOrder } from "../src/tools/refundOrder.js";
import { setOrderTracking } from "../src/tools/setOrderTracking.js";
import { updateCustomer } from "../src/tools/updateCustomer.js";
import { updateFulfillmentTracking } from "../src/tools/updateFulfillmentTracking.js";
import { updateOrder } from "../src/tools/updateOrder.js";
import { updateProduct } from "../src/tools/updateProduct.js";
import { upsertThemeFileTool } from "../src/tools/upsertThemeFile.js";
import { upsertThemeFilesTool } from "../src/tools/upsertThemeFiles.js";
import { verifyThemeFilesTool } from "../src/tools/verifyThemeFiles.js";

const shopifyScopedTools = [
  { name: "clone-product-from-url", tool: cloneProductFromUrl, input: { sourceUrl: "https://example.com/products/demo" } },
  { name: "create-product", tool: createProduct, input: { title: "Demo product" } },
  { name: "delete-product", tool: deleteProduct, input: { id: "gid://shopify/Product/1" } },
  {
    name: "delete-product-variants",
    tool: deleteProductVariants,
    input: { productId: "gid://shopify/Product/1", variantIds: ["gid://shopify/ProductVariant/1"] },
  },
  { name: "delete-theme-file", tool: deleteThemeFileTool, input: { key: "sections/demo.liquid" } },
  { name: "get-customer-orders", tool: getCustomerOrders, input: { customerId: "123" } },
  { name: "get-customers", tool: getCustomers, input: {} },
  { name: "get-order-by-id", tool: getOrderById, input: { orderId: "gid://shopify/Order/1" } },
  { name: "get-orders", tool: getOrders, input: {} },
  { name: "get-product-by-id", tool: getProductById, input: { productId: "gid://shopify/Product/1" } },
  { name: "get-products", tool: getProducts, input: {} },
  { name: "get-theme-file", tool: getThemeFileTool, input: { key: "sections/demo.liquid" } },
  { name: "get-theme-files", tool: getThemeFilesTool, input: { keys: ["sections/demo.liquid"] } },
  { name: "get-themes", tool: getThemes, input: {} },
  {
    name: "manage-product-options",
    tool: manageProductOptions,
    input: { productId: "gid://shopify/Product/1", action: "create", options: [{ name: "Size" }] },
  },
  {
    name: "manage-product-variants",
    tool: manageProductVariants,
    input: { productId: "gid://shopify/Product/1", variants: [{ price: "19.95" }] },
  },
  {
    name: "refund-order",
    tool: refundOrder,
    input: {
      orderId: "gid://shopify/Order/1",
      audit: { amount: "19.95", reason: "Damaged", scope: "partial" },
    },
  },
  { name: "set-order-tracking", tool: setOrderTracking, input: { order: "1001", trackingCode: "TRACK-001" } },
  { name: "update-customer", tool: updateCustomer, input: { id: "123" } },
  {
    name: "update-fulfillment-tracking",
    tool: updateFulfillmentTracking,
    input: { orderId: "gid://shopify/Order/1", trackingNumber: "TRACK-001" },
  },
  { name: "update-order", tool: updateOrder, input: { id: "gid://shopify/Order/1" } },
  { name: "update-product", tool: updateProduct, input: { id: "gid://shopify/Product/1" } },
  { name: "upsert-theme-file", tool: upsertThemeFileTool, input: { key: "sections/demo.liquid", value: "<div/>" } },
  {
    name: "upsert-theme-files",
    tool: upsertThemeFilesTool,
    input: { files: [{ key: "sections/demo.liquid", value: "<div/>" }] },
  },
  {
    name: "verify-theme-files",
    tool: verifyThemeFilesTool,
    input: { expected: [{ key: "sections/demo.liquid" }] },
  },
];

for (const entry of shopifyScopedTools) {
  const parsed = entry.tool.schema.parse(entry.input);
  await assert.rejects(
    () => entry.tool.execute(parsed, {}),
    /Missing Shopify client in execution context/,
    `${entry.name} should fail closed without tenant-scoped Shopify client`
  );
}

const carrierResult = await getSupportedTrackingCompanies.execute(
  getSupportedTrackingCompanies.schema.parse({})
);
assert.ok(Array.isArray(carrierResult.returned), "carrier tool should be context-free and return data");

const importToolsResult = await listThemeImportTools.execute(listThemeImportTools.schema.parse({}));
assert.ok(Array.isArray(importToolsResult.tools), "theme import metadata tool should be context-free");
assert.equal(importToolsResult.policy?.remoteMcpExecutesImports, false);

const toolsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src/tools");
const toolFiles = (await fs.readdir(toolsDir))
  .filter((file) => file.endsWith(".js"))
  .map((file) => path.join(toolsDir, file));

const contextFreeFiles = new Set([
  path.join(toolsDir, "_context.js"),
  path.join(toolsDir, "getLicenseStatus.js"),
  path.join(toolsDir, "getSupportedTrackingCompanies.js"),
  path.join(toolsDir, "listThemeImportTools.js"),
  path.join(toolsDir, "registry.js"),
]);

for (const file of toolFiles) {
  const source = await fs.readFile(file, "utf8");
  if (!contextFreeFiles.has(file)) {
    assert.match(
      source,
      /requireShopifyClient/,
      `${path.basename(file)} should use centralized Shopify client guard`
    );
  }
  assert.equal(
    /^let\s+/m.test(source) || /^var\s+/m.test(source),
    false,
    `${path.basename(file)} should not define mutable top-level state`
  );
  assert.equal(
    /(localShopifyClient|remoteShopifyClientCache|tenantToolExecutionLocks)/.test(source),
    false,
    `${path.basename(file)} should not use shared runtime tenant/shopify state`
  );
}

console.log("tenantIsolationAllTools.test.mjs passed");
