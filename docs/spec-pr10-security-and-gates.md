---
title: 'PR 10: liberar uma atualização segura com preservação do cofre'
type: chore
created: '2026-11-05'
status: done
baseline_commit: '453b092a6ff616568d0155f81ab732d704b2621c'
review_loop_iteration: 0
context: ['docs/ISOLAMENTO.md', 'docs/deploy-github-railway.md', 'AGENTS.md']
---

<frozen-after-approval reason="Pedido explícito do usuário: corrigir vulnerabilidades e gates, preservar arquivos e solicitar autorização antes de merge">

## Intent

**Problema:** o PR 10 muda somente a apresentação de evidências, porém a aplicação possui dependências vulneráveis e gates locais acoplados a fotografias antigas. É necessário preparar uma versão verificável sem substituir dados, evidências ou PDFs do proprietário.

**Abordagem:** atualizar dependências dentro das versões compatíveis, corrigir o isolamento de tipos e tornar os gates de preservação e integração úteis para o código atual. Manter evidências históricas e provar preservação por testes sintéticos e conferência somente leitura da produção.

## Boundaries & Constraints

**Sempre:** preservar a alteração funcional do PR; operar no worktree e na branch `fix/pr10-quality-gates`; preservar arquivos externos, volumes reais, secrets, PDFs e backups; reutilizar imagens e identificar recursos sintéticos por namespace; usar documentação Next instalada. O responsável principal fará as operações Railway e os testes Docker integrais após a implementação.

**Pedir antes:** merge e qualquer deploy, apply de infraestrutura, troca de volume ou escrita em dados de produção.

**Nunca:** restaurar a documentação externa para agosto, importar dados reais, executar seeds em produção, alterar migrações aplicadas, ignorar erros de tipos, reduzir expectativas de preservação ou apresentar gate ignorado como aprovado. Não fazer commit, push ou operações remotas nesta implementação.

## I/O & Edge-Case Matrix

| Cenário | Estado | Resultado | Falha |
|---|---|---|---|
| Preservação atual | Origens iguais à captura aprovada | Verificação somente leitura passa | Qualquer conteúdo, conjunto, symlink ou manifesto adulterado falha |
| Worktree | Raízes externas fora do pai do checkout | Origem real descoberta via Git comum ou fornecida explicitamente | Origem ausente ou incorreta falha, sem fallback silencioso |
| Integração atual | Código evoluído e namespace sintético novo | PostgreSQL e jornadas browser 3.2/3.3 executam | Namespace real/preexistente, enumeração ou cleanup falho recusados |
| Atualização | Banco preenchido e PDFs existentes | Migração repetida preserva banco e bytes | Divergência falha nos testes existentes |

</frozen-after-approval>

## Code Map

- `package.json`, `package-lock.json`: Next 16.3.3, Zod 4.5.2, Vitest 4.1.11; auditoria anterior 16 alertas, quatro em produção. npm consulta atual confirmou Next/eslint-config-next 16.4.5, Zod 4.6.7, Vitest 4.1.12, Vite 8.3.6, Sharp 0.35.5 e source-map-js 1.2.2. Usar cache npm `/private/tmp/tria-pr10-npm-cache`; evitar upgrade major desnecessário.
- `tsconfig.json`: tipos ambientais de Bun de um diretório ancestral poluem o macOS. `typeRoots: ["./node_modules/@types"]` já validado por CLI elimina o erro sem casts ou supressões.
- `scripts/verify-protected-origin.mjs`, `docs/protected-origin-manifest.json`: gate assume ancestral do checkout. Origens reais estão em `/Users/brutx/Documents/projects/RODRIGO-BOGNIN/{_bmad,_bmad-output,.agents}`. Há adições de planejamento/render, seis documentos evoluídos e cinco caches .pyc removidos desde agosto; não foram mudanças do PR. Preservar manifesto histórico byte a byte, hash `b9b2979be4e5174dc1b1a49f55377db0e32e9e4d320c7b94c6bee98648f35bfa`.
- `scripts/story-3-3-isolated-integration.sh`, `scripts/verify-story-3-3-baseline.mjs`, `tests/contracts/story-3-3-baseline.json`: snapshot histórico exige bytes integrais de lockfile/health/workflow e não serve como gate atual. Manter a evidência histórica, sem atualizar hashes para esconder evolução.
- `scripts/source-ledger-ci-integration.sh`: caminho atual com namespaces próprios e PostgreSQL 3.2/3.3, ainda sem browsers e com cleanup que suprime erros. O runner antigo possui provas úteis de ownership/sinais/cleanup e não deve ser simplesmente copiado com acoplamentos antigos.
- `tests/architecture/story-3-3-integration-harness.historical.ts`: provas de snapshot ficam históricas; extrair provas relevantes de isolamento para testes ativos. `source-ledger-boundaries.test.ts` deve refletir o runner vigente.
- `scripts/story-3-2-browser.mjs`, `scripts/story-3-3-browser.mjs`, `scripts/seed-story-3-3-reconciliation.mjs`: jornadas existentes a executar em ambiente sintético. Secrets sintéticos devem ser legíveis por UID 1001 sem expor secrets reais; preferir mounts individuais readonly. Nenhuma tag global de tools pode ser sobrescrita.
- `.github/workflows/ci-deploy.yml`: CI atual e deploy separado condicionado a push/main; preservar esse bloqueio. `tests/integration/upgrade-preservation.integration.test.ts` compara tabelas e PDFs nas migrações 45/50 e repetição.

## Tasks & Acceptance

**Execução:**
- [x] Atualizar dependências e transitivas sem alertas; alinhar eslint-config-next com Next e manter engines compatíveis com Node 22. Adicionar `security:audit` ao CI com falha em qualquer alerta.
- [x] Restringir tipos do TypeScript ao projeto, mantendo strict e build verificável.
- [x] Criar baseline atual explícita das origens, ancorada no código; preservar manifesto anterior e relatório de reconciliação. `verify` não pode recapturar nem aceitar hash arbitrário. Validar esquema, contagens, digest canônico, caminhos e arquivos regulares sem seguir symlinks. Não modificar as origens.
- [x] Fazer os comandos npm de integração atual executarem PostgreSQL e browsers sem depender de hashes antigos. Manter histórico claramente identificado; preservar e testar ownership, namespace, cleanup, sinais, proteção de saída e suíte fixa. Usar tags/IDs próprios e limpeza verificável.
- [x] Adicionar testes de falha reais dos verificadores e do isolamento; documentar comandos atuais e limites históricos. Não gerar fixtures com dados reais.

**Critérios:** Given dependências atualizadas, when `npm audit` completo e produção executam, then zero alertas. Given origem capturada e depois alterada/symlink/manifesto adulterado, when gate executa, then recusa sem escrita. Given namespace preexistente, when runner inicia, then preserva recursos. Given suíte atual, when execução termina ou recebe sinal, then remove somente seus recursos e propaga falhas. Given banco preenchido e cofre, when upgrades repetem, then registros e bytes permanecem iguais.

## Spec Change Log

## Design Notes

A nova captura prova preservação desde esta tarefa; não afirma identidade contínua desde agosto. Alterações legítimas de dependências não devem exigir reatestar o snapshot de uma story antiga. A validação Railway pertence ao responsável principal, por leitura, sem incluí-la em scripts de teste ou CI com secrets de produção.

## Verification

- `npm run security:audit`, `npm run check`, `npm run railway:check`, `git diff --check`, `npm run release:scan`.
- `npm run origin:verify` na origem real e testes negativos com fixtures temporárias.
- Builds Docker tools/runner; `npm run test:ci-integration`; comando npm da integração completa 3.3; `bash scripts/project-resource-e2e.sh`.
- Principal: volume `tria-file-vault`, `/data/files`, produção, uma réplica, bootstrap disabled, UUID/banco/objetos consistentes; sem mutação e sem merge.


### Implementação e verificação local — 2026-11-05

- Dependências: Next/eslint-config-next 16.4.5, Zod 4.6.7, Vitest 4.1.12;
  transitivas corrigidas (incluindo Vite 8.3.6, Sharp 0.35.5 e source-map-js
  1.2.2). Override somente no minimatch de typescript-estree para 11.0.1,
  necessário para eliminar a vulnerabilidade restante e compatível com Node 22.
- `npm run security:audit`: auditoria completa e produção com zero alertas,
  usando limiar `info`. Gate incluído no CI; deploy continua limitado a push/main
  após o job `ci`.
- `npm run check`: 58 arquivos e 515 testes aprovados; lint sem warnings;
  build Next e validação TypeScript aprovados, mantendo `strict`.
- `npm run railway:check`, `npm run release:scan` e `git diff --check`: aprovados.
- `npm run origin:verify`: aprovado na origem real descoberta via Git comum.
  Manifesto histórico intacto; captura atual com 46/105/243 arquivos nas três
  árvores. Relatório registra 11/45 adições, seis documentos evoluídos e cinco
  caches removidos anteriormente à captura atual.
- Testes ativos com fixtures sintéticas comprovam alterações, adições,
  remoções, entradas especiais, symlinks e adulteração de manifestos; descoberta
  por worktree; ownership, namespaces preexistentes nos três runners públicos,
  falhas de enumeração/cleanup, proprietário diferente, saída de self-test,
  suíte fixa e sinais INT/TERM com prazo.
- As suítes atuais usam supervisor comum e imagens reutilizadas por ID; a suíte
  3.3 executa também PostgreSQL e browser 3.2. Evidências/bootstrap e projetos
  receberam a mesma proteção de ownership e cleanup. Snapshots históricos e
  migrações aplicadas permanecem intactos.

Os builds Docker e as integrações reais foram concluídos pelo responsável
principal, conforme os resultados finais abaixo. Nenhum preflight ou teste de
harness foi apresentado como execução Docker/browser integral. A conferência
Railway foi somente leitura; nenhum deploy, apply, merge, commit, push ou escrita
de produção foi realizado pela implementação.


### Revisão adversarial e correções adicionais — 2026-11-05

- Namespace reservado atomicamente por nome de container parado no daemon,
  sem adoção ou exclusão de reserva alheia; API oficial conferida e teste real
  com duas criações concorrentes aprovado. Inventário usa IDs completos.
- Builds e suíte inteira supervisionados com cancelamento INT/TERM. Inventário,
  inspect e cleanup têm timeout real portável; falha ao terminar grupo não
  dispara espera bloqueante. Testes de build bloqueado e daemon/cleanup sem
  resposta aprovados.
- Imagens construídas passam aos filhos pelos IDs dos iidfiles. Testes no
  caminho normal cobrem construção, reutilização, tag substituída e falha parcial
  de build; volumes/redes criados depois do inventário com owner alheio ou ausente
  sobrevivem e tornam o gate vermelho.
- Diagnósticos sintéticos permitidos (logs, screenshots e resultados) são
  preservados fora do checkout e enviados com upload-artifact apenas em falha.
  Teste garante exclusão de secrets, overrides, perfis e inputs.
- Cópia standalone corrigida para o conteúdo de public/static, com smoke HTTP
  da logo. Erros de console continuam fatais; respostas HTTP >=400 são registradas.
  Prontidão curl tem connect-timeout/max-time e bootstrap exige health real.
- Origem usa O_NONBLOCK, revalida identidade/stat ao final e trata troca por
  FIFO sem bloquear. Publicação do par captura/relatório desfaz somente seu inode
  em falha tratável da segunda publicação. Limites contra escritor hostil e queda
  abrupta estão documentados.
- `npm run check`: 58 arquivos/515 testes, lint e build aprovados. Auditorias
  completa/produção continuam em zero; origin, railway, release scan e diff check
  aprovados. O responsável principal concluiu o rerun Docker integral nas
  imagens atualizadas, registrado abaixo; provas de harness não o substituem.

### Execução integral e revisão final — 2026-11-05

O responsável principal concluiu as execuções reais nas imagens atualizadas:

- Evidências: crash/resume, bootstrap efetivo e HTTP aprovados.
- Source ledger: 18 testes PostgreSQL 3.2 e 57 PostgreSQL 3.3 aprovados;
  browser 3.2 e 3.3 aprovados (`G-13`, `G-33-13`, `G33-14`), sem erros de console.
- Projetos: jornadas desktop/mobile e 11 testes PostgreSQL aprovados, incluindo
  preservação nas migrações 45/50 e repetição.
- Logs sintéticos: `/private/tmp/tria-pr10-final-ci-integration.log` e
  `/private/tmp/tria-pr10-final-project-e2e.log`.

A revisão posterior ficou limitada ao cleanup da reserva, coletor de artefatos
e seus testes. `rm -fv` remove o volume anônimo da própria reserva; uma prova
real registrou `.Mounts` e confirmou sua remoção. Volumes anônimos antigos sem
atribuição comprovada não foram removidos. Testes recusam symlinks de execução,
subdiretórios e folhas do destino dos artefatos com os alvos intactos. O ciclo
NORMAL de imagens cobre source-ledger e evidence, incluindo ID distinto do runner,
reutilização, falha parcial e substituição de tag. O CI do commit final executará
novamente todos os gates integrais.


Verificação após os três ajustes finais: `npm run check` aprovado com 58 arquivos
e 515 testes, lint sem warnings e build Next/TypeScript verde. `security:audit`
completo/produção, origin, railway e diff check aprovados. O teste real do lock
registrou o volume anônimo
`fd5b5ed68f191a266bf48e4eb08f5bc825aefbbed60ebebc9be0386ed722e9c5`
associado à própria reserva e confirmou sua ausência depois de `rm -fv`.
Nenhum volume anônimo anterior sem atribuição comprovada foi removido.

## Suggested Review Order

**Entrada e segurança**

- Auditoria e integrações impedem publicar uma release com gates falhos.
  [ci-deploy.yml:27](../.github/workflows/ci-deploy.yml#L27)

- Dependências corrigidas e auditoria completa, incluindo produção.
  [package.json:26](../package.json#L26)

**Preservação e isolamento**

- Reserva exclusiva e propriedade explícita protegem recursos preexistentes.
  [isolated-integration-supervisor.sh:188](../scripts/isolated-integration-supervisor.sh#L188)

- A limpeza limita-se aos recursos próprios e à reserva descartável.
  [isolated-integration-supervisor.sh:119](../scripts/isolated-integration-supervisor.sh#L119)

- Cancelamentos e deadlines abrangem builds, suíte e comandos de controle.
  [run-bounded.mjs:5](../scripts/lib/run-bounded.mjs#L5)

- A captura atual é ancorada; o histórico permanece intacto.
  [verify-protected-origin.mjs:6](../scripts/verify-protected-origin.mjs#L6)

- Diagnósticos ficam fora do checkout e recusam destinos simbólicos.
  [save-integration-artifacts.mjs:37](../scripts/lib/save-integration-artifacts.mjs#L37)

**Jornadas e comprovação**

- Assets corretos permitem executar jornadas completas sem erros de console.
  [source-ledger-integration-suite.sh:90](../scripts/source-ledger-integration-suite.sh#L90)

- Testes exercitam concorrência, cancelamento, ownership e ciclo de imagens.
  [current-integration-harness.test.ts:168](../tests/architecture/current-integration-harness.test.ts#L168)

- Fixtures provam contenção dos artefatos e preservação dos alvos.
  [integration-diagnostics.test.ts:6](../tests/architecture/integration-diagnostics.test.ts#L6)

- A verificação de origem recusa adulteração com fixtures isoladas.
  [protected-origin.test.ts:22](../tests/architecture/protected-origin.test.ts#L22)

- Tipos do projeto deixam de receber definições ambientais externas.
  [tsconfig.json:8](../tsconfig.json#L8)

### Correções de portabilidade do CI do PR 11 — 2026-11-05

O CI de `b889f83` revelou duas causas nas fixtures, sem falha de aplicação:

- O teste de instabilidade pressupunha a ordem de `opendir`. Em ext4, o
  diretório podia vir primeiro e disparar a mutação antes da leitura do arquivo.
  A fixture agora controla explicitamente as duas ordens pelo mock e coordena a
  escrita somente depois do fechamento da leitura do alvo. Os asserts conferem
  a ordem exercitada, a escrita efetiva, a preservação de dev/inode, a alteração
  de tamanho/conteúdo e a rejeição real na revalidação final. O verificador não
  foi alterado.
- A fixture de 1.000 revisões excedeu 20 segundos no runner Ubuntu de duas CPUs.
  Seu prazo individual passou a 60 segundos; continuam 1.000 revisões e todos os
  asserts de `leafLookups`, `leafIndexUpdates` e `previewRootScans`. A prova de
  custo usa esses contadores determinísticos, sem benchmark de walltime ou
  alteração do timeout global.

Os dois arquivos passaram localmente (57 testes) e em Linux real com Node 22,
Vitest 4.1.12, rede desabilitada e limite de duas CPUs (57 testes em 18 segundos;
fixture de 1.000 revisões em 13,3 segundos). Log sintético:
`/private/tmp/tria-pr11-ci-tests-linux.log`. Foi usada uma imagem tools temporária
com tag própria, removida depois da validação; a tag `tria-local-tools:current`
e os volumes existentes permaneceram intactos. O rerun remoto pertence ao
responsável principal; estas provas locais/Linux não o substituem.

O check final também expôs um limite de tempo incidental na fixture de
ownership/cleanup: sob carga, seus subprocessos Docker fake terminaram em
5.029 ms, 29 ms acima do prazo padrão. Com aprovação do responsável principal,
somente essa fixture passou a ter 15 segundos. Todos os asserts de ownership e
pós-condições continuam intactos, assim como os deadlines do supervisor e o
timeout global. O alvo isolado passou em aproximadamente 3,2 segundos antes do
ajuste; a ampliação trata contenção de execução, sem substituir provas por
contadores ou remover expectativas.

Comprovação final desta correção: `npm run check` integral aprovado com 58
arquivos/516 testes, lint sem warnings e build Next/TypeScript verde.
`security:audit` completo/produção permaneceu em zero; `origin:verify`,
`railway:check`, `release:scan` e `git diff --check` aprovados. O alvo isolado
ownership/cleanup passou após o prazo individual de 15 segundos. A aplicação,
o domínio, a persistência, o verificador e o timeout global não foram alterados.
O arquivo `src/components/project-list.tsx` permanece byte a byte igual a HEAD,
SHA-256 `0b472b5d0cfd4e7a463397a3bc76f1e6c81079defb4ef758f6f5de438430a739`;
o manifesto histórico mantém seu SHA-256 ancorado. Nenhum commit/push foi feito
pela implementação; publicação e acompanhamento do rerun remoto ficam com o
responsável principal, sem merge.
