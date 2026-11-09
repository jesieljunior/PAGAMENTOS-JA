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

## 2. Pré-requisitos e ordem das migrations

Não aplique apenas as duas migrations finais isoladamente. A liquidação de faturas depende da tabela `faturas_plataforma`, criada na migration de Billing V2, e as RPCs de Pix dependem dos estados adicionais do enum `status_pagamento`.

Confirme que todas as migrations anteriores do projeto foram aplicadas. Para este conjunto financeiro, a sequência de dependências é:

1. `20261020020000_billing_v2_and_timeclock_columns.sql` — cria `faturas_plataforma` e estruturas de faturamento V2.
2. `20261104120000_status_pagamento_states.sql` — adiciona `processando`, `aguardando_aprovacao` e `estornado`.
3. `20261104130000_financial_resilience_and_timeclock_audit.sql` — prepara estados, webhooks e RPCs de processamento.
4. `20261104140000_finance_tenant_security_and_saas_invoicing.sql` — reforça isolamento de tenant e instala a liquidação inicial de faturas.
5. `20261105130000_harden_saas_invoice_settlement.sql` — restringe a liquidação de faturas a `service_role`.
6. `20261106130000_financial_integrity_hardening.sql` — instala as proteções transacionais finais para funding, Pix de saída, estornos e faturas SaaS.

A migration final não configura nem altera credenciais do Mercado Pago. A aplicação está sendo homologada com Asaas.

A migration final também ajusta a auditoria para permitir `ator_id = NULL` exclusivamente em eventos automáticos (`ator_contexto = 'sistema'`). Ações atribuídas a usuários continuam exigindo identificador de ator. O identificador do recurso é gravado como UUID, e os resultados de auditoria respeitam os valores aceitos (`sucesso` e `falha`).

**Importante:** o banco de teste consultado ainda não possui `faturas_plataforma` e não apresenta os três novos estados de `status_pagamento`. Portanto, ele ainda não está pronto para receber somente a migration final. Não avance para produção.

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

## 6. Critério de aprovação

A homologação só pode ser considerada aprovada quando:

- CI passar em todos os passos;
- migrations forem aplicadas sem erro no projeto separado;
- permissões das RPCs corresponderem aos resultados esperados;
- testes de repetição, falha e concorrência não gerarem lançamentos duplicados;
- os relatórios de consistência acima não retornarem linhas inexplicadas;
- os resultados no banco corresponderem aos estados exibidos no Asaas Sandbox.

Não aplicar migrations em produção nem mesclar a PR apenas porque a CI passou.
