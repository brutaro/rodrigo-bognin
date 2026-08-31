# TRIA — Plano B

Aplicação local e privada para Rodrigo organizar projetos, narrativas, valores, evidências e publicações.

## Estado atual

A pilha Docker local está operacional com:

- Next.js em Node.js 22;
- PostgreSQL 16 com volume persistente;
- 59 projetos e 3.364 atividades importados por hash;
- 142 NFS-e mantidas separadas de medição, relação e pagamento;
- 53 evidências por conteúdo e 72 vínculos com projetos;
- narrativa e valores manuais em transações PostgreSQL;
- publicações imutáveis, versionadas e verificadas por hash;
- exportações HTML autônomo e CSV protegido contra fórmulas;
- acesso somente em `127.0.0.1`;
- Railway, R2 e qualquer deploy externo desativados.

A aplicação não persiste pessoa, documento, tomador, descrição fiscal privada, campo reservado ou caminho bruto. Relações financeiras sem correspondência exata continuam sem chave de projeto.

## Isolamento

Este projeto vive exclusivamente em `RODRIGO-BOGNIN/PLANO_B_TRIA/`.

- `_bmad`, `_bmad-output` e `.agents` são somente leitura.
- As quatro fontes aprovadas são montadas separadamente e como somente leitura.
- O importador valida SHA-256, cabeçalho, contagem e invariantes antes da transação.
- Nenhuma fonte original é alterada, recalculada ou sobrescrita.
- Dados reais, segredos, `.env` e backups locais são ignorados pelo Git.

## Executar com Docker

1. Copie `.env.example` para `.env`.
2. Em `.env`, informe somente os quatro caminhos locais aprovados.
3. Crie quatro arquivos de senha aleatória em `.secrets/`:

```bash
mkdir -p .secrets
umask 077
openssl rand -base64 36 > .secrets/db_admin_password
openssl rand -base64 36 > .secrets/db_app_password
openssl rand -base64 36 > .secrets/db_migrator_password
openssl rand -base64 36 > .secrets/db_importer_password
```

4. Inicie a pilha:

```bash
docker compose up --build -d
```

5. Confirme o estado:

```bash
docker compose ps
curl --fail http://127.0.0.1:3100/api/health
```

Abra `http://127.0.0.1:3100`. Altere `TRIA_PORT` no `.env` se essa porta estiver ocupada.

**Não execute `docker compose down -v`.** Essa opção apaga o banco local. `docker compose down` preserva os volumes nomeados.

Consulte [`docs/docker-local.md`](docs/docker-local.md) para migração, importação, backup e restauração.

## Validar

No host:

```bash
npm run check
```

No mesmo ambiente Node do contêiner:

```bash
docker compose run --rm --no-deps migrate npm run check
```

O comando executa 52 testes, ESLint, TypeScript e o build de produção.

## Modo demonstrativo

Sem configuração PostgreSQL, o código conserva um fallback local com dados fictícios para testes e demonstração. Esse fallback não atua como segundo escritor na pilha Docker. Com `PGHOST` ou `DATABASE_URL`, todas as leituras e gravações operacionais usam PostgreSQL.

## Limites

- Uma conta local: Rodrigo.
- Sem autenticação para acesso em rede; por isso, o bind permanece em `127.0.0.1`.
- Sem Railway, R2, OCI ou segundo provedor.
- Sem execução de PBIX, macros, scripts ou consultas de arquivos enviados.
- Medição, nota, relação, valor informado e pagamento permanecem conceitos distintos.
