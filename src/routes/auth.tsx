import { createFileRoute, Link, redirect, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  ArrowLeft,
  Building2,
  Check,
  CheckCircle2,
  CreditCard,
  KeyRound,
  Loader2,
  LogIn,
  Mail,
  ShieldCheck,
  Sparkles,
  UserPlus,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { cadastrarOuRedefinirUsuario } from "@/lib/auth.functions";
import {
  carregarDadosAcesso,
  extrairTokenOuLink,
  resolverDestinoAcesso,
} from "@/lib/auth-navigation";
import { formatarCnpjOuCpf, moeda } from "@/lib/dominio";
import { concluirCadastroComEmpresaEPlano } from "@/lib/onboarding.functions";
import { DIAS_TRIAL_PADRAO, PLANOS_CATALOGO } from "@/lib/planos-catalogo";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/auth")({
  ssr: false,
  beforeLoad: async () => {
    try {
      const { data } = await supabase.auth.getUser();
      if (data?.user) {
        const dados = await carregarDadosAcesso(supabase, data.user.id);
        const destino = resolverDestinoAcesso(dados);
        if (destino !== "/auth") {
          throw redirect({ to: destino });
        }
      }
    } catch (e) {
      if (e && typeof e === "object" && "to" in e) throw e;
    }
  },
  head: () => ({
    meta: [
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { title: "Entrar no Já — Gestão de Equipes e Pagamentos" },
      {
        name: "description",
        content:
          "Acesse o Já para gerenciar eventos, equipes, escalas, ponto em campo, fechamento de horas e pagamentos da sua agência.",
      },
      { property: "og:title", content: "Entrar no Já — Gestão de Equipes e Pagamentos" },
      {
        property: "og:description",
        content: "Acesso da agência ao painel de gestão de equipes e pagamento de colaboradores.",
      },
    ],
  }),
  component: Auth,
});

type ModoAuth = "login" | "cadastro" | "recuperar" | "confirmar";

function Auth() {
  const navigate = useNavigate();
  const cadastrarOuRedefinir = useServerFn(cadastrarOuRedefinirUsuario);
  const concluirOnboarding = useServerFn(concluirCadastroComEmpresaEPlano);
  const [modo, setModo] = useState<ModoAuth>("login");
  const [carregando, setCarregando] = useState(false);
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [nome, setNome] = useState("");
  const [nomeAgencia, setNomeAgencia] = useState("");
  const [cnpj, setCnpj] = useState("");
  const [planoCodigo, setPlanoCodigo] = useState("free");
  const [codigoAtivacao, setCodigoAtivacao] = useState("");
  const [recuperacaoEnviada, setRecuperacaoEnviada] = useState(false);
  const [concordaTermos, setConcordaTermos] = useState(false);

  const redirecionarParaDestino = useCallback(
    async (user: { id: string }) => {
      try {
        const dados = await carregarDadosAcesso(supabase, user.id);
        if (!dados.ativo) {
          toast.error("Conta desativada ou indisponível.");
          await supabase.auth.signOut();
          return;
        }
        const destino = resolverDestinoAcesso(dados);
        if (window.location.hash || window.location.search) {
          window.history.replaceState(null, "", window.location.pathname);
        }
        try {
          await (navigate as unknown as (opts: { to: string; replace?: boolean }) => Promise<void>)(
            { to: destino, replace: true },
          );
        } catch {
          window.location.href = destino;
        }
      } catch (err) {
        console.error("Falha ao resolver destino de acesso:", err);
        window.location.href = "/painel";
      }
    },
    [navigate],
  );

  const concluirOnboardingSePendente = useCallback(
    async (user: { id: string; user_metadata?: Record<string, unknown> }) => {
      const emailLimpo = email.trim().toLowerCase() || String(user.user_metadata?.["email"] || "");
      if (emailLimpo) {
        try {
          await supabase.from("usuarios").upsert({
            id: user.id,
            email: emailLimpo,
            nome: nome.trim() || String(user.user_metadata?.["nome"] || "Usuário"),
            ativo: true,
          });
        } catch {
          // segue
        }
      }

      const meta = (user.user_metadata || {}) as Record<string, string>;
      const ag = nomeAgencia.trim() || meta["nomeAgencia"];
      const doc = cnpj.replace(/\D+/g, "") || meta["cnpj"];
      const pl = planoCodigo || meta["planoCodigo"] || "free";

      if (ag && doc) {
        try {
          await concluirOnboarding({
            data: {
              nomeEmpresa: ag,
              cnpj: doc,
              planoCodigo: pl,
            },
          });
        } catch (e) {
          console.warn("Onboarding pós-confirmação executará no fluxo guiado:", e);
        }
      }
    },
    [cnpj, concluirOnboarding, email, nome, nomeAgencia, planoCodigo],
  );

  useEffect(() => {
    // 1. Trata código PKCE na query string (?code=...)
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    if (code) {
      supabase.auth.exchangeCodeForSession(code).then(async ({ data, error }) => {
        if (!error && data?.user) {
          await concluirOnboardingSePendente(data.user);
          toast.success("Conta ativada e autenticada com sucesso!");
          void redirecionarParaDestino(data.user);
        }
      });
    }

    // 2. Trata hash com tokens (#access_token=...&refresh_token=...)
    if (window.location.hash.includes("access_token=")) {
      const hash = window.location.hash.replace(/^#/, "");
      const hashParams = new URLSearchParams(hash);
      const accessToken = hashParams.get("access_token");
      const refreshToken = hashParams.get("refresh_token");
      if (accessToken && refreshToken) {
        supabase.auth
          .setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          })
          .then(async ({ data, error }) => {
            if (!error && data?.user) {
              await concluirOnboardingSePendente(data.user);
              toast.success("Conta ativada e autenticada com sucesso!");
              void redirecionarParaDestino(data.user);
            }
          });
      }
    }

    // 3. Listener de estado de autenticação Supabase
    const { data: authListener } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (session?.user && (event === "SIGNED_IN" || event === "USER_UPDATED")) {
        toast.success("Autenticado com sucesso!");
        await redirecionarParaDestino(session.user);
      }
    });

    // 4. Verificação de sessão já ativa no carregamento
    supabase.auth.getSession().then(async ({ data: sess }) => {
      if (sess.session?.user) {
        await redirecionarParaDestino(sess.session.user);
      }
    });

    return () => {
      authListener.subscription.unsubscribe();
    };
  }, [concluirOnboardingSePendente, redirecionarParaDestino]);

  // Handler: Fazer Login com Email e Senha
  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setCarregando(true);
    const emailLimpo = email.trim().toLowerCase();
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: emailLimpo,
        password: senha,
      });

      if (error) {
        setCarregando(false);
        const msg = (error.message || "").toLowerCase();
        if (msg.includes("invalid login") || msg.includes("invalid_credentials")) {
          toast.error(
            "E-mail ou senha incorretos. Se acabou de se cadastrar, confirme sua conta antes do primeiro acesso.",
            {
              action: {
                label: "Ativar conta",
                onClick: () => setModo("confirmar"),
              },
              duration: 9000,
            },
          );
        } else if (msg.includes("email not confirmed") || msg.includes("não confirmado")) {
          toast.info(
            "E-mail ainda não confirmado. Digite o código de 6 dígitos ou cole o link recebido para ativar.",
          );
          setModo("confirmar");
        } else {
          toast.error(error.message);
        }
        return;
      }

      if (data?.user) {
        toast.success("Login realizado com sucesso!");
        await redirecionarParaDestino(data.user);
      }
    } catch (err) {
      setCarregando(false);
      toast.error(err instanceof Error ? err.message : "Erro ao efetuar login.");
    }
  }

  // Handler: Reenviar E-mail de Confirmação
  async function handleReenviarConfirmacao() {
    const emailLimpo = email.trim().toLowerCase();
    if (!emailLimpo) {
      toast.error("Informe seu e-mail para reenviar a confirmação.");
      return;
    }
    setCarregando(true);
    try {
      const redirectUrl =
        typeof window !== "undefined" ? `${window.location.origin}/auth` : undefined;
      const { error } = await supabase.auth.resend({
        type: "signup",
        email: emailLimpo,
        ...(redirectUrl ? { options: { emailRedirectTo: redirectUrl } } : {}),
      });
      setCarregando(false);
      if (error) {
        toast.error(error.message || "Erro ao reenviar confirmação.");
      } else {
        toast.success("E-mail de confirmação reenviado! Verifique sua caixa de entrada.");
      }
    } catch {
      setCarregando(false);
      toast.error("Falha ao reenviar e-mail de confirmação.");
    }
  }

  // Handler: Confirmar / Ativar Conta por Código ou Link
  async function handleAtivarConta(e: React.FormEvent) {
    e.preventDefault();
    const emailLimpo = email.trim().toLowerCase();
    if (!emailLimpo) {
      toast.error("Informe seu e-mail cadastrado.");
      return;
    }
    const tokenOuLink = codigoAtivacao.trim();
    if (!tokenOuLink) {
      toast.error("Informe o código de 6 dígitos ou cole o link de ativação.");
      return;
    }

    setCarregando(true);
    try {
      const parsed = extrairTokenOuLink(tokenOuLink);

      // 1. Link com hash #access_token=...&refresh_token=...
      if (parsed.tipo === "tokens_hash" && parsed.accessToken && parsed.refreshToken) {
        const { data, error } = await supabase.auth.setSession({
          access_token: parsed.accessToken,
          refresh_token: parsed.refreshToken,
        });
        if (error) throw error;
        if (data.user) {
          await concluirOnboardingSePendente(data.user);
          toast.success("Conta ativada com sucesso!");
          await redirecionarParaDestino(data.user);
          return;
        }
      }

      // 2. Query param code (?code=...)
      if (parsed.tipo === "code_param" && parsed.code) {
        const { data, error } = await supabase.auth.exchangeCodeForSession(parsed.code);
        if (error) throw error;
        if (data?.user) {
          await concluirOnboardingSePendente(data.user);
          toast.success("Conta ativada com sucesso!");
          await redirecionarParaDestino(data.user);
          return;
        }
      }

      // 3. Query param token_hash (?token_hash=...)
      if (parsed.tipo === "token_hash_param" && parsed.tokenHash) {
        let res = await supabase.auth.verifyOtp({
          token_hash: parsed.tokenHash,
          type: (parsed.tokenType as "signup" | "email") || "signup",
        });
        if (res.error && parsed.tokenType !== "email") {
          res = await supabase.auth.verifyOtp({
            token_hash: parsed.tokenHash,
            type: "email",
          });
        }
        if (res.error) throw res.error;
        if (res.data?.user) {
          await concluirOnboardingSePendente(res.data.user);
          toast.success("Conta confirmada com sucesso! Bem-vindo ao Já.");
          await redirecionarParaDestino(res.data.user);
          return;
        }
      }

      const tokenEfetivo = parsed.token || tokenOuLink;

      // 4. VerifyOtp com signup
      let res = await supabase.auth.verifyOtp({
        email: emailLimpo,
        token: tokenEfetivo,
        type: "signup",
      });

      // 5. Se falhar, tenta com email
      if (res.error) {
        res = await supabase.auth.verifyOtp({
          email: emailLimpo,
          token: tokenEfetivo,
          type: "email",
        });
      }

      // 6. Se falhar, tenta com token_hash
      if (res.error) {
        res = await supabase.auth.verifyOtp({
          token_hash: tokenEfetivo,
          type: "signup",
        });
      }
      if (res.error) {
        res = await supabase.auth.verifyOtp({
          token_hash: tokenEfetivo,
          type: "email",
        });
      }

      if (res.error) {
        throw new Error(res.error.message);
      }

      setCarregando(false);
      if (res.data?.user) {
        await concluirOnboardingSePendente(res.data.user);
        toast.success("Conta confirmada com sucesso! Bem-vindo ao Já.");
        await redirecionarParaDestino(res.data.user);
      } else {
        toast.success("E-mail confirmado com sucesso! Faça login para continuar.");
        setModo("login");
      }
    } catch (err) {
      setCarregando(false);
      toast.error(
        err instanceof Error ? err.message : "Código ou link de confirmação inválido ou expirado.",
      );
    }
  }

  // Handler: Criar Nova Conta
  async function handleCadastro(e: React.FormEvent) {
    e.preventDefault();
    const emailLimpo = email.trim().toLowerCase();
    if (!nome.trim()) {
      toast.error("Por favor, informe seu nome.");
      return;
    }
    if (!nomeAgencia.trim()) {
      toast.error("Por favor, informe o nome da sua agência ou empresa.");
      return;
    }
    const docLimpo = cnpj.replace(/\D+/g, "");
    if (docLimpo.length < 11) {
      toast.error("Por favor, informe um CNPJ (14 dígitos) ou CPF (11 dígitos) válido.");
      return;
    }
    if (senha.length < 6) {
      toast.error("A senha deve ter no mínimo 6 caracteres.");
      return;
    }
    if (!concordaTermos) {
      toast.error(
        "Para prosseguir, você deve declarar que leu e concorda com os Termos de Uso e com a Política de Privacidade (LGPD).",
      );
      return;
    }

    setCarregando(true);
    try {
      let cadastroCriadoPorAdmin = false;

      // 1. Tenta função de servidor (caso SUPABASE_SERVICE_ROLE_KEY esteja configurada)
      try {
        const res = await cadastrarOuRedefinir({
          data: {
            email: emailLimpo,
            password: senha,
            nome: nome.trim(),
          },
        });
        if (res.sucesso && !res.isClientFlow) {
          cadastroCriadoPorAdmin = true;
        }
      } catch {
        // Sem chave administrativa ou falha de RPC de servidor; segue para o fluxo oficial de cliente
      }

      let signUpSession: { user?: unknown } | null = null;
      let signUpUser: { id: string } | null = null;

      // 2. Se não foi criado via admin no servidor, realiza signUp direto via Supabase Auth
      if (!cadastroCriadoPorAdmin) {
        const redirectUrl =
          typeof window !== "undefined" ? `${window.location.origin}/auth` : undefined;

        const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
          email: emailLimpo,
          password: senha,
          options: {
            ...(redirectUrl ? { emailRedirectTo: redirectUrl } : {}),
            data: {
              nome: nome.trim(),
              nomeAgencia: nomeAgencia.trim(),
              cnpj: docLimpo,
              planoCodigo,
            },
          },
        });

        if (signUpError) {
          setCarregando(false);
          const msg = signUpError.message?.toLowerCase() || "";
          if (msg.includes("already registered") || msg.includes("já cadastrado")) {
            toast.error("Este e-mail já possui cadastro. Faça login para continuar.");
            setModo("login");
            return;
          }
          if (msg.includes("weak") || msg.includes("pwned") || msg.includes("easy to guess")) {
            toast.error(
              "A senha informada é muito simples. Por favor, utilize uma senha mais forte.",
            );
            return;
          }
          toast.error(signUpError.message || "Falha ao criar conta.");
          return;
        }

        // Se o Supabase retornou identidades vazias, o usuário já existe
        if (
          signUpData?.user &&
          Array.isArray(signUpData.user.identities) &&
          signUpData.user.identities.length === 0
        ) {
          setCarregando(false);
          toast.error("Este e-mail já está cadastrado. Faça login com sua senha.");
          setModo("login");
          return;
        }

        signUpSession = signUpData?.session ?? null;
        signUpUser = signUpData?.user ?? null;
      }

      // 3. Caso o cadastro já tenha gerado sessão (auto-confirm ativo no Supabase ou via admin)
      if (signUpSession || cadastroCriadoPorAdmin) {
        let userAtivo = signUpUser;
        if (!signUpSession) {
          const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
            email: emailLimpo,
            password: senha,
          });
          if (authError) {
            setCarregando(false);
            toast.info("Conta cadastrada! Faça login com sua senha.");
            setModo("login");
            return;
          }
          userAtivo = authData.user;
        }

        if (userAtivo) {
          try {
            await supabase.from("usuarios").upsert({
              id: userAtivo.id,
              email: emailLimpo,
              nome: nome.trim(),
              ativo: true,
            });
          } catch (errUpsert) {
            console.warn("Falha no upsert preliminar de usuario:", errUpsert);
          }

          try {
            await concluirOnboarding({
              data: {
                nomeEmpresa: nomeAgencia.trim(),
                cnpj: docLimpo,
                planoCodigo,
              },
            });
          } catch (onboardingErr) {
            console.warn("Falha no onboarding imediato:", onboardingErr);
          }

          setCarregando(false);
          toast.success(
            planoCodigo === "free"
              ? `Conta e agência criadas! Você tem ${DIAS_TRIAL_PADRAO} dias de teste gratuito liberados.`
              : "Conta e agência criadas com sucesso! Bem-vindo ao Já.",
          );
          await redirecionarParaDestino(userAtivo);
          return;
        }
      }

      // 4. Se signUpData não possui session ativa, o Supabase exige confirmação de e-mail.
      // NÃO tentamos signInWithPassword, pois ele geraria 'Invalid login credentials'!
      setCarregando(false);
      setModo("confirmar");
      toast.info(
        "Conta cadastrada com sucesso! Verifique a mensagem enviada para o seu e-mail para ativar seu acesso (ou digite o código/link abaixo).",
        { duration: 10000 },
      );
    } catch (err) {
      setCarregando(false);
      toast.error(err instanceof Error ? err.message : "Erro inesperado ao cadastrar.");
    }
  }

  // Handler: Esqueci Minha Senha (Recuperação)
  async function handleRecuperarSenha(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) {
      toast.error("Por favor, digite seu e-mail.");
      return;
    }

    setCarregando(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${window.location.origin}/auth`,
      });

      setCarregando(false);
      if (error) {
        toast.error(error.message || "Erro ao solicitar recuperação de senha.");
        return;
      }

      setRecuperacaoEnviada(true);
      toast.success("E-mail de recuperação enviado! Verifique sua caixa de entrada.");
    } catch (err) {
      setCarregando(false);
      toast.error("Erro inesperado ao solicitar recuperação.");
    }
  }

  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-between bg-slate-50 dark:bg-slate-950 px-4 py-6 sm:px-6 sm:py-10">
      <div
        className={cn(
          "w-full my-auto transition-all duration-200",
          modo === "cadastro" ? "max-w-2xl" : "max-w-md",
        )}
      >
        {/* Cabeçalho da Marca */}
        <div className="mb-6 text-center space-y-1.5">
          <div className="inline-flex items-center gap-1.5 rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700 dark:border-blue-900/50 dark:bg-blue-950/50 dark:text-blue-300">
            <ShieldCheck className="size-3.5 text-blue-600" />
            <span>SaaS Corporativo por Swali</span>
          </div>
          <h1 className="text-3xl font-black tracking-tight text-slate-900 dark:text-white">Já</h1>
          <p className="text-xs sm:text-sm font-medium text-slate-500 dark:text-slate-400">
            Gestão de Equipes, Ponto e Pagamentos
          </p>
        </div>

        {/* Card Principal */}
        <div className="rounded-2xl border border-slate-200/80 bg-white p-5 sm:p-7 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          {/* 1. MODO: FAZER LOGIN */}
          {modo === "login" && (
            <div className="space-y-5">
              <div>
                <h2 className="text-xl font-bold text-slate-900 dark:text-white">Fazer login</h2>
                <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-1">
                  Entre com seu e-mail e senha cadastrados.
                </p>
              </div>

              <form onSubmit={handleLogin} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="email" className="text-xs sm:text-sm font-medium">
                    E-mail
                  </Label>
                  <Input
                    id="email"
                    type="email"
                    required
                    autoComplete="email"
                    placeholder="seu.email@empresa.com.br"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="h-11 text-base sm:text-sm rounded-xl"
                  />
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="senha" className="text-xs sm:text-sm font-medium">
                      Senha
                    </Label>
                    <button
                      type="button"
                      onClick={() => {
                        setRecuperacaoEnviada(false);
                        setModo("recuperar");
                      }}
                      className="text-xs font-semibold text-blue-600 hover:text-blue-700 hover:underline"
                    >
                      Esqueci minha senha
                    </button>
                  </div>
                  <Input
                    id="senha"
                    type="password"
                    required
                    autoComplete="current-password"
                    placeholder="••••••••"
                    value={senha}
                    onChange={(e) => setSenha(e.target.value)}
                    className="h-11 text-base sm:text-sm rounded-xl"
                  />
                </div>

                <Button
                  type="submit"
                  size="lg"
                  disabled={carregando}
                  className="w-full h-11 sm:h-12 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold text-sm sm:text-base shadow-sm transition-all"
                >
                  {carregando ? (
                    <span className="inline-flex items-center gap-2">
                      <Loader2 className="size-4 animate-spin" />
                      <span>Entrando...</span>
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-2">
                      <LogIn className="size-4" />
                      <span>Entrar no sistema</span>
                    </span>
                  )}
                </Button>
              </form>

              {/* Alternar para Cadastro e Reenviar Confirmação */}
              <div className="pt-4 border-t border-slate-100 dark:border-slate-800 text-center space-y-2">
                <p className="text-xs sm:text-sm text-slate-500">
                  Ainda não tem uma conta?{" "}
                  <button
                    type="button"
                    onClick={() => {
                      setModo("cadastro");
                    }}
                    className="font-bold text-blue-600 hover:text-blue-700 hover:underline ml-1"
                  >
                    Criar conta
                  </button>
                </p>
                <div>
                  <button
                    type="button"
                    onClick={() => setModo("confirmar")}
                    className="text-xs text-blue-600 hover:text-blue-700 hover:underline font-medium"
                  >
                    Já tem um código ou link de ativação? Ativar conta aqui
                  </button>
                </div>
                <div>
                  <button
                    type="button"
                    onClick={handleReenviarConfirmacao}
                    disabled={carregando}
                    className="text-xs text-slate-500 hover:text-blue-600 hover:underline"
                  >
                    Não recebeu a confirmação? Reenviar e-mail
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* 2. MODO: CRIAR CONTA */}
          {modo === "cadastro" && (
            <div className="space-y-5">
              <div>
                <h2 className="text-xl font-bold text-slate-900 dark:text-white">
                  Criar conta e agência
                </h2>
                <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-1">
                  Cadastre sua agência e comece com{" "}
                  <strong>{DIAS_TRIAL_PADRAO} dias de teste gratuito</strong>.
                </p>
              </div>

              <form onSubmit={handleCadastro} className="space-y-4">
                <div className="grid gap-3.5 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="nome" className="text-xs sm:text-sm font-medium">
                      Seu nome completo <span className="text-red-500">*</span>
                    </Label>
                    <Input
                      id="nome"
                      type="text"
                      required
                      placeholder="Ex: Carlos Eduardo"
                      value={nome}
                      onChange={(e) => setNome(e.target.value)}
                      className="h-11 text-base sm:text-sm rounded-xl"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="nomeAgencia" className="text-xs sm:text-sm font-medium">
                      Nome da agência / empresa <span className="text-red-500">*</span>
                    </Label>
                    <Input
                      id="nomeAgencia"
                      type="text"
                      required
                      placeholder="Ex: Prime Eventos"
                      value={nomeAgencia}
                      onChange={(e) => setNomeAgencia(e.target.value)}
                      className="h-11 text-base sm:text-sm rounded-xl"
                    />
                  </div>
                </div>

                <div className="grid gap-3.5 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="cnpj" className="text-xs sm:text-sm font-medium">
                      CNPJ ou CPF <span className="text-red-500">*</span>
                    </Label>
                    <Input
                      id="cnpj"
                      type="text"
                      required
                      placeholder="00.000.000/0000-00 ou CPF"
                      value={cnpj}
                      onChange={(e) => setCnpj(formatarCnpjOuCpf(e.target.value))}
                      className="h-11 text-base sm:text-sm rounded-xl"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="email-cad" className="text-xs sm:text-sm font-medium">
                      E-mail da agência ou corporativo <span className="text-red-500">*</span>
                    </Label>
                    <Input
                      id="email-cad"
                      type="email"
                      required
                      autoComplete="email"
                      placeholder="seu.email@empresa.com.br"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="h-11 text-base sm:text-sm rounded-xl"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="senha-cad" className="text-xs sm:text-sm font-medium">
                    Crie uma senha (mín. 6 caracteres) <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    id="senha-cad"
                    type="password"
                    required
                    minLength={6}
                    autoComplete="new-password"
                    placeholder="Mínimo de 6 dígitos"
                    value={senha}
                    onChange={(e) => setSenha(e.target.value)}
                    className="h-11 text-base sm:text-sm rounded-xl"
                  />
                </div>

                {/* Escolha do Plano */}
                <div className="pt-2 space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs sm:text-sm font-medium text-slate-800 dark:text-slate-200">
                      Escolha o plano inicial da agência
                    </Label>
                    <Badge
                      variant="outline"
                      className="border-emerald-500/40 text-emerald-700 bg-emerald-50 text-[11px] font-semibold dark:bg-emerald-950/40 dark:text-emerald-300"
                    >
                      {DIAS_TRIAL_PADRAO} dias grátis
                    </Badge>
                  </div>

                  <div className="grid gap-2.5 sm:grid-cols-2">
                    {PLANOS_CATALOGO.map((p) => {
                      const ehSel = planoCodigo === p.codigo;
                      const ehTrial = p.codigo === "free";
                      return (
                        <div
                          key={p.codigo}
                          role="button"
                          tabIndex={0}
                          onClick={() => setPlanoCodigo(p.codigo)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") setPlanoCodigo(p.codigo);
                          }}
                          className={cn(
                            "relative rounded-xl border p-3 text-left cursor-pointer transition-all outline-none",
                            ehSel
                              ? "border-blue-600 bg-blue-50/50 dark:bg-blue-950/30 ring-2 ring-blue-500 shadow-xs"
                              : "border-slate-200 dark:border-slate-800 hover:border-slate-300 bg-card",
                          )}
                        >
                          {p.badge && (
                            <span className="absolute -top-2 right-2 rounded-full bg-blue-600 px-1.5 py-0.2 text-[9px] font-bold text-white">
                              {p.badge}
                            </span>
                          )}
                          <div className="flex items-center justify-between">
                            <span className="font-bold text-xs sm:text-sm text-slate-900 dark:text-white">
                              {p.nome}
                            </span>
                            {ehSel ? (
                              <div className="size-4 rounded-full bg-blue-600 flex items-center justify-center text-white shrink-0">
                                <Check className="size-2.5 stroke-[3]" />
                              </div>
                            ) : (
                              <div className="size-4 rounded-full border border-slate-300 shrink-0" />
                            )}
                          </div>
                          <p className="mt-1 font-black text-sm sm:text-base text-slate-900 dark:text-white">
                            {ehTrial ? "R$ 0" : moeda(p.mensalidade)}
                            <span className="text-[10px] font-normal text-slate-500">
                              {ehTrial ? ` / ${DIAS_TRIAL_PADRAO} dias` : " / mês"}
                            </span>
                          </p>
                          <p className="text-[10px] text-slate-500 line-clamp-1 mt-0.5">
                            {p.participacoes_incluidas} participações inclusas · {p.descricao}
                          </p>
                        </div>
                      );
                    })}
                  </div>

                  <p className="text-[11px] text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/50 rounded-lg p-2 leading-tight">
                    💡 <strong>Regra de teste:</strong> O plano gratuito dura {DIAS_TRIAL_PADRAO}{" "}
                    dias a partir do cadastro. Após os {DIAS_TRIAL_PADRAO} dias, é necessário
                    escolher um plano para continuar, a não ser que a administração conceda mais
                    tempo.
                  </p>
                </div>

                {/* Declaração de Aceite de Termos e LGPD */}
                <div className="pt-1 pb-1">
                  <label className="flex items-start gap-2.5 text-xs text-slate-600 dark:text-slate-400 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      required
                      checked={concordaTermos}
                      onChange={(e) => setConcordaTermos(e.target.checked)}
                      className="size-4 mt-0.5 rounded border-slate-300 text-blue-600 focus:ring-blue-500 shrink-0 cursor-pointer"
                    />
                    <span className="leading-relaxed">
                      Declaro que li e concordo com os{" "}
                      <Link
                        to="/termos"
                        target="_blank"
                        className="font-semibold text-blue-600 underline hover:text-blue-700"
                      >
                        Termos de Uso
                      </Link>{" "}
                      e com a{" "}
                      <Link
                        to="/privacidade"
                        target="_blank"
                        className="font-semibold text-blue-600 underline hover:text-blue-700"
                      >
                        Política de Privacidade (LGPD)
                      </Link>
                      .
                    </span>
                  </label>
                </div>

                <Button
                  type="submit"
                  size="lg"
                  disabled={carregando}
                  className="w-full h-11 sm:h-12 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold text-sm sm:text-base shadow-sm transition-all"
                >
                  {carregando ? (
                    <span className="inline-flex items-center gap-2">
                      <Loader2 className="size-4 animate-spin" />
                      <span>Cadastrando agência e ativando teste...</span>
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-2">
                      <UserPlus className="size-4" />
                      <span>
                        {planoCodigo === "free"
                          ? `Criar conta e iniciar ${DIAS_TRIAL_PADRAO} dias grátis`
                          : "Criar conta e agência"}
                      </span>
                    </span>
                  )}
                </Button>
              </form>

              {/* Alternar para Login */}
              <div className="pt-4 border-t border-slate-100 dark:border-slate-800 text-center">
                <p className="text-xs sm:text-sm text-slate-500">
                  Já possui cadastro?{" "}
                  <button
                    type="button"
                    onClick={() => {
                      setModo("login");
                    }}
                    className="font-bold text-blue-600 hover:text-blue-700 hover:underline ml-1"
                  >
                    Fazer login
                  </button>
                </p>
              </div>
            </div>
          )}

          {/* 3. MODO: ESQUECI MINHA SENHA */}
          {modo === "recuperar" && (
            <div className="space-y-5">
              <div>
                <h2 className="text-xl font-bold text-slate-900 dark:text-white">
                  Esqueci minha senha
                </h2>
                <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-1">
                  Digite seu e-mail para receber as instruções de recuperação.
                </p>
              </div>

              {recuperacaoEnviada ? (
                <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-4 text-center space-y-3 dark:bg-emerald-950/40 dark:border-emerald-800">
                  <div className="mx-auto flex size-10 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 dark:bg-emerald-900 dark:text-emerald-300">
                    <CheckCircle2 className="size-6" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-emerald-900 dark:text-emerald-200">
                      Link enviado com sucesso!
                    </p>
                    <p className="text-xs text-emerald-700 dark:text-emerald-300 mt-1">
                      Verifique a caixa de entrada de <strong>{email}</strong> para redefinir sua
                      senha.
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setRecuperacaoEnviada(false);
                      setModo("login");
                    }}
                    className="w-full mt-2"
                  >
                    Voltar para o login
                  </Button>
                </div>
              ) : (
                <form onSubmit={handleRecuperarSenha} className="space-y-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="email-rec" className="text-xs sm:text-sm font-medium">
                      E-mail cadastrado
                    </Label>
                    <Input
                      id="email-rec"
                      type="email"
                      required
                      autoComplete="email"
                      placeholder="seu.email@empresa.com.br"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="h-11 text-base sm:text-sm rounded-xl"
                    />
                  </div>

                  <Button
                    type="submit"
                    size="lg"
                    disabled={carregando}
                    className="w-full h-11 sm:h-12 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold text-sm sm:text-base shadow-sm transition-all"
                  >
                    {carregando ? (
                      <span className="inline-flex items-center gap-2">
                        <Loader2 className="size-4 animate-spin" />
                        <span>Enviando...</span>
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-2">
                        <Mail className="size-4" />
                        <span>Enviar link de recuperação</span>
                      </span>
                    )}
                  </Button>

                  <div className="pt-2 text-center">
                    <button
                      type="button"
                      onClick={() => setModo("login")}
                      className="inline-flex items-center gap-1.5 text-xs sm:text-sm font-medium text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
                    >
                      <ArrowLeft className="size-3.5" />
                      <span>Voltar para o login</span>
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}

          {/* 4. MODO: ATIVAR / CONFIRMAR CONTA */}
          {modo === "confirmar" && (
            <div className="space-y-5">
              <div>
                <h2 className="text-xl font-bold text-slate-900 dark:text-white">Ativar conta</h2>
                <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-1">
                  Confirme seu e-mail para liberar seu acesso e iniciar os 7 dias de teste gratuito.
                </p>
              </div>

              <div className="rounded-xl border border-blue-200 bg-blue-50/70 p-3.5 text-xs text-blue-900 dark:border-blue-900/50 dark:bg-blue-950/40 dark:text-blue-200 space-y-1.5">
                <p className="font-semibold flex items-center gap-1.5">
                  <Mail className="size-4 text-blue-600 shrink-0" />
                  <span>Como ativar sua conta agora:</span>
                </p>
                <ul className="list-disc list-inside space-y-1 text-[11px] text-blue-800 dark:text-blue-300">
                  <li>
                    <strong>Opção 1:</strong> Abra a mensagem no seu e-mail e clique no botão{" "}
                    <em>Verify Email</em>.
                  </li>
                  <li>
                    <strong>Opção 2:</strong> No e-mail, clique com o botão direito em{" "}
                    <em>Verify Email</em>, escolha <em>"Copiar endereço do link"</em> e cole no
                    campo abaixo.
                  </li>
                  <li>
                    <strong>Opção 3:</strong> Digite o código de 6 dígitos no campo abaixo.
                  </li>
                </ul>
              </div>

              <form onSubmit={handleAtivarConta} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="email-conf" className="text-xs sm:text-sm font-medium">
                    E-mail cadastrado <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    id="email-conf"
                    type="email"
                    required
                    autoComplete="email"
                    placeholder="seu.email@empresa.com.br"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="h-11 text-base sm:text-sm rounded-xl"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="codigo-conf" className="text-xs sm:text-sm font-medium">
                    Código de 6 dígitos ou link recebido <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    id="codigo-conf"
                    type="text"
                    required
                    placeholder="Cole o link do botão ou digite os 6 dígitos"
                    value={codigoAtivacao}
                    onChange={(e) => setCodigoAtivacao(e.target.value)}
                    className="h-11 text-base sm:text-sm rounded-xl font-mono text-xs sm:text-sm tracking-normal"
                  />
                  <p className="text-[11px] text-slate-400">
                    Você pode colar o link completo recebido no e-mail ou digitar o código OTP.
                  </p>
                </div>

                <Button
                  type="submit"
                  size="lg"
                  disabled={carregando}
                  className="w-full h-11 sm:h-12 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold text-sm sm:text-base shadow-sm transition-all"
                >
                  {carregando ? (
                    <span className="inline-flex items-center gap-2">
                      <Loader2 className="size-4 animate-spin" />
                      <span>Validando ativação...</span>
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-2">
                      <CheckCircle2 className="size-4" />
                      <span>Confirmar e entrar</span>
                    </span>
                  )}
                </Button>

                <div className="pt-2 flex items-center justify-between text-xs text-slate-500">
                  <button
                    type="button"
                    onClick={() => setModo("login")}
                    className="inline-flex items-center gap-1 hover:text-slate-800 dark:hover:text-slate-200"
                  >
                    <ArrowLeft className="size-3.5" />
                    <span>Voltar ao login</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleReenviarConfirmacao}
                    disabled={carregando}
                    className="text-blue-600 hover:underline font-medium"
                  >
                    Reenviar confirmação
                  </button>
                </div>
              </form>
            </div>
          )}
        </div>
      </div>

      {/* Rodapé Institucional e Legal */}
      <footer className="mt-8 text-center text-xs text-slate-500 space-y-2 max-w-xl mx-auto">
        <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[11px]">
          <Link to="/privacidade" className="hover:text-blue-600 underline transition-colors">
            Política de Privacidade (LGPD)
          </Link>
          <span>•</span>
          <Link to="/termos" className="hover:text-blue-600 underline transition-colors">
            Termos de Uso
          </Link>
          <span>•</span>
          <Link to="/reembolso" className="hover:text-blue-600 underline transition-colors">
            Política de Reembolso (CDC)
          </Link>
          <span>•</span>
          <Link
            to="/solicitar-exclusao"
            className="hover:text-blue-600 underline transition-colors"
          >
            Portal do Titular (Art. 18 LGPD)
          </Link>
          <span>•</span>
          <button
            type="button"
            onClick={() => {
              if (typeof window !== "undefined") {
                window.dispatchEvent(new CustomEvent("ja:abrir_preferencias_cookies"));
              }
            }}
            className="text-blue-600 hover:underline cursor-pointer"
          >
            Preferências de Cookies
          </button>
        </div>
        <p className="text-[11px] text-slate-400">
          Já é um produto corporativo oficial desenvolvido e operado pela{" "}
          <a
            href="https://www.swali.com.br/"
            target="_blank"
            rel="noreferrer"
            className="font-semibold text-slate-600 dark:text-slate-300 underline hover:text-blue-600 transition-colors"
          >
            Swali Tecnologia LTDA (CNPJ 54.321.987/0001-20)
          </a>
        </p>
      </footer>
    </div>
  );
}
