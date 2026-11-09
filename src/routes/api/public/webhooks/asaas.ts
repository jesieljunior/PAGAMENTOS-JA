/**
 * Webhook do Asaas. Confirma cobranças pagas (credita o saldo da agência) e
 * o resultado das transferências Pix aos freelancers.
 *
 * O Asaas envia o cabeçalho `asaas-access-token` com o valor configurado no
 * painel; ele é a autenticação desta rota pública.
 */

import { createFileRoute } from "@tanstack/react-router";

import { gerarChaveWebhookAsaas, type EventoAsaasWebhook } from "@/lib/webhook-idempotencia";

type EventoAsaas = EventoAsaasWebhook;

const EVENTOS_FATURA_SAAS = new Set([
  "PAYMENT_RECEIVED",
  "PAYMENT_CONFIRMED",
  "PAYMENT_RECEIVED_IN_CASH",
]);
const EVENTOS_CREDITO_SALDO = new Set(["PAYMENT_RECEIVED", "PAYMENT_RECEIVED_IN_CASH"]);

type ResultadoRpcFinanceira = {
  ok?: boolean;
  ja_processada?: boolean;
  cobranca_duplicada?: boolean;
};

type ExecutarRpcFinanceira = (
  nome: string,
  args: Record<string, unknown>,
) => Promise<{
  data: ResultadoRpcFinanceira | null;
  error: { message: string } | null;
}>;

export const Route = createFileRoute("/api/public/webhooks/asaas")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const esperado = process.env["ASAAS_WEBHOOK_TOKEN"];
        const recebido = request.headers.get("asaas-access-token");
        if (!esperado || recebido !== esperado) {
          return new Response("Unauthorized", { status: 401 });
        }

        let corpo: EventoAsaas;
        try {
          corpo = (await request.json()) as EventoAsaas;
        } catch {
          return new Response("Bad Request", { status: 400 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const rpcFinanceira = supabaseAdmin.rpc.bind(
          supabaseAdmin,
        ) as unknown as ExecutarRpcFinanceira;
        const evento = corpo.event ?? "";
        const chaveIdempotencia = gerarChaveWebhookAsaas(corpo);

        // 1. Aquisição atômica da chave de idempotência no banco ANTES de qualquer efeito financeiro.
        let eventoExistente: {
          id: string;
          status: string;
          tentativas?: number | null;
          atualizado_em?: string | null;
        } | null = null;

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error: erroIdempotencia } = await (supabaseAdmin as any)
          .from("webhook_eventos")
          .insert({
            chave_idempotencia: chaveIdempotencia,
            evento: evento,
            payload: corpo,
            status: "processando",
            tentativas: 1,
          });

        if (erroIdempotencia) {
          // Erro 23505 = chave de idempotência já adquirida/processada
          if (erroIdempotencia.code === "23505") {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const { data: eventoDb, error: erroLeituraEvento } = await (supabaseAdmin as any)
              .from("webhook_eventos")
              .select("id, status, tentativas, atualizado_em")
              .eq("chave_idempotencia", chaveIdempotencia)
              .maybeSingle();

            if (erroLeituraEvento) {
              console.error("[webhook asaas] Falha ao recuperar evento existente:", erroLeituraEvento);
              return new Response("Falha ao recuperar evento existente", { status: 503 });
            }

            if (eventoDb) {
              eventoExistente = eventoDb;
            } else {
              return new Response("Evento duplicado sem registro recuperável", { status: 503 });
            }
          } else {
            console.error(
              "[webhook asaas] Erro ao registrar chave de idempotência:",
              erroIdempotencia,
            );
            return new Response("Erro interno de concorrência", { status: 500 });
          }
        }

        // Política de recuperação e retomada segura para eventos previamente registrados
        if (eventoExistente) {
          // Se já foi processado com sucesso, é terminal -> 200 OK
          if (eventoExistente.status === "processado") {
            return new Response("ok", { status: 200 });
          }

          const agoraMs = Date.now();
          const atualizadoMs = new Date(eventoExistente.atualizado_em || Date.now()).getTime();
          const timedOut = agoraMs - atualizadoMs > 5 * 60_000; // bloqueio preso há mais de 5 minutos
          const tentativas = eventoExistente.tentativas ?? 1;

          // Se falhou ou ficou preso em processando há muito tempo, retoma com limite de tentativas
          if (
            eventoExistente.status === "falhou" ||
            eventoExistente.status === "falha" ||
            timedOut
          ) {
            if (tentativas >= 5) {
              console.error(
                `[webhook asaas] Evento ${chaveIdempotencia} atingiu o limite de ${tentativas} tentativas. Registrando para reconciliação manual.`,
              );
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              await (supabaseAdmin as any)
                .from("webhook_eventos")
                .update({
                  status: "falhou",
                  erro: `Limite de tentativas excedido (${tentativas}). Requer reconciliação manual.`,
                  atualizado_em: new Date().toISOString(),
                })
                .eq("id", eventoExistente.id);
              return new Response(
                "Limite de tentativas excedido para o evento. Requer reconciliação manual.",
                { status: 500 },
              );
            }

            // Compare-And-Swap: status + contador impedem duas instâncias de retomarem a mesma tentativa.
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            let casQuery = (supabaseAdmin as any)
              .from("webhook_eventos")
              .update({
                status: "processando",
                tentativas: tentativas + 1,
                atualizado_em: new Date().toISOString(),
              })
              .eq("id", eventoExistente.id)
              .eq("status", eventoExistente.status);

            casQuery =
              eventoExistente.tentativas == null
                ? casQuery.is("tentativas", null)
                : casQuery.eq("tentativas", tentativas);

            const { data: casUpdate, error: erroCas } = await casQuery.select("id");

            if (erroCas) {
              console.error("[webhook asaas] Falha ao adquirir retomada do evento:", erroCas);
              return new Response("Falha ao adquirir processamento do evento", { status: 503 });
            }

            if (!casUpdate || (Array.isArray(casUpdate) && casUpdate.length === 0)) {
              // Outra instância assumiu; não confirma entrega enquanto ela não concluir.
              return new Response("Evento já está sendo processado", {
                status: 503,
                headers: { "Retry-After": "10" },
              });
            }
          } else {
            // Outra instância ainda está processando. Resposta não-2xx mantém a retentativa do Asaas.
            return new Response("Evento em processamento", {
              status: 503,
              headers: { "Retry-After": "10" },
            });
          }
        }

        try {
          // 2. Liquidação da assinatura SaaS. PAYMENT_CONFIRMED pode validar a fatura,
          // mas não libera funding operacional antes de PAYMENT_RECEIVED.
          if (
            EVENTOS_FATURA_SAAS.has(evento) &&
            (corpo.payment?.id || corpo.payment?.externalReference)
          ) {
            const faturaIdRef = corpo.payment.externalReference;
            const parceiroId = corpo.payment.id;
            if (!parceiroId) {
              throw new Error("Evento de pagamento SaaS sem identificador da cobrança Asaas.");
            }

            let faturaPlataforma: {
              id: string;
              status: string;
              total: number;
              empresa_id: string;
              referencia_provedor?: string | null;
            } | null = null;

            if (faturaIdRef) {
              const { data: f } = await supabaseAdmin
                .from("faturas_plataforma")
                .select("id, status, total, empresa_id, referencia_provedor")
                .eq("id", faturaIdRef)
                .maybeSingle();
              if (f) faturaPlataforma = f;
            }

            if (!faturaPlataforma) {
              const { data: f } = await supabaseAdmin
                .from("faturas_plataforma")
                .select("id, status, total, empresa_id, referencia_provedor")
                .eq("referencia_provedor", parceiroId)
                .maybeSingle();
              if (f) faturaPlataforma = f;
            }

            if (faturaPlataforma) {
              const { obterCobrancaAsaas } = await import("@/lib/asaas.server");
              const cobrancaVerificada = await obterCobrancaAsaas(parceiroId);
              const statusAceitos = new Set(["RECEIVED", "CONFIRMED", "RECEIVED_IN_CASH"]);
              const valorAsaas = Number(cobrancaVerificada.value);

              if (
                cobrancaVerificada.id !== parceiroId ||
                cobrancaVerificada.externalReference !== faturaPlataforma.id ||
                !statusAceitos.has(cobrancaVerificada.status) ||
                !Number.isFinite(valorAsaas) ||
                Math.abs(valorAsaas - Number(faturaPlataforma.total)) >= 0.005
              ) {
                throw new Error(
                  "Cobrança Asaas não corresponde à fatura, status ou valor integral esperado.",
                );
              }

              const { data: resultadoRpc, error: erroRpc } = await rpcFinanceira(
                "liquidar_fatura_plataforma_asaas",
                {
                  _fatura_id: faturaPlataforma.id,
                  _parceiro_id: parceiroId,
                  _valor: valorAsaas,
                },
              );
              if (erroRpc || !resultadoRpc?.ok) {
                throw new Error("Falha na liquidação atômica da fatura SaaS.");
              }
            }
          }

          // 2.1 Crédito operacional somente para pagamentos efetivamente recebidos;
          // PAYMENT_CONFIRMED isolado não disponibiliza saldo.
          if (EVENTOS_CREDITO_SALDO.has(evento) && corpo.payment?.id) {
            const parceiroId = corpo.payment.id;
            let cobrancaLocal: {
              id: string;
              empresa_id: string;
              valor: number;
              status: string;
              descricao: string;
              parceiro_cobranca_id: string | null;
            } | null = null;

            const { data: porParceiro } = await supabaseAdmin
              .from("cobrancas")
              .select("id, empresa_id, valor, status, descricao, parceiro_cobranca_id")
              .eq("parceiro_cobranca_id", parceiroId)
              .maybeSingle();
            if (porParceiro) cobrancaLocal = porParceiro;

            if (!cobrancaLocal && corpo.payment.externalReference) {
              const { data: porReferencia } = await supabaseAdmin
                .from("cobrancas")
                .select("id, empresa_id, valor, status, descricao, parceiro_cobranca_id")
                .eq("id", corpo.payment.externalReference)
                .maybeSingle();
              if (porReferencia) cobrancaLocal = porReferencia;
            }

            if (cobrancaLocal) {
              const { obterCobrancaAsaas } = await import("@/lib/asaas.server");
              const remota = await obterCobrancaAsaas(parceiroId);
              const valorAsaas = Number(remota.value);

              if (
                remota.id !== parceiroId ||
                remota.externalReference !== cobrancaLocal.id ||
                !["RECEIVED", "RECEIVED_IN_CASH"].includes(remota.status) ||
                !Number.isFinite(valorAsaas) ||
                Math.abs(valorAsaas - Number(cobrancaLocal.valor)) >= 0.005
              ) {
                throw new Error(
                  "Cobrança operacional não corresponde à referência, status ou valor esperado no Asaas.",
                );
              }

              if (
                cobrancaLocal.parceiro_cobranca_id &&
                cobrancaLocal.parceiro_cobranca_id !== parceiroId
              ) {
                const { error: erroLog } = await supabaseAdmin.from("logs_auditoria").insert({
                  empresa_id: cobrancaLocal.empresa_id,
                  ator_contexto: "sistema",
                  acao: "cobranca_operacional_duplicada",
                  recurso_tipo: "cobranca",
                  recurso_id: cobrancaLocal.id,
                  resultado: "falha",
                  detalhes: {
                    parceiro_original: cobrancaLocal.parceiro_cobranca_id,
                    parceiro_duplicado: parceiroId,
                    valor: valorAsaas,
                    externalReference: remota.externalReference,
                  },
                });
                if (erroLog) throw erroLog;
              } else {
                const { data: resultadoRpc, error: erroRpc } = await rpcFinanceira(
                  "liquidar_cobranca_funding_asaas",
                  {
                    _cobranca_id: cobrancaLocal.id,
                    _parceiro_id: parceiroId,
                    _valor: valorAsaas,
                  },
                );
                if (erroRpc || !resultadoRpc?.ok) {
                  throw new Error("Falha na liquidação transacional do crédito operacional.");
                }
              }
            }
          }

          if (evento === "PAYMENT_OVERDUE" && corpo.payment?.id) {
            const atualizacaoCobrancaVencida = { status: "vencido" };
            const { error: erroCobrancaPorParceiro } = await supabaseAdmin
              .from("cobrancas")
              .update(atualizacaoCobrancaVencida)
              .eq("parceiro_cobranca_id", corpo.payment.id)
              .in("status", ["rascunho", "aguardando_pagamento", "vencido"]);
            if (erroCobrancaPorParceiro) throw erroCobrancaPorParceiro;

            if (corpo.payment.externalReference) {
              const { error: erroCobrancaPorReferencia } = await supabaseAdmin
                .from("cobrancas")
                .update(atualizacaoCobrancaVencida)
                .eq("id", corpo.payment.externalReference)
                .in("status", ["rascunho", "aguardando_pagamento", "vencido"]);
              if (erroCobrancaPorReferencia) throw erroCobrancaPorReferencia;
            }

            // Atualiza também faturas SaaS ainda não liquidadas.
            const atualizacaoFatura = {
              status: "atrasada",
              atualizado_em: new Date().toISOString(),
            };

            // O ID da cobrança Asaas pode ainda não estar gravado na fatura
            // quando o evento de vencimento chegar. externalReference é o ID
            // local da fatura e permite localizar o registro sem ambiguidade.
            const { error: erroFaturaPorParceiro } = await supabaseAdmin
              .from("faturas_plataforma")
              .update(atualizacaoFatura)
              .eq("referencia_provedor", corpo.payment.id)
              .in("status", ["pendente", "atrasada"]);
            if (erroFaturaPorParceiro) throw erroFaturaPorParceiro;

            if (corpo.payment.externalReference) {
              const { error: erroFaturaPorReferencia } = await supabaseAdmin
                .from("faturas_plataforma")
                .update(atualizacaoFatura)
                .eq("id", corpo.payment.externalReference)
                .in("status", ["pendente", "atrasada"]);
              if (erroFaturaPorReferencia) throw erroFaturaPorReferencia;
            }
          }

          // 3. Eventos de transferência: a consulta pontual ao Asaas determina
          // o estado atual; a ordem dos webhooks não é considerada confiável.
          const EVENTOS_TRANSFERENCIA = new Set([
            "TRANSFER_CREATED",
            "TRANSFER_PENDING",
            "TRANSFER_IN_BANK_PROCESSING",
            "TRANSFER_BLOCKED",
            "TRANSFER_DONE",
            "TRANSFER_FAILED",
            "TRANSFER_CANCELLED",
          ]);

          if (EVENTOS_TRANSFERENCIA.has(evento) && corpo.transfer?.externalReference) {
            const pagamentoId = corpo.transfer.externalReference;
            const transferenciaId = corpo.transfer.id;
            if (!transferenciaId) {
              throw new Error("Evento de transferência sem identificador Asaas.");
            }

            const { data: pagamento, error: erroPagamento } = await supabaseAdmin
              .from("pagamentos")
              .select(
                "id, valor, status, chave_pix_destino, parceiro_transferencia_id, txid_parceiro",
              )
              .eq("id", pagamentoId)
              .maybeSingle();
            if (erroPagamento || !pagamento) {
              throw new Error("Pagamento relacionado à transferência não foi encontrado.");
            }

            const { obterTransferenciaAsaas } = await import("@/lib/asaas.server");
            const transferencia = await obterTransferenciaAsaas(transferenciaId);
            const valorTransferencia = Number(transferencia.value);

            if (
              transferencia.id !== transferenciaId ||
              transferencia.externalReference !== pagamentoId ||
              !Number.isFinite(valorTransferencia) ||
              Math.abs(valorTransferencia - Number(pagamento.valor)) >= 0.005
            ) {
              throw new Error(
                "Transferência Asaas não corresponde ao pagamento ou ao valor esperado.",
              );
            }

            const referenciaAnterior =
              pagamento.parceiro_transferencia_id ?? pagamento.txid_parceiro ?? null;
            if (referenciaAnterior && referenciaAnterior !== transferenciaId) {
              throw new Error("O pagamento já está vinculado a outra transferência Asaas.");
            }

            const statusTransferencia = String(transferencia.status ?? "").toUpperCase();
            if (statusTransferencia === "FAILED" || statusTransferencia === "CANCELLED") {
              const motivo =
                transferencia.failReason ??
                (statusTransferencia === "FAILED"
                  ? "Transferência recusada pelo Asaas."
                  : "Transferência cancelada no Asaas.");
              const { data: resultadoRpc, error: erroRpc } = await rpcFinanceira(
                "reverter_transferencia_pagamento_pix_seguro",
                {
                  _pagamento_id: pagamentoId,
                  _transferencia_id: transferenciaId,
                  _status_final: "falhou",
                  _motivo: motivo,
                  _descricao_credito: "Devolução de saldo de Pix recusado ou cancelado",
                },
              );
              if (erroRpc || !resultadoRpc?.ok) {
                throw new Error("Falha na reversão transacional do pagamento Pix.");
              }
            } else {
              let statusFinal: "executado" | "processando" | "aguardando_aprovacao";
              if (statusTransferencia === "DONE") {
                statusFinal = "executado";
              } else if (statusTransferencia === "AWAITING_CRITICAL_ACTION_AUTHORIZATION") {
                statusFinal = "aguardando_aprovacao";
              } else if (
                ["PENDING", "BANK_PROCESSING", "IN_BANK_PROCESSING", "BLOCKED"].includes(
                  statusTransferencia,
                )
              ) {
                statusFinal = "processando";
              } else {
                throw new Error(
                  `Status de transferência Asaas não reconhecido: ${statusTransferencia}`,
                );
              }

              const { data: resultadoRpc, error: erroRpc } = await rpcFinanceira(
                "efetivar_pagamento_pix_db",
                {
                  _pagamento_id: pagamentoId,
                  _empresa_id: null,
                  _status_final: statusFinal,
                  _txid: transferenciaId,
                  _executado_em: statusFinal === "executado" ? new Date().toISOString() : null,
                  _erro:
                    statusFinal === "aguardando_aprovacao"
                      ? "Aguardando autorização de segurança no Asaas."
                      : null,
                  _chave_pix: pagamento.chave_pix_destino,
                  _descricao_debito: "Pix para freelancer",
                  _valor: valorTransferencia,
                },
              );
              if (erroRpc || !resultadoRpc?.ok) {
                throw new Error("Falha na efetivação transacional do pagamento Pix.");
              }
            }
          }

          // 5. Só confirma HTTP 200 depois de persistir o estado terminal do evento.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const { data: eventoFinalizado, error: erroFinalizacao } = await (supabaseAdmin as any)
            .from("webhook_eventos")
            .update({
              status: "processado",
              erro: null,
              atualizado_em: new Date().toISOString(),
            })
            .eq("chave_idempotencia", chaveIdempotencia)
            .select("id")
            .maybeSingle();

          if (erroFinalizacao || !eventoFinalizado) {
            throw new Error("Falha ao persistir a conclusão do webhook.");
          }

          return new Response("ok", { status: 200 });
        } catch (procErr) {
          const msgErro =
            procErr instanceof Error ? procErr.message : "Erro no processamento do webhook";
          console.error("[webhook asaas] Erro ao processar evento:", procErr);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await (supabaseAdmin as any)
            .from("webhook_eventos")
            .update({
              status: "falhou",
              erro: msgErro,
              atualizado_em: new Date().toISOString(),
            })
            .eq("chave_idempotencia", chaveIdempotencia);

          return new Response("Erro no processamento do webhook", { status: 500 });
        }
      },
    },
  },
});
