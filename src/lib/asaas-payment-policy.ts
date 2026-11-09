/**
 * Política de confirmação de pagamentos recebidos pelo Asaas.
 *
 * PAYMENT_RECEIVED também pode ocorrer após uma baixa manual externa.
 * Nesse caso, billingType = RECEIVED_IN_CASH não disponibiliza saldo na conta Asaas;
 * por isso, não liquida automaticamente faturas SaaS nem libera funding.
 * O reconhecimento desse recebimento exige conciliação manual fora do fluxo automático.
 */
export const EVENTOS_FATURA_SAAS = new Set<string>(["PAYMENT_RECEIVED", "PAYMENT_CONFIRMED"]);

/** Funding operacional só é liberado quando o Asaas confirma saldo disponível. */
export const EVENTOS_CREDITO_SALDO = new Set<string>(["PAYMENT_RECEIVED"]);

export const STATUS_FATURA_SAAS = new Set<string>(["RECEIVED", "CONFIRMED"]);

export const STATUS_CREDITO_SALDO = new Set<string>(["RECEIVED"]);

/** Detecta a baixa manual externa, inclusive quando o evento recebido é PAYMENT_RECEIVED. */
export function isRecebimentoManualEmDinheiro(billingType: unknown): boolean {
  return typeof billingType === "string" && billingType.trim().toUpperCase() === "RECEIVED_IN_CASH";
}
