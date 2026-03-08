import { execFileSync } from "child_process";

function runGit(args) {
  return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function safeRunGit(args) {
  try {
    return { ok: true, output: runGit(args) };
  } catch (error) {
    const stderr = error?.stderr?.toString?.().trim?.() || error?.message || "Unknown git error";
    return { ok: false, error: stderr };
  }
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

if (behind > 0) {
  console.error(`Lokale branch loopt ${behind} commit(s) achter op origin/main.`);
  console.error("Voer eerst uit: git pull --rebase origin main");
  process.exit(1);
}

console.log(`Git sync status: ahead=${ahead}, behind=${behind}`);

const changedFiles = safeRunGit(["diff", "--name-only", "origin/main...HEAD"]);
if (changedFiles.ok && changedFiles.output.includes(".github/workflows/")) {
  console.log("Workflow-bestanden aangepast: push vereist token/sleutel met workflow-permissie.");
}

const dryRun = safeRunGit(["push", "--dry-run", "--porcelain", "origin", "HEAD:main"]);
if (!dryRun.ok) {
  console.error("Push dry-run mislukt. Controleer git-authenticatie en permissies.");
  console.error(dryRun.error);
  process.exit(1);
}

console.log("Push dry-run succesvol.");
