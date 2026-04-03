import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createHazifyToolRegistry } from '../apps/hazify-mcp-remote/src/tools/registry.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  const registry = createHazifyToolRegistry({ getLicenseStatusExecute: async () => {} });
  const tools = [...registry.tools];
  
  // Sort tools alphabetically
  tools.sort((a, b) => a.name.localeCompare(b.name));
  
  let markdownList = `<!-- BEGIN: TOOLS_LIST -->\n`;
  for (const tool of tools) {
    markdownList += `- **\`${tool.name}\`**: ${tool.description}\n`;
  }
  markdownList += `<!-- END: TOOLS_LIST -->`;
  
  const targetFiles = [
    path.resolve(__dirname, '../AGENTS.md'),
    path.resolve(__dirname, '../docs/02-SYSTEM-FLOW.md')
  ];
  const archiveDir = path.resolve(__dirname, '../docs/archive');
  const artifactsDir = path.resolve(__dirname, '../docs/archive/artifacts');
  const manifestPath = path.resolve(artifactsDir, 'tool-manifest.json');
  const workflowManifestPath = path.resolve(artifactsDir, 'section-workflow-truth.json');

  const regex = /<!-- BEGIN: TOOLS_LIST -->[\s\S]*<!-- END: TOOLS_LIST -->/;

  fs.mkdirSync(archiveDir, { recursive: true });
  fs.mkdirSync(artifactsDir, { recursive: true });

  const manifest = {
    generatedAt: new Date().toISOString(),
    tools: tools.map((tool) => ({
      name: tool.name,
      canonicalName: tool.canonicalName || tool.name,
      description: tool.description,
      requiresShopifyClient: tool.requiresShopifyClient !== false,
      writeScopeRequired: Boolean(tool.writeScopeRequired),
      annotations: tool.annotations || null,
    })),
  };
  const workflowManifest = {
    generatedAt: new Date().toISOString(),
    workflows: {
      newSectionFromReference: {
        label: "Nieuwe section uit reference",
        tools: ["analyze-reference-ui", "draft-theme-artifact"],
        description:
          "Gebruik deze flow voor een nieuwe section op basis van een reference URL en optionele image hints. Vermijd extra read-tools tenzij de gebruiker expliciet een bestaand bestand wil wijzigen.",
      },
      existingThemeEdit: {
        label: "Bestaande theme edit",
        tools: ["search-theme-files", "get-theme-file", "draft-theme-artifact"],
        description:
          "Gebruik deze flow wanneer de gebruiker een bestaand bestand of bestaande section in het theme wil aanpassen.",
      },
    },
    policies: {
      defaultFileStrategy: "single-section-file",
      imageOnlyCloneSupported: false,
      automaticTemplatePlacement: false,
      visualWorkerMode: "url-first-fallback",
      noLiquidInStylesheetOrJavascript: true,
    },
  };
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  console.log(`Successfully updated ${path.relative(path.resolve(__dirname, '..'), manifestPath)}.`);
  fs.writeFileSync(workflowManifestPath, JSON.stringify(workflowManifest, null, 2) + '\n', 'utf8');
  console.log(`Successfully updated ${path.relative(path.resolve(__dirname, '..'), workflowManifestPath)}.`);

  for (const targetFile of targetFiles) {
    if (!fs.existsSync(targetFile)) {
      console.warn(`File not found: ${targetFile}, skipping.`);
      continue;
    }
    let content = fs.readFileSync(targetFile, 'utf8');
    if (regex.test(content)) {
      content = content.replace(regex, markdownList);
      fs.writeFileSync(targetFile, content, 'utf8');
      console.log(`Successfully updated ${path.basename(targetFile)} with tool documentation.`);
    } else {
      console.warn(`Could not find <!-- BEGIN: TOOLS_LIST --> and <!-- END: TOOLS_LIST --> markers in ${path.basename(targetFile)}.`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
