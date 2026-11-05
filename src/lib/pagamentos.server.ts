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
    if (Number(saldo ?? 0) < valor)
      throw new Error(
        `Saldo insuficiente: disponível R$ ${Number(saldo ?? 0).toFixed(2)}, necessário R$ ${valor.toFixed(2)}. Adicione saldo para continuar.`,
      );

    // 1. Bloqueio atômico de concorrência antes de chamar o parceiro Asaas
    let travaAdquirida = false;
    try {
      const { data: rpcTrava, error: errRpcTrava } = await supabase.rpc(
        "iniciar_processamento_pagamento_pix",
        { _pagamento_id: pagamento.id },
      );
      if (!errRpcTrava && rpcTrava && typeof rpcTrava === "object") {
        if (!rpcTrava.ok) {
          throw new Error(rpcTrava.erro || "Pagamento já em processamento.");
        }
        travaAdquirida = true;
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

    if (!travaAdquirida) {
      const { data: pagamentoLock, error: errLock } = await supabase
        .from("pagamentos")
        .update({
          status: "processando",
          atualizado_em: new Date().toISOString(),
        })
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

    const { transferirPix } = await import("./asaas.server");
    const transferencia = await transferirPix({
      valor,
      chavePix,
      descricao: `Já — ${freelancer?.nome ?? "freelancer"} · ${evento?.nome ?? "evento"}`,
      referenciaExterna: pagamento.id,
      chaveIdempotencia: pagamento.chave_idempotencia,
    });

    // Avalia se o status retornado pelo Asaas é terminal ou intermediário
    const statusAsaas = (transferencia.status ?? "").toUpperCase();
    let statusFinal: "executado" | "processando" | "aguardando_aprovacao" | "pendente" =
      "processando";
    let executadoEm: string | null = null;
    let erroMsg: string | null = null;

    if (statusAsaas === "DONE" || statusAsaas === "CONFIRMED") {
      statusFinal = "executado";
      executadoEm = new Date().toISOString();
    } else if (statusAsaas === "AWAITING_CRITICAL_ACTION_AUTHORIZATION") {
      statusFinal = "aguardando_aprovacao";
      erroMsg = "Aguardando autorização de segurança 2FA no Asaas.";
    } else {
      // PENDING, BANK_PROCESSING, etc.
      statusFinal = "processando";
    }

    const descricaoDebito = `Pix para ${freelancer?.nome ?? "freelancer"}`;

    // 2. Efetivação transacional atômica via RPC no PostgreSQL
    let efetivadoViaRpc = false;
    try {
      const { data: resEfetivacao, error: errEfetivacao } = await supabase.rpc(
        "efetivar_pagamento_pix_db",
        {
          _pagamento_id: pagamento.id,
          _empresa_id: empresaDestino,
          _status_final: statusFinal,
          _txid: transferencia.id ?? null,
          _executado_em: executadoEm,
          _erro: erroMsg,
          _chave_pix: chavePix,
          _descricao_debito: descricaoDebito,
        },
      );
      if (errEfetivacao) {
        throw new Error(errEfetivacao.message);
      }
      if (resEfetivacao && typeof resEfetivacao === "object") {
        if (!resEfetivacao.ok) {
          throw new Error(resEfetivacao.erro || "Falha na liquidação contábil transacional.");
        }
        efetivadoViaRpc = true;
      }
    } catch (e) {
      if (
        e instanceof Error &&
        !e.message.includes("function") &&
        !e.message.includes("does not exist")
      ) {
        console.error("[pagamentos] Erro crítico na liquidação transacional atômica:", e);
        await supabase
          .from("pagamentos")
          .update({
            erro: `Atenção crítica: Transferência criada no parceiro (${transferencia.id}), mas falhou na liquidação contábil transacional: ${e.message}`,
          })
          .eq("id", pagamento.id);
        throw e;
      }
    }

    if (!efetivadoViaRpc) {
      // Fail closed: não permite split-write inconsistente
      throw new Error(
        `Falha crítica na efetivação contábil do pagamento: a função RPC transacional não está disponível ou falhou. Transferência Asaas: ${transferencia.id}`,
      );
    }

    return {
      ok: true,
      txid: transferencia.id as string,
      status: statusFinal,
      taxa: 0,
    };
  } catch (e) {
    const mensagem = e instanceof Error ? e.message : "Falha ao enviar o Pix.";
    await supabase
      .from("pagamentos")
      .update({ status: "falhou", erro: mensagem })
      .eq("id", pagamento.id);
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
