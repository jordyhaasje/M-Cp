import fs from "fs/promises";
import path from "path";

const rootDir = process.cwd();
const sharedPackages = ["mcp-common", "shopify-core"];
const appDirs = ["apps/hazify-license-service", "apps/hazify-mcp-remote"];

for (const packageName of sharedPackages) {
  const sourceDir = path.join(rootDir, "packages", packageName);
  await fs.access(sourceDir);

  for (const appDir of appDirs) {
    const targetDir = path.join(rootDir, appDir, "packages", packageName);
    await fs.rm(targetDir, { recursive: true, force: true });
    await fs.mkdir(path.dirname(targetDir), { recursive: true });
    await fs.cp(sourceDir, targetDir, { recursive: true, force: true });
    console.log(`synced ${packageName} -> ${appDir}/packages/${packageName}`);
  }
}
