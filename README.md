# TRIA — Plano B

MVP privado e simples para Rodrigo organizar projetos, narrativas, valores, evidências e publicações.

## Isolamento

Este projeto vive exclusivamente em `RODRIGO-BOGNIN/PLANO_B_TRIA/`.

- `_bmad`, `_bmad-output` e `.agents` são somente leitura.
- Referências reaproveitadas são cópias registradas em `docs/copied-reference-manifest.json`.
- A integridade das origens protegidas é registrada em `docs/protected-origin-manifest.json`.
- Nenhuma fonte original é alterada, recalculada ou sobrescrita.

## Estado atual

A primeira fatia é uma consulta navegável com dados totalmente fictícios:

- lista e busca de projetos;
- página do projeto;
- narrativa;
- atividades e medições;
- referências financeiras sem soma indevida;
- evidências.

Nenhum dado real foi carregado. Edição, banco, R2 e publicação serão adicionados em fatias posteriores.

## Executar

Requer Node.js 22.

```bash
npm install
npm run dev
```

Abra `http://localhost:3000`.

## Validar

```bash
npm run lint
npm run build
```

## Decisões simples

- Uma conta: Rodrigo.
- Um armazenamento operacional: R2 privado.
- Limite interno conservador: 9 GB.
- Sem OCI ou outro provedor de referência externa.
- Sem upgrade automático ou cobrança não aprovada.
- Sem parsing ou execução de PBIX, macros, scripts ou consultas de arquivos enviados.
- Relação, alocação, valor e pagamento permanecem conceitos distintos.
