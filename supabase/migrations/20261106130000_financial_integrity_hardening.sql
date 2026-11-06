-- =============================================================================
-- Migração: 20261106130000_financial_integrity_hardening.sql
-- Proteções transacionais para funding, Pix de saída, estornos e credenciais.
-- =============================================================================

-- A coluna é adicionada agora; a criptografia em si é executada no backend.
ALTER TABLE public.mercado_pago_contas
  ADD COLUMN IF NOT EXISTS client_secret_cifrado text;

-- Não cria índice único às cegas se já houver duplicidade histórica.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.movimentos_saldo
    WHERE cobranca_id IS NOT NULL AND tipo = 'credito'
    GROUP BY cobranca_id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION
      'Há cobranças com mais de um crédito em movimentos_saldo. Reconcilie esses registros antes de aplicar a migration 20261106130000.';
  END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_movimentos_saldo_cobranca_credito
  ON public.movimentos_saldo (cobranca_id)
  WHERE cobranca_id IS NOT NULL AND tipo = 'credito';

-- =============================================================================
-- 1. Funding: cobrança, crédito, taxa e funding passam a ser uma transação só.
-- Reprocessar a mesma cobrança corrige estados parciais legados sem duplicar crédito.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.liquidar_cobranca_funding_asaas(
  _cobranca_id uuid,
  _parceiro_id text,
  _valor numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cobranca RECORD;
  v_movimento RECORD;
  v_taxa_id uuid;
  v_taxa_valor numeric;
  v_taxas_count integer;
  v_funding_id uuid;
  v_funding_status text;
  v_fundings_count integer;
  v_valor_credito numeric;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Liquidação de saldo permitida somente por serviço autenticado.';
  END IF;

  IF _parceiro_id IS NULL OR length(trim(_parceiro_id)) = 0 THEN
    RAISE EXCEPTION 'Identificador da cobrança Asaas é obrigatório.';
  END IF;
  IF _valor IS NULL OR _valor <= 0 THEN
    RAISE EXCEPTION 'Valor recebido pelo Asaas é obrigatório.';
  END IF;

  SELECT id, empresa_id, valor, status, descricao, parceiro_cobranca_id, tipo
  INTO v_cobranca
  FROM public.cobrancas
  WHERE id = _cobranca_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Cobrança não encontrada.');
  END IF;

  IF round(_valor, 2) <> round(v_cobranca.valor, 2) THEN
    RAISE EXCEPTION 'Valor recebido (%) diverge do valor da cobrança (%).', _valor, v_cobranca.valor;
  END IF;

  IF v_cobranca.parceiro_cobranca_id IS NOT NULL
     AND v_cobranca.parceiro_cobranca_id <> _parceiro_id THEN
    INSERT INTO public.logs_auditoria (
      empresa_id, ator_contexto, acao, recurso_tipo, recurso_id, resultado, detalhes
    ) VALUES (
      v_cobranca.empresa_id,
      'sistema',
      'cobranca_operacional_duplicada',
      'cobranca',
      _cobranca_id::text,
      'alerta',
      jsonb_build_object(
        'parceiro_original', v_cobranca.parceiro_cobranca_id,
        'parceiro_recebido', _parceiro_id,
        'valor', _valor
      )
    );
    RETURN jsonb_build_object('ok', true, 'cobranca_duplicada', true, 'cobranca_id', _cobranca_id);
  END IF;

  IF v_cobranca.status NOT IN ('rascunho', 'aguardando_pagamento', 'vencido', 'pago') THEN
    RAISE EXCEPTION 'Status da cobrança não permite liquidação: %', v_cobranca.status;
  END IF;

  SELECT id, valor
  INTO v_movimento
  FROM public.movimentos_saldo
  WHERE cobranca_id = _cobranca_id AND tipo = 'credito'
  FOR UPDATE;

  SELECT count(*)
  INTO v_taxas_count
  FROM public.taxas_plataforma
  WHERE cobranca_id = _cobranca_id AND status = 'pendente';

  IF v_taxas_count > 1 THEN
    RAISE EXCEPTION 'Mais de uma taxa pendente encontrada para a cobrança (%).', _cobranca_id;
  END IF;

  IF v_taxas_count = 1 THEN
    SELECT id, valor
    INTO v_taxa_id, v_taxa_valor
    FROM public.taxas_plataforma
    WHERE cobranca_id = _cobranca_id AND status = 'pendente'
    FOR UPDATE;
  END IF;

  IF v_movimento.id IS NOT NULL THEN
    v_valor_credito := v_movimento.valor;
  ELSE
    v_valor_credito := GREATEST(0, v_cobranca.valor - COALESCE(v_taxa_valor, 0));
  END IF;

  IF v_valor_credito <= 0 THEN
    RAISE EXCEPTION 'Valor líquido de crédito inválido para a cobrança (%).', _cobranca_id;
  END IF;

  SELECT count(*)
  INTO v_fundings_count
  FROM public.fundings
  WHERE cobranca_id = _cobranca_id;

  IF v_fundings_count > 1 THEN
    RAISE EXCEPTION 'Mais de um funding vinculado à cobrança (%).', _cobranca_id;
  END IF;

  IF v_fundings_count = 1 THEN
    SELECT id, status
    INTO v_funding_id, v_funding_status
    FROM public.fundings
    WHERE cobranca_id = _cobranca_id
    FOR UPDATE;

    IF v_funding_status NOT IN ('pending', 'available') THEN
      RAISE EXCEPTION 'Status do funding não permite disponibilização: %', v_funding_status;
    END IF;
  ELSIF v_cobranca.tipo = 'aporte_agencia' THEN
    RAISE EXCEPTION 'Aporte de agência sem registro de funding associado.';
  END IF;

  IF v_movimento.id IS NULL THEN
    INSERT INTO public.movimentos_saldo (
      empresa_id, tipo, valor, descricao, cobranca_id
    ) VALUES (
      v_cobranca.empresa_id,
      'credito',
      v_valor_credito,
      'Cobrança paga — ' || v_cobranca.descricao,
      _cobranca_id
    );
  END IF;

  UPDATE public.cobrancas
  SET status = 'pago',
      parceiro_cobranca_id = _parceiro_id,
      pago_em = COALESCE(pago_em, now()),
      atualizado_em = now()
  WHERE id = _cobranca_id;

  IF v_funding_id IS NOT NULL AND v_funding_status = 'pending' THEN
    UPDATE public.fundings
    SET status = 'available',
        valor_disponivel = v_valor_credito,
        referencia_parceiro = _parceiro_id,
        atualizado_em = now()
    WHERE id = v_funding_id;
  END IF;

  IF v_taxa_id IS NOT NULL THEN
    UPDATE public.taxas_plataforma
    SET status = 'cobrada',
        atualizado_em = now()
    WHERE id = v_taxa_id;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'ja_processada', v_movimento.id IS NOT NULL,
    'cobranca_id', _cobranca_id,
    'empresa_id', v_cobranca.empresa_id,
    'valor_creditado', v_valor_credito
  );
END;
$$;

REVOKE ALL ON FUNCTION public.liquidar_cobranca_funding_asaas(uuid, text, numeric)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.liquidar_cobranca_funding_asaas(uuid, text, numeric)
  TO service_role;

-- =============================================================================
-- 2. Efetivação do Pix de saída: somente service_role e estado/valor vinculados.
-- Remove a assinatura antiga que aceitava JWT authenticated.
-- =============================================================================
REVOKE ALL ON FUNCTION public.efetivar_pagamento_pix_db(
  uuid, uuid, text, text, timestamptz, text, text, text
) FROM PUBLIC, anon, authenticated;
DROP FUNCTION IF EXISTS public.efetivar_pagamento_pix_db(
  uuid, uuid, text, text, timestamptz, text, text, text
);

CREATE FUNCTION public.efetivar_pagamento_pix_db(
  _pagamento_id uuid,
  _empresa_id uuid,
  _status_final text,
  _txid text,
  _executado_em timestamptz,
  _erro text,
  _chave_pix text,
  _descricao_debito text,
  _valor numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pagamento RECORD;
  v_empresa_real uuid;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Efetivação de Pix permitida somente por serviço autenticado.';
  END IF;

  IF _txid IS NULL OR length(trim(_txid)) = 0 THEN
    RAISE EXCEPTION 'Identificador da transferência Asaas é obrigatório.';
  END IF;
  IF _valor IS NULL OR _valor <= 0 THEN
    RAISE EXCEPTION 'Valor confirmado da transferência é obrigatório.';
  END IF;
  IF _status_final NOT IN ('executado', 'processando', 'aguardando_aprovacao') THEN
    RAISE EXCEPTION 'Status final inválido para efetivação de Pix: %', _status_final;
  END IF;

  v_empresa_real := public.empresa_do_pagamento(_pagamento_id);
  IF v_empresa_real IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Pagamento não localizado.');
  END IF;
  IF _empresa_id IS NOT NULL AND _empresa_id <> v_empresa_real THEN
    RAISE EXCEPTION 'Empresa informada diverge da empresa proprietária do pagamento.';
  END IF;

  SELECT id, valor, status, parceiro_transferencia_id, txid_parceiro
  INTO v_pagamento
  FROM public.pagamentos
  WHERE id = _pagamento_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Pagamento não encontrado.');
  END IF;

  IF round(_valor, 2) <> round(v_pagamento.valor, 2) THEN
    RAISE EXCEPTION 'Valor da transferência (%) diverge do pagamento (%).', _valor, v_pagamento.valor;
  END IF;

  IF v_pagamento.parceiro_transferencia_id IS NOT NULL
     AND v_pagamento.parceiro_transferencia_id <> _txid THEN
    RAISE EXCEPTION 'Pagamento já vinculado a outra transferência Asaas.';
  END IF;
  IF v_pagamento.txid_parceiro IS NOT NULL AND v_pagamento.txid_parceiro <> _txid THEN
    RAISE EXCEPTION 'TXID do pagamento diverge da transferência informada.';
  END IF;

  UPDATE public.pagamentos
  SET status = _status_final::public.status_pagamento,
      txid_parceiro = _txid,
      parceiro_transferencia_id = _txid,
      executado_em = CASE WHEN _status_final = 'executado' THEN COALESCE(_executado_em, now()) ELSE NULL END,
      erro = _erro,
      chave_pix_destino = COALESCE(_chave_pix, chave_pix_destino),
      atualizado_em = now()
  WHERE id = _pagamento_id;

  -- A linha do pagamento está bloqueada; o índice parcial único é uma segunda barreira.
  INSERT INTO public.movimentos_saldo (
    empresa_id, tipo, valor, descricao, pagamento_id
  )
  SELECT
    v_empresa_real,
    'debito',
    v_pagamento.valor,
    COALESCE(_descricao_debito, 'Pix para freelancer'),
    _pagamento_id
  WHERE NOT EXISTS (
    SELECT 1 FROM public.movimentos_saldo
    WHERE pagamento_id = _pagamento_id AND tipo = 'debito'
  );

  RETURN jsonb_build_object('ok', true, 'status', _status_final, 'transferencia_id', _txid);
END;
$$;

REVOKE ALL ON FUNCTION public.efetivar_pagamento_pix_db(
  uuid, uuid, text, text, timestamptz, text, text, text, numeric
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.efetivar_pagamento_pix_db(
  uuid, uuid, text, text, timestamptz, text, text, text, numeric
) TO service_role;

-- =============================================================================
-- 3. Estorno do Pix: exige ID da transferência e serviço autenticado.
-- Elimina a função antiga que permitia chamada financeira direta por authenticated.
-- =============================================================================
REVOKE ALL ON FUNCTION public.reverter_transferencia_pagamento_pix(uuid, text, text, text)
  FROM PUBLIC, anon, authenticated;
DROP FUNCTION IF EXISTS public.reverter_transferencia_pagamento_pix(uuid, text, text, text);

CREATE FUNCTION public.reverter_transferencia_pagamento_pix_seguro(
  _pagamento_id uuid,
  _transferencia_id text,
  _status_final text,
  _motivo text,
  _descricao_credito text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pagamento RECORD;
  v_empresa_real uuid;
  v_mov_debito RECORD;
  v_mov_credito RECORD;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Reversão de Pix permitida somente por serviço autenticado.';
  END IF;

  IF _transferencia_id IS NULL OR length(trim(_transferencia_id)) = 0 THEN
    RAISE EXCEPTION 'Identificador da transferência Asaas é obrigatório para reverter.';
  END IF;
  IF _status_final NOT IN ('falhou', 'estornado') THEN
    RAISE EXCEPTION 'Status final inválido para reversão: %', _status_final;
  END IF;

  v_empresa_real := public.empresa_do_pagamento(_pagamento_id);
  IF v_empresa_real IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Pagamento não encontrado.');
  END IF;

  SELECT id, valor, status, parceiro_transferencia_id, txid_parceiro
  INTO v_pagamento
  FROM public.pagamentos
  WHERE id = _pagamento_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Pagamento não encontrado.');
  END IF;

  IF v_pagamento.parceiro_transferencia_id IS NOT NULL
     AND v_pagamento.parceiro_transferencia_id <> _transferencia_id THEN
    RAISE EXCEPTION 'Transferência recebida diverge da transferência vinculada ao pagamento.';
  END IF;
  IF v_pagamento.txid_parceiro IS NOT NULL AND v_pagamento.txid_parceiro <> _transferencia_id THEN
    RAISE EXCEPTION 'TXID vinculado ao pagamento diverge da transferência recebida.';
  END IF;

  SELECT id, valor
  INTO v_mov_debito
  FROM public.movimentos_saldo
  WHERE pagamento_id = _pagamento_id AND tipo = 'debito'
  FOR UPDATE;

  IF v_mov_debito.id IS NOT NULL THEN
    SELECT id
    INTO v_mov_credito
    FROM public.movimentos_saldo
    WHERE pagamento_id = _pagamento_id AND tipo = 'credito'
    FOR UPDATE;
  END IF;

  UPDATE public.pagamentos
  SET status = _status_final::public.status_pagamento,
      parceiro_transferencia_id = _transferencia_id,
      txid_parceiro = _transferencia_id,
      erro = _motivo,
      atualizado_em = now()
  WHERE id = _pagamento_id;

  IF v_mov_debito.id IS NOT NULL AND v_mov_credito.id IS NULL THEN
    INSERT INTO public.movimentos_saldo (
      empresa_id, tipo, valor, descricao, pagamento_id
    ) VALUES (
      v_empresa_real,
      'credito',
      v_mov_debito.valor,
      COALESCE(_descricao_credito, 'Estorno de Pix (' || _status_final || ')'),
      _pagamento_id
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'status', _status_final,
    'estornado', v_mov_debito.id IS NOT NULL,
    'ja_estornado', v_mov_credito.id IS NOT NULL
  );
END;
$$;

REVOKE ALL ON FUNCTION public.reverter_transferencia_pagamento_pix_seguro(uuid, text, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reverter_transferencia_pagamento_pix_seguro(uuid, text, text, text, text)
  TO service_role;

-- =============================================================================
-- 4. Fatura SaaS: cobrança diferente não é tratada como reentrega idempotente.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.liquidar_fatura_plataforma_asaas(
  _fatura_id uuid,
  _parceiro_id text,
  _valor numeric DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_fatura RECORD;
  v_assinatura_id uuid;
  v_assinaturas_count integer;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Liquidação de fatura SaaS permitida somente por serviço autenticado.';
  END IF;
  IF _parceiro_id IS NULL OR length(trim(_parceiro_id)) = 0 THEN
    RAISE EXCEPTION 'Identificador da cobrança no provedor é obrigatório.';
  END IF;
  IF _valor IS NULL OR _valor <= 0 THEN
    RAISE EXCEPTION 'Valor confirmado pelo provedor é obrigatório.';
  END IF;

  SELECT id, empresa_id, assinatura_id, plano_id, status, total, referencia_provedor
  INTO v_fatura
  FROM public.faturas_plataforma
  WHERE id = _fatura_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Fatura SaaS não encontrada.');
  END IF;

  IF round(_valor, 2) <> round(v_fatura.total, 2) THEN
    RAISE EXCEPTION 'Valor recebido (%) diverge do total da fatura (%).', _valor, v_fatura.total;
  END IF;

  IF v_fatura.status IN ('pago', 'paga') THEN
    IF v_fatura.referencia_provedor = _parceiro_id THEN
      RETURN jsonb_build_object('ok', true, 'ja_paga', true, 'fatura_id', _fatura_id);
    END IF;

    INSERT INTO public.logs_auditoria (
      empresa_id, ator_contexto, acao, recurso_tipo, recurso_id, resultado, detalhes
    ) VALUES (
      v_fatura.empresa_id,
      'sistema',
      'fatura_saas_cobranca_duplicada',
      'fatura_plataforma',
      _fatura_id::text,
      'alerta',
      jsonb_build_object(
        'parceiro_original', v_fatura.referencia_provedor,
        'parceiro_recebido', _parceiro_id,
        'valor', _valor
      )
    );
    RETURN jsonb_build_object('ok', true, 'ja_paga', true, 'cobranca_duplicada', true, 'fatura_id', _fatura_id);
  END IF;

  IF v_fatura.status NOT IN ('pendente', 'vencida', 'aguardando_pagamento') THEN
    RAISE EXCEPTION 'Status da fatura não permite liquidação: %', v_fatura.status;
  END IF;

  IF v_fatura.assinatura_id IS NOT NULL THEN
    SELECT id
    INTO v_assinatura_id
    FROM public.assinaturas
    WHERE id = v_fatura.assinatura_id
      AND empresa_id = v_fatura.empresa_id
      AND plano_id = v_fatura.plano_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Assinatura vinculada à fatura não corresponde à empresa e ao plano.';
    END IF;
  ELSE
    SELECT count(*), (array_agg(id))[1]
    INTO v_assinaturas_count, v_assinatura_id
    FROM public.assinaturas
    WHERE empresa_id = v_fatura.empresa_id
      AND plano_id = v_fatura.plano_id
      AND status = 'pendente';

    IF v_assinaturas_count <> 1 THEN
      RAISE EXCEPTION 'Não foi possível resolver uma única assinatura pendente para a fatura (encontradas: %).',
        v_assinaturas_count;
    END IF;

    PERFORM 1
    FROM public.assinaturas
    WHERE id = v_assinatura_id
    FOR UPDATE;
  END IF;

  UPDATE public.faturas_plataforma
  SET status = 'pago',
      referencia_provedor = _parceiro_id,
      provedor = 'asaas',
      pago_em = now(),
      atualizado_em = now()
  WHERE id = _fatura_id;

  UPDATE public.assinaturas
  SET status = 'ativa', atualizado_em = now()
  WHERE id = v_assinatura_id
    AND empresa_id = v_fatura.empresa_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Assinatura da fatura não foi encontrada para ativação.';
  END IF;

  INSERT INTO public.logs_auditoria (
    empresa_id, ator_contexto, acao, recurso_tipo, recurso_id, resultado, detalhes
  ) VALUES (
    v_fatura.empresa_id,
    'sistema',
    'fatura_plataforma_liquidada_asaas',
    'fatura_plataforma',
    _fatura_id::text,
    'sucesso',
    jsonb_build_object('provedor', 'asaas', 'parceiro_id', _parceiro_id, 'valor', _valor)
  );

  RETURN jsonb_build_object(
    'ok', true,
    'fatura_id', _fatura_id,
    'empresa_id', v_fatura.empresa_id,
    'total', v_fatura.total
  );
END;
$$;

REVOKE ALL ON FUNCTION public.liquidar_fatura_plataforma_asaas(uuid, text, numeric)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.liquidar_fatura_plataforma_asaas(uuid, text, numeric)
  TO service_role;
