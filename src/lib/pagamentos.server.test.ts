import { describe, expect, it } from "vitest";

import { erroHttpAsaasEhDefinitivo } from "./pagamentos.server";

function erroHttp(status: number): Error & { status: number } {
  return Object.assign(new Error(`HTTP ${status}`), { status });
}

describe("Política de retry de Pix Asaas", () => {
  it("permite falha definitiva para 4xx do POST sem ID de transferência", () => {
    expect(erroHttpAsaasEhDefinitivo(erroHttp(400), null)).toBe(true);
    expect(erroHttpAsaasEhDefinitivo(erroHttp(422), null)).toBe(true);
  });

  it("não libera retry quando já existe ID de transferência, mesmo com HTTP 4xx", () => {
    expect(erroHttpAsaasEhDefinitivo(erroHttp(404), "transf_123")).toBe(false);
    expect(erroHttpAsaasEhDefinitivo(erroHttp(400), "transf_123")).toBe(false);
  });

  it("trata timeout, rate limit e erro 5xx como inconclusivos", () => {
    expect(erroHttpAsaasEhDefinitivo(erroHttp(408), null)).toBe(false);
    expect(erroHttpAsaasEhDefinitivo(erroHttp(429), null)).toBe(false);
    expect(erroHttpAsaasEhDefinitivo(500, null)).toBe(false);
  });
});
