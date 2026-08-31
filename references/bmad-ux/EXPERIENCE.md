---
name: TRIA
title: "Experiência — RODRIGO-BOGNIN"
status: final
created: 2026-08-28
updated: 2026-08-29
sources:
  - ../../prds/prd-RODRIGO-BOGNIN-2026-08-28/prd.md
  - ../../prds/prd-RODRIGO-BOGNIN-2026-08-28/addendum.md
---

# TRIA — Experience Spine

## Foundation

TRIA é uma aplicação web privada, responsiva e em português, que Rodrigo pode operar integralmente sem equipe nem conhecimento de auditoria, infraestrutura ou contabilidade. Desktop/laptop é a superfície principal de alimentação; tablet e celular servem à consulta e às operações essenciais. O portal exige conexão. Somente os relatórios exportados funcionam offline.

Não há um sistema tecnológico de componentes definido nesta etapa. `DESIGN.md` é o contrato de identidade visual; este documento rege arquitetura da informação, comportamento, estados, interação, acessibilidade e jornadas. Modo escuro é essencial e deve ter paridade funcional com o claro.

Princípio operacional: **guardar tudo o que é necessário, mas mostrar somente o que ajuda Rodrigo naquele momento**. Fontes, hashes, lotes, armazenamento, Railway, GitHub e integridade permanecem nos bastidores; a interface apresenta origem e consequência em linguagem comum.

Os mocks promovidos são evidência visual das decisões extraídas abaixo, não uma fonte paralela de requisitos. **Os spines prevalecem em qualquer conflito com mock, wireframe, importação ou relatório.**

**Mapa do contrato:** [Arquitetura da informação](#information-architecture) · [Voz e tom](#voice-and-tone) · [Componentes](#component-patterns) · [Estados](#state-patterns) · [Interações](#interaction-primitives) · [Acessibilidade](#accessibility-floor) · [Responsividade](#responsive--platform) · [Referências e antipadrões](#inspiration--anti-patterns) · [Trabalho do projeto](#modelo-de-trabalho-do-projeto) · [Finanças](#semântica-financeira) · [Documentos e importação](#documentos-upload-e-importação) · [Pendências](#pendências-e-alertas) · [Publicação](#publicação-e-projeção-final) · [Acesso e sessão](#acesso-sessão-e-notificações) · [Critérios de aceite](#critérios-de-aceite-downstream) · [Fluxos](#key-flows) · [Itens diferidos](#itens-diferidos).

## Information Architecture

### Navegação global

No computador, `global-header` mantém quatro áreas horizontais, sem dropdown: **Início**, **Projetos**, **Documentos** e **Publicações**. `global-add-menu` é separado e contém Adicionar projeto; Adicionar informação, valor ou nota; Adicionar documento; Importar planilha. `account-menu` contém Gerenciar acessos, Aparência, Alterar senha e Sair. Importações e acessos não viram áreas principais. Pesquisa não é o único modo de descobrir funções.

| Superfície | Acesso | Propósito e saída |
|---|---|---|
| Entrar | URL privada / sessão expirada | E-mail, senha, recuperação; segue ao destino original ou Início |
| Recuperar acesso | Entrar → Esqueci minha senha | Solicitar link e criar nova senha sem suporte |
| Início | Abertura / navegação Início | Retomar, pesquisar, adicionar, consultar recentes e pendências |
| Projetos | Navegação Projetos / busca | Localizar, filtrar, criar e abrir projetos macro |
| Projeto | Linha de projeto / busca / relação | Reconhecer estado e chegar a Narrativa, Valores e notas, Documentos, Pendências ou projeção |
| Narrativa | Projeto | Escrever em primeira pessoa, consultar BM, salvar e revisar |
| Valores e notas | Projeto / relação / busca | Registrar e distinguir valor do projeto, nota/cobrança e pagamento |
| Documentos | Navegação Documentos / projeto / busca | Listar vinculados e Sem classificação; enviar, classificar e baixar |
| Documento | Linha / relação / projeto | Ver versão, descrição, associação, estado, prévia ou download |
| Pendências | Início / Projeto / publicação | Tratar atenção recomendada, informação pendente e ausência aceita |
| Importar planilha | `global-add-menu` | Selecionar fonte, reconhecer conteúdo e preparar conciliação |
| Prévia da importação | Importar planilha | Decidir linha a linha ou em lote antes de incorporar |
| Publicações | Navegação Publicações | Listar rascunhos, gerações e versões oficiais permitidas |
| Rascunho de publicação | Preparar publicação / retomar | Definir data de corte e projetos; salvar composição |
| Revisão de alertas | Rascunho de publicação | Entender e decidir alertas sem barreira editorial |
| Prévia da publicação | Revisão de alertas | Navegar exatamente pela projeção final e corrigir em contexto |
| Geração da publicação | Autorizar → Gerar publicação | Acompanhar HTML, PDF, CSV, XLSX, ZIP e manifesto |
| Publicação oficial | Lista / conclusão | Ver versão imutável e baixar formatos |
| Projeto publicado | Publicação oficial / busca local | Ler somente conteúdo final autorizado do projeto |
| Gerenciar acessos | `account-menu` | Convidar, combinar permissões, reenviar, alterar ou retirar acesso |
| Histórico e auditoria | Detalhes secundários de projeto, documento, valor ou decisão | Consultar autoria, versões, decisão e origem sem competir com a tarefa |

### Fechamento de superfícies

- Nova informação com projeto conhecido chega ao projeto pela busca ou Adicionar.
- Documento sem projeto chega a Documentos → Sem classificação e pode ser vinculado depois sem novo upload.
- Projeto inexistente nasce com apenas nome, em rascunho.
- Toda relação projeto ↔ valor/nota ↔ documento permite ida e volta.
- Toda versão oficial sai de um rascunho, revisão, prévia, autorização de Rodrigo e geração conferida.
- Leitor nunca entra nas superfícies de trabalho; sua navegação fica dentro do snapshot autorizado.

### Cobertura visual confirmada

| Estado-chave | Referência promovida | Decisões demonstradas |
|---|---|---|
| Início e navegação | [Início e navegação](mockups/key-inicio-navegacao.html) | Cabeçalho horizontal; continuidade; pesquisa principal; ações rápidas; recentes; pendências; paridade claro/escuro |
| Projeto em trabalho — Narrativa | [Projeto — Narrativa](mockups/key-projeto-trabalho.html#projeto-claro) | Reconhecimento; CTA contextual; quatro áreas; editor em primeira pessoa; BM como referência; salvamento |
| Projeto em trabalho — Valores e notas | [Projeto — Valores e notas](mockups/key-projeto-trabalho.html#valores-claro) | Três grupos financeiros separados; lista curta; cadastro progressivo; decisão de Rodrigo; alerta consultivo |
| Prévia da publicação | [Prévia da publicação](mockups/key-previa-publicacao.html) | Shell interna; renderer final isolado; correção fora da projeção exportável; autorização de Rodrigo |
| Publicação oficial | [Publicação oficial](mockups/key-publicacao-oficial.html) | Consulta exclusiva de Paulo; versão, corte, parcialidade e cobertura; somente conteúdo final autorizado |

As seguintes superfícies permanecem **spine-only**, sem mock dedicado: Entrar; Recuperar acesso; Projetos; Documentos; Documento; Pendências; Importar planilha; Prévia da importação; Publicações; Rascunho de publicação; Revisão de alertas; Geração da publicação; Gerenciar acessos; Histórico e auditoria. Seus layouts derivam das tabelas e regras deste documento e de `DESIGN.md`.

## Voice and Tone

A voz da marca vive em `DESIGN.md`; aqui vale a microcopy. TRIA fala como assistente de trabalho: curta, concreta, sem siglas desnecessárias, sem entusiasmo artificial e sem discutir com Rodrigo.

| Situação | Usar | Evitar |
|---|---|---|
| Retomada | “Você parou aqui. Seu progresso foi preservado.” | “Recuperamos seu state anterior.” |
| Busca | “Busque um projeto, nota ou documento.” | “Pesquisa global de entidades.” |
| Salvamento | “Salvando…” / “Salvo às 14:32.” | “Persistência concluída com sucesso.” |
| Falha | “Não foi possível salvar — tente novamente.” | Código de erro sem ação |
| Ausência | “Não informado”, “Em apuração”, “Não aplicável”, “Informação indisponível” | Preencher com zero ou suposição |
| Origem sem documento | “Confirmado por Rodrigo — sem documento associado.” | “Não comprovado” |
| Upload sem prévia | “Este arquivo não pode ser visualizado no portal, mas está disponível para download.” | Explicação de codec, bucket ou storage |
| Alerta | “Este valor pode estar repetido. Ele poderá aparecer duas vezes na publicação.” | “Inconsistência crítica detectada.” |
| Prévia | “Prévia — ainda não publicada.” | “Relatório final” antes da conclusão |
| Parcialidade | “Esta será uma publicação parcial.” | “Publicação incompleta” |
| Sessão | “Sua sessão terminou, mas seu trabalho foi preservado.” | “401 — sessão inválida.” |

Perguntas são orientadas à tarefa: “O que você quer registrar?”, “O que este valor representa?”, “O que foi realizado neste projeto?”. Termos canônicos necessários aparecem com explicação próxima; detalhes técnicos ficam em segundo plano.

## Component Patterns

Os nomes coincidem com `DESIGN.md.components`; esta tabela define comportamento.

| Componente | Uso | Regras comportamentais |
|---|---|---|
| `brand-lockup` | Cabeçalho, login, publicação | Cabeçalho: leva a Início. Login/publicação: identificação, não ação. Nome acessível é “TRIA”; símbolo decorativo. |
| `global-header` | Ambiente de trabalho | Persiste no desktop; contém somente quatro áreas, Adicionar e Rodrigo. Em telas estreitas, os itens se reorganizam sem ocultar destinos. |
| `primary-navigation-item` | Navegação global | Um item ativo com `aria-current`; clique preserva rascunhos salvos e não abre dropdown. |
| `global-add-menu` | Ações de entrada | Abre um menu curto com os quatro grupos definidos. Fecha com Escape, clique externo ou seleção; devolve foco ao gatilho. |
| `account-menu` | Conta, aparência e acessos | Gerenciar acessos; Aparência com Sistema, Claro e Escuro; Alterar senha; Sair. Sistema é o padrão inicial. A escolha explícita prevalece sobre mudanças posteriores do sistema. Sair alerta sobre salvamento ainda não confirmado e nunca apaga rascunho no servidor. |
| `continuation-card` | Início e Projeto | Apresenta último contexto e CTA dinâmico. Prioridade: Continuar rascunho → Revisar para publicação → Resolver pendências → Começar projeto. Nunca leva a destino genérico. |
| `global-search` | Início | Pesquisa projeto por nome e também nota ou documento relacionado. Resultados são agrupados por tipo; seleção abre a entidade, sem abertura automática. |
| `quick-action` | Início | Cinco ações: informação, valor/nota, documento, planilha, projeto. Cada uma inicia fluxo curto e salvável. |
| `data-panel` | Todas as áreas | Contém um grupo de informação com título e ação contextual; não vira dashboard decorativo. |
| `project-row` | Projetos, recentes, seleção de publicação | Linha inteira abre projeto; mostra nome, estado, atualização e alerta quando pertinente. Seleção de publicação adiciona controle de seleção explícito. |
| `document-row` | Documentos e projeto | Mostra nome, descrição, projeto/Sem classificação, estado e envio. Abre detalhe; download é ação separada. |
| `financial-summary` | Valores e notas, revisão e projeto publicado | No trabalho, apresenta três grupos titulados em listas curtas de descrição, valor e origem, com painel progressivo adjacente no desktop e abaixo no estreito; não usa tabela contábil. Nunca soma custo, nota, alocação, valor direto e pagamento como se fossem equivalentes. |
| `status-badge` | Rascunho, Privado, Liberado/Publicada e estados canônicos | Sempre contém texto. Não é controle. Estado composto usa rótulo completo, por exemplo “Parcial — 2 alertas”. |
| `alert-callout` | Pendências, revisão, importação e publicação | Explica item, percepção e consequência; oferece ação contextual. Para conteúdo: Voltar e revisar / Continuar mesmo assim. |
| `form-control` | Formulários progressivos | Rótulo persistente; opcionalidade explícita; aceita estados de ausência. Validação ocorre no gate correspondente, não ao primeiro campo vazio. |
| `primary-button` | Próximo passo principal | Um por região. Verbo e destino específicos; desabilitado somente quando a ação é tecnicamente impossível e com motivo adjacente. |
| `secondary-button` | Voltar, revisar, manter, baixar | Mantém dados preenchidos; nunca parece mais importante que a ação principal. |
| `autosave-indicator` | Narrativa e formulários | Cicla Salvando… → Salvo às HH:MM. Falha não afirma salvamento; preserva edição local quando possível e oferece nova tentativa. |
| `upload-progress` | Adicionar documento | Preparando → percentual → Concluído; Pausado e Falha mantêm metadados. Continuar retoma do ponto seguro quando suportado. |
| `generation-progress` | Geração da publicação | Lista HTML, PDF, CSV, XLSX, ZIP e manifesto em aguardando/em andamento/concluído/falha. Tentar novamente reaproveita concluídos. |
| `dialog` | Confirmações e alerta antes de continuar | Usa apenas uma camada, com título, consequência, Voltar e uma ação. Não exige justificativa para alerta editorial. |
| `data-table` | Importação, finanças, auditoria e relatórios densos | Cabeçalhos programáticos, ordenação anunciada, paginação; seleção em lote mantém contagem e decisão reversível. |
| `reader-publication-header` | Publicação oficial | Exibe oficialidade, versão, data de corte, data de publicação, parcialidade e cobertura; permanece disponível durante consulta. |
| `reader-publication-search` | Publicação oficial | Pesquisa somente a projeção congelada identificada por `publication_version_id`; autocomplete, contagem, snippets, filtros e links nunca consultam nem revelam o ambiente interno. |
| `empty-state` | Listas sem registros/resultados | Distingue “não há dados” de “não há resultados”; oferece uma ação que resolve o vazio, sem transformar campo vazio em pendência. |

## State Patterns

| Superfície | Carregando / vazio | Falha, permissão ou conexão | Retomada / foco |
|---|---|---|---|
| Entrar | Formulário direto, sem skeleton | Credenciais inválidas sem revelar conta; indisponibilidade preserva destino | Após autenticar, volta ao destino seguro original |
| Recuperar acesso | Confirma envio sem revelar se e-mail existe | Link inválido/expirado oferece novo envio | Senha criada leva a Entrar |
| Início | Skeleton com geometria da continuidade; vazio: “Seu espaço está pronto.” | Offline informa que o portal exige conexão | Mostra último rascunho/upload/publicação em geração aplicável |
| Projetos | Lista progressiva; vazio oferece Criar projeto | Sem permissão: área ausente; erro mantém filtros | Busca/filtros preservados na volta |
| Projeto | Resumo skeleton; somente nome é estado válido | Conflito preserva as duas versões recuperáveis | CTA segue prioridade canônica e retorna ao ponto exato |
| Narrativa | Editor vazio com orientação; BM carrega à parte | Falha de salvar mantém texto local e ação Tentar novamente | Cursor/ponto de edição e rascunho preservados |
| Valores e notas | Lista vazia oferece Adicionar informação financeira | Divergência/duplicidade é aviso; se uma regra financeira impedir a confirmação, a interface explica como salvar sem confirmar | Rascunho preserva tipo e campos já informados |
| Documentos | Lista vazia; Sem classificação é grupo válido | Falha de listagem não remove metadados conhecidos; acesso negado não revela arquivo | Filtro e posição preservados |
| Documento | Prévia skeleton quando suportada | Sem prévia oferece download; indisponibilidade técnica oferece tentar novamente | Versão selecionada permanece explícita |
| Pendências | Nenhuma: “Não há itens que peçam sua atenção.” | Falha não converte itens em resolvidos | Decisões registradas; item alterado reabre alerta |
| Importar planilha | Arquivo selecionado em análise | Falha orienta arquivo/coluna/nova tentativa; lote vigente permanece | Reentrada não duplica fonte idêntica |
| Prévia da importação | Quatro grupos podem estar vazios separadamente | Linha incompreensível fica para correção/ignorar | Seleções e correções locais preservadas |
| Publicações | Vazio oferece Preparar publicação | Leitor vê somente versões permitidas; erro de lista não expõe metadados | Rascunhos e gerações aparecem com Continuar |
| Rascunho de publicação | Sem projetos selecionados é válido para salvar | Se a data ou o recorte for inválido, a interface explica a condição necessária para avançar | Data, seleção, estados capturados e observação preservados |
| Revisão de alertas | Sem alertas avança à prévia | Alerta não analisado pede confirmação, não bloqueia | Decisão registrada; mudança do item invalida decisão |
| Prévia da publicação | Identificada “ainda não publicada” | Item indisponível sai da composição antes da autorização; descoberta posterior invalida autorização e exige nova prévia | Corrigir este item retorna à prévia atualizada |
| Geração da publicação | Estados por formato | Após congelar, falha não muda membros; um formato não refaz concluídos nem permite declarar conclusão integral | Pode sair; Início mostra Publicação em geração |
| Publicação oficial | Conteúdo congelado; formato só aparece se concluído | Acesso negado sem revelar conteúdo; falha de download permite tentar | Versão nunca muda; correção cria nova versão |
| Projeto publicado | Sem item autorizado, projeto não aparece | Link fora do snapshot não resolve nem revela metadados | Busca e navegação ficam confinadas ao mesmo `publication_version_id`, versão e data de corte |
| Gerenciar acessos | Lista vazia significa somente Rodrigo | Convite expirado oferece Reenviar; revogado perde acesso | Permissões combinadas e mudança confirmadas |
| Histórico e auditoria | Vazio é possível em registro recém-criado | Acesso restrito; falha não altera evento | Filtros preservados; detalhes técnicos ocultos até serem abertos |

**Estado global offline:** não há edição offline. Se a conexão cair, edições locais não confirmadas e upload em andamento são preservados quando tecnicamente possível, mas a interface não afirma “Salvo” até confirmação do servidor.

**Conflito de edição concorrente:** se o servidor detectar que o mesmo item mudou desde que Rodrigo ou um colaborador iniciou a edição, nenhuma versão é sobrescrita. O TRIA preserva a edição atual como **Sua versão**, apresenta a versão confirmada mais recente como **Versão mais recente** e destaca diferenças de texto ou de campos em uma superfície de comparação. Rodrigo decide entre **Usar minha versão**, **Usar a versão mais recente** ou **Combinar manualmente**. Combinar abre o editor com ambas como referência, sem fusão automática. As duas versões permanecem recuperáveis no histórico até a decisão; a escolha cria uma nova versão, registra autoria e horário e devolve foco ao item atualizado. Se outro colaborador encontrar o conflito, pode preservar seu rascunho, mas a decisão que substituirá o conteúdo confirmado pertence a Rodrigo.

## Interaction Primitives

- Clique/toque para agir; teclado oferece paridade completa. `Tab` segue leitura, `Enter` ativa e `Escape` fecha menu/diálogo superior sem perder dados.
- Nenhuma ação essencial depende de hover, arrastar, gesto oculto, cor ou precisão motora fina.
- Navegação bidirecional usa links explícitos “Ver projeto”, “Ver documento”, “Ver valor relacionado” e mantém contexto de retorno.
- Formulários revelam passos conforme a primeira escolha. Campos opcionais não aparecem como dívida; estados de ausência são escolhas reais.
- Salvamento automático ocorre durante edição e pelo menos uma vez por minuto; saída manual tenta salvar e comunica o resultado.
- Seleção em lote existe somente quando a mesma decisão pode ser compreendida para todos os itens; antes de aplicar, enumera quantidade e escopo.
- Mudanças destrutivas ou irreversíveis pedem confirmação; publicação oficial nunca é editada.
- Não há animação necessária. Mudança de estado é imediata; skeleton/progresso não pulsa de forma indispensável.
- **Proibido:** carrossel, rolagem infinita, alerta que bloqueia decisão editorial de Rodrigo, modal sobre modal, controle somente por hover e jargão técnico em primeiro plano.

## Accessibility Floor

- WCAG 2.1 AA nas telas principais. Combinações de contraste e foco vêm de `DESIGN.md`; cobre não recebe texto normal branco no claro.
- Todos os controles têm nome, papel e estado acessíveis. Ícone sozinho recebe rótulo; ícone decorativo fica oculto.
- Foco visível usa `{colors.focus}` / `{colors.focus-dark}` e não é removido. Ordem de foco acompanha ordem visual e de leitura.
- Alvos têm no mínimo 44 × 44 CSS px. Ações próximas não compartilham área ambígua.
- Zoom a 200% e texto ampliado não causam perda, sobreposição nem rolagem horizontal da página; tabelas usam transformação responsiva.
- Erros ligam mensagem ao campo, descrevem o problema e indicam ação. Resumo de erros recebe foco quando uma submissão falha.
- Alertas e estados usam texto além de `{colors.warning}`, `{colors.danger}`, `{colors.success}` ou badges.
- Estados textuais assíncronos — salvamento, upload e geração — usam `role="status"`, `aria-live="polite"` e atualização atômica. Percentuais usam `<progress>` ou `role="progressbar"` com nome, mínimo, máximo e valor atual; leitores de tela recebem marcos relevantes, conclusão e falha, não cada incremento mínimo.
- Diálogo contém foco, fecha com Escape quando seguro e devolve foco ao gatilho. Mudança irreversível não fecha por clique externo.
- HTML semântico: um `h1` por superfície, hierarquia sem saltos, landmarks, cabeçalhos de tabela e links com destino compreensível.
- Publicações HTML usam `lang="pt-BR"`, landmarks, ordem de leitura, títulos, texto alternativo, tabelas identificadas e versão/data de corte. PDF é marcado/estruturado, declara idioma `pt-BR`, mantém texto selecionável, árvore de títulos/listas, links acessíveis, texto alternativo e cabeçalhos de tabela associados; leitura linear e conformidade PDF/UA são verificadas quando a ferramenta de geração permitir.
- Como não há movimento essencial, preferência de redução de movimento é respeitada por padrão.

## Responsive & Platform

| Faixa | Navegação e composição | Capacidade |
|---|---|---|
| ≥ 1024 px | Cabeçalho horizontal completo; conteúdo até `{spacing.workspace-max}`; painéis podem usar duas colunas | Fluxos completos de alimentação, revisão e publicação |
| 768–1023 px | Cabeçalho reflui em duas linhas; quatro destinos continuam visíveis; painéis empilham | Fluxos completos, tabelas com resumo/expansão |
| < 768 px | Cabeçalho compacto; quatro destinos em faixa própria; conteúdo de coluna única | Consulta e operações essenciais; formulários longos em passos; sem rolagem horizontal |

Claro e escuro oferecem o mesmo conteúdo e estados. **Aparência**, no menu de Rodrigo, oferece Sistema, Claro e Escuro. Sistema é o padrão inicial e acompanha a preferência do dispositivo; uma escolha explícita de Claro ou Escuro prevalece até Rodrigo alterá-la. A preferência é persistida por conta/dispositivo conforme arquitetura, sem flash de tema incompatível, mudança de foco ou perda de estado. Relatórios offline mantêm conteúdo e navegação interna responsivos, mas não tentam executar funções do portal.

## Inspiration & Anti-patterns

- **Relatório gerencial HTML:** adotar perguntas executivas antes do detalhe, separação dos universos e tabelas legíveis; rejeitar densidade integral e exposição automática de auditoria no primeiro nível.
- **Apresentação executiva de RH:** adotar ritmo modular, títulos diretos e acentos institucionais; rejeitar excesso de gráficos, mosaicos e decoração de slide na área de trabalho.
- **Direção aprovada:** Relatório contemporâneo + Mata e Cobre; usar blocos inequívocos e transição visual entre trabalho e publicação.
- **Rejeitado — ERP/contábil:** árvores extensas, códigos, telas de lançamento densas e todos os estados financeiros simultâneos.
- **Rejeitado — dashboard-first:** gráficos e KPIs não competem com retomar, localizar ou registrar.
- **Rejeitado — wizard rígido:** Rodrigo pode salvar com o que souber, começar por narrativa, valor ou documento e retomar depois.
- **Rejeitado — “segurança” como veto editorial:** conteúdo recebe alerta e decisão auditável; somente indisponibilidade técnica local impede incorporar o item inexistente.

## Modelo de Trabalho do Projeto

### Reconhecer e continuar

Ao abrir um projeto, mostrar somente nome, resumo curto, período, custo principal, estado, quantidade de pendências, último salvamento e `continuation-card`. Conteúdo se organiza em Narrativa, Valores e notas, Documentos e Pendências. Histórico, versões, autoria, origem técnica e classificações detalhadas ficam em aprofundamento.

CTA principal:

1. **Continuar rascunho** — volta ao ponto exato e confirma preservação.
2. **Revisar para publicação** — quando o projeto pode ser publicado, abre a projeção.
3. **Resolver pendências** — abre lista priorizada, sem iniciar alteração automática.
4. **Começar projeto** — pergunta “O que foi realizado neste projeto?” e permite começar também por valor, nota ou documento.

### Narrativa

Editor livre com texto atual, Rascunho/Revisado, última gravação e “Conte, em primeira pessoa, o que aconteceu neste projeto.” Perguntas de apoio são opcionais: por que começou; o que eu fiz; o que foi entregue; resultado/mudança; o que a diretoria precisa entender; o que segue pendente.

BM aparece como referência separada — período, horas, atividades e custo medido — e nunca gera texto automaticamente. `autosave-indicator` acompanha a edição. Revisar texto mostra modo de leitura sem exigir perguntas completas. A história é escrita e confirmada por Rodrigo.

Referência visual: [Projeto em trabalho — Narrativa](mockups/key-projeto-trabalho.html#projeto-claro).

### Prontidão

TRIA verifica clareza mínima; Rodrigo marca **Pronto para publicação**. Requisitos: nome; narrativa mínima; resumo revisado; valores exibidos com significado e origem; documentos selecionados identificáveis; ausências/pendências claras. Nota, comprovante, valor, BM, data completa, lista de pessoas ou documento não são obrigatórios.

Alertas de conteúdo nunca vetam Rodrigo. Arquivo tecnicamente inexistente não entra, mas o restante prossegue. Mensagem padrão: “Este projeto pode ser publicado, mas ainda possui 3 pendências.”

## Semântica Financeira

`financial-summary` abre com três grupos visivelmente separados: valores do projeto; notas ou cobranças; pagamentos. Cada grupo é uma lista curta, não uma tabela contábil; o item mostra somente descrição, valor e origem — Importado, Informado por Rodrigo ou Com documento. No desktop, a lista e o painel de cadastro progressivo convivem lado a lado; no estreito, empilham na mesma ordem.

Adicionar informação financeira abre o painel progressivo e pergunta primeiro o tipo. Depois, pergunta somente o valor, o significado, se existe documento e se Rodrigo quer confirmar ou salvar como rascunho. Número, data e detalhes são opcionais quando desconhecidos. Possível diferença ou repetição aparece como `alert-callout` consultivo junto à lista, com revisar, manter ambos ou confirmar; não assume linguagem de erro nem bloqueia a decisão.

Referência visual: [Projeto em trabalho — Valores e notas](mockups/key-projeto-trabalho.html#valores-claro).

Regras de apresentação:

- “Confirmado por Rodrigo — sem documento associado.”
- “Pagamento informado por Rodrigo” é diferente de “Pagamento com documento associado”.
- Custo medido, valor facial/contextual da nota, alocação à NFS-e, valor direto do projeto, pagamento informado e pagamento com comprovante nunca se fundem.
- Possível duplicidade ou diferença mostra comparação e oferece revisar, manter ambos ou confirmar; o sistema não decide identidade.
- Valor acima do saldo mostra parcela ligada à nota e diferença como valor direto antes da confirmação.
- Zero confirmado, pendência, rejeição e ausência permanecem semanticamente distintos.

## Documentos, Upload e Importação

Todo documento novo começa **Em trabalho — não será publicado**. Rodrigo pode marcar Liberado para publicação ou Privado — não publicar. A inclusão excepcional de um item privado é decisão interna enumerada: a revisão mostra documento, versão exata, publicação/snapshot alvo, hash quando aplicável e a consequência de manter o estado global privado. A autorização vale somente para esse membro; nova versão, novo snapshot ou mudança de hash exige nova decisão. O leitor não vê o badge privado nem versões não selecionadas. Dentro do projeto, ele vem selecionado; Sem classificação permanece alternativa.

Upload: escolher arquivo → descrição opcional → projeto/Sem classificação → enviar. `upload-progress` mostra Preparando, percentual, Concluído, Pausado ou Falha. Sessão expirada pausa e retorno continua. Arquivo incompleto nunca parece disponível. PBIX, MP4, XLSM, XLSB e formatos sem prévia continuam baixáveis e nunca executam conteúdo ativo. Nova versão preserva anterior.

Importação: escolher planilha e, se necessário, declarar projetos/atividades ou valores/notas. Antes de incorporar, resumir arquivo, tipo, linhas, período e totais; classificar linhas em Novas, Já existem mas estão diferentes, Possível repetição e Não foi possível entender. Rodrigo inclui, ignora, corrige apenas a cópia de entrada, mantém ambos ou decide em lote. Mostrar resumo final e exigir Confirmar importação. Fonte original nunca muda; falha nunca apaga estado vigente.

## Pendências e Alertas

Campo vazio não vira problema automaticamente. Um item aparece somente quando ajuda Rodrigo.

| Grupo | Significado | Saídas |
|---|---|---|
| Atenção recomendada | Duplicidade, diferença, documento não liberado, arquivo incompleto, conteúdo privado/credencial, ausência documental ou período incompleto | Corrigir, retirar, confirmar/publicar mesmo assim; indisponibilidade técnica é identificada à parte |
| Informação pendente | Rodrigo pretende complementar pessoa, classificação, valor, data ou narrativa | Corrigir agora, manter pendente, informação indisponível |
| Ausência aceita | Decisão de não fornecer ou inexistência | Não informado, Não aplicável, Informação indisponível, Confirmado sem documento |

A pendência termina quando Rodrigo preenche a informação, aceita a ausência, confirma a informação, mantém os registros, retira o item ou decide seguir. Alerta aceito deixa de ser erro e fica no histórico interno; alteração relevante reabre a conferência.

## Publicação e Projeção Final

### Preparar e revisar

Preparar publicação cria rascunho; não gera arquivos. Pergunta primeiro a data de corte e explica que informações posteriores ficam fora. Cada projeto mostra nome, estado, atualização e alertas; estados combináveis: Pronto para publicação, Parcial, Com alertas. Qualquer projeto pode ser selecionado. Mostrar “3 de 59 projetos selecionados” e “Esta será uma publicação parcial” sem bloquear.

Rascunho preserva data, seleção, estado capturado e observações. Início oferece Continuar preparação da publicação.

Revisão apresenta lista única de alertas por projeto/documento, com item, mensagem e consequência. Rodrigo decide individualmente ou em lote: Voltar e revisar / Continuar mesmo assim. Alteração do item invalida decisão. Alertas não analisados exigem somente confirmação antes da prévia.

### Prévia, autorização e geração

A prévia começa com “Prévia — ainda não publicada” e usa exatamente o modelo de leitura (`read model`) e o renderizador final do leitor. Esse renderizador fica dentro de uma shell interna separada: “Prévia — ainda não publicada”, “Corrigir este item”, instrumentação e identificadores de trabalho ficam fora do DOM exportável e nunca entram em HTML, PDF ou demais formatos. A prévia mostra corte, cobertura, parcialidade e conteúdo escolhido. Corrigir este item abre o ponto correto e volta à prévia atualizada sem perder rascunho.

Referência visual: [Prévia da publicação](mockups/key-previa-publicacao.html).

Autorizar publicação resume corte, projetos, parcialidade e formatos. Só Rodrigo autoriza a composição exata; qualquer alteração anterior ao congelamento invalida a autorização. Indisponibilidade descoberta antes da autorização retira o item da prévia. Se descoberta depois da autorização e antes do congelamento, a autorização é invalidada, a prévia reaparece com a omissão e Rodrigo precisa autorizar novamente; somente então o restante pode prosseguir sem o item.

Gerar publicação congela primeiro a composição autorizada e inicia a fabricação real. Depois do congelamento, membros, conteúdo, versões e hashes não mudam: indisponibilidade de leitura ou falha de formato é recuperável sobre o mesmo snapshot imutável e nunca causa omissão ou incorporação silenciosa. `generation-progress` acompanha HTML, PDF, CSV, XLSX, ZIP e manifesto. Pode sair e retomar. Falha localizada tem Tentar novamente; concluídos são preservados e regenerações consultam somente o snapshot. Publicação torna-se oficial e imutável somente quando formatos obrigatórios estão concluídos e conferidos; correção futura cria nova versão.

### Regra canônica da projeção final do leitor

> **O leitor e todas as exportações oficiais recebem somente o conteúdo final expressamente autorizado por Rodrigo. Processos e estados internos permanecem no ambiente de trabalho.**

A projeção final é um `read model` (modelo de leitura) materializado, versionado e exclusivo da publicação, gerado no congelamento. Usa **default deny** (negação por padrão): cada entidade e cada formato têm uma lista positiva de campos (`allowlist`). Um campo novo do modelo interno permanece oculto até ser incluído deliberadamente em uma versão do esquema público. Endpoints, renderizadores, busca, downloads e exportadores do leitor consultam somente essa projeção ligada ao `publication_version_id`, nunca tabelas, DTOs, índices ou links do ambiente de trabalho.

| Entidade pública | Allowlist da projeção autorizada |
|---|---|
| Publicação | identificador público opaco, versão, data de corte, data de publicação, parcialidade e cobertura editorial |
| Projeto | identificador público opaco no snapshot, nome, narrativa final, período, atividades/entregas, horas e custo apresentados |
| Informação financeira | identificador público opaco, grupo e rótulo simples, descrição, valor e data/período somente quando autorizados, além da relação pública selecionada |
| Documento | identificador público opaco do membro, nome lógico, descrição autorizada, tipo, tamanho e versão exata selecionada; não inclui estados nem versões internas não escolhidas |

HTML e PDF recebem a leitura editorial; CSV e XLSX recebem somente as tabelas finais autorizadas, sem fórmulas ou propriedades ocultas internas; ZIP contém apenas formatos concluídos e artefatos autorizados; manifesto recebe somente seu esquema seguro. A mesma projeção e os mesmos identificadores públicos reconciliam contagens e totais entre os formatos.

O manifesto público permite somente a versão da publicação, a data de corte, o nome lógico ou caminho portátil, o tamanho, o tipo, o SHA-256 e o identificador público opaco do membro autorizado. Não inclui IDs internos, bucket ou chave de objeto, URL assinada, caminho absoluto ou local, ator, filtro, perfil técnico, alerta, decisão, justificativa nem segredo operacional. Evidência autorizada grande que não couber no pacote aparece por referência opaca; o download resolve por rota autenticada do portal após controle de acesso, nunca por endereço permanente ou URL assinada embutida.

Paulo vê oficialidade, versão, datas, parcialidade, cobertura, projetos, narrativa, período, atividades, valores, notas, pagamentos e documentos selecionados. **Cobertura** significa recorte editorial, como “3 de 59 projetos publicados em detalhe”, nunca percentual interno de completude, quantidade de pendências, projetos em revisão ou inferência equivalente. `reader-publication-search` exige `publication_version_id`; autocomplete, contagem, snippets, filtros, resultados, links e drill-down contêm somente membros dessa projeção. Uma consulta por identificador fora da projeção não revela se o item existe.

Paulo não vê rascunhos, alertas, pendências de trabalho, rejeições, limitações aceitas, decisões, justificativas, histórico ou proveniência técnica, salvo texto que Rodrigo incorpore deliberadamente à narrativa final.

Referência visual: [Publicação oficial](mockups/key-publicacao-oficial.html).

## Acesso, Sessão e Notificações

Rodrigo entra com e-mail/senha e recupera senha por link. Em Gerenciar acessos, informa o e-mail e combina três permissões visíveis:

- **Editar** — adicionar, alterar, anexar e revisar conteúdo do ambiente de trabalho;
- **Publicar** — preparar e gerar uma publicação cuja composição já tenha sido autorizada por Rodrigo;
- **Somente consultar** — consultar e baixar o conteúdo permitido, sem alterar registros.

**Autorizar publicação** e administrar acessos permanecem capacidades exclusivas de Rodrigo. A permissão Publicar nunca substitui sua autorização editorial. Convidado aceita o convite e cria senha; convite expirado oferece Reenviar. Rodrigo altera ou retira acesso quando quiser.

Antes da expiração, um `dialog` anunciado com antecedência suficiente informa “Sua sessão está prestes a terminar”, apresenta o prazo sem contagem excessiva e oferece **Continuar sessão** como ação principal e **Sair** como alternativa. Rodrigo pode estender a sessão novamente dentro dos limites de segurança. Enquanto o diálogo estiver aberto, o foco permanece dentro dele; após a decisão, retorna ao gatilho ou ao contexto anterior. Se a sessão expirar, o rascunho permanece salvo, o upload pausa e, depois do login, continua do mesmo ponto. Não há notificações de produto além de convite, recuperação, sessão, upload e geração da publicação; alertas operacionais de infraestrutura não compõem a experiência de Rodrigo.

## Critérios de Aceite Downstream

1. **Projeção default-deny:** um campo-canário novo ou interno não aparece em endpoint, busca, HTML, PDF, CSV, XLSX, ZIP, manifesto, metadado, comentário, fórmula, nome de aba ou índice até entrar expressamente na allowlist versionada.
2. **Consistência e imutabilidade:** os seis formatos reconciliam IDs públicos, contagens e totais da mesma projeção; mutação antes do congelamento invalida autorização, e retry depois dele não incorpora dado vivo nem muda membros.
3. **Omissão pós-autorização:** objeto removido/corrompido entre autorização e congelamento retorna à prévia alterada e exige nova autorização; após congelar, a mesma falha produz retry sobre o snapshot, não omissão.
4. **Documento privado exato:** somente documento + versão + snapshot/hash enumerados e autorizados atravessam a exceção; estado global, outras versões e publicações futuras permanecem privados.
5. **Busca e drill-down confinados:** conteúdo existente apenas fora de `publication_version_id` não aparece em resultado, autocomplete, contagem, snippet, link ou diferença observável; ID externo não revela existência.
6. **Manifesto e evidência grande:** manifesto contém somente sua allowlist; referência opaca exige autenticação e nunca exporta bucket, chave, URL assinada, caminho local, ator, decisão ou segredo.
7. **Acessibilidade multimodal:** executar teclado e leitores de tela nas superfícies principais, medir contraste de default/hover/pressed/focus/disabled/open-selected/error nos dois temas e validar reflow sem perda a 320 CSS px/zoom equivalente.
8. **Exportações acessíveis:** validar no HTML o idioma `pt-BR` e a semântica. Validar no PDF as tags, o idioma, o texto selecionável, a ordem linear, os títulos, as listas, os links, o texto alternativo e os cabeçalhos de tabela, com PDF/UA quando disponível.
9. **Concorrência sem perda:** duas edições sobre a mesma versão nunca produzem sobrescrita silenciosa; Sua versão e Versão mais recente permanecem recuperáveis, a comparação destaca diferenças e somente a decisão registrada por Rodrigo cria a versão confirmada seguinte.
10. **Tempo e progresso:** sessão anuncia e estende o prazo; salvamento, upload e geração expõem `status`/`progressbar` sem repetição excessiva e preservam retomada após falha ou login.

## Key Flows

### Fluxo principal — Rodrigo importa BMs ou NFS.xlsx sem substituir silenciosamente a fonte vigente

1. Rodrigo abre Importar planilha, escolhe o arquivo e confirma se contém projetos e atividades ou valores e notas quando o reconhecimento não for suficiente.
2. O portal identifica o tipo: para BM, preserva rótulos originais e separa o mapeamento canônico; para NFS.xlsx, valida as nove colunas e identifica a chave natural `Ano + NFS-e`.
3. Se o hash já foi aceito no mesmo contexto, informa que o arquivo já existe e não cria linhas, lote ou total duplicado.
4. Para arquivo diferente, cria uma prévia com quantidade, período, totais e diferenças em relação ao lote vigente; nenhuma linha entra ainda.
5. Rodrigo decide incluir, atualizar, ignorar, corrigir somente a cópia de entrada ou manter ambos, individualmente ou em lote.
6. Confere o resumo de linhas incluídas, atualizadas, ignoradas e mantidas para revisão; então confirma ou volta sem perder decisões.
7. **Clímax:** ao confirmar, todos os registros validados e reconciliados tornam-se vigentes juntos, a fonte original e o lote anterior permanecem imutáveis, e nenhum total é duplicado.
8. Rodrigo recebe contagem do que entrou, mudou ou foi ignorado e pode abrir as exceções acionáveis em linguagem simples.

Falha: estrutura inválida, coluna ausente ou interrupção durante validação/ativação → o portal explica o ajuste possível, preserva o arquivo original, a prévia e as decisões recuperáveis, e mantém integralmente o lote anterior como vigente; ativação parcial é proibida.

### Jornada âncora — Rodrigo completa a prestação de contas de um projeto para entrar na próxima publicação

1. Rodrigo encontra em planilhas, pastas ou conversas uma entrega, valor, nota, documento ou despesa ainda mal representada.
2. Entra no TRIA, pesquisa o projeto e confere BMs importados.
3. Complementa narrativa em primeira pessoa, período e o que sabe; `autosave-indicator` confirma a gravação.
4. Registra o valor e seu significado; associa nota ou documento quando existir ou confirma sua própria declaração.
5. Anexa evidências e mantém o desconhecido como pendência explícita.
6. Revisa e confirma, como proprietário, o que deseja usar, sem validação externa obrigatória.
7. **Clímax:** o resumo confirmado por Rodrigo responde o que foi feito, quando, quanto custou, quais valores, notas e pagamentos se relacionam, quais documentos sustentam e o que segue pendente; todos os caminhos são bidirecionais.
8. Marca Pronto para publicação ou preserva o projeto atualizado com pendências visíveis.

Falha: salvamento ou upload interrompe → o conteúdo local e os metadados são preservados, a mensagem explica a falha e Retomar volta ao ponto seguro; nenhum dado é inventado.

### UJ-1 — Marina reconstrói a prestação de contas de um projeto executado

1. Marina abre projeto importado e consulta atividades, BM, período, duração, custo e origem.
2. Complementa descrição, período, pessoas, estados de ausência e narrativa.
3. Anexa e classifica evidências; usa Sem classificação se o vínculo for desconhecido.
4. Registra relação com NFS-e, referência adicional ou valor direto e seu significado.
5. Distingue pagamento informado de pagamento com comprovante.
6. Salva o rascunho, submete-o ou o confirma, conforme sua permissão.
7. **Clímax:** navega Projeto → BM → evidência → valor ou nota → pagamento e de volta, entendendo origem e estado sem alterar a fonte.
8. Sai com progresso e histórico preservados e correções acionáveis.

Falha: valor excede saldo → divisão fiscal + valor direto é mostrada antes de confirmar; documento ausente não bloqueia, e campo vazio não vira zero.

### UJ-2 — Carlos revisa uma relação financeira sem precisar interpretar a infraestrutura de auditoria

1. Carlos abre relação submetida e vê autor, origem, documento opcional e resumo monetário.
2. Compara projeto, BM, evidências e registros potencialmente duplicados lado a lado.
3. Confere valor da nota, já relacionado, disponível, solicitado e saldo projetado.
4. Responde perguntas guiadas sobre decisão, significado, origem, documento e correção.
5. Aprova, devolve, rejeita ou mantém pendente; o portal explica o efeito.
6. **Clímax:** decide com base nos fatos visíveis enquanto integridade, hash e evento auditável são gravados sem preenchimento técnico.
7. Retorna à lista com totais e saldo coerentes e decisão registrada.

Falha: integridade não pode ser registrada ou saldo mudou concorrentemente → conclusão é recusada, análise preservada e novos valores são mostrados para tentar novamente.

### UJ-3 — Renata prepara e Rodrigo autoriza uma versão imutável

1. Renata cria rascunho, define corte e seleciona projetos, vendo universo e parcialidade.
2. Revisa separadamente alertas de conteúdo, pendências internas e indisponibilidades técnicas.
3. Confere grupos financeiros sem fusão e seleciona versões e documentos.
4. Abre prévia do leitor e corrige itens em contexto sem perder rascunho.
5. Rodrigo decide cada alerta ou conjunto enumerado e autoriza a composição exata.
6. Renata ou Rodrigo inicia geração e acompanha cada formato.
7. **Clímax:** todos os formatos obrigatórios são conferidos contra o mesmo snapshot e a versão passa a Publicada, oficial e imutável.
8. Ações finais: Ver publicação, Baixar arquivos, Voltar ao início ou Criar nova versão.

Falha: PDF falha após o congelamento → HTML e demais concluídos permanecem; Tentar novamente refaz só o necessário sobre o mesmo snapshot. Item sem bytes íntegros detectado antes do congelamento retorna à prévia e exige nova autorização de Rodrigo se a composição já havia sido autorizada.

### UJ-4 — Paulo compreende e consulta uma publicação parcial autorizada

1. Paulo autenticado abre uma versão permitida na lista de publicações oficiais.
2. Identifica a versão, a data de corte, a data de publicação, a parcialidade e a cobertura.
3. Lê resumo de projetos, período, horas, custo, valores, notas e documentos autorizados.
4. Pesquisa projeto e consulta narrativa, atividades, valores, notas, pagamentos e documentos selecionados.
5. Navega apenas entre membros do snapshot e baixa formatos concluídos.
6. **Clímax:** entende o recorte e distingue custo, valores e pagamentos sem ver processo interno, alerta, decisão ou justificativa.
7. Encerra sabendo exatamente qual versão e data de corte consultou.

Falha: tenta abrir item fora do snapshot/perfil → acesso é negado e registrado sem revelar nome, metadado ou existência confidencial.

## Itens diferidos

- O indicador interno de **percentual mapeado/completude** fica diferido deste incremento porque sua fórmula não foi aprovada. Nenhuma superfície, história ou teste deve inventar o cálculo, usá-lo como gate, prometer 100% ou mostrá-lo ao leitor. Sua inclusão futura depende de requisito e fórmula reconciliados no PRD.
