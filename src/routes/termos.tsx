import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, CheckCircle2, FileCheck, Scale, ShieldCheck } from "lucide-react";

export const Route = createFileRoute("/termos")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Termos de Uso — Já por Swali" },
      {
        name: "description",
        content:
          "Termos de Uso e Condições Gerais de Prestação de Serviços da plataforma SaaS Já, desenvolvida pela Swali Tecnologia LTDA. Regras de contratação, operação e conformidade legal.",
      },
    ],
  }),
  component: TermosUsoPage,
});

function TermosUsoPage() {
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
            <FileCheck className="size-3.5 text-blue-600" />
            <span>Contrato de Licenciamento SaaS</span>
          </div>
        </div>
      </header>

      {/* Main Document Content */}
      <main id="conteudo-principal" className="mx-auto max-w-4xl px-4 sm:px-6 py-8 sm:py-12 flex-1">
        <article className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 sm:p-10 shadow-sm space-y-8 leading-relaxed text-sm sm:text-base">
          {/* Header */}
          <div className="border-b border-slate-100 dark:border-slate-800 pb-6 space-y-2">
            <h1 className="text-2xl sm:text-4xl font-extrabold tracking-tight text-slate-950 dark:text-white">
              Termos de Uso e Condições Gerais do Serviço
            </h1>
            <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400">
              Vigência a partir de: 03 de novembro de 2026 • Versão 2026.1 (Em conformidade com o
              Marco Civil da Internet e Código Civil Brasileiro)
            </p>
          </div>

          {/* Seção 1: Objeto do Serviço */}
          <section className="space-y-3">
            <h2 className="text-lg sm:text-xl font-bold text-slate-950 dark:text-white flex items-center gap-2">
              <span className="text-blue-600">1.</span> Objeto da Plataforma
            </h2>
            <p className="text-slate-600 dark:text-slate-300">
              O <strong>Já</strong> é uma plataforma de software como serviço (SaaS B2B),
              desenvolvida e licenciada pela <strong>Swali Tecnologia LTDA</strong>, voltada para
              gestão operacional de equipes em eventos, controle de escalas, registro de ponto
              eletrônico com evidência fotográfica e fechamento financeiro de pagamentos via Pix.
            </p>
          </section>

          {/* Seção 2: Contas e Acesso Seguro */}
          <section className="space-y-3">
            <h2 className="text-lg sm:text-xl font-bold text-slate-950 dark:text-white flex items-center gap-2">
              <span className="text-blue-600">2.</span> Contas de Acesso e Responsabilidades
            </h2>
            <p className="text-slate-600 dark:text-slate-300">
              O acesso à plataforma é destinado a agências, produtoras e empresas regularmente
              constituídas. A agência contratante é a única e exclusiva responsável por:
            </p>
            <ul className="list-disc list-inside space-y-1.5 text-slate-700 dark:text-slate-300 pl-2">
              <li>
                Manter a estrita confidencialidade de suas credenciais de login e senhas de acesso.
              </li>
              <li>
                Garantir que os dados cadastrais da empresa e dos colaboradores vinculados sejam
                verdadeiros, atuais e completos.
              </li>
              <li>
                Atribuir os papéis corretos (Administrador, Coordenador, Supervisor) com base no
                princípio do menor privilégio.
              </li>
            </ul>
          </section>

          {/* Seção 3: Conformidade Trabalhista (Portaria 671 MTE) */}
          <section className="space-y-3">
            <h2 className="text-lg sm:text-xl font-bold text-slate-950 dark:text-white flex items-center gap-2">
              <span className="text-blue-600">3.</span> Ponto Eletrônico e Portaria MTE 671/2021
            </h2>
            <p className="text-slate-600 dark:text-slate-300">
              A funcionalidade de registro de ponto móvel disponibilizada pelo Já constitui sistema
              eletrônico de controle de jornada em campo:
            </p>
            <ul className="list-disc list-inside space-y-1.5 text-slate-700 dark:text-slate-300 pl-2">
              <li>
                <strong>Validação e Auditoria:</strong> Cada marcação gera comprovante digital com
                data, hora, coordenadas de GPS aproximadas e foto do colaborador.
              </li>
              <li>
                <strong>Responsabilidade da Agência:</strong> A agência contratante é responsável
                por formalizar o uso do controle eletrônico de ponto junto aos seus colaboradores ou
                em acordos/convenções coletivas de trabalho cabíveis.
              </li>
              <li>
                <strong>Inviolabilidade:</strong> O sistema mantém trilhas de auditoria auditadas
                (audit logs) que registram aprovações e revisões de supervisores, impedindo
                alterações retroativas sem histórico rastreável.
              </li>
            </ul>
          </section>

          {/* Seção 4: Pagamentos, Faturas e Billing V2 */}
          <section className="space-y-3">
            <h2 className="text-lg sm:text-xl font-bold text-slate-950 dark:text-white flex items-center gap-2">
              <span className="text-blue-600">4.</span> Planos, Assinaturas e Faturamento
            </h2>
            <p className="text-slate-600 dark:text-slate-300">
              Os planos comerciais da plataforma (Free Trial de 7 dias, Starter, Pro, Enterprise)
              são faturados de forma recorrente via gateways parceiros (Asaas / Mercado Pago).
            </p>
            <div className="bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 rounded-xl p-4 text-xs sm:text-sm space-y-1.5">
              <p className="font-bold text-slate-900 dark:text-white">
                Regras de Cobrança e Auditoria V2:
              </p>
              <ul className="list-disc list-inside space-y-1 text-slate-600 dark:text-slate-400">
                <li>
                  O plano gratuito de testes concede 7 dias de acesso sem cobrança a partir da data
                  de cadastro.
                </li>
                <li>
                  Após o término do período de teste gratuito, a continuidade dos serviços fica
                  condicionada à contratação de um dos planos comerciais vigentes.
                </li>
                <li>
                  O faturamento da mensalidade do SaaS é estritamente separado do saldo de quitação
                  de prestadores de serviço (Pix dos freelancers). O Já não retém nem cobra
                  comissões percentuais sobre os cachês pagos aos trabalhadores.
                </li>
              </ul>
            </div>
          </section>

          {/* Seção 5: Práticas Proibidas */}
          <section className="space-y-3">
            <h2 className="text-lg sm:text-xl font-bold text-slate-950 dark:text-white flex items-center gap-2">
              <span className="text-blue-600">5.</span> Condutas Vedadas
            </h2>
            <p className="text-slate-600 dark:text-slate-300">
              É expressamente proibido aos usuários e empresas contratantes:
            </p>
            <ul className="list-disc list-inside space-y-1 text-slate-700 dark:text-slate-300 pl-2">
              <li>
                Burlar mecanismos de segurança, RLS (Row-Level Security) ou validação de ponto.
              </li>
              <li>
                Realizar engenharia reversa, descompilação ou cópia de código-fonte da aplicação.
              </li>
              <li>
                Utilizar robôs, scrapers ou rotinas automatizadas não autorizadas contra as APIs da
                plataforma.
              </li>
              <li>
                Inserir dados falsos de terceiros, forjar marcações de ponto ou simular presenças
                não ocorridas.
              </li>
            </ul>
          </section>

          {/* Seção 6: Propriedade Intelectual */}
          <section className="space-y-3">
            <h2 className="text-lg sm:text-xl font-bold text-slate-950 dark:text-white flex items-center gap-2">
              <span className="text-blue-600">6.</span> Propriedade Intelectual
            </h2>
            <p className="text-slate-600 dark:text-slate-300">
              Todos os direitos sobre a marca <strong>Já</strong>, logotipos, interfaces, códigos,
              bancos de dados e infraestrutura pertencem com exclusividade à{" "}
              <strong>Swali Tecnologia LTDA</strong>, protegidos pela Lei de Direitos Autorais (Lei
              nº 9.610/1998) e pela Lei de Propriedade Industrial (Lei nº 9.279/1996).
            </p>
          </section>

          {/* Seção 7: Cancelamento e Reembolso */}
          <section className="space-y-3">
            <h2 className="text-lg sm:text-xl font-bold text-slate-950 dark:text-white flex items-center gap-2">
              <span className="text-blue-600">7.</span> Cancelamento e Reembolso
            </h2>
            <p className="text-slate-600 dark:text-slate-300">
              O cancelamento pode ser efetuado a qualquer momento pelo administrador da agência no
              painel de configurações. Para detalhes sobre prazos, direito de arrependimento (Art.
              49 CDC) e estornos, consulte nossa{" "}
              <Link
                to="/reembolso"
                className="font-medium text-blue-600 dark:text-blue-400 underline hover:text-blue-700"
              >
                Política de Reembolso e Cancelamento
              </Link>
              .
            </p>
          </section>

          {/* Seção 8: Foro e Legislação */}
          <section className="space-y-3 border-t border-slate-100 dark:border-slate-800 pt-6">
            <h2 className="text-lg sm:text-xl font-bold text-slate-950 dark:text-white flex items-center gap-2">
              <span className="text-blue-600">8.</span> Legislação Aplicável e Foro de Eleição
            </h2>
            <p className="text-slate-600 dark:text-slate-300">
              Estes Termos são regidos pelas leis da República Federativa do Brasil. Para dirimir
              qualquer controvérsia decorrente da interpretação ou execução deste instrumento, fica
              eleito o Foro da Comarca da sede da Swali Tecnologia, renunciando a qualquer outro por
              mais privilegiado que seja.
            </p>
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
