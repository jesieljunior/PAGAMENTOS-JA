# AUDITORIA TÉCNICA COMPLETA — JÁ | GESTÃO DE EQUIPES E PAGAMENTOS

**Data da Auditoria:** 04 de Novembro de 2026  
**Produto:** Já — Gestão de Equipes e Pagamentos  
**Arquitetura:** TypeScript Full-Stack (TanStack Start, TanStack Router, Vite, React 19, Tailwind CSS 4, Supabase / PostgreSQL com RLS, Drizzle ORM, Asaas API Sandbox)  
**Status dos Testes:** 25 suítes de testes, 129 testes automatizados passando (100% de sucesso).  
**Verificação Estática:** TypeScript (`tsc --noEmit`) 0 erros | ESLint 0 erros.

---

## 1. Inventário Arquitetural do Sistema

### 1.1. Estrutura do Repositório

- **`src/routes/`**: Rotas baseadas em arquivo pelo TanStack Router.
  - `src/routes/__root.tsx`: Layout raiz com metatags SEO e providers.
  - `src/routes/index.tsx`: Landing page institucional da plataforma Já.
  - `src/routes/login.tsx`: Autenticação e entrada de operadores e freelancers.
  - `src/routes/ponto.$token.tsx`: Ponto eletrônico mobile público com antifraude (QR Code, geofencing Haversine e selfie para auditoria humana com expurgo LGPD).
  - `src/routes/_authenticated/`: Layout protegido por sessão Supabase (`app-shell.tsx`) com controle RBAC (`ADMIN_MASTER`, `ADMIN_EMPRESA`, `COORDENADOR`, `SUPORTE`).
  - `src/routes/api/public/webhooks/asaas.ts`: Ingestão assíncrona de webhooks com verificação de token, trava atômica inicial de idempotência (`status: "processando"`), política de recuperação de falhas com controle de tentativas e estornos transacionais via RPC.
- **`src/lib/`**: Funções de domínio, regras de negócio e Server Functions (`@tanstack/react-start`):
  - `auth.functions.ts` / `autorizacao.ts`: Resolução de sessões, perfis, capacidades e contexto de tenant (`empresa_atual`).
  - `cobranca.functions.ts` / `cobranca-v2.ts`: Planos de assinatura SaaS, limites de eventos, precificação imutável por ciclo e faturamento de participações.
  - `fechamento.functions.ts` / `fechamento.ts`: Cálculo de diárias, horas extras, adicionais e consolidação de lotes para pagamento.
  - `pagamentos.server.ts`: Bloqueio atômico pessimista contra concorrência (`iniciar_processamento_pagamento_pix`), separação estrita de estados (`pendente`, `processando`, `aguardando_aprovacao`, `executado`, `falhou`, `estornado`) e débito contábil garantido com índice único parcial.
  - `tesouraria.functions.ts` / `tesouraria.ts`: Segregação contábil rígida entre saldo bancário real, adiantamentos de clientes (funding em custódia) e receita de agência.
  - `webhook-idempotencia.ts`: Geração determinística de chaves de idempotência, recuperação de eventos falhos e dedup de eventos de gateway.
  - `ponto.functions.ts`: Máquina de estados ordenada do ponto com persistência obrigatória no PostgreSQL e trilha compulsória em `auditoria_ponto_publico`.
- **`supabase/` & `drizzle/`**:
  - `supabase/migrations/`: Migrações SQL executadas no banco PostgreSQL gerenciado do Supabase, contendo definições de tabelas, triggers, índices únicos parciais, funções de segurança e políticas RLS.
  - `drizzle/`: Definições DDL e schemas tipados (`drizzle/schema.ts`) utilizados para tipagem estrita de entidades no TypeScript e migrações locais estruturadas.

---

## 2. Matriz de Rastreabilidade de Rotas e Funções de Servidor

| Rota / Endpoint              | Acesso / Papéis                      | Server Function / Lógica                         | Tabelas Supabase Acessadas                                                   | Políticas RLS / Segurança                                                  | Teste de Cobertura                                         |
| :--------------------------- | :----------------------------------- | :----------------------------------------------- | :--------------------------------------------------------------------------- | :------------------------------------------------------------------------- | :--------------------------------------------------------- |
| `/`                          | Público                              | Renderização SSR estática                        | Nenhuma                                                                      | Nenhuma                                                                    | N/A                                                        |
| `/login`                     | Público                              | Autenticação Supabase Auth                       | `auth.users`, `usuarios_perfis`                                              | Pública / Sanitização de credenciais                                       | `cadastros.test.ts`                                        |
| `/ponto/$token`              | Público (Token)                      | `obterEventoPonto`, `registrarPontoPublico`      | `eventos`, `pontos`, `colaboradores`                                         | Validação de token (expiração 12h), GPS Haversine, Rate-limit por IP       | `ponto.$token.test.ts`                                     |
| `/painel`                    | Autenticado (`admin`, `coordenador`) | `obterMetricasOperacionaisPainel`                | `eventos`, `escalas`, `pontos`, `fechamentos`, `pagamentos`                  | RLS estrito por `empresa_id` (`empresa_atual()`)                           | `operacao.test.ts`, `saldo.test.ts`                        |
| `/eventos`                   | Autenticado (`admin`, `coordenador`) | `listarEventos`, `criarEvento`                   | `eventos`, `clientes`, `escalas`                                             | RLS: `empresa_id = empresa_atual()`                                        | `eventos.test.ts`                                          |
| `/operacao/$eventoId`        | Autenticado (`admin`, `coordenador`) | `obterOperacaoAoVivo`, `aprovarPonto`            | `eventos`, `escalas`, `pontos`                                               | Auditoria de supervisor, bloqueio de adulteração de tenant                 | `operacao.test.ts`                                         |
| `/fechamentos`               | Autenticado (`admin`, `financeiro`)  | `calcularFechamentoLote`, `consolidarFechamento` | `fechamentos`, `escalas`, `pagamentos`                                       | RLS: leitura e escrita exclusivas do tenant                                | `financeiro-fechamento.test.ts`                            |
| `/financeiro`                | Autenticado (`admin`, `financeiro`)  | `obterExtratoTesouraria`, `solicitarFunding`     | `cobrancas`, `movimentos_saldo`, `fundings`                                  | Segregação estrita de saldos (funding vs receita própria)                  | `tesouraria.test.ts`, `saldo.test.ts`                      |
| `/freelancers`               | Autenticado (`admin`, `coordenador`) | `listarFreelancers`, `cadastrarColaborador`      | `colaboradores`, `contas_bancarias_pix`                                      | Validação de CPF/Chave Pix (Frela vs CLT)                                  | `cadastros.test.ts`, `folha-clt.test.ts`                   |
| `/configuracoes`             | Autenticado (`admin`)                | `atualizarConfiguracaoEmpresa`, `gerenciarPlano` | `empresas`, `planos_assinatura`, `taxas_plataforma`                          | Verificação de role `admin` da empresa                                     | `configuracoes-plano.test.ts`                              |
| `/plataforma/admin`          | Autenticado (`ADMIN_MASTER`)         | `obterMetricasMasterPlataforma`                  | `empresas`, `cobrancas`, `planos_assinatura`                                 | Checagem de role `ADMIN_MASTER` em `usuarios_perfis`                       | `plataforma-admin-suporte.test.ts`                         |
| `/plataforma/suporte`        | Autenticado (`SUPORTE`)              | `iniciarSessaoSuporte`, `consultarAuditada`      | `empresas`, `sessoes_suporte`, `logs_auditoria`                              | Fail-closed: exige ticket aberto; bloqueia movimentação financeira         | `plataforma-admin-suporte.test.ts`, `multi-tenant.test.ts` |
| `/api/public/webhooks/asaas` | Público (Header Secret)              | Webhook Router POST                              | `webhook_eventos`, `cobrancas`, `movimentos_saldo`, `fundings`, `pagamentos` | Autenticação via header `asaas-access-token`, idempotência por chave única | `webhook-idempotencia.test.ts`, `api/routes.test.ts`       |

---

## 3. Segurança e Auditoria de Isolamento Multi-Tenant

### 3.1. Isolamento Estrito de Dados (Org A vs Org B)

- **Princípio Fundamental:** Cada consulta ao banco aplica o predicado `empresa_id = public.empresa_atual()`.
- **Proteção contra IDOR (Insecure Direct Object Reference):** Se a Organização A tentar consultar diretamente um recurso (evento, colaborador, pagamento) da Organização B informando o seu UUID, a consulta resulta em vazio (`null` / 0 registros), pois a chave de tenant é imposta na camada de banco de dados via RLS.
- **Evidência de Teste:** O arquivo `src/lib/multi-tenant.test.ts` valida programmaticamente o isolamento total entre dois tenants sintéticos (`empresa-alpha-111` e `empresa-beta-222`), comprovando que dados e IDs da Org B são inalcançáveis pelo contexto da Org A.

### 3.2. Perfis Privilegiados e Acesso Suporte (Fail-Closed)

- **Operador de Suporte:** Não possui acesso irrestrito. Para visualizar dados de um cliente, deve abrir uma sessão de suporte auditada vinculada a um chamado (`sessao_suporte`).
- **Bloqueio Financeiro de Suporte:** Endpoints de movimentação de dinheiro (disparo de Pix, estorno de saldo, aprovação de lote) falham fechados quando requisitados por usuários com papel `suporte`.
- **Master Admin:** Visão consolidada de faturamento de planos SaaS e saúde do sistema, sem misturar fundos de clientes com a conta de taxas da plataforma.

---

## 4. Auditoria Financeira, Estados de Transferência e Idempotência de Pagamentos

### 4.1. Ambiente Asaas Sandbox

- Todas as transações Pix são processadas contra a API Sandbox do Asaas (`https://sandbox.asaas.com/api/v3`).
- **Nenhum centavo real é transferido em ambiente de homologação ou teste.**
- Variável `ASAAS_ENVIRONMENT=sandbox` é aplicada por padrão.

### 4.2. Máquina de Estados, Bloqueio Atômico e Confirmação de Transferências Pix

- **Bloqueio Atômico Pessimista contra Concorrência:** Antes de invocar a API externa do parceiro Asaas, o sistema executa a transição atômica `pendente` ➔ `processando` no PostgreSQL via RPC `iniciar_processamento_pagamento_pix` (com bloqueio de linha `FOR UPDATE`) ou via atualização condicional estrita. Se requisições simultâneas chegarem para o mesmo pagamento, apenas a primeira adquire o lock; as demais falham imediatamente sem disparar transferências duplicadas.
- **Separação Rígida de Estados em `src/lib/pagamentos.server.ts`:**
  - `pendente`: Pagamento criado e aguardando processamento.
  - `processando`: Transferência despachada para o parceiro Asaas, aguardando liquidação bancária (`PENDING` ou `BANK_PROCESSING`). **Nunca** marcado como executado prematuramente.
  - `aguardando_aprovacao`: Requer aprovação ou autorização de ação crítica no Asaas (`AWAITING_CRITICAL_ACTION_AUTHORIZATION`).
  - `executado`: Transferência terminalmente confirmada (`DONE` ou `CONFIRMED`) via webhook ou conciliação com timestamp registrado.
  - `falhou`: Transferência rejeitada pelo banco recebedor ou dados inválidos (`TRANSFER_FAILED`, `TRANSFER_CANCELLED`).
  - `estornado`: Transferência revertida após execução (`TRANSFER_REVERSED`), com re-crédito compensatório no saldo da agência.
- **Efetivação e Débito Transacional Garantido:** O débito contábil em `movimentos_saldo` é vinculado ao `pagamento_id` e protegido pelo índice único parcial no PostgreSQL (`idx_movimentos_pagamento_debito`), garantindo que nenhuma transferência seja criada sem o correspondente lançamento contábil nem duplicada por concorrência.

### 4.3. Ingestão Atômica de Webhooks, Retomada de Falhas e Estornos Transacionais

- **Aquisição e Política de Recuperação de Idempotência:**
  1. A rota `/api/public/webhooks/asaas` insere imediatamente em `webhook_eventos` com status `processando` e chave determinística (`asaas-webhook:{evento}:{paymentId}:{transferId}:{valor}`).
  2. Concorrência simultânea no mesmo milissegundo intercepta a constraint `23505` (`unique_violation`).
  3. Se o evento já existir com status `processado`, responde `200 OK` imediatamente.
  4. Se o evento estiver com status `falhou` ou `processando` expirado (> 5 minutos por crash de processo), o sistema adquire a retomada, incrementa o contador `tentativas` (com teto máximo de 5 tentativas) e reprocessa de forma segura.
- **Estorno Transacional Atômico (`reverter_transferencia_pagamento_pix`):**
  - Eventos de reversão (`TRANSFER_FAILED`, `TRANSFER_CANCELLED`, `TRANSFER_REVERSED`) executam a alteração de status do pagamento e a inserção do crédito de estorno dentro da mesma transação ACID no PostgreSQL.
  - O crédito de estorno é protegido pelo índice único parcial `idx_movimentos_pagamento_credito`, impedindo duplo estorno sob múltiplas entregas do parceiro bancário.

### 4.4. Validação Estrita de Tenant em RPCs Financeiras Security Definer

- **Vulnerabilidade Mitigada:** Funções `SECURITY DEFINER` no PostgreSQL contornam as políticas de RLS e executam com privilégios de superusuário/owner. Sem validação explícita de tenant no corpo da função, um usuário autenticado da Empresa A poderia enviar o UUID de um pagamento da Empresa B.
- **Implementação (Migração `20261104140000_finance_tenant_security_and_saas_invoicing.sql`):**
  - Foi criado o helper `public.empresa_do_pagamento(_pagamento_id uuid)` que resolve deterministicamente o tenant a partir da cadeia `pagamentos ➔ fechamentos ➔ escalas ➔ equipes ➔ eventos ➔ empresa`.
  - As funções `iniciar_processamento_pagamento_pix`, `efetivar_pagamento_pix_db` e `reverter_transferencia_pagamento_pix` agora validam explicitamente se `auth.uid() IS NOT NULL`:
    `IF NOT (public.eh_equipe_plataforma() OR v_empresa_pagamento = public.empresa_atual()) THEN RAISE EXCEPTION 'Acesso negado: você não tem permissão para esta operação.'; END IF;`
  - Permissões de execução foram expressamente revogadas para `public` e `anon`.

### 4.5. Conciliação de Faturas SaaS e Descontinuação Unificada do Mercado Pago

- **Prevenção de Fraude em Faturas SaaS:** A função `confirmarPagamentoFaturaPlano` em `src/lib/cobranca.functions.ts` foi blindada contra fraudes de auto-quitação. Um tenant autenticado não pode mais alterar unilateralmente uma fatura para `pago`. A função consulta ativamente a API oficial do Asaas (`buscarCobrancaPorReferencia` / `obterCobrancaAsaas`) para validar se o pagamento está com status `RECEIVED`, `CONFIRMED` ou `RECEIVED_IN_CASH`. Somente após validação do gateway (ou conciliação por operador com permissão de plataforma), a fatura é liquidada e a assinatura ativada.
- **Liquidação Automática via Webhook Asaas:** A rota `/api/public/webhooks/asaas` processa os eventos `PAYMENT_RECEIVED` e `PAYMENT_CONFIRMED` verificando se o identificador ou `externalReference` pertence a uma fatura SaaS (`faturas_plataforma`), executando a RPC atômica `liquidar_fatura_plataforma_asaas` de forma completamente segregada das cobranças de _funding_ operacional de clientes.
- **Unificação no Asaas e Desativação do Mercado Pago:** Todo o ecossistema financeiro (repasses Pix, custódia de clientes e cobrança de planos SaaS) foi unificado no Asaas v3. O fluxo legado via Mercado Pago foi formalmente descontinuado.

---

## 5. Auditoria de Antifraude do Ponto Eletrônico, Resiliência Serverless e LGPD

### 5.1. Mecanismos de Proteção e Resiliência

1. **Persistência Obrigatória sem Fallback Silencioso:** O fluxo de ponto eletrônico nunca retorna sucesso (`ok: true`) baseado apenas em estado volátil em memória (`sessao`) ou arquivo local `/tmp/ponto-store.json`. A gravação no PostgreSQL (`pontos` e `auditoria_ponto_publico`) é mandatória. Qualquer indisponibilidade no banco de dados falha de forma explícita (`fail-closed`), mantendo a integridade operacional e probatória.
2. **Resiliência Serverless (Multi-instâncias / Vercel):**
   - O registro de ponto em `src/lib/ponto.functions.ts` possui resolução nativa diretamente no PostgreSQL quando executado em containers serverless frios ou instâncias paralelas.
   - O endpoint `identificarNoPonto` consulta o histórico real de marcações no PostgreSQL, impedindo que colaboradores recebam visualizações desatualizadas devido a instâncias distintas da Vercel.
3. **QR Code Criptografado com Expiração Estrita e Zero Hardcoded Secret:**
   - O módulo `src/lib/ponto.signed-token.ts` teve seu segredo estático padrão removido; ele exige variáveis de ambiente do servidor (`PONTO_SIGNING_SECRET`, `JWT_SECRET` ou `SUPABASE_JWT_SECRET`). Em produção, a ausência de chave resulta em erro fail-closed.
   - A expiração do token é estrita no timestamp informado pelo evento, com tolerância máxima de 30 segundos apenas para desvio leve de relógio de rede (`clock drift`), eliminando a janela arbitrária de 12 horas.
4. **Geolocalização Haversine:** A coordenada GPS informada pelo navegador móvel do colaborador é validada contra a latitude/longitude do evento com raio de tolerância configurável (300m a 1000m).
5. **Máquina de Estados de Marcações:** A ordem cronológica `Entrada` ➔ `Início de Intervalo` ➔ `Fim de Intervalo` ➔ `Saída` é estritamente exigida. Batidas repetidas ou fora de ordem são rejeitadas.
6. **Trilha de Auditoria Pública:** Toda tentativa de registro gera registro imutável em `auditoria_ponto_publico` com status, tipo e detalhes técnicos.
7. **Selfie como Evidência de Auditoria Humana:**
   - A selfie não é alegada como biometria facial algorítmica viva, mas como registro fotográfico de evidência para conferência pelo supervisor.
   - Consentimento explícito do trabalhador registrado no ato da foto.
   - Armazenamento em bucket seguro com chave de retenção configurável e rotina de expurgo automático de conformidade com a LGPD.

---

## 6. Auditoria de Segredos e PII (LGPD)

- **Script Automatizado:** `scripts/scan-secrets.mjs` executado sobre todo o repositório (`src/`, `scripts/`, `supabase/`, `drizzle/`, `docs/`, `public/`).
- **Resultado:** **0 segredos encontrados, 0 CPFs ou dados pessoais reais identificados.**
- **Conformidade de Seeds e Testes:** Todos os CPFs, CNPJs e telefones utilizados em fixtures e testes automatizados são mocks sintéticos desprovidos de titularidade humana.

