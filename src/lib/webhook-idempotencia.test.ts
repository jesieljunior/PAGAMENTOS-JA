import { describe, expect, it } from "vitest";
import { gerarChaveWebhookAsaas, type EventoAsaasWebhook } from "./webhook-idempotencia.ts";

describe("Webhook Asaas: Idempotência e Segurança", () => {
  it("gera a mesma chave para eventos duplicados do Asaas", () => {
    const payloadA: EventoAsaasWebhook = {
      event: "PAYMENT_RECEIVED",
      payment: { id: "pay_123", externalReference: "cob_456", value: 1500 },
    };
    const payloadB: EventoAsaasWebhook = {
      event: "PAYMENT_RECEIVED",
      payment: { id: "pay_123", externalReference: "cob_456", value: 1500 },
    };
    expect(gerarChaveWebhookAsaas(payloadA)).toBe(gerarChaveWebhookAsaas(payloadB));
  });

  it("ignora pequenos detalhes de payload quando o evento é o mesmo", () => {
    const payloadA: EventoAsaasWebhook = {
      event: "TRANSFER_FAILED",
      transfer: {
        id: "tr_999",
        externalReference: "pay_001",
        failReason: "bank_rejected",
      },
    };
    const payloadB: EventoAsaasWebhook = {
      event: "TRANSFER_FAILED",
      transfer: {
        id: "tr_999",
        externalReference: "pay_001",
        failReason: "different_reason",
      },
    };
    expect(gerarChaveWebhookAsaas(payloadA)).toBe(gerarChaveWebhookAsaas(payloadB));
  });

  it("gera chaves distintas para pagamentos ou eventos diferentes", () => {
    const payloadA: EventoAsaasWebhook = {
      event: "PAYMENT_RECEIVED",
      payment: { id: "pay_123", value: 1500 },
    };
    const payloadB: EventoAsaasWebhook = {
      event: "PAYMENT_CONFIRMED",
      payment: { id: "pay_123", value: 1500 },
    };
    const payloadC: EventoAsaasWebhook = {
      event: "PAYMENT_RECEIVED",
      payment: { id: "pay_456", value: 1500 },
    };
    const chaveA = gerarChaveWebhookAsaas(payloadA);
    const chaveB = gerarChaveWebhookAsaas(payloadB);
    const chaveC = gerarChaveWebhookAsaas(payloadC);

    expect(chaveA).not.toBe(chaveB);
    expect(chaveA).not.toBe(chaveC);
  });

  it("simula idempotência impedindo duplo crédito em eventos repetidos", () => {
    const eventosProcessados = new Set<string>();
    let saldoAgencia = 0;
    let chamadasCredito = 0;

    function processarWebhookSimulado(payload: EventoAsaasWebhook): {
      status: number;
      mensagem: string;
      ignoradoDuplicado: boolean;
    } {
      const chave = gerarChaveWebhookAsaas(payload);
      if (eventosProcessados.has(chave)) {
        return { status: 200, mensagem: "ok", ignoradoDuplicado: true };
      }

      if (payload.event === "PAYMENT_RECEIVED" && payload.payment?.value) {
        saldoAgencia += payload.payment.value;
        chamadasCredito++;
      }

      eventosProcessados.add(chave);
      return { status: 200, mensagem: "ok", ignoradoDuplicado: false };
    }

    const payloadPix: EventoAsaasWebhook = {
      event: "PAYMENT_RECEIVED",
      payment: { id: "pay_abc_789", value: 2500 },
    };

    // Primeira entrega do webhook pelo Asaas
    const res1 = processarWebhookSimulado(payloadPix);
    expect(res1.status).toBe(200);
    expect(res1.ignoradoDuplicado).toBe(false);
    expect(saldoAgencia).toBe(2500);
    expect(chamadasCredito).toBe(1);

    // Segunda entrega do webhook (retentativa de rede / timeout)
    const res2 = processarWebhookSimulado(payloadPix);
    expect(res2.status).toBe(200);
    expect(res2.ignoradoDuplicado).toBe(true);
    // Saldo não foi creditado uma segunda vez
    expect(saldoAgencia).toBe(2500);
    expect(chamadasCredito).toBe(1);
  });

  it("rejeita webhooks com token ausente ou inválido", () => {
    const TOKEN_ESPERADO = "webhook_token_secreto_ja_2026";

    function autenticarWebhook(headerToken: string | null | undefined): boolean {
      if (!headerToken) return false;
      return headerToken === TOKEN_ESPERADO;
    }

    expect(autenticarWebhook(null)).toBe(false);
    expect(autenticarWebhook("")).toBe(false);
    expect(autenticarWebhook("token_errado")).toBe(false);
    expect(autenticarWebhook("webhook_token_secreto_ja_2026")).toBe(true);
  });

  it("trata eventos fora de ordem sem corromper status terminal", () => {
    type StatusCobranca = "pendente" | "vencido" | "pago";
    let statusAtual: StatusCobranca = "pago";

    function aplicarEvento(status: StatusCobranca, novoEvento: string): StatusCobranca {
      // Regra: uma vez pago, status não pode regredir para pendente ou vencido
      if (status === "pago") return "pago";
      if (novoEvento === "PAYMENT_OVERDUE") return "vencido";
      if (novoEvento === "PAYMENT_RECEIVED") return "pago";
      return status;
    }

    // Se receber PAYMENT_OVERDUE atrasado após já ter sido pago:
    statusAtual = aplicarEvento(statusAtual, "PAYMENT_OVERDUE");
    expect(statusAtual).toBe("pago");
  });

  it("recupera e reprocessa eventos com falha anterior até o limite de 5 tentativas", () => {
    interface RegistroWebhook {
      status: "processando" | "processado" | "falhou";
      tentativas: number;
      atualizado_em: number;
    }

    const bancoWebhooks = new Map<string, RegistroWebhook>();

    function processarWebhookComPoliticaDeRecuperacao(
      chave: string,
      deveFalhar: boolean,
    ): { executou: boolean; motivo: string } {
      const existente = bancoWebhooks.get(chave);
      const agora = Date.now();

      if (existente) {
        if (existente.status === "processado") {
          return { executou: false, motivo: "ja_processado" };
        }

        const timedOut = agora - existente.atualizado_em > 5 * 60_000;
        if (existente.status === "falhou" || timedOut) {
          if (existente.tentativas >= 5) {
            return { executou: false, motivo: "limite_tentativas_excedido" };
          }
          existente.status = "processando";
          existente.tentativas += 1;
          existente.atualizado_em = agora;
        } else {
          return { executou: false, motivo: "em_processamento_ativo" };
        }
      } else {
        bancoWebhooks.set(chave, {
          status: "processando",
          tentativas: 1,
          atualizado_em: agora,
        });
      }

      // Execução
      const reg = bancoWebhooks.get(chave)!;
      if (deveFalhar) {
        reg.status = "falhou";
        return { executou: true, motivo: "falha_execucao" };
      }

      reg.status = "processado";
      return { executou: true, motivo: "sucesso" };
    }

    const chave = "webhook:transfer:tr_123";

    // 1. Primeira tentativa falha
    const t1 = processarWebhookComPoliticaDeRecuperacao(chave, true);
    expect(t1.executou).toBe(true);
    expect(t1.motivo).toBe("falha_execucao");
    expect(bancoWebhooks.get(chave)?.tentativas).toBe(1);
    expect(bancoWebhooks.get(chave)?.status).toBe("falhou");

    // 2. Nova entrega Asaas para o evento falho: é aceito para retry
    const t2 = processarWebhookComPoliticaDeRecuperacao(chave, false);
    expect(t2.executou).toBe(true);
    expect(t2.motivo).toBe("sucesso");
    expect(bancoWebhooks.get(chave)?.tentativas).toBe(2);
    expect(bancoWebhooks.get(chave)?.status).toBe("processado");

    // 3. Terceira entrega do mesmo evento já concluído com sucesso: é ignorado sem re-executar
    const t3 = processarWebhookComPoliticaDeRecuperacao(chave, false);
    expect(t3.executou).toBe(false);
    expect(t3.motivo).toBe("ja_processado");
  });
});
