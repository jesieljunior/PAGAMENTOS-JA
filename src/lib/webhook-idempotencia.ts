export type EventoAsaasWebhook = {
  id?: string;
  event?: string;
  payment?: {
    id?: string;
    externalReference?: string;
    value?: number;
  };
  transfer?: {
    id?: string;
    externalReference?: string;
    failReason?: string;
  };
};

function normalizarValor(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return Number.isFinite(value) ? value.toString() : "";
  return JSON.stringify(value);
}

export function gerarChaveWebhookAsaas(payload: EventoAsaasWebhook): string {
  // O Asaas mantém o mesmo id quando reentrega o mesmo evento.
  if (payload.id?.trim()) return `asaas-event:${payload.id.trim()}`;

  // Compatibilidade com payloads antigos sem id: chave determinística legada.
  const evento = payload.event ?? "";
  const payment = payload.payment ?? {};
  const transfer = payload.transfer ?? {};

  const partes = [
    "asaas-webhook",
    evento,
    normalizarValor(payment.id ?? payment.externalReference ?? ""),
    normalizarValor(transfer.id ?? transfer.externalReference ?? ""),
    normalizarValor(payment.value ?? ""),
  ];

  return partes.join(":");
}
