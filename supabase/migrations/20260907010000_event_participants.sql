-- Módulo de Eventos (Fase 2): participantes de um evento, vindos de qualquer
-- origem (Hubla, planilha, cadastro manual, ou — na Fase 3 — o formulário
-- público de cortesia). Full CRUD por membro do workspace, mesmo padrão de
-- events/event_products em 20260907000000.
create table if not exists public.event_participants (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  event_id uuid not null references public.events(id) on delete cascade,

  full_name text,
  email text,
  phone text,
  cpf text,
  rg text,

  address_country text,
  address_state text,
  address_city text,
  address_neighborhood text,
  address_street text,
  address_number text,
  address_complement text,
  address_zip text,

  -- origin_ref: id da hubla_sales (texto) quando origin='hubla', identificador
  -- da linha da planilha quando origin='excel', null pra manual/signup_form.
  origin text not null check (origin in ('hubla', 'excel', 'manual', 'signup_form')),
  origin_ref text,

  -- só signup_form (Fase 3) nasce 'pendente' — as demais origens já entram
  -- aprovadas porque alguém do time já decidiu trazer esse dado pro sistema.
  approval_status text not null default 'aprovado' check (approval_status in ('aprovado', 'pendente', 'rejeitado')),

  hubspot_contact_id text,
  hubspot_deal_id text,
  hubspot_sync_status text not null default 'nao_enviado' check (hubspot_sync_status in ('nao_enviado', 'enviado', 'erro')),
  hubspot_sync_error text,
  hubspot_synced_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Idempotência da ingestão automática (Hubla/Excel): reprocessar a mesma
  -- fonte não duplica linha. NULLs (origin='manual'/'signup_form') não
  -- colidem entre si — cada inserção manual é sua própria linha.
  unique (event_id, origin, origin_ref)
);

create index if not exists event_participants_event_idx on public.event_participants (event_id);
create index if not exists event_participants_workspace_idx on public.event_participants (workspace_id);
create index if not exists event_participants_approval_idx on public.event_participants (event_id, approval_status);

alter table public.event_participants enable row level security;

drop policy if exists "event_participants_select_member" on public.event_participants;
create policy "event_participants_select_member"
  on public.event_participants for select
  using (public.is_workspace_member(workspace_id));

drop policy if exists "event_participants_insert_member" on public.event_participants;
create policy "event_participants_insert_member"
  on public.event_participants for insert
  with check (public.is_workspace_member(workspace_id));

drop policy if exists "event_participants_update_member" on public.event_participants;
create policy "event_participants_update_member"
  on public.event_participants for update
  using (public.is_workspace_member(workspace_id));

drop policy if exists "event_participants_delete_member" on public.event_participants;
create policy "event_participants_delete_member"
  on public.event_participants for delete
  using (public.is_workspace_member(workspace_id));


-- Ingestão a partir da Hubla: lê hubla_sales já filtrado pelos produtos
-- role='ingresso' do evento (ver 20260907000002 sobre por que o filtro é por
-- product_name, nunca product_id) e faz upsert idempotente. Só conta venda
-- com status 'Paga' — não traz pendente/reembolsada como participante.
create or replace function public.sync_event_participants_from_hubla(p_event_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_workspace_id uuid;
  v_count integer;
begin
  select workspace_id into v_workspace_id from public.events where id = p_event_id;

  if v_workspace_id is null then
    raise exception 'event not found';
  end if;
  if not public.is_workspace_member(v_workspace_id) then
    raise exception 'not authorized';
  end if;

  with ticket_products as (
    select hubla_product_name
    from public.event_products
    where event_id = p_event_id and role = 'ingresso'
  ),
  upserted as (
    insert into public.event_participants (
      event_id, workspace_id, full_name, email, phone, cpf,
      address_country, address_state, address_city, address_neighborhood,
      address_street, address_number, address_complement, address_zip,
      origin, origin_ref
    )
    select
      p_event_id, v_workspace_id, hs.customer_name, hs.customer_email, hs.customer_phone, hs.customer_document,
      hs.address_country, hs.address_state, hs.address_city, hs.address_neighborhood,
      hs.address_street, hs.address_number, hs.address_complement, hs.address_zip,
      'hubla', hs.id::text
    from public.hubla_sales hs
    where hs.workspace_id = v_workspace_id
      and hs.status = 'Paga'
      and hs.product_name in (select hubla_product_name from ticket_products)
    on conflict (event_id, origin, origin_ref) do update set
      full_name = excluded.full_name,
      email = excluded.email,
      phone = excluded.phone,
      cpf = excluded.cpf,
      address_country = excluded.address_country,
      address_state = excluded.address_state,
      address_city = excluded.address_city,
      address_neighborhood = excluded.address_neighborhood,
      address_street = excluded.address_street,
      address_number = excluded.address_number,
      address_complement = excluded.address_complement,
      address_zip = excluded.address_zip,
      updated_at = now()
    returning 1
  )
  select count(*) into v_count from upserted;

  return v_count;
end;
$$;
