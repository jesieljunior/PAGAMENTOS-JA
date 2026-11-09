-- Seed inicial do catálogo V2. Não sobrescreve preços/limites que já tenham
-- sido ajustados pelo administrador: conflitos por ID ou código são ignorados.
INSERT INTO public.planos (
  id, codigo, nome, descricao, modelo, percentual, taxa_fixa_pix,
  mensalidade, dias_trial, ordem, ativo, participacoes_incluidas,
  valor_excedente, limite_eventos_ciclo, limite_pessoas_evento,
  limite_clt, limite_supervisores, retencao_evidencias_dias,
  aviso_vendas_acima, recursos
) VALUES
(
  '11111111-1111-4111-8111-111111111111', 'free', 'Plano Gratuito (7 dias)',
  'Acesso completo durante 7 dias para testar todas as funcionalidades de gestão, ponto digital e pagamentos.',
  'assinatura_percentual', 0, 0, 0, 7, 1, true, 20, 2.50, 5, 30, 2, 2, 30, NULL,
  '{"fechamento":true,"financeiro":true,"relatorios_avancados":true,"importacao_excel":true}'::jsonb
),
(
  '22222222-2222-4222-8222-222222222222', 'starter', 'Starter',
  'Para agências em expansão com foco em operações pontuais e equipes sob demanda.',
  'assinatura_percentual', 0, 0, 99, 0, 2, true, 50, 2.00, 15, 50, 5, 3, 30, NULL,
  '{"fechamento":true,"financeiro":true,"relatorios_avancados":true,"importacao_excel":true}'::jsonb
),
(
  '33333333-3333-4333-8333-333333333333', 'pro', 'Profissional',
  'Para agências consolidadas com alto volume de escalas, eventos semanais e equipe.',
  'assinatura_percentual', 0, 0, 199, 0, 3, true, 150, 1.50, NULL, NULL, 20, 10, 30, NULL,
  '{"fechamento":true,"financeiro":true,"agendamento_pix":true,"pix_massa":true,"relatorios_avancados":true,"exportacao_avancada":true,"importacao_excel":true,"suporte_prioritario":true}'::jsonb
),
(
  '44444444-4444-4444-8444-444444444444', 'enterprise', 'Corporativo',
  'Estrutura completa, franquia ampla, API aberta e atendimento preferencial.',
  'assinatura_percentual', 0, 0, 399, 0, 4, true, 400, 1.20, NULL, NULL, NULL, NULL, 30, NULL,
  '{"fechamento":true,"financeiro":true,"agendamento_pix":true,"pix_massa":true,"relatorios_avancados":true,"exportacao_avancada":true,"importacao_excel":true,"api":true,"suporte_prioritario":true}'::jsonb
)
ON CONFLICT DO NOTHING;

-- Organizações antigas sem assinatura não recebem acesso gratuito ilimitado.
-- São vinculadas ao plano Free, mas bloqueadas até a seleção explícita de um plano.
INSERT INTO public.assinaturas (
  empresa_id, plano_id, status, trial_ate, inicio_ciclo, observacoes
)
SELECT
  e.id,
  p.id,
  'bloqueada',
  NULL,
  e.criado_em,
  'Assinatura criada na migração Billing V2; aguardando seleção explícita de plano.'
FROM public.empresas e
CROSS JOIN public.planos p
WHERE p.codigo = 'free'
  AND NOT EXISTS (
    SELECT 1
    FROM public.assinaturas a
    WHERE a.empresa_id = e.id
  );

-- Agenda a expiração de evidências antigas que ainda não tinham prazo.
-- Usa a menor retenção entre a configuração da agência e o plano vigente.
UPDATE public.pontos pt
SET evidencia_expira_em = pt.registrado_em
  + make_interval(days => LEAST(
      COALESCE(cfg.selfie_retencao_dias, 90),
      COALESCE(pl.retencao_evidencias_dias, 365)
    )),
    selfie_expira_em = CASE
      WHEN pt.foto_url IS NOT NULL THEN pt.registrado_em
        + make_interval(days => LEAST(
            COALESCE(cfg.selfie_retencao_dias, 90),
            COALESCE(pl.retencao_evidencias_dias, 365)
          ))
      ELSE NULL
    END
FROM public.escalas s
JOIN public.equipes eq ON eq.id = s.equipe_id
JOIN public.eventos ev ON ev.id = eq.evento_id
LEFT JOIN public.configuracoes cfg ON cfg.empresa_id = ev.empresa_id
LEFT JOIN public.assinaturas a ON a.empresa_id = ev.empresa_id
LEFT JOIN public.planos pl ON pl.id = a.plano_id
WHERE pt.escala_id = s.id
  AND (pt.foto_url IS NOT NULL OR pt.gps_lat IS NOT NULL OR pt.gps_lng IS NOT NULL);

