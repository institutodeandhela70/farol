-- Regras de Vendas confirmadas com o financeiro/comercial (08/10/2026):
-- 1) Gratuito não é venda: negócio ganho com Amount 0 (ou vazio) ou com
--    "Informações para o financeiro" = Gratuito / Gratuito (Premiação) fica fora.
--    "Gratuito (Permuta)" com valor continua contando (tem valor atrelado).
-- 2) Data da venda (efetivação), só para Contratos, que têm assinatura:
--    data = a MAIOR entre o pagamento e a assinatura do contrato. Exceção D+2:
--    se o pagamento foi no mês anterior e a assinatura caiu nos dias 1 ou 2 do
--    mês seguinte, a venda fica no mês do pagamento. Sem data de assinatura,
--    vale o Close Date como antes.
-- Tudo passa pela sales_deals_v, então Vendas, Receita, Pesquisa e Detalhes
-- ficam coerentes.

create or replace function public.sales_prop_date(p text)
returns date
language sql
immutable
as $$
  select case when p ~ '^\d{4}-\d{2}-\d{2}' then left(p, 10)::date end;
$$;

create or replace function public.sales_efetivacao_dia(p_close date, p_pag date, p_ass date)
returns date
language sql
immutable
as $$
  select case
    when p_ass is null then p_close
    else (
      select case
        when p_ass > p0
          and date_trunc('month', p_ass)::date = (date_trunc('month', p0) + interval '1 month')::date
          and extract(day from p_ass) <= 2
        then p0
        else greatest(p0, p_ass)
      end
      from (select coalesce(p_pag, p_close) as p0) x
    )
  end;
$$;

create or replace view public.sales_deals_v with (security_invoker = true) as
select
  d.workspace_id,
  d.hubspot_id,
  d.dealname,
  d.amount,
  d.closedate,
  case when r.role = 'contratos' then
    public.sales_efetivacao_dia(
      (d.closedate at time zone 'America/Sao_Paulo')::date,
      coalesce(public.sales_prop_date(d.raw_properties->>'data_pagamento_entrada'), public.sales_prop_date(d.raw_properties->>'data_da_compra')),
      public.sales_prop_date(d.raw_properties->>'data_da_assinatura_do_contrato'))
  else (d.closedate at time zone 'America/Sao_Paulo')::date end as dia,
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
where d.is_closed_won and d.closedate is not null
  and coalesce(d.amount, 0) > 0
  and not (
    coalesce(d.raw_properties->>'informacoes_para_o_financeiro', '') ~* '^gratuito'
    and coalesce(d.raw_properties->>'informacoes_para_o_financeiro', '') !~* 'permuta'
  );
