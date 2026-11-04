# Já — Gestão de Equipes e Pagamentos

[![CI](https://github.com/amarusdeveloper/PAGAMENTOS-JA/actions/workflows/ci.yml/badge.svg)](https://github.com/amarusdeveloper/PAGAMENTOS-JA/actions/workflows/ci.yml)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue.svg)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-19-61dafb.svg)](https://react.dev/)
[![TanStack Start](https://img.shields.io/badge/TanStack_Start-1.121-orange.svg)](https://tanstack.com/start)
[![Supabase](https://img.shields.io/badge/Supabase-PostgreSQL_RLS-3ecf8e.svg)](https://supabase.com/)
[![Tests](https://img.shields.io/badge/Tests-128_passing-brightgreen.svg)](docs/TESTES.md)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

> **Plataforma corporativa B2B desenvolvida pela [Swali](https://www.swali.com.br/) para agências de eventos, produtoras e promotoras: monte escalas de equipe, colete folha de ponto digital em campo com selfie e geofencing GPS, faça o fechamento financeiro seguro e realize repasses via Pix no mesmo fluxo.**  
> Desenvolvido em **TypeScript Full-Stack**, **TanStack Start**, **React 19**, **PostgreSQL gerenciado (Supabase)**, **Drizzle ORM** e gateway financeiro **Asaas (v3)**.

---

## 📌 Visão Geral do Produto

Agências de casting, produtoras de eventos e empresas de terceirização enfrentam desafios operacionais e fiscais críticos no dia a dia:

1. **Fraudes em ponto de campo:** colaboradores que registram entrada sem estar no local ou compartilham links.
2. **Fechamento manual caótico:** conferência de horas, intervalos e diárias em planilhas manuais sujeitas a falhas.
3. **Confusão patrimonial e fiscal:** mistura entre os adiantamentos recebidos dos clientes contratantes (_funding_ em custódia de diárias) e a margem de receita própria da agência.
4. **Fricção bancária:** repasses individuais manuais via Pix para dezenas de profissionais ao término de cada escala.

A plataforma **Já** atua em um fluxo operacional unificado:

- **Ponto Digital em Campo:** check-in/out via celular do colaborador com leitura de QR Code dinâmico (expiração em 12h), geofencing por GPS (cálculo Haversine) e registro de selfie para conferência humana pelo supervisor.
- **Fechamento Operacional:** apuração de horas trabalhadas, horas extras e valor líquido com conferência em tela única e aprovação pelo coordenador.
- **Tesouraria com Segregação de Saldos:** separação contábil clara e isolada entre saldo real bancário, saldo aportado por clientes em custódia (_funding_) e receita de agência.
- **Repasses Pix e Webhooks:** integração com gateway bancário (Asaas API v3) com idempotência transacional contra duplicidade de créditos e monitoramento de expiração de credenciais.

---

## 🚀 Arquitetura e Stack Tecnológica

| Camada                    | Tecnologia                                                                         | Papel no Projeto                                                                           |
| :------------------------ | :--------------------------------------------------------------------------------- | :----------------------------------------------------------------------------------------- |
| **Full-Stack Framework**  | [TanStack Start](https://tanstack.com/start) + [React 19](https://react.dev/)      | SSR performante, type-safety de ponta a ponta e Server Functions executadas no servidor.   |
| **Linguagem**             | [TypeScript](https://www.typescriptlang.org/)                                      | Tipagem estrita com modo estrito de propriedades (`exactOptionalPropertyTypes`).           |
| **Banco de Dados & Auth** | [PostgreSQL (Supabase)](https://supabase.com/)                                     | Runtime de produção, Row Level Security (RLS) multi-tenant e autenticação GoTrue.          |
| **Schema as Code**        | [Drizzle ORM](https://orm.drizzle.team/)                                           | Definição declarativa de schemas (`drizzle/schema.ts`), migrações e tipagem de domínio.    |
| **Estilização & UI**      | [Tailwind CSS 4](https://tailwindcss.com/) + [Radix UI](https://www.radix-ui.com/) | Design system corporativo desenvolvido para alta densidade de informação operacional.      |
| **Gateway de Pagamento**  | [Asaas API v3](https://docs.asaas.com/)                                            | Cobranças e repasses Pix com suporte automático para ambientes de Sandbox e Produção.      |
| **Testes Automatizados**  | [Vitest](https://vitest.dev/)                                                      | 25 suítes e 128 testes cobrindo multi-tenancy, idempotência, tesouraria e regras de ponto. |
| **Hospedagem & Deploy**   | [Vercel](https://vercel.com/) / Docker                                             | Deploy nativo com suporte a SSR e rotas de API com pré-configuração em `vercel.json`.      |

---

## 📋 Funcionalidades Principais

| Módulo / Funcionalidade                  |     Status      | Detalhes                                                                                        |
| :--------------------------------------- | :-------------: | :---------------------------------------------------------------------------------------------- |
| **Landing Page Swali com Mockups**       | ✅ Implementado | Página inicial moderna para agências de eventos, com mockups ilustrativos e identidade Swali.   |
| **Monitoramento da API Asaas**           | ✅ Implementado | Alerta no painel Master com contagem regressiva para renovação da chave de integração.          |
| **Isolamento Multi-Tenant Estrito**      | ✅ Implementado | RLS em todas as tabelas de negócio; comprovado por testes automatizados de cross-tenant.        |
| **Ponto Mobile Antifraude**              | ✅ Implementado | QR Code com expiração de 12h, tolerância GPS Haversine e selfie para auditoria do supervisor.   |
| **Máquina de Estados de Marcações**      | ✅ Implementado | Sequência estrita `Entrada ➔ Início Intervalo ➔ Fim Intervalo ➔ Saída`; rejeição de duplicatas. |
| **Segregação de Saldos em Tesouraria**   | ✅ Implementado | Separação contábil entre adiantamento de clientes (_funding_ em custódia) e receita própria.    |
| **Faturamento SaaS V2**                  | ✅ Implementado | Planos por participações deduplicadas com precificação imutável congelada por ciclo.            |
| **Ingestão Idempotente de Webhooks**     | ✅ Implementado | Tabela `webhook_eventos` com hash determinístico e proteção contra duplo crédito.               |
| **Perfis e Acesso Suporte Auditado**     | ✅ Implementado | RBAC (`admin`, `coordenador`, `suporte`, `master`); suporte falha fechado sem ticket ativo.     |
| **Repasses Pix Integrados**              | ✅ Implementado | Disparo de Pix em lote e conferência financeira com liquidação na chave Pix do profissional.    |
| **Validação Cadastral Frela vs CLT**     | ✅ Implementado | Validações fiscais de CPF, PIS, chave Pix e separação de rotinas de cálculo.                    |
| **Suíte de Testes Automatizados**        | ✅ Implementado | 25 arquivos de teste e 128 testes automatizados com 100% de aprovação no Vitest.                |
| **Pipeline de Integração Contínua (CI)** | ✅ Implementado | GitHub Actions com lint, build de rotas, typecheck, varredura de segredos e testes.             |
| **Deploy Nativo na Vercel**              | ✅ Implementado | Arquivo `vercel.json` configurado com rewrites adequados para TanStack Start / Nitro.           |

---

## ⏱️ Ponto Digital, Folha de Pagamento e Motor de Fechamento

O coração da plataforma **Já** foi construído para eliminar 100% do atrito entre a operação física em campo (eventos, feiras, estandes, ativações) e a folha de pagamento/tesouraria da agência. Abaixo detalhamos a arquitetura, tecnologias, lógica de regras e fluxo de ponta a ponta.

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                        FLUXO INTEGRADO OPERACIONAL E FINANCEIRO                         │
└────────────────────────────────────────────────────────────────────────────────────────┘
  1. CAMPO: Smartphone do Freelancer           2. NUVEM / SERVER FUNCTIONS (Zero Bypass)
  ┌─────────────────────────────────┐          ┌────────────────────────────────────────┐
  │ • Leitura de QR Code do Evento   │ ───────► │ • Validação do Token HMAC (exp. 12h)   │
  │ • Liveness WebAssembly (2 pisc.)│          │ • Geofencing Haversine (Raio de Metros)│
  │ • Captura de Selfie Probatória  │          │ • Máquina de Estados (Entrada/Intervalo)│
  │ • Coordenadas Geográficas (GPS) │          │ • Gravação Protegida em Supabase/RLS   │
  └─────────────────────────────────┘          └───────────────────┬────────────────────┘
                                                                   │
  3. PAINEL DO SUPERVISOR (Em Tempo Real)                          ▼
  ┌─────────────────────────────────────────────────────────────────────────────────────┐
  │ • Visão de Presença: Pendentes, Presentes, Jornada Concluída e Sem Ponto            │
  │ • Modal de Auditoria: Inspeção Visual da Selfie + Mapa GPS + Flag "Fora de Horário" │
  │ • Decisão Rápida: Aprovar ou Recusar (com motivo justificado) ou Lançamento Manual  │
  └────────────────────────────────┬────────────────────────────────────────────────────┘
                                   │
  4. MOTOR DE FECHAMENTO E FOLHA   ▼
  ┌─────────────────────────────────────────────────────────────────────────────────────┐
  │ • Freelancer (Diária Fechada ou Valor/Hora com dedução matemática de intervalos)     │
  │ • CLT (Salário base pro-rata 30 dias, apuração de faltas injustificadas e abonos)   │
  │ • Validação de consistência (trava se Saída < Entrada) ➔ Aprovação do Coordenador   │
  └────────────────────────────────┬────────────────────────────────────────────────────┘
                                   │
  5. TESOURARIA E LIQUIDAÇÃO PIX   ▼
  ┌─────────────────────────────────────────────────────────────────────────────────────┐
  │ • Segregação de Saldos: Funding Transitório de Clientes vs Margem Própria da Agência│
  │ • Disparo de Pix em Lote via Asaas API v3 com Chave de Idempotência Criptográfica   │
  │ • Recibo gerado e conciliação bancária automática via Webhooks                      │
  └─────────────────────────────────────────────────────────────────────────────────────┘
```

---

### 1. Tecnologias do Ponto Mobile e Antifraude

O módulo de captura de ponto foi concebido para rodar como uma **Progressive Web App (PWA)** no celular de qualquer colaborador, dispensando instalação de aplicativos pesados em lojas e operando com os mais altos padrões de segurança:

#### A. Detecção de Vivacidade (Liveness) com WebAssembly e MediaPipe

- **Stack:** `@mediapipe/tasks-vision` rodando via WebAssembly (WASM) nativo no navegador do smartphone, com aceleração por hardware (GPU/WebGL) e fallback suave para CPU.
- **Detecção de 468 Marcos Faciais (FaceMesh):** O modelo localiza a geometria facial tridimensional em tempo real, verificando inclinação de cabeça (_head pose_), distância da câmera e estabilidade de enquadramento.
- **Cálculo Científico do EAR (Eye Aspect Ratio):** Baseado na metodologia de Soukupová & Čech:
  $$\text{EAR} = \frac{||\mathbf{p}_2 - \mathbf{p}_6|| + ||\mathbf{p}_3 - \mathbf{p}_5||}{2 \cdot ||\mathbf{p}_1 - \mathbf{p}_4||}$$
- **Protocolo de Dupla Piscada Natural:** O sistema mede o baseline com olhos abertos e exige **duas piscadas voluntárias consecutivas** com duração fisiológica válida (entre 66 ms e 400 ms de fechamento, com intervalo entre piscadas inferior a 2 segundos). Isso impossibilita o uso de fotos impressas, gravações de vídeo em loop ou máscaras estáticas para fraudar presença.
- **Privacidade, Ética e Conformidade LGPD:** As selfies coletadas são **evidências de conferência humana para o supervisor**, **NÃO biometria automatizada invasiva**. O colaborador concorda explicitamente antes da ativação da câmera, e todas as fotos possuem prazo de expiração programado (política de retenção configurável no banco, padrão de 90 dias, purgada automaticamente por rotinas de background).

#### B. QR Code Criptográfico Dinâmico (12 Horas de Vida Útil)

- O QR Code gerado pelo supervisor em campo é assinado criptograficamente com **HMAC-SHA256** no servidor (`src/lib/ponto.signed-token.ts`), contendo o identificador do evento e da agência.
- O token possui **validade máxima de 12 horas**. Prints de tela tirados em dias anteriores ou links compartilhados por grupos de mensagens expiram automaticamente e são recusados pelo backend.

#### C. Geofencing por GPS com Cálculo de Haversine

- Coleta as coordenadas de latitude, longitude e margem de erro (`accuracy`) via API nativa de geolocalização do navegador.
- Calcula a distância ortodrômica em metros entre o colaborador e o endereço configurado para o evento através da fórmula de Haversine:
  $$d = 2R \cdot \arcsin\left(\sqrt{\sin^2\left(\frac{\Delta \phi}{2}\right) + \cos(\phi_1)\cos(\phi_2)\sin^2\left(\frac{\Delta \lambda}{2}\right)}\right)$$
- Caso o colaborador esteja fora do raio estipulado (ou caso desative o GPS quando a agência exigir localização ativa), a tentativa de marcação é bloqueada no servidor.

#### D. Gravação Estrita Server-Side (Zero Bypass)

- **Princípio inviolável:** O cliente web/mobile **nunca** escreve diretamente na tabela `pontos` do banco de dados.
- Toda marcação passa por Server Functions auditadas (`ponto.functions.ts`) ou pela Edge Function dedicada (`ponto-publico`), garantindo:
  - Registro do carimbo de data e hora do servidor (`server timestamp`).
  - Validação do token de sessão ativo.
  - Gravação do histórico auditável em `auditoria_ponto_publico` (com IP de origem e User-Agent).

---

### 2. Máquina de Estados das Marcações

Para assegurar uma folha de ponto juridicamente válida e consistente, o motor de ponto aplica uma **máquina de estados finitos sequencial**:

```
 [ Início da Escala ]
         │
         ▼
    ┌─────────┐
    │ Entrada │ ◄── (Obrigatório para iniciar a jornada em campo)
    └────┬────┘
         │
         ├─────────────────────────────────────────────┐
         │ (Se houver intervalo previsto)              │ (Sem intervalo)
         ▼                                             │
 ┌─────────────────┐                                   │
 │ Início Intervalo│                                   │
 └───────┬─────────┘                                   │
         │                                             │
         ▼                                             │
 ┌─────────────────┐                                   │
 │  Fim Intervalo  │                                   │
 └───────┬─────────┘                                   │
         │                                             │
         ├─────────────────────────────────────────────┘
         ▼
    ┌─────────┐
    │  Saída  │ ◄── (Conclui a jornada de trabalho do dia)
    └─────────┘
```

- **Rejeição de Inconsistências:** O servidor bloqueia marcações fora de ordem (ex.: tentar bater `saida` sem ter batido `entrada`, ou bater dois `inicio_intervalo` em sequência).
- **Detecção de "Fora de Horário":** Compara o horário real da batida com a grade de horários configurada na escala. Se a diferença exceder a tolerância estabelecida, a marcação é gravada com a flag `fora_horario: true`, alertando o supervisor na tela de conferência para análise de hora extra ou atraso.
- **Ponto Manual com Justificativa:** Supervisores autorizados podem lançar marcações manuais para colaboradores que enfrentaram problemas de bateria ou conectividade, exigindo motivo detalhado e gerando log de auditoria permanente.

---

### 3. Motor de Cálculo de Folha e Fechamento Operacional

O motor de cálculo (`src/lib/dominio.ts`, `src/lib/fechamento.ts`, `src/lib/folha-clt.ts`) processa as jornadas validadas adaptando-se às regras de contratação de cada profissional:

#### A. Regime Freelancer / Diarista (`tipo_vinculo: 'frela'`)

1. **Diária Fechada (`tipo_valor: 'diaria'`):**
   - Remuneração fixa acordada para o evento, independentemente de pequenas variações de minutos no término, desde que a jornada tenha sido cumprida e aprovada pelo supervisor.
2. **Valor por Hora Trabalhada (`tipo_valor: 'hora'`):**
   - Apuração do tempo bruto decorrido:
     $$\text{Horas Brutas} = \frac{\text{Timestamp Saída} - \text{Timestamp Entrada}}{3.600.000}$$
   - Dedução matemática exata de todos os intervalos registrados (`horasIntervalos`):
     $$\text{Horas Líquidas} = \max(\text{Horas Brutas} - \text{Total Intervalos}, 0)$$
   - Cálculo financeiro com arredondamento contábil oficial de 2 casas decimais:
     $$\text{Valor Total} = \text{arredonda}(\text{Horas Líquidas} \times \text{Valor Hora Combinado})$$
   - **Trava de Segurança de Jornada:** Se o timestamp de saída for registrado anterior ao de entrada, o sistema trava o fechamento com status `requerRevisao: true` e motivo `"A saída não está depois da entrada."`, impedindo pagamentos indevidos.

#### B. Regime CLT / Mensalista (`tipo_vinculo: 'clt'`)

- Apuração mensal proporcional com base em 30 dias regulamentares (`calcularFolhaClt`):
  $$\text{Desconto de Faltas} = \text{arredonda}\left(\frac{\text{Salário Base}}{30} \times \min(\text{Faltas Injustificadas}, 30)\right)$$
  $$\text{Valor Final da Folha} = \max(\text{Salário Base} - \text{Desconto}, 0)$$
- **Abono de Faltas:** Possibilidade de abonar ausências justificadas por atestado médico ou autorização da diretoria (`descontoAbonado = true`), zerando a penalidade financeira com registro no dossiê do colaborador.
- **Validação Cadastral:** Checagem de CPF e número do PIS/PASEP para emissão de relatórios compatíveis com a contabilidade da agência.

#### C. Painel de Supervisão e Gestão de Ocorrências

- **Filtros Dinâmicos:** Classificação instantânea da equipe entre _Pendentes de Decisão_, _Presentes em Campo_, _Jornada Concluída_ e _Sem Registro_.
- **Registro de Ocorrências:** Campo estruturado para apontamento de quebras de dress-code, elogios de clientes, advertências verbais ou acidentes em campo, vinculados à escala do colaborador.
- **Aprovação Individual ou em Lote:** O coordenador pode inspecionar caso a caso ou aprovar todos os pontos pendentes validados com um único clique.

---

### 4. Ciclo Financeiro Integrado: Da Presença ao Pix

O encerramento do ponto conecta-se diretamente à esteira de tesouraria e repasses:

1. **Aprovação do Fechamento:** O coordenador homologa a planilha de fechamento do evento, consolidando horas, diárias e valores líquidos a pagar.
2. **Segregação Patrimonial (Funding vs Receita):**
   - Os valores destinados aos trabalhadores são tratados estritamente como _custódia operacional_ proveniente do adiantamento do cliente contratante (_funding_).
   - A margem da agência e o faturamento SaaS da plataforma (Billing V2) permanecem em contas contábeis segregadas, eliminando risco de bitributação ou confusão patrimonial.
3. **Disparo de Repasses Pix (Asaas API v3):**
   - A tesouraria autoriza os lotes de pagamento.
   - Cada transferência Pix utiliza a chave cadastrada pelo colaborador (CPF, telefone, e-mail ou EVP) acompanhada de uma **chave de idempotência determinística** (`chave_idempotencia = SHA256(pagamento_id + valor + destino)`).
   - Se houver oscilação de rede ou queda de conexão, o gateway reconhece a chave e nunca processa o débito duas vezes.
4. **Comprovantes e Notificações:** Liquidação confirmada via Webhook e geração de recibos fiscais/operacionais para prestação de contas com o cliente contratante.

---

## 🛠️ Como Executar Localmente

### Pré-requisitos

- **Node.js 22+**
- **npm** (gerenciador oficial padronizado do projeto)

### 1. Clonar o Repositório

```bash
git clone https://github.com/amarusdeveloper/PAGAMENTOS-JA.git
cd PAGAMENTOS-JA
```

### 2. Instalar Dependências

```bash
npm install
```

### 3. Configurar Variáveis de Ambiente

Copie o arquivo de exemplo e configure suas chaves do Supabase e Asaas:

```bash
cp .env.example .env
```

### 4. Executar em Modo de Desenvolvimento

```bash
npm run dev
# Acesse no seu navegador: http://localhost:3000
```

---

## 🧪 Qualidade, Segurança e Testes

A integridade do código é mantida através de comandos padronizados:

```bash
# Executar todos os 99 testes automatizados (Vitest)
npm run test

# Verificação estática de tipos (TypeScript)
npm run typecheck

# Análise de padrões de código (ESLint)
npm run lint

# Varredura de segredos e conformidade com LGPD
npm run scan:secrets

# Formatação estrita com Prettier
npm run format

# Compilar para produção
npm run build
```

---

## 🚢 Como Implantar na Vercel

1. No painel da **[Vercel](https://vercel.com/)**, selecione o repositório `amarusdeveloper/PAGAMENTOS-JA`.
2. O framework preset será reconhecido automaticamente via `vercel.json`.
3. Nas **Environment Variables** da Vercel, adicione:
   - `SUPABASE_PROJECT_ID`: `rutmjtmirwcyoroyjqdy`
   - `SUPABASE_URL`: `https://rutmjtmirwcyoroyjqdy.supabase.co`
   - `SUPABASE_PUBLISHABLE_KEY`: _(sua chave publicável Supabase)_
   - `SUPABASE_SERVICE_ROLE_KEY`: _(chave `service_role` ou `sb_secret_`; somente servidor, nunca use prefixo `VITE_`)_
   - `VITE_SUPABASE_PROJECT_ID`: `rutmjtmirwcyoroyjqdy`
   - `VITE_SUPABASE_URL`: `https://rutmjtmirwcyoroyjqdy.supabase.co`
   - `VITE_SUPABASE_PUBLISHABLE_KEY`: _(sua chave publicável Supabase)_
   - `ASAAS_API_KEY`: _(sua chave de API de produção do Asaas)_
   - `ASAAS_AMBIENTE`: `producao`
   - `ASAAS_WEBHOOK_TOKEN`: _(seu token de validação de webhook)_
4. Execute as migrações SQL pendentes no projeto Supabase.
5. Publique a Edge Function do ponto usando a CLI:

   ```bash
   npx supabase login
   npx supabase link --project-ref rutmjtmirwcyoroyjqdy
   npx supabase functions deploy ponto-publico
   ```

   A função usa `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` do ambiente protegido do Supabase. A chamada pública não exige JWT de usuário; os registros continuam validados e gravados no servidor.

6. Faça um novo deploy da aplicação Vercel para publicar o cliente que chama a Edge Function. Essa alteração remove a dependência da chave administrativa no fluxo público de ponto; outros recursos do sistema que usam operações administrativas ainda podem depender de `SUPABASE_SERVICE_ROLE_KEY` na Vercel.

---

## 🔒 Segurança, LGPD e Auditoria de Segredos

- **Isolamento de Tenants:** O acesso a dados é blindado por RLS no banco de dados. Um tenant nunca consegue visualizar ou alterar registros de outra empresa.
- **Conformidade LGPD:** As fotos de ponto são utilizadas exclusivamente para conferência humana de identidade, coletadas com consentimento explícito e sujeitas a política de retenção temporal.
- **Zero Segredos no Código:** O repositório é auditado pelo script `scripts/scan-secrets.mjs`, garantindo que chaves privadas, senhas reais e CPFs verdadeiros nunca sejam comitados.

---

## 📄 Titularidade e Licença

**Já — Gestão de Equipes e Pagamentos** é uma plataforma corporativa SaaS B2B desenvolvida e operada pela **[Swali](https://www.swali.com.br/)**.  
Distribuído sob a licença [MIT](LICENSE).
