import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createHazifyToolRegistry } from '../apps/hazify-mcp-remote/src/tools/registry.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  const registry = createHazifyToolRegistry({ getLicenseStatusExecute: async () => {} });
  const tools = registry.tools;
  
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

  const regex = /<!-- BEGIN: TOOLS_LIST -->[\s\S]*<!-- END: TOOLS_LIST -->/;

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
