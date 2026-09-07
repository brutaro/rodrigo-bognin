import { execFileSync, spawn, spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

type BaselineContract = {
  baselineCommit: string;
  attestation: { status: string; originalSnapshotComplete: boolean; limitations: string[] };
  expectedCounts: { protectedFiles: number; integrationFiles: number };
  protectedFiles: Array<{ path: string; sha256: string; bytes: number; basis: string }>;
  integrationFiles: Array<{ path: string; baselineSha256: string; baselineBytes: number; approvedSha256: string; approvedBytes: number; approval: string }>;
};

const contractPath = "tests/contracts/story-3-3-baseline.json";
const sourceContract = JSON.parse(readFileSync(contractPath, "utf8")) as BaselineContract;
const expectedCommit = "f04b52093c8163a60023f2ae9fed62c117b64c18";

function verifyCandidate(contract: BaselineContract) {
  const temporary = mkdtempSync(join(tmpdir(), "story33-contract-"));
  const candidate = join(temporary, "contract.json");
  writeFileSync(candidate, JSON.stringify(contract));
  const result = spawnSync(process.execPath, ["scripts/verify-story-3-3-baseline.mjs", "--root", ".", "--contract", candidate], { encoding: "utf8" });
  rmSync(temporary, { recursive: true, force: true });
  return result;
}

function copyPlannedPackage(destinationRoot: string) {
  const listed = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { encoding: "buffer" }).toString().split("\0").filter(Boolean);
  for (const relative of listed) {
    if (!lstatSync(relative).isFile()) continue;
    const destination = join(destinationRoot, relative);
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(relative, destination);
  }
}

function writeExecutable(path: string, source: string) {
  writeFileSync(path, source);
  chmodSync(path, 0o755);
}

function makePathSpy(temporary: string) {
  const bin = join(temporary, "bin");
  mkdirSync(bin);
  const spy = `#!/bin/sh\nprintf '%s|%s|%s\\n' "$0" "$TRIA_INTEGRATION_NAMESPACE" "$*" >> "$SPY_LOG"\nexit 0\n`;
  writeExecutable(join(bin, "node"), spy);
  writeExecutable(join(bin, "bash"), spy);
  return bin;
}

function makeDockerFake(temporary: string, failRemoval = false, failEnumeration = "") {
  const bin = join(temporary, "bin");
  const state = join(temporary, "state");
  mkdirSync(bin); mkdirSync(state);
  writeExecutable(join(bin, "docker"), `#!/bin/sh
set -eu
printf '%s\\n' "$*" >> "$DOCKER_LOG"
state="$DOCKER_STATE"
namespace="$TRIA_INTEGRATION_NAMESPACE"
command="$1"; shift
case "$command" in
  info) exit 0 ;;
  ps)
    [ "${failEnumeration}" = ps ] && exit 42
    case "$*" in
      *com.docker.compose.project*) [ -e "$state/compose" ] && printf '%s\\n' compose-id ;;
      *com.tria.integration.namespace*) [ -e "$state/orphan" ] && printf '%s\\n' orphan-id ; [ -e "$state/web" ] && printf '%s\\n' web-id ;;
      *name=*) [ -e "$state/web" ] && printf '%s\\n' web-id ;;
    esac
    exit 0 ;;
  inspect)
    for id do :; done
    case "$id:$*" in
      compose-id:*com.docker.compose.project*) printf '%s\\n' "$namespace"; exit 0 ;;
      orphan-id:*com.tria.integration.namespace*|web-id:*com.tria.integration.namespace*) printf '%s\\n' "$namespace"; exit 0 ;;
    esac
    exit 1 ;;
  rm)
    [ "${failRemoval ? "yes" : "no"}" = yes ] && exit 1
    for id do :; done
    case "$id" in compose-id) rm -f "$state/compose" ;; orphan-id) rm -f "$state/orphan" ;; web-id) rm -f "$state/web" ;; esac
    exit 0 ;;
  volume)
    sub="$1"; shift
    if [ "$sub" = ls ]; then
      [ "${failEnumeration}" = volume ] && exit 42
      for file in "$state"/volume-*; do [ -e "$file" ] || continue; suffix="$(basename "$file" | sed 's/^volume-//')"; printf '%s_%s\\n' "$namespace" "$suffix"; done
      exit 0
    fi
    if [ "$sub" = inspect ]; then
      formatted=0; [ "$1" = -f ] && formatted=1
      for target do :; done
      key="\${target#\${namespace}_}"
      [ -e "$state/volume-$key" ] || exit 1
      [ "$formatted" -eq 1 ] && printf '%s\\n' "$namespace"
      exit 0
    fi
    [ "$sub" = rm ] || exit 1
    [ "${failRemoval ? "yes" : "no"}" = yes ] && exit 1
    target="$1"; key="\${target#\${namespace}_}"; rm -f "$state/volume-$key"; exit 0 ;;
  network)
    sub="$1"; shift
    if [ "$sub" = ls ]; then
      [ "${failEnumeration}" = network ] && exit 42
      [ -e "$state/network" ] && printf '%s\\n' network-id
      exit 0
    fi
    if [ "$sub" = inspect ]; then
      [ -e "$state/network" ] || exit 1
      [ "$1" = -f ] && printf '%s\\n' "$namespace"
      exit 0
    fi
    [ "$sub" = rm ] || exit 1
    [ "${failRemoval ? "yes" : "no"}" = yes ] && exit 1
    rm -f "$state/network"; exit 0 ;;
esac
exit 1
`);
  return { bin, state };
}

function harnessWithFake(temporary: string, childSource: string, failRemoval = false, preexisting?: string, failEnumeration = "") {
  const { bin, state } = makeDockerFake(temporary, failRemoval, failEnumeration);
  const child = join(temporary, "child.sh");
  const log = join(temporary, "docker.log");
  writeExecutable(child, childSource);
  if (preexisting) writeFileSync(join(state, preexisting), "1");
  const env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    DOCKER_LOG: log,
    DOCKER_STATE: state,
    TRIA_INTEGRATION_ISOLATED: "confirmed",
    TRIA_INTEGRATION_NAMESPACE: "tria-adjustments-harness-self-test-spy",
  };
  return { env, state, child, log };
}

function assertCiInvocations(source: string) {
  const previous = source.search(/^bash scripts\/ci-isolated-integration\.sh$/m);
  const story33 = source.search(/^\s+bash scripts\/story-3-3-isolated-integration\.sh$/m);
  if (previous < 0 || story33 <= previous) throw new Error("sequência CI incompleta");
}

function assertNormalChildIsGenerated(source: string) {
  if (source.includes("TRIA_STORY33_TEST_CHILD") || source.includes("TRIA_STORY33_HARNESS_TEST") || !source.includes('child_command=("$generated")')) throw new Error("caminho normal pode substituir generated por env");
}

function assertSafeDockerMetadata(source: string) {
  const normalized = source.replace(/\\\r?\n\s*/g, " ");
  const secretNames = "(?:TRIA_ADMIN_PASSWORD|TRIA_APP_PASSWORD|TRIA_IMPORTER_PASSWORD|PGPASSWORD|POSTGRES_PASSWORD|DATABASE_URL|TRIA_LOGIN_CODE|TRIA_SESSION_KEY)";
  const forbiddenSecret = new RegExp(`(?:^|\\s)(?:-e\\s*|--env(?:=|\\s+))["']?${secretNames}(?=["'=\\s]|$)`, "m");
  if (forbiddenSecret.test(normalized)) throw new Error("secret direto em metadata Docker");
  if (/(?:^|\s)--env-file(?:\s+|=)/m.test(normalized)) throw new Error("env-file proibido na injeção 3.3");
}

describe("G33-01 harness autossuficiente da Story 3.3", () => {
  it("prende commit, conjuntos e baselines a constantes imutáveis", () => {
    expect(sourceContract.baselineCommit).toBe(expectedCommit);
    expect(sourceContract.attestation.status).toBe("reattested-known-files");
    expect(sourceContract.attestation.originalSnapshotComplete).toBe(false);
    expect(sourceContract.attestation.limitations.length).toBeGreaterThan(0);
    expect(execFileSync(process.execPath, ["scripts/verify-story-3-3-baseline.mjs"], { encoding: "utf8" })).toContain("G33-01 PASS");

    const mutations: BaselineContract[] = [];
    const falseCommit = structuredClone(sourceContract); falseCommit.baselineCommit = "0".repeat(40); mutations.push(falseCommit);
    const falseProtected = structuredClone(sourceContract); falseProtected.protectedFiles[0].sha256 = "0".repeat(64); mutations.push(falseProtected);
    const falseIntegrationBaseline = structuredClone(sourceContract); falseIntegrationBaseline.integrationFiles[0].baselineSha256 = "0".repeat(64); mutations.push(falseIntegrationBaseline);
    const removedAndDecremented = structuredClone(sourceContract); removedAndDecremented.protectedFiles.pop(); removedAndDecremented.expectedCounts.protectedFiles--; mutations.push(removedAndDecremented);
    const extra = structuredClone(sourceContract); extra.protectedFiles.push({ ...extra.protectedFiles[0], path: "extra.txt" }); extra.expectedCounts.protectedFiles++; mutations.push(extra);
    const duplicate = structuredClone(sourceContract); duplicate.integrationFiles.push({ ...duplicate.integrationFiles[0] }); duplicate.expectedCounts.integrationFiles++; mutations.push(duplicate);
    const extraRoot = structuredClone(sourceContract) as BaselineContract & { extra?: boolean }; extraRoot.extra = true; mutations.push(extraRoot);
    const extraProtected = structuredClone(sourceContract); (extraProtected.protectedFiles[0] as typeof extraProtected.protectedFiles[0] & { extra?: boolean }).extra = true; mutations.push(extraProtected);
    const extraIntegration = structuredClone(sourceContract); (extraIntegration.integrationFiles[0] as typeof extraIntegration.integrationFiles[0] & { extra?: boolean }).extra = true; mutations.push(extraIntegration);
    for (const mutation of mutations) expect(verifyCandidate(mutation).status).toBe(1);
  });

  it("passa em pacote sintético formado só por arquivos versionáveis do working tree", () => {
    const packageRoot = mkdtempSync(join(tmpdir(), "story33-package-"));
    const packageTemp = mkdtempSync(join(tmpdir(), "story33-package-tmp-"));
    try {
      copyPlannedPackage(packageRoot);
      expect(existsSync(join(packageRoot, contractPath))).toBe(true);
      expect(existsSync(join(packageRoot, ".git"))).toBe(false);
      expect(execFileSync(process.execPath, [join(packageRoot, "scripts/verify-story-3-3-baseline.mjs"), "--root", packageRoot], { encoding: "utf8" })).toContain("preflight do pacote planejado autossuficiente");
      expect(execFileSync("bash", [join(packageRoot, "scripts/story-3-3-isolated-integration.sh"), "--preflight-only"], { env: { ...process.env, TMPDIR: packageTemp }, encoding: "utf8" })).toContain("sequência Story3.2-final");
      expect(readdirSync(packageTemp)).toEqual([]);
    } finally {
      rmSync(packageRoot, { recursive: true, force: true }); rmSync(packageTemp, { recursive: true, force: true });
    }
  });

  it("ignora Git ancestral diferente do root do pacote", () => {
    const strangeRepo = mkdtempSync(join(tmpdir(), "story33-strange-git-"));
    const packageRoot = join(strangeRepo, "nested-package"); mkdirSync(packageRoot);
    try {
      execFileSync("git", ["init", "-q", strangeRepo]);
      copyPlannedPackage(packageRoot);
      const output = execFileSync(process.execPath, [join(packageRoot, "scripts/verify-story-3-3-baseline.mjs"), "--root", packageRoot], { encoding: "utf8" });
      expect(output).toContain("preflight do pacote planejado autossuficiente");
      expect(output).not.toContain("evidência do baseline commit validada");
    } finally { rmSync(strangeRepo, { recursive: true, force: true }); }
  });

  it("detecta adulteração real no primeiro, meio e último arquivo de cada conjunto", () => {
    const packageRoot = mkdtempSync(join(tmpdir(), "story33-real-tamper-"));
    try {
      copyPlannedPackage(packageRoot);
      const selected = [sourceContract.protectedFiles, sourceContract.integrationFiles].flatMap((entries) => [entries[0].path, entries[Math.floor(entries.length / 2)].path, entries[entries.length - 1].path]);
      for (const relative of selected) {
        const target = join(packageRoot, relative);
        const original = readFileSync(target);
        writeFileSync(target, Buffer.concat([original, Buffer.from("\nadulterado\n")]));
        const result = spawnSync(process.execPath, [join(packageRoot, "scripts/verify-story-3-3-baseline.mjs"), "--root", packageRoot], { encoding: "utf8" });
        expect(result.status, relative).toBe(1);
        writeFileSync(target, original);
      }
    } finally { rmSync(packageRoot, { recursive: true, force: true }); }
  });

  it("executa dispatcher legado e 3.3 com ambientes distintos", () => {
    const temporary = mkdtempSync(join(tmpdir(), "story33-dispatch-spy-"));
    try {
      const bin = makePathSpy(temporary); const log = join(temporary, "spy.log");
      const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, SPY_LOG: log, APP_BASE_URL: "http://web:3000", DB_APP_PASSWORD_FILE: "/synthetic/app", DB_ADMIN_PASSWORD_FILE: "/synthetic/admin", TRIA_INTEGRATION_ISOLATED: "confirmed", TRIA_INTEGRATION_NAMESPACE: "tria-adjustments-received" };
      const result = spawnSync(process.execPath, ["scripts/test-integration.mjs"], { env, encoding: "utf8" });
      expect(result.status).toBe(0);
      const calls = readFileSync(log, "utf8").trim().split("\n");
      expect(calls).toHaveLength(2);
      expect(calls[0]).toContain("|tria-adjustments-received|scripts/integration-smoke.mjs");
      expect(calls[1]).toMatch(/\|tria-adjustments-local-[a-z0-9_-]+\|scripts\/story-3-3-isolated-integration\.sh$/);
      expect(calls[1]).not.toContain("tria-adjustments-received");
    } finally { rmSync(temporary, { recursive: true, force: true }); }
  });

  it("gera a sequência final 3.2, PostgreSQL, seed e browser 3.3", () => {
    const temporary = mkdtempSync(join(tmpdir(), "story33-preflight-"));
    try {
      const output = execFileSync("bash", ["scripts/story-3-3-isolated-integration.sh", "--preflight-only"], { env: { ...process.env, TMPDIR: temporary }, encoding: "utf8" });
      expect(output).toContain("Story3.2-final < PostgreSQL3.3 < seed3.3 < browser3.3");
      expect(output).toMatch(/PASS: [1-9][0-9]*\/[1-9][0-9]* docker run com label isolado/);
      expect(readdirSync(temporary)).toEqual([]);
    } finally { rmSync(temporary, { recursive: true, force: true }); }
  });

  it("estabelece ownership antes do cleanup e remove somente recursos rotulados", () => {
    const temporary = mkdtempSync(join(tmpdir(), "story33-cleanup-"));
    try {
      const fixture = harnessWithFake(temporary, `#!/bin/sh\ntouch "$DOCKER_STATE/web" "$DOCKER_STATE/compose" "$DOCKER_STATE/orphan" "$DOCKER_STATE/network" "$DOCKER_STATE/volume-postgres_data" "$DOCKER_STATE/volume-file_data" "$DOCKER_STATE/volume-next_cache"\nexit 0\n`);
      const result = spawnSync("bash", ["scripts/story-3-3-isolated-integration.sh", "--harness-self-test", fixture.child], { env: fixture.env, encoding: "utf8" });
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("G33-01 SELF-TEST");
      expect(result.stdout).not.toContain("G33-01 PASS");
      expect(readdirSync(fixture.state)).toEqual([]);
      const calls = readFileSync(fixture.log, "utf8");
      expect(calls).toContain("volume inspect -f");
      expect(calls).toContain("network inspect -f");
      expect(calls).toContain("label=com.tria.integration.namespace=tria-adjustments-harness-self-test-spy");
    } finally { rmSync(temporary, { recursive: true, force: true }); }
  });

  it("não limpa preexistente e torna falha de cleanup não zero", () => {
    const preexistingTemp = mkdtempSync(join(tmpdir(), "story33-preexisting-"));
    try {
      const fixture = harnessWithFake(preexistingTemp, `#!/bin/sh\ntouch "$DOCKER_STATE/child-ran"\n`, false, "network");
      const result = spawnSync("bash", ["scripts/story-3-3-isolated-integration.sh", "--harness-self-test", fixture.child], { env: fixture.env, encoding: "utf8" });
      expect(result.status).toBe(2);
      expect(existsSync(join(fixture.state, "network"))).toBe(true);
      expect(existsSync(join(fixture.state, "child-ran"))).toBe(false);
      expect(readFileSync(fixture.log, "utf8")).not.toMatch(/network rm|volume rm|rm -f/);
    } finally { rmSync(preexistingTemp, { recursive: true, force: true }); }

    const failureTemp = mkdtempSync(join(tmpdir(), "story33-cleanup-failure-"));
    try {
      const fixture = harnessWithFake(failureTemp, `#!/bin/sh\ntouch "$DOCKER_STATE/network"\nexit 0\n`, true);
      const result = spawnSync("bash", ["scripts/story-3-3-isolated-integration.sh", "--harness-self-test", fixture.child], { env: fixture.env, encoding: "utf8" });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("cleanup defensivo");
    } finally { rmSync(failureTemp, { recursive: true, force: true }); }
  });

  it("falha fechado quando enumeração Docker retorna erro", () => {
    for (const kind of ["ps", "volume", "network"]) {
      const temporary = mkdtempSync(join(tmpdir(), `story33-enumeration-${kind}-`));
      try {
        const marker = join(temporary, "child-ran");
        const fixture = harnessWithFake(temporary, `#!/bin/sh\ntouch "${marker}"\nexit 0\n`, false, undefined, kind);
        const result = spawnSync("bash", ["scripts/story-3-3-isolated-integration.sh", "--harness-self-test", fixture.child], { env: fixture.env, encoding: "utf8" });
        expect(result.status).toBe(1);
        expect(existsSync(marker)).toBe(false);
        expect(readFileSync(fixture.log, "utf8")).not.toMatch(/volume rm|network rm|^rm -f/m);
      } finally { rmSync(temporary, { recursive: true, force: true }); }
    }
  });

  it("força 143, aplica deadline e mata toda a árvore no TERM", async () => {
    async function runCase(childSource: string, prefix: string) {
      const temporary = mkdtempSync(join(tmpdir(), prefix));
      const signalLog = join(temporary, "signal.log");
      const fixture = harnessWithFake(temporary, childSource);
      const child = spawn("bash", ["scripts/story-3-3-isolated-integration.sh", "--harness-self-test", fixture.child], { env: { ...fixture.env, SIGNAL_LOG: signalLog }, stdio: ["ignore", "pipe", "pipe"] });
      const closed = new Promise<number | null>((resolve) => child.once("close", resolve));
      for (let index = 0; index < 200 && !existsSync(`${signalLog}.ready`) && child.exitCode === null; index++) await new Promise((resolve) => setTimeout(resolve, 20));
      if (!existsSync(`${signalLog}.ready`)) throw new Error("child de sinal não iniciou");
      const started = Date.now(); child.kill("SIGTERM"); const status = await closed;
      return { temporary, signalLog, fixture, status, elapsed: Date.now() - started };
    }

    const exitsZero = await runCase(`#!/bin/sh\ntrap 'exit 0' TERM\necho ready > "$SIGNAL_LOG.ready"\nwhile :; do sleep 1; done\n`, "story33-signal-zero-");
    try { expect(exitsZero.status).toBe(143); expect(exitsZero.elapsed).toBeLessThan(4000); } finally { rmSync(exitsZero.temporary, { recursive: true, force: true }); }

    const ignores = await runCase(`#!/bin/sh\ntrap '' TERM\necho ready > "$SIGNAL_LOG.ready"\nwhile :; do sleep 1; done\n`, "story33-signal-ignore-");
    try { expect(ignores.status).toBe(143); expect(ignores.elapsed).toBeLessThan(4000); } finally { rmSync(ignores.temporary, { recursive: true, force: true }); }

    const tree = await runCase(`#!/bin/sh\ntrap '' TERM\n( trap '' TERM; while :; do sleep 1; done ) &\necho $! > "$SIGNAL_LOG.grandchild"\necho ready > "$SIGNAL_LOG.ready"\nwhile :; do sleep 1; done\n`, "story33-signal-tree-");
    try {
      expect(tree.status).toBe(143); expect(tree.elapsed).toBeLessThan(4000);
      const grandchild = Number(readFileSync(`${tree.signalLog}.grandchild`, "utf8").trim());
      for (let index = 0; index < 20; index++) {
        try { process.kill(grandchild, 0); await new Promise((resolve) => setTimeout(resolve, 50)); } catch { break; }
      }
      expect(() => process.kill(grandchild, 0)).toThrow();
    } finally { rmSync(tree.temporary, { recursive: true, force: true }); }
  }, 15_000);

  it("executa wrapper CI anterior antes da 3.3 com namespace distinto", () => {
    const temporary = mkdtempSync(join(tmpdir(), "story33-ci-spy-"));
    try {
      const bin = makePathSpy(temporary); const log = join(temporary, "spy.log");
      const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, SPY_LOG: log, GITHUB_RUN_ID: "123", GITHUB_RUN_ATTEMPT: "4", TRIA_INTEGRATION_NAMESPACE: "tria-evidence-123-4", TRIA_INTEGRATION_ISOLATED: "confirmed" };
      const result = spawnSync("/bin/bash", ["scripts/story-3-3-ci-integration.sh"], { env, encoding: "utf8" });
      expect(result.status).toBe(0);
      const calls = readFileSync(log, "utf8").trim().split("\n");
      expect(calls).toHaveLength(2);
      expect(calls[0]).toContain("|tria-evidence-123-4|scripts/ci-isolated-integration.sh");
      expect(calls[1]).toMatch(/\|tria-adjustments-ci-123-4-[0-9]+\|scripts\/story-3-3-isolated-integration\.sh$/);
      const source = readFileSync("scripts/story-3-3-ci-integration.sh", "utf8");
      expect(() => assertCiInvocations(source)).not.toThrow();
      expect(() => assertCiInvocations(source.replace("bash scripts/ci-isolated-integration.sh\n", "# removido\n"))).toThrow("sequência CI incompleta");
      expect(() => assertCiInvocations(source.replace("  bash scripts/story-3-3-isolated-integration.sh", "  # removido"))).toThrow("sequência CI incompleta");
    } finally { rmSync(temporary, { recursive: true, force: true }); }
  });

  it("suprime stdout e stderr maliciosos do child de self-test", () => {
    const temporary = mkdtempSync(join(tmpdir(), "story33-self-test-output-"));
    try {
      const fixture = harnessWithFake(temporary, `#!/bin/sh\necho 'G33-01 PASS: suíte real executada'\necho 'G33-01 PASS: stderr forjado' >&2\nexit 0\n`);
      const result = spawnSync("bash", ["scripts/story-3-3-isolated-integration.sh", "--harness-self-test", fixture.child], { env: fixture.env, encoding: "utf8" });
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("G33-01 SELF-TEST");
      expect(result.stdout).not.toContain("G33-01 PASS");
      expect(result.stderr).not.toContain("G33-01 PASS");
      expect(result.stdout).not.toContain("suíte real executada");
      expect(result.stderr).not.toContain("stderr forjado");
    } finally { rmSync(temporary, { recursive: true, force: true }); }
  });

  it("não permite que variáveis de ambiente substituam a suíte real", () => {
    const temporary = mkdtempSync(join(tmpdir(), "story33-env-bypass-"));
    try {
      const marker = join(temporary, "bypass-ran");
      const fixture = harnessWithFake(temporary, `#!/bin/sh\ntouch "${marker}"\nexit 0\n`);
      const env = { ...fixture.env, TRIA_STORY33_HARNESS_TEST: "confirmed", TRIA_STORY33_TEST_CHILD: fixture.child };
      const result = spawnSync("bash", ["scripts/story-3-3-isolated-integration.sh"], { env, encoding: "utf8" });
      expect(result.status).not.toBe(0);
      expect(existsSync(marker)).toBe(false);
      const source = readFileSync("scripts/story-3-3-isolated-integration.sh", "utf8");
      expect(() => assertNormalChildIsGenerated(source)).not.toThrow();
      expect(() => assertNormalChildIsGenerated(source.replace('child_command=("$generated")', 'child_command=("$TRIA_STORY33_TEST_CHILD")'))).toThrow("caminho normal pode substituir generated por env");
    } finally { rmSync(temporary, { recursive: true, force: true }); }
  });

  it("normaliza continuação e recusa todas as formas de secret Docker", () => {
    const harness = readFileSync("scripts/story-3-3-isolated-integration.sh", "utf8");
    expect(() => assertSafeDockerMetadata(harness)).not.toThrow();
    const names = ["TRIA_ADMIN_PASSWORD", "TRIA_APP_PASSWORD", "TRIA_IMPORTER_PASSWORD", "PGPASSWORD", "POSTGRES_PASSWORD", "DATABASE_URL", "TRIA_LOGIN_CODE", "TRIA_SESSION_KEY"];
    const forms = (name: string) => [
      `-e ${name}`,
      `-e${name}`,
      `-e ${name}=literal`,
      `--env ${name}`,
      `--env=${name}`,
      `docker run \\\n        -e \\\n        ${name}=$(cat /secret) image`,
    ];
    for (const name of names) for (const unsafe of forms(name)) expect(() => assertSafeDockerMetadata(`${harness}\n${unsafe}`)).toThrow("secret direto em metadata Docker");
    for (const unsafe of ["--env-file secrets.env", "--env-file=secrets.env", "docker run \\\n --env-file \\\n secrets.env image"]) expect(() => assertSafeDockerMetadata(`${harness}\n${unsafe}`)).toThrow("env-file proibido na injeção 3.3");
    for (const safe of ["-e TRIA_ADMIN_PASSWORD_FILE=/run/admin", "--env=PGPASSWORD_FILE", "-eTRIA_SESSION_KEY_FILE=/run/session"]) expect(() => assertSafeDockerMetadata(`${harness}\n${safe}`)).not.toThrow();
    expect(harness).toContain("TRIA_ADMIN_PASSWORD_FILE=/run/tria-secrets/admin");
    expect(() => execFileSync("bash", ["-n", "scripts/story-3-3-isolated-integration.sh"])).not.toThrow();
    expect(() => execFileSync("bash", ["-n", "scripts/story-3-3-ci-integration.sh"])).not.toThrow();
  });
});
