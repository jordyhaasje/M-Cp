import { z } from "zod";

const ListThemeImportToolsInputSchema = z.object({});

const EXTERNAL_THEME_IMPORT_TOOLS = [
  {
    name: "shopify_dev_import_section",
    description:
      "Imports a generated section into a Shopify theme using the Shopify Dev MCP",
    location: "local_shopify_dev_mcp",
  },
];

const listThemeImportTools = {
  name: "list_theme_import_tools",
  description:
    "List metadata for external tools that can import Shopify theme sections.",
  schema: ListThemeImportToolsInputSchema,
  execute: async () => {
    return {
      tools: EXTERNAL_THEME_IMPORT_TOOLS,
    };
  },
};

export { listThemeImportTools };
