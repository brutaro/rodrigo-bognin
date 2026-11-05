# Publicação privada no GitHub e Railway Hobby

Este procedimento publica somente `PLANO_B_TRIA`. Ele nunca publica fontes, evidências, dumps, uploads ou secrets.

## 1. Gates locais e GitHub

Pare somente para login, 2FA ou confirmação interativa. Não apague recursos, volumes, backups ou dados legítimos sem confirmação.

```bash
npm ci
npm run security:audit
npm run release:scan
npm run origin:verify
npm run check
npm run railway:check
docker build --target tools -t tria-tools:preflight .
docker build --target runner -t tria:preflight .
git diff --check
git rev-parse --show-toplevel
```

A raiz deve terminar em `PLANO_B_TRIA`. Crie o repositório a partir desta raiz:

```bash
gh auth status || gh auth login
gh repo create brutaro/rodrigo-bognin --private --source=. --remote=origin
gh repo view brutaro/rodrigo-bognin --json nameWithOwner,visibility
```

Exija visibilidade `PRIVATE`. Repita `npm run release:scan` antes do primeiro push. Proteja `main` com o job `ci`. Desative o auto-deploy GitHub do Railway.

## 2. Infraestrutura Railway

Use somente Hobby. Não use Pro, R2 ou OCI. A região fixa do PostgreSQL, cofre e app é `us-east4-eqdc4a`. O PostgreSQL privado e o cofre de 5.000 MB usam volumes separados. O cofre monta em `/data/files`. Nunca exponha TCP público no PostgreSQL.

```bash
npx --yes @railway/cli@5.47.1 login
npx --yes @railway/cli@5.47.1 init
npx --yes @railway/cli@5.47.1 link
npx --yes @railway/cli@5.47.1 config plan --out /caminho-persistente/tria-plan.json
```

O workflow de infraestrutura gera somente o plan. Uma pessoa deve revisar e aplicar exatamente esse plan. Recuse qualquer delete, detach, redução ou troca de volume, mudança de região, banco público ou segunda réplica. Não aplique um plan destrutivo de forma automática.

## 3. Bootstrap fail-closed

Antes do primeiro deploy, defina `TRIA_BOOTSTRAP_MODE=enabled`. Não crie domínio e mantenha `TRIA_PUBLIC_HOSTS` vazio. Defina temporariamente:

- `TRIA_DATABASE_ADMIN_URL` privada do provedor;
- `TRIA_DB_ADMIN_PASSWORD` e `TRIA_DB_IMPORTER_PASSWORD`;
- `TRIA_DB_APP_PASSWORD` e `TRIA_DB_MIGRATOR_PASSWORD`;
- `TRIA_LOGIN_CODE`, `TRIA_SESSION_KEY` e `TRIA_FILE_STORE_UUID`;
- `TRIA_ROTATE_DB_ROLE_PASSWORDS=confirmed` somente quando uma rotação deliberada for necessária.

O bootstrap cria papéis ausentes sem trocar senhas de papéis existentes. A rotação exige o marcador exato. Todos os papéis ficam `LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`.

Nesse modo, somente `/api/health` responde 200. Todas as outras rotas respondem 503. O processo roda como UID/GID 1001 depois de migrar e inicializar o cofre. Não habilite domínio público no bootstrap.

## 4. Carga canônica

Transfira fora do Git os quatro CSV sanitizados para `/bootstrap-data`. Transfira um diretório com somente as 53 evidências para `/evidence-import`. `docs/copied-reference-manifest.json` prova somente seis cópias UX. Ele não é o catálogo de evidências.

```bash
npx --yes @railway/cli@5.47.1 volume files --volume tria-file-vault upload /origem/bootstrap-data /bootstrap-data
npx --yes @railway/cli@5.47.1 volume files --volume tria-file-vault upload /origem/evidence-import /evidence-import
npx --yes @railway/cli@5.47.1 ssh --service tria scripts/railway-oneoff.sh import-data
npx --yes @railway/cli@5.47.1 ssh --service tria scripts/railway-oneoff.sh import-evidence
npx --yes @railway/cli@5.47.1 ssh --service tria scripts/railway-oneoff.sh validate
```

A carga valida 53 hashes, 72 vínculos e `1.126.834.973` bytes. O journal persistente, as reservas sem expiração, `fsync` e renames atômicos permitem retomar uma queda sem liberar accounting antes da limpeza física.

Depois de `validate`, confirme o marcador `/data/files/.tria-bootstrap-complete`. Com autorização explícita, apague somente os diretórios temporários remotos. Nunca use `docker compose down -v`.

## 5. Saída do bootstrap e corte

1. Defina `TRIA_BOOTSTRAP_MODE=disabled`.
2. Remova `TRIA_DATABASE_ADMIN_URL`, `TRIA_DB_ADMIN_PASSWORD`, `TRIA_DB_IMPORTER_PASSWORD` e `TRIA_ROTATE_DB_ROLE_PASSWORDS` do serviço.
3. Confirme que produção mantém somente credenciais app/migrator e os secrets de login, sessão e UUID.
4. Faça novo deploy do SHA aprovado em CI.
5. Confirme que o deployment novo está `SUCCESS` e que `meta.commitHash` é o SHA esperado.
6. Confirme health completo com `status=ok` e `release` igual ao SHA.
7. Só então crie o domínio e defina `TRIA_PUBLIC_HOSTS=host.exato` sem esquema. Defina `TRIA_PUBLIC_URL=https://host.exato` somente no GitHub Environment.

Aborte se bootstrap e host público coexistirem, se credenciais admin/importer restarem, ou se o SHA divergir.

O health completo exige 59 projetos, 53 objetos, 72 vínculos resolvíveis, UUID correto, quota lógica de `4.000.000.000` bytes, catálogo consistente e espaço físico.

## 6. Smoke HTTPS

- Entre com o código permanente.
- Baixe uma evidência compartilhada a partir de cada projeto ligado.
- Confirme 404 para projeto sem vínculo e para o endpoint genérico de uma evidência.
- Confirme ajustes, prévia, publicação V4 e os dois PDFs.
- Confirme `Secure`, `HttpOnly` e `SameSite=Strict`.
- Recuse HTTP, host fora da allowlist e qualquer conjunto ausente ou incompleto de forwarded headers.

## 7. Backup coordenado

Use um destino persistente fora de `/tmp` e de tmpfs.

1. Defina `TRIA_MAINTENANCE_MODE=enabled` e faça deploy. Confirme health `maintenance` e 503 nas rotas de escrita.
2. Confirme que não há import, one-off ou outro escritor ativo. Se necessário, escale o app a zero depois de obter o ZIP autenticado.
3. Faça streaming do ZIP autenticado para o destino persistente: `curl --fail --output /destino-persistente/cofre.zip https://HOST/api/backups/files`.
4. Faça streaming de `pg_dump -Fc` pelo canal privado Railway para `/destino-persistente/banco.dump`.
5. Grave SHA-256, tamanhos, deployment ID e Git SHA para os dois arquivos.
6. Defina maintenance como `disabled`, volte a uma réplica e confirme health e login.

Verifique e restaure somente em banco e volume novos, sem domínio:

```bash
node scripts/restore-file-backup.mjs --verify-only /destino-persistente/cofre.zip
node scripts/restore-file-backup.mjs --target /volume-isolado /destino-persistente/cofre.zip
```

Um backup v1 histórico pode declarar quota de 9 GB somente quando `used_bytes <= 4.000.000.000`. O restore normaliza a quota para 4 GB. Uso acima de 4 GB é recusado. Não apague o ambiente isolado sem confirmação.

## 8. Rollback

Migrações e volumes nunca são revertidos. Antes de existir uma release Railway pós-import verde, o único retorno seguro é a pilha Compose local inalterada. Não volte ao baseline `8dde05a` depois das migrações.

A primeira release com imports completos, bootstrap desligado, secrets admin/importer removidos e smoke verde é a âncora de rollback. Registre deployment ID e Git SHA. Depois, rollback troca somente o deployment do app. Ele nunca troca, reduz, destaca ou apaga o PostgreSQL ou o cofre.

## 9. Operação

Mantenha uma réplica, `overlapSeconds: 0`, alertas de custo Hobby, plan antes de apply, CI antes de deploy e restores isolados periódicos.

## 10. Integrações vigentes e limites das fotografias históricas

A auditoria completa e de produção falha em qualquer alerta:
`npm run security:audit`. O override de `minimatch` fica restrito à dependência
transitiva de `@typescript-eslint/typescript-estree`: a linha 10 ainda possui
alerta; 11.0.1 elimina o alerta e suporta Node 22. Next e eslint-config-next
permanecem alinhados na versão 16.4.5. O TypeScript continua em modo `strict`,
com tipos ambientais restritos ao `node_modules/@types` do projeto.

Prepare Chromium e reutilize as imagens da mesma revisão:

```bash
npx playwright install --with-deps chromium
docker build --target tools --tag tria-tools:preflight .
docker build --target runner --tag tria:preflight .
TRIA_TOOLS_IMAGE=tria-tools:preflight TRIA_RUNNER_IMAGE=tria:preflight npm run test:ci-integration
TRIA_TOOLS_IMAGE=tria-tools:preflight npm run test:integration:story-3-3
TRIA_TOOLS_IMAGE=tria-tools:preflight TRIA_RUNNER_IMAGE=tria:preflight bash scripts/project-resource-e2e.sh
```

O CI executa evidências, crash/recovery, HTTP e bootstrap sintéticos, depois
PostgreSQL e jornadas browser 3.2/3.3. O comando `test:integration:story-3-3`
executa as duas stories no runner atual. A suíte de projetos também executa
`upgrade-preservation.integration.test.ts`: banco preenchido nas migrações
45/50, PDFs existentes e repetição de migração devem preservar registros e bytes.
`test:integration` continua sendo o smoke somente leitura da pilha local já
aberta, usando seu login; não substitui as integrações sintéticas acima.

Os três runners públicos usam `isolated-integration-supervisor.sh`. Ele recusa
namespaces, recursos ou tags de destino preexistentes e falhas de enumeração
antes de estabelecer ownership. Cada execução recebe um token aleatório nos
labels dos containers, volumes e rede. A limpeza remove somente recursos desse
token, confere a ausência posterior e propaga falhas. INT/TERM são encaminhados
a todo o grupo do processo; término tem prazo e processos vivos remanescentes
falham. Recursos de outra execução são preservados e tornam o gate vermelho.
A suíte de projetos mantém o namespace sintético fixo exigido por seus testes e
recusa executá-lo enquanto houver recursos anteriores.

Imagens fornecidas por `TRIA_TOOLS_IMAGE`/`TRIA_RUNNER_IMAGE` são resolvidas para
IDs e nunca têm suas tags alteradas nem são removidas. Sem essas opções, o supervisor constrói tags
próprias do namespace e remove somente as tags que ainda apontam aos IDs que
criou. Secrets são sintéticos; os mounts individuais readonly permitem leitura
pelo UID 1001 sem abrir o diretório temporário privado no host.

`--preflight-only` valida somente sintaxe e não aprova PostgreSQL ou browser.
`--harness-self-test <child>` é reservado aos testes sintéticos de isolamento;
a saída do child é suprimida e não pode alegar aprovação funcional. O caminho
normal seleciona somente as suítes fixas do código.

`scripts/story-3-3-isolated-integration.sh`,
`scripts/verify-story-3-3-baseline.mjs`,
`tests/contracts/story-3-3-baseline.json` e os testes `.historical.ts` preservam
fotografias de stories antigas. Seus hashes não são atualizados para acomodar
evolução de dependências, health ou workflow. Esses verificadores podem recusar
o código atual por esse motivo e não são gates atuais nem evidência de falha de
preservação de produção. A produção é conferida separadamente, somente por
leitura, pelo responsável; esses testes não recebem dados ou secrets reais.
O deploy permanece condicionado a push em `main` e ao job `ci`; merge e deploy
exigem autorização prévia.

A exclusividade do namespace é reservada no daemon por um container parado
`<namespace>-integration-lock`, nunca iniciado ou adotado. O Engine rejeita
criação com nome já ocupado com conflito; o perdedor não remove a reserva do
vencedor. A primitiva foi conferida na [API oficial do Docker Engine](https://docs.docker.com/reference/api/engine/version/v1.53/#tag/Container/operation/ContainerCreate)
e em duas criações concorrentes reais isoladas. A reserva só é liberada pelo
owner correspondente, depois da limpeza dos demais recursos.

Preparação e suíte inteira recebem encaminhamento de INT/TERM e prazo de
término. Inventário/inspect/cleanup usam deadline de 15 segundos por chamada;
builds usam 1.800 segundos e a suíte funcional, 3.600 segundos. Uma falha no
término do grupo não dispara um `wait` bloqueante nem libera recursos que o
processo vivo ainda possa recriar. Imagens construídas e reutilizadas chegam à
suíte por ID imutável; tags próprias são mantidas separadas para a limpeza.
Prontidão HTTP usa connect-timeout/max-time; bootstrap exige health efetivamente
`bootstrap`, UID/GID 1001 e ausência de ambiente privilegiado.

Quando há falha funcional, logs, screenshots e resultados sintéticos de uma
allowlist são preservados fora do checkout em
`${RUNNER_TEMP:-${TMPDIR:-/tmp}}/tria-integration-artifacts/<namespace>-<owner>`.
Secrets, overrides Compose, perfis de navegador, dumps de ambiente e arquivos de
entrada não são copiados. O workflow envia somente esse diretório com
`upload-artifact` e `if: failure()`. O self-test continua com saída suprimida.

A liberação da reserva usa `docker rm -fv` somente depois de conferir seu owner.
Isso remove também os volumes anônimos vazios criados pelo `VOLUME` da imagem
PostgreSQL usada no lock. A prova real capturou o nome em `.Mounts` antes da
remoção e confirmou sua ausência depois; nenhum volume anônimo desconhecido é
alvo de limpeza. O coletor de artefatos também recusa symlinks no diretório da
execução, em `browser`/`containers` e nos arquivos de destino, conferindo a
contenção final antes de truncar ou escrever qualquer conteúdo.
