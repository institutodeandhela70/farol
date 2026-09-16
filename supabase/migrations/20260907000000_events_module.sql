-- Módulo de Eventos (Fase 1): cadastro central de eventos presenciais
-- (MXP, IPL, IPM...), cada um linkado aos produtos da Hubla que alimentam
-- seus participantes/vendas e à pipeline da HubSpot que recebe os leads.
-- Full CRUD por membro do workspace (não é tabela alimentada por webhook),
-- mesmo padrão de policy de public.workspaces em 20260824203017.
create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,

  code text not null,
  name text not null,
  status text not null default 'planejamento' check (status in ('planejamento', 'ativo', 'encerrado')),

  starts_at timestamptz,
  ends_at timestamptz,

  hubspot_pipeline_id text,

  signup_form_slug text,
  sales_form_slug text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (workspace_id, code),
  unique (signup_form_slug),
  unique (sales_form_slug)
);

create index if not exists events_workspace_status_idx on public.events (workspace_id, status);

alter table public.events enable row level security;

drop policy if exists "events_select_member" on public.events;
create policy "events_select_member"
  on public.events for select
  using (public.is_workspace_member(workspace_id));

drop policy if exists "events_insert_member" on public.events;
create policy "events_insert_member"
  on public.events for insert
  with check (public.is_workspace_member(workspace_id));

drop policy if exists "events_update_member" on public.events;
create policy "events_update_member"
  on public.events for update
  using (public.is_workspace_member(workspace_id));

drop policy if exists "events_delete_member" on public.events;
create policy "events_delete_member"
  on public.events for delete
  using (public.is_workspace_member(workspace_id));


-- event_products: liga um evento aos produtos da Hubla que o alimentam.
-- Não existe catálogo de produtos Hubla separado no sistema — product_id/
-- product_name aqui são denormalizados a partir do que já aparece em
-- hubla_sales.product_id/product_name, escolhidos na tela de cadastro do
-- evento. `role` distingue "produto que gera participante" (ingresso) de
-- "produto vendido dentro do evento" (venda_evento, ex: Mentoria Imperium
-- vendida na ficha durante o MXP) — um mesmo produto pode, em tese, ter as
-- duas linhas se um dia fizer sentido, por isso role entra na unique key.
create table if not exists public.event_products (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,

  hubla_product_id text not null,
  hubla_product_name text not null,
  role text not null check (role in ('ingresso', 'venda_evento')),

  created_at timestamptz not null default now(),

  unique (event_id, hubla_product_id, role)
);

create index if not exists event_products_event_idx on public.event_products (event_id);

alter table public.event_products enable row level security;

drop policy if exists "event_products_select_member" on public.event_products;
create policy "event_products_select_member"
  on public.event_products for select
  using (public.is_workspace_member((select workspace_id from public.events where id = event_id)));

drop policy if exists "event_products_insert_member" on public.event_products;
create policy "event_products_insert_member"
  on public.event_products for insert
  with check (public.is_workspace_member((select workspace_id from public.events where id = event_id)));

drop policy if exists "event_products_update_member" on public.event_products;
create policy "event_products_update_member"
  on public.event_products for update
  using (public.is_workspace_member((select workspace_id from public.events where id = event_id)));

drop policy if exists "event_products_delete_member" on public.event_products;
create policy "event_products_delete_member"
  on public.event_products for delete
  using (public.is_workspace_member((select workspace_id from public.events where id = event_id)));
