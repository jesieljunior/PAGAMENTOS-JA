-- Restringe as RPCs financeiras SECURITY DEFINER ao financeiro da agência dona do pagamento.
-- O service_role permanece permitido para webhooks/rotinas server-side autenticadas.
CREATE OR REPLACE FUNCTION public.assert_financeiro_pagamento(
  _pagamento_id uuid,
  _empresa_id uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_empresa_id uuid;
BEGIN
  SELECT ev.empresa_id
    INTO v_empresa_id
  FROM public.pagamentos p
  JOIN public.fechamentos f ON f.id = p.fechamento_id
  JOIN public.escalas e ON e.id = f.escala_id
  JOIN public.equipes eq ON eq.id = e.equipe_id
  JOIN public.eventos ev ON ev.id = eq.evento_id
  WHERE p.id = _pagamento_id;

  IF v_empresa_id IS NULL THEN
    RAISE EXCEPTION 'Pagamento sem agência válida ou inexistente.';
  END IF;

  IF _empresa_id IS NOT NULL AND _empresa_id <> v_empresa_id THEN
    RAISE EXCEPTION 'A agência informada não corresponde ao pagamento.';
  END IF;

  IF auth.role() = 'service_role' THEN
    RETURN;
  END IF;

  IF auth.uid() IS NULL OR NOT (
    EXISTS (
      SELECT 1
      FROM public.usuarios u
      JOIN public.user_roles ur ON ur.user_id = u.id
      WHERE u.id = auth.uid()
        AND u.empresa_id = v_empresa_id
        AND u.ativo = true
        AND ur.role IN ('admin', 'financeiro')
    )
    OR EXISTS (
      SELECT 1
      FROM public.plataforma_usuarios pu
      WHERE pu.user_id = auth.uid()
        AND pu.papel = 'admin_master'
    )
  ) THEN
    RAISE EXCEPTION 'Sem permissão financeira para operar este pagamento.';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.assert_financeiro_pagamento(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assert_financeiro_pagamento(uuid, uuid) TO authenticated, service_role;

-- As verificações são feitas dentro das próprias transações, não apenas no frontend.
CREATE OR REPLACE FUNCTION public.iniciar_processamento_pagamento_pix(_pagamento_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pagamento RECORD;
BEGIN
  SELECT id, valor, status, fechamento_id, chave_idempotencia
  INTO v_pagamento
  FROM public.pagamentos
  WHERE id = _pagamento_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Pagamento não encontrado.');
  END IF;

  PERFORM public.assert_financeiro_pagamento(_pagamento_id);

  IF v_pagamento.status = 'executado' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Pagamento já executado anteriormente.');
  END IF;
  IF v_pagamento.status = 'processando' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Pagamento já está sendo processado.');
  END IF;
  IF v_pagamento.status NOT IN ('pendente', 'agendado', 'falhou') THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Status do pagamento não permite processamento: ' || v_pagamento.status::text);
  END IF;

  UPDATE public.pagamentos
  SET status = 'processando', atualizado_em = now()
  WHERE id = _pagamento_id;

  RETURN jsonb_build_object(
    'ok', true,
    'pagamento_id', _pagamento_id,
    'status_anterior', v_pagamento.status::text,
    'valor', v_pagamento.valor
  );
END;
$$;

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

  PERFORM public.assert_financeiro_pagamento(_pagamento_id, _empresa_id);

  BEGIN
    v_status_enum := _status_final::public.status_pagamento;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'Status final inválido: %', _status_final;
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

  IF NOT EXISTS (
    SELECT 1 FROM public.movimentos_saldo
    WHERE pagamento_id = _pagamento_id AND tipo = 'debito'
  ) THEN
    INSERT INTO public.movimentos_saldo (
      empresa_id, tipo, valor, descricao, pagamento_id
    ) VALUES (
      _empresa_id, 'debito', v_pagamento.valor, _descricao_debito, _pagamento_id
    );
  END IF;

  RETURN jsonb_build_object('ok', true, 'status', v_status_enum::text);
END;
$$;

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
  v_tem_debito boolean := false;
BEGIN
  SELECT id, valor, status
  INTO v_pagamento
  FROM public.pagamentos
  WHERE id = _pagamento_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Pagamento não encontrado.');
  END IF;

  PERFORM public.assert_financeiro_pagamento(_pagamento_id);

  IF _status_final NOT IN ('falhou', 'estornado') THEN
    RAISE EXCEPTION 'Status de reversão inválido: %', _status_final;
  END IF;
  v_status_enum := _status_final::public.status_pagamento;

  UPDATE public.pagamentos
  SET status = v_status_enum, erro = _motivo, atualizado_em = now()
  WHERE id = _pagamento_id;

  SELECT id, empresa_id, valor
  INTO v_mov_debito
  FROM public.movimentos_saldo
  WHERE pagamento_id = _pagamento_id AND tipo = 'debito'
  LIMIT 1;
  v_tem_debito := FOUND;

  IF v_tem_debito AND NOT EXISTS (
    SELECT 1 FROM public.movimentos_saldo
    WHERE pagamento_id = _pagamento_id AND tipo = 'credito'
  ) THEN
    v_desc := COALESCE(_descricao_credito, 'Estorno de Pix (' || _status_final || ')');
    INSERT INTO public.movimentos_saldo (
      empresa_id, tipo, valor, descricao, pagamento_id
    ) VALUES (
      v_mov_debito.empresa_id, 'credito', v_mov_debito.valor, v_desc, _pagamento_id
    );
  END IF;

  RETURN jsonb_build_object('ok', true, 'status', v_status_enum::text, 'estornado', v_tem_debito);
END;
$$;

GRANT EXECUTE ON FUNCTION public.iniciar_processamento_pagamento_pix(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.efetivar_pagamento_pix_db(uuid, uuid, text, text, timestamptz, text, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reverter_transferencia_pagamento_pix(uuid, text, text, text) TO authenticated, service_role;
