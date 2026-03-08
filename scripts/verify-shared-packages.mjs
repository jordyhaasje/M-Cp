import fs from "fs/promises";
import path from "path";

const rootDir = process.cwd();
const sharedPackages = ["mcp-common", "shopify-core"];
const appDirs = ["apps/hazify-license-service", "apps/hazify-mcp-remote"];

async function listFilesRecursively(baseDir) {
  const entries = await fs.readdir(baseDir, { withFileTypes: true });
  const result = [];

  for (const entry of entries) {
    const entryPath = path.join(baseDir, entry.name);
    if (entry.isDirectory()) {
      const nested = await listFilesRecursively(entryPath);
      result.push(...nested.map((relativePath) => path.join(entry.name, relativePath)));
      continue;
    }
    if (entry.isFile()) {
      result.push(entry.name);
    }
  }

  return result.sort();
}

function diffLists(expected, actual) {
  const expectedSet = new Set(expected);
  const actualSet = new Set(actual);
  const missing = expected.filter((item) => !actualSet.has(item));
  const extra = actual.filter((item) => !expectedSet.has(item));
  return { missing, extra };
}

let hasMismatch = false;

for (const packageName of sharedPackages) {
  const sourceDir = path.join(rootDir, "packages", packageName);
  const sourceFiles = await listFilesRecursively(sourceDir);

  for (const appDir of appDirs) {
    const targetDir = path.join(rootDir, appDir, "packages", packageName);
    const targetFiles = await listFilesRecursively(targetDir);
    const { missing, extra } = diffLists(sourceFiles, targetFiles);

    if (missing.length > 0 || extra.length > 0) {
      hasMismatch = true;
      console.error(`\nMismatch in ${appDir}/packages/${packageName}`);
      if (missing.length > 0) {
        console.error(`  missing files: ${missing.join(", ")}`);
      }
      if (extra.length > 0) {
        console.error(`  extra files: ${extra.join(", ")}`);
      }
    }

    for (const relativePath of sourceFiles) {
      if (!targetFiles.includes(relativePath)) {
        continue;
      }
      const sourceFilePath = path.join(sourceDir, relativePath);
      const targetFilePath = path.join(targetDir, relativePath);
      const [sourceContent, targetContent] = await Promise.all([
        fs.readFile(sourceFilePath),
        fs.readFile(targetFilePath),
      ]);

      if (!sourceContent.equals(targetContent)) {
        hasMismatch = true;
        console.error(`\nContent mismatch: ${appDir}/packages/${packageName}/${relativePath}`);
      }
    }
  }
}

if (hasMismatch) {
  console.error("\nShared package mirrors are out of sync. Run: npm run sync:shared");
  process.exit(1);
}

console.log("Shared package mirrors are in sync.");
