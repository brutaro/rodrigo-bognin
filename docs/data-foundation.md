# Base de dados disponível para um MVP simples

## Escopo e regra de uso

Este inventário cobre somente bases normalizadas, controles de validação e textos já extraídos.

A análise não altera as fontes. O MVP deve tratar todos os caminhos abaixo como somente leitura.

Este documento não reproduz registros, nomes, documentos pessoais ou valores. Ele mostra somente metadados, contagens e nomes de campos.

## Decisão curta

O MVP pode começar com cinco conjuntos:

1. projetos e BMs
2. notas fiscais processadas
3. classificação financeira auditada
4. vínculos de evidência
5. documentos narrativos

A base mínima não precisa importar o modelo completo do Power BI. Ela também não deve somar referências contábeis ao universo fiscal.

## 1. Projetos e BMs

### Base canônica de atividades

**Caminho:** `_TRABALHO/03_EXTRACOES/bm_activities_normalized.complete.csv`

**Controle:** `_TRABALHO/03_EXTRACOES/bm_activities_normalized.complete.manifest.json`

**Validação:** `_TRABALHO/03_EXTRACOES/bm_activities_normalized.complete.validation.json`

- Registros: **3.364**
- Colunas: **26**
- Projetos distintos: **59**
- BMs distintos: **32**
- Chave disponível: `bm_line_id`
- Linhas duplicadas: **0**
- Chaves `bm_line_id` duplicadas: **0**
- Linhas de origem duplicadas: **0**
- SHA-256 canônico: `2b8bf025afb44dd4204d4a78755c2fae0bcee217fa765416da55d62652c354b0`

Campos úteis:

- identidade e linhagem: `bm_line_id`, `source_id`, `source_relative_path`, `source_sheet`, `source_excel_row`
- agrupamento: `bm`, `project_contract`, `cost_center`, `de_para`
- atividade: `activity_date`, `month_period`, `functionality`, `activity`
- medição: `duration_seconds`, `duration_hours`, `hourly_rate_brl`, `value_brl`
- auditoria: `check`, `month_period_formula`, `value_formula_or_literal`

Campos que não são necessários no primeiro MVP:

- `person`
- `extract`
- `course`
- `course_stage`
- `reserved`

Riscos de qualidade:

- Há **113** registros sem `duration_seconds` normalizado.
- Há **326** registros sem `month_period` normalizado.
- Há campos livres que podem conter conteúdo sensível.
- Dois CSVs parciais permanecem na mesma pasta. O importador deve aceitar somente o arquivo com sufixo `.complete.csv`.

### Agregado de projetos

**Caminho:** `_TRABALHO/03_EXTRACOES/bm_project_aggregate.csv`

- Registros: **59**
- Colunas: **24**
- Chave: `bm_project_id`
- Chaves duplicadas: **0**
- Valores distintos de `project_contract`: **59**

Campos úteis:

`bm_project_id`, `project_contract`, `record_count`, `bm_count`, `date_min_valid`, `date_max_valid`, `duration_hours`, `value_brl`, `missing_duration_count`, `source_reference`.

Esta é a menor fonte para a tela de projetos. A base de atividades continua como fonte para auditoria e recálculo.

### Agregado por projeto e BM

**Caminho de referência:** `ENTREGAVEIS/CONCILIACAO_MEDICOES_FATURAMENTO_PAGAMENTOS_V1_PORTATIL/DADOS/02_medicoes_projeto_bm.csv`

- Registros: **347**
- Colunas: **19**
- Combinações de `projeto` e `bm`: **347**
- Duplicações dessa combinação: **0**

Campos úteis:

`id_grupo`, `projeto`, `bm`, `periodo_bm_inicio`, `periodo_bm_fim`, `registros`, `horas_medidas`, `valor_medido_exato`, `linhas_fonte`, `fonte_exata`.

Esta base tem três cópias idênticas no repositório. O MVP não deve importar as três cópias.

A opção mais segura é recalcular os **347** grupos a partir da base canônica de atividades.

## 2. `NFS.xlsx` processada

### Fonte normalizada

**Caminho:** `_TRABALHO/22_PROCESSAMENTO_NFS_FONTE_VERDADE/NFS_PROCESSADA_FONTE_VERDADE.csv`

**Manifesto:** `_TRABALHO/22_PROCESSAMENTO_NFS_FONTE_VERDADE/MANIFESTO_SHA256.csv`

**Validação:** `_TRABALHO/22_PROCESSAMENTO_NFS_FONTE_VERDADE/VALIDACAO_PROCESSAMENTO_E_PLANO.json`

- Registros: **142**
- Colunas: **10**
- Registros com projeto declarado: **31**
- Registros sem projeto declarado: **111**
- Duplicatas integrais: **0**
- Duplicações de `ID NFS-e`: **0**
- Duplicações de `Ano` mais `NFS-e`: **0**
- Controles aprovados: **36 de 36**
- SHA-256 da base normalizada: `c71e2728a6f5c2d65a3eded66cbdf3e54f4305c6144d1a86018803ed3d3f23bc`

Campos úteis:

`ID NFS-e`, `Ano`, `NFS-e`, `Emissão`, `Valor NFS-e`, `Categoria`, `Projeto vinculado`.

Campos que o primeiro MVP não deve importar:

`Tomador`, `Documento tomador`, `Descrição da NFS-e`.

A chave `Ano` mais `NFS-e` é única somente na carga inicial. A chave interna deve incluir o lote de importação.

## 3. Referências financeiras

### Classificação auditada das notas

**Caminho:** `_TRABALHO/25_AUDITORIA_RELACAO_FONTES_FINANCEIRAS/CLASSIFICACAO_RELACAO_NFS_PROJETOS.csv`

- Registros: **142**
- Colunas: **25**
- Duplicações de `ID NFS-e`: **0**
- Relação forte: **3**
- Relação média: **8**
- Relação fraca: **68**
- Sem relação verificável: **63**

Campos úteis:

- chave: `ID NFS-e`
- vínculo: `Força do vínculo`, `Estado da relação`, `Projeto auditado/candidato`
- regra: `Critério reproduzível`, `Evidência/ponte não financeira`
- elegibilidade: `Valor integral elegível no total do projeto`, `Valor relacionado verificado`
- conciliação: campos iniciados por `BI 15/05` e `BI 30/09`

Campos que exigem bloqueio de exibição:

`Tomador`, `Documento tomador (mascarado)`, `Descrição`, `Observação`.

Esta base complementa as notas. Ela não substitui a base processada de **142** registros.

### Conciliação exata com snapshots financeiros

**Caminho:** `_TRABALHO/25_AUDITORIA_RELACAO_FONTES_FINANCEIRAS/CONCILIACAO_NFS_BI_EXATA.csv`

- Registros: **142**
- Colunas: **15**
- Duplicações de `ID NFS-e`: **0**

Campos úteis:

`ID NFS-e`, `BI 15/05 estado`, `BI 15/05 valor exato`, `BI 30/09 chave localizada`, `BI 30/09 data exata`, `BI 30/09 estado`.

O MVP pode incorporar esses estados na tabela de relação financeira. Uma tabela adicional não é necessária.

### Base financeira ampla e histórica

**Caminho:** `ENTREGAVEIS/CONCILIACAO_MEDICOES_FATURAMENTO_PAGAMENTOS_V1_PORTATIL/DADOS/04_referencias_financeiras_caminho_inverso.csv`

- Registros: **450**
- Colunas: **37**
- Chaves `id_referencia` duplicadas: **0**
- Registros de origem PBIX: **430**
- Registros de origem NFS-e: **20**
- Tipos: **361 NF**, **71 FT**, **15 PA** e **3 PR**

Campos úteis para uma fase posterior:

`id_referencia`, `origem`, `tipo_referencia`, `valor`, `situacao_pagamento`, `situacao_fiscal`, `emissao_ou_referencia`, `status_vinculo`, `decisao`, `local_exato_fonte`, `radar`.

Risco principal:

NF, FT, PA e PR podem representar etapas do mesmo fato. A soma dessas linhas pode duplicar valores.

Esta base também cobre somente **20** linhas NFS-e do pacote antigo. Ela não representa as **142** notas processadas atuais.

## 4. Narrativa

Não existe uma tabela narrativa canônica. Existem textos extraídos e documentos de decisão.

### Texto validado para regras atuais

**Caminho:** `_TRABALHO/21_ATUALIZACAO_PLANO_VALIDADO_CLIENTE/PLANO_VALIDADO_EXTRAIDO.md`

- Tamanho: **11.187 bytes**
- Linhas: **404**
- Títulos Markdown: **18**
- SHA-256: `bb518a804ad4ad6e112cd428f892baccef6f67171cd3a9ae76f47c4607e617ca`

### Decisões consolidadas

**Caminho:** `_TRABALHO/21_ATUALIZACAO_PLANO_VALIDADO_CLIENTE/LEITURA_CRITERIOSA_E_DECISOES_CONSOLIDADAS.md`

- Tamanho: **2.067 bytes**
- Linhas: **34**
- Títulos Markdown: **4**

### Memorial normalizado para leitura

**Caminho:** `_TRABALHO/18_PLANEJAMENTO_PROXIMA_VERSAO_PRIVADO_NAO_PUBLICAR/ANALISE_MEMORIAL/Memorial_Narrativo_RH_Continuidade_Operacional_V7.layout.txt`

- Tamanho: **75.287 bytes**
- Linhas: **1.239**
- SHA-256: `870a9e608ed7428335a259195ad5e8cd54ffe4dc66cf3dc8921c33850227f945`

O memorial não tem títulos estruturais em Markdown. Ele exige segmentação antes de virar afirmações publicáveis.

Para o MVP, importe somente metadados desses documentos. Mantenha o texto em armazenamento privado e sob demanda.

Campos mínimos:

`document_id`, `document_role`, `relative_path`, `sha256`, `access_level`, `version_status`, `line_count`.

## 5. Evidências

### Vínculo entre projeto e evidência

**Caminho:** `_TRABALHO/04_MATRIZES/project_deliverable_crosswalk.csv`

- Registros: **59**
- Colunas: **30**
- Projetos cobertos: **59 de 59**
- Duplicações de `bm_project_id`: **0**
- Vínculos candidatos preenchidos: **72**
- Arquivos distintos por SHA-256: **53**
- Referências repetidas: **19**
- Projetos sem candidato: **7**

Distribuição do vínculo:

- comprovado: **21**
- corroborado: **10**
- provável: **8**
- ambíguo: **13**
- não localizado: **7**

Campos úteis:

`bm_project_id`, `link_strength`, `rule_used`, `caveats`, `candidate_count` e os campos iniciados por `candidate_1_` e `candidate_2_`.

Os caminhos de arquivos podem conter dados sensíveis. O backend deve guardar o caminho completo. A interface deve mostrar um rótulo seguro.

### Lista portátil de candidatos

**Caminho:** `ENTREGAVEIS/CONCILIACAO_MEDICOES_FATURAMENTO_PAGAMENTOS_V1_PORTATIL/DADOS/09_entregaveis_candidatos.csv`

- Registros: **79**
- Candidatos com caminho e hash: **72**
- Marcadores sem arquivo localizado: **7**
- Caminhos ou hashes distintos entre candidatos preenchidos: **53**
- Excesso de referências repetidas: **19**

Campos úteis:

`Projeto ou serviço`, `Caminho relativo`, `SHA-256`, `Tipo de arquivo`, `Situação da evidência`, `Arquivo no pacote`.

Esta lista é adequada para apresentação. O crosswalk é melhor para carga, pois usa `bm_project_id`.

### Inventário e duplicatas históricas

**Caminhos:**

- `_TRABALHO/agents/project-catalog/file-inventory.csv`
- `_TRABALHO/agents/project-catalog/project-candidates.csv`
- `_TRABALHO/agents/project-catalog/exact-duplicate-groups.csv`

Contagens do snapshot:

- arquivos inventariados: **1.789**
- candidatos de área, subprojeto ou arquivo: **90**
- arquivos presentes em grupos de duplicação exata: **298**
- grupos SHA-256 confirmados: **112**

Este inventário é um snapshot. Ele não deve funcionar como cadastro atual sem nova varredura.

## Riscos de duplicação e precedência

| Risco | Regra mínima |
|---|---|
| CSVs parciais de BMs | Aceitar somente `bm_activities_normalized.complete.csv` e verificar o SHA-256. |
| Três cópias do agregado projeto e BM | Importar uma cópia ou recalcular a partir das atividades canônicas. |
| Reimportação de `NFS.xlsx` | Usar `batch_id` mais `ID NFS-e` como chave. |
| Nota fiscal e título financeiro | Não somar PBIX, NF, FT, PA e PR ao total fiscal. |
| Evidência usada por vários projetos | Separar o arquivo do vínculo. Deduplicar o arquivo por SHA-256. |
| Várias versões narrativas | Registrar função, versão e hash. Não concatenar versões. |
| Caminho com conteúdo sensível | Guardar o caminho no backend. Não publicar o caminho bruto. |
| Matriz financeira antiga | A auditoria de `_TRABALHO/25_...` tem precedência sobre matrizes anteriores. |

## Menor modelo de dados

O MVP pode usar sete tabelas.

### `import_batch`

`id`, `source_type`, `relative_path`, `sha256`, `row_count`, `imported_at`, `status`.

### `project`

`id`, `source_project_id`, `title`, `date_start`, `date_end`, `bm_count`, `activity_count`, `hours_total`, `value_total`, `evidence_status`.

### `bm_activity`

`id`, `batch_id`, `project_id`, `source_row`, `bm_code`, `activity_date`, `month_period`, `duration_seconds`, `hourly_rate`, `value`, `quality_status`.

O primeiro release pode carregar as **3.364** linhas. As visões de **59** projetos e **347** grupos são derivadas.

### `fiscal_note`

`id`, `batch_id`, `source_note_id`, `issue_year`, `issue_date`, `amount`, `category`, `declared_project_id`.

Não inclua tomador, documento ou descrição no primeiro release.

### `financial_relation`

`fiscal_note_id`, `candidate_project_id`, `strength`, `state`, `criterion`, `allocation_status`, `snapshot_match_state`.

Esta tabela recebe as duas bases auditadas de **142** linhas.

### `evidence_asset` e `project_evidence`

`evidence_asset`: `id`, `sha256`, `file_type`, `private_path`, `access_level`.

`project_evidence`: `project_id`, `evidence_asset_id`, `strength`, `rule_used`, `caveat`, `status`.

Esta separação preserva **72** vínculos e somente **53** arquivos distintos.

### `narrative_document`

`id`, `document_role`, `private_path`, `sha256`, `version_status`, `access_level`, `line_count`.

O MVP não precisa de uma tabela de afirmações narrativas.

## Ordem mínima de importação

1. Verifique o caminho e o SHA-256 da fonte.
2. Crie um registro em `import_batch`.
3. Importe os **3.364** BMs e derive os **59** projetos.
4. Importe as **142** notas com chave composta pelo lote.
5. Anexe a classificação e a conciliação financeira pelo `ID NFS-e`.
6. Grave **53** evidências por hash e preserve os **72** vínculos.
7. Registre somente os metadados dos documentos narrativos.
8. Bloqueie a publicação de campos sensíveis e caminhos privados.

## Escopo que pode ficar fora do primeiro release

- as **450** referências financeiras históricas
- arquivos binários de evidência
- texto integral da narrativa
- nomes de pessoas e organizações
- documentos pessoais ou empresariais
- descrições livres de notas
- dimensões completas do Power BI
- referências de mercado
- hipóteses matemáticas rejeitadas

Este corte mantém rastreabilidade. Ele também reduz o risco de duplicação financeira e exposição de dados.
