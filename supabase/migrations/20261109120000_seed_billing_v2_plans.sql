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
