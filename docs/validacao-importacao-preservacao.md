# Importação de recursos e preservação no deploy

Esta alteração amplia a leitura XLSX para 10.000 linhas de 25 colunas, usa resultados calculados salvos e considera Valor/Horas vazios nas colunas mapeadas como zero. Fórmulas não são executadas; resultados ausentes ou com erro continuam bloqueados.

Projetos novos são criados somente na aplicação confirmada da prévia. A carga complementar mantém os registros ausentes. A opção global **Sobrescrever a base anterior**, desmarcada por padrão, permite retirar registros ausentes e arquivar os respectivos projetos da base anterior. Cadastros independentes são preservados. Um projeto que reaparece é reativado com o mesmo ID. Arquivar mantém arquivos, atividades e vínculos históricos.

## Atualização de uma instalação existente

A única migração nova é `051_resource_project_lifecycle.sql`: adiciona `resource_import.project_plan`, opcional e inicialmente nulo. Não contém carga inicial, exclusão ou atualização de registros existentes. Prévia antiga sem plano permanece compatível. Migrações anteriores, configuração Railway, volumes e scripts de inicialização não foram alterados.

O entrypoint aplica apenas migrações pendentes e inicializa/verifica o armazenamento existente. Não executa importação de planilhas. O inicializador recusa um volume vazio quando o catálogo já contém arquivos, e verifica a identidade do volume. O deploy não deve copiar nem restaurar a base local sobre produção.

## Cobertura executável

- Testes unitários: 8.000 e 10.000 linhas, excesso de linhas/elementos XML, resultados de fórmulas, zeros, decisões e planejamento de projetos.
- `upgrade-preservation.integration.test.ts`: migra bancos sintéticos preenchidos das versões 045 e 050; compara todas as tabelas preexistentes e visões de valores antes/depois. Na versão 050 inclui evidência vinculada ao projeto, arquivo publicado e PDF de Contexto. Repete migração e inicialização do armazenamento, comparando também os bytes dos arquivos.
- `project-resource-import.mjs`: carga complementar, sobrescrita explícita, criação na confirmação, arquivamento, reativação, prévia obsoleta, ajustes manuais, repetição e download idêntico de evidência antes/depois de arquivar e reativar.
- `local-three-requirements.mjs`: executores, Contexto em desktop/mobile, PDFs, autenticação, cancelamento de exclusão e preservação de outro PDF.

Esses testes usam banco e volume descartáveis. Não consultam nem modificam produção.

## Antes de autorizar o merge e deploy

1. Conferir CI aprovado no SHA final do PR.
2. Obter e verificar backup atualizado do banco **de produção** e dos arquivos do volume, incluindo evidências e Contexto. Coordenar a janela para que uploads novos não fiquem fora desse backup.
3. Preservar as conexões do banco, o volume existente e sua identidade; não executar reset, seed, carga inicial ou restore local.
4. Após o deploy, conferir SHA/health e comparar catálogo/vínculos e downloads de evidências e PDFs com o estado anterior.

O teste local demonstra preservação nos cenários cobertos; a conferência de produção deve usar seu estado atualizado, pois novos uploads podem ocorrer depois desta validação. Um rollback de aplicação não deve restaurar um backup antigo sobre uploads recentes; a coluna opcional pode permanecer no banco.
