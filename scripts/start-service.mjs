import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const mode = String(process.env.HAZIFY_SERVICE_MODE || "mcp")
  .trim()
  .toLowerCase();

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function getStartPlan(serviceMode = mode) {
  const normalizedMode = String(serviceMode || "mcp").trim().toLowerCase();
  const plans = {
    mcp: {
      mode: "mcp",
      buildCommand: [
        process.execPath,
        [
          path.join(repoRoot, "apps/hazify-mcp-remote/scripts/copy-src-to-dist.mjs"),
          path.join(repoRoot, "apps/hazify-mcp-remote/src"),
          path.join(repoRoot, "apps/hazify-mcp-remote/dist"),
        ],
      ],
      startCommand: [process.execPath, [path.join(repoRoot, "apps/hazify-mcp-remote/dist/index.js")]],
    },
    license: {
      mode: "license",
      startCommand: [process.execPath, [path.join(repoRoot, "apps/hazify-license-service/src/server.js")]],
    },
  };

  return plans[normalizedMode] || null;
}

function spawnCommand([command, args], { inherit = false } = {}) {
  return spawn(command, args, {
    stdio: inherit ? "inherit" : ["ignore", "pipe", "pipe"],
    env: process.env,
    cwd: repoRoot,
  });
}

async function runBuild(plan) {
  if (!plan.buildCommand) {
    return;
  }

  const child = spawnCommand(plan.buildCommand, { inherit: true });
  await new Promise((resolve, reject) => {
    child.on("exit", (code, signal) => {
      if (signal) {
        reject(new Error(`Build voor '${plan.mode}' stopte met signaal ${signal}.`));
        return;
      }
      if (code) {
        reject(new Error(`Build voor '${plan.mode}' faalde met exitcode ${code}.`));
        return;
      }
      resolve();
    });
    child.on("error", reject);
  });
}

export async function main() {
  const plan = getStartPlan(mode);

  if (!plan) {
    console.error(
      `Ongeldige HAZIFY_SERVICE_MODE='${mode}'. Gebruik 'mcp' of 'license'.`
    );
    process.exit(1);
  }

  if (process.env.HAZIFY_START_DRY_RUN === "true") {
    const [command, args] = plan.startCommand;
    console.log(JSON.stringify({ mode: plan.mode, command, args }));
    return;
  }

  await runBuild(plan);

  const child = spawnCommand(plan.startCommand, { inherit: true });

  child.on("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 1);
  });

  child.on("error", (error) => {
    console.error(`Startscript '${mode}' kon niet worden gestart: ${error.message}`);
    process.exit(1);
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error?.message || error);
    process.exit(1);
  });
}
