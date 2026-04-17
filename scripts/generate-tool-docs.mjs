import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createHazifyToolRegistry } from "../apps/hazify-mcp-remote/src/tools/registry.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  const registry = createHazifyToolRegistry({ getLicenseStatusExecute: async () => {} });
  const tools = [...registry.tools].sort((a, b) => a.name.localeCompare(b.name));

  let markdownList = "<!-- BEGIN: TOOLS_LIST -->\n";
  for (const tool of tools) {
    markdownList += `- **\`${tool.name}\`**: ${tool.docsDescription || tool.description}\n`;
  }
  markdownList += "<!-- END: TOOLS_LIST -->";

  const workflowManifest = {
    generatedAt: new Date().toISOString(),
    workflows: {
      existingThemeEdit: {
        label: "Bestaande theme edit",
        tools: ["search-theme-files", "get-theme-file", "draft-theme-artifact"],
        description:
          "Gebruik deze flow wanneer de gebruiker een bestaand bestand of bestaande section in het theme wil aanpassen.",
      },
    },
    policies: {
      defaultFileStrategy: "single-section-file",
      automaticTemplatePlacement: false,
      noLiquidInStylesheetOrJavascript: true,
    },
  };

  const targetFiles = [
    path.resolve(__dirname, "../AGENTS.md"),
    path.resolve(__dirname, "../docs/02-SYSTEM-FLOW.md"),
  ];
  const regex = /<!-- BEGIN: TOOLS_LIST -->[\s\S]*<!-- END: TOOLS_LIST -->/;

  for (const targetFile of targetFiles) {
    if (!fs.existsSync(targetFile)) {
      console.warn(`File not found: ${targetFile}, skipping.`);
      continue;
    }

    let content = fs.readFileSync(targetFile, "utf8");
    if (regex.test(content)) {
      content = content.replace(regex, markdownList);
      fs.writeFileSync(targetFile, content, "utf8");
      console.log(`Successfully updated ${path.basename(targetFile)} with tool documentation.`);
      continue;
    }

    console.warn(
      `Could not find <!-- BEGIN: TOOLS_LIST --> and <!-- END: TOOLS_LIST --> markers in ${path.basename(targetFile)}.`
    );
  }

  console.log(
    `Documentation workflow truth prepared for '${workflowManifest.workflows.existingThemeEdit.label}'.`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
