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

if (logFile) {
  fs.appendFileSync(logFile, `argv=${JSON.stringify(process.argv.slice(2))}\n`);
}

const SCREENSHOT_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4AWP4DwQACfsD/c8LaHIAAAAASUVORK5CYII=";
const SCREENSHOT_MODE = String(process.env.FAKE_CHROME_SCREENSHOT_MODE || "image").trim().toLowerCase();

const server = new McpServer({
  name: "fake-chrome-provider",
  version: "1.0.0",
});

server.tool(
  "new_page",
  {
    url: z.string(),
  },
  async ({ url }) => {
    logCall("new_page");
    return {
      content: [{ type: "text", text: `Opened ${url}` }],
    };
  }
);

server.tool(
  "emulate",
  {
    viewport: z.string().optional(),
  },
  async () => {
    logCall("emulate");
    return {
      content: [{ type: "text", text: "Emulated viewport" }],
    };
  }
);

server.tool(
  "evaluate_script",
  {
    function: z.string(),
  },
  async ({ function: evaluateFunction }) => {
    logCall("evaluate_script");
    if (logFile) {
      fs.appendFileSync(logFile, `evaluate_script_source=${evaluateFunction}\n`);
    }
    const payload = {
      title: "Fake Example",
      headings: ["Fake heading"],
      paragraphs: ["Fake paragraph"],
      images: ["https://cdn.example.com/fake.png"],
      targetSelector: "section.fake-section",
      styleTokens: {
        body: {
          color: "rgb(0, 0, 0)",
          backgroundColor: "rgb(255, 255, 255)",
          fontFamily: "Arial, sans-serif",
        },
      },
    };

    return {
      content: [
        {
          type: "text",
          text: `Script ran on page and returned:\n\`\`\`json\n${JSON.stringify(payload)}\n\`\`\``,
        },
      ],
    };
  }
);

server.tool("take_snapshot", {}, async () => {
  logCall("take_snapshot");
  return {
    content: [
      {
        type: "text",
        text: "## Latest page snapshot\nuid=1_0 RootWebArea \"Fake Example\"",
      },
    ],
  };
});

server.tool(
  "take_screenshot",
  {
    filePath: z.string().optional(),
  },
  async ({ filePath }) => {
    logCall("take_screenshot");

    if (SCREENSHOT_MODE === "filepath" && filePath) {
      fs.writeFileSync(filePath, Buffer.from(SCREENSHOT_BASE64, "base64"));
      return {
        content: [
          {
            type: "text",
            text: `Screenshot saved to ${filePath}`,
          },
        ],
      };
    }

    return {
      content: [
        { type: "text", text: "Screenshot captured" },
        { type: "image", data: SCREENSHOT_BASE64, mimeType: "image/png" },
      ],
    };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
