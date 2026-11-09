-- Rate limit atômico para o fluxo público de registro de ponto.
-- O advisory lock serializa tentativas do mesmo par token/IP, evitando que
-- requisições concorrentes ultrapassem o limite por uma corrida de contagem.
CREATE OR REPLACE FUNCTION public.iniciar_tentativa_ponto_publico(
  _token_hash text,
  _cpf_hash text,
  _ip_hash text,
  _acao text
)
RETURNS TABLE (
  permitido boolean,
  tentativa_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_total_ip integer;
  v_total_cpf integer;
  v_tentativa_id uuid;
BEGIN
  IF _token_hash IS NULL
     OR _cpf_hash IS NULL
     OR _ip_hash IS NULL
     OR _acao IS NULL
     OR _token_hash !~ '^[0-9a-f]{64}
    RAISE EXCEPTION 'Parâmetros de rate limit inválidos';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(_token_hash || ':' || _ip_hash, 0)
  );

  -- Limite amplo por IP para não bloquear equipes grandes atrás do mesmo NAT.
  SELECT count(*)::integer
  INTO v_total_ip
  FROM public.tentativas_ponto_publico t
  WHERE t.token_hash = _token_hash
    AND t.ip_hash = _ip_hash
    AND t.criado_em >= now() - interval '10 minutes';

  -- Limite individual por CPF para conter enumeração/brute force.
  SELECT count(*)::integer
  INTO v_total_cpf
  FROM public.tentativas_ponto_publico t
  WHERE t.token_hash = _token_hash
    AND t.cpf_hash = _cpf_hash
    AND t.criado_em >= now() - interval '10 minutes';

  IF v_total_ip >= 1200 OR v_total_cpf >= 10 THEN
    RETURN QUERY SELECT false, NULL::uuid;
    RETURN;
  END IF;

  INSERT INTO public.tentativas_ponto_publico (
    token_hash,
    cpf_hash,
    ip_hash,
    acao,
    sucesso
  )
  VALUES (
    _token_hash,
    _cpf_hash,
    _ip_hash,
    _acao,
    false
  )
  RETURNING id INTO v_tentativa_id;

  RETURN QUERY SELECT true, v_tentativa_id;
END;
$$;

CREATE INDEX IF NOT EXISTS tentativas_ponto_token_cpf_idx
  ON public.tentativas_ponto_publico (token_hash, cpf_hash, criado_em DESC)
  WHERE cpf_hash IS NOT NULL;

REVOKE ALL ON FUNCTION public.iniciar_tentativa_ponto_publico(text, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.iniciar_tentativa_ponto_publico(text, text, text, text)
  TO service_role;

     OR _cpf_hash !~ '^[0-9a-f]{64}
    RAISE EXCEPTION 'Parâmetros de rate limit inválidos';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(_token_hash || ':' || _ip_hash, 0)
  );

  SELECT count(*)::integer
  INTO v_total
  FROM public.tentativas_ponto_publico t
  WHERE t.token_hash = _token_hash
    AND t.ip_hash = _ip_hash
    AND t.criado_em >= now() - interval '10 minutes';

  IF v_total >= 20 THEN
    RETURN QUERY SELECT false, NULL::uuid;
    RETURN;
  END IF;

  INSERT INTO public.tentativas_ponto_publico (
    token_hash,
    cpf_hash,
    ip_hash,
    acao,
    sucesso
  )
  VALUES (
    _token_hash,
    _cpf_hash,
    _ip_hash,
    _acao,
    false
  )
  RETURNING id INTO v_tentativa_id;

  RETURN QUERY SELECT true, v_tentativa_id;
END;
$$;

REVOKE ALL ON FUNCTION public.iniciar_tentativa_ponto_publico(text, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.iniciar_tentativa_ponto_publico(text, text, text, text)
  TO service_role;

     OR _ip_hash !~ '^[0-9a-f]{64}
    RAISE EXCEPTION 'Parâmetros de rate limit inválidos';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(_token_hash || ':' || _ip_hash, 0)
  );

  SELECT count(*)::integer
  INTO v_total
  FROM public.tentativas_ponto_publico t
  WHERE t.token_hash = _token_hash
    AND t.ip_hash = _ip_hash
    AND t.criado_em >= now() - interval '10 minutes';

  IF v_total >= 20 THEN
    RETURN QUERY SELECT false, NULL::uuid;
    RETURN;
  END IF;

  INSERT INTO public.tentativas_ponto_publico (
    token_hash,
    cpf_hash,
    ip_hash,
    acao,
    sucesso
  )
  VALUES (
    _token_hash,
    _cpf_hash,
    _ip_hash,
    _acao,
    false
  )
  RETURNING id INTO v_tentativa_id;

  RETURN QUERY SELECT true, v_tentativa_id;
END;
$$;

REVOKE ALL ON FUNCTION public.iniciar_tentativa_ponto_publico(text, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.iniciar_tentativa_ponto_publico(text, text, text, text)
  TO service_role;

     OR _acao NOT IN ('contexto', 'identificar', 'confirmar', 'registrar') THEN
    RAISE EXCEPTION 'Parâmetros de rate limit inválidos';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(_token_hash || ':' || _ip_hash, 0)
  );

  SELECT count(*)::integer
  INTO v_total
  FROM public.tentativas_ponto_publico t
  WHERE t.token_hash = _token_hash
    AND t.ip_hash = _ip_hash
    AND t.criado_em >= now() - interval '10 minutes';

  IF v_total >= 20 THEN
    RETURN QUERY SELECT false, NULL::uuid;
    RETURN;
  END IF;

  INSERT INTO public.tentativas_ponto_publico (
    token_hash,
    cpf_hash,
    ip_hash,
    acao,
    sucesso
  )
  VALUES (
    _token_hash,
    _cpf_hash,
    _ip_hash,
    _acao,
    false
  )
  RETURNING id INTO v_tentativa_id;

  RETURN QUERY SELECT true, v_tentativa_id;
END;
$$;

REVOKE ALL ON FUNCTION public.iniciar_tentativa_ponto_publico(text, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.iniciar_tentativa_ponto_publico(text, text, text, text)
  TO service_role;
