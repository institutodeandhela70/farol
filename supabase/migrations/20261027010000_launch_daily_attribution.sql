-- launch_daily: IPM e "outras vendas" do DP100K só contam quando a venda veio de uma campanha do
-- lançamento (utm_campaign casando com p_campaign_re). Sem isso, as vendas gerais do IPM (vendido por
-- vários canais) inflariam o faturamento e o ROAS do desafio.
--   ingressos  → produto em p_ticket (todos, com ou sem UTM no "Todos")
--   IPM        → produto em p_ipm + UTM da campanha
--   outras     → qualquer outro produto + UTM da campanha (ou só os listados em p_other, se informado)
create or replace function public.launch_daily(
  p_workspace_id uuid, p_from date, p_to date, p_campaign_re text, p_funnel text,
  p_ticket text[], p_ipm text[], p_other text[]
)
returns table (
  day date, spend numeric, impr numeric, reach numeric, lclk numeric, lpv numeric, ic numeric,
  ing_n bigint, ing_rev numeric, ing_meta bigint, ing_meta_rev numeric,
  ipm_n bigint, ipm_rev numeric, out_n bigint, out_rev numeric
)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.is_workspace_member(p_workspace_id) then raise exception 'forbidden'; end if;
  return query
  with t as (
    select i.date d, sum(i.spend) spend, sum(i.impressions)::numeric impr, sum(i.reach)::numeric reach,
           sum(i.link_clicks)::numeric lclk, sum(i.landing_page_views) lpv, sum(i.initiate_checkouts) ic
    from public.meta_ad_insights_daily i
    join public.meta_campaigns c on c.workspace_id = i.workspace_id and c.campaign_id = i.campaign_id
    where i.workspace_id = p_workspace_id and i.date between p_from and p_to
      and c.name ~* p_campaign_re
      and (p_funnel is null or public.meta_funnel_of(c.name) = p_funnel)
    group by i.date
  ),
  sel as (
    select (h.paid_at at time zone 'America/Sao_Paulo')::date d, h.total_value v, h.utm_source us, h.utm_campaign uc,
           case
             when h.product_name = any(p_ticket) then 'ing'
             when h.product_name = any(p_ipm) and h.utm_campaign ~* p_campaign_re then 'ipm'
             when h.product_name <> all(p_ticket) and h.product_name <> all(p_ipm) and h.utm_campaign ~* p_campaign_re
                  and (p_other is null or h.product_name = any(p_other)) then 'out'
           end kind
    from public.hubla_sales h
    where h.workspace_id = p_workspace_id and h.status = 'Paga'
      and (h.paid_at at time zone 'America/Sao_Paulo')::date between p_from and p_to
  ),
  s as (
    select sel.d,
           count(*) filter (where kind = 'ing') ing_n,
           coalesce(sum(v) filter (where kind = 'ing'), 0) ing_rev,
           count(*) filter (where kind = 'ing' and us = 'meta_ads') ing_meta,
           coalesce(sum(v) filter (where kind = 'ing' and us = 'meta_ads'), 0) ing_meta_rev,
           count(*) filter (where kind = 'ipm') ipm_n,
           coalesce(sum(v) filter (where kind = 'ipm'), 0) ipm_rev,
           count(*) filter (where kind = 'out') out_n,
           coalesce(sum(v) filter (where kind = 'out'), 0) out_rev
    from sel
    where kind is not null
      and (p_funnel is null or (kind = 'ing' and public.meta_funnel_of(uc) = p_funnel and uc ~* p_campaign_re))
    group by sel.d
  )
  select coalesce(t.d, s.d), coalesce(t.spend, 0), coalesce(t.impr, 0), coalesce(t.reach, 0), coalesce(t.lclk, 0),
         coalesce(t.lpv, 0), coalesce(t.ic, 0), coalesce(s.ing_n, 0), coalesce(s.ing_rev, 0), coalesce(s.ing_meta, 0),
         coalesce(s.ing_meta_rev, 0), coalesce(s.ipm_n, 0), coalesce(s.ipm_rev, 0), coalesce(s.out_n, 0), coalesce(s.out_rev, 0)
  from t full join s on s.d = t.d
  order by 1;
end;
$$;
