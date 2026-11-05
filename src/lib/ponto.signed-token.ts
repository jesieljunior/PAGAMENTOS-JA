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

let segredoDevEmMemoria: string | null = null;

function obterSegredoAssinatura(): string {
  const segredo =
    process.env["PONTO_SIGNING_SECRET"] ||
    process.env["JWT_SECRET"] ||
    process.env["SUPABASE_JWT_SECRET"];

  if (segredo && segredo.trim().length >= 32) {
    return segredo.trim();
  }

  // Em ambientes de produção ou homologação real, rejeita terminantemente ausência de chave forte
  if (process.env["NODE_ENV"] === "production" || process.env["VERCEL_ENV"] === "production") {
    throw new Error(
      "Falha de segurança crítica: PONTO_SIGNING_SECRET obrigatório não configurado ou menor que 32 caracteres.",
    );
  }

  // Em testes e desenvolvimento local, gera chave criptográfica aleatória e efêmera por processo (sem strings fixas no código)
  if (!segredoDevEmMemoria) {
    segredoDevEmMemoria = crypto.randomBytes(32).toString("hex");
  }
  return segredoDevEmMemoria;
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
  const signature = crypto
    .createHmac("sha256", obterSegredoAssinatura())
    .update(payloadB64)
    .digest("base64url");

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

  // Verifica assinatura HMAC
  const esperada = crypto
    .createHmac("sha256", obterSegredoAssinatura())
    .update(payloadB64)
    .digest("base64url");

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
    const payload = JSON.parse(raw) as PayloadQrCodePonto;

    // Valida expiração estrita: tolerância máxima de 30 segundos apenas para desvio leve de relógio
    const TOLERANCIA_DESVIO_RELOGIO_MS = 30_000;
    if (Date.now() > payload.exp + TOLERANCIA_DESVIO_RELOGIO_MS) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}
