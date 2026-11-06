# Segurança das credenciais do Mercado Pago

## O que mudou

A aplicação passou a armazenar o Access Token e o Client Secret usando AES-256-GCM no backend. O valor salvo no banco tem o formato versionado `enc:v1:` e inclui IV e tag de autenticação. A chave de criptografia não fica no banco nem no repositório.

Novas credenciais são criptografadas ao salvar. Credenciais antigas em texto puro precisam passar pela migração descrita abaixo.

## 1. Gerar a chave de criptografia

Gere uma chave de 32 bytes codificada em Base64:

```bash
openssl rand -base64 32
```

Guarde o resultado em um gerenciador de senhas. Não envie essa chave por chat, não a coloque no Git e não a reutilize em outros sistemas.

Configure a variável de ambiente:

```text
MERCADO_PAGO_CREDENTIALS_ENCRYPTION_KEY
```

- Desenvolvimento local: arquivo `.env.local` (não versionado).
- Vercel: Project Settings → Environment Variables. Configure nos ambientes em que a integração será executada.

A mesma chave deve estar disponível em todas as instâncias que precisem descriptografar as credenciais. Perder ou substituir a chave sem recriptografar os dados torna os valores existentes irrecuperáveis.

## 2. Aplicar a migration do banco

A migration `20261106130000_financial_integrity_hardening.sql` cria a coluna `client_secret_cifrado`.

Ela também verifica duplicidade histórica de créditos por cobrança antes de criar o índice único. Se houver duplicidades, a migration interrompe a execução de propósito; os lançamentos precisam ser conciliados antes de tentar novamente.

Aplique primeiro em um projeto Supabase de homologação. Não aplique diretamente em produção nesta etapa.

## 3. Migrar credenciais antigas

O script `scripts/migrate-mercado-pago-credentials.mjs` tem modo de simulação por padrão. Ele exige:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `MERCADO_PAGO_CREDENTIALS_ENCRYPTION_KEY`

Execute primeiro a simulação:

```bash
npm run migrate:mercadopago-credentials
```

Confira a quantidade de contas que seriam migradas. Depois de fazer backup e confirmar o projeto Supabase selecionado, aplique:

```bash
npm run migrate:mercadopago-credentials -- --apply
```

O script não imprime Access Tokens nem Client Secrets. Ele informa apenas os IDs das contas processadas.

## 4. Verificação

Depois da migração:

1. Confirme que os campos `access_token_cifrado` e `client_secret_cifrado` começam com `enc:v1:` quando preenchidos.
2. Teste salvar novamente as credenciais por meio da aplicação.
3. Confirme que a consulta de configuração não retorna os valores dos tokens ao frontend.
4. Preserve a chave de criptografia em backup seguro.

## Cuidados

- Não execute o script com a URL de produção por engano.
- Não compartilhe a chave de criptografia ou a Service Role Key.
- Não troque a chave sem um procedimento de rotação que descriptografe os dados com a chave antiga e os criptografe com a nova.
- Se uma conta antiga não for migrada, seu valor legado continuará em texto puro no banco até a migração ser executada.
