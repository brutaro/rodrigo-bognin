import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";

const legacy = Boolean(
  process.env.APP_BASE_URL &&
  process.env.DB_APP_PASSWORD_FILE &&
  process.env.DB_ADMIN_PASSWORD_FILE &&
  process.env.TRIA_INTEGRATION_ISOLATED === "confirmed" &&
  /^tria-(?:evidence|vault|adjustments)-[a-z0-9_-]+$/.test(process.env.TRIA_INTEGRATION_NAMESPACE ?? ""),
);
const story33Namespace = `tria-adjustments-local-${Date.now()}-${process.pid}-${randomUUID().slice(0, 8)}`;
const commands = [];
if (legacy) {
  commands.push({ argv: ["node", "scripts/integration-smoke.mjs"], env: process.env, display: "node scripts/integration-smoke.mjs" });
}
commands.push({
  argv: ["bash", "scripts/story-3-3-isolated-integration.sh"],
  env: { ...process.env, TRIA_INTEGRATION_ISOLATED: "confirmed", TRIA_INTEGRATION_NAMESPACE: story33Namespace },
  display: `TRIA_INTEGRATION_NAMESPACE=${story33Namespace} bash scripts/story-3-3-isolated-integration.sh`,
});

if (process.argv.includes("--print-command") || process.argv.includes("--print-plan")) {
  console.log(commands.map((command) => command.display).join(" && "));
} else {
  for (const command of commands) {
    const result = spawnSync(command.argv[0], command.argv.slice(1), { stdio: "inherit", env: command.env });
    if (result.error) throw result.error;
    if (result.status !== 0) process.exit(result.status ?? 1);
  }
}
