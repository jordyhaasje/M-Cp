import { execFileSync } from "child_process";

function runGit(args) {
  return execFileSync("git", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trimEnd();
}

function safeRunGit(args) {
  try {
    return { ok: true, output: runGit(args) };
  } catch (error) {
    return {
      ok: false,
      error:
        error?.stderr?.toString?.().trim?.() ||
        error?.message ||
        "Unknown git error",
    };
  }
}

function parsePorcelainPaths(output) {
  return String(output || "")
    .split("\n")
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map((line) => {
      const payload = line.slice(3).trim();
      if (payload.includes(" -> ")) {
        return payload.split(" -> ").pop().trim();
      }
      return payload;
    });
}

function unique(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function classifyImpact(files) {
  const services = new Set();
  const buckets = {
    runtime: [],
    releaseOps: [],
    tests: [],
    docs: [],
    unknown: [],
  };

  for (const file of files) {
    const normalized = String(file || "").trim();
    if (!normalized) {
      continue;
    }

    if (
      normalized === "package.json" ||
      normalized === "package-lock.json" ||
      normalized.startsWith("packages/")
    ) {
      services.add("Hazify-MCP-Remote");
      services.add("Hazify-License-Service");
      buckets.runtime.push(normalized);
      continue;
    }

    if (
      normalized.startsWith("apps/hazify-mcp-remote/src/") ||
      normalized.startsWith("apps/hazify-mcp-remote/packages/") ||
      normalized === "apps/hazify-mcp-remote/package.json"
    ) {
      services.add("Hazify-MCP-Remote");
      buckets.runtime.push(normalized);
      continue;
    }

    if (
      normalized.startsWith("apps/hazify-license-service/src/") ||
      normalized.startsWith("apps/hazify-license-service/packages/") ||
      normalized === "apps/hazify-license-service/package.json"
    ) {
      services.add("Hazify-License-Service");
      buckets.runtime.push(normalized);
      continue;
    }

    if (
      normalized.startsWith("scripts/") ||
      normalized.startsWith(".github/workflows/")
    ) {
      buckets.releaseOps.push(normalized);
      continue;
    }

    if (
      normalized === "AGENTS.md" ||
      normalized.startsWith("docs/") ||
      normalized.endsWith(".md")
    ) {
      buckets.docs.push(normalized);
      continue;
    }

    if (
      normalized.startsWith("tests/") ||
      normalized.includes("/tests/") ||
      normalized.endsWith(".test.mjs") ||
      normalized.endsWith(".test.js")
    ) {
      buckets.tests.push(normalized);
      continue;
    }

    buckets.unknown.push(normalized);
  }

  return {
    services: Array.from(services).sort(),
    buckets: Object.fromEntries(
      Object.entries(buckets).map(([key, values]) => [key, unique(values)])
    ),
  };
}

function printFileList(title, files) {
  console.log(title);
  if (!files.length) {
    console.log("  - geen");
    return;
  }

  for (const file of files) {
    console.log(`  - ${file}`);
  }
}

const branch = safeRunGit(["branch", "--show-current"]);
if (!branch.ok) {
  console.error("Kon de huidige git-branch niet bepalen.");
  console.error(branch.error);
  process.exit(1);
}

const aheadBehind = safeRunGit(["rev-list", "--left-right", "--count", "origin/main...HEAD"]);
if (!aheadBehind.ok) {
  console.error("Kan origin/main niet vergelijken met HEAD.");
  console.error(aheadBehind.error);
  process.exit(1);
}

const [behindRaw, aheadRaw] = aheadBehind.output.split(/\s+/);
const behind = Number.parseInt(behindRaw, 10);
const ahead = Number.parseInt(aheadRaw, 10);

if (Number.isNaN(behind) || Number.isNaN(ahead)) {
  console.error(`Onverwachte git output: ${aheadBehind.output}`);
  process.exit(1);
}

const porcelain = safeRunGit(["status", "--porcelain"]);
if (!porcelain.ok) {
  console.error("Kan git status niet uitlezen.");
  console.error(porcelain.error);
  process.exit(1);
}

const committedDiff = safeRunGit(["diff", "--name-only", "origin/main...HEAD"]);
if (!committedDiff.ok) {
  console.error("Kan committed diff tegen origin/main niet uitlezen.");
  console.error(committedDiff.error);
  process.exit(1);
}

const localFiles = parsePorcelainPaths(porcelain.output);
const remotePendingFiles = String(committedDiff.output || "")
  .split("\n")
  .map((line) => line.trim())
  .filter(Boolean);

const localImpact = classifyImpact(localFiles);
const remotePendingImpact = classifyImpact(remotePendingFiles);

console.log(`Branch: ${branch.output || "(detached)"}`);
console.log(`Ahead/behind t.o.v. origin/main: ahead=${ahead}, behind=${behind}`);
console.log(`Lokale worktree schoon: ${localFiles.length === 0 ? "ja" : "nee"}`);
console.log(`Lokale commit nodig: ${localFiles.length > 0 ? "ja" : "nee"}`);
console.log(`Push naar remote nodig: ${ahead > 0 ? "ja" : "nee"}`);
console.log("");

printFileList("Lokale niet-gecommitte wijzigingen:", localFiles);
console.log("");
printFileList("Gecommitte maar nog niet gepushte wijzigingen:", remotePendingFiles);
console.log("");

console.log("Impact van lokale worktree-wijzigingen:");
console.log(
  `  - services voor latere redeploy na commit/push: ${
    localImpact.services.length ? localImpact.services.join(", ") : "geen"
  }`
);
printFileList("  - runtime", localImpact.buckets.runtime);
printFileList("  - release/ops", localImpact.buckets.releaseOps);
printFileList("  - docs", localImpact.buckets.docs);
printFileList("  - tests", localImpact.buckets.tests);
printFileList("  - unknown", localImpact.buckets.unknown);
console.log("");

console.log("Impact van al gecommitte wijzigingen die nog niet op remote staan:");
console.log(
  `  - services voor Railway redeploy na push: ${
    remotePendingImpact.services.length
      ? remotePendingImpact.services.join(", ")
      : "geen"
  }`
);
printFileList("  - runtime", remotePendingImpact.buckets.runtime);
printFileList("  - release/ops", remotePendingImpact.buckets.releaseOps);
printFileList("  - docs", remotePendingImpact.buckets.docs);
printFileList("  - tests", remotePendingImpact.buckets.tests);
printFileList("  - unknown", remotePendingImpact.buckets.unknown);
console.log("");

if (behind > 0) {
  console.log(
    "Advies: branch loopt achter op origin/main. Eerst rebasen/pullen voordat je een releasebeslissing neemt."
  );
} else if (localFiles.length > 0) {
  console.log(
    "Advies: commit eerst de bedoelde lokale wijzigingen. Railway redeploy pas beoordelen nadat de relevante runtime-wijzigingen gecommit en gepusht zijn."
  );
} else if (ahead > 0) {
  console.log(
    "Advies: push eerst naar remote. Redeploy daarna alleen de hierboven genoemde service(s), plus altijd een post-deploy smoke en logreview."
  );
} else {
  console.log(
    "Advies: git is in sync met origin/main. Alleen Railway redeploy doen als je bewust een env-only wijziging of een handmatige runtime-actie wilt uitrollen."
  );
}
