-- Remove o acesso público à RPC legada de contexto do QR Code.
-- O fluxo público atual passa pela Edge Function ponto-publico, que aplica
-- validação do token assinado, assinatura ativa e rate limit atômico.
-- A função antiga foi concedida a anon na migration 20261027 e não aplica
-- os controles atuais; manter EXECUTE público permitiria contornar a Edge Function.

REVOKE ALL ON FUNCTION public.obter_contexto_ponto_por_token(text)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.obter_contexto_ponto_por_token(text)
  TO service_role;
