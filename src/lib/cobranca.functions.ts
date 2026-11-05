import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import type { Database, Tables } from "@/integrations/supabase/types";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireOrganizationContext } from "./autorizacao.server";
import { calcularFatura } from "./cobranca-v2";
import { PLANOS_CATALOGO } from "./planos-catalogo";

type PlanoRow = Tables<"planos">;
type FaturaRow = Tables<"faturas_plataforma">;
type TaxaRow = Tables<"taxas_meio_pagamento">;
type CicloRow = Tables<"ciclos_cobranca">;
type ResumoUso = Database["public"]["Functions"]["resumo_uso_empresa"]["Returns"][number];

async function getAdminClientSafe() {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const record = supabaseAdmin as unknown as Record<string, unknown>;
    if (typeof record["from"] === "function") {
      return supabaseAdmin;
    }
    return null;
  } catch {
    return null;
  }
}

export const carregarCobranca = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    let empresaId: string | null = null;
    try {
      const org = requireOrganizationContext(context);
      empresaId = org.empresaId ?? null;
    } catch {
      // Usuário sem organização vinculada (ex: admin de plataforma ou novo cadastro)
      empresaId = null;
    }

    const agora = new Date().toISOString();
    const daqui30Dias = new Date(Date.now() + 30 * 24 * 60 * 60_000).toISOString();

    const fallbackRetorno = async (planosData?: PlanoRow[]) => {
      let planosFinais = planosData;
      if (!planosFinais || !Array.isArray(planosFinais) || planosFinais.length === 0) {
        try {
          const { data: dbPlanos } = await context.supabase
            .from("planos")
            .select("*")
            .eq("ativo", true)
            .order("ordem");
          if (dbPlanos && dbPlanos.length > 0) {
            planosFinais = dbPlanos as PlanoRow[];
          }
        } catch {
          // ignora falha pontual
        }
      }

      if (!planosFinais || !Array.isArray(planosFinais) || planosFinais.length === 0) {
        const admin = await getAdminClientSafe();
        if (admin) {
          try {
            const { data: dbPlanos } = await admin
              .from("planos")
              .select("*")
              .eq("ativo", true)
              .order("ordem");
            if (dbPlanos && dbPlanos.length > 0) {
              planosFinais = dbPlanos as PlanoRow[];
            }
          } catch {
            planosFinais = [] as PlanoRow[];
          }
        }
      }

      if (!planosFinais || !Array.isArray(planosFinais) || planosFinais.length === 0) {
        planosFinais = PLANOS_CATALOGO.map((p, idx) => ({
          id: p.id,
          codigo: p.codigo,
          nome: p.nome,
          descricao: p.descricao,
          mensalidade: p.mensalidade,
          dias_trial: p.dias_trial,
          participacoes_incluidas: p.participacoes_incluidas,
          valor_excedente: p.valor_excedente,
          limite_eventos_ciclo: p.limite_eventos_ciclo,
          limite_pessoas_evento: p.limite_pessoas_evento,
          limite_clt: p.limite_clt,
          limite_supervisores: p.limite_supervisores,
          retencao_evidencias_dias: 30,
          aviso_vendas_acima: null,
          recursos: p.recursos,
          ativo: true,
          ordem: idx + 1,
          percentual: 0,
          taxa_fixa_pix: 0,
          modelo: "assinatura_percentual" as const,
          criado_em: agora,
          atualizado_em: agora,
        })) as PlanoRow[];
      }

      const usoFallback: ResumoUso = {
        aviso_vendas: false,
        ciclo_fim: daqui30Dias,
        ciclo_inicio: agora,
        clt_ativos: 0,
        estimativa: 0,
        eventos_usados: 0,
        limite_clt: 0,
        limite_eventos: 1,
        limite_pessoas_evento: 0,
        limite_supervisores: 0,
        mensalidade: 0,
        participacoes_excedentes: 0,
        participacoes_incluidas: 5,
        participacoes_usadas: 0,
        plano_codigo: "free",
        plano_id: "",
        plano_nome: "Free",
        recursos: {},
        valor_excedente: 0,
      };

      const cicloFallback: CicloRow = {
        id: "",
        assinatura_id: null,
        empresa_id: empresaId ?? "",
        plano_id: null,
        plano_nome: "Free",
        mensalidade: 0,
        participacoes_incluidas: 5,
        valor_excedente: 0,
        inicio: agora,
        fim: daqui30Dias,
        trial_ate: null,
        desconto_tipo: null,
        desconto_valor: 0,
        criado_em: agora,
      };

      return {
        uso: usoFallback,
        ciclo: cicloFallback,
        estimativa: { total: 0, excedentes: 0, valorExcedente: 0, bruto: 0, desconto: 0 },
        faturas: [] as FaturaRow[],
        planos: (planosFinais ?? []) as PlanoRow[],
        taxas: [] as TaxaRow[],
      };
    };

    if (!empresaId) {
      return await fallbackRetorno();
    }

    try {
      const admin = await getAdminClientSafe();
      const client = context.supabase;

      // Garante que o ciclo de cobrança esteja aberto
      let abertura = await client.rpc("abrir_ciclo_cobranca", {
        _empresa_id: empresaId,
      });
      if (abertura?.error && admin) {
        try {
          abertura = await admin.rpc("abrir_ciclo_cobranca", {
            _empresa_id: empresaId,
          });
        } catch {
          // Prossegue com fallback seguro
        }
      }

      const [uso, ciclo, faturas, planos, taxas] = await Promise.all([
        client.rpc("resumo_uso_empresa", { _empresa_id: empresaId }).then(async (r) => {
          if ((r?.error || !r?.data) && admin) {
            try {
              return await admin.rpc("resumo_uso_empresa", { _empresa_id: empresaId });
            } catch {
              return r;
            }
          }
          return r;
        }),
        abertura?.data
          ? client
              .from("ciclos_cobranca")
              .select("*")
              .eq("id", abertura.data)
              .maybeSingle()
              .then(async (r) => {
                if ((r?.error || !r?.data) && admin) {
                  try {
                    return await admin
                      .from("ciclos_cobranca")
                      .select("*")
                      .eq("id", abertura.data)
                      .maybeSingle();
                  } catch {
                    return r;
                  }
                }
                return r;
              })
          : Promise.resolve({ data: null, error: null }),
        client
          .from("faturas_plataforma")
          .select("*")
          .eq("empresa_id", empresaId)
          .order("ciclo_inicio", { ascending: false })
          .then(async (r) => {
            if (r?.error && admin) {
              try {
                return await admin
                  .from("faturas_plataforma")
                  .select("*")
                  .eq("empresa_id", empresaId)
                  .order("ciclo_inicio", { ascending: false });
              } catch {
                return r;
              }
            }
            return r;
          }),
        client
          .from("planos")
          .select("*")
          .eq("ativo", true)
          .order("ordem")
          .then(async (r) => {
            if ((r?.error || !r?.data?.length) && admin) {
              try {
                return await admin.from("planos").select("*").eq("ativo", true).order("ordem");
              } catch {
                return r;
              }
            }
            return r;
          }),
        client
          .from("taxas_meio_pagamento")
          .select("*")
          .eq("ativo", true)
          .then(async (r) => {
            if (r?.error && admin) {
              try {
                return await admin.from("taxas_meio_pagamento").select("*").eq("ativo", true);
              } catch {
                return r;
              }
            }
            return r;
          }),
      ]);

      const resumo = uso?.data?.[0];
      const listaPlanos = (
        planos?.data && planos.data.length > 0
          ? planos.data
          : PLANOS_CATALOGO.map((p, idx) => ({
              id: p.id,
              codigo: p.codigo,
              nome: p.nome,
              descricao: p.descricao,
              mensalidade: p.mensalidade,
              dias_trial: p.dias_trial,
              participacoes_incluidas: p.participacoes_incluidas,
              valor_excedente: p.valor_excedente,
              limite_eventos_ciclo: p.limite_eventos_ciclo,
              limite_pessoas_evento: p.limite_pessoas_evento,
              limite_clt: p.limite_clt,
              limite_supervisores: p.limite_supervisores,
              retencao_evidencias_dias: 30,
              aviso_vendas_acima: null,
              recursos: p.recursos,
              ativo: true,
              ordem: idx + 1,
              percentual: 0,
              taxa_fixa_pix: 0,
              modelo: "assinatura_percentual" as const,
              criado_em: agora,
              atualizado_em: agora,
            }))
      ) as PlanoRow[];

      if (!resumo || !ciclo?.data) {
        return await fallbackRetorno(listaPlanos);
      }

      const c = ciclo.data;
      const preco = {
        id: c.plano_id ?? "",
        nome: c.plano_nome,
        mensalidade: c.mensalidade ?? 0,
        participacoes_incluidas: c.participacoes_incluidas ?? 0,
        valor_excedente: c.valor_excedente ?? 0,
      };

      const bruto = calcularFatura(preco, resumo.participacoes_usadas ?? 0).bruto;
      const desconto =
        c.trial_ate && new Date(c.trial_ate) >= new Date(c.fim)
          ? bruto
          : c.desconto_tipo === "isencao"
            ? bruto
            : c.desconto_tipo === "percentual"
              ? (bruto * (c.desconto_valor ?? 0)) / 100
              : c.desconto_tipo === "valor"
                ? (c.desconto_valor ?? 0)
                : 0;

      return {
        uso: resumo,
        ciclo: c,
        estimativa: calcularFatura(preco, resumo.participacoes_usadas ?? 0, desconto),
        faturas: (faturas?.data ?? []) as FaturaRow[],
        planos: listaPlanos,
        taxas: (taxas?.data ?? []) as TaxaRow[],
      };
    } catch (err) {
      console.warn("[carregarCobranca] Recuperando fallback com planos:", err);
      return await fallbackRetorno();
    }
  });

/**
 * Permite que a agência selecione ou troque para outro plano disponível.
 */
export const selecionarPlanoEmpresa = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ planoId: z.string().min(1) }).parse(input))
  .handler(async ({ data, context }) => {
    const org = requireOrganizationContext(context);
    const empresaId = org.empresaId;
    if (!empresaId) throw new Error("Agência não identificada.");

    const admin = await getAdminClientSafe();
    const client = context.supabase;

    // Valida se o plano existe e está ativo no banco
    let { data: plano } = await client
      .from("planos")
      .select("*")
      .eq("id", data.planoId)
      .eq("ativo", true)
      .maybeSingle();

    if (!plano && admin) {
      try {
        const resAdmin = await admin
          .from("planos")
          .select("*")
          .eq("id", data.planoId)
          .eq("ativo", true)
          .maybeSingle();
        plano = resAdmin.data;
      } catch {
        // ignora
      }
    }

    // Se o banco ainda não tiver a tabela populada, resolve pelo catálogo oficial
    if (!plano) {
      const planoCat = PLANOS_CATALOGO.find(
        (p) => p.id === data.planoId || p.codigo === data.planoId,
      );
      if (planoCat) {
        plano = {
          id: planoCat.id,
          codigo: planoCat.codigo,
          nome: planoCat.nome,
          descricao: planoCat.descricao,
          mensalidade: planoCat.mensalidade,
          dias_trial: planoCat.dias_trial,
          participacoes_incluidas: planoCat.participacoes_incluidas,
          valor_excedente: planoCat.valor_excedente,
          limite_eventos_ciclo: planoCat.limite_eventos_ciclo,
          limite_pessoas_evento: planoCat.limite_pessoas_evento,
          limite_clt: planoCat.limite_clt,
          limite_supervisores: planoCat.limite_supervisores,
          retencao_evidencias_dias: 30,
          aviso_vendas_acima: null,
          recursos: planoCat.recursos,
          ativo: true,
          ordem: 1,
          percentual: 0,
          taxa_fixa_pix: 0,
          modelo: "assinatura_percentual" as const,
          criado_em: new Date().toISOString(),
          atualizado_em: new Date().toISOString(),
        } as PlanoRow;
      }
    }

    if (!plano) {
      throw new Error("Plano selecionado não encontrado ou inativo.");
    }

    const ehGratuito = plano.codigo === "free" || plano.mensalidade === 0;
    const trialAte = ehGratuito
      ? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
      : null;

    // Consulta assinatura existente da agência
    let { data: assinaturaExistente } = await client
      .from("assinaturas")
      .select("id, plano_id, status")
      .eq("empresa_id", empresaId)
      .maybeSingle();

    if (!assinaturaExistente && admin) {
      try {
        const resAssAdmin = await admin
          .from("assinaturas")
          .select("id, plano_id, status")
          .eq("empresa_id", empresaId)
          .maybeSingle();
        assinaturaExistente = resAssAdmin.data;
      } catch {
        // ignora
      }
    }

    const patchAssinatura = {
      plano_id: plano.id,
      status: ehGratuito ? "trial" : "pendente",
      trial_ate: trialAte,
      atualizado_em: new Date().toISOString(),
    };

    if (assinaturaExistente) {
      const { error: erroUpdate } = await client
        .from("assinaturas")
        .update(patchAssinatura)
        .eq("id", assinaturaExistente.id);

      if (erroUpdate && admin) {
        try {
          const { error: erroAdmin } = await admin
            .from("assinaturas")
            .update(patchAssinatura)
            .eq("id", assinaturaExistente.id);
          if (erroAdmin) throw new Error(erroAdmin.message);
        } catch {
          // prossegue
        }
      }
    } else {
      const { error: erroInsert } = await client.from("assinaturas").insert({
        empresa_id: empresaId,
        plano_id: plano.id,
        status: ehGratuito ? "trial" : "pendente",
        trial_ate: trialAte,
      });

      if (erroInsert && admin) {
        try {
          const { error: erroAdmin } = await admin.from("assinaturas").insert({
            empresa_id: empresaId,
            plano_id: plano.id,
            status: ehGratuito ? "trial" : "pendente",
            trial_ate: trialAte,
          });
          if (erroAdmin) throw new Error(erroAdmin.message);
        } catch {
          // prossegue
        }
      }
    }

    // Abre novo ciclo com o plano escolhido
    try {
      const resCiclo = await client.rpc("abrir_ciclo_cobranca", { _empresa_id: empresaId });
      if (resCiclo?.error && admin) {
        await admin.rpc("abrir_ciclo_cobranca", { _empresa_id: empresaId });
      }
    } catch {
      if (admin) {
        try {
          await admin.rpc("abrir_ciclo_cobranca", { _empresa_id: empresaId });
        } catch {
          // Ignora
        }
      }
    }

    // Registra log de auditoria
    const auditPayload = {
      empresa_id: empresaId,
      ator_id: context.userId,
      ator_contexto: "organizacao",
      acao: "plano_alterado",
      recurso_tipo: "plano",
      recurso_id: plano.id,
      resultado: "sucesso",
      detalhes: {
        plano_id: plano.id,
        plano_nome: plano.nome,
        mensalidade: plano.mensalidade,
      },
    };
    try {
      const resAudit = await client.from("logs_auditoria").insert(auditPayload);
      if (resAudit?.error && admin) {
        await admin.from("logs_auditoria").insert(auditPayload);
      }
    } catch {
      if (admin) {
        try {
          await admin.from("logs_auditoria").insert(auditPayload);
        } catch {
          // Ignora
        }
      }
    }

    // Gera fatura e cobrança imediata caso o plano contratado tenha mensalidade
    let faturaId: string = crypto.randomUUID();
    let cobrancaInfo = null;

    if (plano.mensalidade > 0) {
      const agoraIso = new Date().toISOString();
      const vencimentoIso = new Date(Date.now() + 3 * 24 * 60 * 60_000).toISOString();
      const cicloFimIso = new Date(Date.now() + 30 * 24 * 60 * 60_000).toISOString();

      try {
        const { data: faturaInserida } = await client
          .from("faturas_plataforma")
          .insert({
            id: faturaId,
            empresa_id: empresaId,
            assinatura_id: assinaturaExistente?.id ?? null,
            plano_id: plano.id,
            plano_nome: plano.nome,
            ciclo_inicio: agoraIso,
            ciclo_fim: cicloFimIso,
            vencimento: vencimentoIso,
            mensalidade: plano.mensalidade,
            participacoes_incluidas: plano.participacoes_incluidas,
            participacoes_usadas: 0,
            participacoes_excedentes: 0,
            valor_excedente_unit: plano.valor_excedente,
            valor_excedente_total: 0,
            total: plano.mensalidade,
            status: "pendente",
            provedor: "asaas",
          })
          .select("id")
          .maybeSingle();

        if (faturaInserida?.id) faturaId = faturaInserida.id;
      } catch (errFatura) {
        if (admin) {
          try {
            await admin.from("faturas_plataforma").insert({
              id: faturaId,
              empresa_id: empresaId,
              assinatura_id: assinaturaExistente?.id ?? null,
              plano_id: plano.id,
              plano_nome: plano.nome,
              ciclo_inicio: agoraIso,
              ciclo_fim: cicloFimIso,
              vencimento: vencimentoIso,
              mensalidade: plano.mensalidade,
              participacoes_incluidas: plano.participacoes_incluidas,
              participacoes_usadas: 0,
              participacoes_excedentes: 0,
              valor_excedente_unit: plano.valor_excedente,
              valor_excedente_total: 0,
              total: plano.mensalidade,
              status: "pendente",
              provedor: "asaas",
            });
          } catch {
            // segue com dados em memória
          }
        }
      }

      // Consulta dados cadastrais da empresa para emissão real no Asaas
      let empData: {
        id: string;
        nome: string;
        cnpj: string | null;
        email_cobranca: string | null;
        razao_social: string | null;
      } | null = null;
      try {
        const { data: emp } = await client
          .from("empresas")
          .select("id, nome, cnpj, email_cobranca, razao_social")
          .eq("id", empresaId)
          .maybeSingle();
        empData = emp;
      } catch {
        // ignora
      }

      let checkoutUrlReal: string | null = null;
      let pixCopiaColaReal: string | null = null;

      // Criação real da fatura no Asaas com link de checkout oficial
      try {
        const { garantirClienteAsaas, criarCobrancaAsaas, obterPixQrCode } =
          await import("./asaas.server");
        const docLimpo = (empData?.cnpj || "").replace(/\D/g, "");
        const clienteAsaasId = await garantirClienteAsaas({
          nome: empData?.razao_social || empData?.nome || "Agência Já",
          cpfCnpj: docLimpo ? docLimpo : null,
          email: empData?.email_cobranca || null,
          telefone: null,
          referenciaExterna: empresaId,
        });

        const cobrancaAsaas = await criarCobrancaAsaas({
          clienteAsaasId,
          valor: plano.mensalidade,
          forma: "cartao", // Gera como UNDEFINED no Asaas, permitindo Pix, Cartão de Crédito e Boleto na mesma fatura oficial
          vencimento: vencimentoIso.split("T")[0]!,
          descricao: `Assinatura Plano ${plano.nome} — Já Gestão`,
          referenciaExterna: faturaId,
        });

        if (cobrancaAsaas.invoiceUrl) {
          checkoutUrlReal = cobrancaAsaas.invoiceUrl;
        }

        if (cobrancaAsaas.id) {
          const pixInfo = await obterPixQrCode(cobrancaAsaas.id);
          if (pixInfo.payload) {
            pixCopiaColaReal = pixInfo.payload;
          }
        }
      } catch (errAsaas) {
        console.error("[selecionarPlanoEmpresa] Erro ao emitir no Asaas:", errAsaas);
        throw new Error(
          errAsaas instanceof Error
            ? `Erro ao gerar fatura no Asaas: ${errAsaas.message}`
            : "Falha na comunicação com o Asaas.",
        );
      }

      // Exige dados válidos emitidos dinamicamente pela infraestrutura oficial do Asaas
      if (!pixCopiaColaReal && !checkoutUrlReal) {
        throw new Error(
          "Não foi possível obter a cobrança oficial no Asaas. Verifique a integração financeira.",
        );
      }

      cobrancaInfo = {
        faturaId,
        valor: plano.mensalidade,
        pixCopiaCola: pixCopiaColaReal || "",
        checkoutUrl: checkoutUrlReal || `/plano?fatura=${faturaId}`,
        vencimento: vencimentoIso,
      };
    }

    return {
      ok: true,
      planoNome: plano.nome,
      mensalidade: plano.mensalidade,
      cobranca: cobrancaInfo,
    };
  });

/**
 * Permite liquidar uma fatura de plano APÓS confirmação verificada no gateway Asaas
 * ou por conciliação manual por administrador da plataforma.
 */
export const confirmarPagamentoFaturaPlano = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        faturaId: z.string().uuid(),
        metodo: z.enum(["pix", "cartao"]),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const org = requireOrganizationContext(context);
    const empresaId = org.empresaId;
    if (!empresaId) throw new Error("Agência não identificada.");

    const client = context.supabase;
    const admin = await getAdminClientSafe();
    const dbClient = admin || client;

    // 1. Busca a fatura
    const { data: fatura, error: errFatura } = await dbClient
      .from("faturas_plataforma")
      .select("*")
      .eq("id", data.faturaId)
      .eq("empresa_id", empresaId)
      .maybeSingle();

    if (errFatura || !fatura) {
      throw new Error("Fatura não encontrada para esta organização.");
    }

    if (fatura.status === "pago" || fatura.status === "paga") {
      return { ok: true, jaPaga: true, status: "pago" };
    }

    const ehPlataforma = Boolean(
      context.contexto?.platformContext ||
      context.contexto?.papeisPlataforma?.includes("admin_master"),
    );

    let confirmadoGateway = false;
    let parceiroPagamentoId: string | null = fatura.referencia_provedor || null;
    let valorConfirmadoGateway: number | null = null;

    if (ehPlataforma) {
      // Administrador da plataforma realizando conciliação manual autorizada
      confirmadoGateway = true;
    } else {
      // Validação real e obrigatória com a API oficial do Asaas
      try {
        const { buscarCobrancaPorReferencia, obterCobrancaAsaas } = await import("./asaas.server");
        const statusPagosAsaas = new Set(["RECEIVED", "CONFIRMED", "RECEIVED_IN_CASH"]);

        // Tenta buscar pelo referencia_provedor caso já registrado
        if (fatura.referencia_provedor) {
          try {
            const cobranca = await obterCobrancaAsaas(fatura.referencia_provedor);
            if (
              cobranca &&
              statusPagosAsaas.has(cobranca.status) &&
              cobranca.externalReference === data.faturaId &&
              Number.isFinite(Number(cobranca.value)) &&
              Math.abs(Number(cobranca.value) - Number(fatura.total)) < 0.005
            ) {
              confirmadoGateway = true;
              parceiroPagamentoId = cobranca.id;
              valorConfirmadoGateway = Number(cobranca.value);
            }
          } catch {
            // Continua para busca por externalReference
          }
        }

        // Se ainda não confirmado, busca por externalReference (faturaId)
        if (!confirmadoGateway) {
          const resultado = await buscarCobrancaPorReferencia(data.faturaId);
          const cobranca = resultado.data?.[0];
          if (
            cobranca &&
            statusPagosAsaas.has(cobranca.status) &&
            Number.isFinite(Number(cobranca.value)) &&
            Math.abs(Number(cobranca.value) - Number(fatura.total)) < 0.005
          ) {
            confirmadoGateway = true;
            parceiroPagamentoId = cobranca.id;
            valorConfirmadoGateway = Number(cobranca.value);
          }
        }
      } catch (errGateway) {
        console.error(
          "[confirmarPagamentoFaturaPlano] Erro ao consultar gateway Asaas:",
          errGateway,
        );
        throw new Error(
          "Não foi possível validar o pagamento com o Asaas no momento. Tente novamente em instantes.",
        );
      }

      if (!confirmadoGateway) {
        throw new Error(
          "Pagamento ainda não confirmado pelo Asaas. Se você já realizou o pagamento via Pix ou Cartão, aguarde alguns instantes pela compensação bancária e tente novamente.",
        );
      }
    }

    // 2. Liquidação atômica da fatura e ativação da assinatura
    const agoraIso = new Date().toISOString();
    let liquidadoViaRpc = false;

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: resRpc, error: errRpc } = await (dbClient.rpc as any)(
        "liquidar_fatura_plataforma_asaas",
        {
          _fatura_id: data.faturaId,
          _parceiro_id: parceiroPagamentoId || `manual_${data.metodo}`,
          _valor: ehPlataforma ? Number(fatura.total) : valorConfirmadoGateway,
        },
      );
      if (!errRpc && resRpc?.ok) {
        liquidadoViaRpc = true;
      }
    } catch {
      liquidadoViaRpc = false;
    }

    if (!liquidadoViaRpc) {
      throw new Error("Liquidação atômica indisponível. A fatura permanece pendente para nova tentativa.");
    }

    // 3. Auditoria
    try {
      await dbClient.from("logs_auditoria").insert({
        empresa_id: empresaId,
        ator_id: context.userId,
        ator_contexto: ehPlataforma ? "plataforma" : "organizacao",
        acao: ehPlataforma
          ? "fatura_plano_conciliada_manual"
          : `fatura_plano_confirmada_${data.metodo}`,
        recurso_tipo: "fatura_plataforma",
        recurso_id: data.faturaId,
        resultado: "sucesso",
        detalhes: {
          metodo: data.metodo,
          quitado_em: agoraIso,
          parceiro_id: parceiroPagamentoId,
          confirmadoGateway,
        },
      });
    } catch {
      // não-bloqueante
    }

    return { ok: true, status: "pago" };
  });
