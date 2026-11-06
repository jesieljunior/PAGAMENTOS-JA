import { createCipheriv, randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const url = process.env["SUPABASE_URL"];
const serviceRoleKey = process.env["SUPABASE_SERVICE_ROLE_KEY"];
const encryptionKeyBase64 = process.env["MERCADO_PAGO_CREDENTIALS_ENCRYPTION_KEY"];
const aplicar = process.argv.includes("--apply");

if (!url || !serviceRoleKey || !encryptionKeyBase64) {
  throw new Error(
    "Configure SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY e MERCADO_PAGO_CREDENTIALS_ENCRYPTION_KEY.",
  );
}

if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encryptionKeyBase64)) {
  throw new Error("MERCADO_PAGO_CREDENTIALS_ENCRYPTION_KEY precisa estar em Base64 válido.");
}

const encryptionKey = Buffer.from(encryptionKeyBase64, "base64");
if (encryptionKey.length !== 32) {
  throw new Error("MERCADO_PAGO_CREDENTIALS_ENCRYPTION_KEY deve conter exatamente 32 bytes.");
}

function estaCriptografada(value) {
  return typeof value === "string" && value.startsWith("enc:v1:");
}

function criptografar(value) {
  if (!value || estaCriptografada(value)) return value;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey, iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `enc:v1:${iv.toString("base64")}:${tag.toString("base64")}:${encrypted.toString("base64")}`;
}

const supabase = createClient(url, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { data: contas, error } = await supabase
  .from("mercado_pago_contas")
  .select("id, access_token_cifrado, client_secret_cifrado");

if (error) throw new Error(`Falha ao consultar contas Mercado Pago: ${error.message}`);

const pendentes = (contas ?? []).filter(
  (conta) =>
    (conta.access_token_cifrado && !estaCriptografada(conta.access_token_cifrado)) ||
    (conta.client_secret_cifrado && !estaCriptografada(conta.client_secret_cifrado)),
);

console.log(`Contas encontradas: ${contas?.length ?? 0}`);
console.log(`Contas com credenciais legadas para migrar: ${pendentes.length}`);
console.log(
  aplicar
    ? "Modo APPLY: alterações serão gravadas."
    : "Modo DRY-RUN: nenhuma alteração será gravada.",
);

for (const conta of pendentes) {
  const atualizacao = {};
  if (conta.access_token_cifrado && !estaCriptografada(conta.access_token_cifrado)) {
    atualizacao.access_token_cifrado = criptografar(conta.access_token_cifrado);
  }
  if (conta.client_secret_cifrado && !estaCriptografada(conta.client_secret_cifrado)) {
    atualizacao.client_secret_cifrado = criptografar(conta.client_secret_cifrado);
  }

  if (aplicar) {
    const { error: erroUpdate } = await supabase
      .from("mercado_pago_contas")
      .update(atualizacao)
      .eq("id", conta.id);
    if (erroUpdate) {
      throw new Error(`Falha ao migrar credenciais da conta ${conta.id}: ${erroUpdate.message}`);
    }
  }

  console.log(`Conta ${conta.id}: ${aplicar ? "migrada" : "seria migrada"}.`);
}

console.log("Migração de credenciais finalizada.");
