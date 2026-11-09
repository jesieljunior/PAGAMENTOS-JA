import { describe, expect, it } from "vitest";

import {
  EVENTOS_CREDITO_SALDO,
  EVENTOS_FATURA_SAAS,
  STATUS_CREDITO_SALDO,
  STATUS_FATURA_SAAS,
  isRecebimentoManualEmDinheiro,
} from "./asaas-payment-policy.ts";

describe("Política de liquidação Asaas", () => {
  it("não liquida fatura SaaS por baixa manual de recebimento em dinheiro", () => {
    expect(EVENTOS_FATURA_SAAS.has("PAYMENT_RECEIVED_IN_CASH")).toBe(false);
    expect(STATUS_FATURA_SAAS.has("RECEIVED_IN_CASH")).toBe(false);
  });

  it("não libera funding operacional por baixa manual de recebimento em dinheiro", () => {
    expect(EVENTOS_CREDITO_SALDO.has("PAYMENT_RECEIVED_IN_CASH")).toBe(false);
    expect(STATUS_CREDITO_SALDO.has("RECEIVED_IN_CASH")).toBe(false);
  });

  it("permite funding somente após o saldo ficar disponível no Asaas", () => {
    expect(EVENTOS_CREDITO_SALDO.has("PAYMENT_RECEIVED")).toBe(true);
    expect(STATUS_CREDITO_SALDO.has("RECEIVED")).toBe(true);
    expect(EVENTOS_CREDITO_SALDO.has("PAYMENT_CONFIRMED")).toBe(false);
    expect(STATUS_CREDITO_SALDO.has("CONFIRMED")).toBe(false);
  });

  it("permite PAYMENT_CONFIRMED para fatura SaaS sem liberar funding", () => {
    expect(EVENTOS_FATURA_SAAS.has("PAYMENT_CONFIRMED")).toBe(true);
    expect(STATUS_FATURA_SAAS.has("CONFIRMED")).toBe(true);
    expect(EVENTOS_CREDITO_SALDO.has("PAYMENT_CONFIRMED")).toBe(false);
    expect(STATUS_CREDITO_SALDO.has("CONFIRMED")).toBe(false);
  });

  it("identifica recebimento manual pelo billingType mesmo com evento PAYMENT_RECEIVED", () => {
    expect(isRecebimentoManualEmDinheiro("RECEIVED_IN_CASH")).toBe(true);
    expect(isRecebimentoManualEmDinheiro("received_in_cash")).toBe(true);
    expect(isRecebimentoManualEmDinheiro("PIX")).toBe(false);
    expect(isRecebimentoManualEmDinheiro("UNDEFINED")).toBe(false);
    expect(isRecebimentoManualEmDinheiro(null)).toBe(false);
  });
});
