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
ALTER TABLE public.webhook_eventos DROP CONSTRAINT IF EXISTS webhook_eventos_status_check;
ALTER TABLE public.webhook_eventos ADD CONSTRAINT webhook_eventos_status_check
  CHECK (status IN ('processando', 'processado', 'falhou', 'falha'));

ALTER TABLE public.webhook_eventos ADD COLUMN IF NOT EXISTS tentativas integer NOT NULL DEFAULT 1;
ALTER TABLE public.webhook_eventos ADD COLUMN IF NOT EXISTS erro text;

-- 3. Índices únicos parciais em movimentos_saldo para evitar duplo débito ou duplo estorno por pagamento
CREATE UNIQUE INDEX IF NOT EXISTS idx_movimentos_pagamento_debito
  ON public.movimentos_saldo (pagamento_id)
  WHERE (tipo = 'debito');

CREATE UNIQUE INDEX IF NOT EXISTS idx_movimentos_pagamento_credito
  ON public.movimentos_saldo (pagamento_id)
  WHERE (tipo = 'credito');

-- 4. RPC: Bloqueio e transição atômica de pagamento para 'processando'
-- Evita que requisições concorrentes disparem mais de uma transferência Pix para o mesmo pagamento
CREATE OR REPLACE FUNCTION public.iniciar_processamento_pagamento_pix(_pagamento_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pagamento RECORD;
BEGIN
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

-- 5. RPC: Efetivação atômica de Pix e lançamento contábil de débito
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
BEGIN
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
      _empresa_id,
      'debito',
      v_pagamento.valor,
      _descricao_debito,
      _pagamento_id
    );
  END IF;

  RETURN jsonb_build_object('ok', true, 'status', v_status_enum::text);
END;
$$;

-- 6. RPC: Reversão / Estorno atômico de transferência Pix
-- Executa a alteração de status e o crédito de estorno dentro da mesma transação ACID
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
BEGIN
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
        v_mov_debito.empresa_id,
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

-- 7. Permissões de execução para as novas funções
GRANT EXECUTE ON FUNCTION public.iniciar_processamento_pagamento_pix(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.efetivar_pagamento_pix_db(uuid, uuid, text, text, timestamptz, text, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reverter_transferencia_pagamento_pix(uuid, text, text, text) TO authenticated, service_role;
