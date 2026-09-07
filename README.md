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
- cofre de arquivos opacos com versões, SHA-256, quota de 4.000.000.000 bytes e volume dedicado;
- inclusão explícita de arquivos na publicação e expurgo destrutivo confirmado;
- backup local completo de banco e arquivos, com verificação e restauração isolada; ZIP adicional somente do cofre;
- autenticação do único usuário Rodrigo por código permanente e cookie `HttpOnly`/`SameSite=Strict`;
- exportações HTML autônomo e CSV protegido contra fórmulas;
- acesso local em `127.0.0.1` e TLS obrigatório fora de loopback;
- runtime e IaC preparados para Railway Hobby; R2 e OCI permanecem desativados.

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
3. Crie os quatro arquivos de senha do banco e os três secrets permanentes do proprietário em `.secrets/`:

```bash
mkdir -p .secrets
umask 077
openssl rand -base64 36 > .secrets/db_admin_password
openssl rand -base64 36 > .secrets/db_app_password
openssl rand -base64 36 > .secrets/db_migrator_password
openssl rand -base64 36 > .secrets/db_importer_password
openssl rand -base64 24 > .secrets/tria_login_code
openssl rand -base64 48 > .secrets/tria_session_key
node -e 'console.log(crypto.randomUUID())' > .secrets/file_store_uuid
chmod 600 .secrets/*
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

Abra `http://127.0.0.1:3100/entrar` e use o conteúdo de `.secrets/tria_login_code`. O mesmo código continua válido até uma rotação deliberada. Altere `TRIA_PORT` no `.env` se essa porta estiver ocupada.

**Não execute `docker compose down -v`.** Essa opção apaga o banco e o cofre de arquivos locais. `docker compose down` preserva os volumes nomeados.

Consulte [`docs/docker-local.md`](docs/docker-local.md) para o runtime local e [`docs/deploy-github-railway.md`](docs/deploy-github-railway.md) para GitHub/Railway.

## Validar

No host:

```bash
npm run check
```

No mesmo ambiente Node do contêiner:

```bash
docker compose run --rm --no-deps migrate npm run check
```

O comando executa a suíte de testes, ESLint, TypeScript e o build de produção. O teste PostgreSQL/HTTP é destrutivo e só aceita uma pilha Compose descartável cujo nome comece por `tria-vault-`. Use o procedimento de [`docs/docker-local.md`](docs/docker-local.md); ele se recusa a executar na pilha principal.

## Cofre e backup

Na página de cada projeto, Rodrigo pode enviar um arquivo, criar uma nova versão, escolher sua inclusão na próxima publicação e baixar qualquer versão ativa. O expurgo exige o código permanente e o texto `EXCLUIR`. Se o arquivo já foi publicado, o sistema remove a primeira publicação que o contém e todas as versões posteriores do projeto.

A página **Backup** distingue a cópia completa do ZIP somente de arquivos. O ZIP inclui objetos, catálogo e vínculos, mas não substitui o banco.

Para a cópia completa, na pasta `PLANO_B_TRIA`:

```sh
npm run backup:local
npm run backup:verify -- .local-backups/<pasta-gerada>
npm run backup:restore-test -- .local-backups/<pasta-gerada>
# Após conferir a URL local informada:
npm run backup:cleanup-test -- .local-backups/<pasta-gerada>
```

A cópia pausa e retoma a aplicação, inclui todas as tabelas, originais XLSX/CSV/PDF/XML, comprovantes e configurações privadas. A restauração compara o conteúdo das tabelas e cria banco, volume e aplicação separados. O comando de limpeza remove somente esse ambiente temporário e preserva o backup. Os comandos precisam do Docker local; não substituem automaticamente o ambiente em uso. Guarde `.local-backups` em local privado: contém códigos de acesso. Para recuperar apenas o ZIP do cofre, consulte [`docs/docker-local.md`](docs/docker-local.md).

## Modo demonstrativo

As fixtures fictícias continuam disponíveis somente para testes de domínio. Sem PostgreSQL e sem o volume validado, a aplicação operacional falha de forma fechada e não oferece um segundo escritor.

## Limites

- Uma conta local: Rodrigo.
- Um único usuário autenticado: Rodrigo; sem cadastro, convite, perfil ou aprovação de terceiros.
- Somente Railway Hobby como destino externo; sem R2, OCI ou segundo provedor.
- Sem execução de PBIX, macros, scripts ou consultas de arquivos enviados.
- Medição, nota, relação, valor informado e pagamento permanecem conceitos distintos.

Estado vigente, formatos aceitos e validações: [operação do MVP](docs/mvp.md).
