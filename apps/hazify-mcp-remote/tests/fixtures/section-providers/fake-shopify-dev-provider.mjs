#!/usr/bin/env node
import fs from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const logFile = String(process.env.FAKE_PROVIDER_LOG_FILE || "").trim();
const logCall = (name) => {
  if (!logFile) {
    return;
  }
  fs.appendFileSync(logFile, `${name}\n`);
};

const server = new McpServer({
  name: "fake-shopify-dev-provider",
  version: "1.0.0",
});

server.tool(
  "learn_shopify_api",
  {
    api: z.string(),
    conversationId: z.string().optional(),
  },
  async () => {
    logCall("learn_shopify_api");
    return {
      content: [
        {
          type: "text",
          text: "🔗 IMPORTANT - SAVE THIS CONVERSATION ID: 11111111-2222-3333-4444-555555555555",
        },
      ],
    };
  }
);

server.tool(
  "validate_theme",
  {
    conversationId: z.string(),
    absoluteThemePath: z.string(),
    filesCreatedOrUpdated: z.array(
      z.object({
        path: z.string(),
        artifactId: z.string().optional(),
        revision: z.number().optional(),
      })
    ),
  },
  async () => {
    logCall("validate_theme");

    if (String(process.env.FAKE_SHOPIFY_VALIDATE_FAIL || "").trim() === "1") {
      return {
        content: [
          {
            type: "text",
            text: "## Validation Summary\n\n**Overall Status:** ❌ INVALID\n",
          },
        ],
      };
    }

    return {
      content: [
        {
          type: "text",
          text: "## Validation Summary\n\n**Overall Status:** ✅ VALID\n",
        },
      ],
    };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
