# Limites do runtime local

## Persistência ativa

A pilha Docker usa PostgreSQL como único escritor operacional. As fixtures JSON permanecem somente para testes de domínio. Sem PostgreSQL e sem volume validado, não existe escritor operacional alternativo.

O PostgreSQL aplica:

- transações para narrativa, valores e publicação;
- advisory lock por projeto durante a publicação;
- advisory lock global para serializar upload, publicação, backup e expurgo entre processos;
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

A aplicação autentica um único ator, Rodrigo, com código permanente guardado em file secret. A sessão usa outro file secret e cookie `HttpOnly`, `SameSite=Strict`. O logout encerra somente a sessão; o código continua reutilizável. Tentativas falhas recebem resposta genérica, atraso e bloqueio temporário.

- a porta continua publicada somente em `127.0.0.1`;
- o PostgreSQL não publica porta no host;
- páginas, actions, exportações, backups e arquivos exigem sessão válida;
- somente `/entrar`, assets e `/api/health` são públicos;
- fora do loopback, HTTP é recusado e cookie `Secure` é obrigatório;
- `X-Forwarded-*` é ignorado por padrão; `TRIA_TRUST_PROXY=enabled` exige um proxy que remova headers do cliente e envie host/protocolo completos;
- o host local interno só é aceito no acesso direto e nunca é inferido de headers encaminhados;
- uma segunda conta exige novo desenho de autenticação e autorização.

## Arquivos e R2

Uploads locais usam o volume dedicado `file_data`, objetos opacos, versões independentes e SHA-256. O sentinel do volume deve coincidir com o UUID secreto. Ausência, troca ou modo somente leitura derruba readiness. Não há fallback para o rootfs ou `/tmp`.

A quota fixa é de 9.000.000.000 bytes e inclui reservas em andamento. O upload só confirma depois de streaming, hash, `fsync`, rename atômico e commit do catálogo. Download verifica o objeto inteiro antes de enviar bytes e sempre usa attachment com `no-store`.

R2 continua desativado. Backup de arquivos é manual e autenticado. O expurgo exige novamente o código permanente e a palavra `EXCLUIR`.

## Deploy

Railway, R2, OCI e qualquer deploy externo estão desativados. A conclusão da validação local não concede autorização de deploy.

## Operação destrutiva

Os volumes PostgreSQL e `file_data` são persistentes. `docker compose down -v` apaga o banco e o cofre e não pode ser executado sem autorização expressa de Rodrigo.
