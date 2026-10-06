-- Vendas/Receita: para os produtos dos 6, a VENDA e a DATA DO GANHO são as da pipeline
-- de Contratos. O negócio da Hubla & TMB é criado a cada PAGAMENTO (closedate = momento
-- em que o webhook da Hubla chegou), então é pagamento/parcela, não venda.
--
-- sales_product_catalog.count_hubla: o produto dos 6 conta também a partir da Hubla & TMB.
-- Começa desligado; ligado só para os produtos que não têm nenhum ganho em Contratos
-- (Dubai e Combo), que senão sumiriam das Vendas. Editável na tela Produtos.

alter table public.sales_product_catalog
  add column if not exists count_hubla boolean not null default false;

update public.sales_product_catalog c
set count_hubla = true
where c.is_high
  and not exists (
    select 1 from public.hubspot_deals d
    join public.sales_pipeline_roles r on r.workspace_id = d.workspace_id and r.pipeline_id = d.pipeline and r.role = 'contratos'
    where d.workspace_id = c.workspace_id and d.is_closed_won
      and public.sales_canon_product(d.produto_contratos) = c.produto
  );

-- A view de negócios expõe a flag (coluna nova no fim)
create or replace view public.sales_deals_v with (security_invoker = true) as
select
  d.workspace_id, d.hubspot_id, d.dealname, d.amount, d.closedate,
  (d.closedate at time zone 'America/Sao_Paulo')::date as dia,
  r.role as pipeline_kind, d.owner_id,
  src.raw as produto_raw, prod.produto,
  coalesce(c.is_high, false) as is_high,
  case
    when coalesce(c.is_high, false) then 'high'
    when r.role = 'contratos' then 'fora_dos_6'
    else 'demais'
  end as grupo,
  d.dealname_norm as cliente_norm,
  d.dealname_parts as cliente_parts,
  coalesce(c.count_hubla, false) as count_hubla
from public.hubspot_deals d
join public.sales_pipeline_roles r on r.workspace_id = d.workspace_id and r.pipeline_id = d.pipeline
cross join lateral (
  select case when r.role = 'contratos' then d.produto_contratos else d.produto_hubla end as raw
) src
left join public.sales_product_overrides o on o.workspace_id = d.workspace_id and o.source = r.role and o.raw_value = src.raw
cross join lateral (select coalesce(o.produto, public.sales_canon_product(src.raw)) as produto) prod
left join public.sales_product_catalog c on c.workspace_id = d.workspace_id and c.produto = prod.produto
where d.is_closed_won and d.closedate is not null;

-- "duplicado" passa a significar "fora das Vendas": pagamento da Hubla & TMB de produto dos 6
-- (a venda é a de Contratos). Os produtos com count_hubla seguem a regra de dedupe de antes.
drop view if exists public.sales_deals_x_v;
create view public.sales_deals_x_v with (security_invoker = true) as
with contratos as materialized (
  select workspace_id, produto, cliente_norm, dia
  from public.sales_deals_v
  where pipeline_kind = 'contratos' and is_high and cliente_norm <> ''
)
select
  v.*,
  (
    v.pipeline_kind = 'hubla_tmb' and v.is_high
    and (
      not v.count_hubla
      or (
        v.cliente_norm <> '' and coalesce(s.dedupe_enabled, true)
        and exists (
          select 1 from contratos k
          where k.workspace_id = v.workspace_id
            and k.produto = v.produto
            and abs(k.dia - v.dia) <= coalesce(s.dedupe_days, 90)
            and (k.cliente_norm = v.cliente_norm or (length(v.cliente_norm) >= 10 and position(v.cliente_norm in k.cliente_norm) > 0))
        )
      )
    )
  ) as duplicado
from public.sales_deals_v v
left join public.sales_settings s on s.workspace_id = v.workspace_id;
grant select on public.sales_deals_x_v to authenticated;

-- Vínculo entrada da IULI ↔ negócio: para produto dos 6, só negócio de Contratos
-- (a data do ganho é a da venda); para os demais, vale também o da Hubla & TMB.
create or replace function public.receita_refresh_links(p_workspace_id uuid, p_since date default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  with r as (
    select v.integration_id, v.iuli_id, v.workspace_id, v.produto,
           coalesce(v.pagamento, v.due_date) as ref_dia, v.cliente,
           (coalesce(c.is_high, false) and not coalesce(c.count_hubla, false)) as so_contratos
    from public.caixa_lancamentos_v v
    left join public.sales_product_catalog c on c.workspace_id = v.workspace_id and c.produto = v.produto
    where v.workspace_id = p_workspace_id
      and v.tratamento = 'soma'
      and coalesce(v.pagamento, v.due_date) is not null
      and (p_since is null or coalesce(v.pagamento, v.due_date) >= p_since)
  ),
  m as (
    select r.integration_id, r.iuli_id, r.workspace_id, l.hubspot_id, l.dia, l.pipeline_kind, l.dealname
    from r
    left join lateral (
      select d.hubspot_id, d.dia, d.pipeline_kind, d.dealname
      from public.sales_deals_v d
      where d.workspace_id = r.workspace_id
        and d.produto = r.produto
        and d.cliente_parts @> array[public.receita_client_norm(r.cliente)]
        and (not r.so_contratos or d.pipeline_kind = 'contratos')
      order by (d.dia <= r.ref_dia + 45) desc, abs(r.ref_dia - d.dia)
      limit 1
    ) l on true
  )
  insert into public.receita_links (integration_id, iuli_id, workspace_id, hubspot_id, dia_ganho, pipeline_kind, dealname, linked_at)
  select integration_id, iuli_id, workspace_id, hubspot_id, dia, pipeline_kind, dealname, now() from m
  on conflict (integration_id, iuli_id) do update
    set hubspot_id = excluded.hubspot_id, dia_ganho = excluded.dia_ganho, pipeline_kind = excluded.pipeline_kind,
        dealname = excluded.dealname, linked_at = excluded.linked_at
    where not public.receita_links.manual;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke all on function public.receita_refresh_links(uuid, date) from public, anon, authenticated;
