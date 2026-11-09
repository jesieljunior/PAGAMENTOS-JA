-- Preserva o histórico usado no cálculo de participações faturáveis.
-- Excluir evento ou freelancer não pode apagar silenciosamente o consumo do ciclo.
ALTER TABLE public.participacoes_operacionais
  DROP CONSTRAINT IF EXISTS participacoes_operacionais_evento_id_fkey,
  DROP CONSTRAINT IF EXISTS participacoes_operacionais_freelancer_id_fkey;

ALTER TABLE public.participacoes_operacionais
  ADD CONSTRAINT participacoes_operacionais_evento_id_fkey
    FOREIGN KEY (evento_id) REFERENCES public.eventos(id) ON DELETE RESTRICT,
  ADD CONSTRAINT participacoes_operacionais_freelancer_id_fkey
    FOREIGN KEY (freelancer_id) REFERENCES public.freelancers(id) ON DELETE RESTRICT;

-- O histórico de alterações de planos é trilha de auditoria; exclusão de plano
-- não deve remover os snapshots de antes/depois.
ALTER TABLE public.planos_historico
  DROP CONSTRAINT IF EXISTS planos_historico_plano_id_fkey;

ALTER TABLE public.planos_historico
  ADD CONSTRAINT planos_historico_plano_id_fkey
    FOREIGN KEY (plano_id) REFERENCES public.planos(id) ON DELETE RESTRICT;
