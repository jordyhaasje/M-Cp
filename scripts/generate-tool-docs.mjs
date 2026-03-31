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
  
  const targetFile = path.resolve(__dirname, '../AGENTS.md');
  let content = fs.readFileSync(targetFile, 'utf8');
  
  const regex = /<!-- BEGIN: TOOLS_LIST -->[\s\S]*<!-- END: TOOLS_LIST -->/;
  if (regex.test(content)) {
    content = content.replace(regex, markdownList);
    fs.writeFileSync(targetFile, content, 'utf8');
    console.log('Successfully updated AGENTS.md with tool documentation.');
  } else {
    console.error('Could not find <!-- BEGIN: TOOLS_LIST --> and <!-- END: TOOLS_LIST --> markers in AGENTS.md.');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
