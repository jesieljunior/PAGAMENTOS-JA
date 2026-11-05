import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  CheckCircle2,
  Copy,
  CreditCard,
  ExternalLink,
  Eye,
  EyeOff,
  Lock,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { AppShell } from "@/components/app-shell";
import { ErrorState, LoadingBloco } from "@/components/states";
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
import { Switch } from "@/components/ui/switch";
import { useSessao } from "@/hooks/use-sessao";
import { supabase } from "@/integrations/supabase/client";
import { moeda, type Configuracao } from "@/lib/dominio";
import {
  obterConfiguracaoMercadoPago,
  salvarCredenciaisMercadoPago,
} from "@/lib/mercadopago.functions";

export const Route = createFileRoute("/_authenticated/configuracoes")({
  head: () => ({
    meta: [
      { title: "Configurações da agência — Já" },
      {
        name: "description",
        content:
          "Defina as regras da operação: selfie e GPS no check-in, confirmação de presença, substituição de freelancer e ocorrências.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { property: "og:title", content: "Configurações da agência — Já" },
      {
        property: "og:description",
        content: "Regras de check-in, confirmação, substituição e ocorrências.",
      },
    ],
  }),
  component: Configuracoes,
});

const CAMPOS: {
  chave: keyof Pick<
    Configuracao,
    | "checkin_exige_selfie"
    | "checkin_exige_gps"
    | "escala_exige_confirmacao_presenca"
    | "substituicao_habilitada"
    | "ocorrencias_habilitadas"
  >;
  titulo: string;
  descricao: string;
}[] = [
  {
    chave: "checkin_exige_selfie",
    titulo: "Selfie no check-in",
    descricao: "O freelancer precisa enviar uma foto ao registrar o ponto.",
  },
  {
    chave: "checkin_exige_gps",
    titulo: "Localização no check-in",
    descricao: "O ponto só é aceito com a localização do dispositivo.",
  },
  {
    chave: "escala_exige_confirmacao_presenca",
    titulo: "Exigir confirmação de presença",
    descricao: "O evento só fica pronto quando a equipe confirmar a escala.",
  },
  {
    chave: "substituicao_habilitada",
    titulo: "Permitir substituição",
    descricao: "Coordenação pode trocar um freelancer que recusou ou faltou.",
  },
  {
    chave: "ocorrencias_habilitadas",
    titulo: "Registro de ocorrências",
    descricao: "Supervisores podem registrar ocorrências durante o evento.",
  },
];

function Configuracoes() {
  const { empresaId } = useSessao();
  const queryClient = useQueryClient();

  const q = useQuery({
    queryKey: ["configuracoes", empresaId],
    enabled: Boolean(empresaId),
    queryFn: async () => {
      if (!empresaId) throw new Error("Agência não encontrada.");
      const { data, error } = await supabase
        .from("configuracoes")
        .select("*")
        .eq("empresa_id", empresaId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const plano = useQuery({
    queryKey: ["configuracoes", "plano", empresaId],
    enabled: Boolean(empresaId),
    queryFn: async () => {
      if (!empresaId) throw new Error("Agência não encontrada.");
      const { data, error } = await supabase.rpc("resumo_uso_empresa", {
        _empresa_id: empresaId,
      });
      if (error) throw error;
      return data?.[0] ?? null;
    },
  });

  const empresa = useQuery({
    queryKey: ["configuracoes", "empresa", empresaId],
    enabled: Boolean(empresaId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("empresas")
        .select(
          "id, cnpj, razao_social, regime_fiscal, municipio, uf, codigo_servico, fiscal_status",
        )
        .eq("id", empresaId ?? "")
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const salvar = useMutation({
    mutationFn: async (patch: Partial<Configuracao>) => {
      if (!empresaId) throw new Error("Agência não encontrada.");
      const { error } = await supabase
        .from("configuracoes")
        .update(patch)
        .eq("empresa_id", empresaId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["configuracoes"] });
      toast.success("Configuração atualizada.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <AppShell titulo="Configurações" descricao="Regras que valem para toda a operação da agência">
      {q.isPending ? (
        <LoadingBloco />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : q.data ? (
        <ul className="max-w-2xl divide-y divide-border rounded-md border border-border bg-card">
          {CAMPOS.map((campo) => (
            <li key={campo.chave} className="flex items-center justify-between gap-4 px-4 py-3">
              <div className="min-w-0">
                <p className="text-sm font-medium">{campo.titulo}</p>
                <p className="text-xs text-muted-foreground">{campo.descricao}</p>
              </div>
              <Switch
                checked={q.data?.[campo.chave] ?? false}
                disabled={salvar.isPending}
                onCheckedChange={(v) => salvar.mutate({ [campo.chave]: v })}
              />
            </li>
          ))}
        </ul>
      ) : null}

      {q.data ? (
        <section className="mt-4 max-w-2xl rounded-md border border-border bg-card p-4">
          <Label htmlFor="selfie-retencao">Retenção das selfies (dias)</Label>
          <p className="mb-2 text-xs text-muted-foreground">
            As evidências são excluídas automaticamente após este prazo. O painel avisa nos três
            dias anteriores.
          </p>
          <Input
            id="selfie-retencao"
            type="number"
            min={30}
            max={365}
            className="w-28"
            defaultValue={q.data.selfie_retencao_dias}
            onBlur={(event) => {
              const dias = Number(event.currentTarget.value);
              if (!Number.isInteger(dias) || dias < 30 || dias > 365) {
                toast.error("Informe um prazo entre 30 e 365 dias.");
                event.currentTarget.value = String(q.data?.selfie_retencao_dias ?? 90);
                return;
              }
              if (dias !== q.data?.selfie_retencao_dias)
                salvar.mutate({ selfie_retencao_dias: dias });
            }}
          />
        </section>
      ) : null}

      {plano.data ? <PlanoCobranca plano={plano.data} /> : null}
      <IntegracaoMercadoPago />
      {empresa.data ? <CadastroFiscal empresa={empresa.data} /> : null}
    </AppShell>
  );
}

function CadastroFiscal({
  empresa,
}: {
  empresa: {
    id: string;
    cnpj: string;
    razao_social: string | null;
    regime_fiscal: string | null;
    municipio: string | null;
    uf: string | null;
    codigo_servico: string | null;
    fiscal_status: string;
  };
}) {
  const queryClient = useQueryClient();
  const [razaoSocial, setRazaoSocial] = useState(empresa.razao_social ?? "");
  const [regimeFiscal, setRegimeFiscal] = useState(empresa.regime_fiscal ?? "");
  const [municipio, setMunicipio] = useState(empresa.municipio ?? "");
  const [uf, setUf] = useState(empresa.uf ?? "");
  const [codigoServico, setCodigoServico] = useState(empresa.codigo_servico ?? "");

  const enviar = useMutation({
    mutationFn: async () => {
      if (![razaoSocial, regimeFiscal, municipio, uf, codigoServico].every((v) => v.trim())) {
        throw new Error("Preencha todos os dados fiscais para enviar à análise.");
      }
      if (uf.trim().length !== 2) throw new Error("UF deve ter duas letras.");
      const { error } = await supabase
        .from("empresas")
        .update({
          razao_social: razaoSocial.trim(),
          regime_fiscal: regimeFiscal.trim(),
          municipio: municipio.trim(),
          uf: uf.trim().toUpperCase(),
          codigo_servico: codigoServico.trim(),
          fiscal_status: "pendente",
        })
        .eq("id", empresa.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["configuracoes", "empresa"] });
      toast.success("Cadastro fiscal enviado para análise.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <section className="mt-6 max-w-2xl border-t border-border pt-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Cadastro fiscal da agência</h2>
          <p className="text-xs text-muted-foreground">
            Necessário para liberar pagamentos aos colaboradores.
          </p>
        </div>
        <span className="text-xs font-medium uppercase text-muted-foreground">
          {empresa.fiscal_status}
        </span>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>CNPJ</Label>
          <Input value={empresa.cnpj} disabled />
        </div>
        <div className="space-y-1.5">
          <Label>Razão social</Label>
          <Input value={razaoSocial} onChange={(e) => setRazaoSocial(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>Regime fiscal</Label>
          <Input value={regimeFiscal} onChange={(e) => setRegimeFiscal(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>Município</Label>
          <Input value={municipio} onChange={(e) => setMunicipio(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>UF</Label>
          <Input maxLength={2} value={uf} onChange={(e) => setUf(e.target.value.toUpperCase())} />
        </div>
        <div className="space-y-1.5">
          <Label>Código de serviço</Label>
          <Input value={codigoServico} onChange={(e) => setCodigoServico(e.target.value)} />
        </div>
      </div>
      <Button
        className="mt-4"
        disabled={enviar.isPending || empresa.fiscal_status === "validado"}
        onClick={() => enviar.mutate()}
      >
        {empresa.fiscal_status === "validado" ? "Cadastro validado" : "Enviar para análise"}
      </Button>
    </section>
  );
}

function PlanoCobranca({
  plano,
}: {
  plano: {
    plano_nome: string | null;
    mensalidade: number;
    participacoes_incluidas: number;
    valor_excedente: number;
  };
}) {
  return (
    <section className="mt-6 max-w-2xl border-t border-border pt-5">
      <h2 className="font-semibold">Plano {plano.plano_nome ?? "Já"}</h2>
      <dl className="mt-4 grid gap-4 sm:grid-cols-3">
        <div>
          <dt className="text-xs text-muted-foreground">Mensalidade</dt>
          <dd>{moeda(plano.mensalidade)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Participações incluídas</dt>
          <dd>{plano.participacoes_incluidas}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Excedente por participação</dt>
          <dd>{moeda(plano.valor_excedente)}</dd>
        </div>
      </dl>
    </section>
  );
}

function IntegracaoMercadoPago() {
  const queryClient = useQueryClient();
  const obterFn = useServerFn(obterConfiguracaoMercadoPago);
  const salvarFn = useServerFn(salvarCredenciaisMercadoPago);

  const [applicationId, setApplicationId] = useState("");
  const [publicKey, setPublicKey] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [ambiente, setAmbiente] = useState<"sandbox" | "producao">("sandbox");
  const [mostrarToken, setMostrarToken] = useState(false);
  const [mostrarLegado, setMostrarLegado] = useState(false);

  const statusQuery = useQuery({
    queryKey: ["mercado-pago-config"],
    queryFn: () => obterFn(),
  });

  const salvar = useMutation({
    mutationFn: () =>
      salvarFn({
        data: {
          applicationId: applicationId.trim(),
          publicKey: publicKey.trim() || undefined,
          accessToken: accessToken.trim(),
          clientSecret: clientSecret.trim() || undefined,
          ambiente,
        },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["mercado-pago-config"] });
      setAccessToken("");
      setClientSecret("");
      toast.success("Credenciais arquivadas com sucesso.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const asaasWebhookUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/api/public/webhooks/asaas`
      : "https://ja.swali.com.br/api/public/webhooks/asaas";

  return (
    <section className="mt-6 max-w-2xl border-t border-border pt-5 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <CreditCard className="size-4 text-primary" />
            <h2 className="text-sm font-semibold text-foreground">
              Gateway Financeiro Unificado — Asaas v3
            </h2>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            Toda a tesouraria, split de taxas, repasses Pix e faturas de planos operam
            exclusivamente pelo ecossistema oficial Asaas.
          </p>
        </div>

        <div className="flex items-center gap-1.5">
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
            <CheckCircle2 className="size-3.5" />
            Asaas Ativo & Integrado
          </span>
        </div>
      </div>

      <div className="rounded-lg bg-muted/40 p-3.5 text-xs text-muted-foreground space-y-2 border border-border">
        <p className="font-semibold text-foreground flex items-center gap-1.5">
          <ShieldCheck className="size-4 text-primary" />
          Segregação Financeira e Liquidação Atômica
        </p>
        <p>
          O sistema Já utiliza o Asaas de forma unificada: os repasses Pix aos colaboradores e as
          faturas de assinatura do SaaS operam com total conformidade contábil, conciliação
          automática por webhooks idempotentes e isolamento estrito de tenant.
        </p>
        <div className="pt-2">
          <Label className="text-xs text-foreground font-medium">
            URL Oficial do Webhook Asaas
          </Label>
          <div className="flex items-center gap-2 mt-1">
            <Input
              readOnly
              value={asaasWebhookUrl}
              className="font-mono text-xs bg-muted/50 cursor-pointer"
              onClick={() => {
                navigator.clipboard.writeText(asaasWebhookUrl);
                toast.success("URL de webhook do Asaas copiada.");
              }}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="shrink-0 text-xs"
              onClick={() => {
                navigator.clipboard.writeText(asaasWebhookUrl);
                toast.success("URL de webhook do Asaas copiada.");
              }}
            >
              <Copy className="size-3 mr-1" />
              Copiar
            </Button>
          </div>
        </div>
      </div>

      <div className="rounded-md border border-amber-500/20 bg-amber-500/5 p-3.5 text-xs text-muted-foreground space-y-2">
        <div className="flex items-center justify-between">
          <span className="font-medium text-amber-900 dark:text-amber-200">
            Mercado Pago: Integração Cancelada / Descontinuada
          </span>
          <button
            type="button"
            className="text-[11px] text-primary hover:underline"
            onClick={() => setMostrarLegado(!mostrarLegado)}
          >
            {mostrarLegado ? "Ocultar detalhes legados" : "Ver detalhes legados"}
          </button>
        </div>
        <p className="text-[11px]">
          Conforme diretriz técnica e regulatória, todo o sistema gira em torno do Asaas. A cobrança
          de mensalidades e repasses pelo Mercado Pago foi desativada em favor da liquidação
          unificada do Asaas.
        </p>

        {mostrarLegado ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              salvar.mutate();
            }}
            className="space-y-3 pt-2 border-t border-amber-500/20"
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="mp-app-id" className="text-xs">
                  Application ID Legado
                </Label>
                <Input
                  id="mp-app-id"
                  placeholder="Ex: 123456789012345"
                  value={applicationId}
                  onChange={(e) => setApplicationId(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="mp-ambiente" className="text-xs">
                  Ambiente
                </Label>
                <Select
                  value={ambiente}
                  onValueChange={(v) => setAmbiente(v as "sandbox" | "producao")}
                >
                  <SelectTrigger id="mp-ambiente">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="sandbox">Sandbox</SelectItem>
                    <SelectItem value="producao">Produção</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <Label htmlFor="mp-access-token" className="text-xs">
                  Token de Acesso Legado
                </Label>
                <button
                  type="button"
                  className="text-[11px] text-primary flex items-center gap-1 hover:underline"
                  onClick={() => setMostrarToken(!mostrarToken)}
                >
                  {mostrarToken ? <EyeOff className="size-3" /> : <Eye className="size-3" />}
                  {mostrarToken ? "Ocultar" : "Mostrar"}
                </button>
              </div>
              <div className="relative">
                <Input
                  id="mp-access-token"
                  type={mostrarToken ? "text" : "password"}
                  placeholder="APP_USR-... ou TEST-..."
                  value={accessToken}
                  onChange={(e) => setAccessToken(e.target.value)}
                  className="pr-9"
                />
                <Lock className="size-3.5 absolute right-3 top-3 text-muted-foreground pointer-events-none" />
              </div>
            </div>

            <Button
              type="submit"
              variant="outline"
              size="sm"
              disabled={salvar.isPending}
              className="mt-1"
            >
              {salvar.isPending ? "Salvando..." : "Salvar Arquivo Legado"}
            </Button>
          </form>
        ) : null}
      </div>
    </section>
  );
}
