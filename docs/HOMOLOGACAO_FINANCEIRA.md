# Homologação financeira — PAGAMENTOS-JA

Este roteiro deve ser executado em um projeto Supabase separado da produção. Não use o SQL Editor do banco de produção para esta validação.

## 1. Pré-verificação de dados

Antes de aplicar a migration `20261106130000_financial_integrity_hardening.sql`, verifique se já existem créditos duplicados por cobrança:

```sql
SELECT
  cobranca_id,
  COUNT(*) AS quantidade_creditos,
  SUM(valor) AS valor_total
FROM public.movimentos_saldo
WHERE cobranca_id IS NOT NULL
  AND tipo = 'credito'
GROUP BY cobranca_id
HAVING COUNT(*) > 1;
```

Resultado esperado: nenhuma linha. Se houver resultados, não remova lançamentos automaticamente. Reconcilie cada cobrança com o registro do Asaas e o extrato financeiro antes de continuar.

Verifique também duplicidades no ledger de pagamentos antes da criação dos índices únicos parciais:

```sql
SELECT
  pagamento_id,
  tipo,
  COUNT(*) AS quantidade_lancamentos,
  SUM(valor) AS valor_total
FROM public.movimentos_saldo
WHERE pagamento_id IS NOT NULL
  AND tipo IN ('debito', 'credito')
GROUP BY pagamento_id, tipo
HAVING COUNT(*) > 1;
```

Resultado esperado: nenhuma linha. Se houver duplicidades, não apague lançamentos para fazer a migration passar. Reconcilie cada pagamento com o fechamento e a transferência correspondente no Asaas.

Verifique também a integridade dos atores nos logs antes de validar a constraint de auditoria:

```sql
SELECT id, ator_contexto, acao, criado_em
FROM public.logs_auditoria
WHERE ator_id IS NULL
  AND ator_contexto <> 'sistema';
```

Resultado esperado: nenhuma linha. Registros antigos sem ator humano devem ser reconciliados; não os reclassifique automaticamente como eventos de sistema.

Verifique também se um mesmo ID de cobrança Asaas foi associado a mais de um registro local:

```sql
SELECT parceiro_cobranca_id, COUNT(*) AS quantidade
FROM public.cobrancas
WHERE parceiro_cobranca_id IS NOT NULL
GROUP BY parceiro_cobranca_id
HAVING COUNT(*) > 1;

SELECT referencia_provedor, COUNT(*) AS quantidade
FROM public.faturas_plataforma
WHERE referencia_provedor IS NOT NULL
GROUP BY referencia_provedor
HAVING COUNT(*) > 1;
```

A consulta de `cobrancas` pode ser executada antes da Billing V2. A consulta de `faturas_plataforma` só deve ser executada depois da migration `20261020020000`, que cria essa tabela, e antes da migration final.

Resultado esperado: nenhuma linha. A migration final cria índices únicos parciais para impedir que um mesmo pagamento Asaas seja associado a duas cobranças operacionais ou duas faturas SaaS.

## 2. Pré-requisitos e ordem das migrations

Não aplique apenas as duas migrations finais isoladamente. A liquidação de faturas depende da tabela `faturas_plataforma`, criada na migration de Billing V2, e as RPCs de Pix dependem dos estados adicionais do enum `status_pagamento`.

Confirme que as migrations base anteriores foram aplicadas. As migrations `20261002000000_finance_rls_hardening.sql`, `20261002010000_webhook_eventos_idempotencia.sql` e `20261016000000_relax_financial_read_restriction_and_isolate_support.sql` fazem parte da base já existente e devem ser reconciliadas com o schema atual antes de qualquer reexecução.

Para completar o schema de ponto e faturamento e depois aplicar as proteções financeiras, a sequência de arquivos deste escopo é:

1. `20261020020000_billing_v2_and_timeclock_columns.sql` — cria `faturas_plataforma` e estruturas de faturamento V2.
2. `20261027_ponto_publico_policies.sql` — instala a policy e a primeira versão do contexto público do QR Code.
3. `20261028_ponto_publico_rpc_definer.sql` — instala as RPCs públicas de identificação, confirmação e registro de ponto.
4. `20261104120000_status_pagamento_states.sql` — adiciona `processando`, `aguardando_aprovacao` e `estornado`.
5. `20261104130000_financial_resilience_and_timeclock_audit.sql` — prepara estados, webhooks e RPCs de processamento.
6. `20261104140000_finance_tenant_security_and_saas_invoicing.sql` — reforça isolamento de tenant e instala a liquidação inicial de faturas.
7. `20261105130000_harden_saas_invoice_settlement.sql` — restringe a liquidação de faturas a `service_role`.
8. `20261106130000_financial_integrity_hardening.sql` — instala as proteções transacionais finais para funding, Pix de saída, estornos e faturas SaaS.
9. `20261109120000_seed_billing_v2_plans.sql` — insere o catálogo inicial de planos apenas quando o ID/código ainda não existir; não sobrescreve preços ou limites já configurados.
10. `20261109130000_atomic_public_point_rate_limit.sql` — instala o rate limit atômico de ponto público, com bloqueio por token/IP e execução exclusiva por `service_role`.
11. `20261109140000_revoke_legacy_public_point_context.sql` — revoga a execução pública da RPC antiga de contexto QR, mantendo acesso apenas ao backend.

A migration final não configura nem altera credenciais do Mercado Pago. A aplicação está sendo homologada com Asaas.

### Estado observado do projeto de teste

A inspeção foi feita em modo somente leitura no projeto **JÁ - BANCO DE DADOS**.

- O histórico retornado pelo Supabase está vazio e a relação `supabase_migrations.schema_migrations` não existe. Portanto, não é possível usar o histórico padrão para decidir quais arquivos já foram aplicados.
- O schema está parcialmente adiantado: `tentativas_ponto_publico`, `auditoria_ponto_publico` e as colunas de QR Code/evidência já existem.
- As tabelas centrais do Billing V2 — `faturas_plataforma`, `participacoes_operacionais` e `ciclos_cobranca` — ainda não existem.
- A tabela `planos` existe, mas está vazia. A interface possui catálogo estático de fallback, porém as funções de banco dependem de registros reais em `planos`; a nova migration de seed cobre a instalação inicial sem sobrescrever configurações existentes. A mesma migration cria uma assinatura `bloqueada` para empresas sem assinatura, vinculada ao plano Free, para impedir acesso gratuito ilimitado por ausência de registro. Essas empresas precisam selecionar explicitamente um plano; o onboarding só libera os sete dias quando cria uma assinatura nova.
- O enum `status_pagamento` ainda contém somente `pendente`, `agendado`, `executado` e `falhou`.
- A RPC `obter_contexto_ponto_por_token` existe na versão simples da migration `20261027` e, na consulta atual, ainda permite `EXECUTE` para `anon` e `authenticated`. A migration `20261109140000` revoga esse acesso e deixa a função restrita a `service_role`.
- As RPCs adicionais de `20261028` (`identificar_no_ponto_publico`, `confirmar_presenca_ponto_publico` e `registrar_ponto_publico`) não foram encontradas. A Edge Function atual depende especificamente de `public.plano_da_empresa(uuid)` e `public.registrar_ponto_publico(text,text,uuid,text,text,double precision,double precision,boolean)`, e ambas também estão ausentes; portanto, o fluxo de ponto público não está pronto para homologação funcional até aplicar e validar as migrations que criam essas dependências.
- As policies restritivas de leitura de fechamentos e pagamentos já existem, criadas por uma migration anterior. A migration Billing V2 foi ajustada para substituí-las sem erro.
- A tabela `webhook_eventos` já existe e ainda possui a policy antiga de inserção por usuários autenticados. A migration de resiliência agora revoga esse acesso e reserva a escrita ao backend com `service_role`.

Não execute o conjunto de migrations como se o banco estivesse vazio. A migration Billing V2 foi ajustada para tolerar as duas tabelas de ponto já existentes e para substituir as policies que já estavam instaladas. A sequência final ainda depende da conferência de todas as estruturas anteriores e da validação do fluxo de faturamento.

A seleção de plano pago agora reutiliza uma fatura pendente já existente e consulta o Asaas pela `externalReference`; se a busca não retornar exatamente uma cobrança correspondente ou retornar mais de uma, a função falha sem criar outra cobrança. Isso reduz o risco de duplicidade, mas pode exigir reconciliação manual quando o provedor ainda não indexou a cobrança.

O servidor valida o HMAC dos tokens QR assinados e envia à Edge Function o token persistido do evento. Os identificadores de rate limit (token, CPF e IP) são armazenados como HMAC-SHA-256 usando a chave secreta do serviço, não como hashes simples. A geração/validação do token assinado exige `PONTO_SIGNING_SECRET` (mínimo 32 caracteres) ou uma chave de fallback equivalente (`JWT_SECRET`/`SUPABASE_JWT_SECRET`) no ambiente server-side; confirmar isso antes do deploy. A Edge Function aplica rate limit atômico também para consulta pública de contexto, com limite por token (10.000 tentativas), token/IP (1.200 tentativas) e token/CPF (10 tentativas) em 10 minutos; a etapa de contexto, anterior à identificação por CPF, usa apenas os limites por token e IP. A consulta de contexto legada por RPC ainda estava pública no banco verificado; a migration `20261109140000` precisa ser aplicada para bloquear o desvio da Edge Function. A expiração do QR é calculada por prazo explícito ou pela data imutável de geração/criação, sem renovar a validade a cada consulta; a gravação final chama a RPC SQL com `service_role`, que grava ponto e auditoria na mesma transação. O fallback direto de gravação com `service_role` foi removido. As RPCs SQL de QR Code são restritas a `service_role` e validam empresa ativa, assinatura ativa/trial dentro do prazo, status não terminal do evento e expiração do QR também no registro da batida. O registro rejeita colaboradores inativos/recusados e marca como fora do horário tanto batidas antecipadas quanto posteriores ao evento.

A sincronização de participações mantém a regra operacional: remoção/substituição antes do início do evento desativa a participação; depois do início, a participação confirmada é preservada para não apagar uso histórico. Evento cancelado desativa as participações. O acesso a recursos também valida `trial_ate` no banco: assinaturas `trial`/`em_trial` sem prazo ou com prazo expirado não recebem novos recursos nem abrem novos ciclos. A seleção repetida do plano gratuito preserva a data de expiração existente e não concede mais sete dias. Empresas sem assinatura também não recebem recursos nem abrem ciclos até que exista uma assinatura explícita.

A migration `20261104130000` agora verifica duplicidades de débito/crédito por pagamento antes de criar os índices únicos. A migration final também verifica duplicidade de crédito por cobrança e referências Asaas repetidas. A RPC de funding não restaura saldo já reservado/consumido; ela confere o crédito histórico por empresa e valor. A RPC de Pix preserva estados terminais contra atualizações concorrentes antigas e confere os lançamentos existentes antes de considerá-los idempotentes. Nenhum lançamento é removido automaticamente.

A migration final também ajusta a auditoria para permitir `ator_id = NULL` exclusivamente em eventos automáticos (`ator_contexto = 'sistema'`). Ações atribuídas a usuários continuam exigindo identificador de ator. O identificador do recurso é gravado como UUID, e os resultados de auditoria respeitam os valores aceitos (`sucesso` e `falha`).

**Importante:** o banco de teste consultado ainda não possui `faturas_plataforma` e não apresenta os três novos estados de `status_pagamento`. Portanto, ele ainda não está pronto para receber somente a migration final. Não avance para produção.

### Pré-verificação das dependências de runtime

Antes de publicar a Edge Function `ponto-publico`, confirme que as estruturas e RPCs chamadas por ela existem:

```sql
SELECT
  to_regclass('public.faturas_plataforma') AS faturas_plataforma,
  to_regclass('public.participacoes_operacionais') AS participacoes_operacionais,
  to_regclass('public.ciclos_cobranca') AS ciclos_cobranca,
  to_regprocedure('public.plano_da_empresa(uuid)') AS plano_da_empresa,
  to_regprocedure('public.registrar_ponto_publico(text,text,uuid,text,text,double precision,double precision,boolean)') AS registrar_ponto_publico;
```

Resultado esperado após as migrations: nenhuma coluna `NULL`. Se qualquer dependência estiver ausente, não publique nem considere homologado o fluxo público de ponto.

## 3. Validar permissões das RPCs

Execute no SQL Editor do projeto de homologação:

```sql
SELECT
  has_function_privilege(
    'authenticated',
    'public.efetivar_pagamento_pix_db(uuid,uuid,text,text,timestamptz,text,text,text,numeric)',
    'EXECUTE'
  ) AS authenticated_pode_efetivar_pix,
  has_function_privilege(
    'service_role',
    'public.efetivar_pagamento_pix_db(uuid,uuid,text,text,timestamptz,text,text,text,numeric)',
    'EXECUTE'
  ) AS service_role_pode_efetivar_pix,
  has_function_privilege(
    'authenticated',
    'public.reverter_transferencia_pagamento_pix_seguro(uuid,text,text,text,text)',
    'EXECUTE'
  ) AS authenticated_pode_estornar_pix,
  has_function_privilege(
    'service_role',
    'public.reverter_transferencia_pagamento_pix_seguro(uuid,text,text,text,text)',
    'EXECUTE'
  ) AS service_role_pode_estornar_pix,
  has_function_privilege(
    'authenticated',
    'public.liquidar_cobranca_funding_asaas(uuid,text,numeric)',
    'EXECUTE'
  ) AS authenticated_pode_creditar_funding,
  has_function_privilege(
    'service_role',
    'public.liquidar_cobranca_funding_asaas(uuid,text,numeric)',
    'EXECUTE'
  ) AS service_role_pode_creditar_funding,
  has_function_privilege(
    'authenticated',
    'public.liquidar_fatura_plataforma_asaas(uuid,text,numeric)',
    'EXECUTE'
  ) AS authenticated_pode_liquidar_fatura,
  has_function_privilege(
    'service_role',
    'public.liquidar_fatura_plataforma_asaas(uuid,text,numeric)',
    'EXECUTE'
  ) AS service_role_pode_liquidar_fatura;
```

Resultados esperados: todas as colunas `authenticated_pode_*` devem ser `false`; todas as colunas `service_role_pode_*` devem ser `true`.

Valide também que nenhuma RPC legada do QR Code continue acessível publicamente e que o backend mantenha a permissão necessária:

```sql
SELECT
  has_function_privilege(
    'anon',
    'public.obter_contexto_ponto_por_token(text)',
    'EXECUTE'
  ) AS anon_pode_consultar_contexto_qr,
  has_function_privilege(
    'authenticated',
    'public.obter_contexto_ponto_por_token(text)',
    'EXECUTE'
  ) AS authenticated_pode_consultar_contexto_qr,
  has_function_privilege(
    'service_role',
    'public.obter_contexto_ponto_por_token(text)',
    'EXECUTE'
  ) AS service_role_pode_consultar_contexto_qr;
```

Resultado esperado: `false`, `false`, `true`, respectivamente. A função pública antiga não deve ser usada pelo navegador; o fluxo deve passar pela Edge Function.

Confirme também que as assinaturas antigas foram removidas:

```sql
SELECT
  to_regprocedure(
    'public.efetivar_pagamento_pix_db(uuid,uuid,text,text,timestamptz,text,text,text)'
  ) IS NULL AS assinatura_antiga_efetivacao_removida,
  to_regprocedure(
    'public.reverter_transferencia_pagamento_pix(uuid,text,text,text)'
  ) IS NULL AS assinatura_antiga_estorno_removida;
```

Resultados esperados: ambas `true`.

## 4. Testes de integração no Asaas Sandbox

Use credenciais e webhooks do Sandbox, nunca as credenciais de produção.

| Cenário | Resultado esperado |
|---|---|
| Mesmo evento Asaas entregue duas vezes | Um único efeito financeiro |
| Dois eventos diferentes para a mesma cobrança já liquidada | Um crédito; segundo pagamento registrado como duplicidade em auditoria |
| Cobrança recebida e funding liquidado | Cobrança, crédito, funding e taxa atualizados juntos |
| Falha durante a RPC de funding | Nenhuma gravação parcial |
| Transferência Pix criada e consulta posterior falha | Pagamento permanece em processamento para reconciliação; não é reenviado |
| Transferência recusada/cancelada | Reversão contábil única, quando houver débito original |
| Mesmo evento de transferência repetido | Sem segundo débito ou crédito |
| Fatura SaaS paga com mesmo ID de cobrança | Reentrega idempotente |
| Fatura SaaS paga com outro ID de cobrança | Alerta de cobrança duplicada; sem segunda ativação |
| Webhook sem ID oficial e sem referência de recurso | Rejeitado, sem efeito financeiro |

## 5. Conferência de consistência

Após os testes, procure funding marcado como pago sem movimento de crédito:

```sql
SELECT
  c.id AS cobranca_id,
  c.status AS status_cobranca,
  f.id AS funding_id,
  f.status AS status_funding
FROM public.cobrancas c
JOIN public.fundings f ON f.cobranca_id = c.id
LEFT JOIN public.movimentos_saldo m
  ON m.cobranca_id = c.id
 AND m.tipo = 'credito'
WHERE c.status = 'pago'
  AND m.id IS NULL;
```

Resultado esperado: nenhuma linha.

Verifique também pagamentos executados sem débito:

```sql
SELECT
  p.id AS pagamento_id,
  p.status,
  p.parceiro_transferencia_id
FROM public.pagamentos p
LEFT JOIN public.movimentos_saldo m
  ON m.pagamento_id = p.id
 AND m.tipo = 'debito'
WHERE p.status = 'executado'
  AND m.id IS NULL;
```

Resultado esperado: nenhuma linha. Se houver registros antigos, reconcilie com o Asaas antes de corrigir o ledger.

## 6. Pendências funcionais que ainda bloqueiam a homologação

- A recarga de saldo (`iniciarRecarga`) cria uma nova cobrança e um novo funding a cada chamada; a chave de idempotência é gerada aleatoriamente no servidor. Se a resposta se perder depois de o Asaas criar a cobrança, uma nova tentativa pode criar outra cobrança. É necessário receber uma chave estável da tentativa e criar/recuperar cobrança+funding de forma atômica.
- O fluxo `selecionarPlanoEmpresa` cria uma fatura imediatamente com `ciclo_inicio = agora`, `ciclo_fim = agora + 30 dias` e excedentes zerados. Já `abrir_ciclo_cobranca` usa o ciclo mensal ancorado em `assinaturas.inicio_ciclo`. Meses de 28, 29 ou 31 dias podem divergir. Além disso, `fechar_fatura_ciclo` retorna a fatura existente sem recalcular participações; portanto, a fatura imediata pode impedir a cobrança dos excedentes daquele ciclo. A seleção repetida agora procura uma fatura pendente e reconcilia sua cobrança pelo `externalReference`; se não encontrar exatamente uma cobrança correspondente, bloqueia a criação de outra e exige reconciliação manual. É necessário definir se a mensalidade é cobrada antecipadamente e os excedentes no ciclo seguinte, ou se tudo será faturado após o encerramento do ciclo, além de definir a regra de mudança de plano e tornar a criação idempotente.
- O fluxo de webhook ainda não implementa uma política contábil para `PAYMENT_REFUNDED`, `PAYMENT_PARTIALLY_REFUNDED`, `PAYMENT_REFUND_IN_PROGRESS`, `PAYMENT_CHARGEBACK_REQUESTED`, `PAYMENT_CHARGEBACK_DISPUTE`, `PAYMENT_AWAITING_CHARGEBACK_REVERSAL` e `PAYMENT_RECEIVED_IN_CASH_UNDONE`. Como o sistema reconhece `PAYMENT_RECEIVED_IN_CASH` para crédito, o evento de desfazimento também precisa de tratamento explícito. Esses eventos exigem política de retenção/reversão de saldo antes de operar com dinheiro real.
- O webhook ainda consulta o Asaas e executa RPCs financeiras antes de responder. A documentação do Asaas orienta persistir o evento e responder HTTP 200 em até 10 segundos; o processamento síncrono pode ultrapassar esse limite e provocar retentativas ou interrupção da fila. Eventos duplicados em processamento agora recebem resposta não-2xx até que a instância responsável conclua; o endpoint só responde HTTP 200 após persistir o estado `processado`.
- Validar trial ativo, trial expirado e trial sem `trial_ate`; confirmar que o banco bloqueia recursos e não abre ciclo novo após expiração.
- O fluxo público agora passa pela Edge Function. O limite de 20 tentativas por token/IP em 10 minutos é aplicado por RPC SQL atômica, com `pg_advisory_xact_lock` serializando a contagem e a inserção; somente `service_role` pode executar essa RPC. As RPCs de QR também foram restritas a `service_role` para impedir bypass direto. Ainda falta testar carga concorrente real.
- O upload direto em `storage.objects` foi desabilitado para `anon` e `authenticated`; somente a Edge Function com `service_role` grava selfies após validar token QR, empresa, assinatura, evento e escala. A API rejeita selfie sem consentimento explícito, limita o corpo da requisição pública a 6 MB e valida tamanho/formato da imagem antes do upload. O bucket é privado, limita imagens JPEG/PNG/WebP a 5 MB e a leitura autenticada exige capacidade `operacao.supervisionar` na própria empresa. A migration de seed também define prazo para evidências antigas sem expiração. A rota de purga remove selfies/GPS vencidos e tentativas com mais de 30 dias; o `vercel.json` agenda execução diária às 03:00 UTC. A variável `CRON_SECRET` precisa estar configurada no ambiente Vercel para a execução autenticada.
- A aplicação de migrations não deve começar enquanto a reconciliação do histórico ausente e a sequência completa de dependências não estiverem fechadas.

## 7. Critério de aprovação

A homologação só pode ser considerada aprovada quando:

- CI passar em todos os passos;
- migrations forem aplicadas sem erro no projeto separado;
- permissões das RPCs corresponderem aos resultados esperados;
- testes de repetição, falha e concorrência não gerarem lançamentos duplicados;
- os relatórios de consistência acima não retornarem linhas inexplicadas;
- os resultados no banco corresponderem aos estados exibidos no Asaas Sandbox.

Não aplicar migrations em produção nem mesclar a PR apenas porque a CI passou.
