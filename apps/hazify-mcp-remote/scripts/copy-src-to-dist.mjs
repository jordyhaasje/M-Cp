import fs from "fs/promises";
import path from "path";

const [fromArg, toArg] = process.argv.slice(2);

if (!fromArg || !toArg) {
  console.error("Usage: node scripts/copy-src-to-dist.mjs <sourceDir> <targetDir>");
  process.exit(1);
}

const sourceDir = path.resolve(process.cwd(), fromArg);
const targetDir = path.resolve(process.cwd(), toArg);

await fs.access(sourceDir);
await fs.rm(targetDir, { recursive: true, force: true });
await fs.mkdir(path.dirname(targetDir), { recursive: true });
await fs.cp(sourceDir, targetDir, { recursive: true, force: true });
