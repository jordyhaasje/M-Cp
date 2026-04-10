import { promises as fs } from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const problems = [];

const requiredDirs = [
  "apps/hazify-license-service",
  "apps/hazify-mcp-remote",
  "apps/hazify-license-service/packages/mcp-common",
  "apps/hazify-license-service/packages/shopify-core",
  "apps/hazify-mcp-remote/packages/db-core",
  "apps/hazify-mcp-remote/packages/mcp-common",
  "apps/hazify-mcp-remote/packages/shopify-core",
  "packages/mcp-common",
  "packages/shopify-core",
  "docs",
  "scripts",
  "tests",
  ".github",
];

const forbiddenRootDirs = ["archive", "templates"];
const forbiddenRepoDirs = ["apps/hazify-license-service/data"];
const forbiddenRepoFiles = [
  "apps/hazify-license-service/server.js",
  "apps/hazify-license-service/src/repositories/json-storage.js",
  "apps/hazify-license-service/scripts/migrate-json-to-postgres.mjs",
  "apps/hazify-mcp-remote/src/lib/licenseManager.js",
  "apps/hazify-mcp-remote/src/lib/machineFingerprint.js",
  "apps/hazify-mcp-remote/src/lib/shopifyAuth.js",
  "test-tmp.mjs",
];
const junkFileNames = new Set([".DS_Store", "Thumbs.db"]);
const ignoredDirNames = new Set([".git", "node_modules"]);
const allowedMirrorEntries = new Map([
  [
    "apps/hazify-license-service/packages",
    new Set(["mcp-common", "shopify-core"]),
  ],
  [
    "apps/hazify-mcp-remote/packages",
    new Set(["db-core", "mcp-common", "shopify-core"]),
  ],
]);
const canonicalMirrorPairs = [
  ["packages/mcp-common", "apps/hazify-license-service/packages/mcp-common"],
  ["packages/shopify-core", "apps/hazify-license-service/packages/shopify-core"],
  ["packages/db-core", "apps/hazify-mcp-remote/packages/db-core"],
  ["packages/mcp-common", "apps/hazify-mcp-remote/packages/mcp-common"],
  ["packages/shopify-core", "apps/hazify-mcp-remote/packages/shopify-core"],
];

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

async function listDirNames(dirPath) {
  const entries = await fs.readdir(path.join(repoRoot, dirPath), { withFileTypes: true });
  return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
}

async function listRelativeFiles(dirPath, baseDir = dirPath) {
  const absoluteDirPath = path.join(repoRoot, dirPath);
  const entries = await fs.readdir(absoluteDirPath, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const childRelativePath = path.posix.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listRelativeFiles(childRelativePath, baseDir)));
      continue;
    }
    files.push(path.posix.relative(baseDir, childRelativePath));
  }

  return files.sort();
}

async function compareMirrorContents(canonicalDir, mirrorDir) {
  const [canonicalFiles, mirrorFiles] = await Promise.all([
    listRelativeFiles(canonicalDir),
    listRelativeFiles(mirrorDir),
  ]);
  const canonicalSet = new Set(canonicalFiles);
  const mirrorSet = new Set(mirrorFiles);

  for (const file of canonicalFiles) {
    if (!mirrorSet.has(file)) {
      problems.push(`deploy mirror mist bestand: ${mirrorDir}/${file}`);
    }
  }

  for (const file of mirrorFiles) {
    if (!canonicalSet.has(file)) {
      problems.push(`deploy mirror heeft onverwacht bestand: ${mirrorDir}/${file}`);
    }
  }

  for (const file of canonicalFiles) {
    if (!mirrorSet.has(file)) {
      continue;
    }

    const [canonicalContent, mirrorContent] = await Promise.all([
      fs.readFile(path.join(repoRoot, canonicalDir, file), "utf8"),
      fs.readFile(path.join(repoRoot, mirrorDir, file), "utf8"),
    ]);

    if (canonicalContent !== mirrorContent) {
      problems.push(`deploy mirror loopt uit sync: ${mirrorDir}/${file} != ${canonicalDir}/${file}`);
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

  for (const [mirrorRoot, allowedEntries] of allowedMirrorEntries.entries()) {
    if (!(await pathExists(mirrorRoot))) {
      continue;
    }

    const actualEntries = await listDirNames(mirrorRoot);
    for (const entry of actualEntries) {
      if (!allowedEntries.has(entry)) {
        problems.push(`onverwachte deploy mirror aanwezig: ${mirrorRoot}/${entry}/`);
      }
    }
  }

  for (const [canonicalDir, mirrorDir] of canonicalMirrorPairs) {
    if (!(await pathExists(canonicalDir)) || !(await pathExists(mirrorDir))) {
      continue;
    }
    await compareMirrorContents(canonicalDir, mirrorDir);
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
