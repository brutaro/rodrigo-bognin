# TRIA — Plano B

MVP privado e simples para Rodrigo organizar projetos, narrativas, valores, evidências e publicações.

## Isolamento

Este projeto vive exclusivamente em `RODRIGO-BOGNIN/PLANO_B_TRIA/`.

- `_bmad`, `_bmad-output` e `.agents` são somente leitura.
- Referências reaproveitadas são cópias registradas em `docs/copied-reference-manifest.json`.
- A integridade das origens protegidas é registrada em `docs/protected-origin-manifest.json`.
- Nenhuma fonte original é alterada, recalculada ou sobrescrita.

## Estado atual

A fatia local usa somente dados fictícios e oferece:

- lista, busca e consulta de projetos;
- narrativa editável com histórico;
- atividades, BMs e medições sem confundir medição com pagamento;
- referências importadas separadas de cadastros manuais;
- pagamentos informados sem presumir comprovante;
- conferência com alertas e confirmação explícita;
- publicação imutável, versionada e protegida por hash;
- exportações HTML autônomo e CSV protegido contra fórmulas;
- verificação de integridade antes de exibir ou exportar.

Uploads, autenticação, PostgreSQL, Railway e R2 ainda estão desativados. Consulte [`docs/runtime-boundaries.md`](docs/runtime-boundaries.md).

## Executar

Requer Node.js 22.

```bash
npm install
cp .env.example .env.local
npm run dev
```

Abra `http://localhost:3000`.

As gravações fictícias só funcionam com `TRIA_DEMO_WRITES=enabled` no arquivo local.

## Validar

```bash
npm run check
```

Esse comando executa a suíte automatizada, lint, verificação TypeScript e build de produção.

## Decisões simples

- Uma conta: Rodrigo.
- Um armazenamento operacional futuro: R2 privado.
- Limite interno conservador futuro: aproximadamente 9 GB.
- Sem OCI ou outro provedor.
- Sem upgrade automático ou cobrança não aprovada.
- Sem parsing ou execução de PBIX, macros, scripts ou consultas de arquivos enviados.
- Medição, nota, referência, valor informado e pagamento permanecem conceitos distintos.
- Dados reais exigem ambiente privado e autorização expressa.
