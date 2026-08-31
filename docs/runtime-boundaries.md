# Limites do runtime local

## Persistência ativa

A pilha Docker usa PostgreSQL como único escritor operacional. O fallback JSON permanece somente para testes e para a demonstração sem banco. Ele não é usado quando `PGHOST` ou `DATABASE_URL` está configurado.

O PostgreSQL aplica:

- transações para narrativa, valores e publicação;
- advisory lock por projeto durante a publicação;
- versão única por projeto;
- snapshot e histórico append-only;
- recusa de `UPDATE` e `DELETE` em publicações e eventos;
- hash estável mesmo quando JSONB reordena chaves;
- papéis separados de administrador, migrador e aplicação;
- privilégios mínimos por tabela e coluna.

## Dados carregados

A carga local contém 59 projetos, 3.364 atividades, 142 NFS-e, 142 classificações financeiras, 53 hashes de evidência e 72 vínculos.

Não são persistidos pessoa, CPF/documento, tomador, descrição fiscal privada, campo reservado ou caminho bruto. O aplicativo também não recebe privilégio para consultar os locators internos de importação.

A coincidência textual só cria candidato financeiro quando corresponde exatamente ao título canônico após normalização determinística. Não há fuzzy match. Relação e pagamento não são inferidos.

## Rede e autenticação

A aplicação não tem autenticação. Por isso:

- a porta é publicada somente em `127.0.0.1`;
- o PostgreSQL não publica porta no host;
- não se deve expor a aplicação à rede local ou Internet;
- uma segunda conta ou acesso remoto exige novo desenho de autenticação.

## Arquivos e R2

Uploads e R2 continuam desativados. A aplicação expõe somente metadados permitidos de evidência; nenhum caminho nem byte de arquivo entra na publicação.

Se R2 for autorizado no futuro, deve usar bucket privado, SHA-256 verificado, versão congelada e limite interno aproximado de 9 GB. Não haverá segundo provedor, upgrade automático ou cobrança não aprovada.

## Deploy

Railway, R2, OCI e qualquer deploy externo estão desativados. A conclusão da validação local não concede autorização de deploy.

## Operação destrutiva

O volume PostgreSQL é persistente. `docker compose down -v` apaga o banco e não pode ser executado sem autorização expressa de Rodrigo.
