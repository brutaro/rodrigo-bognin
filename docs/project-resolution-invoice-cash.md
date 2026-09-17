# Projetos renomeados e notas no caixa

A importação resolve primeiro o nome vigente do projeto. O nome da fonte é um
apelido histórico usado apenas se nenhum nome vigente corresponder. Nomes
duplicados continuam sendo recusados. Arquivar um cadastro não transfere suas
atividades: o ID de projeto de cada atividade permanece protegido.

O mesmo critério é usado no resumo da base, CSV por projeto, executores e
relatórios. Uma importação restrita ao projeto aceita os nomes que efetivamente
pertencem a ele e não confunde uma renomeação com transferência de atividade.

Em **Notas fiscais no caixa**, o proprietário pode declarar que os valores das
notas representam saídas pagas. A declaração guarda valor, nota, projeto, revisão,
motivo, autor e data de registro. A data do pagamento é opcional e não é inferida
da emissão. Sem data, o valor conhecido aparece, mas o fechamento por período
continua pendente.

A confirmação em lote alcança somente notas vigentes sem declaração anterior.
Preserva o projeto declarado e deixa sem projeto as notas sem esse vínculo.
Projetos candidatos da auditoria não são adotados automaticamente. Notas com
pagamentos manuais do mesmo valor exigem conciliação individual. É possível
vincular um pagamento confirmado de mesmo projeto, valor e data, ou declarar,
com motivo, que se trata de outra saída. O pagamento vinculado conta uma vez.

Se a nota for alterada ou excluída depois, o pagamento histórico é preservado e
a tela apresenta a divergência. A reversão cria outra revisão, sem apagar o
registro anterior. A confirmação não altera a fonte fiscal, os comprovantes,
as publicações anteriores ou a narrativa do projeto.

O cálculo `tria-caixa-v2` mostra totais conhecidos mesmo quando a cobertura do
portfólio está incompleta. Isso não converte valores desconhecidos em zero:
resultado líquido, cobertura e saldo a pagar permanecem sujeitos à conferência.

Validação automatizada: testes de domínio e de autorização/entrada da API;
regressão no E2E de importação com PostgreSQL descartável para renomeação,
propriedade da atividade, exportação, declaração sem data, repetição e reversão.
