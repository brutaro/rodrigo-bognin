# UX mínima para o primeiro MVP

## Objetivo

O primeiro MVP deve ajudar **Rodrigo a registrar um projeto, conferir os valores e publicar uma prestação de contas confiável**. A interface deve parecer uma ferramenta pessoal de trabalho, não um portal corporativo.

A simplificação não pode reduzir a precisão. O produto ainda deve:

- separar conceitos financeiros que não são equivalentes;
- mostrar a origem de cada informação;
- preservar versões e arquivos originais;
- evitar substituição ou soma silenciosa;
- gerar uma publicação que corresponda à prévia autorizada por Rodrigo.

## Leitura crítica das cópias e dos mocks

Os documentos atuais têm boas invariantes, mas projetam uma organização maior do que o primeiro MVP precisa.

- **Início** repete caminhos no cabeçalho, no menu “Adicionar” e em cinco ações rápidas. Também mistura continuidade, pesquisa, recentes, pendências e indicadores. Rodrigo precisa decidir onde clicar antes de continuar o trabalho.
- **Projeto** repete estado, pendências e retomada antes de quatro áreas. Narrativa, valores, documentos e pendências parecem departamentos separados, embora façam parte de uma única tarefa.
- **Prévia** acerta ao separar controles internos do conteúdo exportável. Porém, a moldura executiva, os muitos metadados e os seis formatos tornam o fluxo maior que a decisão principal: conferir e publicar.
- **Publicação oficial** acerta ao mostrar versão, corte, cobertura e conteúdo autorizado. A lista de formatos e o resumo com muitos números dão aparência de portal institucional.
- **DESIGN.md** define uma identidade coerente, mas o número de tokens, estados, componentes, modo escuro e símbolo provisório cria trabalho que não valida o valor central do MVP.
- **EXPERIENCE.md** protege bem autoria, rastreabilidade e semântica financeira. O excesso está na quantidade de superfícies, permissões, estados globais e cenários de operação em equipe.

A proposta abaixo preserva as invariantes úteis e remove a estrutura corporativa.

## Princípio da experiência

Cada tela responde a uma pergunta de Rodrigo:

1. **Em que eu estava trabalhando?**
2. **O que preciso registrar ou conferir neste projeto?**
3. **É exatamente isto que quero publicar?**
4. **O que a pessoa que recebeu verá?**

Não há dashboard. Não há módulos independentes de Projetos, Documentos, Pendências e Publicações. Esses elementos aparecem no contexto do trabalho.

## Páginas mínimas

### 1. Entrar

Uma página com e-mail, senha, **Entrar** e **Esqueci minha senha**. Após entrar, Rodrigo volta ao ponto em que parou.

Não mostrar marca institucional extensa, novidades, métricas ou opções de organização.

### 2. Meu trabalho

É a única página inicial e também a lista de projetos.

Ordem do conteúdo:

1. **Continuar de onde parei** — um único cartão com projeto, ponto salvo e ação específica.
2. **Buscar projeto ou arquivo** — uma pesquisa simples.
3. **Novo projeto** — ação primária fixa.
4. **Projetos** — lista por atualização recente, com nome, período quando conhecido e estado simples.
5. **Arquivos para organizar** — aparece somente quando existem uploads ainda sem projeto.
6. **Publicações anteriores** — link discreto no fim da página; não é item de navegação global.

Estados de projeto visíveis: **Rascunho**, **Pronto para conferir** e **Publicado**. “Com alertas” aparece como texto próximo da ação, não como um estado concorrente.

### 3. Projeto

Uma página longa, com salvamento automático e quatro seções na ordem do trabalho. Não usar abas no MVP.

#### Cabeçalho curto

- nome do projeto;
- período, se conhecido;
- “Salvo às HH:MM”;
- ação **Ver como ficará** quando houver conteúdo publicável.

#### O que foi feito

Editor livre em primeira pessoa. As perguntas de apoio ficam recolhidas em **Precisa de ajuda para escrever?**. Informações importadas do BM aparecem em **Ver dados usados como referência**, sem gerar texto automaticamente.

#### Valores

Três grupos sempre separados:

1. **Custos e valores do projeto**;
2. **Notas ou cobranças**;
3. **Pagamentos**.

Cada linha mostra descrição, valor e origem. A ação **Adicionar valor** pergunta primeiro qual dos três tipos Rodrigo quer registrar. Depois mostra somente os campos necessários.

Não existe um total geral que some os três grupos. Um subtotal só pode aparecer dentro de um grupo e deve informar claramente sua regra.

#### Arquivos

Lista única dos arquivos ligados ao projeto. Cada item mostra nome, descrição curta, origem e a escolha **Incluir na publicação**. O padrão para novo arquivo é não incluir.

A ação **Adicionar arquivo** pede arquivo, descrição opcional e projeto. Nova versão nunca apaga a anterior.

#### Antes de publicar

Lista curta somente com itens que pedem decisão. Exemplos:

- “Este valor pode estar repetido.”
- “Esta nota tem valor diferente do pagamento.”
- “Este arquivo não será incluído.”
- “Você marcou esta informação como indisponível.”

Cada item oferece uma decisão concreta. Um campo vazio, por si só, não vira pendência. Rodrigo pode seguir após reconhecer um alerta editorial.

### 4. Conferir e publicar

Uma única rota com três etapas, sem páginas intermediárias na navegação:

1. **Escolher** — data de corte e projetos;
2. **Conferir** — prévia exata do conteúdo final;
3. **Publicar** — confirmação de Rodrigo e progresso da geração.

A prévia deve usar o mesmo modelo de leitura e o mesmo renderizador da publicação final. Controles como **Corrigir**, **Voltar** e **Publicar esta versão** ficam fora do conteúdo exportável.

Antes da confirmação, mostrar apenas:

- data de corte;
- projetos incluídos;
- cobertura, por exemplo “3 de 59 projetos”;
- aviso de publicação parcial, quando aplicável;
- formatos que serão gerados.

A ação final deve dizer **Publicar esta versão**. Qualquer alteração na composição exige nova confirmação. Depois do congelamento, uma tentativa de geração usa o mesmo conjunto de dados. Uma correção cria outra versão.

### 5. Publicação

Página de leitura sem cabeçalho do ambiente de trabalho.

Mostrar, nesta ordem:

- **Publicação oficial**;
- versão;
- data de corte e data de publicação;
- cobertura e indicação de recorte parcial;
- busca dentro desta versão;
- projetos publicados;
- downloads disponíveis.

Não mostrar alertas internos, pendências, justificativas, decisões de Rodrigo, IDs internos ou detalhes de armazenamento.

## Navegação

### Cabeçalho de Rodrigo

O cabeçalho interno contém somente:

- **TRIA / Meu trabalho** — volta ao início;
- busca;
- **Adicionar** — Projeto, Valor ou Arquivo;
- menu de Rodrigo — Conta e Sair.

Não há navegação global para Projetos, Documentos, Pendências e Publicações. Projeto e arquivo são encontrados em **Meu trabalho** ou pela busca. Pendências ficam dentro do projeto. Publicação começa no contexto de conferir o trabalho.

No celular, manter **Meu trabalho**, **Adicionar** e conta visíveis. A busca pode ocupar uma linha abaixo. Não esconder destinos essenciais em vários menus.

### Retorno e contexto

- Ao sair de um projeto, voltar à posição anterior em **Meu trabalho**.
- Ao corrigir algo na prévia, voltar à mesma posição da prévia atualizada.
- Ao entrar após expiração, voltar ao último rascunho.
- A ação principal em cada região deve ter verbo e destino claros.

## Componentes essenciais

1. **Cabeçalho simples** — início, busca, adicionar e conta.
2. **Continuar trabalho** — mostra somente o último contexto e a próxima ação.
3. **Linha de projeto** — nome, período, estado e última atualização.
4. **Editor com salvamento** — “Salvando…”, “Salvo às 14:32” ou falha com nova tentativa.
5. **Linha financeira** — tipo, descrição, valor e origem, sem grade contábil.
6. **Adicionar em contexto** — formulário progressivo na própria seção ou em um único diálogo.
7. **Linha de arquivo** — nome, versão, origem e inclusão na publicação.
8. **Origem e histórico** — painel secundário aberto por **Ver origem**.
9. **Aviso de conferência** — problema possível, consequência e escolhas de Rodrigo.
10. **Prévia publicável** — renderer final isolado dos controles internos.
11. **Cabeçalho da publicação** — versão, datas, cobertura e parcialidade.

Usar uma única paleta clara e acessível no MVP: fundo neutro, texto verde-escuro e cobre somente como acento/foco. Usar fonte do sistema, bordas simples, pouco arredondamento e nenhuma sombra decorativa. O símbolo pode ser apenas a palavra **TRIA** até ser validado.

## Linguagem

A interface fala diretamente com Rodrigo. Usar verbos comuns, frases curtas e consequência explícita.

| Em vez de | Usar |
|---|---|
| Dashboard | Meu trabalho |
| Entidade financeira | Valor |
| Persistência concluída | Salvo às 14:32 |
| Snapshot | Esta versão |
| Inconsistência crítica | Este valor pode estar repetido |
| Projeção final | O que será publicado |
| Publicação incompleta | Publicação parcial |
| Sem comprovação | Confirmado por Rodrigo — sem arquivo associado |
| Gerenciar acessos | Conta |
| Autorizar composição | Publicar esta versão |

Perguntas recomendadas:

- “O que foi realizado neste projeto?”
- “Que tipo de valor você quer registrar?”
- “O que este valor representa?”
- “De onde veio esta informação?”
- “Este arquivo deve aparecer na publicação?”
- “É isto que você quer publicar?”

Estados de ausência devem ser escolhas reais: **Não informado**, **Em apuração**, **Não aplicável** e **Informação indisponível**. Nunca converter ausência em zero.

## Precisão financeira sem aparência contábil

Estas regras são obrigatórias no MVP:

- Custo, valor do projeto, nota/cobrança e pagamento não são equivalentes.
- O sistema não soma grupos diferentes.
- Cada registro mantém valor original, descrição, tipo e origem.
- “Importado”, “Informado por Rodrigo” e “Com arquivo associado” têm significados distintos.
- Possível duplicidade ou diferença gera comparação, não correção automática.
- Rodrigo pode manter os dois registros, corrigir a entrada ou confirmar a diferença.
- Zero confirmado, ausência, pendência e item rejeitado continuam distintos.
- Formatação monetária usa `pt-BR`, moeda explícita e algarismos tabulares quando possível.

A interface mostra só o necessário. Detalhes adicionais ficam em **Ver origem**.

## Rastreabilidade sem estrutura de auditoria

Cada valor, texto e arquivo deve ter uma trilha acessível, mas não competir com a tarefa.

O painel **Ver origem** mostra em linguagem comum:

- de onde veio;
- quem registrou ou confirmou;
- quando foi alterado;
- arquivo e versão relacionados;
- versões anteriores, quando existirem.

Internamente, o MVP ainda deve preservar identificadores, hashes, autoria, horários e arquivo original. Esses dados não precisam aparecer na tela principal.

Importações seguem uma regra curta:

1. analisar a cópia recebida;
2. mostrar **Novo**, **Diferente**, **Pode estar repetido** ou **Não entendi**;
3. Rodrigo decide;
4. confirmar antes de incorporar;
5. nunca alterar o arquivo original nem substituir a fonte vigente em silêncio.

A publicação guarda um conjunto imutável do que Rodrigo confirmou. A busca e os downloads da publicação consultam somente esse conjunto.

## Adiar explicitamente

Ficam fora do primeiro MVP:

- colaboradores, convites, papéis e combinações de permissão;
- área separada para gerenciar acessos;
- navegação principal com quatro módulos;
- página global de Pendências;
- página global de Documentos com classificação avançada;
- dashboard, KPIs, gráficos e percentual de completude;
- modo escuro;
- validação final do símbolo e sistema de marca completo;
- notificações de produto além de recuperação de senha e falha de geração;
- conflito de edição entre vários colaboradores;
- decisões em lote e tabelas de importação avançadas;
- busca com filtros complexos, autocomplete por tipo e drill-down avançado;
- exceção para publicar arquivo marcado como privado;
- múltiplos perfis de leitor e portal de consulta com conta própria;
- geração simultânea de HTML, PDF, CSV, XLSX, ZIP e manifesto público.

Para o MVP, priorizar **HTML e PDF**. Adicionar **CSV financeiro** somente se uma necessidade real de conferência exigir. O manifesto técnico pode existir nos bastidores para integridade, sem virar formato ou página para Rodrigo.

Também ficam adiados campos ou cálculos sem regra aprovada. Em especial, não inventar percentual de completude nem usar “100%” como condição para publicar.

## Critério de corte do MVP

O MVP está simples o bastante quando Rodrigo consegue, sem treinamento:

1. abrir ou criar um projeto;
2. escrever o que foi feito;
3. registrar valores sem misturar custo, nota e pagamento;
4. anexar evidências e entender a origem dos dados;
5. resolver ou reconhecer avisos;
6. conferir exatamente o que sairá;
7. publicar uma versão imutável;
8. abrir o relatório final e encontrar versão, corte, cobertura e documentos.

Qualquer página, componente ou termo que não ajude uma dessas oito ações deve ser adiado.
