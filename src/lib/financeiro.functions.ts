/**
 * Cobrança ao cliente do evento e Pix de saída ao freelancer.
 * O preço da plataforma Já vem do plano da agência (função preco_efetivo),
 * nunca de valores editáveis pela própria agência.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireOrganizationContext } from "@/lib/autorizacao.server";

const cobrancaSchema = z.object({
  clienteId: z.string().uuid(),
  eventoId: z.string().uuid().nullable().optional(),
  valor: z.number().positive().max(1_000_000),
  forma: z.enum(["pix", "boleto", "cartao"]),
  vencimento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  descricao: z.string().min(3).max(200),
});

const pagamentoSchema = z.object({ fechamentoId: z.string().uuid() });
const agendamentoSchema = z.object({
  pagamentoIds: z.array(z.string().uuid()).min(1).max(100),
  dataAgendada: z.string().datetime(),
});

/** Cria a cobrança do cliente do evento no Asaas, com split da taxa. */
export const criarCobranca = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => cobrancaSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    requireOrganizationContext(context);

    const { exigirCapacidade } = await import("./autorizacao.server");
    await exigirCapacidade(supabase, userId, "financeiro.gerenciar");

    const { data: usuario } = await supabase
      .from("usuarios")
      .select("empresa_id")
      .eq("id", userId)
      .maybeSingle();
    const empresaId = usuario?.empresa_id;
    if (!empresaId) throw new Error("Usuário sem agência.");

    const { data: cliente } = await supabase
      .from("clientes")
      .select("id, nome, cpf_cnpj, email, telefone, empresa_id")
      .eq("id", data.clienteId)
      .maybeSingle();
    if (!cliente) throw new Error("Cliente não encontrado.");
    if (cliente.empresa_id !== empresaId) throw new Error("Cliente não pertence à sua agência.");
    if (!cliente.cpf_cnpj) throw new Error("Cadastre o CPF/CNPJ do cliente antes de cobrar.");

    if (data.eventoId) {
      const { data: evento } = await supabase
        .from("eventos")
        .select("id, empresa_id")
        .eq("id", data.eventoId)
        .maybeSingle();
      if (!evento) throw new Error("Evento não encontrado.");
      if (evento.empresa_id !== empresaId) throw new Error("Evento não pertence à sua agência.");
    }

    const documentoLimpo = cliente.cpf_cnpj.replace(/\D+/g, "");
    if (documentoLimpo.length !== 11 && documentoLimpo.length !== 14)
      throw new Error("CPF/CNPJ inválido para emitir a cobrança.");

    const { exigirRecursoPlano } = await import("./plano.server");
    await exigirRecursoPlano(supabase, empresaId, "financeiro");

    const { data: registro, error: erroInsert } = await supabase
      .from("cobrancas")
      .insert({
        empresa_id: empresaId,
        tipo: "cobranca_cliente",
        cliente_id: cliente.id,
        evento_id: data.eventoId ?? null,
        descricao: data.descricao,
        valor: data.valor,
        forma: data.forma,
        vencimento: data.vencimento,
        status: "rascunho",
      })
      .select("id")
      .single();
    if (erroInsert || !registro) throw new Error(erroInsert?.message ?? "Falha ao registrar.");

    try {
      const { garantirClienteAsaas, criarCobrancaAsaas, obterPixCopiaCola } =
        await import("./asaas.server");
      const clienteAsaasId = await garantirClienteAsaas({
        nome: cliente.nome,
        cpfCnpj: documentoLimpo,
        email: cliente.email,
        telefone: cliente.telefone,
        referenciaExterna: cliente.id,
      });

      await supabase
        .from("clientes")
        .update({ parceiro_cliente_id: clienteAsaasId })
        .eq("id", cliente.id);

      const cobranca = await criarCobrancaAsaas({
        clienteAsaasId,
        valor: data.valor,
        forma: data.forma,
        vencimento: data.vencimento,
        descricao: data.descricao,
        referenciaExterna: registro.id,
      });

      const pix = data.forma === "pix" ? await obterPixCopiaCola(cobranca.id) : null;

      await supabase
        .from("cobrancas")
        .update({
          status: "aguardando_pagamento",
          parceiro_cobranca_id: cobranca.id,
          link_pagamento: cobranca.invoiceUrl ?? cobranca.bankSlipUrl ?? null,
          pix_copia_cola: pix,
        })
        .eq("id", registro.id);

      return { id: registro.id, link: cobranca.invoiceUrl ?? null, pix };
    } catch (e) {
      const mensagem = e instanceof Error ? e.message : "Falha no parceiro de pagamento.";
      await supabase.from("cobrancas").update({ erro: mensagem }).eq("id", registro.id);
      throw new Error(mensagem);
    }
  });

/** Consulta o Asaas e liquida a cobrança e o saldo em uma única transação. */
export const sincronizarCobranca = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    requireOrganizationContext(context);
    const { exigirCapacidade } = await import("./autorizacao.server");
    await exigirCapacidade(supabase, userId, "financeiro.gerenciar");
    const contextoEmpresa = requireOrganizationContext(context);
    const { data: cobranca, error: erroCobranca } = await supabase
      .from("cobrancas")
      .select("id, empresa_id, valor, status, parceiro_cobranca_id")
      .eq("id", data.id)
      .maybeSingle();
    if (erroCobranca || !cobranca) throw new Error("Cobrança não encontrada.");
    if (cobranca.empresa_id !== contextoEmpresa.empresaId) {
      throw new Error("Cobrança não pertence à sua agência.");
    }
    if (!cobranca.parceiro_cobranca_id) throw new Error("Cobrança sem registro no parceiro.");

    const { obterCobrancaAsaas } = await import("./asaas.server");
    const remota = await obterCobrancaAsaas(cobranca.parceiro_cobranca_id);
    if (
      remota.id !== cobranca.parceiro_cobranca_id ||
      remota.externalReference !== cobranca.id ||
      !Number.isFinite(Number(remota.value)) ||
      Math.abs(Number(remota.value) - Number(cobranca.valor)) >= 0.005
    ) {
      throw new Error("Cobrança do Asaas não corresponde ao registro ou ao valor esperado.");
    }

    // CONFIRMED significa pagamento efetuado, mas não necessariamente saldo disponível.
    if (!["RECEIVED", "RECEIVED_IN_CASH"].includes(remota.status)) {
      return { status: remota.status };
    }

    const { supabaseAdmin, hasAdminKey } = await import("@/integrations/supabase/client.server");
    if (!hasAdminKey()) throw new Error("Configuração administrativa do Supabase ausente.");
    const { data: resultado, error } = await (supabaseAdmin.rpc as any)(
      "liquidar_cobranca_funding_asaas",
      {
        _cobranca_id: cobranca.id,
        _parceiro_id: remota.id,
        _valor: Number(remota.value),
      },
    );
    if (error || !resultado?.ok) {
      throw new Error("Não foi possível liquidar a cobrança e o crédito de saldo atomicamente.");
    }

    return {
      status: "pago" as const,
      jaProcessada: Boolean(resultado.ja_processada),
      cobrancaDuplicada: Boolean(resultado.cobranca_duplicada),
    };
  });


/** Envia o Pix ao freelancer contra o saldo da agência. */
export const executarPagamentoPix = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ pagamentoId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const contextoEmpresa = requireOrganizationContext(context);
    const { exigirCapacidade } = await import("./autorizacao.server");
    await exigirCapacidade(context.supabase, context.userId, "financeiro.gerenciar");
    const { resolverEmpresaDoPagamento, enviarPix } = await import("./pagamentos.server");
    const empresaId = await resolverEmpresaDoPagamento(context.supabase, data.pagamentoId);
    if (empresaId !== contextoEmpresa.empresaId) {
      throw new Error("Pagamento não pertence à sua agência.");
    }
    return enviarPix(context.supabase, data.pagamentoId, empresaId);
  });

/** Gera o pagamento exclusivamente do valor aprovado no fechamento. */
export const gerarPagamento = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => pagamentoSchema.parse(input))
  .handler(async ({ data, context }) => {
    const organizacao = requireOrganizationContext(context);
    const { exigirCapacidade } = await import("./autorizacao.server");
    await exigirCapacidade(context.supabase, context.userId, "financeiro.gerenciar");

    const { data: fechamento } = await context.supabase
      .from("fechamentos")
      .select("id, valor_calculado, status, escala_id")
      .eq("id", data.fechamentoId)
      .maybeSingle();
    if (!fechamento) throw new Error("Fechamento não encontrado.");
    if (fechamento.status !== "aprovado") throw new Error("Aprove o fechamento antes de pagar.");

    const { data: existente } = await context.supabase
      .from("pagamentos")
      .select("id")
      .eq("fechamento_id", fechamento.id)
      .maybeSingle();
    if (existente) throw new Error("Já existe pagamento para este fechamento.");

    const valor = Number(fechamento.valor_calculado);
    if (!Number.isFinite(valor) || valor < 0.01) {
      throw new Error("O fechamento precisa ter valor mínimo de R$ 0,01 antes do pagamento.");
    }

    const { data: empresaId, error: erroEmpresa } = await context.supabase.rpc(
      "empresa_da_escala",
      { _escala_id: fechamento.escala_id },
    );
    if (erroEmpresa || empresaId !== organizacao.empresaId) {
      throw new Error("Fechamento não pertence à sua agência.");
    }

    const { data: pagamento, error } = await context.supabase
      .from("pagamentos")
      .insert({
        fechamento_id: fechamento.id,
        valor,
        status: "pendente",
        chave_idempotencia: crypto.randomUUID(),
      })
      .select("id")
      .single();
    if (error || !pagamento) throw new Error(error?.message ?? "Falha ao gerar pagamento.");

    return { id: pagamento.id, valor };
  });

export const agendarPagamentos = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => agendamentoSchema.parse(input))
  .handler(async ({ data, context }) => {
    const organizacao = requireOrganizationContext(context);
    const { exigirCapacidade } = await import("./autorizacao.server");
    await exigirCapacidade(context.supabase, context.userId, "financeiro.gerenciar");
    const { exigirRecursoPlano } = await import("./plano.server");
    if (!organizacao.empresaId) throw new Error("Agência não encontrada.");
    await exigirRecursoPlano(context.supabase, organizacao.empresaId, "agendamento_pix");
    if (data.pagamentoIds.length > 1)
      await exigirRecursoPlano(context.supabase, organizacao.empresaId, "pix_massa");
    const quando = new Date(data.dataAgendada);
    if (Number.isNaN(quando.getTime()) || quando <= new Date()) {
      throw new Error("Escolha uma data futura para os pagamentos.");
    }

    const { resolverEmpresaDoPagamento } = await import("./pagamentos.server");
    for (const id of data.pagamentoIds) {
      const empresaId = await resolverEmpresaDoPagamento(context.supabase, id);
      if (empresaId !== organizacao.empresaId) throw new Error("Pagamento fora da sua agência.");
    }

    const { error } = await context.supabase
      .from("pagamentos")
      .update({ status: "agendado", data_agendada: quando.toISOString() })
      .in("id", data.pagamentoIds)
      .eq("status", "pendente")
      .gte("valor", 0.01);
    if (error) throw error;
    return { quantidade: data.pagamentoIds.length };
  });

export const reabrirPagamentoFalho = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ pagamentoId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const organizacao = requireOrganizationContext(context);
    const { exigirCapacidade } = await import("./autorizacao.server");
    await exigirCapacidade(context.supabase, context.userId, "financeiro.gerenciar");
    const { resolverEmpresaDoPagamento } = await import("./pagamentos.server");
    const empresaId = await resolverEmpresaDoPagamento(context.supabase, data.pagamentoId);
    if (empresaId !== organizacao.empresaId) throw new Error("Pagamento fora da sua agência.");

    const { data: atual } = await context.supabase
      .from("pagamentos")
      .select("status, tentativas, valor")
      .eq("id", data.pagamentoId)
      .maybeSingle();
    if (!atual || atual.status !== "falhou") throw new Error("Pagamento não está em falha.");
    if (Number(atual.valor) < 0.01)
      throw new Error("Corrija o fechamento antes de tentar novamente.");

    const { error } = await context.supabase
      .from("pagamentos")
      .update({ status: "pendente", erro: null, tentativas: atual.tentativas + 1 })
      .eq("id", data.pagamentoId)
      .eq("status", "falhou");
    if (error) throw error;
    return { ok: true };
  });
