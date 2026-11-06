/**
 * Núcleo do Pix de saída ao freelancer sem taxa percentual da Já.
 * Recebe o cliente Supabase de fora para servir tanto a agência (RLS do
 * usuário) quanto o suporte da plataforma (cliente administrativo).
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

async function exigirCadastroFiscalValidado(supabase: any, empresaId: string) {
  const { data, error } = await supabase.rpc("empresa_fiscal_validada", { _empresa_id: empresaId });
  if (error || !data)
    throw new Error("Pix bloqueado: complete e aguarde a validação fiscal da agência.");
}

/** Resolve a empresa do pagamento seguindo a cadeia de dependência do pagamento. */
export async function resolverEmpresaDoPagamento(
  supabase: any,
  pagamentoId: string,
): Promise<string> {
  const { data: pagamento } = await supabase
    .from("pagamentos")
    .select("id, fechamento_id")
    .eq("id", pagamentoId)
    .maybeSingle();
  if (!pagamento) throw new Error("Pagamento não encontrado.");

  const { data: fechamento } = await supabase
    .from("fechamentos")
    .select("id, escala_id")
    .eq("id", pagamento.fechamento_id)
    .maybeSingle();
  if (!fechamento) throw new Error("Fechamento do pagamento não encontrado.");

  const { data: escala } = await supabase
    .from("escalas")
    .select("id, equipe_id")
    .eq("id", fechamento.escala_id)
    .maybeSingle();
  if (!escala) throw new Error("Escala do pagamento não encontrada.");

  const { data: equipe } = await supabase
    .from("equipes")
    .select("id, evento_id")
    .eq("id", escala.equipe_id)
    .maybeSingle();
  if (!equipe) throw new Error("Equipe do pagamento não encontrada.");

  const { data: evento } = await supabase
    .from("eventos")
    .select("id, empresa_id")
    .eq("id", equipe.evento_id)
    .maybeSingle();
  if (!evento?.empresa_id) throw new Error("Não foi possível identificar a agência do pagamento.");

  return evento.empresa_id as string;
}

/**
 * Só classifica erro HTTP 4xx do POST como falha definitiva quando o Asaas
 * ainda não retornou um ID de transferência. Depois de receber o ID, qualquer
 * falha de consulta/contabilização é inconclusiva e exige reconciliação.
 */
export function erroHttpAsaasEhDefinitivo(
  error: unknown,
  transferenciaId: string | null,
): boolean {
  if (transferenciaId || !(error instanceof Error) || !("status" in error)) {
    return false;
  }

  const statusHttp = Number((error as Error & { status?: number }).status);
  return statusHttp >= 400 && statusHttp < 500 && statusHttp !== 408 && statusHttp !== 429;
}

/** Valida saldo, envia o Pix, debita o saldo sem debitar receita SaaS. */
export async function enviarPix(supabase: any, pagamentoId: string, empresaId?: string | null) {
  const { data: pagamento } = await supabase
    .from("pagamentos")
    .select(
      "id, valor, status, fechamento_id, chave_idempotencia, fechamentos(escala_id, escalas(freelancers(nome, chave_pix), equipes(evento_id, eventos(nome, empresa_id))))",
    )
    .eq("id", pagamentoId)
    .maybeSingle();
  if (!pagamento) throw new Error("Pagamento não encontrado.");
  if (pagamento.status === "executado") throw new Error("Pagamento já executado.");
  if (pagamento.status === "processando")
    throw new Error("Pagamento já em processamento pelo Asaas. Aguarde a confirmação.");

  const primeiro = <T>(v: T | T[] | null | undefined): T | null =>
    Array.isArray(v) ? (v[0] ?? null) : (v ?? null);

  const fechamento: any = primeiro(pagamento.fechamentos);
  const escala: any = primeiro(fechamento?.escalas);
  const freelancer: any = primeiro(escala?.freelancers);
  const equipe: any = primeiro(escala?.equipes);
  const evento: any = primeiro(equipe?.eventos);

  const chavePix: string | undefined = freelancer?.chave_pix;
  const empresaResolvida = empresaId ?? evento?.empresa_id ?? null;
  if (!chavePix) throw new Error("Freelancer sem chave Pix cadastrada.");
  if (!empresaResolvida) throw new Error("Não foi possível identificar a agência do pagamento.");

  if (evento?.empresa_id && empresaResolvida !== evento.empresa_id) {
    throw new Error("Pagamento vinculado a outra agência.");
  }

  const valor = Number(pagamento.valor);
  const empresaDestino = empresaResolvida;
  let travaAdquirida = false;
  let solicitacaoEnviada = false;
  let transferenciaId: string | null = null;
  let falhaDefinitiva = false;
  let mensagemErro = "Falha ao enviar o Pix.";

  try {
    if (!Number.isFinite(valor) || valor < 0.01) {
      throw new Error("Pagamento inválido: corrija o fechamento para um valor mínimo de R$ 0,01.");
    }
    const { exigirRecursoPlano } = await import("./plano.server");
    await exigirRecursoPlano(supabase, empresaDestino, "financeiro");
    if (pagamento.status === "agendado")
      await exigirRecursoPlano(supabase, empresaDestino, "agendamento_pix");
    await exigirCadastroFiscalValidado(supabase, empresaDestino);
    const { data: saldo } = await supabase.rpc("saldo_empresa", { _empresa_id: empresaDestino });
    if (Number(saldo ?? 0) < valor) {
      throw new Error(
        `Saldo insuficiente: disponível R$ ${Number(saldo ?? 0).toFixed(2)}, necessário R$ ${valor.toFixed(2)}. Adicione saldo para continuar.`,
      );
    }

    // O backend precisa ter service_role antes de iniciar qualquer transferência.
    // A RPC que efetiva o débito não aceita mais JWT de usuário.
    const { supabaseAdmin, hasAdminKey } = await import("@/integrations/supabase/client.server");
    if (!hasAdminKey()) {
      throw new Error("Configuração administrativa do Supabase ausente; Pix não foi enviado.");
    }

    // 1. Bloqueio de concorrência ainda usa a sessão do usuário para validar tenant/capacidade.
    let travaRpcAdquirida = false;
    try {
      const { data: rpcTrava, error: errRpcTrava } = await supabase.rpc(
        "iniciar_processamento_pagamento_pix",
        { _pagamento_id: pagamento.id },
      );
      if (!errRpcTrava && rpcTrava && typeof rpcTrava === "object") {
        if (!rpcTrava.ok) throw new Error(rpcTrava.erro || "Pagamento já em processamento.");
        travaRpcAdquirida = true;
      }
    } catch (e) {
      if (
        e instanceof Error &&
        !e.message.includes("function") &&
        !e.message.includes("does not exist")
      ) {
        throw e;
      }
    }

    if (!travaRpcAdquirida) {
      const { data: pagamentoLock, error: errLock } = await supabase
        .from("pagamentos")
        .update({ status: "processando", atualizado_em: new Date().toISOString() })
        .eq("id", pagamento.id)
        .in("status", ["pendente", "agendado", "falhou"])
        .select("id")
        .maybeSingle();

      if (errLock || !pagamentoLock) {
        throw new Error(
          "Pagamento já está sendo processado por outra solicitação ou não está pendente.",
        );
      }
    }
    travaAdquirida = true;

    const { transferirPix, obterTransferenciaAsaas, AsaasError } = await import("./asaas.server");
    solicitacaoEnviada = true;
    const respostaCriacao = await transferirPix({
      valor,
      chavePix,
      descricao: `Já — ${freelancer?.nome ?? "freelancer"} · ${evento?.nome ?? "evento"}`,
      referenciaExterna: pagamento.id,
    });
    transferenciaId = respostaCriacao.id || null;
    if (!transferenciaId) {
      throw new Error(
        "Asaas aceitou a solicitação sem retornar o ID; resultado inconclusivo. Requer reconciliação.",
      );
    }

    // A resposta do POST não é confirmação final. Consultamos o estado atual uma única vez.
    const transferencia = await obterTransferenciaAsaas(transferenciaId);
    const valorAsaas = Number(transferencia.value);
    if (
      transferencia.id !== transferenciaId ||
      transferencia.externalReference !== pagamento.id ||
      !Number.isFinite(valorAsaas) ||
      Math.abs(valorAsaas - valor) >= 0.005
    ) {
      throw new Error(
        "Transferência retornada pelo Asaas não corresponde ao pagamento ou ao valor solicitado.",
      );
    }

    const statusAsaas = String(transferencia.status ?? "").toUpperCase();
    if (statusAsaas === "FAILED" || statusAsaas === "CANCELLED") {
      falhaDefinitiva = true;
      const motivo =
        transferencia.failReason ??
        (statusAsaas === "FAILED" ? "Pix recusado pelo Asaas." : "Pix cancelado no Asaas.");
      const { data: resultadoRpc, error: erroRpc } = await (supabaseAdmin.rpc as any)(
        "reverter_transferencia_pagamento_pix_seguro",
        {
          _pagamento_id: pagamento.id,
          _transferencia_id: transferenciaId,
          _status_final: "falhou",
          _motivo: motivo,
          _descricao_credito: "Devolução de saldo de Pix recusado ou cancelado",
        },
      );
      if (erroRpc || !resultadoRpc?.ok) {
        throw new Error(
          "Asaas recusou/cancelou o Pix, mas a atualização local requer reconciliação.",
        );
      }
      throw new AsaasError(motivo, 400);
    }

    let statusFinal: "executado" | "processando" | "aguardando_aprovacao" = "processando";
    let executadoEm: string | null = null;
    let erroMsg: string | null = null;
    if (statusAsaas === "DONE") {
      statusFinal = "executado";
      executadoEm = new Date().toISOString();
    } else if (statusAsaas === "AWAITING_CRITICAL_ACTION_AUTHORIZATION") {
      statusFinal = "aguardando_aprovacao";
      erroMsg = "Aguardando autorização de segurança 2FA no Asaas.";
    } else if (
      !["PENDING", "BANK_PROCESSING", "IN_BANK_PROCESSING", "BLOCKED"].includes(statusAsaas)
    ) {
      throw new Error(`Status de transferência Asaas não reconhecido: ${statusAsaas}`);
    }

    // 2. Efetivação contábil exclusivamente com service_role e dentro de uma transação.
    const { data: resultadoRpc, error: erroRpc } = await (supabaseAdmin.rpc as any)(
      "efetivar_pagamento_pix_db",
      {
        _pagamento_id: pagamento.id,
        _empresa_id: empresaDestino,
        _status_final: statusFinal,
        _txid: transferenciaId,
        _executado_em: executadoEm,
        _erro: erroMsg,
        _chave_pix: chavePix,
        _descricao_debito: `Pix para ${freelancer?.nome ?? "freelancer"}`,
        _valor: valorAsaas,
      },
    );
    if (erroRpc || !resultadoRpc?.ok) {
      throw new Error(
        `Transferência ${transferenciaId} existe no Asaas, mas a contabilização não foi concluída. Não reenvie; aguarde reconciliação. ${erroRpc?.message ?? resultadoRpc?.erro ?? ""}`,
      );
    }

    return {
      ok: true,
      txid: transferenciaId,
      status: statusFinal,
      taxa: 0,
    };
  } catch (e) {
    const mensagem = e instanceof Error ? e.message : mensagemErro;
    mensagemErro = mensagem;

    // Apenas um 4xx do POST sem ID de transferência permite retry.
    // Depois que o Asaas retorna um ID, qualquer falha local ou de consulta
    // exige reconciliação; não pode liberar um segundo envio.
    if (erroHttpAsaasEhDefinitivo(e, transferenciaId)) {
      falhaDefinitiva = true;
    }

    if (travaAdquirida) {
      try {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        if (falhaDefinitiva) {
          if (transferenciaId) {
            await (supabaseAdmin.rpc as any)("reverter_transferencia_pagamento_pix_seguro", {
              _pagamento_id: pagamento.id,
              _transferencia_id: transferenciaId,
              _status_final: "falhou",
              _motivo: mensagem,
              _descricao_credito: "Devolução de saldo de Pix recusado ou cancelado",
            });
          } else {
            await supabaseAdmin
              .from("pagamentos")
              .update({ status: "falhou", erro: mensagem, atualizado_em: new Date().toISOString() })
              .eq("id", pagamento.id)
              .eq("status", "processando");
          }
        } else if (solicitacaoEnviada) {
          // Não transforma resultado remoto incerto em falha definitiva.
          // A coluna de ID é preenchida quando o Asaas chegou a responder.
          const atualizacao: Record<string, unknown> = {
            erro: transferenciaId
              ? `Reconciliação necessária: transferência ${transferenciaId} existe no Asaas. ${mensagem}`
              : `Reconciliação necessária: resultado do POST ao Asaas inconclusivo. ${mensagem}`,
            atualizado_em: new Date().toISOString(),
          };
          if (transferenciaId) {
            atualizacao["txid_parceiro"] = transferenciaId;
            atualizacao["parceiro_transferencia_id"] = transferenciaId;
          }
          await supabaseAdmin
            .from("pagamentos")
            .update(atualizacao)
            .eq("id", pagamento.id)
            .eq("status", "processando");
        } else {
          // Erro ocorrido depois do lock, mas antes do POST: nenhum Pix foi solicitado.
          await supabaseAdmin
            .from("pagamentos")
            .update({ status: "falhou", erro: mensagem, atualizado_em: new Date().toISOString() })
            .eq("id", pagamento.id)
            .eq("status", "processando");
        }
      } catch (erroPersistencia) {
        console.error("[pagamentos] Falha ao persistir estado de reconciliação:", erroPersistencia);
      }
    }

    throw new Error(mensagem);
  }
}

/** Processa pagamentos agendados vencidos; o cron externo deve chamar esta função. */
export async function processarPagamentosAgendados(supabase: any, limite = 50) {
  const agora = new Date().toISOString();
  const { data: pagamentos, error } = await supabase
    .from("pagamentos")
    .select("id")
    .eq("status", "agendado")
    .not("data_agendada", "is", null)
    .lte("data_agendada", agora)
    .order("data_agendada", { ascending: true })
    .limit(limite);
  if (error) throw error;

  const resultados = { processados: 0, falhos: 0 };
  for (const pagamento of pagamentos ?? []) {
    try {
      await enviarPix(supabase, pagamento.id);
      resultados.processados += 1;
    } catch {
      resultados.falhos += 1;
    }
  }
  return resultados;
}
