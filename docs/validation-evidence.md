# Evidências de validação local

Data: 2026-08-31

## Marco demonstrativo anterior

O primeiro marco usou somente fixtures fictícias. Ele validou edição, conferência, publicação V1/V2, preservação da V1 e exportações. Esse histórico permanece coberto pela suíte automatizada.

## Marco PostgreSQL e Docker

A validação atual usou as quatro fontes aprovadas, montadas separadamente em modo somente leitura. Nenhuma fonte foi alterada. O importador validou SHA-256, cabeçalhos, contagens, chaves e invariantes antes da transação.

Contagens confirmadas no PostgreSQL:

- 4 lotes de importação;
- 59 projetos;
- 3.364 atividades;
- 32 BMs;
- 142 NFS-e;
- 142 classificações financeiras;
- 53 ativos de evidência por hash;
- 72 vínculos de evidência;
- 52 projetos com evidência e 7 sem candidato;
- 31 projetos declarados nas NFS-e;
- 21 candidatos financeiros com correspondência exata.

Qualidade preservada:

- 19 datas de atividade inválidas ou intervalares foram mantidas com data nula e status;
- 345 períodos mensais não utilizáveis foram mantidos com status;
- nenhuma linha foi descartada;
- candidatos sem correspondência exata permaneceram com chave nula.

## Automação

`npm run check` foi aprovado no host e no estágio `tools` do contêiner.

Resultado:

- 83 testes aprovados;
- ESLint aprovado;
- TypeScript aprovado;
- build Next.js de produção aprovado;
- 18 rotas geradas;
- `npm audit --omit=dev --audit-level=high` sem vulnerabilidade alta.

A regressão de integridade inclui reordenação recursiva de chaves, como ocorre com JSONB.

## Integração temporária isolada

Um banco temporário separado foi criado no mesmo PostgreSQL. Ele não continha projetos reais. O teste confirmou:

1. edição de narrativa por Server Action;
2. registro financeiro transacional;
3. publicação V1;
4. retry idêntico sem nova versão;
5. recusa de prévia obsoleta após edição;
6. recusa de `UPDATE` em publicação append-only;
7. HTML e CSV com HTTP 200;
8. HTML sem script externo e sem alegação falsa de dado fictício;
9. CSV com BOM;
10. leitura da publicação após reinício do contêiner.

O aplicativo e o banco temporários foram removidos após o teste.

## Backup e restauração

Um dump binário do banco principal foi restaurado em banco temporário. A restauração confirmou 59 projetos, 3.364 atividades, 142 NFS-e, 72 vínculos e as 14 migrações. O banco temporário e o dump foram removidos ao final.

## Segurança do runtime

- Node.js 22;
- PostgreSQL 16;
- usuário da aplicação UID 1001;
- filesystem raiz do aplicativo somente leitura;
- todas as Linux capabilities removidas;
- `no-new-privileges` ativo;
- porta do app em `127.0.0.1:3100`;
- nenhuma porta PostgreSQL publicada;
- senhas apenas por Docker secrets;
- papel de aplicação sem `INSERT` em projeto e sem acesso a caminhos privados;
- papel de aplicação sem `UPDATE` em histórico ou publicação;
- importador separado, sem privilégio DDL;
- linhagem por lote em relações e evidências;
- idempotência de lançamento financeiro por UUID de requisição;
- concorrência otimista da narrativa por revisão;
- volume PostgreSQL persistente.

## Proteção das origens

As árvores protegidas continuaram iguais à linha de base:

- `_bmad`: `c3ffd46aa4dcd780ba6c6155caaeaa61e7212ade7fc7da21a7989ce059621547`;
- `_bmad-output`: `690f23a86a0027b581fe06a0d2f58e3b06394691df6dbc684cb59920aef9c307`;
- `.agents`: `bf0a1cdf26222e6c5b44a4862092ff0d0823a14231704d6a0e4c80228cba425f`.

Railway, R2 e deploy permaneceram desativados.

## Verificação automatizada PostgreSQL/HTTP

`npm run test:integration`, no perfil Docker `validation`, verifica leitura como `tria_app`, recusa de DDL, idempotência por `request_id`, CHECK do snapshot JSONB e respostas HTTP 200/404. A transação de escrita de teste é revertida.

## Fluxo PostgreSQL isolado final

Em banco temporário com as 14 migrações e nova importação, foram validados:

- prévia ligada à revisão: A→B→A recusou o formulário antigo;
- publicação nova A→B→A gerou V1, V2 e V3, com o mesmo hash de conteúdo em V1/V3 e registros distintos;
- paginação de um projeto com 748 atividades: páginas de 100 linhas, sem sobreposição entre páginas 1 e 2;
- UI publicada com valor relacionado e elegibilidade;
- HTML e CSV disponíveis;
- banco e contêiner temporários removidos; banco principal permaneceu sem rascunhos ou publicações de teste.


## Marco de autenticação e cofre do proprietário

A validação final do cofre foi executada no banco principal limpo e em uma pilha Docker nova, com banco, rede e volumes isolados. O banco novo aplicou 22 migrações, importou novamente as quatro fontes e confirmou as mesmas contagens canônicas.

Foram validados:

1. login correto e incorreto, logout, cookie `HttpOnly`/`SameSite=Strict` e throttle global após cinco falhas;
2. redirecionamento de páginas privadas e HTTP 401 em APIs privadas sem sessão;
3. upload por streaming, SHA-256, tamanho, nova versão, reserva de quota e remoção de objeto órfão;
4. inclusão explícita na publicação, snapshot v3 com a versão exata e bloqueio da publicação quando o objeto foi corrompido;
5. download como attachment opaco, com `no-store` e `nosniff`, e recusa após corrupção;
6. expurgo com código permanente + `EXCLUIR`, falha retomável em estado `purging` e remoção da publicação dependente;
7. remoção de bytes, versões, vínculos e referências internas de reserva após o expurgo;
8. backup ZIP com todos os objetos ativos, catálogo e manifesto; restore isolado; recusa de bundle adulterado;
9. readiness HTTP 503 com volume ausente, somente leitura, sentinel divergente, quota cheia ou capacidade física insuficiente;
10. recusa de upload quando o volume físico não comporta a escrita;
11. persistência dos bytes e da sessão após recriação do app e persistência após reinício conjunto de app e banco;
12. advisory lock PostgreSQL para serializar operações de arquivo entre processos;
13. banco principal limpo após a integração: zero documentos, versões, reservas, bytes usados, bytes reservados, throttles, publicações e eventos de teste;
14. `npm audit --omit=dev --audit-level=high` com zero vulnerabilidades.

Um dump final do PostgreSQL foi restaurado em banco isolado. `scripts/validate-database.mjs` confirmou 59 projetos, 3.364 atividades, 142 NFS-e, 72 vínculos e 22 migrações. O papel `tria_app` leu os 59 projetos e continuou sem DDL. O banco, o dump e os volumes temporários foram removidos.

O teste da publicação seletiva ocorreu somente na pilha isolada. O expurgo removeu a publicação V1 e a referência do objeto. A pilha isolada foi parada e seus volumes de teste foram removidos individualmente, sem `docker compose down -v`.


## Gate adversarial final do cofre

Uma revisão adversarial independente identificou seis bloqueadores altos. Todos foram corrigidos e novamente validados em uma pilha Compose criada do zero:

- headers `X-Forwarded-*` são ignorados por padrão; um host externo direto, mesmo com headers forjados, recebe HTTP 426;
- o mutex local é liberado quando o checkout PostgreSQL falha;
- download, upload, publicação, backup, reconciliação e expurgo validam o UUID do volume contra secret, sentinel e PostgreSQL;
- upload rejeitado não grava bytes e uma falha posterior ao rename remove o objeto ou o deixa para reconciliação;
- download só retorna HTTP 200 depois de criar e verificar um snapshot staging, com quota reservada até o fim do stream;
- o ZIP calcula SHA-256 sobre o mesmo stream enviado e libera o lock também quando esse stream falha;
- `.tria-volume` recusa symlink, owner divergente e permissões acima de `0600`;
- restore exige destino ausente e nunca remove recursivamente um destino existente;
- logout revoga a sessão no PostgreSQL; replay do cookie foi recusado;
- `CONNECT` e `TEMPORARY` foram removidos de `PUBLIC`; a trilha permite `SELECT`/`INSERT` ao runtime, mas recusa `UPDATE`/`DELETE`;
- o backup compara ACLs completas de tabelas, colunas, função, schema e banco; um `GRANT SELECT ... TO PUBLIC` de teste fez o backup falhar com HTTP 503;
- testes de falha simulam `EIO` na fonte e cancelamento pelo cliente, fecham o stream e liberam o advisory lock;
- o teste destrutivo exige `TRIA_INTEGRATION_ISOLATED=confirmed` e namespace Compose `tria-vault-*`.

A suíte final teve 83 testes em dez arquivos. A integração isolada validou três versões do mesmo documento, inclusão explícita, prévia obsoleta recusada, snapshot `tria-publication-v3`, cadeia V1→V2, fallback do expurgo pelo snapshot, download, corrupção, backup/restore, volume inválido, quota, expurgo retomável e expurgo final. O banco isolado permaneceu válido com 22 migrações.

Uma sessão autenticada e os mesmos bytes foram verificados antes e depois de restart conjunto de app/banco e depois de `--force-recreate` do app. O backup posterior foi verificado e restaurado em destino ausente; nova tentativa sobre o destino existente falhou sem remover o marcador de controle. Um dump foi restaurado em banco isolado com 22 migrações, 59 projetos e os registros do cofre. `tria_app` manteve leitura e continuou sem DDL.
