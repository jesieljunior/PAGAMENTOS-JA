-- A liquidação de faturas SaaS só pode ser executada por backend/service_role.
-- O valor recebido do gateway é obrigatório e deve coincidir com o valor imutável da fatura.
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
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Liquidação de fatura SaaS permitida somente por serviço autenticado.';
  END IF;

  IF _parceiro_id IS NULL OR length(trim(_parceiro_id)) = 0 THEN
    RAISE EXCEPTION 'Identificador da cobrança no provedor é obrigatório.';
  END IF;

  IF _valor IS NULL OR _valor <= 0 THEN
    RAISE EXCEPTION 'Valor confirmado pelo provedor é obrigatório.';
  END IF;

  SELECT id, empresa_id, assinatura_id, status, total
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
    RETURN jsonb_build_object('ok', true, 'ja_paga', true, 'fatura_id', _fatura_id);
  END IF;

  IF v_fatura.status NOT IN ('pendente', 'vencida', 'aguardando_pagamento') THEN
    RAISE EXCEPTION 'Status da fatura não permite liquidação: %', v_fatura.status;
  END IF;

  UPDATE public.faturas_plataforma
  SET status = 'pago',
      referencia_provedor = _parceiro_id,
      provedor = 'asaas',
      pago_em = now(),
      atualizado_em = now()
  WHERE id = _fatura_id;

  IF v_fatura.assinatura_id IS NOT NULL THEN
    UPDATE public.assinaturas
    SET status = 'ativa', atualizado_em = now()
    WHERE id = v_fatura.assinatura_id;
  ELSE
    UPDATE public.assinaturas
    SET status = 'ativa', atualizado_em = now()
    WHERE empresa_id = v_fatura.empresa_id;
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

  RETURN jsonb_build_object('ok', true, 'fatura_id', _fatura_id, 'empresa_id', v_fatura.empresa_id, 'total', v_fatura.total);
END;
$$;

REVOKE ALL ON FUNCTION public.liquidar_fatura_plataforma_asaas(uuid, text, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.liquidar_fatura_plataforma_asaas(uuid, text, numeric) TO service_role;
