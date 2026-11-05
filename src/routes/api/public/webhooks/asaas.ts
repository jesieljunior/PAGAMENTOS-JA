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

const PAGAS = new Set(["PAYMENT_RECEIVED", "PAYMENT_CONFIRMED", "PAYMENT_RECEIVED_IN_CASH"]);

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
            const { data: eventoDb } = await (supabaseAdmin as any)
              .from("webhook_eventos")
              .select("id, status, tentativas, atualizado_em")
              .eq("chave_idempotencia", chaveIdempotencia)
              .maybeSingle();

            if (eventoDb) {
              eventoExistente = eventoDb;
            } else {
              return new Response("ok", { status: 200 });
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

            // Compare-And-Swap (CAS) atômico para impedir que instâncias concorrentes retomem simultaneamente
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const { data: casUpdate } = await (supabaseAdmin as any)
              .from("webhook_eventos")
              .update({
                status: "processando",
                tentativas: tentativas + 1,
                atualizado_em: new Date().toISOString(),
              })
              .eq("id", eventoExistente.id)
              .eq("status", eventoExistente.status)
              .select("id");

            if (!casUpdate || (Array.isArray(casUpdate) && casUpdate.length === 0)) {
              // Outra instância concorrente assumiu a retomada
              return new Response("ok", { status: 200 });
            }
          } else {
            // Em processamento ativo por outra instância há menos de 5 min -> ignora duplicação simultânea
            return new Response("ok", { status: 200 });
          }
        }

        try {
          // 2. Confirmação de fatura SaaS da plataforma (Planos e Assinaturas Já)
          if (PAGAS.has(evento) && (corpo.payment?.id || corpo.payment?.externalReference)) {
            const faturaIdRef = corpo.payment.externalReference;
            const parceiroId = corpo.payment.id;

            let faturaPlataforma: {
              id: string;
              status: string;
              total: number;
              empresa_id: string;
            } | null = null;

            if (faturaIdRef) {
              const { data: f } = await supabaseAdmin
                .from("faturas_plataforma")
                .select("id, status, total, empresa_id")
                .eq("id", faturaIdRef)
                .maybeSingle();
              if (f) faturaPlataforma = f;
            }

            if (!faturaPlataforma && parceiroId) {
              const { data: f } = await supabaseAdmin
                .from("faturas_plataforma")
                .select("id, status, total, empresa_id")
                .eq("referencia_provedor", parceiroId)
                .maybeSingle();
              if (f) faturaPlataforma = f;
            }

            if (
              faturaPlataforma &&
              faturaPlataforma.status !== "pago" &&
              faturaPlataforma.status !== "paga"
            ) {
              let liquidadaRpc = false;
              try {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const { data: resRpc, error: errRpc } = await (supabaseAdmin.rpc as any)(
                  "liquidar_fatura_plataforma_asaas",
                  {
                    _fatura_id: faturaPlataforma.id,
                    _parceiro_id: parceiroId,
                    _valor: corpo.payment?.value ?? faturaPlataforma.total,
                  },
                );
                if (!errRpc && resRpc && (resRpc as { ok?: boolean }).ok) {
                  liquidadaRpc = true;
                }
              } catch {
                liquidadaRpc = false;
              }

              if (!liquidadaRpc) {
                const agora = new Date().toISOString();
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                await (supabaseAdmin.from("faturas_plataforma") as any)
                  .update({
                    status: "pago",
                    referencia_provedor: parceiroId,
                    provedor: "asaas",
                    pago_em: agora,
                    atualizado_em: agora,
                  })
                  .eq("id", faturaPlataforma.id);

                await supabaseAdmin
                  .from("assinaturas")
                  .update({
                    status: "ativa",
                    atualizado_em: agora,
                  })
                  .eq("empresa_id", faturaPlataforma.empresa_id);
              }
            }
          }

          // 2.1 Confirmação de cobrança de funding/cliente paga (Saldo operacional para repasse Pix)
          if (PAGAS.has(evento) && corpo.payment?.id) {
            const { data: cobranca } = await supabaseAdmin
              .from("cobrancas")
              .select("id, empresa_id, valor, status, descricao")
              .eq("parceiro_cobranca_id", corpo.payment.id)
              .maybeSingle();

            if (cobranca && cobranca.status !== "pago") {
              const { data: taxaPendente } = await supabaseAdmin
                .from("taxas_plataforma")
                .select("id, valor")
                .eq("cobranca_id", cobranca.id)
                .eq("status", "pendente")
                .maybeSingle();

              const valorCredito = taxaPendente
                ? Math.max(0, Number(cobranca.valor) - Number(taxaPendente.valor))
                : Number(cobranca.valor);

              await supabaseAdmin
                .from("cobrancas")
                .update({ status: "pago", pago_em: new Date().toISOString() })
                .eq("id", cobranca.id);

              await supabaseAdmin.from("movimentos_saldo").insert({
                empresa_id: cobranca.empresa_id,
                tipo: "credito",
                valor: valorCredito,
                descricao: `Cobrança paga — ${cobranca.descricao}`,
                cobranca_id: cobranca.id,
              });

              await supabaseAdmin
                .from("fundings")
                .update({
                  status: "available",
                  valor_disponivel: valorCredito,
                  referencia_parceiro: corpo.payment.id,
                })
                .eq("cobranca_id", cobranca.id)
                .eq("status", "pending");

              if (taxaPendente) {
                await supabaseAdmin
                  .from("taxas_plataforma")
                  .update({ status: "cobrada" })
                  .eq("id", taxaPendente.id);
              }
            }
          }

          if (evento === "PAYMENT_OVERDUE" && corpo.payment?.id) {
            await supabaseAdmin
              .from("cobrancas")
              .update({ status: "vencido" })
              .eq("parceiro_cobranca_id", corpo.payment.id);

            // Atualiza também se for fatura SaaS
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await (supabaseAdmin.from("faturas_plataforma") as any)
              .update({ status: "vencida", atualizado_em: new Date().toISOString() })
              .or(
                `referencia_provedor.eq.${corpo.payment.id},id.eq.${corpo.payment.externalReference ?? ""}`,
              );
          }

          // 3. Transferências Pix aos Freelancers: Sucesso terminal confirmado
          if (
            (evento === "TRANSFER_DONE" || evento === "TRANSFER_CONFIRMED") &&
            corpo.transfer?.externalReference
          ) {
            const pagamentoId = corpo.transfer.externalReference;
            await supabaseAdmin
              .from("pagamentos")
              .update({
                status: "executado",
                executado_em: new Date().toISOString(),
                txid_parceiro: corpo.transfer.id ?? null,
                parceiro_transferencia_id: corpo.transfer.id ?? null,
                erro: null,
              })
              .eq("id", pagamentoId)
              .neq("status", "executado");
          }

          // 4. Transferências Pix aos Freelancers: Falhas, cancelamentos e estornos
          if (
            (evento === "TRANSFER_FAILED" ||
              evento === "TRANSFER_CANCELLED" ||
              evento === "TRANSFER_REVERSED") &&
            corpo.transfer?.externalReference
          ) {
            const pagamentoId = corpo.transfer.externalReference;
            const statusFinal = evento === "TRANSFER_REVERSED" ? "estornado" : "falhou";
            const motivo =
              corpo.transfer.failReason ||
              (evento === "TRANSFER_REVERSED"
                ? "Transferência estornada pelo banco recebedor."
                : "Transferência cancelada/recusada pelo banco.");

            const descricaoCredito = `Estorno de Pix (${evento === "TRANSFER_REVERSED" ? "estornado" : "recusado"})`;
            let revertidoViaRpc = false;
            try {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const { data: resRpc, error: errRpc } = await (supabaseAdmin.rpc as any)(
                "reverter_transferencia_pagamento_pix",
                {
                  _pagamento_id: pagamentoId,
                  _status_final: statusFinal,
                  _motivo: motivo,
                  _descricao_credito: descricaoCredito,
                },
              );
              if (
                !errRpc &&
                resRpc &&
                typeof resRpc === "object" &&
                (resRpc as { ok?: boolean }).ok
              ) {
                revertidoViaRpc = true;
              }
            } catch {
              revertidoViaRpc = false;
            }

            if (!revertidoViaRpc) {
              const { error: errUpdatePag } = await supabaseAdmin
                .from("pagamentos")
                .update({
                  status: statusFinal,
                  erro: motivo,
                })
                .eq("id", pagamentoId);

              // Fallback se o enum do banco ainda não suportar 'estornado'
              if (errUpdatePag && statusFinal === "estornado") {
                await supabaseAdmin
                  .from("pagamentos")
                  .update({
                    status: "falhou",
                    erro: `[estornado] ${motivo}`,
                  })
                  .eq("id", pagamentoId);
              }

              // Estorna o débito de saldo do Pix se já havia sido debitado e ainda não estornado
              const { data: pagamento } = await supabaseAdmin
                .from("pagamentos")
                .select("id, valor, fechamento_id")
                .eq("id", pagamentoId)
                .maybeSingle();

              if (pagamento) {
                const { data: movimentoDebito } = await supabaseAdmin
                  .from("movimentos_saldo")
                  .select("id, empresa_id")
                  .eq("pagamento_id", pagamento.id)
                  .eq("tipo", "debito")
                  .maybeSingle();

                if (movimentoDebito) {
                  const { data: estornoExistente } = await supabaseAdmin
                    .from("movimentos_saldo")
                    .select("id")
                    .eq("pagamento_id", pagamento.id)
                    .eq("tipo", "credito")
                    .maybeSingle();

                  if (!estornoExistente) {
                    const { error: errEstorno } = await supabaseAdmin
                      .from("movimentos_saldo")
                      .insert({
                        empresa_id: movimentoDebito.empresa_id,
                        tipo: "credito",
                        valor: pagamento.valor,
                        descricao: descricaoCredito,
                        pagamento_id: pagamento.id,
                      });

                    if (errEstorno && errEstorno.code !== "23505") {
                      console.error("[webhook asaas] Erro ao gravar estorno contábil:", errEstorno);
                      throw errEstorno;
                    }
                  }
                }
              }
            }
          }

          // 5. Marca o registro na tabela webhook_eventos como concluído com sucesso
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await (supabaseAdmin as any)
            .from("webhook_eventos")
            .update({
              status: "processado",
              erro: null,
              atualizado_em: new Date().toISOString(),
            })
            .eq("chave_idempotencia", chaveIdempotencia);

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
