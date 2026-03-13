import { z } from "zod";

const ListThemeImportToolsInputSchema = z.object({});

const EXTERNAL_THEME_IMPORT_TOOLS = [
  {
    name: "chrome_mcp_theme_review",
    description:
      "Use local Chrome MCP for visual QA and DOM/theme validation before or after section import.",
    location: "local_chrome_mcp",
    executesImport: false,
    advisoryOnly: true,
  },
  {
    name: "shopify_dev_import_section",
    description:
      "Use local Shopify Dev MCP to import generated sections into a Shopify theme.",
    location: "local_shopify_dev_mcp",
    executesImport: false,
    advisoryOnly: true,
  },
];

const listThemeImportTools = {
  name: "list_theme_import_tools",
  description:
    "List metadata/advice for external tools used outside this remote MCP to review or import Shopify theme sections.",
  schema: ListThemeImportToolsInputSchema,
  execute: async () => {
    return {
      policy: {
        remoteMcpExecutesImports: false,
        notes: [
          "Remote Hazify MCP supports theme file read/update/delete only.",
          "Section import pipelines must run in external tooling (for example local Chrome MCP or Shopify Dev MCP).",
        ],
      },
      tools: EXTERNAL_THEME_IMPORT_TOOLS,
    };
  },
};

export { listThemeImportTools };
