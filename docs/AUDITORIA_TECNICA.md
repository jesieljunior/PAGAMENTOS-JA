# AUDITORIA TÉCNICA COMPLETA — JÁ | GESTÃO DE EQUIPES E PAGAMENTOS

**Data da Auditoria:** 04 de Novembro de 2026  
**Produto:** Já — Gestão de Equipes e Pagamentos  
**Arquitetura:** TypeScript Full-Stack (TanStack Start, TanStack Router, Vite, React 19, Tailwind CSS 4, Supabase / PostgreSQL com RLS, Drizzle ORM, Asaas API Sandbox)  
**Status dos Testes:** 25 suítes de testes, 128 testes automatizados passando (100% de sucesso).  
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
  - `src/routes/api/public/webhooks/asaas.ts`: Ingestão assíncrona de webhooks com verificação de token, trava atômica inicial de idempotência (`status: "processando"`) e ciclo de vida completo de transferências e cobranças.
- **`src/lib/`**: Funções de domínio, regras de negócio e Server Functions (`@tanstack/react-start`):
  - `auth.functions.ts` / `autorizacao.ts`: Resolução de sessões, perfis, capacidades e contexto de tenant (`empresa_atual`).
  - `cobranca.functions.ts` / `cobranca-v2.ts`: Planos de assinatura SaaS, limites de eventos, precificação imutável por ciclo e faturamento de participações.
  - `fechamento.functions.ts` / `fechamento.ts`: Cálculo de diárias, horas extras, adicionais e consolidação de lotes para pagamento.
  - `pagamentos.server.ts`: Máquina de estados financeira estrita (`pendente`, `processando`, `aguardando_aprovacao`, `executado`, `falhou`, `estornado`), eliminando confirmações prematuras de Pix.
  - `tesouraria.functions.ts` / `tesouraria.ts`: Segregação contábil rígida entre saldo bancário real, adiantamentos de clientes (funding em custódia) e receita de agência.
  - `webhook-idempotencia.ts`: Geração determinística de chaves de idempotência e dedup de eventos de gateway.
  - `ponto.functions.ts`: Máquina de estados ordenada do ponto resiliente a serverless com persistência direta no PostgreSQL e trilha em `auditoria_ponto_publico`.
- **`supabase/` & `drizzle/`**:
  - `supabase/migrations/`: Migrações SQL executadas no banco PostgreSQL gerenciado do Supabase, contendo definições de tabelas, triggers, funções de segurança e políticas RLS.
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

### 4.2. Máquina de Estados e Confirmação de Transferências Pix

- **Separação Rígida de Estados em `src/lib/pagamentos.server.ts`:**
  - `pendente`: Pagamento criado e aguardando processamento.
  - `processando`: Transferência despachada para o parceiro Asaas, aguardando liquidação bancária (`PENDING` ou `BANK_PROCESSING`). **Nunca** marcado como executado prematuramente.
  - `aguardando_aprovacao`: Requer aprovação ou autorização de ação crítica no Asaas (`AWAITING_CRITICAL_ACTION_AUTHORIZATION`).
  - `executado`: Transferência terminalmente confirmada (`DONE` ou `CONFIRMED`) via webhook ou polling com data de execução registrada.
  - `falhou`: Transferência rejeitada pelo banco recebedor ou dados inválidos (`TRANSFER_FAILED`, `TRANSFER_CANCELLED`).
  - `estornado`: Transferência revertida após execução (`TRANSFER_REVERSED`), com re-crédito compensatório no saldo da agência.

### 4.3. Ingestão Atômica de Webhooks e Prevenção Concorrente de Duplo Débito/Crédito

- A rota `/api/public/webhooks/asaas` adquire o lock de idempotência **antes** de qualquer efeito colateral:
  1. Insere imediatamente em `webhook_eventos` com status `processando` e chave única determinística (`asaas-webhook:{evento}:{paymentId}:{transferId}:{valor}`).
  2. Caso ocorra concorrência e o PostgreSQL retorne `unique_violation` (`23505`), o handler encerra com `200 OK` instantaneamente, garantindo atomicidade sem janelas de race condition.
  3. Processa a atualização financeira em transação controlada e finaliza o status do evento para `processado` ou `falhou`.
  4. Trata o ciclo completo de transferências Asaas (`TRANSFER_DONE`, `TRANSFER_CONFIRMED`, `TRANSFER_FAILED`, `TRANSFER_CANCELLED`, `TRANSFER_REVERSED`), garantindo estorno automático do extrato sem duplicações.

---

## 5. Auditoria de Antifraude do Ponto Eletrônico, Resiliência Serverless e LGPD

### 5.1. Mecanismos de Proteção e Resiliência

1. **QR Code Dinâmico e Assinado:** Expira automaticamente após o evento (tolerância máxima de 12 horas). Tokens criptograficamente assinados (`qr.<payload>.<hmac>`) permitem validação independente de sessões em memória.
2. **Resiliência Serverless (Multi-instâncias / Vercel):**
   - O registro de ponto em `src/lib/ponto.functions.ts` possui resolução nativa diretamente no PostgreSQL quando executado em containers serverless frios ou instâncias paralelas.
   - Não depende de sessões voláteis em memória RAM (`sessao`) para garantir a persistência das marcações.
   - Valida a sequência cronológica real das marcações consultando o histórico no banco de dados.
3. **Geolocalização Haversine:** A coordenada GPS informada pelo navegador móvel do colaborador é validada contra a latitude/longitude do evento com raio de tolerância configurável (300m a 1000m).
4. **Máquina de Estados de Marcações:** A ordem cronológica `Entrada` ➔ `Início de Intervalo` ➔ `Fim de Intervalo` ➔ `Saída` é estritamente exigida. Batidas repetidas ou fora de ordem são rejeitadas.
5. **Trilha de Auditoria Pública:** Toda tentativa de registro gera registro imutável em `auditoria_ponto_publico` com status, tipo e detalhes técnicos.
6. **Selfie como Evidência de Auditoria Humana:**
   - A selfie não é alegada como biometria facial algorítmica viva, mas como registro fotográfico de evidência para conferência pelo supervisor.
   - Consentimento explícito do trabalhador registrado no ato da foto.
   - Armazenamento em bucket seguro com chave de retenção configurável e rotina de expurgo automático de conformidade com a LGPD.

---

## 6. Auditoria de Segredos e PII (LGPD)

- **Script Automatizado:** `scripts/scan-secrets.mjs` executado sobre todo o repositório (`src/`, `scripts/`, `supabase/`, `drizzle/`, `docs/`, `public/`).
- **Resultado:** **0 segredos encontrados, 0 CPFs ou dados pessoais reais identificados.**
- **Conformidade de Seeds e Testes:** Todos os CPFs, CNPJs e telefones utilizados em fixtures e testes automatizados são mocks sintéticos desprovidos de titularidade humana.
