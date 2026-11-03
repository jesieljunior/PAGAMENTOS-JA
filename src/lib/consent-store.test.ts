import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  aceitarTodosCookies,
  CONSENT_PADRAO,
  obterConsentimentoCookies,
  rejeitarNaoEssenciais,
  salvarConsentimentoCookies,
} from "./consent-store";

describe("consent-store: gestão de cookies e LGPD", () => {
  let mockStorage: Record<string, string> = {};

  beforeEach(() => {
    mockStorage = {};
    const storageMock = {
      getItem: vi.fn((key: string) => mockStorage[key] ?? null),
      setItem: vi.fn((key: string, value: string) => {
        mockStorage[key] = value;
      }),
      removeItem: vi.fn((key: string) => {
        delete mockStorage[key];
      }),
      clear: vi.fn(() => {
        mockStorage = {};
      }),
    };

    vi.stubGlobal("localStorage", storageMock);
    vi.stubGlobal("window", {
      dispatchEvent: vi.fn(),
      localStorage: storageMock,
    });
  });

  it("retorna preferências padrão quando usuário ainda não respondeu", () => {
    const prefs = obterConsentimentoCookies();
    expect(prefs.essencial).toBe(true);
    expect(prefs.analitico).toBe(false);
    expect(prefs.marketing).toBe(false);
    expect(prefs.respondido).toBe(false);
  });

  it("aceita todos os cookies e persiste escolha", () => {
    const prefs = aceitarTodosCookies();
    expect(prefs.essencial).toBe(true);
    expect(prefs.analitico).toBe(true);
    expect(prefs.marketing).toBe(true);
    expect(prefs.respondido).toBe(true);

    const lido = obterConsentimentoCookies();
    expect(lido.analitico).toBe(true);
    expect(lido.marketing).toBe(true);
    expect(lido.respondido).toBe(true);
  });

  it("rejeita cookies não essenciais mantendo estritamente os essenciais", () => {
    const prefs = rejeitarNaoEssenciais();
    expect(prefs.essencial).toBe(true);
    expect(prefs.analitico).toBe(false);
    expect(prefs.marketing).toBe(false);
    expect(prefs.respondido).toBe(true);

    const lido = obterConsentimentoCookies();
    expect(lido.analitico).toBe(false);
    expect(lido.marketing).toBe(false);
    expect(lido.respondido).toBe(true);
  });

  it("salva preferências granulares personalizadas", () => {
    const prefs = salvarConsentimentoCookies({
      analitico: true,
      marketing: false,
    });
    expect(prefs.essencial).toBe(true);
    expect(prefs.analitico).toBe(true);
    expect(prefs.marketing).toBe(false);

    const lido = obterConsentimentoCookies();
    expect(lido.analitico).toBe(true);
    expect(lido.marketing).toBe(false);
  });
});
