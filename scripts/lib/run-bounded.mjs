#!/usr/bin/env node
// Cross-platform deadline for CLI process groups. No GNU timeout dependency.
import { spawn, spawnSync } from "node:child_process";
import { openSync, writeSync, closeSync } from "node:fs";
const args = process.argv.slice(2);
const seconds = Number(args.shift());
const log = args[0] === "--log" ? (args.shift(), args.shift()) : undefined;
if (!(seconds > 0 && seconds <= 7200) || !args.length) throw new Error("Invalid bounded command");
const logFd = log ? openSync(log, "a", 0o600) : undefined;
let status, settled = false, deadline, escalation, finalDeadline, stopping = false;
const child = spawn(args[0], args.slice(1), { detached: true, stdio: log ? ["ignore", "pipe", "pipe"] : "inherit" });
if (log) {
  child.stdout.on("data", (chunk) => { writeSync(logFd, chunk); process.stdout.write(chunk); });
  child.stderr.on("data", (chunk) => { writeSync(logFd, chunk); process.stderr.write(chunk); });
}
function groupExists() { try { process.kill(-child.pid, 0); return true; } catch { return false; } }
function signalGroup(signal) { try { process.kill(-child.pid, signal); } catch (error) { if (error.code !== "ESRCH") process.stderr.write(`${error.message}\n`); } }
function finish(code) {
  if (settled) return;
  settled = true;
  clearTimeout(deadline); clearTimeout(escalation); clearTimeout(finalDeadline);
  if (logFd !== undefined) closeSync(logFd);
  process.exit(code);
}
function stop(code) {
  if (status !== undefined) return;
  status = code; stopping = true;
  signalGroup("SIGTERM");
  escalation = setTimeout(() => signalGroup("SIGKILL"), 300);
  // Do not wait indefinitely for a stuck process or inherited output descriptors.
  finalDeadline = setTimeout(() => {
    if (groupExists()) {
      const inventory = spawnSync("ps", ["-eo", "pgid=,stat="], { encoding: "utf8", timeout: 500 });
      const live = inventory.status !== 0 || inventory.stdout.split("\n").some((line) => { const [group, state] = line.trim().split(/\s+/); return Number(group) === child.pid && !state?.startsWith("Z"); });
      if (live) { process.stderr.write("Process group did not stop before its deadline\n"); finish(1); return; }
    }
    finish(status);
  }, 600);
}
child.once("error", (error) => { process.stderr.write(`${error.message}\n`); finish(1); });
child.once("exit", (code, signal) => {
  const result = status ?? code ?? (signal === "SIGINT" ? 130 : 143);
  if (groupExists()) stop(result);
  else finalDeadline = setTimeout(() => finish(result), 600);
});
child.once("close", (code, signal) => {
  if (!stopping || !groupExists()) finish(status ?? code ?? (signal === "SIGINT" ? 130 : 143));
});
process.on("SIGINT", () => stop(130));
process.on("SIGTERM", () => stop(143));
deadline = setTimeout(() => { process.stderr.write(`Command timed out after ${seconds}s: ${args[0]}\n`); stop(124); }, seconds * 1000);
