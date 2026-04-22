import { promises as fs } from "node:fs";
import path from "node:path";
import { createHazifyToolRegistry } from "../apps/hazify-mcp-remote/src/tools/registry.js";

const repoRoot = process.cwd();
const docsDir = path.join(repoRoot, "docs");
const docsIndexPath = path.join(docsDir, "README.md");
const startHerePath = path.join(docsDir, "00-START-HERE.md");
const agentsPath = path.join(repoRoot, "AGENTS.md");
const remoteReadmePath = path.join(repoRoot, "apps/hazify-mcp-remote/README.md");

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

function ensureRequiredPhrases(filePath, content, requiredPhrases) {
  for (const phrase of requiredPhrases) {
    if (!content.includes(phrase)) {
      problems.push(
        `${toPosixPath(path.relative(repoRoot, filePath))}: mist verplichte documentatie-waarheid: ${phrase}`
      );
    }
  }
}

async function main() {
  const [docsIndexContent, startHereContent] = await Promise.all([
    readText(docsIndexPath),
    readText(startHerePath),
  ]);
  const registry = createHazifyToolRegistry({ getLicenseStatusExecute: async () => ({}) });
  const toolNames = new Set((registry.tools || []).map((tool) => tool.name));
  const workflowManifest = {
    workflows: {
      existingThemeEdit: {
        label: "Bestaande theme edit",
      },
    },
  };
  const forbiddenToolMentions = [
    "upsert-theme-file",
    "upsert-theme-files",
  ];
  const forbiddenPhrases = [
    "section creation/placement in supported JSON targets",
    "stript agressief zware elementen (zoals SVG",
    "content -> value auto-mapping",
    "image-only cloning is fully supported",
    "screenshot-only cloning is fully supported",
  ];

  const actualActiveDocs = await listTopLevelDocs();
  const indexedDocs = extractSectionCodePaths(docsIndexContent, "Actief")
    .filter((value) => value.startsWith("docs/") && value.endsWith(".md"))
    .sort();
  const orderedReadOrder = extractSectionCodePaths(startHereContent, "Leesvolgorde");
  const readOrderDocs = orderedReadOrder
    .filter((value) => value.startsWith("docs/") && value.endsWith(".md"))
    .sort();

  comparePathLists("docs/README.md", actualActiveDocs, indexedDocs);
  comparePathLists("docs/00-START-HERE.md", actualActiveDocs, readOrderDocs);

  const agentsIndex = orderedReadOrder.indexOf("AGENTS.md");
  const systemFlowIndex = orderedReadOrder.indexOf("docs/02-SYSTEM-FLOW.md");

  if (agentsIndex === -1) {
    problems.push("docs/00-START-HERE.md: `AGENTS.md` ontbreekt in de leesvolgorde");
  } else if (systemFlowIndex !== -1 && agentsIndex <= systemFlowIndex) {
    problems.push("docs/00-START-HERE.md: `AGENTS.md` moet na `docs/02-SYSTEM-FLOW.md` staan");
  }

  const markdownFilesToCheck = [
    agentsPath,
    docsIndexPath,
    remoteReadmePath,
    ...actualActiveDocs.map((file) => path.join(repoRoot, file)),
  ];

  const workflowChecks = new Map([
    [
      agentsPath,
      [
        workflowManifest.workflows.existingThemeEdit.label,
        "`search-theme-files` -> `get-theme-file` -> `draft-theme-artifact`",
        "De gebruiker bepaalt altijd op welk thema geschreven wordt.",
        "Geen Liquid binnen `{% stylesheet %}` of `{% javascript %}`.",
      ],
    ],
    [
      path.join(repoRoot, "docs/02-SYSTEM-FLOW.md"),
      [
        workflowManifest.workflows.existingThemeEdit.label,
        "`search-theme-files` -> `get-theme-file` -> `draft-theme-artifact`",
        "Nieuwe section creates lopen bij voorkeur via `create-theme-section`",
        "Geen Liquid binnen `{% stylesheet %}` of `{% javascript %}`.",
      ],
    ],
    [
      remoteReadmePath,
      [
        "`draft-theme-artifact`",
        "`apply-theme-draft`",
        "`search-theme-files` -> `get-theme-file` -> `draft-theme-artifact`",
      ],
    ],
  ]);

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
          token.startsWith("add-"))
      ) {
        if (!toolNames.has(token)) {
          problems.push(
            `${toPosixPath(path.relative(repoRoot, filePath))}: verwijst naar onbekende tool: ${token}`
          );
        }
      }
    }

    if (workflowChecks.has(filePath)) {
      ensureRequiredPhrases(filePath, content, workflowChecks.get(filePath));
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
