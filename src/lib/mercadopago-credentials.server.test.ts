import { afterEach, describe, expect, it } from "vitest";

import {
  criptografarCredencialMercadoPago,
  credencialMercadoPagoEstaCriptografada,
  descriptografarCredencialMercadoPago,
} from "./mercadopago-credentials.server";

const CHAVE_TESTE = Buffer.alloc(32, 7).toString("base64");

afterEach(() => {
  delete process.env["MERCADO_PAGO_CREDENTIALS_ENCRYPTION_KEY"];
});

describe("Credenciais Mercado Pago — criptografia", () => {
  it("criptografa e descriptografa um token sem armazenar o texto original", () => {
    process.env["MERCADO_PAGO_CREDENTIALS_ENCRYPTION_KEY"] = CHAVE_TESTE;
    const token = "APP_USR-token-de-teste-nao-real";
    const cifrado = criptografarCredencialMercadoPago(token);

    expect(cifrado).not.toContain(token);
    expect(credencialMercadoPagoEstaCriptografada(cifrado)).toBe(true);
    expect(descriptografarCredencialMercadoPago(cifrado)).toBe(token);
  });

  it("rejeita alteração no conteúdo criptografado", () => {
    process.env["MERCADO_PAGO_CREDENTIALS_ENCRYPTION_KEY"] = CHAVE_TESTE;
    const cifrado = criptografarCredencialMercadoPago("segredo-de-teste");
    const partes = cifrado.split(":");
    const conteudo = partes[3] ?? "";
    const alterado = conteudo.startsWith("A") ? `B${conteudo.slice(1)}` : `A${conteudo.slice(1)}`;
    partes[3] = alterado;

    expect(() => descriptografarCredencialMercadoPago(partes.join(":"))).toThrow();
  });

  it("rejeita valores legados em texto puro", () => {
    process.env["MERCADO_PAGO_CREDENTIALS_ENCRYPTION_KEY"] = CHAVE_TESTE;
    expect(() => descriptografarCredencialMercadoPago("token-legado")).toThrow(/texto puro/);
  });

  it("exige chave de 32 bytes", () => {
    process.env["MERCADO_PAGO_CREDENTIALS_ENCRYPTION_KEY"] = Buffer.alloc(16, 3).toString("base64");
    expect(() => criptografarCredencialMercadoPago("segredo")).toThrow(/32 bytes/);
  });
});
