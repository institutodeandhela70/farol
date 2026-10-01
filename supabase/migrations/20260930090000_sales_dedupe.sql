-- Vendas — dedupe Hubla & TMB × Contratos.
--
-- O mesmo cliente/produto dos 6 aparece nas duas pipelines (o contrato fechado
-- em Contratos e o pagamento pela Hubla/TMB). Um negócio da Hubla & TMB de
-- produto dos 6 só sai da soma se existe um negócio GANHO de Contratos do mesmo
-- cliente (nome normalizado) e do mesmo produto, com ganho até dedupe_days de
-- diferença. Sem correspondência em Contratos, o negócio conta.

create table if not exists public.sales_settings (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  dedupe_enabled boolean not null default true,
  dedupe_days integer not null default 90 check (dedupe_days between 0 and 730)
);
alter table public.sales_settings enable row level security;
drop policy if exists "sales_settings_select_member" on public.sales_settings;
create policy "sales_settings_select_member" on public.sales_settings for select to authenticated
  using (public.is_workspace_member(workspace_id));
drop policy if exists "sales_settings_write_admin" on public.sales_settings;
create policy "sales_settings_write_admin" on public.sales_settings for all to authenticated
  using (public.is_workspace_member(workspace_id, array['owner', 'admin']::public.workspace_role[]))
  with check (public.is_workspace_member(workspace_id, array['owner', 'admin']::public.workspace_role[]));
insert into public.sales_settings (workspace_id) select id from public.workspaces on conflict do nothing;

-- Nome do cliente normalizado (sem etiqueta "[X]" / "[HUBLA]" do início, sem acento).
create or replace function public.sales_client_norm(p_dealname text)
returns text
language sql
immutable
as $$
  select btrim(regexp_replace(public.iuli_norm(regexp_replace(coalesce(p_dealname, ''), '^(\s*\[[^\]]*\]\s*|\s*[^[:alnum:]\s]+\s*)+', '')), '\s+', ' ', 'g'));
$$;

create or replace view public.sales_deals_v with (security_invoker = true) as
select
  d.workspace_id,
  d.hubspot_id,
  d.dealname,
  d.amount,
  d.closedate,
  (d.closedate at time zone 'America/Sao_Paulo')::date as dia,
  r.role as pipeline_kind,
  d.owner_id,
  src.raw as produto_raw,
  prod.produto,
  coalesce(c.is_high, false) as is_high,
  case
    when coalesce(c.is_high, false) then 'high'
    when r.role = 'contratos' then 'fora_dos_6'
    else 'demais'
  end as grupo,
  public.sales_client_norm(d.dealname) as cliente_norm
from public.hubspot_deals d
join public.sales_pipeline_roles r on r.workspace_id = d.workspace_id and r.pipeline_id = d.pipeline
cross join lateral (
  select case when r.role = 'contratos' then d.raw_properties->>'produto_de_interesse' else d.raw_properties->>'produtos' end as raw
) src
left join public.sales_product_overrides o on o.workspace_id = d.workspace_id and o.source = r.role and o.raw_value = src.raw
cross join lateral (select coalesce(o.produto, public.sales_canon_product(src.raw)) as produto) prod
left join public.sales_product_catalog c on c.workspace_id = d.workspace_id and c.produto = prod.produto
where d.is_closed_won and d.closedate is not null;

-- Mesma lista + a marca de duplicado (Hubla & TMB que repete um ganho de Contratos).
create or replace view public.sales_deals_x_v with (security_invoker = true) as
select
  v.*,
  (
    v.pipeline_kind = 'hubla_tmb' and v.is_high and v.cliente_norm <> ''
    and coalesce(s.dedupe_enabled, true)
    and exists (
      select 1 from public.sales_deals_v k
      where k.workspace_id = v.workspace_id
        and k.pipeline_kind = 'contratos'
        and k.is_high
        and k.produto = v.produto
        and k.cliente_norm = v.cliente_norm
        and abs(k.dia - v.dia) <= coalesce(s.dedupe_days, 90)
    )
  ) as duplicado
from public.sales_deals_v v
left join public.sales_settings s on s.workspace_id = v.workspace_id;

grant select on public.sales_deals_x_v to authenticated;

-- Consultas passam a usar a lista sem duplicados (p_dedupe = false mostra tudo).
drop function if exists public.sales_summary(uuid, date, date, text, text[]);
create or replace function public.sales_summary(
  p_workspace_id uuid, p_from date, p_to date,
  p_owner text default null, p_produto text[] default null, p_dedupe boolean default true
)
returns table (grupo text, pipeline_kind text, produto text, qtd bigint, total numeric)
language sql
stable
security invoker
set search_path = public
as $$
  select v.grupo, v.pipeline_kind, v.produto, count(*), coalesce(sum(v.amount), 0)
  from public.sales_deals_x_v v
  where v.workspace_id = p_workspace_id
    and v.dia between p_from and p_to
    and (not p_dedupe or not v.duplicado)
    and (p_owner is null or v.owner_id = p_owner)
    and (p_produto is null or v.produto = any(p_produto))
  group by 1, 2, 3;
$$;

drop function if exists public.sales_series(uuid, date, date, text, text, text[]);
create or replace function public.sales_series(
  p_workspace_id uuid, p_from date, p_to date, p_grain text default 'day',
  p_owner text default null, p_produto text[] default null, p_dedupe boolean default true
)
returns table (bucket date, pipeline_kind text, grupo text, qtd bigint, total numeric)
language sql
stable
security invoker
set search_path = public
as $$
  select date_trunc(case when p_grain in ('week', 'month') then p_grain else 'day' end, v.dia::timestamp)::date,
         v.pipeline_kind, v.grupo, count(*), coalesce(sum(v.amount), 0)
  from public.sales_deals_x_v v
  where v.workspace_id = p_workspace_id
    and v.dia between p_from and p_to
    and (not p_dedupe or not v.duplicado)
    and (p_owner is null or v.owner_id = p_owner)
    and (p_produto is null or v.produto = any(p_produto))
  group by 1, 2, 3;
$$;

drop function if exists public.sales_deals_list(uuid, date, date, text, text, text[], integer);
create or replace function public.sales_deals_list(
  p_workspace_id uuid, p_from date, p_to date,
  p_grupo text default null, p_owner text default null, p_produto text[] default null,
  p_limit integer default 50, p_only_duplicates boolean default false
)
returns table (hubspot_id text, dealname text, produto text, produto_raw text, pipeline_kind text, grupo text, dia date, owner_id text, amount numeric, duplicado boolean)
language sql
stable
security invoker
set search_path = public
as $$
  select v.hubspot_id, v.dealname, v.produto, v.produto_raw, v.pipeline_kind, v.grupo, v.dia, v.owner_id, v.amount, v.duplicado
  from public.sales_deals_x_v v
  where v.workspace_id = p_workspace_id
    and v.dia between p_from and p_to
    and (case when p_only_duplicates then v.duplicado else not v.duplicado end)
    and (p_grupo is null or v.grupo = p_grupo)
    and (p_owner is null or v.owner_id = p_owner)
    and (p_produto is null or v.produto = any(p_produto))
  order by v.amount desc nulls last, v.dia desc
  limit least(greatest(p_limit, 1), 500);
$$;

-- Quantos negócios saíram da soma por duplicidade, por produto.
create or replace function public.sales_duplicates(p_workspace_id uuid, p_from date, p_to date)
returns table (produto text, qtd bigint, total numeric)
language sql
stable
security invoker
set search_path = public
as $$
  select v.produto, count(*), coalesce(sum(v.amount), 0)
  from public.sales_deals_x_v v
  where v.workspace_id = p_workspace_id and v.dia between p_from and p_to and v.duplicado
  group by 1 order by 3 desc;
$$;

create or replace function public.sales_options(p_workspace_id uuid, p_from date, p_to date)
returns table (kind text, value text, qtd bigint)
language sql
stable
security invoker
set search_path = public
as $$
  select 'produto', v.produto, count(*) from public.sales_deals_v v
  where v.workspace_id = p_workspace_id and v.dia between p_from and p_to group by 2
  union all
  select 'owner', coalesce(v.owner_id, '(sem proprietário)'), count(*) from public.sales_deals_v v
  where v.workspace_id = p_workspace_id and v.dia between p_from and p_to group by 2;
$$;
