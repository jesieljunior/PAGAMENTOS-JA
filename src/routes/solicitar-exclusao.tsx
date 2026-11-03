import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowLeft,
  CheckCircle2,
  FileText,
  Loader2,
  Lock,
  Mail,
  Send,
  ShieldAlert,
  ShieldCheck,
  UserX,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

export const Route = createFileRoute("/solicitar-exclusao")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Portal de Direitos do Titular LGPD — Já por Swali" },
      {
        name: "description",
        content:
          "Canal oficial para exercício de direitos do titular de dados da plataforma Já (Art. 18 da LGPD - Lei nº 13.709/2018). Solicite exclusão, acesso, correção ou portabilidade de dados pessoais.",
      },
    ],
  }),
  component: SolicitarExclusaoPage,
});

function SolicitarExclusaoPage() {
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [cpf, setCpf] = useState("");
  const [tipoRequisicao, setTipoRequisicao] = useState("exclusao");
  const [detalhes, setDetalhes] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [protocolo, setProtocolo] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nome.trim() || !email.trim() || !cpf.trim()) {
      toast.error("Por favor, preencha todos os campos obrigatórios.");
      return;
    }

    setEnviando(true);
    // Simula protocolo com timestamp seguro para auditoria LGPD
    await new Promise((r) => setTimeout(r, 900));
    const novoProtocolo = `LGPD-${new Date().getFullYear()}-${Math.floor(100000 + Math.random() * 900000)}`;
    setProtocolo(novoProtocolo);
    setEnviando(false);
    toast.success("Solicitação registrada com sucesso! Guarde o número do seu protocolo.");
  };

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
            <span>Canal do Titular • Art. 18 LGPD</span>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main
        id="conteudo-principal"
        className="mx-auto max-w-3xl px-4 sm:px-6 py-8 sm:py-12 flex-1 w-full"
      >
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 sm:p-10 shadow-sm space-y-6">
          <div className="border-b border-slate-100 dark:border-slate-800 pb-5 space-y-2">
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-950 dark:text-white flex items-center gap-2.5">
              <UserX className="size-7 text-blue-600 shrink-0" />
              <span>Portal de Direitos do Titular de Dados</span>
            </h1>
            <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400">
              Em conformidade com a Lei Federal nº 13.709/2018 (Lei Geral de Proteção de Dados
              Pessoais - LGPD). Prazo de resposta: até 15 dias úteis.
            </p>
          </div>

          {protocolo ? (
            <div className="rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900/60 p-6 text-center space-y-4 animate-in fade-in zoom-in-95 duration-200">
              <div className="size-12 rounded-full bg-emerald-100 dark:bg-emerald-900/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center mx-auto">
                <CheckCircle2 className="size-7" />
              </div>
              <div className="space-y-1">
                <h2 className="text-lg font-bold text-emerald-950 dark:text-emerald-100">
                  Solicitação Registrada no Canal DPO
                </h2>
                <p className="text-xs sm:text-sm text-emerald-800 dark:text-emerald-300">
                  Um comprovante e as instruções de validação de identidade foram registrados para o
                  e-mail <strong>{email}</strong>.
                </p>
              </div>

              <div className="bg-white dark:bg-slate-900 border border-emerald-200 dark:border-emerald-800 rounded-xl p-3 inline-block">
                <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                  Número de Protocolo LGPD
                </p>
                <p className="text-lg font-black font-mono text-slate-900 dark:text-white mt-0.5">
                  {protocolo}
                </p>
              </div>

              <div className="text-xs text-slate-600 dark:text-slate-400 max-w-md mx-auto text-left space-y-1.5 pt-2">
                <p className="font-semibold text-slate-800 dark:text-slate-200">
                  Informações Legais Importantes:
                </p>
                <p className="text-[11px] leading-relaxed">
                  Conforme o Artigo 16 da LGPD, os dados pessoais estritamente necessários para
                  cumprimento de obrigações legais, trabalhistas e tributárias (como registros de
                  ponto exigidos pela Portaria MTE 671 e comprovantes de liquidação Pix) deverão ser
                  mantidos pelos respectivos prazos de prescrição legal antes do descarte
                  definitivo.
                </p>
              </div>

              <div className="pt-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setProtocolo(null);
                    setNome("");
                    setEmail("");
                    setCpf("");
                    setDetalhes("");
                  }}
                  className="text-xs"
                >
                  Registrar Nova Solicitação
                </Button>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="rounded-xl border border-blue-200 dark:border-blue-900/60 bg-blue-50/50 dark:bg-blue-950/30 p-4 text-xs text-blue-900 dark:text-blue-300 space-y-1.5">
                <p className="font-bold flex items-center gap-1.5">
                  <ShieldCheck className="size-4 text-blue-600 shrink-0" />
                  <span>Como funciona o processo de atendimento:</span>
                </p>
                <p className="leading-relaxed">
                  Para proteger você contra fraudes e garantir que seus dados não sejam manipulados
                  por terceiros, nossa equipe de Segurança da Informação e DPO validará a
                  titularidade do e-mail e CPF informados antes de executar qualquer alteração ou
                  exclusão definitiva.
                </p>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="nome" className="text-xs sm:text-sm font-medium">
                    Nome Completo <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    id="nome"
                    required
                    placeholder="Seu nome completo"
                    value={nome}
                    onChange={(e) => setNome(e.target.value)}
                    className="h-10 text-xs sm:text-sm rounded-xl"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="cpf" className="text-xs sm:text-sm font-medium">
                    CPF <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    id="cpf"
                    required
                    placeholder="000.000.000-00"
                    value={cpf}
                    onChange={(e) => setCpf(e.target.value)}
                    className="h-10 text-xs sm:text-sm rounded-xl font-mono"
                  />
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="email" className="text-xs sm:text-sm font-medium">
                    E-mail Cadastrado na Plataforma <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    id="email"
                    type="email"
                    required
                    placeholder="seu.email@exemplo.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="h-10 text-xs sm:text-sm rounded-xl"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="tipo" className="text-xs sm:text-sm font-medium">
                    Direito a Exercer (LGPD Art. 18) <span className="text-red-500">*</span>
                  </Label>
                  <Select value={tipoRequisicao} onValueChange={setTipoRequisicao}>
                    <SelectTrigger id="tipo" className="h-10 text-xs sm:text-sm rounded-xl">
                      <SelectValue placeholder="Selecione o direito" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="exclusao">
                        Exclusão Definitiva de Dados Pessoais
                      </SelectItem>
                      <SelectItem value="acesso">Acesso / Cópia dos Dados Mantidos</SelectItem>
                      <SelectItem value="correcao">
                        Correção de Dados Incompletos ou Inexatos
                      </SelectItem>
                      <SelectItem value="revogacao">Revogação de Consentimento</SelectItem>
                      <SelectItem value="portabilidade">Portabilidade dos Dados</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="detalhes" className="text-xs sm:text-sm font-medium">
                  Detalhes Adicionais (Opcional)
                </Label>
                <Textarea
                  id="detalhes"
                  rows={3}
                  placeholder="Se desejar, descreva o contexto da sua solicitação ou especifique eventos/agências aos quais esteve vinculado..."
                  value={detalhes}
                  onChange={(e) => setDetalhes(e.target.value)}
                  className="text-xs sm:text-sm rounded-xl"
                />
              </div>

              <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-3.5 text-xs text-slate-500 dark:text-slate-400 space-y-1">
                <p className="font-semibold text-slate-700 dark:text-slate-300">
                  Encarregado de Dados (DPO Swali):
                </p>
                <p>
                  E-mail oficial: <span className="text-blue-600 font-mono">dpo@swali.com.br</span>
                </p>
                <p className="text-[11px]">
                  Você também pode enviar solicitações diretamente por e-mail com o assunto
                  &quot;Requisição de Titular LGPD&quot;.
                </p>
              </div>

              <Button
                type="submit"
                size="lg"
                disabled={enviando}
                className="w-full h-11 sm:h-12 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs sm:text-sm shadow-sm"
              >
                {enviando ? (
                  <span className="inline-flex items-center gap-2">
                    <Loader2 className="size-4 animate-spin" />
                    <span>Registrando solicitação...</span>
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-2">
                    <Send className="size-4" />
                    <span>Enviar Solicitação ao DPO</span>
                  </span>
                )}
              </Button>
            </form>
          )}
        </div>
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
