# Evidências de validação local

Data: 2026-08-31

## Escopo

A validação usou somente fixtures fictícias e o estado local ignorado por Git. Nenhuma fonte original, documento pessoal ou dado real foi importado.

## Automação

Comando normal:

```bash
npm run check
```

Resultado do marco:

- 31 testes aprovados;
- ESLint aprovado;
- TypeScript aprovado pelo build;
- build de produção aprovado;
- sete rotas geradas, incluindo conferência, publicação e downloads HTML/CSV.

Os testes cobrem:

- moeda em centavos, sem ponto flutuante;
- congelamento do snapshot;
- separação dos grupos financeiros;
- corte inclusivo e fuso;
- adulteração de conteúdo e metadados;
- token de conferência obsoleto;
- XSS em HTML;
- injeção de fórmula em CSV, inclusive após espaços e caracteres invisíveis;
- remoção de caminhos locais;
- omissão de identificadores internos;
- geração determinística de HTML e CSV.

## Navegador

O fluxo foi executado no navegador embutido do Orca, com inspeção da árvore de acessibilidade:

1. buscar um projeto e filtrar a lista;
2. editar e salvar narrativa fictícia;
3. registrar pagamento fictício sem arquivo;
4. conferir alertas de evidência pendente, pagamento sem arquivo e relação incerta;
5. confirmar explicitamente os alertas;
6. publicar V1;
7. repetir a mesma publicação e verificar que nenhuma versão duplicada foi criada;
8. corrigir o rascunho;
9. publicar V2;
10. verificar que V1 preservou texto e hash anteriores;
11. verificar que V2 aponta para V1 e tem hash distinto.

A árvore apresentou `banner`, `main`, regiões nomeadas, tabelas com cabeçalhos, formulário rotulado e status de operação.

## Downloads

HTML e CSV retornaram HTTP 200 com:

- `Content-Disposition` com nome baseado no código público;
- `Cache-Control: private, no-store`;
- `X-Content-Type-Options: nosniff`;
- SHA-256 do artefato no cabeçalho;
- SHA-256 do snapshot publicado no cabeçalho;
- hash calculado dos bytes igual ao cabeçalho do artefato.

O HTML é autônomo, sem scripts ou recursos externos. O CSV usa UTF-8 com BOM, CRLF, campos entre aspas e neutralização de fórmulas.

## Proteção das origens

Após o marco, as árvores protegidas continuaram iguais à linha de base:

- `_bmad`: `c3ffd46aa4dcd780ba6c6155caaeaa61e7212ade7fc7da21a7989ce059621547`;
- `_bmad-output`: `690f23a86a0027b581fe06a0d2f58e3b06394691df6dbc684cb59920aef9c307`;
- `.agents`: `bf0a1cdf26222e6c5b44a4862092ff0d0823a14231704d6a0e4c80228cba425f`.

Os limites de persistência local e as condições para PostgreSQL/R2 estão em `docs/runtime-boundaries.md`.
