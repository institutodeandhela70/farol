-- Módulo de Eventos (Fase 4): ficha de vendas digital — substitui a ficha em
-- papel. Endereço fica como texto livre (uma linha, igual à ficha em papel
-- "Aplicação Imperium" que a inspirou), não quebrado em componentes como em
-- hubla_sales/event_participants — quebrar isso pra um preenchimento rápido
-- no celular durante o evento seria fricção sem ganho real ainda.
create table if not exists public.event_applications (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  event_id uuid not null references public.events(id) on delete cascade,
  participant_id uuid references public.event_participants(id) on delete set null,

  hubla_product_name text,

  full_name text,
  email text,
  phone text,
  cpf text,
  rg text,
  birth_date date,
  address text,

  second_full_name text,
  second_cpf text,
  second_rg text,
  second_phone text,
  second_birth_date date,
  second_address text,

  -- bloco de negociação (Fase 5 preenche/edita; nasce vazio na Fase 4)
  payment_method text,
  decision text check (decision in ('sim', 'ainda_nao')),
  decision_pending_reason text,
  negotiation_notes text,
  authorized_by text,
  signed boolean not null default false,
  seller_user_id uuid references auth.users(id) on delete set null,

  status text not null default 'preenchida' check (status in ('preenchida', 'em_negociacao', 'finalizada')),

  hubspot_deal_id text,
  hubspot_sync_status text not null default 'nao_enviado' check (hubspot_sync_status in ('nao_enviado', 'enviado', 'erro')),
  hubspot_sync_error text,
  hubspot_synced_at timestamptz,

  -- stub pra Fase 7 (VSIX) — campo já existe, disparo real fica pra depois.
  whatsapp_status text not null default 'nao_enviado' check (whatsapp_status in ('nao_enviado', 'enviado', 'erro')),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists event_applications_event_idx on public.event_applications (event_id);
create index if not exists event_applications_workspace_idx on public.event_applications (workspace_id);
create index if not exists event_applications_participant_idx on public.event_applications (participant_id);

alter table public.event_applications enable row level security;

drop policy if exists "event_applications_select_member" on public.event_applications;
create policy "event_applications_select_member"
  on public.event_applications for select
  using (public.is_workspace_member(workspace_id));

drop policy if exists "event_applications_insert_member" on public.event_applications;
create policy "event_applications_insert_member"
  on public.event_applications for insert
  with check (public.is_workspace_member(workspace_id));

drop policy if exists "event_applications_update_member" on public.event_applications;
create policy "event_applications_update_member"
  on public.event_applications for update
  using (public.is_workspace_member(workspace_id));

drop policy if exists "event_applications_delete_member" on public.event_applications;
create policy "event_applications_delete_member"
  on public.event_applications for delete
  using (public.is_workspace_member(workspace_id));


-- 'ficha' é uma origem nova de participante: nasce automaticamente quando
-- alguém preenche a ficha de vendas (trigger abaixo), sem passar pelas outras
-- origens já existentes.
alter table public.event_participants drop constraint if exists event_participants_origin_check;
alter table public.event_participants
  add constraint event_participants_origin_check
  check (origin in ('hubla', 'excel', 'manual', 'signup_form', 'ficha'));


-- Ao gravar uma ficha, acha (por e-mail/CPF, dentro do mesmo evento) ou cria
-- o participante correspondente — é assim que a ficha "cai na tela de
-- participantes também", conforme pedido. Sempre nasce 'aprovado': quem
-- preencheu a ficha já está numa negociação de verdade, diferente do
-- cadastro de cortesia (Fase 3) que nasce 'pendente'.
create or replace function public.link_or_create_participant_for_application()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_participant_id uuid;
begin
  if new.participant_id is not null then
    return new;
  end if;

  select id into v_participant_id
  from public.event_participants
  where event_id = new.event_id
    and (
      (new.email is not null and email = new.email)
      or (new.cpf is not null and cpf = new.cpf)
    )
  order by updated_at desc
  limit 1;

  if v_participant_id is null then
    insert into public.event_participants (
      workspace_id, event_id, full_name, email, phone, cpf, rg, origin, approval_status
    ) values (
      new.workspace_id, new.event_id, new.full_name, new.email, new.phone, new.cpf, new.rg, 'ficha', 'aprovado'
    )
    returning id into v_participant_id;
  end if;

  new.participant_id := v_participant_id;
  return new;
end;
$$;

drop trigger if exists event_applications_link_participant on public.event_applications;
create trigger event_applications_link_participant
  before insert on public.event_applications
  for each row execute function public.link_or_create_participant_for_application();


-- Lookup público do evento pelo slug da ficha de vendas — já devolve os
-- produtos vendáveis (event_products role='venda_evento') numa tacada só.
create or replace function public.get_public_event_by_sales_slug(p_slug text)
returns table (id uuid, workspace_id uuid, name text, products text[])
language sql
stable
security definer
set search_path = public
as $$
  select
    e.id,
    e.workspace_id,
    e.name,
    coalesce(
      (select array_agg(ep.hubla_product_name order by ep.hubla_product_name)
       from public.event_products ep
       where ep.event_id = e.id and ep.role = 'venda_evento'),
      array[]::text[]
    )
  from public.events e
  where e.sales_form_slug = p_slug and e.status = 'ativo';
$$;

-- Busca global (todos os eventos do workspace) por e-mail/CPF, na ordem
-- combinada com Raffa: primeiro nossos próprios dados (event_participants,
-- mais completos), depois Hubla (tem endereço), depois HubSpot (só
-- nome/telefone). Para na primeira fonte que achar.
create or replace function public.lookup_public_participant(p_event_id uuid, p_email text, p_cpf text)
returns table (full_name text, email text, phone text, cpf text, rg text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_workspace_id uuid;
begin
  select workspace_id into v_workspace_id from public.events where id = p_event_id;
  if v_workspace_id is null or (p_email is null and p_cpf is null) then
    return;
  end if;

  return query
    select ep.full_name, ep.email, ep.phone, ep.cpf, ep.rg
    from public.event_participants ep
    where ep.workspace_id = v_workspace_id
      and ((p_email is not null and ep.email = p_email) or (p_cpf is not null and ep.cpf = p_cpf))
    order by ep.updated_at desc
    limit 1;
  if found then return; end if;

  return query
    select hs.customer_name, hs.customer_email, hs.customer_phone, hs.customer_document, null::text
    from public.hubla_sales hs
    where hs.workspace_id = v_workspace_id
      and ((p_email is not null and hs.customer_email = p_email) or (p_cpf is not null and hs.customer_document = p_cpf))
    order by hs.paid_at desc nulls last
    limit 1;
  if found then return; end if;

  return query
    select trim(coalesce(hc.firstname, '') || ' ' || coalesce(hc.lastname, '')), hc.email, hc.phone, null::text, null::text
    from public.hubspot_contacts hc
    where hc.workspace_id = v_workspace_id
      and p_email is not null and hc.email = p_email
    limit 1;
end;
$$;

-- Helpers usados pela policy de insert anônimo abaixo — rodam como security
-- definer pelo mesmo motivo de public.event_accepts_public_signup (a policy
-- roda com o privilégio de quem insere, que não enxerga events/event_products).
create or replace function public.event_accepts_public_ficha(p_event_id uuid, p_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.events e
    where e.id = p_event_id
      and e.workspace_id = p_workspace_id
      and e.status = 'ativo'
      and e.sales_form_slug is not null
  );
$$;

create or replace function public.event_sells_product(p_event_id uuid, p_product_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_product_name is null or exists (
    select 1 from public.event_products
    where event_id = p_event_id and role = 'venda_evento' and hubla_product_name = p_product_name
  );
$$;

-- Insert anônimo: só a forma exata de uma ficha recém-preenchida (nada do
-- bloco de negociação, que é privativo do vendedor/Fase 5), pra um evento
-- ativo com ficha habilitada, com produto realmente vendido nesse evento.
drop policy if exists "event_applications_insert_anon_ficha" on public.event_applications;
create policy "event_applications_insert_anon_ficha"
  on public.event_applications for insert
  to anon
  with check (
    status = 'preenchida'
    and participant_id is null
    and payment_method is null
    and decision is null
    and negotiation_notes is null
    and authorized_by is null
    and signed = false
    and seller_user_id is null
    and hubspot_deal_id is null
    and hubspot_sync_status = 'nao_enviado'
    and public.event_accepts_public_ficha(event_id, workspace_id)
    and public.event_sells_product(event_id, hubla_product_name)
  );
