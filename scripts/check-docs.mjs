import { promises as fs } from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const docsDir = path.join(repoRoot, "docs");
const docsIndexPath = path.join(docsDir, "README.md");
const startHerePath = path.join(docsDir, "00-START-HERE.md");
const rootReadmePath = path.join(repoRoot, "README.md");
const agentsPath = path.join(repoRoot, "AGENTS.md");
const remoteReadmePath = path.join(repoRoot, "apps/hazify-mcp-remote/README.md");
const toolManifestPath = path.join(docsDir, "archive/artifacts/tool-manifest.json");

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

function hasTopAudienceLine(content) {
  const firstLines = content.split(/\r?\n/).slice(0, 8);
  return firstLines.some((line) => /^Doelgroep:\s+\S+/.test(line.trim()));
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
  const toolManifest = JSON.parse(await readText(toolManifestPath));
  const toolNames = new Set((toolManifest.tools || []).map((tool) => tool.name));
  const forbiddenToolMentions = [
    "create-theme-section",
    "upsert-theme-file",
    "upsert-theme-files",
  ];
  const forbiddenPhrases = [
    "section creation/placement in supported JSON targets",
    "stript agressief zware elementen (zoals SVG",
    "content -> value auto-mapping",
  ];

  const actualActiveDocs = await listTopLevelDocs();
  const indexedDocs = extractSectionCodePaths(docsIndexContent, "Actief")
    .filter((value) => value.startsWith("docs/") && value.endsWith(".md"))
    .sort();
  const orderedReadOrder = extractSectionCodePaths(startHereContent, "Leesvolgorde");
  const readOrderDocs = orderedReadOrder
    .filter((value) => value.startsWith("docs/") && value.endsWith(".md") && !value.startsWith("docs/archive/"))
    .sort();

  comparePathLists("docs/README.md", actualActiveDocs, indexedDocs);
  comparePathLists("docs/00-START-HERE.md", actualActiveDocs, readOrderDocs);

  const agentsIndex = orderedReadOrder.indexOf("AGENTS.md");
  const runbookIndex = orderedReadOrder.indexOf("docs/04-AGENT-RUNBOOK.md");
  const mcpSetupIndex = orderedReadOrder.indexOf("docs/10-MCP-SERVER-SETUP.md");

  if (agentsIndex === -1) {
    problems.push("docs/00-START-HERE.md: `AGENTS.md` ontbreekt in de leesvolgorde");
  } else {
    if (runbookIndex !== -1 && agentsIndex <= runbookIndex) {
      problems.push("docs/00-START-HERE.md: `AGENTS.md` moet na `docs/04-AGENT-RUNBOOK.md` staan");
    }
    if (mcpSetupIndex !== -1 && agentsIndex >= mcpSetupIndex) {
      problems.push("docs/00-START-HERE.md: `AGENTS.md` moet voor `docs/10-MCP-SERVER-SETUP.md` staan");
    }
  }

  const markdownFilesToCheck = [
    agentsPath,
    docsIndexPath,
    remoteReadmePath,
    ...actualActiveDocs.map((file) => path.join(repoRoot, file)),
  ];
  for (const filePath of markdownFilesToCheck) {
    const content = await readText(filePath);
    if (!hasTopAudienceLine(content)) {
      problems.push(`missing doelgroep line near top of ${toPosixPath(path.relative(repoRoot, filePath))}`);
    }
    await checkMarkdownLinks(filePath);

    for (const legacyTool of forbiddenToolMentions) {
      if (content.includes(legacyTool)) {
        problems.push(
          `${toPosixPath(path.relative(repoRoot, filePath))}: legacy tool mention detected: ${legacyTool}`
        );
      }
    }

    for (const phrase of forbiddenPhrases) {
      if (content.includes(phrase)) {
        problems.push(
          `${toPosixPath(path.relative(repoRoot, filePath))}: stale workflow phrase detected: ${phrase}`
        );
      }
    }

    for (const match of content.matchAll(/`([a-z0-9_-]+)`/gi)) {
      const token = match[1];
      if (
        token.includes("-") &&
        (token.startsWith("get-") ||
          token.startsWith("set-") ||
          token.startsWith("update-") ||
          token.startsWith("delete-") ||
          token.startsWith("manage-") ||
          token.startsWith("clone-") ||
          token.startsWith("draft-") ||
          token.startsWith("apply-") ||
          token.startsWith("search-") ||
          token.startsWith("refund-") ||
          token.startsWith("analyze-") ||
          token.startsWith("list_") ||
          token.startsWith("add-"))
      ) {
        if (!toolNames.has(token)) {
          problems.push(
            `${toPosixPath(path.relative(repoRoot, filePath))}: verwijst naar onbekende tool: ${token}`
          );
        }
      }
    }
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
