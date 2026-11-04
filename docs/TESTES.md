# Relatório de Testes Automatizados — Já | Gestão de Equipes e Pagamentos

**Data da Execução:** 04 de Novembro de 2026  
**Runner:** Vitest v5.0.5  
**Total de Arquivos de Teste:** 25 suítes  
**Total de Testes:** 129 testes (100% de aprovação)  
**Tempo de Execução:** ~8.7 segundos

---

## 1. Como Executar os Testes

```bash
# Executar todas as 25 suítes de testes unitários e de integração
npm run test

# Executar a verificação estática de tipos TypeScript
npm run typecheck

# Executar a análise estática e padronização de código
npm run lint

# Executar a varredura automatizada de segredos e conformidade com LGPD
npm run scan:secrets
```

---

## 2. Mapa Completo de Suítes e Casos de Teste

### 2.1. Segurança, Multi-Tenancy e Idempotência

1. **`src/lib/multi-tenant.test.ts` (5 testes)**
   - Isolamento estrito de eventos: Organização A nunca enxerga dados da Organização B.
   - Isolamento de pagamentos: Organização B não lista transações da Organização A.
   - Proteção contra IDOR: consulta forjando UUID de outro tenant resulta em vazio.
   - Fail-closed de suporte: consultas de suporte falham sem chamado ativo.
   - Leitura de suporte: acesso estrito condicionado à sessão com trilha de auditoria.

2. **`src/lib/webhook-idempotencia.test.ts` (7 testes)**
   - Geração de chave idêntica para eventos duplicados Asaas.
   - Preservação de chave sob variações menores de payload.
   - Geração de chaves distintas para eventos ou cobranças diferentes.
   - Simulação de idempotência impedindo duplo crédito de saldo da agência.
   - Rejeição de webhooks com token ausente ou inválido (401 Unauthorized).
   - Tratamento de eventos fora de ordem sem corromper status terminal.
   - Política de recuperação e retomada segura para eventos falhos ou timed-out com teto de tentativas.

3. **`src/lib/autorizacao.test.ts` (10 testes)**
   - Validação da matriz RBAC para perfis `admin`, `coordenador`, `supervisor` e `financeiro`.
   - Bloqueio de elevação de privilégios.
   - Capacidades granulares: `eventos.gerenciar`, `financeiro.gerenciar`, `relatorios.ver`.

4. **`src/routes/_authenticated/plataforma-admin-suporte.test.ts` (4 testes)**
   - Verificação de autorização restrita do portal `/plataforma/admin` para `ADMIN_MASTER`.
   - Bloqueio de suporte em rotas administrativas globais e financeiras.

5. **`src/routes/api/routes.test.ts` (3 testes)**
   - Validação dos cabeçalhos de segurança em webhooks públicos.
   - Cálculo de expiração de selfies conforme política de retenção (LGPD).
   - Filtro de pagamentos agendados prontos para execução em lote.

---

### 2.2. Antifraude, Ponto Eletrônico e Evidência Humana

6. **`src/routes/ponto.$token.test.ts` (9 testes)**
   - Validação de expiração de token do evento (tolerância máxima 12 horas).
   - Cálculo Haversine de distância GPS contra as coordenadas do evento.
   - Máquina de estados ordenada do ponto: `Entrada` ➔ `Início de Intervalo` ➔ `Fim de Intervalo` ➔ `Saída`.
   - Rejeição de batidas fora de ordem e duplicadas.
   - Tokens assinados criptograficamente sem depender de RLS anônimo.
   - Detecção de adulteração em assinaturas de QR Code.
   - Validação de coordenadas geográficas e tolerância de raio.
   - Enforço de selfie com consentimento para conferência humana (não prova biométrica).
   - Sanitização de CPF e proteção contra consultas forjadas.

7. **`src/lib/detector-piscada.test.ts` (11 testes)**
   - Validação de detecção de olhos abertos/fechados via landmarks MediaPipe.
   - Tolerância a iluminação variável e rotação facial para conferência de presença em campo.

8. **`src/lib/consent-store.test.ts` (4 testes)**
   - Armazenamento auditado de aceite de termos de privacidade e uso de imagem.
   - Registro de timestamp e IP de consentimento em conformidade com LGPD.

---

### 2.3. Financeiro, Tesouraria, Gateways e Fechamento

9. **`src/lib/tesouraria.test.ts` (3 testes)**
   - Segregação contábil entre saldo real bancário, funding de clientes e receita de agência.
   - Consolidação de extrato financeiro.
   - Fórmulas de conciliação por período.

10. **`src/routes/_authenticated/saldo.test.ts` (3 testes)**
    - Cálculo de saldo disponível por empresa.
    - Histórico de movimentações a crédito e a débito.
    - Deduplicação de lançamentos.

11. **`src/lib/fechamento.test.ts` (4 testes)**
    - Apuração de horas trabalhadas e diárias de equipe.
    - Cálculo de horas extras e adicionais noturnos.
    - Consolidação de valores líquidos a pagar.

12. **`src/routes/_authenticated/financeiro-fechamento.test.ts` (6 testes)**
    - Fechamento em lote por evento.
    - Validação de chaves Pix para repasse.
    - Bloqueio de fechamentos com pendências de marcação.

13. **`src/lib/mercadopago.server.test.ts` (6 testes)**
    - Integração de cobranças de planos via checkout transparente.
    - Mapeamento de status e idempotência de pagamentos.

---

### 2.4. Gestão de Pessoas, Cadastros e CLT

14. **`src/routes/_authenticated/cadastros.test.ts` (5 testes)**
    - Validação de CPF e chave Pix para contratação de freelancers.
    - Validação de CNPJ e dados cadastrais de agências e contratantes.
    - Sanitização de inputs contra injeção de caracteres especiais.

15. **`src/lib/folha-clt.test.ts` (2 testes)**
    - Regras de cálculo para vínculo CLT (horas normais, DSR e descontos).
    - Diferenciação estrita de rotinas fiscais entre freelancer e CLT.

---

### 2.5. Operação de Eventos, Navegação e Planos SaaS

16. **`src/routes/_authenticated/eventos.test.ts` (7 testes)**
    - Criação de eventos com datas, horários e coordenadas geográficas.
    - Alocação de colaboradores em equipes e escalas.
    - Validação de conflitos de horário e capacidade.

17. **`src/routes/_authenticated/operacao.test.ts` (3 testes)**
    - Monitoramento ao vivo de presença e conferência de equipe em campo.
    - Aprovação de marcações de ponto pelo supervisor.

18. **`src/lib/cobranca-v2.test.ts` (6 testes)**
    - Modelo de faturamento V2 por participações deduplicadas.
    - Limites de eventos ativos e travas de plano SaaS.
    - Precificação imutável congelada no início de cada ciclo.

19. **`src/routes/_authenticated/configuracoes-plano.test.ts` (3 testes)**
    - Visualização de planos contratados e limites operacionais.
    - Alertas de consumo de cota de eventos e colaboradores.

20. **`src/routes/_authenticated/painel-onboarding.test.ts` (5 testes)**
    - Fluxo de onboarding da agência com preenchimento de dados cadastrais.
    - Normalização de CNPJ e ativação de tenant.

21. **`src/routes/_authenticated/fiscal-relatorios.test.ts` (3 testes)**
    - Sanitização e geração de arquivos CSV para exportação fiscal.
    - Proteção contra CSV Injection em planilhas.

22. **`src/lib/auth-navigation.test.ts` (13 testes)**
    - Resolução de rotas acessíveis por papel de usuário na barra lateral.
    - Ocultação de menus restritos para perfis operacionais.
    - Controle de visualização de links conforme privilégios de tenant.

23. **`src/lib/moeda.test.ts` (2 testes)**
    - Formatação consistente de moeda em Real (BRL / R$).
    - Tratamento de arredondamento e centavos em operações financeiras.

24. **`src/components/app-shell.test.tsx` (2 testes)**
    - Renderização do shell autenticado, cabeçalho e sidebar.
    - Exibição de contexto de usuário logado e empresa ativa.

25. **`src/components/shadcn-showcase.test.tsx` (3 testes)**
    - Integridade visual de botões, cards, badges e alertas do design system.
