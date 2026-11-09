import { createFileRoute } from "@tanstack/react-router";

import { authenticateCronRequest } from "@/integrations/supabase/cron-auth";

async function executarPurgar(request: Request): Promise<Response> {
  const unauthorized = await authenticateCronRequest(request);
  if (unauthorized) return unauthorized;

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const agora = new Date();
  const agoraIso = agora.toISOString();
  const { data: expiradas, error } = await supabaseAdmin
    .from("pontos")
    .select("id")
    .or("foto_url.not.is.null,gps_lat.not.is.null,gps_lng.not.is.null")
    .lte("evidencia_expira_em", agoraIso)
    .limit(500);
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const ids = (expiradas ?? []).map((ponto) => ponto.id);
  let caminhos: string[] = [];
  if (ids.length) {
    const { data: evidencias, error: erroEvidencias } = await supabaseAdmin
      .from("pontos")
      .select("foto_url")
      .in("id", ids)
      .not("foto_url", "like", "data:%")
      .not("foto_url", "like", "http%")
      .not("foto_url", "like", "blob:%");
    if (erroEvidencias) {
      return Response.json({ error: erroEvidencias.message }, { status: 500 });
    }
    caminhos = (evidencias ?? [])
      .map((ponto) => ponto.foto_url)
      .filter((caminho): caminho is string => Boolean(caminho));
  }
  if (caminhos.length) {
    const { error: storageError } = await supabaseAdmin.storage
      .from("selfies-ponto")
      .remove(caminhos);
    if (storageError) {
      return Response.json({ error: storageError.message }, { status: 500 });
    }
  }

  if (ids.length) {
    const { error: updateError } = await supabaseAdmin
      .from("pontos")
      .update({ foto_url: null, gps_lat: null, gps_lng: null })
      .in("id", ids);
    if (updateError) {
      return Response.json({ error: updateError.message }, { status: 500 });
    }
  }

  const limiteTentativas = new Date(agora.getTime() - 30 * 24 * 60 * 60_000).toISOString();
  const { data: tentativasAntigas, error: erroTentativas } = await supabaseAdmin
    .from("tentativas_ponto_publico")
    .delete()
    .lt("criado_em", limiteTentativas)
    .select("id");
  if (erroTentativas) {
    return Response.json({ error: erroTentativas.message }, { status: 500 });
  }

  return Response.json({
    evidencias_purgadas: ids.length,
    tentativas_purgadas: tentativasAntigas?.length ?? 0,
  });
}

export const Route = createFileRoute("/api/internal/purgar-selfies-ponto")({
  server: {
    handlers: {
      GET: async ({ request }) => executarPurgar(request),
      POST: async ({ request }) => executarPurgar(request),
    },
  },
});
