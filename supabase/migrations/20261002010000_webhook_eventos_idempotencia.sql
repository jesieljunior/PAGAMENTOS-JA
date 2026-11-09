create table if not exists public.webhook_eventos (
  id uuid primary key default gen_random_uuid(),
  chave_idempotencia text not null unique,
  evento text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'processado' check (status in ('processado','falha')),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

revoke all on table public.webhook_eventos from public, anon, authenticated;
grant all on table public.webhook_eventos to service_role;

alter table public.webhook_eventos enable row level security;

drop policy if exists "webhook_eventos_leitura" on public.webhook_eventos;
create policy "webhook_eventos_leitura" on public.webhook_eventos
for select to authenticated
using (public.eh_equipe_plataforma());

-- Escrita reservada ao backend/service_role; não existe política de INSERT para authenticated.
drop policy if exists "webhook_eventos_insercao" on public.webhook_eventos;

drop trigger if exists tg_webhook_eventos_atualizado_em on public.webhook_eventos;
create trigger tg_webhook_eventos_atualizado_em
before update on public.webhook_eventos
for each row execute function public.tg_atualizado_em();

create index if not exists idx_webhook_eventos_status on public.webhook_eventos(status, criado_em desc);
