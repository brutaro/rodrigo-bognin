# Operação do MVP

O TRIA reúne projetos, narrativa, arquivos, notas fiscais, conferência de custos,
reembolsos, caixa e contrato. A identidade visual usa a marca TRIA com verde e terracota.

- **Adicionar arquivos no projeto:** anexos opacos de qualquer extensão, sem executar o conteúdo. Arquivos vazios são recusados; a quota do cofre é compartilhada, de 4 GB.
- **Recursos:** importação XLSX/CSV com prévia e confirmação. Diferenças posteriores exigem decisão explícita.
- **Notas fiscais:** CSV/XLSX, PDF e XML nos fluxos próprios. PDF escaneado oferece OCR local limitado a 5 páginas e 10 MiB, com conferência manual antes do cadastro. O XML aceita os perfis ABRASF 2.03/2.04 e nacional 1.00/1.01 implementados; não valida assinatura digital nem substitui validação fiscal.
- **Financeiro:** custos confirmados, reembolso e caixa têm estados próprios. Saldo contratual é valor contratado menos recebimentos ativos; não equivale ao caixa.
- **Publicações:** versões imutáveis, com arquivos selecionados, exportações HTML/CSV e relatórios PDF.
- **Backup:** use os comandos do README para copiar banco, arquivos e configurações privadas, verificar a cópia e testar a restauração isolada. O ZIP da interface cobre somente o cofre.

## Validação e PR

`npm run check` executa testes de domínio, ESLint e build/TypeScript.
`npm run railway:check` verifica apenas a configuração, sem publicar nada.
`npm run release:scan` inspeciona a árvore limpa e o histórico Git; rode em checkout
limpo, sem backups ou fontes reais.

`TRIA_INTEGRATION_ISOLATED=confirmed npm run test:ci-integration` cria ambientes
Docker descartáveis para testar migrações, permissões, importação de arquivos,
recuperação após falha, repetição idempotente, autenticação/HTTP, bootstrap sem
privilégios e preparação/reconciliação com PostgreSQL real. Cada ambiente possui
namespace próprio e é removido ao término. Nunca execute fixtures no banco em uso.

Os runners históricos `story-3-2-isolated-integration.sh` e
`story-3-3-isolated-integration.sh` preservam o contrato de arquivos de sua época.
O CI atual executa as suítes PostgreSQL diretamente, sem congelar a implementação
em hashes anteriores ao MVP. Os testes unitários continuam sendo executados uma
vez, fora dos containers de integração.

O workflow valida PRs. O job de deploy exige **push na main** após CI aprovado.
Abrir ou atualizar o PR não autoriza merge ou deploy.

No Railway, `TRIA_CONSOLIDATED_SOURCE_UPLOAD=authenticated-owner` habilita as
importações autenticadas; fixtures sintéticas continuam bloqueadas. O workflow
registra `TRIA_RELEASE_SHA` e verifica o mesmo commit no health público.
O código de acesso, banco e arquivos continuam privados.
