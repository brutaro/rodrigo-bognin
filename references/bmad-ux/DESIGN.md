---
name: TRIA
description: Sistema visual editorial e executivo para organizar, rastrear e publicar a prestação de contas de Rodrigo com clareza.
title: "Identidade visual — RODRIGO-BOGNIN"
status: final
created: 2026-08-28
updated: 2026-08-29
sources:
  - ../../prds/prd-RODRIGO-BOGNIN-2026-08-28/prd.md
  - ../../prds/prd-RODRIGO-BOGNIN-2026-08-28/addendum.md
colors:
  background: '#F5F5EF'
  surface: '#FFFFFF'
  surface-raised: '#FBFAF5'
  text: '#183329'
  text-muted: '#66726C'
  border: '#D8DDD7'
  border-strong: '#B1BDB6'
  control-border: '#66726C'
  primary: '#174D3B'
  on-primary: '#FFFFFF'
  primary-soft: '#E5F0EA'
  primary-border: '#BED4C8'
  accent: '#CB5C2B'
  accent-soft: '#FFF0DE'
  focus: '#CB5C2B'
  success: '#267A55'
  on-success: '#FFFFFF'
  success-soft: '#E5F3EB'
  warning: '#AD5C19'
  warning-foreground: '#183329'
  on-warning: '#FFFFFF'
  warning-soft: '#FFF0DE'
  danger: '#A23A34'
  on-danger: '#FFFFFF'
  danger-soft: '#FCEBE8'
  info: '#287186'
  on-info: '#FFFFFF'
  info-soft: '#E5F1F4'
  draft: '#836E1E'
  draft-foreground: '#183329'
  on-draft: '#FFFFFF'
  draft-soft: '#F4EDCE'
  private: '#744D67'
  on-private: '#FFFFFF'
  private-soft: '#F2E9EF'
  published: '#267A55'
  published-soft: '#E5F3EB'
  continuation: '#174D3B'
  continuation-mid: '#205E49'
  continuation-copy: '#D2E4DA'
  background-dark: '#101713'
  surface-dark: '#18231D'
  surface-raised-dark: '#1D2B24'
  text-dark: '#F1F5F1'
  text-muted-dark: '#AEBBAF'
  border-dark: '#33463A'
  border-strong-dark: '#5A7462'
  control-border-dark: '#5A7462'
  primary-dark: '#7AC4A2'
  on-primary-dark: '#0E291C'
  primary-soft-dark: '#1B382B'
  primary-border-dark: '#315C46'
  accent-dark: '#F08A59'
  accent-soft-dark: '#3B2B18'
  focus-dark: '#F08A59'
  success-dark: '#72D3A0'
  on-success-dark: '#0E291C'
  success-soft-dark: '#183B2A'
  warning-dark: '#F3B36A'
  warning-foreground-dark: '#F3B36A'
  on-warning-dark: '#0E291C'
  warning-soft-dark: '#3B2B18'
  danger-dark: '#FF8B81'
  on-danger-dark: '#0E291C'
  danger-soft-dark: '#422320'
  info-dark: '#72C1D2'
  on-info-dark: '#0E291C'
  info-soft-dark: '#19333A'
  draft-dark: '#E5CD6D'
  draft-foreground-dark: '#E5CD6D'
  on-draft-dark: '#0E291C'
  draft-soft-dark: '#3A351B'
  private-dark: '#D1A2C0'
  on-private-dark: '#0E291C'
  private-soft-dark: '#382B34'
  published-dark: '#72D3A0'
  published-soft-dark: '#183B2A'
  continuation-dark: '#174D3B'
  continuation-mid-dark: '#285B47'
  continuation-copy-dark: '#D2E4DA'
typography:
  display:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif'
    fontSize: 36px
    fontWeight: '900'
    lineHeight: '1'
    letterSpacing: -0.045em
  display-mobile:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif'
    fontSize: 27px
    fontWeight: '900'
    lineHeight: '1.05'
    letterSpacing: -0.035em
  headline:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif'
    fontSize: 26px
    fontWeight: '800'
    lineHeight: '1.12'
    letterSpacing: -0.03em
  section:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif'
    fontSize: 16px
    fontWeight: '800'
    lineHeight: '1.25'
  body:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif'
    fontSize: 15px
    fontWeight: '400'
    lineHeight: '1.45'
  body-small:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif'
    fontSize: 13px
    fontWeight: '400'
    lineHeight: '1.45'
  label:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif'
    fontSize: 12px
    fontWeight: '800'
    lineHeight: '1.25'
  meta:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif'
    fontSize: 11px
    fontWeight: '700'
    lineHeight: '1.35'
  overline:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif'
    fontSize: 10px
    fontWeight: '900'
    lineHeight: '1.3'
    letterSpacing: 0.13em
rounded:
  none: 0px
  sm: 4px
  md: 4px
  full: 9999px
spacing:
  '1': 4px
  '2': 8px
  '3': 12px
  '4': 16px
  '5': 20px
  '6': 24px
  '7': 32px
  '8': 40px
  '9': 48px
  gutter-desktop: 32px
  gutter-tablet: 20px
  gutter-mobile: 12px
  workspace-max: 1190px
components:
  brand-lockup:
    foreground: '{colors.text}'
    foreground-dark: '{colors.text-dark}'
    typography: '{typography.section}'
    symbol-size: 35px
  global-header:
    background: '{colors.surface}'
    background-dark: '{colors.surface-dark}'
    border: '{colors.border}'
    border-dark: '{colors.border-dark}'
    min-height: 72px
  primary-navigation-item:
    foreground: '{colors.text-muted}'
    foreground-dark: '{colors.text-muted-dark}'
    active-foreground: '{colors.text}'
    active-foreground-dark: '{colors.text-dark}'
    active-indicator: '{colors.accent}'
    active-indicator-dark: '{colors.accent-dark}'
    hover-background: '{colors.primary-soft}'
    hover-background-dark: '{colors.primary-soft-dark}'
    pressed-background: '{colors.primary-border}'
    pressed-background-dark: '{colors.primary-border-dark}'
    pressed-foreground: '{colors.text}'
    pressed-foreground-dark: '{colors.text-dark}'
    focus: '{colors.focus}'
    focus-dark: '{colors.focus-dark}'
  global-add-menu:
    background: '{colors.primary}'
    background-dark: '{colors.primary-dark}'
    foreground: '{colors.on-primary}'
    foreground-dark: '{colors.on-primary-dark}'
    hover-background: '{colors.continuation-mid}'
    hover-background-dark: '{colors.published-dark}'
    pressed-background: '{colors.text}'
    pressed-background-dark: '{colors.primary-border-dark}'
    pressed-foreground: '{colors.on-primary}'
    pressed-foreground-dark: '{colors.text-dark}'
    open-background: '{colors.primary-soft}'
    open-background-dark: '{colors.primary-soft-dark}'
    open-foreground: '{colors.primary}'
    open-foreground-dark: '{colors.primary-dark}'
    focus: '{colors.focus}'
    focus-dark: '{colors.focus-dark}'
    disabled-background: '{colors.surface-raised}'
    disabled-background-dark: '{colors.surface-raised-dark}'
    disabled-foreground: '{colors.text-muted}'
    disabled-foreground-dark: '{colors.text-muted-dark}'
    disabled-border: '{colors.control-border}'
    disabled-border-dark: '{colors.control-border-dark}'
    min-height: 44px
  account-menu:
    background: '{colors.surface}'
    background-dark: '{colors.surface-dark}'
    foreground: '{colors.text}'
    foreground-dark: '{colors.text-dark}'
    border: '{colors.control-border}'
    border-dark: '{colors.control-border-dark}'
    hover-background: '{colors.primary-soft}'
    hover-background-dark: '{colors.primary-soft-dark}'
    pressed-background: '{colors.primary-border}'
    pressed-background-dark: '{colors.primary-border-dark}'
    open-background: '{colors.primary-soft}'
    open-background-dark: '{colors.primary-soft-dark}'
    open-border: '{colors.primary}'
    open-border-dark: '{colors.primary-dark}'
    focus: '{colors.focus}'
    focus-dark: '{colors.focus-dark}'
    disabled-background: '{colors.surface-raised}'
    disabled-background-dark: '{colors.surface-raised-dark}'
    disabled-foreground: '{colors.text-muted}'
    disabled-foreground-dark: '{colors.text-muted-dark}'
    disabled-border: '{colors.control-border}'
    disabled-border-dark: '{colors.control-border-dark}'
    min-height: 44px
  continuation-card:
    background: '{colors.continuation}'
    background-dark: '{colors.continuation-dark}'
    foreground: '{colors.on-primary}'
    foreground-dark: '{colors.text-dark}'
    secondary-background: '{colors.continuation-mid}'
    secondary-background-dark: '{colors.continuation-mid-dark}'
    copy: '{colors.continuation-copy}'
    copy-dark: '{colors.continuation-copy-dark}'
    radius: '{rounded.none}'
  global-search:
    background: '{colors.surface}'
    background-dark: '{colors.surface-dark}'
    foreground: '{colors.text}'
    foreground-dark: '{colors.text-dark}'
    border: '{colors.control-border}'
    border-dark: '{colors.control-border-dark}'
    hover-border: '{colors.primary}'
    hover-border-dark: '{colors.primary-dark}'
    focus: '{colors.focus}'
    focus-dark: '{colors.focus-dark}'
    disabled-background: '{colors.surface-raised}'
    disabled-background-dark: '{colors.surface-raised-dark}'
    disabled-foreground: '{colors.text-muted}'
    disabled-foreground-dark: '{colors.text-muted-dark}'
    error-border: '{colors.danger}'
    error-border-dark: '{colors.danger-dark}'
    min-height: 56px
  quick-action:
    background: '{colors.surface}'
    background-dark: '{colors.surface-dark}'
    foreground: '{colors.text}'
    foreground-dark: '{colors.text-dark}'
    icon: '{colors.accent}'
    icon-dark: '{colors.accent-dark}'
    border: '{colors.control-border}'
    border-dark: '{colors.control-border-dark}'
    hover-background: '{colors.primary-soft}'
    hover-background-dark: '{colors.primary-soft-dark}'
    pressed-background: '{colors.primary-border}'
    pressed-background-dark: '{colors.primary-border-dark}'
    selected-border: '{colors.primary}'
    selected-border-dark: '{colors.primary-dark}'
    focus: '{colors.focus}'
    focus-dark: '{colors.focus-dark}'
    disabled-background: '{colors.surface-raised}'
    disabled-background-dark: '{colors.surface-raised-dark}'
    disabled-foreground: '{colors.text-muted}'
    disabled-foreground-dark: '{colors.text-muted-dark}'
    disabled-border: '{colors.control-border}'
    disabled-border-dark: '{colors.control-border-dark}'
    min-height: 86px
  data-panel:
    background: '{colors.surface}'
    background-dark: '{colors.surface-dark}'
    border: '{colors.border}'
    border-dark: '{colors.border-dark}'
  project-row:
    background: '{colors.surface}'
    background-dark: '{colors.surface-dark}'
    divider: '{colors.border}'
    divider-dark: '{colors.border-dark}'
    hover-background: '{colors.surface-raised}'
    hover-background-dark: '{colors.surface-raised-dark}'
    pressed-background: '{colors.primary-border}'
    pressed-background-dark: '{colors.primary-border-dark}'
    selected-background: '{colors.primary-soft}'
    selected-background-dark: '{colors.primary-soft-dark}'
    selected-border: '{colors.primary}'
    selected-border-dark: '{colors.primary-dark}'
    focus: '{colors.focus}'
    focus-dark: '{colors.focus-dark}'
    min-height: 62px
  document-row:
    background: '{colors.surface}'
    background-dark: '{colors.surface-dark}'
    divider: '{colors.border}'
    divider-dark: '{colors.border-dark}'
    hover-background: '{colors.surface-raised}'
    hover-background-dark: '{colors.surface-raised-dark}'
    pressed-background: '{colors.primary-border}'
    pressed-background-dark: '{colors.primary-border-dark}'
    selected-background: '{colors.primary-soft}'
    selected-background-dark: '{colors.primary-soft-dark}'
    selected-border: '{colors.primary}'
    selected-border-dark: '{colors.primary-dark}'
    focus: '{colors.focus}'
    focus-dark: '{colors.focus-dark}'
  financial-summary:
    background: '{colors.surface-raised}'
    background-dark: '{colors.surface-raised-dark}'
    border: '{colors.border}'
    border-dark: '{colors.border-dark}'
    number: '{typography.headline}'
  status-badge:
    radius: '{rounded.full}'
    typography: '{typography.meta}'
    draft: '{colors.draft-foreground}'
    draft-dark: '{colors.draft-foreground-dark}'
    draft-background: '{colors.draft-soft}'
    draft-background-dark: '{colors.draft-soft-dark}'
    private: '{colors.private}'
    private-dark: '{colors.private-dark}'
    private-background: '{colors.private-soft}'
    private-background-dark: '{colors.private-soft-dark}'
    published: '{colors.published}'
    published-dark: '{colors.published-dark}'
    published-background: '{colors.published-soft}'
    published-background-dark: '{colors.published-soft-dark}'
  alert-callout:
    background: '{colors.warning-soft}'
    background-dark: '{colors.warning-soft-dark}'
    foreground: '{colors.warning-foreground}'
    foreground-dark: '{colors.warning-foreground-dark}'
    marker: '{colors.warning}'
    marker-dark: '{colors.warning-dark}'
  form-control:
    background: '{colors.surface}'
    background-dark: '{colors.surface-dark}'
    foreground: '{colors.text}'
    foreground-dark: '{colors.text-dark}'
    border: '{colors.control-border}'
    border-dark: '{colors.control-border-dark}'
    hover-border: '{colors.primary}'
    hover-border-dark: '{colors.primary-dark}'
    open-border: '{colors.primary}'
    open-border-dark: '{colors.primary-dark}'
    selected-border: '{colors.primary}'
    selected-border-dark: '{colors.primary-dark}'
    focus: '{colors.focus}'
    focus-dark: '{colors.focus-dark}'
    disabled-background: '{colors.surface-raised}'
    disabled-background-dark: '{colors.surface-raised-dark}'
    disabled-foreground: '{colors.text-muted}'
    disabled-foreground-dark: '{colors.text-muted-dark}'
    disabled-border: '{colors.control-border}'
    disabled-border-dark: '{colors.control-border-dark}'
    error-border: '{colors.danger}'
    error-border-dark: '{colors.danger-dark}'
    min-height: 44px
  primary-button:
    background: '{colors.primary}'
    background-dark: '{colors.primary-dark}'
    foreground: '{colors.on-primary}'
    foreground-dark: '{colors.on-primary-dark}'
    hover-background: '{colors.continuation-mid}'
    hover-background-dark: '{colors.published-dark}'
    pressed-background: '{colors.text}'
    pressed-background-dark: '{colors.primary-border-dark}'
    pressed-foreground: '{colors.on-primary}'
    pressed-foreground-dark: '{colors.text-dark}'
    focus: '{colors.focus}'
    focus-dark: '{colors.focus-dark}'
    disabled-background: '{colors.surface-raised}'
    disabled-background-dark: '{colors.surface-raised-dark}'
    disabled-foreground: '{colors.text-muted}'
    disabled-foreground-dark: '{colors.text-muted-dark}'
    disabled-border: '{colors.control-border}'
    disabled-border-dark: '{colors.control-border-dark}'
    min-height: 44px
  secondary-button:
    background: '{colors.surface}'
    background-dark: '{colors.surface-dark}'
    foreground: '{colors.primary}'
    foreground-dark: '{colors.primary-dark}'
    border: '{colors.primary}'
    border-dark: '{colors.primary-dark}'
    hover-background: '{colors.primary-soft}'
    hover-background-dark: '{colors.primary-soft-dark}'
    pressed-background: '{colors.primary-border}'
    pressed-background-dark: '{colors.primary-border-dark}'
    pressed-foreground: '{colors.primary}'
    pressed-foreground-dark: '{colors.text-dark}'
    focus: '{colors.focus}'
    focus-dark: '{colors.focus-dark}'
    disabled-background: '{colors.surface-raised}'
    disabled-background-dark: '{colors.surface-raised-dark}'
    disabled-foreground: '{colors.text-muted}'
    disabled-foreground-dark: '{colors.text-muted-dark}'
    disabled-border: '{colors.control-border}'
    disabled-border-dark: '{colors.control-border-dark}'
    min-height: 44px
  autosave-indicator:
    foreground: '{colors.text-muted}'
    foreground-dark: '{colors.text-muted-dark}'
    error: '{colors.danger}'
    error-dark: '{colors.danger-dark}'
  upload-progress:
    track: '{colors.border}'
    track-dark: '{colors.border-dark}'
    fill: '{colors.primary}'
    fill-dark: '{colors.primary-dark}'
    error: '{colors.danger}'
    error-dark: '{colors.danger-dark}'
  generation-progress:
    track: '{colors.border}'
    track-dark: '{colors.border-dark}'
    fill: '{colors.primary}'
    fill-dark: '{colors.primary-dark}'
    complete: '{colors.success}'
    complete-dark: '{colors.success-dark}'
  dialog:
    background: '{colors.surface}'
    background-dark: '{colors.surface-dark}'
    foreground: '{colors.text}'
    foreground-dark: '{colors.text-dark}'
    border: '{colors.border-strong}'
    border-dark: '{colors.border-strong-dark}'
    radius: '{rounded.sm}'
  data-table:
    header-background: '{colors.primary}'
    header-background-dark: '{colors.primary-soft-dark}'
    header-foreground: '{colors.on-primary}'
    header-foreground-dark: '{colors.text-dark}'
    divider: '{colors.border}'
    divider-dark: '{colors.border-dark}'
    row-hover: '{colors.surface-raised}'
    row-hover-dark: '{colors.surface-raised-dark}'
    row-selected: '{colors.primary-soft}'
    row-selected-dark: '{colors.primary-soft-dark}'
    selected-border: '{colors.primary}'
    selected-border-dark: '{colors.primary-dark}'
    focus: '{colors.focus}'
    focus-dark: '{colors.focus-dark}'
    error: '{colors.danger}'
    error-dark: '{colors.danger-dark}'
  reader-publication-header:
    background: '{colors.primary}'
    background-dark: '{colors.surface-dark}'
    foreground: '{colors.on-primary}'
    foreground-dark: '{colors.text-dark}'
    accent: '{colors.accent}'
    accent-dark: '{colors.accent-dark}'
  reader-publication-search:
    background: '{colors.surface}'
    background-dark: '{colors.surface-dark}'
    foreground: '{colors.text}'
    foreground-dark: '{colors.text-dark}'
    border: '{colors.control-border}'
    border-dark: '{colors.control-border-dark}'
    hover-border: '{colors.primary}'
    hover-border-dark: '{colors.primary-dark}'
    focus: '{colors.focus}'
    focus-dark: '{colors.focus-dark}'
    disabled-background: '{colors.surface-raised}'
    disabled-background-dark: '{colors.surface-raised-dark}'
    disabled-foreground: '{colors.text-muted}'
    disabled-foreground-dark: '{colors.text-muted-dark}'
    disabled-border: '{colors.control-border}'
    disabled-border-dark: '{colors.control-border-dark}'
    error-border: '{colors.danger}'
    error-border-dark: '{colors.danger-dark}'
    min-height: 44px
  empty-state:
    background: '{colors.surface-raised}'
    background-dark: '{colors.surface-raised-dark}'
    foreground: '{colors.text-muted}'
    foreground-dark: '{colors.text-muted-dark}'
    border: '{colors.border}'
    border-dark: '{colors.border-dark}'
---

## Brand & Style

TRIA significa **Transparência, Rastreabilidade, Informação e Autoria**. O nome curto é a marca cotidiana; a expansão funciona como assinatura institucional em login, apresentações e publicações quando houver espaço. A marca comunica que fatos dispersos formam uma história clara sem apagar sua origem nem retirar de Rodrigo a autoria da decisão.

A direção aprovada combina **Relatório contemporâneo** com **Mata e Cobre**: composição modular, alto contraste, ritmo de relatório executivo e poucos acentos. O resultado deve parecer uma área de trabalho editorial — não ERP, sistema contábil ou dashboard de BI. Hierarquia vem de títulos diretos, blocos delimitados, números com contexto e espaço em branco; gráficos são exceção, nunca decoração.

O símbolo provisório é a opção 1: um traço contínuo forma um `T` sutil e comunica conexão, percurso e rastreabilidade. O símbolo foi aceito para avaliação, mas ainda não é um ativo definitivo. Deve ser revalidado em cabeçalho, login, favicon e publicação.

As referências promovidas materializam a direção em cinco estados-chave: [Início e navegação](mockups/key-inicio-navegacao.html); [Projeto em trabalho — Narrativa](mockups/key-projeto-trabalho.html#projeto-claro) e [Projeto em trabalho — Valores e notas](mockups/key-projeto-trabalho.html#valores-claro); [Prévia da publicação](mockups/key-previa-publicacao.html); e [Publicação oficial](mockups/key-publicacao-oficial.html). Os quatro artefatos demonstram a mesma linguagem nos modos claro e escuro; o símbolo continua provisório.

## Colors

A paleta usa somente valores aprovados nos artefatos Mata e Cobre e TRIA — Início e navegação.

- **Verde-floresta** (`{colors.primary}` / `{colors.primary-dark}`) carrega marca, ação primária, continuidade e confiança documental.
- **Cobre** (`{colors.accent}` / `{colors.accent-dark}`) marca posição atual, ícones, foco e pontos de decisão. Não é preenchimento padrão de botão com texto pequeno no claro: cobre + branco mede 4,11:1. Use `{colors.primary}` + `{colors.on-primary}` (9,72:1) em controles pequenos.
- **Fundos e superfícies** (`{colors.background}`, `{colors.surface}`, `{colors.surface-raised}` e pares `-dark`) separam planos por tom, não por excesso de sombra.
- **Texto** usa `{colors.text}` / `{colors.text-dark}`; texto secundário usa `{colors.text-muted}` / `{colors.text-muted-dark}`. As combinações-base atingem pelo menos 4,5:1.
- **Limites de controle** usam `{colors.control-border}` / `{colors.control-border-dark}`, com pelo menos 3:1 contra as superfícies adjacentes. `{colors.border}` continua reservado a divisores e contornos decorativos que não precisam identificar um controle.
- **Estados** têm famílias separadas para sucesso, atenção, erro, informação, rascunho e privado. Cor nunca é o único sinal: sempre há rótulo e, quando acionável, consequência e ação.
- **Texto de atenção e rascunho** usa `{colors.warning-foreground}` e `{colors.draft-foreground}` no claro, e os pares `-dark` no escuro; marcador e fundo preservam a família semântica. Todos os pares de texto normal atingem 4,5:1.
- **Liberado/Publicada** reutiliza sucesso; **Privado — não publicar** usa `private`; **Rascunho** usa `draft`. Estados editoriais não se confundem com erro técnico.

Alvos: 4,5:1 para texto normal; 3:1 para texto grande e limites/ícones essenciais; foco visível com 3:1 contra superfícies adjacentes. Toda nova combinação deve ser medida nos dois modos.

## Typography

TRIA usa a pilha de sistema em `{typography.body.fontFamily}`. Não há dependência de fonte externa: carregamento previsível, números legíveis e operação offline dos relatórios têm prioridade sobre a personalidade de uma fonte importada.

- `{typography.display}`: saudação e aberturas no desktop; `{typography.display-mobile}` em telas estreitas.
- `{typography.headline}`: projeto e etapas de valor narrativo.
- `{typography.section}`: painéis e grupos.
- `{typography.body}`: texto, formulários e narrativa.
- `{typography.body-small}` e `{typography.meta}`: origem, atualização e estados.
- `{typography.overline}`: rótulos curtos como “Continuar de onde parou”; nunca parágrafos.

Valores monetários usam algarismos tabulares quando possível. Rótulo e valor permanecem juntos; cor, posição ou alinhamento não substituem o conceito financeiro.

## Layout & Spacing

Desktop é a superfície principal de alimentação. O conteúdo respeita `{spacing.workspace-max}`, centralizado, com `{spacing.gutter-desktop}`. A página inicial segue continuidade → busca → ações rápidas → recentes → pendências. O projeto segue reconhecer → continuar → aprofundar → conferir publicação.

Nos estados promovidos, Início usa uma faixa de continuidade dominante, busca rotulada em largura total, cinco ações modulares e uma base assimétrica para recentes e pendências. Projeto preserva o reconhecimento e a continuidade antes da navegação entre quatro áreas. Narrativa usa editor e referência dos BMs lado a lado no desktop; Valores e notas usa lista curta e painel progressivo lado a lado. Essas duplas empilham no estreito sem mudar a ordem de leitura. Prévia envolve o renderer do leitor em uma shell interna visualmente distinta; Publicação oficial remove o chrome de trabalho e mantém somente consulta, recorte e conteúdo autorizado.

A escala de 4 px (`{spacing.1}` a `{spacing.9}`) organiza relações locais. 8–16 px agrupa; 20–32 px separa blocos; 40–48 px separa capítulos. Painéis modulares podem compartilhar bordas e usar intervalo de 1 px.

No tablet, use `{spacing.gutter-tablet}` e empilhe secundários. No celular, use `{spacing.gutter-mobile}`, preserve ordem de leitura e evite rolagem horizontal. Tabelas densas viram listas resumidas com expansão; operações complexas continuam possíveis, sem serem redesenhadas como experiência exclusivamente móvel.

## Elevation & Depth

Profundidade é tonal. `{colors.background}` contém `{colors.surface}` e `{colors.surface-raised}`; pares `-dark` cumprem o mesmo papel. Divisores de 1 px usam `{colors.border}` ou `{colors.border-strong}`; limites necessários para reconhecer ou operar um controle usam `{colors.control-border}`.

Sombras aparecem somente em menus flutuantes e diálogos. A sombra aprovada é difusa (`0 24px 70px rgba(24,51,41,.14)` no claro; `rgba(0,0,0,.38)` no escuro). Hierarquia operacional não depende de sombra.

## Shapes

TRIA é modular e editorial. Painéis, ações rápidas, campos e botões usam `{rounded.none}`. `{rounded.sm}` fica para diálogos e pequenos contêineres separados do plano. `{rounded.full}` é exclusivo de badges e avatares.

O símbolo pode conter linhas e círculos; isso não transforma a interface em cartões arredondados. Fotos preservam proporção e não recebem recorte ou tratamento automático.

## Components

Os nomes abaixo são o contrato visual; comportamento está em `EXPERIENCE.md`.

Em cada mapa, `background`, `foreground` e `border` sem prefixo são o estado **default**. Estados **hover**, **pressed**, **focus**, **disabled**, **open/selected** e **error** usam as chaves correspondentes somente quando o componente os admite. Foco é contorno adicional, nunca substituição de selected/open; disabled mantém rótulo e limite legíveis; error não apaga valor nem ajuda. Se um estado não se aplica — por exemplo pressed em campo de texto ou open em botão simples — ele não deve ser simulado.

- **`brand-lockup`** — símbolo provisório + TRIA; 35 px no desktop, 30 px em telas estreitas.
- **`global-header`** — marca, navegação e ações globais em 72 px, com borda inferior.
- **`primary-navigation-item`** — estado ativo usa texto principal e linha de 3 px em `{colors.accent}`; hover/pressed ganham fundo tonal e foco mantém contorno explícito.
- **`global-add-menu`** — controle global de alto destaque em verde-floresta para contraste AA; quando aberto, usa uma superfície tonal com texto verde, e hover, pressed, focus e disabled têm tokens próprios.
- **`account-menu`** — ação secundária com contraste de borda de pelo menos 3:1, nome e indicador; o estado aberto usa fundo tonal + borda primária, além de hover, pressed, focus e disabled explícitos.
- **`continuation-card`** — contexto, estado e ação em alto contraste; texto em `{colors.continuation-copy}`.
- **`global-search`** — 56 px, sem arredondamento, ícone cobre, limite de controle e foco explícito; hover altera a borda, erro usa danger e disabled mantém limite legível; placeholder não substitui rótulo.
- **`quick-action`** — módulo de 86 px no desktop, ícone cobre + verbo; hover/pressed usam camadas tonais, selected recebe borda primária e focus permanece visível.
- **`data-panel`** — painel sem sombra para listas, pendências, detalhes e resumos.
- **`project-row`**, **`document-row`** — nome/descrição primeiro; estado e atualização depois; divisor leve. Hover/pressed alteram fundo, selected combina fundo tonal + borda primária e focus não depende da seleção.
- **`financial-summary`** — composição anti-contábil demonstrada em [Projeto em trabalho — Valores e notas](mockups/key-projeto-trabalho.html#valores-claro): três grupos titulados — Valores do projeto, Notas ou cobranças e Pagamentos — formam listas curtas de descrição, valor e origem, nunca uma grade de lançamentos. No desktop, a lista convive com o painel progressivo; no estreito, ambos empilham. O `alert-callout` consultivo permanece adjacente ao conjunto, sem virar bloqueio ou total combinado.
- **`status-badge`** — rótulo para Rascunho, Privado e Publicada/Liberado; nunca única explicação.
- **`alert-callout`** — faixa com marcador, mensagem, consequência e ações; não é bloqueio editorial.
- **`form-control`** — mínimo 44 px, rótulo persistente, ajuda e erro próximos; default/hover/disabled mantêm limite de 3:1, erro usa danger e foco usa `{colors.focus}`.
- **`primary-button`**, **`secondary-button`** — mínimo 44 px, verbo específico; default, hover, pressed, focus e disabled têm pares claro/escuro explícitos, sem opacidade como único sinal de indisponibilidade.
- **`autosave-indicator`** — “Salvando…”, “Salvo às 14:32” ou falha acionável.
- **`upload-progress`**, **`generation-progress`** — trilha, preenchimento e estado textual; geração lista cada formato.
- **`dialog`** — confirmação curta, foco contido e duas ações; não empilhar.
- **`data-table`** — cabeçalho verde, divisores e rótulos persistentes; linhas nos estados hover e selected, além de foco e erro, têm tokens próprios; no estreito vira pares rótulo-valor.
- **`reader-publication-header`** — versão oficial, corte, publicação, parcialidade e cobertura antes do conteúdo.
- **`reader-publication-search`** — pesquisa visualmente equivalente à busca do portal, mas pertencente ao snapshot publicado; limite de controle, hover, foco e erro seguem os mesmos pares acessíveis.
- **`empty-state`** — explica ausência e oferece no máximo uma ação; não inventa pendência.

## Do's and Don'ts

| Do | Don't |
|---|---|
| Verde em ações com texto pequeno; cobre como acento/foco | Cobre com texto branco pequeno no claro ou novos tons não aprovados |
| Continuidade, busca e ação primeiro | Abrir com KPIs, gráficos ou todas as funções |
| Claro e escuro semanticamente equivalentes | Tratar escuro como simples inversão |
| Separar custo, nota, valor direto e pagamentos | Somar universos financeiros em um cartão |
| Rótulo + cor + consequência para estados | Comunicar estado apenas por cor |
| Bordas e camadas tonais | Sombras, gradientes e cartões arredondados em excesso |
| Símbolo provisório com respiro | Distorcer ou promover antes da validação final |
| Fotografias e fontes preservadas | Filtros, recortes ou ornamentação automática |
| Reusar princípios editoriais das referências | Copiar aparência de ERP, planilha ou apresentação carregada |

Referências visuais: o [relatório gerencial HTML](imports/reference-relatorio-gerencial-v4.html) orienta legibilidade, hierarquia executiva e separação dos universos; a [apresentação executiva de RH](imports/reference-apresentacao-executiva-rh-2025.pdf) orienta composição institucional, ritmo modular e uso contido de verde/cobre. São inspiração, não modelos obrigatórios.

**Lacuna real:** o símbolo permanece provisório; a decisão final depende da validação em cabeçalho, login, favicon e publicação.
