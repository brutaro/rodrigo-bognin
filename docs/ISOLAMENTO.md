# Regra de isolamento do Plano B

## Limite de escrita

Agentes e scripts do Plano B podem escrever somente em:

`RODRIGO-BOGNIN/PLANO_B_TRIA/`

As seguintes árvores são protegidas e permanecem somente leitura:

- `RODRIGO-BOGNIN/_bmad/`
- `RODRIGO-BOGNIN/_bmad-output/`
- `RODRIGO-BOGNIN/.agents/`
- fontes e entregáveis fora de `PLANO_B_TRIA/`

## Reaproveitamento

Um artefato protegido pode ser lido ou copiado. A cópia deve:

1. ficar dentro de `PLANO_B_TRIA/references/`;
2. manter o arquivo de origem intacto;
3. registrar origem, destino, tamanho e SHA-256;
4. ser tratada como referência, não como código vigente.

## Verificação

`docs/protected-origin-manifest.json` registra a linha de base das árvores protegidas. Qualquer divergência deve interromper a atividade até que a causa seja conhecida.

## Dados reais

Dados reais não entram no código, em fixtures, testes, commits ou demonstrações. A importação de cópias reais exige autorização expressa de Rodrigo e ambiente privado preparado.
