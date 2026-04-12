import assert from "assert";
import { createHazifyToolRegistry, registerHazifyTools } from "../src/tools/registry.js";

const registry = createHazifyToolRegistry({
  getLicenseStatusExecute: async () => ({
    license: {},
    access: {},
    tenant: {},
    server: {},
  }),
});

assert.equal(
  registry.canonicalTools.length,
  new Set(registry.canonicalTools.map((tool) => tool.name)).size,
  "canonical tool names should be unique"
);

const fakeServerRegistrations = [];
registerHazifyTools(
  {
    registerTool(name, definition) {
      fakeServerRegistrations.push({ name, definition });
    },
  },
  registry,
  async () => ({ content: [], structuredContent: {}, isError: false })
);

assert.deepEqual(
  fakeServerRegistrations.map((entry) => entry.name),
  registry.tools.map((tool) => tool.name),
  "registered tool list should come from the shared registry source"
);

const getOrdersDefinition = registry.byName.get("get-orders");
const parsedGetOrders = getOrdersDefinition.inputSchema.parse({ cursor: "cursor_123" });
assert.equal(parsedGetOrders.cursor, "cursor_123", "get-orders should expose cursor in the public contract");
assert.equal(parsedGetOrders.limit, 50, "get-orders should use the canonical default limit");

assert.strictEqual(
  registry.byName.get("update-order-tracking").inputSchema,
  registry.byName.get("set-order-tracking").inputSchema,
  "tracking alias should reuse the canonical set-order-tracking schema"
);

for (const criticalToolName of [
  "apply-theme-draft",
  "get-orders",
  "get-order-by-id",
  "get-customers",
  "get-theme-file",
  "get-theme-files",
  "get-license-status",
  "set-order-tracking",
  "update-fulfillment-tracking",
]) {
  assert.ok(
    registry.byName.get(criticalToolName)?.outputSchema,
    `${criticalToolName} should expose an outputSchema`
  );
}

for (const expectedToolName of [
  "apply-theme-draft",
  "draft-theme-artifact",
  "patch-theme-file",
  "search-theme-files",
]) {
  assert.ok(registry.byName.has(expectedToolName), `${expectedToolName} should be present in the shared registry`);
}

assert.equal(
  registry.byName.get("draft-theme-artifact").title,
  "Draft Theme Artifact",
  "registry should expose human-friendly tool titles"
);

registry.byName.get("manage-product-variants").outputSchema.parse({
  created: [
    {
      id: "gid://shopify/ProductVariant/1",
      title: "Small",
    },
  ],
  updated: [],
});

registry.byName.get("delete-product-variants").outputSchema.parse({
  product: {
    id: "gid://shopify/Product/1",
    title: "Demo product",
    remainingVariants: [],
  },
});
