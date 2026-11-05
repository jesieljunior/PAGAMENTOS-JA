-- ==============================================================================
-- Migração: 20261104140000_finance_tenant_security_and_saas_invoicing.sql
-- Objetivo:
-- 1. Reforçar isolamento multi-tenant estrito nas RPCs financeiras SECURITY DEFINER
--    (iniciar_processamento_pagamento_pix, efetivar_pagamento_pix_db, reverter_transferencia_pagamento_pix)
-- 2. Criar helper public.empresa_do_pagamento(_pagamento_id uuid)
-- 3. Criar RPC public.liquidar_fatura_plataforma_asaas para conciliação atômica de SaaS
-- 4. Revogar privilégios de execução de roles não-autorizadas (public, anon)
-- ==============================================================================

-- 1. Helper para identificar a empresa detentora de um pagamento
CREATE OR REPLACE FUNCTION public.empresa_do_pagamento(_pagamento_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.empresa_do_fechamento(p.fechamento_id)
  FROM public.pagamentos p
  WHERE p.id = _pagamento_id;
$$;

REVOKE ALL ON FUNCTION public.empresa_do_pagamento(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.empresa_do_pagamento(uuid) TO authenticated, service_role;

-- 2. RPC: Bloqueio e transição atômica de pagamento com validação estrita de tenant
CREATE OR REPLACE FUNCTION public.iniciar_processamento_pagamento_pix(_pagamento_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pagamento RECORD;
  v_empresa_pagamento uuid;
BEGIN
  -- Identifica e valida o tenant proprietário do pagamento
  v_empresa_pagamento := public.empresa_do_pagamento(_pagamento_id);
  IF v_empresa_pagamento IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Pagamento não localizado ou fechamento desvinculado.');
  END IF;

  -- Se invocado por usuário autenticado (JWT), exige vínculo ativo com a empresa e capacidade financeira
  IF auth.uid() IS NOT NULL THEN
    IF NOT (public.eh_equipe_plataforma()) THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.usuarios u
        WHERE u.id = auth.uid()
          AND u.empresa_id = v_empresa_pagamento
          AND u.ativo = true
      ) THEN
        RAISE EXCEPTION 'Acesso negado: usuário não possui vínculo ativo com a agência do pagamento.';
      END IF;

      IF NOT (
        public.tem_capacidade(auth.uid(), 'financeiro.gerenciar')
        OR public.has_role(auth.uid(), 'admin')
      ) THEN
        RAISE EXCEPTION 'Acesso negado: permissão de gestão financeira necessária para processar Pix.';
      END IF;
    END IF;
  END IF;

  -- Bloqueio pessimista de linha (FOR UPDATE)
  SELECT id, valor, status, fechamento_id, chave_idempotencia
  INTO v_pagamento
  FROM public.pagamentos
  WHERE id = _pagamento_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Pagamento não encontrado.');
  END IF;

  IF v_pagamento.status = 'executado' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Pagamento já executado anteriormente.');
  END IF;

  IF v_pagamento.status = 'processando' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Pagamento já está sendo processado.');
  END IF;

  IF v_pagamento.status NOT IN ('pendente', 'agendado', 'falhou') THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Status do pagamento não permite processamento: ' || v_pagamento.status::text);
  END IF;

  -- Transição atômica
  UPDATE public.pagamentos
  SET status = 'processando',
      atualizado_em = now()
  WHERE id = _pagamento_id;

  RETURN jsonb_build_object(
    'ok', true,
    'pagamento_id', _pagamento_id,
    'status_anterior', v_pagamento.status::text,
    'valor', v_pagamento.valor
  );
END;
$$;

-- 3. RPC: Efetivação atômica de Pix e lançamento contábil de débito com validação de tenant
CREATE OR REPLACE FUNCTION public.efetivar_pagamento_pix_db(
  _pagamento_id uuid,
  _empresa_id uuid,
  _status_final text,
  _txid text,
  _executado_em timestamptz,
  _erro text,
  _chave_pix text,
  _descricao_debito text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pagamento RECORD;
  v_status_enum public.status_pagamento;
  v_empresa_pagamento uuid;
BEGIN
  -- 1. Identifica e valida o tenant proprietário do pagamento
  v_empresa_pagamento := public.empresa_do_pagamento(_pagamento_id);
  IF v_empresa_pagamento IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Pagamento não localizado.');
  END IF;

  -- 2. Rejeição explícita de _empresa_id divergente da empresa real
  IF _empresa_id IS NOT NULL AND _empresa_id <> v_empresa_pagamento THEN
    RAISE EXCEPTION 'Acesso negado: empresa informada divergente da organização dona do pagamento.';
  END IF;

  -- 3. Validação de usuário autenticado, vínculo ativo e permissão financeira
  IF auth.uid() IS NOT NULL THEN
    IF NOT (public.eh_equipe_plataforma()) THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.usuarios u
        WHERE u.id = auth.uid()
          AND u.empresa_id = v_empresa_pagamento
          AND u.ativo = true
      ) THEN
        RAISE EXCEPTION 'Acesso negado: usuário não possui vínculo ativo com a agência do pagamento.';
      END IF;

      IF NOT (
        public.tem_capacidade(auth.uid(), 'financeiro.gerenciar')
        OR public.has_role(auth.uid(), 'admin')
      ) THEN
        RAISE EXCEPTION 'Acesso negado: permissão financeira necessária para efetivar pagamentos.';
      END IF;
    END IF;
  END IF;

  SELECT id, valor, status
  INTO v_pagamento
  FROM public.pagamentos
  WHERE id = _pagamento_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Pagamento não encontrado.');
  END IF;

  -- Converte text para status_pagamento com fallback seguro
  BEGIN
    v_status_enum := _status_final::public.status_pagamento;
  EXCEPTION WHEN OTHERS THEN
    v_status_enum := 'pendente'::public.status_pagamento;
  END;

  UPDATE public.pagamentos
  SET status = v_status_enum,
      txid_parceiro = _txid,
      parceiro_transferencia_id = _txid,
      executado_em = _executado_em,
      erro = _erro,
      chave_pix_destino = _chave_pix,
      atualizado_em = now()
  WHERE id = _pagamento_id;

  -- Insere débito contábil caso ainda não exista (protegido por índice único parcial)
  IF NOT EXISTS (
    SELECT 1 FROM public.movimentos_saldo
    WHERE pagamento_id = _pagamento_id AND tipo = 'debito'
  ) THEN
    INSERT INTO public.movimentos_saldo (
      empresa_id,
      tipo,
      valor,
      descricao,
      pagamento_id
    ) VALUES (
      v_empresa_pagamento,
      'debito',
      v_pagamento.valor,
      _descricao_debito,
      _pagamento_id
    );
  END IF;

  RETURN jsonb_build_object('ok', true, 'status', v_status_enum::text);
END;
$$;

-- 4. RPC: Reversão / Estorno atômico de transferência Pix com validação de tenant
CREATE OR REPLACE FUNCTION public.reverter_transferencia_pagamento_pix(
  _pagamento_id uuid,
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
  v_mov_debito RECORD;
  v_status_enum public.status_pagamento;
  v_desc text;
  v_empresa_pagamento uuid;
BEGIN
  v_empresa_pagamento := public.empresa_do_pagamento(_pagamento_id);
  IF v_empresa_pagamento IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Pagamento não encontrado.');
  END IF;

  IF auth.uid() IS NOT NULL THEN
    IF NOT (public.eh_equipe_plataforma()) THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.usuarios u
        WHERE u.id = auth.uid()
          AND u.empresa_id = v_empresa_pagamento
          AND u.ativo = true
      ) THEN
        RAISE EXCEPTION 'Acesso negado: usuário não possui vínculo ativo com a agência do pagamento.';
      END IF;

      IF NOT (
        public.tem_capacidade(auth.uid(), 'financeiro.gerenciar')
        OR public.has_role(auth.uid(), 'admin')
      ) THEN
        RAISE EXCEPTION 'Acesso negado: permissão financeira necessária para reverter pagamentos.';
      END IF;
    END IF;
  END IF;

  SELECT id, valor, status
  INTO v_pagamento
  FROM public.pagamentos
  WHERE id = _pagamento_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Pagamento não encontrado.');
  END IF;

  -- Converte text para status_pagamento com fallback
  BEGIN
    v_status_enum := _status_final::public.status_pagamento;
  EXCEPTION WHEN OTHERS THEN
    v_status_enum := 'falhou'::public.status_pagamento;
  END;

  UPDATE public.pagamentos
  SET status = v_status_enum,
      erro = _motivo,
      atualizado_em = now()
  WHERE id = _pagamento_id;

  -- Localiza o débito original
  SELECT id, empresa_id, valor
  INTO v_mov_debito
  FROM public.movimentos_saldo
  WHERE pagamento_id = _pagamento_id AND tipo = 'debito'
  LIMIT 1;

  -- Se havia débito e ainda não houve estorno (crédito), compensa o saldo da agência garantindo v_empresa_pagamento
  IF FOUND THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.movimentos_saldo
      WHERE pagamento_id = _pagamento_id AND tipo = 'credito'
    ) THEN
      v_desc := COALESCE(_descricao_credito, 'Estorno de Pix (' || _status_final || ')');
      INSERT INTO public.movimentos_saldo (
        empresa_id,
        tipo,
        valor,
        descricao,
        pagamento_id
      ) VALUES (
        v_empresa_pagamento,
        'credito',
        v_mov_debito.valor,
        v_desc,
        _pagamento_id
      );
    END IF;
  END IF;

  RETURN jsonb_build_object('ok', true, 'status', v_status_enum::text, 'estornado', FOUND);
END;
$$;

-- 5. RPC: Liquidação atômica de Fatura do SaaS via Asaas
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
BEGIN
  SELECT id, empresa_id, assinatura_id, plano_id, status, total
  INTO v_fatura
  FROM public.faturas_plataforma
  WHERE id = _fatura_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Fatura SaaS não encontrada.');
  END IF;

  IF v_fatura.status IN ('pago', 'paga') THEN
    RETURN jsonb_build_object('ok', true, 'ja_paga', true, 'fatura_id', _fatura_id);
  END IF;

  UPDATE public.faturas_plataforma
  SET status = 'pago',
      referencia_provedor = COALESCE(_parceiro_id, referencia_provedor),
      provedor = 'asaas',
      pago_em = now(),
      atualizado_em = now()
  WHERE id = _fatura_id;

  -- Ativa a assinatura vinculada
  IF v_fatura.assinatura_id IS NOT NULL THEN
    UPDATE public.assinaturas
    SET status = 'ativa',
        atualizado_em = now()
    WHERE id = v_fatura.assinatura_id;
  ELSE
    UPDATE public.assinaturas
    SET status = 'ativa',
        atualizado_em = now()
    WHERE empresa_id = v_fatura.empresa_id;
  END IF;

  -- Registra auditoria da liquidação da fatura
  INSERT INTO public.logs_auditoria (
    empresa_id,
    ator_contexto,
    acao,
    recurso_tipo,
    recurso_id,
    resultado,
    detalhes
  ) VALUES (
    v_fatura.empresa_id,
    'sistema',
    'fatura_plataforma_liquidada_asaas',
    'fatura_plataforma',
    _fatura_id::text,
    'sucesso',
    jsonb_build_object(
      'provedor', 'asaas',
      'parceiro_id', _parceiro_id,
      'valor', COALESCE(_valor, v_fatura.total)
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'fatura_id', _fatura_id,
    'empresa_id', v_fatura.empresa_id,
    'total', v_fatura.total
  );
END;
$$;

-- 6. Enforçamento de permissões: Revoga anon/public e concede a authenticated / service_role
REVOKE ALL ON FUNCTION public.iniciar_processamento_pagamento_pix(uuid) FROM public, anon;
REVOKE ALL ON FUNCTION public.efetivar_pagamento_pix_db(uuid, uuid, text, text, timestamptz, text, text, text) FROM public, anon;
REVOKE ALL ON FUNCTION public.reverter_transferencia_pagamento_pix(uuid, text, text, text) FROM public, anon;
REVOKE ALL ON FUNCTION public.liquidar_fatura_plataforma_asaas(uuid, text, numeric) FROM public, anon;

GRANT EXECUTE ON FUNCTION public.iniciar_processamento_pagamento_pix(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.efetivar_pagamento_pix_db(uuid, uuid, text, text, timestamptz, text, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reverter_transferencia_pagamento_pix(uuid, text, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.liquidar_fatura_plataforma_asaas(uuid, text, numeric) TO authenticated, service_role;

-- 7. Expansão de status da assinatura para suportar 'pendente' e 'aguardando_pagamento'
ALTER TABLE public.assinaturas DROP CONSTRAINT IF EXISTS assinaturas_status_check;
ALTER TABLE public.assinaturas ADD CONSTRAINT assinaturas_status_check
  CHECK (status IN ('trial', 'ativa', 'bloqueada', 'cancelada', 'pendente', 'aguardando_pagamento'));

