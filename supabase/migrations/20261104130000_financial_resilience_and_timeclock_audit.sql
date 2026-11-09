-- ==============================================================================
-- Migração: 20261104130000_financial_resilience_and_timeclock_audit.sql
-- Objetivo: Garantir atomismo financeiro no PostgreSQL, índices únicos parciais contra
-- concorrência de saldo, controle de retentativas de webhooks e funções RPC transacionais.
-- ==============================================================================

-- 1. Expansão de estados do enum status_pagamento (idempotente)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON e.enumtypid = t.oid WHERE t.typname = 'status_pagamento' AND e.enumlabel = 'processando') THEN
    ALTER TYPE public.status_pagamento ADD VALUE 'processando';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON e.enumtypid = t.oid WHERE t.typname = 'status_pagamento' AND e.enumlabel = 'aguardando_aprovacao') THEN
    ALTER TYPE public.status_pagamento ADD VALUE 'aguardando_aprovacao';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON e.enumtypid = t.oid WHERE t.typname = 'status_pagamento' AND e.enumlabel = 'estornado') THEN
    ALTER TYPE public.status_pagamento ADD VALUE 'estornado';
  END IF;
END $$;

-- 2. Atualização e resiliência da tabela webhook_eventos
-- Webhooks são autenticados pelo segredo do provedor e processados pelo backend.
-- Usuários autenticados não podem inserir eventos falsos nem reservar chaves de idempotência.
REVOKE ALL ON TABLE public.webhook_eventos FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.webhook_eventos TO service_role;
ALTER TABLE public.webhook_eventos DROP CONSTRAINT IF EXISTS webhook_eventos_status_check;
ALTER TABLE public.webhook_eventos ADD CONSTRAINT webhook_eventos_status_check
  CHECK (status IN ('processando', 'processado', 'falhou', 'falha'));

ALTER TABLE public.webhook_eventos ADD COLUMN IF NOT EXISTS tentativas integer NOT NULL DEFAULT 1;
ALTER TABLE public.webhook_eventos ADD COLUMN IF NOT EXISTS erro text;

-- 3. Índices únicos parciais em movimentos_saldo para evitar duplo débito ou duplo estorno por pagamento
-- Verifica o ledger antes dos índices: não tenta escolher ou apagar lançamentos históricos automaticamente.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.movimentos_saldo
    WHERE pagamento_id IS NOT NULL AND tipo IN ('debito', 'credito')
    GROUP BY pagamento_id, tipo
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION
      'Há pagamentos com lançamentos contábeis duplicados. Reconcilie o ledger antes de aplicar a migration 20261104130000.';
  END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_movimentos_pagamento_debito
  ON public.movimentos_saldo (pagamento_id)
  WHERE (tipo = 'debito');

CREATE UNIQUE INDEX IF NOT EXISTS idx_movimentos_pagamento_credito
  ON public.movimentos_saldo (pagamento_id)
  WHERE (tipo = 'credito');

-- 3.1 Helper para identificar a empresa detentora de um pagamento
CREATE OR REPLACE FUNCTION public.empresa_do_pagamento(_pagamento_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT public.empresa_do_fechamento(p.fechamento_id)
  FROM public.pagamentos p
  WHERE p.id = _pagamento_id;
$$;

REVOKE ALL ON FUNCTION public.empresa_do_pagamento(uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.empresa_do_pagamento(uuid) TO service_role;

-- 4. RPC: Bloqueio e transição atômica de pagamento para 'processando' com validação estrita de tenant
CREATE OR REPLACE FUNCTION public.iniciar_processamento_pagamento_pix(_pagamento_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_pagamento RECORD;
  v_empresa_real uuid;
BEGIN
  -- 1. Consulta e validação da empresa real do pagamento
  v_empresa_real := public.empresa_do_pagamento(_pagamento_id);
  IF v_empresa_real IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Pagamento não localizado ou desvinculado de fechamento válido.');
  END IF;

  -- 2. Validação estrita de autenticação, tenant e permissão financeira
  IF auth.uid() IS NOT NULL THEN
    IF NOT (public.eh_equipe_plataforma()) THEN
      -- Verifica vínculo ativo com a empresa do pagamento
      IF NOT EXISTS (
        SELECT 1 FROM public.usuarios u
        WHERE u.id = auth.uid()
          AND u.empresa_id = v_empresa_real
          AND u.ativo = true
      ) THEN
        RAISE EXCEPTION 'Acesso negado: usuário não possui vínculo ativo com a agência do pagamento.';
      END IF;

      -- Verifica capacidade financeira ou role admin
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

-- 5. RPC: Efetivação atômica de Pix e lançamento contábil de débito com validação de tenant
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
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_pagamento RECORD;
  v_status_enum public.status_pagamento;
  v_empresa_real uuid;
BEGIN
  -- 1. Consulta e validação da empresa real do pagamento
  v_empresa_real := public.empresa_do_pagamento(_pagamento_id);
  IF v_empresa_real IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Pagamento não localizado.');
  END IF;

  -- 2. Rejeição explícita de qualquer _empresa_id divergente da empresa real
  IF _empresa_id IS NOT NULL AND _empresa_id <> v_empresa_real THEN
    RAISE EXCEPTION 'Acesso negado: empresa informada divergente da organização dona do pagamento.';
  END IF;

  -- 3. Validação de usuário autenticado, vínculo ativo e permissão financeira
  IF auth.uid() IS NOT NULL THEN
    IF NOT (public.eh_equipe_plataforma()) THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.usuarios u
        WHERE u.id = auth.uid()
          AND u.empresa_id = v_empresa_real
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

  -- Insere débito contábil garantido usando SEMPRE a empresa real
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
      v_empresa_real,
      'debito',
      v_pagamento.valor,
      _descricao_debito,
      _pagamento_id
    );
  END IF;

  RETURN jsonb_build_object('ok', true, 'status', v_status_enum::text);
END;
$$;

-- 6. RPC: Reversão / Estorno atômico de transferência Pix com validação de tenant
CREATE OR REPLACE FUNCTION public.reverter_transferencia_pagamento_pix(
  _pagamento_id uuid,
  _status_final text,
  _motivo text,
  _descricao_credito text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_pagamento RECORD;
  v_mov_debito RECORD;
  v_status_enum public.status_pagamento;
  v_desc text;
  v_empresa_real uuid;
BEGIN
  v_empresa_real := public.empresa_do_pagamento(_pagamento_id);
  IF v_empresa_real IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Pagamento não encontrado.');
  END IF;

  IF auth.uid() IS NOT NULL THEN
    IF NOT (public.eh_equipe_plataforma()) THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.usuarios u
        WHERE u.id = auth.uid()
          AND u.empresa_id = v_empresa_real
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

  -- Se havia débito e ainda não houve estorno (crédito), compensa o saldo da agência
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
        v_empresa_real,
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

-- 7. Revogação de privilégios públicos e concessão exclusiva a autenticados autorizados e service_role
REVOKE ALL ON FUNCTION public.iniciar_processamento_pagamento_pix(uuid) FROM public, anon;
REVOKE ALL ON FUNCTION public.efetivar_pagamento_pix_db(uuid, uuid, text, text, timestamptz, text, text, text) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.reverter_transferencia_pagamento_pix(uuid, text, text, text) FROM public, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.iniciar_processamento_pagamento_pix(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.efetivar_pagamento_pix_db(uuid, uuid, text, text, timestamptz, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.reverter_transferencia_pagamento_pix(uuid, text, text, text) TO service_role;
