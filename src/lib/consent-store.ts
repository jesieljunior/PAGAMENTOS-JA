export interface CookieConsentPreferences {
  essencial: boolean; // Sempre true
  analitico: boolean;
  marketing: boolean;
  respondido: boolean;
  timestamp?: string | undefined;
  versao: string;
}

const STORAGE_KEY = "ja_cookie_consent_v1";
const CONSENT_VERSION = "2026.1";

export const CONSENT_PADRAO: CookieConsentPreferences = {
  essencial: true,
  analitico: false,
  marketing: false,
  respondido: false,
  versao: CONSENT_VERSION,
};

export function obterConsentimentoCookies(): CookieConsentPreferences {
  if (typeof window === "undefined") {
    return CONSENT_PADRAO;
  }

  try {
    const salvo = localStorage.getItem(STORAGE_KEY);
    if (!salvo) return CONSENT_PADRAO;
    const parsed = JSON.parse(salvo) as Partial<CookieConsentPreferences>;
    if (parsed.versao !== CONSENT_VERSION) {
      // Nova versão dos termos, solicita consentimento novamente
      return CONSENT_PADRAO;
    }
    return {
      essencial: true,
      analitico: Boolean(parsed.analitico),
      marketing: Boolean(parsed.marketing),
      respondido: Boolean(parsed.respondido),
      timestamp: parsed.timestamp,
      versao: CONSENT_VERSION,
    };
  } catch {
    return CONSENT_PADRAO;
  }
}

export function salvarConsentimentoCookies(
  prefs: Pick<CookieConsentPreferences, "analitico" | "marketing">,
): CookieConsentPreferences {
  const finalPrefs: CookieConsentPreferences = {
    essencial: true,
    analitico: prefs.analitico,
    marketing: prefs.marketing,
    respondido: true,
    timestamp: new Date().toISOString(),
    versao: CONSENT_VERSION,
  };

  if (typeof window !== "undefined") {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(finalPrefs));
      window.dispatchEvent(new CustomEvent("ja:cookie_consent_updated", { detail: finalPrefs }));
      aplicarConsentimentoScripts(finalPrefs);
    } catch (e) {
      console.warn("Falha ao persistir consentimento de cookies:", e);
    }
  }

  return finalPrefs;
}

export function aceitarTodosCookies(): CookieConsentPreferences {
  return salvarConsentimentoCookies({ analitico: true, marketing: true });
}

export function rejeitarNaoEssenciais(): CookieConsentPreferences {
  return salvarConsentimentoCookies({ analitico: false, marketing: false });
}

/**
 * Aplica as diretivas aos scripts de rastreamento externos (Google Analytics, Meta Pixel, etc.)
 * Se o usuário não tiver consentido, scripts de analytics rodam com telemetria desativada.
 */
export function aplicarConsentimentoScripts(prefs: CookieConsentPreferences) {
  if (typeof window === "undefined") return;

  const w = window as unknown as {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  };

  if (typeof w.gtag === "function") {
    w.gtag("consent", "update", {
      analytics_storage: prefs.analitico ? "granted" : "denied",
      ad_storage: prefs.marketing ? "granted" : "denied",
      ad_user_data: prefs.marketing ? "granted" : "denied",
      ad_personalization: prefs.marketing ? "granted" : "denied",
    });
  }
}
