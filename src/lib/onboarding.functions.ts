import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { calcularDataFimTrial, DIAS_TRIAL_PADRAO, PLANOS_CATALOGO } from "@/lib/planos-catalogo";

const concluirOnboardingSchema = z.object({
  nomeEmpresa: z.string().trim().min(2, "Nome da agência deve ter no mínimo 2 caracteres"),
  cnpj: z.string().trim().min(11, "Documento deve ter pelo menos 11 dígitos"),
  planoCodigo: z.string().default("free"),
  planoId: z.string().optional(),
});

export const concluirCadastroComEmpresaEPlano = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => concluirOnboardingSchema.parse(input))
  .handler(async ({ data, context }) => {
    const client = context.supabase;
    const { getAdminClientSafe } = await import("@/integrations/supabase/client.server");
    const admin = getAdminClientSafe();
    const db = admin || client;
    const userId = context.userId;

    const cnpjLimpo = data.cnpj.replace(/\D+/g, "");

    // 1. Garante que o registro do usuário exista
    const { data: usuarioAuth } = await client.auth.getUser();
    const userEmail = usuarioAuth?.user?.email || "";
    const userNome =
      ((usuarioAuth?.user?.user_metadata as Record<string, unknown> | undefined)?.[
        "nome"
      ] as string) || data.nomeEmpresa;

    await db.from("usuarios").upsert({
      id: userId,
      email: userEmail,
      nome: userNome,
      ativo: true,
    });

    // 2. Cria a empresa pelo RPC oficial se o usuário ainda não tiver uma
    let empresaId: string | null = null;
    const { data: userRow } = await db
      .from("usuarios")
      .select("empresa_id")
      .eq("id", userId)
      .maybeSingle();

    if (userRow?.empresa_id) {
      empresaId = userRow.empresa_id;
    } else {
      const { data: novaEmpresaId, error: erroCriar } = await client.rpc("criar_empresa", {
        _nome: data.nomeEmpresa.trim(),
        _cnpj: cnpjLimpo,
      });

      if (erroCriar) {
        throw new Error(`Falha ao cadastrar a agência: ${erroCriar.message}`);
      }
      empresaId = novaEmpresaId;
    }

    if (!empresaId) {
      throw new Error("Não foi possível identificar a agência criada.");
    }

    // 3. Identifica plano escolhido
    const planoEscolhido =
      PLANOS_CATALOGO.find(
        (p) => p.id === data.planoId || p.codigo === data.planoCodigo,
      ) || PLANOS_CATALOGO[0]!;

    const ehGratuito = planoEscolhido.codigo === "free" || planoEscolhido.mensalidade === 0;

    // 4. Cria ou atualiza assinatura. O trial não pode ser reiniciado ao
    // repetir o onboarding ou selecionar novamente o plano gratuito.
    const { data: assinaturaExistente, error: erroConsultaAssinatura } = await db
      .from("assinaturas")
      .select("id, trial_ate")
      .eq("empresa_id", empresaId)
      .maybeSingle();

    if (erroConsultaAssinatura) {
      throw new Error("Não foi possível consultar a assinatura atual da agência.");
    }

    const trialAte = ehGratuito
      ? assinaturaExistente
        ? assinaturaExistente.trial_ate
        : calcularDataFimTrial(DIAS_TRIAL_PADRAO)
      : null;

    const dadosAssinatura = {
      plano_id: planoEscolhido.id,
      status: ehGratuito ? "trial" : "pendente",
      trial_ate: trialAte,
      observacoes: ehGratuito
        ? `Plano gratuito com ${DIAS_TRIAL_PADRAO} dias de teste completo.`
        : `Plano ${planoEscolhido.nome} selecionado no cadastro.`,
      atualizado_em: new Date().toISOString(),
    };

    if (assinaturaExistente) {
      const { error } = await db
        .from("assinaturas")
        .update(dadosAssinatura)
        .eq("id", assinaturaExistente.id);
      if (error) throw new Error("Não foi possível atualizar a assinatura da agência.");
    } else {
      const { error } = await db.from("assinaturas").insert({
        empresa_id: empresaId,
        ...dadosAssinatura,
        inicio_ciclo: new Date().toISOString(),
      });
      if (error) throw new Error("Não foi possível criar a assinatura da agência.");
    }

    // 5. Tenta abrir ciclo de cobrança inicial
    try {
      await client.rpc("abrir_ciclo_cobranca", { _empresa_id: empresaId });
    } catch {
      // ciclo será aberto no primeiro acesso se necessário
    }

    // 6. Auditoria
    try {
      await db.from("logs_auditoria").insert({
        empresa_id: empresaId,
        ator_id: userId,
        ator_contexto: "organizacao",
        acao: "onboarding_concluido",
        recurso_tipo: "empresa",
        recurso_id: empresaId,
        resultado: "sucesso",
        detalhes: {
          nome: data.nomeEmpresa,
          plano: planoEscolhido.nome,
          ehGratuito,
          diasTrial: ehGratuito ? DIAS_TRIAL_PADRAO : 0,
          trialAte,
        },
      });
    } catch {
      // prossegue
    }

    return {
      sucesso: true,
      empresaId,
      planoCodigo: planoEscolhido.codigo,
      planoNome: planoEscolhido.nome,
      trialAte,
    };
  });
