import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowLeft,
  CheckCircle2,
  FileText,
  Lock,
  Mail,
  Scale,
  ShieldAlert,
  ShieldCheck,
  UserCheck,
} from "lucide-react";

import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/privacidade")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Política de Privacidade — Já por Swali (LGPD)" },
      {
        name: "description",
        content:
          "Política de Privacidade da plataforma Já em total conformidade com a Lei Geral de Proteção de Dados (LGPD - Lei nº 13.709/2018). Conheça seus direitos, bases legais e como protegemos seus dados.",
      },
    ],
  }),
  component: PoliticaPrivacidadePage,
});

function PoliticaPrivacidadePage() {
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
            <ShieldCheck className="size-3.5 text-blue-600" />
            <span>Conforme LGPD (Lei 13.709/2018)</span>
          </div>
        </div>
      </header>

      {/* Main Document Content */}
      <main id="conteudo-principal" className="mx-auto max-w-4xl px-4 sm:px-6 py-8 sm:py-12 flex-1">
        <article className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 sm:p-10 shadow-sm space-y-8 leading-relaxed text-sm sm:text-base">
          {/* Header */}
          <div className="border-b border-slate-100 dark:border-slate-800 pb-6 space-y-2">
            <h1 className="text-2xl sm:text-4xl font-extrabold tracking-tight text-slate-950 dark:text-white">
              Política de Privacidade e Proteção de Dados
            </h1>
            <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400">
              Última atualização: 03 de novembro de 2026 • Versão 2026.1 (Em conformidade com a LGPD
              e Portaria MTE 671/2021)
            </p>
          </div>

          {/* Destaque Institucional */}
          <div className="rounded-xl border border-blue-200 dark:border-blue-900/60 bg-blue-50/60 dark:bg-blue-950/40 p-4 sm:p-5 text-xs sm:text-sm text-blue-950 dark:text-blue-200 space-y-2">
            <p className="font-bold flex items-center gap-2 text-blue-800 dark:text-blue-300">
              <Scale className="size-4.5 shrink-0" />
              <span>Compromisso Swali com a sua Privacidade</span>
            </p>
            <p>
              A <strong>Swali Tecnologia</strong> valoriza a segurança, a transparência e a
              confidencialidade dos dados tratados na plataforma <strong>Já</strong>. Esta política
              descreve de forma clara quais dados coletamos, por que os coletamos, onde são
              armazenados e como você pode exercer todos os seus direitos garantidos pela{" "}
              <strong>Lei Geral de Proteção de Dados Pessoais (Lei nº 13.709/2018 — LGPD)</strong>.
            </p>
          </div>

          {/* Seção 1: Identificação da Controladora */}
          <section className="space-y-3">
            <h2 className="text-lg sm:text-xl font-bold text-slate-950 dark:text-white flex items-center gap-2">
              <span className="text-blue-600">1.</span> Identificação da Controladora e do DPO
            </h2>
            <p className="text-slate-600 dark:text-slate-300">
              A plataforma <strong>Já</strong> é operada pela <strong>Swali Tecnologia LTDA</strong>
              , pessoa jurídica de direito privado, inscrita no CNPJ sob o nº 54.321.987/0001-20,
              com sede no Brasil.
            </p>
            <div className="bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 rounded-xl p-4 text-xs sm:text-sm space-y-1">
              <p>
                <strong>Canal Oficial do Encarregado de Proteção de Dados (DPO):</strong>
              </p>
              <p className="text-blue-600 dark:text-blue-400 font-mono">dpo@swali.com.br</p>
              <p className="text-slate-500 text-[11px] mt-1">
                Para dúvidas, pedidos de exclusão, revogação de consentimento ou relatórios de
                impacto à privacidade.
              </p>
            </div>
          </section>

          {/* Seção 2: Princípio da Coleta Mínima */}
          <section className="space-y-3">
            <h2 className="text-lg sm:text-xl font-bold text-slate-950 dark:text-white flex items-center gap-2">
              <span className="text-blue-600">2.</span> Princípio da Coleta Mínima de Dados (Art.
              6º, III LGPD)
            </h2>
            <p className="text-slate-600 dark:text-slate-300">
              Coletamos estritamente os dados necessários para o cumprimento da finalidade do
              serviço contratado, vedada a coleta excessiva ou desproporcional. Os dados coletados
              são:
            </p>
            <ul className="list-disc list-inside space-y-1.5 text-slate-700 dark:text-slate-300 pl-2">
              <li>
                <strong>Gestores de Agência:</strong> Nome completo, e-mail corporativo, CNPJ ou CPF
                da agência, dados para faturamento SaaS e credenciais de acesso seguro com hash
                criptográfico.
              </li>
              <li>
                <strong>Colaboradores e Freelancers:</strong> Nome, CPF (necessário para validação
                fiscal e identificação em conformidade com o Art. 11 da Portaria MTE 671/2021),
                chave Pix (para quitação de cachês e diárias) e número de telefone/WhatsApp para
                confirmação de escala.
              </li>
              <li>
                <strong>Registro de Ponto Operacional:</strong> Horário de marcação, coordenadas
                geográficas de latitude/longitude capturadas no momento exato do registro (para
                comprovação de comparecimento no local do evento) e fotografia (selfie de
                evidência).
              </li>
            </ul>
          </section>

          {/* Seção 3: Tratamento de Selfies e Evidências */}
          <section className="space-y-3">
            <h2 className="text-lg sm:text-xl font-bold text-slate-950 dark:text-white flex items-center gap-2">
              <span className="text-blue-600">3.</span> Tratamento de Selfies: Evidência de
              Auditoria Humana
            </h2>
            <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/60 rounded-xl p-4 text-xs sm:text-sm text-amber-900 dark:text-amber-200 space-y-2">
              <p className="font-bold flex items-center gap-1.5">
                <ShieldAlert className="size-4 shrink-0 text-amber-600" />
                <span>Declaração Expressa de Natureza das Fotos:</span>
              </p>
              <p>
                As fotos (selfies) capturadas no ponto móvel têm natureza exclusiva de{" "}
                <strong>
                  evidência documental para conferência visual humana por supervisores
                </strong>
                , amparadas pelo cumprimento de obrigação legal e execução de contrato de trabalho /
                prestação de serviços.
              </p>
              <p>
                A plataforma <strong>NÃO realiza prova de vida biométrica automatizada</strong>,
                perfilamento biométrico nem comercialização de dados faciais. A retenção das fotos é
                temporária e configurável pela agência para auditoria fiscal e trabalhista.
              </p>
            </div>
          </section>

          {/* Seção 4: Bases Legais */}
          <section className="space-y-3">
            <h2 className="text-lg sm:text-xl font-bold text-slate-950 dark:text-white flex items-center gap-2">
              <span className="text-blue-600">4.</span> Bases Legais de Tratamento (Art. 7º da LGPD)
            </h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-3.5 space-y-1">
                <p className="font-bold text-slate-900 dark:text-white text-xs sm:text-sm flex items-center gap-1.5">
                  <CheckCircle2 className="size-4 text-emerald-600 shrink-0" />
                  <span>Execução de Contrato (Art. 7º, V)</span>
                </p>
                <p className="text-xs text-slate-600 dark:text-slate-400">
                  Gestão das escalas de eventos, apuração de horas trabalhadas e processamento do
                  pagamento via Pix.
                </p>
              </div>
              <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-3.5 space-y-1">
                <p className="font-bold text-slate-900 dark:text-white text-xs sm:text-sm flex items-center gap-1.5">
                  <CheckCircle2 className="size-4 text-emerald-600 shrink-0" />
                  <span>Cumprimento de Obrigação Legal (Art. 7º, II)</span>
                </p>
                <p className="text-xs text-slate-600 dark:text-slate-400">
                  Emissão de comprovantes fiscais, registro de ponto em conformidade com a Portaria
                  MTE 671/2021 e guarda de registros do Marco Civil da Internet.
                </p>
              </div>
            </div>
          </section>

          {/* Seção 5: Subprocessadores e Terceiros */}
          <section className="space-y-3">
            <h2 className="text-lg sm:text-xl font-bold text-slate-950 dark:text-white flex items-center gap-2">
              <span className="text-blue-600">5.</span> Compartilhamento com Terceiros e
              Subprocessadores
            </h2>
            <p className="text-slate-600 dark:text-slate-300">
              Não vendemos, alugamos nem comercializamos dados pessoais sob qualquer hipótese. O
              compartilhamento é restrito a parceiros de infraestrutura auditados:
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs sm:text-sm border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300">
                    <th className="py-2.5 font-bold">Parceiro</th>
                    <th className="py-2.5 font-bold">Finalidade</th>
                    <th className="py-2.5 font-bold">Segurança</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-slate-600 dark:text-slate-400">
                  <tr>
                    <td className="py-2.5 font-medium text-slate-900 dark:text-white">
                      Supabase Inc.
                    </td>
                    <td className="py-2.5">
                      Banco de dados PostgreSQL com RLS e autenticação criptografada.
                    </td>
                    <td className="py-2.5">SOC2 Tipo II, criptografia em trânsito e repouso.</td>
                  </tr>
                  <tr>
                    <td className="py-2.5 font-medium text-slate-900 dark:text-white">
                      Asaas / Mercado Pago
                    </td>
                    <td className="py-2.5">
                      Instituições de pagamento autorizadas pelo Bacen para liquidação de Pix e
                      faturas SaaS.
                    </td>
                    <td className="py-2.5">PCI-DSS, regulado pelo Banco Central do Brasil.</td>
                  </tr>
                  <tr>
                    <td className="py-2.5 font-medium text-slate-900 dark:text-white">
                      Google MediaPipe (Local)
                    </td>
                    <td className="py-2.5">
                      Processamento local no navegador para detecção de enquadramento de foto.
                    </td>
                    <td className="py-2.5">
                      Execução 100% no dispositivo do usuário; nenhuma foto é enviada a servidores
                      do Google.
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          {/* Seção 6: Direitos dos Titulares */}
          <section className="space-y-3">
            <h2 className="text-lg sm:text-xl font-bold text-slate-950 dark:text-white flex items-center gap-2">
              <span className="text-blue-600">6.</span> Seus Direitos como Titular (Art. 18 LGPD)
            </h2>
            <p className="text-slate-600 dark:text-slate-300">
              Você pode exercer a qualquer momento os seguintes direitos através do nosso canal DPO
              ou pelo portal interativo:
            </p>
            <ul className="grid gap-2 sm:grid-cols-2 text-xs sm:text-sm text-slate-700 dark:text-slate-300">
              <li className="flex items-center gap-2">
                <span className="size-1.5 rounded-full bg-blue-600" />
                Confirmação da existência de tratamento;
              </li>
              <li className="flex items-center gap-2">
                <span className="size-1.5 rounded-full bg-blue-600" />
                Acesso aos dados pessoais mantidos;
              </li>
              <li className="flex items-center gap-2">
                <span className="size-1.5 rounded-full bg-blue-600" />
                Correção de dados incompletos ou inexatos;
              </li>
              <li className="flex items-center gap-2">
                <span className="size-1.5 rounded-full bg-blue-600" />
                Anonimização, bloqueio ou eliminação;
              </li>
              <li className="flex items-center gap-2">
                <span className="size-1.5 rounded-full bg-blue-600" />
                Portabilidade dos dados a outro fornecedor;
              </li>
              <li className="flex items-center gap-2">
                <span className="size-1.5 rounded-full bg-blue-600" />
                Revogação expressa do consentimento.
              </li>
            </ul>

            <div className="pt-2">
              <Button
                asChild
                size="sm"
                className="bg-blue-600 hover:bg-blue-700 text-white text-xs"
              >
                <Link to="/solicitar-exclusao">
                  Abrir Solicitação de Direitos do Titular (LGPD)
                </Link>
              </Button>
            </div>
          </section>

          {/* Seção 7: Retenção e Descarte */}
          <section className="space-y-3">
            <h2 className="text-lg sm:text-xl font-bold text-slate-950 dark:text-white flex items-center gap-2">
              <span className="text-blue-600">7.</span> Retenção, Segurança e Descarte
            </h2>
            <p className="text-slate-600 dark:text-slate-300">
              Os dados de ponto e fechamento financeiro são preservados pelos prazos prescricionais
              exigidos pela legislação trabalhista, tributária e previdenciária (art. 16 da LGPD).
              Findo o prazo de guarda legal ou mediante solicitação válida do titular, os dados são
              eliminados com segurança ou anonimizados.
            </p>
          </section>

          {/* Seção 8: Foro e Leis Aplicáveis */}
          <section className="space-y-3 border-t border-slate-100 dark:border-slate-800 pt-6">
            <h2 className="text-lg sm:text-xl font-bold text-slate-950 dark:text-white flex items-center gap-2">
              <span className="text-blue-600">8.</span> Legislação e Foro
            </h2>
            <p className="text-slate-600 dark:text-slate-300">
              Esta Política é regida pelas leis da República Federativa do Brasil, em especial a Lei
              Geral de Proteção de Dados (Lei nº 13.709/2018) e o Marco Civil da Internet (Lei nº
              12.965/2014). Fica eleito o Foro da Comarca da sede da Swali Tecnologia para dirimir
              quaisquer controvérsias oriundas deste documento.
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
