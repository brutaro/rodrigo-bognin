import { execFileSync, spawn, spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
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
if [ "\${DOCKER_HANG:-}" = "$command" ] || { [ "\${DOCKER_HANG:-}" = cleanup ] && [ "$command" = rm ] && [ "\${2:-}" = web-id ]; }; then trap '' TERM; while :; do sleep 1; done; fi
case "$command" in
  create)
    mkdir "$state/reservation" 2>/dev/null || exit 125
    printf '%s' "$TRIA_INTEGRATION_OWNER" > "$state/reservation/owner"
    touch "$state/anonymous-lock-volume"
    printf '%s\\n' lock-id; exit 0 ;;
  build)
    if [ "\${DOCKER_BLOCK_BUILD:-}" = yes ]; then touch "$state/build-ready"; trap '' TERM; while :; do sleep 1; done; fi
    target=tools; iidfile=; tag=
    while [ "$#" -gt 0 ]; do
      case "$1" in --target) target="$2"; shift ;; --iidfile) iidfile="$2"; shift ;; --tag) tag="$2"; shift ;; esac
      shift
    done
    printf '%s' "$tag" > "$state/built-$target"
    printf '%s' "$TRIA_INTEGRATION_OWNER" > "$state/built-$target-owner"
    case "\${DOCKER_PARTIAL_BUILD:-}" in yes|"$target") exit 17 ;; esac
    if [ "$target" = runner ]; then digit=3; else digit=1; fi
    printf 'sha256:%064d' 0 | tr 0 "$digit" > "$iidfile"
    exit 0 ;;
  info) exit 0 ;;
  image)
    [ "${failEnumeration}" = image ] && exit 42
    sub="$1"; shift
    if [ "$sub" = ls ]; then
      [ -e "$state/image" ] && printf 'tria-tools:%s\\n' "$namespace"
      for file in "$state"/built-tools "$state"/built-runner; do [ ! -e "$file" ] || { cat "$file"; printf '\\n'; }; done
      exit 0
    fi
    if [ "$sub" = inspect ]; then
      for reference do :; done
      case "$reference" in reused-runner:*|tria:*) role=runner; digit=3 ;; *) role=tools; digit=1 ;; esac
      case "$*" in
        *com.tria.integration.owner*) [ ! -e "$state/tag-replaced-$role" ] || { printf foreign-owner; exit 0; }; cat "$state/built-$role-owner"; exit 0 ;;
        *) [ ! -e "$state/tag-replaced-$role" ] || digit=2; printf 'sha256:%064d' 0 | tr 0 "$digit"; exit 0 ;;
      esac
    fi
    if [ "$sub" = rm ]; then
      case "$1" in tria:*) role=runner ;; *) role=tools ;; esac
      rm -f "$state/built-$role" "$state/built-$role-owner"; exit 0
    fi
    exit 1 ;;
  ps)
    [ "${failEnumeration}" = ps ] && exit 42
    case "$*" in
      *name=^/"$namespace"-integration-lock*) [ -e "$state/reservation/owner" ] && printf '%s\\n' lock-id ;;
      *com.tria.integration.owner*) [ -e "$state/web" ] && printf '%s\\n' web-id ;;
      *com.docker.compose.project*) [ -e "$state/compose" ] && printf '%s\\n' compose-id ;;
      *com.tria.integration.namespace*) [ -e "$state/orphan" ] && printf '%s\\n' orphan-id ; [ -e "$state/web" ] && printf '%s\\n' web-id ;;
      *name=*) [ -e "$state/web" ] && printf '%s\\n' web-id ;;
    esac
    exit 0 ;;
  inspect)
    for id do :; done
    if [ "$id" = lock-id ]; then cat "$state/reservation/owner"; exit 0; fi
    [ ! -e "$state/foreign" ] || { printf '%s\\n' foreign-owner; exit 0; }
    case "$id" in
      compose-id|orphan-id|web-id) printf '%s\\n' "$TRIA_INTEGRATION_OWNER"; exit 0 ;;
    esac
    exit 1 ;;
  rm)
    [ "${failRemoval ? "yes" : "no"}" = yes ] && exit 1
    for id do :; done
    case "$id" in lock-id) case "$*" in *-fv*|*--volumes*) rm -f "$state/anonymous-lock-volume" ;; esac; rm -rf "$state/reservation" ;; compose-id) rm -f "$state/compose" ;; orphan-id) rm -f "$state/orphan" ;; web-id) rm -f "$state/web" ;; esac
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
      if [ -e "$state/foreign-volume" ]; then printf foreign-owner; exit 0; fi
      if [ -e "$state/missing-volume-owner" ]; then exit 0; fi
      [ "$formatted" -eq 1 ] && printf '%s\\n' "$TRIA_INTEGRATION_OWNER"
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
      if [ -e "$state/foreign-network" ]; then printf foreign-owner; exit 0; fi
      if [ -e "$state/missing-network-owner" ]; then exit 0; fi
      [ "$1" = -f ] && printf '%s\\n' "$TRIA_INTEGRATION_OWNER"
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

function normalPackage(temporary: string, suite: string) {
  const project = join(temporary, "project");
  mkdirSync(join(project, "scripts", "lib"), { recursive: true });
  for (const file of ["isolated-integration-supervisor.sh", "lib/run-bounded.mjs", "lib/save-integration-artifacts.mjs"]) copyFileSync(`scripts/${file}`, join(project, "scripts", file));
  for (const file of ["source-ledger-integration-suite.sh", "ci-evidence-integration-suite.sh"]) writeFileSync(join(project, "scripts", file), suite);
  return join(project, "scripts/isolated-integration-supervisor.sh");
}
async function waitForFile(file: string, child: ReturnType<typeof spawn>) {
  for (let index = 0; index < 300 && !existsSync(file) && child.exitCode === null; index++) await new Promise((resolve) => setTimeout(resolve, 10));
  expect(existsSync(file), file).toBe(true);
}


describe("isolamento do runner vigente", () => {
  it("executa wrappers e dispatcher com namespaces próprios e suíte vigente", () => {
    const temporary = mkdtempSync(join(tmpdir(), "tria-ci-dispatch-"));
    try {
      const bin = makePathSpy(temporary), log = join(temporary, "spy.log");
      const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, SPY_LOG: log, GITHUB_RUN_ID: "123", GITHUB_RUN_ATTEMPT: "4", TRIA_INTEGRATION_NAMESPACE: "tria-evidence-123-4", TRIA_INTEGRATION_ISOLATED: "confirmed" };
      const result = spawnSync("/bin/bash", ["scripts/story-3-3-ci-integration.sh"], { env, encoding: "utf8" });
      expect(result.status).toBe(0);
      const calls = readFileSync(log, "utf8").trim().split("\n");
      expect(calls).toHaveLength(2);
      expect(calls[0]).toContain("|tria-evidence-123-4|scripts/ci-isolated-integration.sh");
      expect(calls[1]).toMatch(/\|tria-adjustments-ci-123-4-[0-9]+\|scripts\/source-ledger-ci-integration\.sh$/);
      writeFileSync(log, "");
      const legacyEnv = { ...env, APP_BASE_URL: "http://web:3000", DB_APP_PASSWORD_FILE: "/synthetic/app", DB_ADMIN_PASSWORD_FILE: "/synthetic/admin" };
      execFileSync(process.execPath, ["scripts/test-integration.mjs"], { env: legacyEnv });
      const dispatch = readFileSync(log, "utf8").trim().split("\n");
      expect(dispatch).toHaveLength(2);
      expect(dispatch[0]).toContain("|tria-evidence-123-4|scripts/integration-smoke.mjs");
      expect(dispatch[1]).toMatch(/\|tria-adjustments-local-[a-z0-9_-]+\|scripts\/source-ledger-ci-integration\.sh$/);
    } finally { rmSync(temporary, { recursive: true, force: true }); }
  });

  it("estabelece ownership antes do cleanup e remove somente recursos rotulados", () => {
    const temporary = mkdtempSync(join(tmpdir(), "story33-cleanup-"));
    try {
      const fixture = harnessWithFake(temporary, `#!/bin/sh\ntouch "$DOCKER_STATE/web" "$DOCKER_STATE/compose" "$DOCKER_STATE/orphan" "$DOCKER_STATE/network" "$DOCKER_STATE/volume-postgres_data" "$DOCKER_STATE/volume-file_data" "$DOCKER_STATE/volume-next_cache"\nexit 0\n`);
      const result = spawnSync("bash", ["scripts/source-ledger-ci-integration.sh", "--harness-self-test", fixture.child], { env: fixture.env, encoding: "utf8" });
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("SELF-TEST");
      expect(result.stdout).not.toContain("Integração atual aprovada");
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
      const result = spawnSync("bash", ["scripts/source-ledger-ci-integration.sh", "--harness-self-test", fixture.child], { env: fixture.env, encoding: "utf8" });
      expect(result.status).toBe(2);
      expect(existsSync(join(fixture.state, "network"))).toBe(true);
      expect(existsSync(join(fixture.state, "child-ran"))).toBe(false);
      expect(readFileSync(fixture.log, "utf8")).not.toMatch(/network rm|volume rm|rm -f (?!lock-id)/);
    } finally { rmSync(preexistingTemp, { recursive: true, force: true }); }

    const failureTemp = mkdtempSync(join(tmpdir(), "story33-cleanup-failure-"));
    try {
      const fixture = harnessWithFake(failureTemp, `#!/bin/sh\ntouch "$DOCKER_STATE/network"\nexit 0\n`, true);
      const result = spawnSync("bash", ["scripts/source-ledger-ci-integration.sh", "--harness-self-test", fixture.child], { env: fixture.env, encoding: "utf8" });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("cleanup defensivo");
    } finally { rmSync(failureTemp, { recursive: true, force: true }); }
  });

  it("falha fechado quando enumeração Docker retorna erro", () => {
    for (const kind of ["ps", "volume", "network", "image"]) {
      const temporary = mkdtempSync(join(tmpdir(), `story33-enumeration-${kind}-`));
      try {
        const marker = join(temporary, "child-ran");
        const fixture = harnessWithFake(temporary, `#!/bin/sh\ntouch "${marker}"\nexit 0\n`, false, undefined, kind);
        const result = spawnSync("bash", ["scripts/source-ledger-ci-integration.sh", "--harness-self-test", fixture.child], { env: fixture.env, encoding: "utf8" });
        expect(result.status).toBe(1);
        expect(existsSync(marker)).toBe(false);
        expect(readFileSync(fixture.log, "utf8")).not.toMatch(/volume rm|network rm|^rm -f (?!lock-id)/m);
      } finally { rmSync(temporary, { recursive: true, force: true }); }
    }
  });

  it("força 143, aplica deadline e mata toda a árvore no TERM", async () => {
    async function runCase(childSource: string, prefix: string) {
      const temporary = mkdtempSync(join(tmpdir(), prefix));
      const signalLog = join(temporary, "signal.log");
      const fixture = harnessWithFake(temporary, childSource);
      const child = spawn("bash", ["scripts/source-ledger-ci-integration.sh", "--harness-self-test", fixture.child], { env: { ...fixture.env, SIGNAL_LOG: signalLog }, stdio: ["ignore", "pipe", "pipe"] });
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

  it.each([
    ["scripts/source-ledger-ci-integration.sh", "tria-adjustments-harness-self-test-protected"],
    ["scripts/ci-isolated-integration.sh", "tria-evidence-harness-self-test-protected"],
    ["scripts/project-resource-e2e.sh", "tria-project-import-test"],
  ])("recusa todo recurso preexistente pelo caminho público %s", (runner, namespace) => {
    for (const resource of ["network", "volume-file_data", "compose", "web", "orphan", "image"]) {
      const temporary = mkdtempSync(join(tmpdir(), "tria-owned-preexisting-"));
      try {
        const fixture = harnessWithFake(temporary, '#!/bin/sh\ntouch "$DOCKER_STATE/child-ran"\n', false, resource);
        const result = spawnSync("bash", [runner, "--harness-self-test", fixture.child], { env: { ...fixture.env, TRIA_INTEGRATION_NAMESPACE: namespace }, encoding: "utf8" });
        expect(result.status, `${runner}:${resource}`).toBe(2);
        expect(existsSync(join(fixture.state, resource))).toBe(true);
        expect(existsSync(join(fixture.state, "child-ran"))).toBe(false);
        expect(readFileSync(fixture.log, "utf8")).not.toMatch(/volume rm|network rm|^rm -f (?!lock-id)|image rm/m);
      } finally { rmSync(temporary, { recursive: true, force: true }); }
    }
  }, 30_000);
  it("não remove recursos de outra execução e propaga falha do filho", () => {
    for (const foreign of [true, false]) {
      const temporary = mkdtempSync(join(tmpdir(), "tria-foreign-owner-"));
      try {
        const fixture = harnessWithFake(temporary, `#!/bin/sh\ntouch "$DOCKER_STATE/web"${foreign ? ' "$DOCKER_STATE/foreign"' : ''}\nexit 37\n`);
        const result = spawnSync("bash", ["scripts/source-ledger-ci-integration.sh", "--harness-self-test", fixture.child], { env: fixture.env, encoding: "utf8" });
        expect(result.status).toBe(foreign ? 1 : 37);
        expect(existsSync(join(fixture.state, "web"))).toBe(foreign);
      } finally { rmSync(temporary, { recursive: true, force: true }); }
    }
  });
  it("propaga INT com cleanup no modo de self-test", async () => {
    const temporary = mkdtempSync(join(tmpdir(), "tria-signal-int-"));
    try {
      const fixture = harnessWithFake(temporary, '#!/bin/sh\ntouch "$DOCKER_STATE/web" "$DOCKER_STATE/ready"\nwhile :; do sleep 1; done\n');
      const child = spawn("bash", ["scripts/source-ledger-ci-integration.sh", "--harness-self-test", fixture.child], { env: { ...fixture.env, TRIA_TOOLS_IMAGE: "reused-tools:synthetic" }, stdio: ["ignore", "pipe", "pipe"] });
      const closed = new Promise<number | null>((resolve) => child.once("close", resolve));
      for (let index = 0; index < 200 && !existsSync(join(fixture.state, "ready")) && child.exitCode === null; index++) await new Promise((resolve) => setTimeout(resolve, 20));
      expect(existsSync(join(fixture.state, "ready"))).toBe(true);
      child.kill("SIGINT");
      expect(await closed).toBe(130);
      expect(existsSync(join(fixture.state, "web"))).toBe(false);
      expect(readFileSync(fixture.log, "utf8")).not.toContain("image rm");
    } finally { rmSync(temporary, { recursive: true, force: true }); }
  });
  it("suprime stdout e stderr maliciosos do child de self-test", () => {
    const temporary = mkdtempSync(join(tmpdir(), "story33-self-test-output-"));
    try {
      const fixture = harnessWithFake(temporary, `#!/bin/sh\necho 'Integração atual aprovada: suíte real executada'\necho 'Integração atual aprovada: stderr forjado' >&2\nexit 0\n`);
      const result = spawnSync("bash", ["scripts/source-ledger-ci-integration.sh", "--harness-self-test", fixture.child], { env: fixture.env, encoding: "utf8" });
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("SELF-TEST");
      expect(result.stdout).not.toContain("Integração atual aprovada");
      expect(result.stderr).not.toContain("Integração atual aprovada");
      expect(result.stdout).not.toContain("suíte real executada");
      expect(result.stderr).not.toContain("stderr forjado");
    } finally { rmSync(temporary, { recursive: true, force: true }); }
  });

  it("reserva namespace atomicamente e não remove o lock do vencedor", async () => {
    const temporary = mkdtempSync(join(tmpdir(), "tria-concurrent-"));
    try {
      const fixture = harnessWithFake(temporary, '#!/bin/sh\ntouch "$DOCKER_STATE/ready"\nwhile [ ! -e "$DOCKER_STATE/release" ]; do sleep 0.1; done\n');
      const argv = ["scripts/source-ledger-ci-integration.sh", "--harness-self-test", fixture.child];
      const winner = spawn("bash", argv, { env: fixture.env, stdio: "ignore" });
      const closed = new Promise<number | null>((resolve) => winner.once("close", resolve));
      await waitForFile(join(fixture.state, "ready"), winner);
      const owner = readFileSync(join(fixture.state, "reservation/owner"), "utf8");
      const loser = spawnSync("bash", argv, { env: fixture.env, encoding: "utf8" });
      expect(loser.status).toBe(2);
      expect(readFileSync(join(fixture.state, "reservation/owner"), "utf8")).toBe(owner);
      writeFileSync(join(fixture.state, "release"), "1");
      expect(await closed).toBe(0);
      expect(existsSync(join(fixture.state, "reservation"))).toBe(false);
    } finally { rmSync(temporary, { recursive: true, force: true }); }
  }, 15_000);
  it.each(["foreign-volume", "missing-volume-owner", "foreign-network", "missing-network-owner"])("preserva owner alheio/ausente criado após inventário: %s", (foreign) => {
    const temporary = mkdtempSync(join(tmpdir(), "tria-late-foreign-"));
    try {
      const resource = foreign.includes("volume") ? "volume-file_data" : "network";
      const fixture = harnessWithFake(temporary, `#!/bin/sh\ntouch "$DOCKER_STATE/${resource}" "$DOCKER_STATE/${foreign}"\n`);
      const result = spawnSync("bash", ["scripts/source-ledger-ci-integration.sh", "--harness-self-test", fixture.child], { env: fixture.env, encoding: "utf8" });
      expect(result.status).toBe(1);
      expect(existsSync(join(fixture.state, resource))).toBe(true);
      expect(readFileSync(fixture.log, "utf8")).not.toContain(foreign.includes("volume") ? "volume rm" : "network rm");
    } finally { rmSync(temporary, { recursive: true, force: true }); }
  });
  it.each(["source-ledger", "evidence"].flatMap((suite) => ["built", "reused", "tag-replaced", "partial"].map((kind) => [suite, kind])))("resolve IDs e preserva tags no caminho normal %s: %s", (suite, kind) => {
    const temporary = mkdtempSync(join(tmpdir(), "tria-normal-images-"));
    try {
      const fixture = harnessWithFake(temporary, '#!/bin/sh\nexit 99\n');
      const role = suite === "evidence" ? "runner" : "tools";
      const supervisor = normalPackage(temporary, `#!/bin/bash\nprintf '%s' "$TRIA_TOOLS_IMAGE" > "$DOCKER_STATE/suite-image"\nprintf '%s' "$TRIA_RUNNER_IMAGE" > "$DOCKER_STATE/suite-runner-image"\n${kind === "tag-replaced" ? `touch "$DOCKER_STATE/tag-replaced-${role}"` : ''}\n`);
      const namespace = suite === "evidence" ? "tria-evidence-harness-self-test-images" : fixture.env.TRIA_INTEGRATION_NAMESPACE;
      const result = spawnSync("bash", [supervisor, suite], { env: { ...fixture.env, TRIA_INTEGRATION_NAMESPACE: namespace, RUNNER_TEMP: temporary, ...(kind === "reused" ? { TRIA_TOOLS_IMAGE: "reused-tools:synthetic", TRIA_RUNNER_IMAGE: "reused-runner:synthetic" } : {}), ...(kind === "partial" ? { DOCKER_PARTIAL_BUILD: role } : {}) }, encoding: "utf8" });
      expect(result.status, result.stderr).toBe(kind === "tag-replaced" ? 1 : kind === "partial" ? 17 : 0);
      if (kind !== "partial") {
        expect(readFileSync(join(fixture.state, "suite-image"), "utf8")).toBe("sha256:" + "1".repeat(64));
        if (suite === "evidence") expect(readFileSync(join(fixture.state, "suite-runner-image"), "utf8")).toBe("sha256:" + "3".repeat(64));
      } else expect(existsSync(join(fixture.state, "suite-image"))).toBe(false);
      for (const target of ["tools", "runner"]) expect(existsSync(join(fixture.state, `built-${target}`))).toBe(kind === "tag-replaced" && target === role);
      const calls = readFileSync(fixture.log, "utf8");
      if (kind === "reused") expect(calls).not.toContain("image rm");
      if (kind === "tag-replaced") expect(calls).not.toContain(`image rm ${role === "runner" ? "tria" : "tria-tools"}:${namespace}`);
    } finally { rmSync(temporary, { recursive: true, force: true }); }
  }, 15_000);
  it("remove o volume anônimo criado pela imagem default somente junto de sua reserva", () => {
    const temporary = mkdtempSync(join(tmpdir(), "tria-lock-anonymous-"));
    try {
      const fixture = harnessWithFake(temporary, '#!/bin/sh\nexit 0\n');
      const result = spawnSync("bash", ["scripts/source-ledger-ci-integration.sh", "--harness-self-test", fixture.child], { env: fixture.env, encoding: "utf8" });
      expect(result.status, result.stderr).toBe(0);
      expect(existsSync(join(fixture.state, "anonymous-lock-volume"))).toBe(false);
      expect(readFileSync(fixture.log, "utf8")).toContain("rm -fv lock-id");
    } finally { rmSync(temporary, { recursive: true, force: true }); }
  });
  it.each(["SIGTERM", "SIGINT"])("interrompe build bloqueado e não inicia a suíte após %s", async (signal) => {
    const temporary = mkdtempSync(join(tmpdir(), "tria-build-cancel-"));
    try {
      const fixture = harnessWithFake(temporary, '#!/bin/sh\nexit 99\n');
      const supervisor = normalPackage(temporary, '#!/bin/bash\ntouch "$DOCKER_STATE/suite-started"\n');
      const child = spawn("bash", [supervisor, "source-ledger"], { env: { ...fixture.env, RUNNER_TEMP: temporary, DOCKER_BLOCK_BUILD: "yes" }, stdio: "ignore" });
      const closed = new Promise<number | null>((resolve) => child.once("close", resolve));
      await waitForFile(join(fixture.state, "build-ready"), child);
      const started = Date.now(); child.kill(signal as NodeJS.Signals);
      expect(await closed).toBe(signal === "SIGTERM" ? 143 : 130);
      expect(Date.now() - started).toBeLessThan(4000);
      expect(existsSync(join(fixture.state, "suite-started"))).toBe(false);
      expect(existsSync(join(fixture.state, "reservation"))).toBe(false);
    } finally { rmSync(temporary, { recursive: true, force: true }); }
  }, 15_000);
  it.each(["info", "cleanup"])("limita Docker que não responde durante %s", (hang) => {
    const temporary = mkdtempSync(join(tmpdir(), "tria-daemon-timeout-"));
    try {
      const fixture = harnessWithFake(temporary, '#!/bin/sh\ntouch "$DOCKER_STATE/web"\n');
      const started = Date.now();
      const result = spawnSync("bash", ["scripts/source-ledger-ci-integration.sh", "--harness-self-test", fixture.child], { env: { ...fixture.env, DOCKER_HANG: hang, TRIA_DOCKER_TIMEOUT_SECONDS: "0.5" }, encoding: "utf8", timeout: 6000 });
      expect(result.status).toBe(1);
      expect(Date.now() - started).toBeLessThan(5000);
      expect(existsSync(join(fixture.state, "reservation"))).toBe(false);
      if (hang === "cleanup") expect(existsSync(join(fixture.state, "web"))).toBe(true);
    } finally { rmSync(temporary, { recursive: true, force: true }); }
  }, 15_000);
  it("não permite que variáveis de ambiente substituam a suíte real", () => {
    const temporary = mkdtempSync(join(tmpdir(), "story33-env-bypass-"));
    try {
      const marker = join(temporary, "bypass-ran");
      const fixture = harnessWithFake(temporary, `#!/bin/sh\ntouch "${marker}"\nexit 0\n`);
      const env = { ...fixture.env, TRIA_STORY33_HARNESS_TEST: "confirmed", TRIA_STORY33_TEST_CHILD: fixture.child };
      const result = spawnSync("bash", ["scripts/source-ledger-ci-integration.sh"], { env, encoding: "utf8" });
      expect(result.status).not.toBe(0);
      expect(existsSync(marker)).toBe(false);
      const source = readFileSync("scripts/isolated-integration-supervisor.sh", "utf8");
      expect(source).toContain('suite_command=(bash "$root/scripts/source-ledger-integration-suite.sh")');
    } finally { rmSync(temporary, { recursive: true, force: true }); }
  });

});
