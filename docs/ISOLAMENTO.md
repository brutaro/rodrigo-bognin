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

`docs/protected-origin-current.json` registra a linha de base atual das árvores protegidas; o manifesto anterior permanece histórico e intacto. Qualquer divergência da captura atual deve interromper a atividade até que a causa seja conhecida.

## Dados reais

Dados reais não entram no código, em fixtures, testes, commits ou demonstrações. A importação de cópias reais exige autorização expressa de Rodrigo e ambiente privado preparado.

## Captura atual e histórico

O manifesto de agosto `docs/protected-origin-manifest.json` é evidência histórica
imutável (SHA-256 `b9b2979be4e5174dc1b1a49f55377db0e32e9e4d320c7b94c6bee98648f35bfa`).
O gate vigente usa `docs/protected-origin-current.json`, capturado explicitamente
em 5 de novembro de 2026, e ancora seu SHA-256, contagens e digests canônicos no
código de `scripts/verify-protected-origin.mjs`. O relatório
`docs/protected-origin-reconciliation.json` conserva as diferenças anteriores à
captura: 11 adições em `_bmad`, 45 adições e seis documentos alterados em
`_bmad-output`, e cinco caches `.pyc` removidos em `.agents`. Essas diferenças
não são atribuídas ao PR. A captura atual prova preservação desde esta tarefa;
não prova identidade contínua desde agosto.

```bash
npm run origin:verify
npm run origin:verify -- --origin-parent /caminho/RODRIGO-BOGNIN
```

Em worktrees, a descoberta usa o diretório Git comum do checkout principal,
nunca o pai do worktree. Origens ausentes ou incorretas falham sem fallback.
A opção explícita exige um caminho absoluto que contenha as três árvores.
A verificação somente lê: valida esquema, conjuntos, contagens, digest canônico,
conteúdo e arquivos regulares; recusa symlinks e entradas especiais. Não aceita
manifesto ou hash fornecido por argumento, não recaptura e não escreve na origem.

`scripts/capture-protected-origin.mjs` é um comando de captura separado, de uso
explícito e único: recusa sobrescrever a captura ou o relatório existentes.
Uma futura mudança legítima exige investigar as diferenças e revisar nova
captura e âncoras em código; executar `origin:verify` nunca aprova divergências.
Os testes negativos usam apenas arquivos sintéticos temporários.

A abertura usa `O_NOFOLLOW | O_NONBLOCK`: uma troca de arquivo regular por FIFO
entre `lstat` e `open` é recusada sem bloquear. Ao concluir cada varredura, o gate
revalida diretórios e identidade/stat de todos os arquivos observados, recusando
instabilidade ordinária durante a leitura. Isso não constitui um snapshot
atômico contra um escritor local hostil; a origem deve permanecer sem escritores
concorrentes durante a captura/verificação. Nenhuma garantia de `openat` nativo
é alegada.

A captura prepara os dois documentos antes de publicá-los, sem substituir
caminhos existentes. Se a segunda publicação falhar de forma tratável, desfaz
somente o primeiro inode criado pela própria chamada, preservando qualquer
arquivo preexistente. Não alega atomicidade do par diante de queda abrupta do
host entre as publicações.
