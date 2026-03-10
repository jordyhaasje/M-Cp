import { promises as fs } from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const docsDir = path.join(repoRoot, "docs");
const docsIndexPath = path.join(docsDir, "README.md");
const startHerePath = path.join(docsDir, "00-START-HERE.md");
const rootReadmePath = path.join(repoRoot, "README.md");

const problems = [];

function toPosixPath(value) {
  return value.split(path.sep).join("/");
}

async function readText(filePath) {
  return fs.readFile(filePath, "utf8");
}

function extractSectionCodePaths(content, heading) {
  const lines = content.split(/\r?\n/);
  const paths = [];
  let inSection = false;

  for (const line of lines) {
    if (/^##\s+/.test(line)) {
      inSection = line.trim() === `## ${heading}`;
      continue;
    }

    if (!inSection) {
      continue;
    }

    const matches = [...line.matchAll(/`([^`]+)`/g)];
    for (const match of matches) {
      paths.push(match[1]);
    }
  }

  return paths;
}

async function listTopLevelDocs() {
  const entries = await fs.readdir(docsDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md") && entry.name !== "README.md")
    .map((entry) => `docs/${entry.name}`)
    .sort();
}

function comparePathLists(label, expected, actual) {
  const expectedSet = new Set(expected);
  const actualSet = new Set(actual);

  for (const file of expected) {
    if (!actualSet.has(file)) {
      problems.push(`${label}: ontbreekt in documentatie: ${file}`);
    }
  }

  for (const file of actual) {
    if (!expectedSet.has(file)) {
      problems.push(`${label}: verwijst naar niet-actief bestand: ${file}`);
    }
  }
}

function parseMarkdownLinks(content) {
  return [...content.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)].map((match) => match[1].trim());
}

function isExternalTarget(target) {
  return (
    target.startsWith("#") ||
    target.startsWith("http://") ||
    target.startsWith("https://") ||
    target.startsWith("mailto:") ||
    target.startsWith("tel:") ||
    target.startsWith("data:") ||
    target.startsWith("javascript:")
  );
}

function normalizeMarkdownTarget(sourceFile, rawTarget) {
  const target = rawTarget.replace(/^<|>$/g, "").split(/\s+/)[0];
  const withoutFragment = target.split("#")[0].split("?")[0];

  if (!withoutFragment || isExternalTarget(withoutFragment)) {
    return null;
  }

  if (withoutFragment.startsWith("/")) {
    return path.join(repoRoot, withoutFragment.slice(1));
  }

  return path.resolve(path.dirname(sourceFile), withoutFragment);
}

async function checkMarkdownLinks(filePath) {
  const content = await readText(filePath);
  const links = parseMarkdownLinks(content);

  for (const link of links) {
    const resolvedPath = normalizeMarkdownTarget(filePath, link);
    if (!resolvedPath) {
      continue;
    }

    try {
      await fs.access(resolvedPath);
    } catch {
      problems.push(`broken markdown link in ${toPosixPath(path.relative(repoRoot, filePath))}: ${link}`);
    }
  }
}

async function main() {
  const [docsIndexContent, startHereContent] = await Promise.all([
    readText(docsIndexPath),
    readText(startHerePath),
  ]);

  const actualActiveDocs = await listTopLevelDocs();
  const indexedDocs = extractSectionCodePaths(docsIndexContent, "Actief")
    .filter((value) => value.startsWith("docs/") && value.endsWith(".md"))
    .sort();
  const readOrderDocs = extractSectionCodePaths(startHereContent, "Leesvolgorde")
    .filter((value) => value.startsWith("docs/") && value.endsWith(".md") && !value.startsWith("docs/archive/"))
    .sort();

  comparePathLists("docs/README.md", actualActiveDocs, indexedDocs);
  comparePathLists("docs/00-START-HERE.md", actualActiveDocs, readOrderDocs);

  const markdownFilesToCheck = [rootReadmePath, docsIndexPath, ...actualActiveDocs.map((file) => path.join(repoRoot, file))];
  for (const filePath of markdownFilesToCheck) {
    await checkMarkdownLinks(filePath);
  }

  if (problems.length > 0) {
    console.error("Documentation checks failed:\n");
    for (const problem of problems) {
      console.error(`- ${problem}`);
    }
    process.exit(1);
  }

  console.log("Documentation checks passed.");
}

await main();
