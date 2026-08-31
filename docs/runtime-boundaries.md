# Limites do runtime demonstrativo

## O que está ativo

O MVP usa um arquivo JSON local em `var/` para validar o fluxo sem custo e sem dados reais.

- Uma fila no processo serializa as gravações.
- A gravação usa arquivo temporário e renomeação atômica.
- A prévia gera um hash da composição.
- Uma alteração após a prévia invalida esse hash.
- A publicação adiciona um snapshot e nunca expõe uma operação de edição ou exclusão.
- Uma tentativa repetida com o mesmo conteúdo retorna a publicação existente.
- A leitura verifica o SHA-256 do snapshot antes de exibir ou exportar.

Esse mecanismo serve somente para uma instância local, um processo e dados fictícios. O arquivo JSON pode ser alterado por quem tiver acesso ao sistema operacional. Por isso, ele não é armazenamento adequado para dados reais ou produção.

## Condições antes de usar PostgreSQL

A migração para PostgreSQL/Railway deve ocorrer somente depois de aprovação de custo e ambiente privado. Ela deve incluir:

1. autenticação de Rodrigo;
2. transação com bloqueio da revisão do projeto;
3. comparação do hash conferido dentro da mesma transação;
4. chave única de idempotência e versão única por projeto;
5. tabelas append-only para publicações e eventos;
6. proibição de `UPDATE` e `DELETE` em snapshots publicados;
7. backup e teste de restauração.

Mais de uma instância da aplicação não pode usar o arquivo JSON. A fila atual não coordena processos ou máquinas diferentes.

## Evidências e R2

Uploads estão desativados. A publicação atual contém somente metadados fictícios de evidência. Nenhum byte de arquivo é incluído.

Antes de habilitar R2 privado, cada membro publicado deve congelar:

- chave pública interna opaca;
- `objectVersionId` ou versão equivalente;
- tamanho;
- tipo de mídia validado;
- SHA-256 verificado no download.

O limite interno deve recusar novos uploads antes de aproximadamente 9 GB. Não haverá segundo provedor ou upgrade automático. Ativar R2, Railway, dados reais ou cobrança exige decisão expressa de Rodrigo.

## Escopo atual de publicação

A publicação cobre um projeto demonstrativo e todo o período inclusivo registrado nele. Seleção de vários projetos e corte personalizado ficam fora desta fatia. Uma versão futura deve congelar a regra de corte e a cobertura escolhida antes de qualquer publicação combinada.
