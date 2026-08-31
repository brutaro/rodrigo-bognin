# Decisões do Plano B

- O BMAD fica pausado e seus artefatos não são alterados.
- O MVP é uma ferramenta pessoal de Rodrigo, não uma plataforma corporativa.
- R2 privado com limite interno de 9 GB é suficiente para o primeiro MVP.
- Não usar OCI nem criar adapter para arquivos além do R2.
- Se o limite for atingido, recusar o novo upload e explicar o motivo.
- Não haverá cobrança ou upgrade automático.
- A primeira fatia usa somente dados fictícios.
- Segurança mínima, proveniência e uma restauração verificável permanecem obrigatórias.
- Automatização nunca confirma relação financeira ou pagamento sem decisão registrada de Rodrigo.
- A publicação demonstrativa é append-only e uma correção gera nova versão.
- Uma composição idêntica não gera versão duplicada.
- A prévia e a publicação são vinculadas por SHA-256; uma edição exige nova conferência.
- HTML e CSV usam somente o snapshot publicado e verificado.
- A persistência JSON é apenas local, de processo único e sem dados reais.
- PostgreSQL, Railway, autenticação e R2 dependem de decisão expressa antes da ativação.
