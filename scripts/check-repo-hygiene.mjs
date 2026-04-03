import { promises as fs } from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const problems = [];

const requiredDirs = [
  "apps/hazify-license-service",
  "apps/hazify-mcp-remote",
  "packages/mcp-common",
  "packages/shopify-core",
  "docs",
  "scripts",
  "tests",
  ".github",
];

const forbiddenRootDirs = ["archive", "templates"];
const forbiddenRepoDirs = [
  "apps/hazify-license-service/packages",
  "apps/hazify-mcp-remote/packages",
];
const forbiddenRepoFiles = ["apps/hazify-license-service/server.js"];
const junkFileNames = new Set([".DS_Store", "Thumbs.db"]);
const ignoredDirNames = new Set([".git", "node_modules"]);

function toPosixPath(value) {
  return value.split(path.sep).join("/");
}

async function pathExists(targetPath) {
  try {
    await fs.access(path.join(repoRoot, targetPath));
    return true;
  } catch {
    return false;
  }
}

async function walk(dirPath) {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.isDirectory() && ignoredDirNames.has(entry.name)) {
      continue;
    }

    const fullPath = path.join(dirPath, entry.name);
    const relativePath = toPosixPath(path.relative(repoRoot, fullPath));

    if (entry.isDirectory()) {
      await walk(fullPath);
      continue;
    }

    if (junkFileNames.has(entry.name)) {
      problems.push(`junkbestand aanwezig: ${relativePath}`);
    }
  }
}

async function main() {
  for (const dir of requiredDirs) {
    if (!(await pathExists(dir))) {
      problems.push(`verplichte map ontbreekt: ${dir}`);
    }
  }

  for (const dir of forbiddenRootDirs) {
    if (await pathExists(dir)) {
      problems.push(`legacy root-map moet wegblijven: ${dir}/`);
    }
  }

  for (const dir of forbiddenRepoDirs) {
    if (await pathExists(dir)) {
      problems.push(`verboden mirror-map aanwezig: ${dir}/`);
    }
  }

  for (const file of forbiddenRepoFiles) {
    if (await pathExists(file)) {
      problems.push(`verboden legacy bestand aanwezig: ${file}`);
    }
  }

  await walk(repoRoot);

  if (problems.length > 0) {
    console.error("Repository hygiene checks failed:\n");
    for (const problem of problems) {
      console.error(`- ${problem}`);
    }
    process.exit(1);
  }

  console.log("Repository hygiene checks passed.");
}

await main();
