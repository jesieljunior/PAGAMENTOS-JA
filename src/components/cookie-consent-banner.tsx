import { Cookie, ShieldCheck, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import {
  aceitarTodosCookies,
  obterConsentimentoCookies,
  rejeitarNaoEssenciais,
  salvarConsentimentoCookies,
  type CookieConsentPreferences,
} from "@/lib/consent-store";

export function CookieConsentBanner() {
  const [prefs, setPrefs] = useState<CookieConsentPreferences | null>(null);
  const [modalAberto, setModalAberto] = useState(false);
  const [analitico, setAnalitico] = useState(false);
  const [marketing, setMarketing] = useState(false);

  useEffect(() => {
    const atuais = obterConsentimentoCookies();
    setPrefs(atuais);
    setAnalitico(atuais.analitico);
    setMarketing(atuais.marketing);

    const onUpdate = (e: Event) => {
      const customEvent = e as CustomEvent<CookieConsentPreferences>;
      if (customEvent.detail) {
        setPrefs(customEvent.detail);
        setAnalitico(customEvent.detail.analitico);
        setMarketing(customEvent.detail.marketing);
      }
    };

    const onAbrirModal = () => {
      setModalAberto(true);
    };

    window.addEventListener("ja:cookie_consent_updated", onUpdate);
    window.addEventListener("ja:abrir_preferencias_cookies", onAbrirModal);

    return () => {
      window.removeEventListener("ja:cookie_consent_updated", onUpdate);
      window.removeEventListener("ja:abrir_preferencias_cookies", onAbrirModal);
    };
  }, []);

  if (!prefs) return null;

  const bannerVisivel = !prefs.respondido;

  const handleAceitarTodos = () => {
    const atualizados = aceitarTodosCookies();
    setPrefs(atualizados);
    setModalAberto(false);
  };

  const handleRejeitar = () => {
    const atualizados = rejeitarNaoEssenciais();
    setPrefs(atualizados);
    setModalAberto(false);
  };

  const handleSalvarPersonalizados = () => {
    const atualizados = salvarConsentimentoCookies({ analitico, marketing });
    setPrefs(atualizados);
    setModalAberto(false);
  };

  return (
    <>
      {/* Banner Principal Fixo no Rodapé */}
      {bannerVisivel && (
        <section
          aria-label="Aviso de Privacidade e Consentimento de Cookies"
          className="fixed bottom-0 inset-x-0 z-50 p-3 sm:p-4 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-t border-slate-200/90 dark:border-slate-800 shadow-2xl transition-all animate-in fade-in slide-in-from-bottom-4 duration-300"
        >
          <div className="mx-auto max-w-6xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
            <div className="flex items-start gap-3 text-slate-800 dark:text-slate-200">
              <div className="size-9 rounded-xl bg-blue-100 dark:bg-blue-950/70 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0 mt-0.5">
                <Cookie className="size-5" aria-hidden="true" />
              </div>
              <div className="space-y-1">
                <p className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                  <span>Privacidade e Cookies no Já</span>
                  <span className="text-[11px] font-normal text-blue-700 bg-blue-50 dark:bg-blue-950 px-2 py-0.5 rounded-full border border-blue-200 dark:border-blue-900">
                    LGPD (Lei 13.709/2018)
                  </span>
                </p>
                <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 leading-relaxed max-w-3xl">
                  Utilizamos cookies essenciais para o funcionamento seguro da plataforma, controle
                  de sessão e auditoria. Cookies analíticos e de melhoria só são ativados com a sua
                  autorização explícita. Você pode alterar suas preferências a qualquer momento.
                  Consulte nossa{" "}
                  <Link
                    to="/privacidade"
                    className="font-medium text-blue-600 dark:text-blue-400 underline hover:text-blue-700"
                  >
                    Política de Privacidade
                  </Link>{" "}
                  e{" "}
                  <Link
                    to="/termos"
                    className="font-medium text-blue-600 dark:text-blue-400 underline hover:text-blue-700"
                  >
                    Termos de Uso
                  </Link>
                  .
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 w-full md:w-auto shrink-0 justify-end">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setModalAberto(true)}
                className="text-xs font-semibold h-9 rounded-lg border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 flex-1 sm:flex-initial"
              >
                Preferências
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleRejeitar}
                className="text-xs font-semibold h-9 rounded-lg border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 flex-1 sm:flex-initial"
              >
                Apenas Necessários
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={handleAceitarTodos}
                className="text-xs font-semibold h-9 rounded-lg bg-blue-600 hover:bg-blue-700 text-white shadow-xs flex-1 sm:flex-initial"
              >
                Aceitar Todos
              </Button>
            </div>
          </div>
        </section>
      )}

      {/* Modal de Preferências Granulares de Cookies */}
      <Dialog open={modalAberto} onOpenChange={setModalAberto}>
        <DialogContent className="sm:max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-lg sm:text-xl">
              <ShieldCheck className="size-5 text-blue-600" aria-hidden="true" />
              <span>Preferências de Privacidade e Cookies</span>
            </DialogTitle>
            <DialogDescription className="text-xs sm:text-sm text-slate-500">
              Personalize os cookies que você autoriza na plataforma Já, em total conformidade com a
              LGPD (Lei 13.709/2018).
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2 text-xs sm:text-sm">
            {/* Categoria 1: Necessários / Essenciais */}
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-3.5 bg-slate-50/70 dark:bg-slate-900/50 space-y-1.5">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-bold text-slate-900 dark:text-white">
                    1. Cookies Estritamente Necessários
                  </h3>
                  <span className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">
                    Sempre Ativos (Essenciais)
                  </span>
                </div>
                <span className="text-xs text-slate-400 font-medium">Obrigatório</span>
              </div>
              <p className="text-slate-600 dark:text-slate-400 leading-relaxed text-[11px] sm:text-xs">
                Garantem a autenticação do usuário, persistência segura da sessão via tokens
                criptografados, proteção CSRF e aplicação de políticas de isolamento multi-tenant
                (Row-Level Security). Sem esses cookies, a aplicação não funciona.
              </p>
            </div>

            {/* Categoria 2: Analíticos / Performance */}
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-3.5 bg-white dark:bg-slate-900 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <h3 className="font-bold text-slate-900 dark:text-white">
                    2. Cookies Analíticos e de Desempenho
                  </h3>
                  <span className="text-[11px] text-slate-500">
                    Google Analytics (com IP anonimizado)
                  </span>
                </div>
                <Switch
                  checked={analitico}
                  onCheckedChange={setAnalitico}
                  aria-label="Autorizar cookies analíticos e de desempenho"
                />
              </div>
              <p className="text-slate-600 dark:text-slate-400 leading-relaxed text-[11px] sm:text-xs">
                Coletam estatísticas agregadas e anônimas sobre páginas mais acessadas e taxa de
                erro, nos ajudando a aprimorar o desempenho das escalas e do ponto móvel. Nenhum
                dado pessoal de identificação direta (PII) é transmitido a terceiros.
              </p>
            </div>

            {/* Categoria 3: Comunicação e Funcionalidades */}
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-3.5 bg-white dark:bg-slate-900 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <h3 className="font-bold text-slate-900 dark:text-white">
                    3. Cookies de Comunicação e Suporte
                  </h3>
                  <span className="text-[11px] text-slate-500">
                    Preferências de interface e notificações operacionais
                  </span>
                </div>
                <Switch
                  checked={marketing}
                  onCheckedChange={setMarketing}
                  aria-label="Autorizar cookies de comunicação e suporte"
                />
              </div>
              <p className="text-slate-600 dark:text-slate-400 leading-relaxed text-[11px] sm:text-xs">
                Lembram preferências visuais (modo escuro/claro, filtros de eventos salvos) e
                possibilitam avisos contextuais sobre novos recursos da plataforma.
              </p>
            </div>
          </div>

          <DialogFooter className="flex-col sm:flex-row gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleRejeitar}
              className="w-full sm:w-auto text-xs"
            >
              Rejeitar Não Essenciais
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={handleSalvarPersonalizados}
              className="w-full sm:w-auto text-xs font-semibold"
            >
              Salvar Minhas Preferências
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={handleAceitarTodos}
              className="w-full sm:w-auto text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white"
            >
              Aceitar Todos
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
