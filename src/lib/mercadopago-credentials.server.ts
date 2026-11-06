import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const PREFIXO_CREDENCIAL = "enc:v1:";

function obterChaveCriptografia(): Buffer {
  const valor = process.env["MERCADO_PAGO_CREDENTIALS_ENCRYPTION_KEY"];
  if (!valor) {
    throw new Error(
      "MERCADO_PAGO_CREDENTIALS_ENCRYPTION_KEY não configurada no ambiente do servidor.",
    );
  }

  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(valor)) {
    throw new Error("A chave de criptografia do Mercado Pago precisa estar em Base64 válido.");
  }

  const chave = Buffer.from(valor, "base64");
  if (chave.length !== 32) {
    throw new Error("A chave de criptografia do Mercado Pago deve conter exatamente 32 bytes.");
  }

  return chave;
}

export function credencialMercadoPagoEstaCriptografada(valor: string): boolean {
  return valor.startsWith(PREFIXO_CREDENCIAL);
}

/**
 * Criptografa credenciais com AES-256-GCM.
 * O formato armazena versão, IV, tag de autenticação e conteúdo cifrado.
 */
export function criptografarCredencialMercadoPago(valor: string): string {
  if (!valor.trim()) {
    throw new Error("Não é permitido criptografar uma credencial vazia.");
  }

  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", obterChaveCriptografia(), iv);
  const conteudo = Buffer.concat([cipher.update(valor, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `${PREFIXO_CREDENCIAL}${iv.toString("base64")}:${tag.toString("base64")}:${conteudo.toString("base64")}`;
}

/**
 * Descriptografa somente credenciais no formato versionado.
 * Valores legados em texto puro são rejeitados para evitar uso silencioso inseguro.
 */
export function descriptografarCredencialMercadoPago(valor: string): string {
  if (!credencialMercadoPagoEstaCriptografada(valor)) {
    throw new Error(
      "Credencial legada em texto puro. Execute a migração de credenciais do Mercado Pago.",
    );
  }

  const partes = valor.slice(PREFIXO_CREDENCIAL.length).split(":");
  if (partes.length !== 3) {
    throw new Error("Formato de credencial criptografada do Mercado Pago inválido.");
  }

  const [ivBase64, tagBase64, conteudoBase64] = partes;
  if (!ivBase64 || !tagBase64 || !conteudoBase64) {
    throw new Error("Credencial criptografada do Mercado Pago incompleta.");
  }

  const iv = Buffer.from(ivBase64, "base64");
  const tag = Buffer.from(tagBase64, "base64");
  const conteudo = Buffer.from(conteudoBase64, "base64");
  if (iv.length !== 12 || tag.length !== 16 || conteudo.length === 0) {
    throw new Error("Tamanho inválido nos componentes da credencial do Mercado Pago.");
  }

  const decipher = createDecipheriv("aes-256-gcm", obterChaveCriptografia(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(conteudo), decipher.final()]).toString("utf8");
}
