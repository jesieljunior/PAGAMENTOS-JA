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
        // Se a chave já existir (requisição concorrente ou duplicada), o insert falha com erro 23505 (unique_violation)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error: erroIdempotencia } = await (supabaseAdmin as any)
          .from("webhook_eventos")
          .insert({
            chave_idempotencia: chaveIdempotencia,
            evento: evento,
            payload: corpo,
            status: "processando",
          });

        if (erroIdempotencia) {
          // Erro 23505 = chave de idempotência já adquirida/processada
          if (erroIdempotencia.code === "23505") {
            return new Response("ok", { status: 200 });
          }
          console.error(
            "[webhook asaas] Erro ao registrar chave de idempotência:",
            erroIdempotencia,
          );
          return new Response("Erro interno de concorrência", { status: 500 });
        }

        try {
          // 2. Confirmação de cobrança de funding/cliente paga
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
                  await supabaseAdmin.from("movimentos_saldo").insert({
                    empresa_id: movimentoDebito.empresa_id,
                    tipo: "credito",
                    valor: pagamento.valor,
                    descricao: `Estorno de Pix (${evento === "TRANSFER_REVERSED" ? "estornado" : "recusado"})`,
                    pagamento_id: pagamento.id,
                  });
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
            })
            .eq("chave_idempotencia", chaveIdempotencia);

          return new Response("ok", { status: 200 });
        } catch (procErr) {
          console.error("[webhook asaas] Erro ao processar evento:", procErr);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await (supabaseAdmin as any)
            .from("webhook_eventos")
            .update({
              status: "falhou",
            })
            .eq("chave_idempotencia", chaveIdempotencia);

          return new Response("Erro no processamento do webhook", { status: 500 });
        }
      },
    },
  },
});
