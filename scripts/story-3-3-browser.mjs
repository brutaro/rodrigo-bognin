import { mkdir, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const base = process.env.STORY33_BASE_URL;
const output = process.env.STORY33_EVIDENCE_DIR;
if (!base || !/^http:\/\/127\.0\.0\.1:\d+$/.test(base)) throw new Error("Loopback browser target required");
if (!output) throw new Error("STORY33_EVIDENCE_DIR is required");
await mkdir(output, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 320, height: 900 } });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });

async function tabTo(target) {
  await target.scrollIntoViewIfNeeded();
  for (let count = 0; count < 140; count += 1) {
    if (await target.evaluate((element) => element === document.activeElement)) return;
    await page.keyboard.press("Tab");
  }
  throw new Error("Controle inacessível pela navegação sequencial por teclado");
}

async function activate(target) {
  await tabTo(target);
  await page.keyboard.press("Enter");
}

async function toggle(target) {
  await tabTo(target);
  await page.keyboard.press("Space");
}

async function chooseByKeyboard(target, value) {
  await tabTo(target);
  const option = await target.locator("option").evaluateAll((options, expected) => {
    const found = options.find((candidate) => candidate.value === expected);
    return found ? { value: found.value, label: found.textContent ?? "" } : undefined;
  }, value);
  assert.ok(option, `Opção ${value} não encontrada`);
  await page.keyboard.press("Home");
  await page.keyboard.type(option.label, { delay: 5 });
  await page.keyboard.press("Tab");
  assert.equal(await target.inputValue(), value);
}

async function assertNoOverflow(state) {
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
    true,
    `overflow horizontal em ${state}`,
  );
}

async function login() {
  await page.goto(`${base}/fontes/base-consolidada`);
  if (!page.url().endsWith("/entrar")) return;
  await page.getByLabel("Código de acesso").fill(process.env.STORY33_LOGIN_CODE);
  await activate(page.getByRole("button", { name: "Entrar", exact: true }));
  await page.waitForURL(`${base}/`);
  await page.goto(`${base}/fontes/base-consolidada`);
}

async function protectAndConfirmPreview() {
  const file = page.getByLabel("Arquivo sintético", { exact: true });
  await tabTo(file);
  const choosing = page.waitForEvent("filechooser");
  await page.keyboard.press("Space");
  await (await choosing).setFiles({
    name: "story-3-3.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("codigo;referencia;data;valor;duracao\nATUALIZADA;RF-UPDATED;2026-01-01;10.50;01:02\nIGUAL;RF-UNCHANGED;2026-01-01;99.90;00:30\nNOVO-LINK;;2026-01-01;10.50;02:03\nNOVO-CRIAR;;2026-01-01;11.50;03:04\nREJEITADA;;bad;abc;bad-duration\n"),
  });
  await activate(page.getByRole("button", { name: "Receber e proteger", exact: true }));
  await page.getByRole("article", { name: "Recibo de proteção" }).waitFor();
  await chooseByKeyboard(page.getByLabel("Codificação", { exact: true }), "utf-8");
  await chooseByKeyboard(page.getByLabel("Delimitador", { exact: true }), ";");
  await activate(page.getByRole("button", { name: "Inspecionar estrutura", exact: true }));
  await page.getByLabel("Coluna codigo", { exact: true }).waitFor();
  for (const field of ["codigo", "referencia", "data", "valor", "duracao"]) await chooseByKeyboard(page.getByLabel(`Coluna ${field}`, { exact: true }), field);
  await activate(page.getByRole("button", { name: "Preparar prévia", exact: true }));
  await page.getByRole("article", { name: "Prévia preparada", exact: true }).waitFor();
  await toggle(page.getByLabel("Conferi as contagens e as linhas desta prévia"));
  await activate(page.getByRole("button", { name: "Confirmar esta prévia", exact: true }));
  await page.getByRole("article", { name: "Resultado da confirmação" }).waitFor();
}

try {
  if (!process.env.STORY33_LOGIN_CODE) throw new Error("STORY33_LOGIN_CODE is required");
  await login();
  await protectAndConfirmPreview();
  await assertNoOverflow("prévia confirmada a 320px");

  const reconciliation = page.getByRole("heading", { name: "Reconciliar e aplicar observações recorrentes" });
  await reconciliation.waitFor();
  const compare = page.getByRole("button", { name: "Comparar prévia confirmada", exact: true });
  await activate(compare);
  await page.getByText("aguarda decisões", { exact: false }).waitFor();
  await assertNoOverflow("comparação interativa a 320px");

  const summary = page.getByLabel("Resumo da reconciliação");
  const lines = page.getByLabel("Linhas reconciliadas");
  const conflictFilter = summary.getByRole("button", { name: /Conflitos/ });
  const rejectedFilter = summary.getByRole("button", { name: /Rejeitadas/ });
  const insertedFilter = summary.getByRole("button", { name: /Inseridas/ });
  await activate(conflictFilter);
  assert.equal(await conflictFilter.evaluate((element) => element === document.activeElement), true);
  assert.equal(await conflictFilter.getAttribute("aria-pressed"), "true");

  // Exercise every category exposed by the official summary. A fixture may
  // legitimately have zero rows in a category; record that fact instead of
  // claiming an interaction that did not occur.
  const categoryCoverage = {};
  for (const [name, pattern] of [["inserted", /Inseridas/], ["updated", /Atualizadas/], ["unchanged", /Inalteradas/], ["rejected", /Rejeitadas/], ["conflict", /Conflitos/]]) {
    const control = summary.getByRole("button", { name: pattern });
    const count = Number((await control.innerText()).match(/:\s*(\d+)/)?.[1] ?? 0);
    categoryCoverage[name] = count;
    if (count > 0) {
      await activate(control);
      assert.equal(await control.getAttribute("aria-pressed"), "true");
      assert.ok(await lines.locator("article").count() > 0, `categoria ${name} precisa renderizar linhas`);
      if (name === "updated") {
        const locators = await lines.locator("article h3").allTextContents();
        assert.ok(locators.every((text) => text.includes("row:2") && text.includes("Atualizadas")), `Atualizadas fora do recorte esperado: ${locators.join(" | ")}`);
      }
      if (name === "unchanged") {
        const locators = await lines.locator("article h3").allTextContents();
        assert.ok(locators.every((text) => text.includes("row:3") && text.includes("Inalteradas")), `Inalteradas fora do recorte esperado: ${locators.join(" | ")}`);
      }
    }
  }
  await activate(conflictFilter);
  assert.equal(await lines.locator("article").count(), 2);
  const manualLinkRecordId = "53000000-0000-4000-8000-000000000060";
  const linkConflictLine = lines.locator("article").filter({ hasText: "row:4 — Conflitos" });
  await linkConflictLine.getByText(/Conflito: Não há candidato comprovado/).waitFor();
  await activate(linkConflictLine.getByText("Origem e proveniência da observação", { exact: true }));
  assert.equal(await linkConflictLine.locator("details").getAttribute("open"), "");
  assert.ok(await page.evaluate(() => Object.entries(sessionStorage).some(([key, value]) => key.endsWith(":drilldowns") && Object.values(JSON.parse(value)).some(Boolean))), "O drill-down aberto precisa ser persistido na sessão");
  await linkConflictLine.getByText(/Valores de origem/).waitFor();
  await linkConflictLine.getByText(/Decimais preservados/).waitFor();
  await linkConflictLine.getByText(/Durações preservadas/).waitFor();
  assert.match(await linkConflictLine.innerText(), /duracao: 02:03 \(clock\)/, "A duração original deve aparecer antes da aplicação");
  await activate(rejectedFilter);
  assert.equal(await rejectedFilter.evaluate((element) => element === document.activeElement), true);
  assert.equal(await rejectedFilter.getAttribute("aria-pressed"), "true");
  assert.equal(await lines.locator("article").count(), 1);
  await lines.locator("article").filter({ hasText: "row:6 — Rejeitadas" }).waitFor();
  await activate(conflictFilter);
  assert.equal(await conflictFilter.evaluate((element) => element === document.activeElement), true);
  assert.equal(await conflictFilter.getAttribute("aria-pressed"), "true");

  const searchInput = linkConflictLine.getByLabel("Buscar registro estável para row:4", { exact: true });
  await tabTo(searchInput);
  await page.keyboard.type("rf81_fixture", { delay: 5 });
  assert.equal(await searchInput.inputValue(), "rf81_fixture");
  await activate(linkConflictLine.getByRole("button", { name: "Buscar", exact: true }));
  await linkConflictLine.getByText("Página 1 de 2 — 52 registro(s)", { exact: true }).waitFor();
  const stablePagination = linkConflictLine.getByLabel("Paginação de registros estáveis", { exact: true });
  await activate(stablePagination.getByRole("button", { name: "Próxima", exact: true }));
  await linkConflictLine.getByText("Página 2 de 2 — 52 registro(s)", { exact: true }).waitFor();
  const targetSelect = linkConflictLine.getByLabel("Registro estável para row:4", { exact: true });
  await chooseByKeyboard(targetSelect, manualLinkRecordId);
  assert.equal(await targetSelect.inputValue(), manualLinkRecordId);
  await linkConflictLine.getByLabel("Contexto efetivo do registro selecionado", { exact: true }).waitFor();
  await activate(linkConflictLine.getByRole("button", { name: "Vincular registro selecionado", exact: true }));
  const linkedAudit = page.getByLabel("Decisão auditada para row:4", { exact: true });
  await linkedAudit.waitFor();
  assert.match(await linkedAudit.innerText(), new RegExp(manualLinkRecordId));

  await activate(conflictFilter);
  const createConflictLine = lines.locator("article").filter({ hasText: "row:5 — Conflitos" });
  await createConflictLine.waitFor();
  await activate(createConflictLine.getByRole("button", { name: "Criar identidade", exact: true }));
  await page.getByText("pronta para aplicar", { exact: false }).waitFor();
  await activate(insertedFilter);
  assert.equal(await insertedFilter.evaluate((element) => element === document.activeElement), true);
  assert.equal(await insertedFilter.getAttribute("aria-pressed"), "true");
  assert.equal(await lines.locator("article").count(), 1);
  await lines.locator("article").filter({ hasText: "row:5 — Inseridas" }).waitFor();
  await activate(summary.getByRole("button", { name: /Atualizadas/ }));
  assert.equal(await lines.locator("article").filter({ hasText: "row:4 — Atualizadas" }).count(), 1);
  assert.match(await page.getByLabel("Decisão auditada para row:4", { exact: true }).innerText(), new RegExp(manualLinkRecordId));
  await activate(rejectedFilter);
  assert.equal(await rejectedFilter.evaluate((element) => element === document.activeElement), true);
  assert.equal(await rejectedFilter.getAttribute("aria-pressed"), "true");
  assert.equal(await lines.locator("article").count(), 1);
  await lines.locator("article").filter({ hasText: "row:6 — Rejeitadas" }).waitFor();
  const absences = page.getByLabel("Ausências").locator("li");
  assert.ok(await absences.count() > 0, "A fixture precisa conter uma ausência real");
  const absence = absences.filter({ hasText: "00000000-0000-4000-8000-000000000001" });
  assert.equal(await absence.count(), 1, "A fixture de ausência precisa permanecer no recorte");
  const absenceText = await absence.innerText();
  assert.match(absenceText, /ID: [0-9a-f-]{36}/i);
  assert.match(absenceText, /payload vigente:/);
  assert.match(absenceText, /versão: [0-9]+/);
  const absenceNext = page.getByRole("navigation", { name: "Paginação das ausências" }).getByRole("button", { name: "Próxima página", exact: true });
  await activate(absenceNext);
  await page.getByText(/Ausências: página 2 de/).waitFor();
  const pageTwoAbsences = page.getByLabel("Ausências").locator("li");
  await pageTwoAbsences.first().waitFor();
  assert.ok(await pageTwoAbsences.count() > 0, "A página 2 de ausências precisa conter linhas");
  const pageTwoIds = await pageTwoAbsences.evaluateAll((items) => items.map((item) => item.textContent?.match(/ID: ([0-9a-f-]{36})/i)?.[1]).filter(Boolean));
  assert.equal(new Set(pageTwoIds).size, pageTwoIds.length, "IDs de ausências devem ser únicos");
  await activate(summary.getByRole("button", { name: /Todas/ }));
  assert.equal(await summary.getByRole("button", { name: /Todas/ }).evaluate((element) => element === document.activeElement), true);
  await assertNoOverflow("decisão e filtro de rejeitadas a 320px");

  const apply = page.getByRole("button", { name: "Confirmar e aplicar recorte aceito", exact: true });
  await activate(apply);
  await page.getByText("aplicada", { exact: false }).waitFor();
  await page.getByText(/versão da projeção [1-9][0-9]*/).waitFor();
  await assertNoOverflow("resultado aplicado a 320px");

  const replay = page.getByRole("button", { name: "Repetir aplicação idempotente", exact: true });
  await activate(replay);
  await page.getByText("Aplicação reutilizada; nenhum efeito novo foi criado.", { exact: true }).waitFor();
  await assertNoOverflow("replay idempotente a 320px");

  await page.reload();
  await page.getByText("Reconciliação reaberta após o reload.", { exact: true }).waitFor();
  await page.getByText("aplicada", { exact: false }).waitFor();
  await page.getByRole("button", { name: "Repetir aplicação idempotente", exact: true }).waitFor();
  assert.ok(await page.evaluate(() => Object.entries(sessionStorage).some(([key, value]) => key.endsWith(":drilldowns") && Object.values(JSON.parse(value)).some(Boolean))), "O drill-down persistido precisa sobreviver ao reload");
  const reloadedDrilldown = page.getByRole("article").filter({ hasText: "row:4 — Atualizadas" }).locator("details").first();
  await reloadedDrilldown.waitFor();
  await page.waitForFunction(() => [...document.querySelectorAll("article")].find((article) => article.textContent?.includes("row:4 — Atualizadas"))?.querySelector("details")?.open === true);
  assert.equal(await reloadedDrilldown.getAttribute("open"), "");
  const reloadedLinkAudit = page.getByLabel("Decisão auditada para row:4", { exact: true });
  await reloadedLinkAudit.waitFor();
  assert.match(await reloadedLinkAudit.innerText(), new RegExp(manualLinkRecordId));
  await page.getByRole("article").filter({ hasText: "row:5 — Inseridas" }).waitFor();
  const reloadedAbsenceText = await page.getByLabel("Ausências").locator("li").filter({ hasText: "00000000-0000-4000-8000-000000000001" }).innerText();
  assert.equal(reloadedAbsenceText, absenceText);
  const reloadedAbsenceNext = page.getByRole("navigation", { name: "Paginação das ausências" }).getByRole("button", { name: "Próxima página", exact: true });
  await activate(reloadedAbsenceNext);
  await page.getByText(/Ausências: página 2 de/).waitFor();
  const reloadedPageTwoAbsences = page.getByLabel("Ausências").locator("li");
  await reloadedPageTwoAbsences.first().waitFor();
  assert.ok(await reloadedPageTwoAbsences.count() > 0, "A página 2 de ausências deve sobreviver ao reload");
  assert.match(await page.getByRole("article").filter({ hasText: "row:4 — Atualizadas" }).innerText(), /duracao: 02:03 \(clock\)/, "A duração deve sobreviver ao reload");
  await assertNoOverflow("reload do resultado a 320px");
  assert.deepEqual(errors, []);
  await page.screenshot({ path: `${output}/story-3-3-mobile-reloaded.png`, fullPage: true });
  await writeFile(`${output}/story-3-3-browser-result.json`, JSON.stringify({
    verdict: "PASS",
    journeys: ["prévia confirmada → comparação → filtro de conflitos → drill-down de proveniência → Buscar manual → página 2 de registros estáveis → seleção de ID opaco → vínculo auditado → criação explícita de identidade separada → aplicação → replay idempotente → reload"],
    categories: categoryCoverage,
    checks: ["viewport 320px desde a comparação", "Tab/Enter/Space e seleção de opções por teclado", "Buscar manual sem Server Action por tecla", "paginação de target por cursor até a página 2", "seleção de ID opaco e envio exato no link", "ID selecionado visível na decisão auditada e após reload", "filtros das cinco categorias com aria-pressed quando há linhas", "drill-down de proveniência com locator, valores, decimais e durações preservados", "criação explícita separada com linha inserida", "ausência observada no lote", "replay sem novo efeito", "reload", "ausência de overflow nos estados interativos"],
    errors,
  }, null, 2));
  console.log(`G-33-13 browser PASS: ${output}`);
  console.log(`G33-14 browser PASS: ${output}`);
} catch (error) {
  await page.screenshot({ path: `${output}/story-3-3-failure.png`, fullPage: true }).catch(() => undefined);
  await writeFile(`${output}/story-3-3-failure.txt`, `${String(error)}\n${await page.locator("body").innerText().catch(() => "")}`);
  throw error;
} finally {
  await browser.close();
}
