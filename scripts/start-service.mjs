import { spawn } from "node:child_process";

const mode = String(process.env.HAZIFY_SERVICE_MODE || "mcp")
  .trim()
  .toLowerCase();

const commands = {
  mcp: ["npm", ["run", "start:mcp"]],
  license: ["npm", ["run", "start:license"]],
  "visual-worker": ["npm", ["run", "start:visual-worker"]],
};

const selected = commands[mode];

if (!selected) {
  console.error(
    `Ongeldige HAZIFY_SERVICE_MODE='${mode}'. Gebruik 'mcp', 'license' of 'visual-worker'.`
  );
  process.exit(1);
}

const [command, args] = selected;
const child = spawn(command, args, {
  stdio: "inherit",
  env: process.env,
});

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
