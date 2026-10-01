-- Vendas · Receita · Caixa — Fase 1 (Vendas, só HubSpot).
--
-- Vendas = negócios GANHOS (closedate, fuso de São Paulo) de duas pipelines:
--   · "Pipeline de Contratos"  → high ticket: os 6 produtos (+ Combo) contam;
--     o que não é dos 6 vai pro painel "fora dos 6" e NÃO entra na soma.
--   · "Vendas Hubla & TMB"     → produtos dos 6 contam como high ticket; os
--     demais são "demais vendas".
--
-- O produto vem de propriedades do negócio: Contratos = produto_de_interesse,
-- Hubla & TMB = produtos. sales_canon_product() padroniza o nome; a tabela
-- sales_product_overrides permite corrigir um valor sem mexer em código, e
-- sales_product_catalog diz quais produtos são "dos 6" (is_high).

-- ---------------------------------------------------------------------------
-- Padronização do nome do produto
-- ---------------------------------------------------------------------------
create or replace function public.sales_canon_product(p_raw text)
returns text
language sql
immutable
as $$
  select case
    when coalesce(trim(p_raw), '') = '' then '(sem produto)'
    when p_raw ~* 'dubai' then 'Dubai'
    when p_raw ~* '^combo' then 'Combo II + IPM'
    when p_raw ~* 'palestrante irresist|\[PI\]' then 'PI'
    when p_raw ~* 'mxp|memor.vel experience' then 'MXP'
    when p_raw ~* 'dynastia|\[DM\]' then 'Dynastia'
    when p_raw ~* 'inspiratori|\[II\]|\[IO\]' then 'Inspiratori'
    when p_raw ~* 'palcos milion|\[IPM\]' then 'IPM'
    when p_raw ~* 'imperium|\[MI\]|millions|^MI\M' then 'MI'
    when p_raw ~* 'vivendo de palestra|\[VPO\]|acesso estendido' then 'VPO'
    when p_raw ~* 'do zero|\[DZP\]' then 'DZP'
    when p_raw ~* 'dp100k|desafio palestrante' then 'DP100K'
    when p_raw ~* 'palestrante lucrativo|\[IPL\]' then 'IPL'
    when p_raw ~* 'eventos milion' then 'Eventos Milionários'
    else trim(p_raw)
  end;
$$;

-- ---------------------------------------------------------------------------
-- Configuração
-- ---------------------------------------------------------------------------
create table if not exists public.sales_pipeline_roles (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  pipeline_id text not null,
  role text not null check (role in ('contratos', 'hubla_tmb')),
  primary key (workspace_id, pipeline_id)
);

create table if not exists public.sales_product_catalog (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  produto text not null,
  is_high boolean not null default false,  -- true = um dos 6 (inclui Combo)
  sort_order integer not null default 100,
  primary key (workspace_id, produto)
);

create table if not exists public.sales_product_overrides (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  source text not null check (source in ('contratos', 'hubla_tmb')),
  raw_value text not null,
  produto text not null,
  primary key (workspace_id, source, raw_value)
);

alter table public.sales_pipeline_roles enable row level security;
alter table public.sales_product_catalog enable row level security;
alter table public.sales_product_overrides enable row level security;

do $$
declare t text;
begin
  foreach t in array array['sales_pipeline_roles', 'sales_product_catalog', 'sales_product_overrides'] loop
    execute format('drop policy if exists "%1$s_select_member" on public.%1$s', t);
    execute format('create policy "%1$s_select_member" on public.%1$s for select to authenticated using (public.is_workspace_member(workspace_id))', t);
    execute format('drop policy if exists "%1$s_write_admin" on public.%1$s', t);
    execute format('create policy "%1$s_write_admin" on public.%1$s for all to authenticated using (public.is_workspace_member(workspace_id, array[''owner'', ''admin'']::public.workspace_role[])) with check (public.is_workspace_member(workspace_id, array[''owner'', ''admin'']::public.workspace_role[]))', t);
  end loop;
end $$;

-- Carga inicial por workspace (pipelines pelo nome; os 6 + Combo em is_high).
create or replace function public.sales_seed_defaults(p_workspace_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.sales_pipeline_roles (workspace_id, pipeline_id, role)
  select p_workspace_id, p.pipeline_id,
         case when p.label ilike '%contratos%' then 'contratos' else 'hubla_tmb' end
  from public.hubspot_pipelines p
  where p.workspace_id = p_workspace_id
    and (p.label ilike 'pipeline de contratos' or p.label ilike 'vendas hubla%tmb')
  on conflict do nothing;

  insert into public.sales_product_catalog (workspace_id, produto, is_high, sort_order) values
    (p_workspace_id, 'MI', true, 1),
    (p_workspace_id, 'IPM', true, 2),
    (p_workspace_id, 'Dynastia', true, 3),
    (p_workspace_id, 'Inspiratori', true, 4),
    (p_workspace_id, 'PI', true, 5),
    (p_workspace_id, 'Dubai', true, 6),
    (p_workspace_id, 'Combo II + IPM', true, 7)
  on conflict do nothing;
end;
$$;
revoke all on function public.sales_seed_defaults(uuid) from public, anon, authenticated;

select public.sales_seed_defaults(w.id) from public.workspaces w;

-- ---------------------------------------------------------------------------
-- Negócios ganhos já classificados
--   grupo: high | fora_dos_6 (Contratos, não é dos 6) | demais (Hubla & TMB, não é dos 6)
-- ---------------------------------------------------------------------------
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
  end as grupo
from public.hubspot_deals d
join public.sales_pipeline_roles r on r.workspace_id = d.workspace_id and r.pipeline_id = d.pipeline
cross join lateral (
  select case when r.role = 'contratos' then d.raw_properties->>'produto_de_interesse' else d.raw_properties->>'produtos' end as raw
) src
left join public.sales_product_overrides o on o.workspace_id = d.workspace_id and o.source = r.role and o.raw_value = src.raw
cross join lateral (select coalesce(o.produto, public.sales_canon_product(src.raw)) as produto) prod
left join public.sales_product_catalog c on c.workspace_id = d.workspace_id and c.produto = prod.produto
where d.is_closed_won and d.closedate is not null;

grant select on public.sales_deals_v to authenticated;

-- ---------------------------------------------------------------------------
-- Consultas (security invoker: valem as políticas de membro do workspace)
--   p_from / p_to: datas (dia do ganho em São Paulo), as duas entram.
--   p_owner: dono do negócio (null = todos). p_produto: lista (null = todos).
-- ---------------------------------------------------------------------------
create or replace function public.sales_summary(
  p_workspace_id uuid, p_from date, p_to date,
  p_owner text default null, p_produto text[] default null
)
returns table (grupo text, pipeline_kind text, produto text, qtd bigint, total numeric)
language sql
stable
security invoker
set search_path = public
as $$
  select v.grupo, v.pipeline_kind, v.produto, count(*), coalesce(sum(v.amount), 0)
  from public.sales_deals_v v
  where v.workspace_id = p_workspace_id
    and v.dia between p_from and p_to
    and (p_owner is null or v.owner_id = p_owner)
    and (p_produto is null or v.produto = any(p_produto))
  group by 1, 2, 3;
$$;

create or replace function public.sales_series(
  p_workspace_id uuid, p_from date, p_to date, p_grain text default 'day',
  p_owner text default null, p_produto text[] default null
)
returns table (bucket date, pipeline_kind text, grupo text, qtd bigint, total numeric)
language sql
stable
security invoker
set search_path = public
as $$
  select date_trunc(case when p_grain in ('week', 'month') then p_grain else 'day' end, v.dia::timestamp)::date,
         v.pipeline_kind, v.grupo, count(*), coalesce(sum(v.amount), 0)
  from public.sales_deals_v v
  where v.workspace_id = p_workspace_id
    and v.dia between p_from and p_to
    and (p_owner is null or v.owner_id = p_owner)
    and (p_produto is null or v.produto = any(p_produto))
  group by 1, 2, 3;
$$;

create or replace function public.sales_deals_list(
  p_workspace_id uuid, p_from date, p_to date,
  p_grupo text default null, p_owner text default null, p_produto text[] default null,
  p_limit integer default 50
)
returns table (hubspot_id text, dealname text, produto text, produto_raw text, pipeline_kind text, grupo text, dia date, owner_id text, amount numeric)
language sql
stable
security invoker
set search_path = public
as $$
  select v.hubspot_id, v.dealname, v.produto, v.produto_raw, v.pipeline_kind, v.grupo, v.dia, v.owner_id, v.amount
  from public.sales_deals_v v
  where v.workspace_id = p_workspace_id
    and v.dia between p_from and p_to
    and (p_grupo is null or v.grupo = p_grupo)
    and (p_owner is null or v.owner_id = p_owner)
    and (p_produto is null or v.produto = any(p_produto))
  order by v.amount desc nulls last, v.dia desc
  limit least(greatest(p_limit, 1), 500);
$$;

-- Opções dos filtros (produtos e donos que têm venda no período).
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

-- ---------------------------------------------------------------------------
-- Permissões do menu "Resultado" (owner/admin sempre; gerente por padrão).
-- ---------------------------------------------------------------------------
insert into public.permission_keys (key, category, label, sort_order) values
  ('menu.resultado.vendas', 'resultado', 'Resultado · Vendas', 60),
  ('menu.resultado.produtos', 'resultado', 'Resultado · Produtos (de-para)', 65)
on conflict (key) do nothing;

insert into public.role_permissions (workspace_id, role, permission_key, granted)
select w.id, 'manager'::public.workspace_role, pk.key, true
from public.workspaces w
cross join public.permission_keys pk
where pk.category = 'resultado'
on conflict (workspace_id, role, permission_key) do update set granted = excluded.granted;
