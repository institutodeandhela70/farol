-- Detalhamento de Vendas: colunas "Pago em" e "Assinado em" (datas que a regra
-- de data da venda usa: maior entre pagamento e assinatura, com D+2).
-- Hubla & TMB não tem contrato: "Pago em" = momento do ganho, sem assinatura.

drop function if exists public.vendas_detalhe(uuid, date, date, text[], text, text, text[], boolean, boolean, text, numeric, numeric, text, text, integer, integer);

create or replace function public.vendas_detalhe(
  p_workspace_id uuid, p_from date, p_to date,
  p_grupos text[] default array['high', 'demais'],
  p_pipeline text default null,
  p_owner text default null,
  p_produto text[] default null,
  p_dedupe boolean default true,
  p_only_duplicates boolean default false,
  p_search text default null,
  p_min numeric default null,
  p_max numeric default null,
  p_sort text default 'amount',
  p_dir text default 'desc',
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  hubspot_id text, dealname text, dia date, pipeline_kind text, produto text, produto_raw text, grupo text,
  duplicado boolean, owner_id text, closer_owner_id text, amount numeric,
  data_pagamento date, data_assinatura date,
  contact_name text, contact_email text, contact_phone text, documento text,
  total_count bigint, total_sum numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_sort text := case p_sort
    when 'dia' then 'f.dia' when 'dealname' then 'f.dealname' when 'produto' then 'f.produto'
    when 'owner' then 'f.owner_id' when 'pipeline' then 'f.pipeline_kind' else 'f.amount' end;
  v_dir text := case when lower(p_dir) = 'asc' then 'asc' else 'desc' end;
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
begin
  if not public.is_workspace_member(p_workspace_id) then
    return;
  end if;
  return query execute format($q$
    with f as (
      select v.hubspot_id, v.dealname, v.dia, v.pipeline_kind, v.produto, v.produto_raw, v.grupo, v.duplicado,
             v.owner_id, v.amount, v.cliente_norm,
             c.email as c_email, c.phone as c_phone,
             nullif(btrim(concat_ws(' ', c.firstname, c.lastname)), '') as c_name
      from public.sales_deals_x_v v
      left join public.hubspot_deals d on d.workspace_id = v.workspace_id and d.hubspot_id = v.hubspot_id
      left join public.hubspot_contacts c on c.workspace_id = d.workspace_id and c.hubspot_id = d.contact_ids[1] and d.contact_ids[1] <> '-'
      where v.workspace_id = $1
        and v.dia between $2 and $3
        and (case when $8 then v.duplicado else ($7 is not true or not v.duplicado) end)
        and v.grupo = any($4)
        and ($5 is null or v.pipeline_kind = $5)
        and ($6 is null or v.owner_id = $6)
        and ($9 is null or v.produto = any($9))
        and ($10 is null or v.amount >= $10)
        and ($11 is null or v.amount <= $11)
        and ($12 is null
             or v.cliente_norm like '%%' || public.receita_client_norm($12) || '%%'
             or v.dealname ilike '%%' || $12 || '%%'
             or v.produto ilike '%%' || $12 || '%%'
             or c.email ilike '%%' || $12 || '%%'
             or c.phone ilike '%%' || $12 || '%%'
             or concat_ws(' ', c.firstname, c.lastname) ilike '%%' || $12 || '%%')
    ),
    agg as (select count(*) as n, coalesce(sum(amount), 0) as s from f),
    page as (
      select * from f order by %s %s nulls last, f.hubspot_id limit least(greatest($13, 1), 1000) offset greatest($14, 0)
    )
    select p.hubspot_id, p.dealname, p.dia, p.pipeline_kind, p.produto, p.produto_raw, p.grupo, p.duplicado,
           p.owner_id, d.closer_owner_id, p.amount,
           case when p.pipeline_kind = 'contratos'
                then coalesce(public.sales_prop_date(d.raw_properties->>'data_pagamento_entrada'), public.sales_prop_date(d.raw_properties->>'data_da_compra'))
                else (d.closedate at time zone 'America/Sao_Paulo')::date end,
           case when p.pipeline_kind = 'contratos' then public.sales_prop_date(d.raw_properties->>'data_da_assinatura_do_contrato') end,
           coalesce(p.c_name, p.dealname),
           coalesce(p.c_email, hb.customer_email, tm.customer_email),
           coalesce(p.c_phone, hb.customer_phone, tm.customer_phone),
           coalesce(nullif(d.raw_properties->>'cpf', ''), hb.customer_document, tm.customer_document),
           agg.n, agg.s
    from page p
    cross join agg
    left join public.hubspot_deals d on d.workspace_id = $1 and d.hubspot_id = p.hubspot_id
    left join lateral (
      select h.customer_email, h.customer_phone, h.customer_document
      from public.hubla_sales h
      where p.pipeline_kind = 'hubla_tmb' and h.workspace_id = $1
        and public.receita_client_norm(h.customer_name) = p.cliente_norm
        and abs(coalesce(h.paid_at, h.created_at_hubla)::date - p.dia) <= 3
      order by abs(coalesce(h.paid_at, h.created_at_hubla)::date - p.dia)
      limit 1
    ) hb on true
    left join lateral (
      select t.customer_email, t.customer_phone, t.customer_document
      from public.tmb_sales t
      where p.pipeline_kind = 'hubla_tmb' and t.workspace_id = $1
        and public.receita_client_norm(t.customer_name) = p.cliente_norm
        and abs(coalesce(t.data_efetivado, t.criado_em)::date - p.dia) <= 3
      order by abs(coalesce(t.data_efetivado, t.criado_em)::date - p.dia)
      limit 1
    ) tm on true
    order by %s %s nulls last, p.hubspot_id
  $q$, v_sort, v_dir, replace(v_sort, 'f.', 'p.'), v_dir)
  using p_workspace_id, p_from, p_to, p_grupos, p_pipeline, p_owner, p_dedupe, p_only_duplicates,
        p_produto, p_min, p_max, v_search, p_limit, p_offset;
end;
$$;

