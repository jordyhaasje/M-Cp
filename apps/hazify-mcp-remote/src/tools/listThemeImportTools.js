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
    "List metadata/advice for external tools used outside this remote MCP for visual review or external import workflows. Do not use this for normal native section creation inside the remote MCP.",
  schema: ListThemeImportToolsInputSchema,
  execute: async () => {
    return {
      policy: {
        remoteMcpExecutesImports: false,
        notes: [
          "Remote Hazify MCP now supports native theme file CRUD plus OS 2.0 section creation/placement in supported JSON targets.",
          "Use this tool only when you explicitly need metadata about external review/import workflows (for example local Chrome MCP or Shopify Dev MCP).",
        ],
      },
      tools: EXTERNAL_THEME_IMPORT_TOOLS,
    };
  },
};

export { listThemeImportTools };
