import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { criarSupabaseClientComAuth } from "@/integrations/supabase/authenticated.server";
import { createSupabasePublicClient } from "@/integrations/supabase/public.server";
import {
  adicionarPontoSessao,
  atualizarStatusEscalaSessao,
  buscarSessaoEventoPorToken,
  type EscalaSessao,
  type PontoSessao,
  salvarSessaoEvento,
} from "./ponto-store.server";
import {
  criarTokenQrCodeAssinado,
  decodificarTokenQrCode,
  type PayloadQrCodePonto,
} from "./ponto.signed-token";

// Suporta tokens padrão (ex: UUID ou hash) e tokens assinados (prefixo qr.)
const tokenSchema = z.object({ token: z.string().min(8).max(2048) });

const identificarSchema = tokenSchema.extend({
  cpf: z.string().regex(/^\d{11}$/, "CPF deve ter 11 dígitos"),
});

const evidenciaLivenessSchema = z
  .object({
    sessaoId: z.string().optional(),
    desafioConcluido: z.boolean().optional(),
    duracaoTotalMs: z.number().optional(),
    earMedioAberto: z.number().optional(),
    earMinimoFechado: z.number().optional(),
    duracaoPiscada1Ms: z.number().optional(),
    duracaoPiscada2Ms: z.number().optional(),
    scoreNitidez: z.number().optional(),
    timestampConclusao: z.string().optional(),
  })
  .optional();

const registrarSchema = identificarSchema.extend({
  escalaId: z.string().uuid(),
  tipo: z.enum(["entrada", "saida", "inicio_intervalo", "fim_intervalo"]),
  fotoBase64: z.string().max(4_000_000).nullable().optional(),
  lat: z.number().nullable().optional(),
  lng: z.number().nullable().optional(),
  consentiuSelfie: z.boolean().optional(),
  evidenciaLiveness: evidenciaLivenessSchema,
});

const contextoSchema = z.object({
  pontoBasico: z.boolean(),
  evento: z.object({
    id: z.string().optional(),
    nome: z.string(),
    local: z.string().nullable(),
    status: z.string().nullable(),
    data_inicio: z.string(),
    data_fim: z.string().nullable(),
    qr_code_expira_em: z.string().nullable(),
  }),
  exigeSelfie: z.boolean(),
  exigeGps: z.boolean(),
});

const identificacaoResultSchema = z.object({
  escalaId: z.string().uuid(),
  statusEscala: z.string(),
  nome: z.string(),
  pontos: z.array(
    z.object({
      id: z.string().uuid(),
      tipo: z.string(),
      registrado_em: z.string(),
      status: z.string(),
      fora_horario: z.boolean(),
    }),
  ),
});

/**
 * Valida a vigência e expiração do QR Code do evento com tolerância para eventos recentes.
 */
export function validarValidadeQr(evento: {
  id?: string;
  data_inicio?: string | null | undefined;
  data_fim?: string | null | undefined;
  qr_code_expira_em?: string | null | undefined;
  qr_code_gerado_em?: string | null | undefined;
  criado_em?: string | null | undefined;
}): string {
  const agora = Date.now();

  // 1. Se tem data de expiração gravada
  if (evento.qr_code_expira_em) {
    const expira = new Date(evento.qr_code_expira_em).getTime();
    if (Number.isFinite(expira)) {
      if (agora <= expira) {
        return evento.qr_code_expira_em;
      }

      // Janela de tolerância para eventos ou QR recém-criados/gerados nas últimas 12 horas
      const gerado = evento.qr_code_gerado_em ? new Date(evento.qr_code_gerado_em).getTime() : 0;
      const criado = evento.criado_em ? new Date(evento.criado_em).getTime() : 0;
      const momentoRecente = Math.max(gerado, criado);
      if (momentoRecente > 0 && agora - momentoRecente < 12 * 60 * 60_000) {
        return new Date(momentoRecente + 12 * 60 * 60_000).toISOString();
      }

      throw new Error(
        "Este QR Code está expirado. Peça ao supervisor para abrir o evento e clicar em 'Trocar QR'.",
      );
    }
  }

  // 2. Se tem data_fim
  if (evento.data_fim) {
    const fim = new Date(evento.data_fim).getTime();
    const expira = fim + 12 * 60 * 60_000;
    if (Number.isFinite(fim) && agora <= expira) {
      return new Date(expira).toISOString();
    }

    const gerado = evento.qr_code_gerado_em ? new Date(evento.qr_code_gerado_em).getTime() : 0;
    const criado = evento.criado_em ? new Date(evento.criado_em).getTime() : 0;
    const momentoRecente = Math.max(gerado, criado);
    if (momentoRecente > 0 && agora - momentoRecente < 12 * 60 * 60_000) {
      return new Date(momentoRecente + 12 * 60 * 60_000).toISOString();
    }

    throw new Error(
      "Este QR Code está expirado. Peça ao supervisor para abrir o evento e clicar em 'Trocar QR'.",
    );
  }

  // 3. Sem data de fim e sem qr_code_expira_em: válido por 24h a partir de agora
  return new Date(agora + 24 * 60 * 60_000).toISOString();
}

async function invokePontoEdge<T>(body: Record<string, unknown>, schema: z.ZodType<T>): Promise<T> {
  const supabase = createSupabasePublicClient();
  const { data, error } = await supabase.functions.invoke("ponto-publico", { body });
  if (error) {
    let detalhe = error.message;
    if (error.context instanceof Response) {
      try {
        const bodyRes: unknown = await error.context.clone().json();
        if (
          bodyRes &&
          typeof bodyRes === "object" &&
          "error" in bodyRes &&
          typeof bodyRes.error === "string"
        ) {
          detalhe = bodyRes.error;
        }
      } catch {
        // Ignora falha de parse
      }
    }
    throw new Error(detalhe);
  }
  if (data && typeof data === "object" && "error" in data && typeof data.error === "string") {
    throw new Error(data.error);
  }
  return schema.parse(data);
}

/**
 * Sincroniza e ativa o ponto digital de um evento no servidor.
 * Chamado pelo supervisor (autenticado) ao visualizar ou gerar o QR Code.
 * Registra as escalas e gera o token assinado autocontido.
 */
export const sincronizarPontoEvento = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ eventoId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: evento, error: erroEvento } = await context.supabase
      .from("eventos")
      .select(
        "id, empresa_id, nome, local, status, data_inicio, data_fim, qr_code_token, qr_code_expira_em, qr_code_gerado_em, criado_em",
      )
      .eq("id", data.eventoId)
      .single();

    if (erroEvento || !evento) {
      throw new Error("Evento não encontrado.");
    }

    const expiraEm = validarValidadeQr(evento);

    const { data: config } = await context.supabase
      .from("configuracoes")
      .select("checkin_exige_selfie, checkin_exige_gps")
      .eq("empresa_id", evento.empresa_id)
      .maybeSingle();

    let pontoBasico = false;
    try {
      const { data: plano } = await context.supabase.rpc("plano_da_empresa", {
        _empresa_id: evento.empresa_id,
      });
      pontoBasico = plano?.codigo === "free";
    } catch {
      pontoBasico = false;
    }

    // Carrega equipes e escalas com freelancers
    const { data: equipes } = await context.supabase
      .from("equipes")
      .select("id, nome, escalas(id, status, freelancer_id, freelancers(id, nome, cpf))")
      .eq("evento_id", evento.id);

    const escalasSessao: EscalaSessao[] = [];
    const escalaIds: string[] = [];
    for (const eq of equipes ?? []) {
      const escList = eq.escalas as unknown as Array<{
        id: string;
        status: string;
        freelancer_id: string;
        freelancers: { id: string; nome: string; cpf: string } | null;
      }>;
      for (const esc of escList ?? []) {
        if (esc.freelancers) {
          escalaIds.push(esc.id);
          escalasSessao.push({
            escalaId: esc.id,
            equipeId: eq.id,
            freelancerId: esc.freelancer_id,
            nome: esc.freelancers.nome,
            cpf: esc.freelancers.cpf,
            status: esc.status,
          });
        }
      }
    }

    // Carrega pontos existentes
    let pontosSessao: PontoSessao[] = [];
    if (escalaIds.length > 0) {
      const { data: pontosDb } = await context.supabase
        .from("pontos")
        .select(
          "id, escala_id, tipo, registrado_em, status, fora_horario, foto_url, gps_lat, gps_lng",
        )
        .in("escala_id", escalaIds);

      pontosSessao = (pontosDb ?? []).map((p) => ({
        id: p.id,
        escalaId: p.escala_id,
        tipo: p.tipo,
        registrado_em: p.registrado_em,
        status: p.status,
        fora_horario: p.fora_horario,
        foto_url: p.foto_url,
        gps_lat: p.gps_lat,
        gps_lng: p.gps_lng,
      }));
    }

    const signedToken = criarTokenQrCodeAssinado(evento, {
      exigeSelfie: Boolean(config?.checkin_exige_selfie),
      exigeGps: Boolean(config?.checkin_exige_gps),
      pontoBasico,
    });

    salvarSessaoEvento({
      eventoId: evento.id,
      empresaId: evento.empresa_id,
      qrCodeToken: evento.qr_code_token,
      signedToken,
      nome: evento.nome,
      local: evento.local,
      status: evento.status,
      data_inicio: evento.data_inicio,
      data_fim: evento.data_fim,
      qr_code_expira_em: expiraEm,
      exigeSelfie: Boolean(config?.checkin_exige_selfie),
      exigeGps: Boolean(config?.checkin_exige_gps),
      pontoBasico,
      authHeader: context.authHeader ?? null,
      escalas: escalasSessao,
      pontos: pontosSessao,
      expiraEm: new Date(expiraEm).getTime(),
    });

    return {
      ok: true,
      signedToken,
      qrCodeToken: evento.qr_code_token,
      expiraEm,
    };
  });

/** Contexto público mínimo do evento a partir do token do QR Code. */
export const obterContextoPonto = createServerFn({ method: "GET" })
  .validator((input: unknown) => tokenSchema.parse(input))
  .handler(async ({ data }) => {
    // 1. Tenta decodificar se for token autocontido assinado
    const assinado: PayloadQrCodePonto | null = decodificarTokenQrCode(data.token);
    if (assinado) {
      return {
        pontoBasico: Boolean(assinado.pontoBasico),
        evento: {
          id: assinado.eventoId,
          nome: assinado.nome,
          local: assinado.local ?? null,
          status: assinado.status ?? null,
          data_inicio: assinado.data_inicio,
          data_fim: assinado.data_fim ?? null,
          qr_code_expira_em: assinado.qr_code_expira_em ?? null,
        },
        exigeSelfie: Boolean(assinado.exigeSelfie),
        exigeGps: Boolean(assinado.exigeGps),
      };
    }

    // 2. Busca na sessão ativa do servidor (registrada pelo supervisor ou recente)
    const sessao = buscarSessaoEventoPorToken(data.token);
    if (sessao) {
      const expiraEm = validarValidadeQr({
        data_fim: sessao.data_fim,
        qr_code_expira_em: sessao.qr_code_expira_em,
      });

      return {
        pontoBasico: sessao.pontoBasico,
        evento: {
          id: sessao.eventoId,
          nome: sessao.nome,
          local: sessao.local ?? null,
          status: sessao.status ?? null,
          data_inicio: sessao.data_inicio,
          data_fim: sessao.data_fim ?? null,
          qr_code_expira_em: expiraEm,
        },
        exigeSelfie: sessao.exigeSelfie,
        exigeGps: sessao.exigeGps,
      };
    }

    // 3. Tenta RPC SECURITY DEFINER no Supabase (não requer service_role no Vercel)
    try {
      const supabase = createSupabasePublicClient();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: rpcData, error: rpcError } = await (supabase.rpc as any)(
        "obter_contexto_ponto_por_token",
        { _token: data.token },
      );
      if (!rpcError && rpcData && typeof rpcData === "object") {
        return contextoSchema.parse(rpcData);
      }
    } catch {
      // continua para os próximos fallbacks
    }

    // 4. Tenta Edge Function se disponível no Supabase
    try {
      return await invokePontoEdge(
        { action: "registrar", ...data },
        z.object({ ok: z.literal(true), foraHorario: z.boolean() }),
      );
    } catch (erroEdge) {
      // Falha fechada: não grava pontos diretamente com service_role quando
      // as RPCs protegidas e a Edge Function estão indisponíveis.
      console.error("[ponto] RPC e Edge Function indisponíveis:", erroEdge);
      throw new Error(
        "O serviço seguro de registro de ponto está indisponível. Nenhuma marcação foi gravada; tente novamente.",
      );
    }
  });
