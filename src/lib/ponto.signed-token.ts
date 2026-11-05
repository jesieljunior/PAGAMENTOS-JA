import crypto from "node:crypto";

export interface PayloadQrCodePonto {
  eventoId: string;
  empresaId: string;
  nome: string;
  local?: string | null;
  status?: string | null;
  data_inicio: string;
  data_fim?: string | null;
  qr_code_expira_em?: string | null;
  qr_code_token: string;
  exigeSelfie?: boolean;
  exigeGps?: boolean;
  pontoBasico?: boolean;
  exp: number; // timestamp ms
}

function obterSegredoAssinatura(): string {
  const secret = process.env["PONTO_SIGNING_SECRET"];
  if (!secret || Buffer.byteLength(secret, "utf8") < 32) {
    throw new Error("PONTO_SIGNING_SECRET ausente ou fraco. Configure um segredo aleatório com pelo menos 32 bytes.");
  }
  return secret;
}

/**
 * Cria um token assinado e autocontido para o QR Code do evento.
 * Pode ser lido pelo celular de qualquer colaborador mesmo sem sessão aberta no Supabase.
 */
export function criarTokenQrCodeAssinado(
  evento: {
    id: string;
    empresa_id: string;
    nome: string;
    local?: string | null;
    status?: string | null;
    data_inicio: string;
    data_fim?: string | null;
    qr_code_expira_em?: string | null;
    qr_code_token?: string | null;
  },
  opcoes?: {
    exigeSelfie?: boolean;
    exigeGps?: boolean;
    pontoBasico?: boolean;
    duracaoHoras?: number;
  },
): string {
  const agora = Date.now();
  const duracaoMs = (opcoes?.duracaoHoras ?? 24) * 60 * 60_000;
  let expTimestamp = agora + duracaoMs;

  if (evento.qr_code_expira_em) {
    const gravada = new Date(evento.qr_code_expira_em).getTime();
    if (Number.isFinite(gravada) && gravada > agora) {
      expTimestamp = Math.max(expTimestamp, gravada);
    }
  }

  const payload: PayloadQrCodePonto = {
    eventoId: evento.id,
    empresaId: evento.empresa_id,
    nome: evento.nome,
    local: evento.local ?? null,
    status: evento.status ?? null,
    data_inicio: evento.data_inicio,
    data_fim: evento.data_fim ?? null,
    qr_code_expira_em: new Date(expTimestamp).toISOString(),
    qr_code_token: evento.qr_code_token || evento.id.replaceAll("-", ""),
    exigeSelfie: Boolean(opcoes?.exigeSelfie),
    exigeGps: Boolean(opcoes?.exigeGps),
    pontoBasico: Boolean(opcoes?.pontoBasico),
    exp: expTimestamp,
  };

  const payloadJson = JSON.stringify(payload);
  const payloadB64 = Buffer.from(payloadJson, "utf8").toString("base64url");
  const signature = crypto.createHmac("sha256", obterSegredoAssinatura()).update(payloadB64).digest("base64url");

  return `qr.${payloadB64}.${signature}`;
}

/**
 * Decodifica e valida a assinatura criptográfica e a expiração do token de QR Code.
 */
export function decodificarTokenQrCode(token: string): PayloadQrCodePonto | null {
  if (!token || (!token.startsWith("qr.") && !token.startsWith("qr_"))) {
    return null;
  }

  const delimiter = token.startsWith("qr_") ? "_" : ".";
  const partes = token.split(delimiter);
  if (partes.length !== 3) {
    return null;
  }

  const [, payloadB64, signature] = partes;
  if (!payloadB64 || !signature) {
    return null;
  }

  // Sem segredo configurado, a validação falha fechada.
  let esperada: string;
  try {
    esperada = crypto
      .createHmac("sha256", obterSegredoAssinatura())
      .update(payloadB64)
      .digest("base64url");
  } catch {
    return null;
  }

  if (signature.length !== esperada.length) {
    return null;
  }

  const bufRecebida = Buffer.from(signature, "utf8");
  const bufEsperada = Buffer.from(esperada, "utf8");
  if (!crypto.timingSafeEqual(bufRecebida, bufEsperada)) {
    return null;
  }

  try {
    const raw = Buffer.from(payloadB64, "base64url").toString("utf8");
    const payload = JSON.parse(raw) as Partial<PayloadQrCodePonto>;
    if (
      typeof payload.eventoId !== "string" ||
      typeof payload.empresaId !== "string" ||
      typeof payload.qr_code_token !== "string" ||
      typeof payload.exp !== "number" ||
      !Number.isFinite(payload.exp)
    ) return null;

    // Expiração estrita: QR expirado não recebe janela extra de validade.
    if (Date.now() >= payload.exp) return null;
    return payload as PayloadQrCodePonto;
  } catch {
    return null;
  }
}
