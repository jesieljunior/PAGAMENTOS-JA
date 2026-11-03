import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, CheckCircle2, Clock, DollarSign, RotateCcw, ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/reembolso")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Política de Reembolso e Cancelamento — Já por Swali (CDC)" },
      {
        name: "description",
        content:
          "Política de Reembolso e Cancelamento do SaaS Já em conformidade com o Código de Defesa do Consumidor (Art. 49 CDC). Direito de arrependimento em 7 dias e regras de cancelamento sem multas.",
      },
    ],
  }),
  component: PoliticaReembolsoPage,
});

function PoliticaReembolsoPage() {
  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex flex-col justify-between">
      {/* Top Header */}
      <header className="border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 sticky top-0 z-20">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-4 sm:px-6 py-3.5">
          <Link
            to="/"
            className="inline-flex items-center gap-2 text-xs sm:text-sm font-semibold text-slate-700 dark:text-slate-300 hover:text-blue-600 transition-colors"
          >
            <ArrowLeft className="size-4" />
            <span>Voltar ao início</span>
          </Link>
          <div className="inline-flex items-center gap-1.5 rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-300">
            <RotateCcw className="size-3.5 text-blue-600" />
            <span>Conforme Art. 49 do CDC</span>
          </div>
        </div>
      </header>

      {/* Main Document Content */}
      <main id="conteudo-principal" className="mx-auto max-w-4xl px-4 sm:px-6 py-8 sm:py-12 flex-1">
        <article className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 sm:p-10 shadow-sm space-y-8 leading-relaxed text-sm sm:text-base">
          {/* Header */}
          <div className="border-b border-slate-100 dark:border-slate-800 pb-6 space-y-2">
            <h1 className="text-2xl sm:text-4xl font-extrabold tracking-tight text-slate-950 dark:text-white">
              Política de Cancelamento e Reembolso
            </h1>
            <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400">
              Vigência a partir de: 03 de novembro de 2026 • Versão 2026.1 (Em cumprimento à Lei
              Federal nº 8.078/1990 — Código de Defesa do Consumidor)
            </p>
          </div>

          {/* Destaque CDC Art. 49 */}
          <div className="rounded-xl border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/70 dark:bg-emerald-950/40 p-4 sm:p-5 text-xs sm:text-sm text-emerald-950 dark:text-emerald-200 space-y-2">
            <p className="font-bold flex items-center gap-2 text-emerald-800 dark:text-emerald-300">
              <CheckCircle2 className="size-5 shrink-0" />
              <span>Garantia Legal de 7 Dias — Direito de Arrependimento (Art. 49 CDC)</span>
            </p>
            <p>
              Ao contratar qualquer plano comercial pago na plataforma Já, o cliente tem até{" "}
              <strong>7 (sete) dias corridos</strong> a partir da data da contratação para solicitar
              o cancelamento com <strong>estorno integral de 100% do valor pago</strong>, sem
              qualquer retenção, multa ou desconto de taxas administrativas.
            </p>
          </div>

          {/* Seção 1: Como Funciona o Teste Gratuito */}
          <section className="space-y-3">
            <h2 className="text-lg sm:text-xl font-bold text-slate-950 dark:text-white flex items-center gap-2">
              <span className="text-blue-600">1.</span> Período de Teste Gratuito (Trial de 7 Dias)
            </h2>
            <p className="text-slate-600 dark:text-slate-300">
              Todas as novas agências cadastradas contam com <strong>7 dias gratuitos</strong> de
              degustação para testar escalas, ponto móvel e fechamentos. Durante o teste gratuito:
            </p>
            <ul className="list-disc list-inside space-y-1.5 text-slate-700 dark:text-slate-300 pl-2">
              <li>Não é exigido cartão de crédito para iniciar.</li>
              <li>Não há cobrança automática ao final do período.</li>
              <li>
                Após os 7 dias, a agência escolhe se deseja contratar um plano comercial ou
                suspender o uso, sem nenhuma surpresa financeira.
              </li>
            </ul>
          </section>

          {/* Seção 2: Regras para Assinaturas Recorrentes */}
          <section className="space-y-3">
            <h2 className="text-lg sm:text-xl font-bold text-slate-950 dark:text-white flex items-center gap-2">
              <span className="text-blue-600">2.</span> Cancelamento de Mensalidades Recorrentes
            </h2>
            <p className="text-slate-600 dark:text-slate-300">
              Para assinaturas comerciais ativas (Starter, Pro, Enterprise):
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-1">
                <p className="font-bold text-slate-900 dark:text-white text-xs sm:text-sm flex items-center gap-1.5">
                  <Clock className="size-4 text-blue-600 shrink-0" />
                  <span>Sem Fidelidade ou Multas</span>
                </p>
                <p className="text-xs text-slate-600 dark:text-slate-400">
                  O cancelamento pode ser feito a qualquer momento no painel da agência. Não há
                  multas rescisórias ou carência mínima obrigatória.
                </p>
              </div>
              <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-1">
                <p className="font-bold text-slate-900 dark:text-white text-xs sm:text-sm flex items-center gap-1.5">
                  <DollarSign className="size-4 text-blue-600 shrink-0" />
                  <span>Acesso até o Fim do Ciclo</span>
                </p>
                <p className="text-xs text-slate-600 dark:text-slate-400">
                  Ao cancelar uma assinatura já faturada, o acesso aos recursos do plano contratado
                  permanece ativo até o último dia do ciclo mensal quitado.
                </p>
              </div>
            </div>
          </section>

          {/* Seção 3: Separação de Saldos */}
          <section className="space-y-3">
            <h2 className="text-lg sm:text-xl font-bold text-slate-950 dark:text-white flex items-center gap-2">
              <span className="text-blue-600">3.</span> Proteção e Devolução do Saldo Operacional
            </h2>
            <p className="text-slate-600 dark:text-slate-300">
              Em estrita conformidade com a arquitetura financeira da plataforma:
            </p>
            <div className="bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 rounded-xl p-4 text-xs sm:text-sm space-y-2">
              <p>
                O saldo aportado pela agência para pagamento de colaboradores via Pix (fundo
                operacional) <strong>pertence integral e exclusivamente à agência</strong> e fica
                custodiado em conta escrow segregada no parceiro financeiro homologado.
              </p>
              <p>
                Em caso de encerramento da conta, qualquer saldo operacional remanescente e não
                comprometido com escalas concluídas poderá ser resgatado integralmente pela agência
                para sua conta bancária de mesma titularidade (mesmo CNPJ).
              </p>
            </div>
          </section>

          {/* Seção 4: Como Solicitar */}
          <section className="space-y-3">
            <h2 className="text-lg sm:text-xl font-bold text-slate-950 dark:text-white flex items-center gap-2">
              <span className="text-blue-600">4.</span> Como Solicitar Reembolso
            </h2>
            <p className="text-slate-600 dark:text-slate-300">
              Para acionar a garantia legal de 7 dias ou sanar dúvidas sobre cobranças:
            </p>
            <div className="bg-blue-50/50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900/50 rounded-xl p-4 text-xs sm:text-sm space-y-2">
              <p>
                <strong>Envie um e-mail para o canal financeiro oficial:</strong>
              </p>
              <p className="text-blue-600 dark:text-blue-400 font-mono font-semibold">
                financeiro@swali.com.br
              </p>
              <p className="text-slate-600 dark:text-slate-400 text-xs">
                Informe o CNPJ da agência e a data do pagamento. O reembolso é processado em até 3
                (três) dias úteis após a solicitação, retornando via Pix ou estorno na fatura do
                cartão conforme a modalidade de pagamento utilizada.
              </p>
            </div>
          </section>
        </article>
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 py-6 text-center text-xs text-slate-500">
        <p>
          Já — Gestão de Equipes e Pagamentos • Desenvolvido por{" "}
          <a
            href="https://www.swali.com.br/"
            target="_blank"
            rel="noreferrer"
            className="font-semibold text-slate-700 dark:text-slate-300 underline hover:text-blue-600"
          >
            Swali Tecnologia LTDA
          </a>
        </p>
      </footer>
    </div>
  );
}
