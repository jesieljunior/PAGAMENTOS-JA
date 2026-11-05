import { afterEach, describe, expect, it, vi } from "vitest";
import crypto from "node:crypto";

import { criarTokenQrCodeAssinado, decodificarTokenQrCode } from "./ponto.signed-token";

const evento = {
  id: "8b1a4f6d-9a8c-4e5f-a2b1-123456789abc",
  empresa_id: "7a1b2c3d-4e5f-a6b7-8c9d-0123456789ab",
  nome: "Evento de teste",
  data_inicio: "2026-11-05T08:00:00.000Z",
};

afterEach(() => vi.unstubAllEnvs());

describe("tokens assinados de QR Code", () => {
  it("não gera token sem segredo configurado", () => {
    vi.stubEnv("PONTO_SIGNING_SECRET", "");
    expect(() => criarTokenQrCodeAssinado(evento)).toThrow(/PONTO_SIGNING_SECRET/);
  });

  it("rejeita segredo menor que 32 bytes", () => {
    vi.stubEnv("PONTO_SIGNING_SECRET", "curto-demais");
    expect(() => criarTokenQrCodeAssinado(evento)).toThrow(/32 bytes/);
  });

  it("gera e valida token com segredo forte", () => {
    vi.stubEnv("PONTO_SIGNING_SECRET", "a".repeat(48));
    const token = criarTokenQrCodeAssinado(evento);
    expect(decodificarTokenQrCode(token)?.eventoId).toBe(evento.id);
  });

  it("rejeita token adulterado", () => {
    vi.stubEnv("PONTO_SIGNING_SECRET", "b".repeat(48));
    const token = criarTokenQrCodeAssinado(evento);
    const adulterado = token.slice(0, -1) + (token.endsWith("a") ? "b" : "a");
    expect(decodificarTokenQrCode(adulterado)).toBeNull();
  });

  it("rejeita token expirado sem janela de tolerância", () => {
    const secret = "c".repeat(48);
    vi.stubEnv("PONTO_SIGNING_SECRET", secret);
    const payload = Buffer.from(JSON.stringify({
      eventoId: evento.id,
      empresaId: evento.empresa_id,
      qr_code_token: "token-evento",
      exp: Date.now() - 1,
    })).toString("base64url");
    const signature = crypto.createHmac("sha256", secret).update(payload).digest("base64url");
    expect(decodificarTokenQrCode(`qr.${payload}.${signature}`)).toBeNull();
  });

  it("falha fechado ao validar quando o segredo não está configurado", () => {
    vi.stubEnv("PONTO_SIGNING_SECRET", "");
    expect(decodificarTokenQrCode("qr.payload.signature")).toBeNull();
  });
});
