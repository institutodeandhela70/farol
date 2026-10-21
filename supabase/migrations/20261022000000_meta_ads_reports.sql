-- Meta Ads — Fase 4: funções de agregação das telas (Visão Geral, Campanhas, Público)
-- e permissões do menu Marketing.
--
-- A Meta repete a mesma conversão sob vários nomes (lead = onsite_web_lead =
-- offsite_conversion.fb_pixel_lead…), então somar tudo contaria em dobro. Os
-- "resultados" usam um tipo canônico por conversão:
--   leads = 'lead' · compras = 'purchase' (valor em action_values) ·
--   conversas = 'onsite_conversion.messaging_conversation_started_7d'
-- Os demais tipos continuam em actions/action_values e aparecem na tela Público
-- ("Todas as ações").

create or replace function public.meta_action_sum(p_actions jsonb, p_type text)
returns numeric
language sql
immutable
parallel safe
as $$
  select coalesce(sum((a->>'value')::numeric), 0)
  from jsonb_array_elements(coalesce(p_actions, '[]'::jsonb)) a
  where a->>'action_type' = p_type;
$$;

alter table public.meta_ad_insights_daily
  add column if not exists leads numeric generated always as (public.meta_action_sum(actions, 'lead')) stored,
  add column if not exists purchases numeric generated always as (public.meta_action_sum(actions, 'purchase')) stored,
  add column if not exists purchase_value numeric generated always as (public.meta_action_sum(action_values, 'purchase')) stored,
  add column if not exists conversations numeric generated always as (public.meta_action_sum(actions, 'onsite_conversion.messaging_conversation_started_7d')) stored;

alter table public.meta_insights_breakdowns
  add column if not exists leads numeric generated always as (public.meta_action_sum(actions, 'lead')) stored,
  add column if not exists purchases numeric generated always as (public.meta_action_sum(actions, 'purchase')) stored,
  add column if not exists purchase_value numeric generated always as (public.meta_action_sum(action_values, 'purchase')) stored,
  add column if not exists conversations numeric generated always as (public.meta_action_sum(actions, 'onsite_conversion.messaging_conversation_started_7d')) stored;

create index if not exists meta_ad_insights_account_date_idx on public.meta_ad_insights_daily (workspace_id, account_id, date);

-- ---------------------------------------------------------------------------
-- Totais do período
-- ---------------------------------------------------------------------------
create or replace function public.meta_ads_totals(p_workspace_id uuid, p_from date, p_to date, p_accounts text[] default null)
returns table (spend numeric, impressions numeric, link_clicks numeric, leads numeric, purchases numeric, purchase_value numeric, conversations numeric, ads_count bigint)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_workspace_member(p_workspace_id) then raise exception 'forbidden'; end if;
  return query
  select coalesce(sum(i.spend), 0), coalesce(sum(i.impressions), 0)::numeric, coalesce(sum(i.link_clicks), 0)::numeric,
         coalesce(sum(i.leads), 0), coalesce(sum(i.purchases), 0), coalesce(sum(i.purchase_value), 0), coalesce(sum(i.conversations), 0),
         count(distinct i.ad_id) filter (where i.spend > 0)
  from public.meta_ad_insights_daily i
  where i.workspace_id = p_workspace_id and i.date between p_from and p_to
    and (p_accounts is null or i.account_id = any(p_accounts));
end;
$$;

-- ---------------------------------------------------------------------------
-- Série diária
-- ---------------------------------------------------------------------------
create or replace function public.meta_ads_daily(p_workspace_id uuid, p_from date, p_to date, p_accounts text[] default null)
returns table (day date, spend numeric, impressions numeric, link_clicks numeric, leads numeric, purchases numeric, purchase_value numeric, conversations numeric)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_workspace_member(p_workspace_id) then raise exception 'forbidden'; end if;
  return query
  select i.date, coalesce(sum(i.spend), 0), coalesce(sum(i.impressions), 0)::numeric, coalesce(sum(i.link_clicks), 0)::numeric,
         coalesce(sum(i.leads), 0), coalesce(sum(i.purchases), 0), coalesce(sum(i.purchase_value), 0), coalesce(sum(i.conversations), 0)
  from public.meta_ad_insights_daily i
  where i.workspace_id = p_workspace_id and i.date between p_from and p_to
    and (p_accounts is null or i.account_id = any(p_accounts))
  group by i.date
  order by i.date;
end;
$$;

-- ---------------------------------------------------------------------------
-- Ranking por campanha / conjunto / anúncio (p_parent filtra: conjunto→campanha, anúncio→conjunto)
-- ---------------------------------------------------------------------------
create or replace function public.meta_ads_ranking(
  p_workspace_id uuid, p_from date, p_to date, p_accounts text[], p_level text, p_parent text default null
)
returns table (
  item_id text, name text, status text, parent_name text, objective text, account_id text, account_name text, thumbnail text,
  spend numeric, impressions numeric, link_clicks numeric, leads numeric, purchases numeric, purchase_value numeric, conversations numeric,
  first_day date, last_day date
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_workspace_member(p_workspace_id) then raise exception 'forbidden'; end if;
  if p_level not in ('campaign', 'adset', 'ad') then raise exception 'invalid level'; end if;

  return query
  with agg as (
    select case p_level when 'campaign' then i.campaign_id when 'adset' then i.adset_id else i.ad_id end as k,
           min(i.account_id) as account_id,
           sum(i.spend) as spend, sum(i.impressions)::numeric as impressions, sum(i.link_clicks)::numeric as link_clicks,
           sum(i.leads) as leads, sum(i.purchases) as purchases, sum(i.purchase_value) as purchase_value, sum(i.conversations) as conversations,
           min(i.date) filter (where i.spend > 0) as first_day, max(i.date) filter (where i.spend > 0) as last_day
    from public.meta_ad_insights_daily i
    where i.workspace_id = p_workspace_id and i.date between p_from and p_to
      and (p_accounts is null or i.account_id = any(p_accounts))
      and (p_parent is null
           or (p_level = 'adset' and i.campaign_id = p_parent)
           or (p_level = 'ad' and i.adset_id = p_parent))
    group by 1
  )
  select a.k,
         case p_level when 'campaign' then c.name when 'adset' then s.name else d.name end,
         case p_level when 'campaign' then c.effective_status when 'adset' then s.effective_status else d.effective_status end,
         case p_level when 'campaign' then null when 'adset' then c2.name else s2.name end,
         case p_level when 'campaign' then c.objective when 'adset' then c2.objective else null end,
         a.account_id, acc.name,
         case when p_level = 'ad' then coalesce(d.creative_thumbnail_url, d.creative_image_url) else null end,
         coalesce(a.spend, 0), coalesce(a.impressions, 0), coalesce(a.link_clicks, 0), coalesce(a.leads, 0),
         coalesce(a.purchases, 0), coalesce(a.purchase_value, 0), coalesce(a.conversations, 0), a.first_day, a.last_day
  from agg a
  left join public.meta_campaigns c on p_level = 'campaign' and c.workspace_id = p_workspace_id and c.campaign_id = a.k
  left join public.meta_adsets s on p_level = 'adset' and s.workspace_id = p_workspace_id and s.adset_id = a.k
  left join public.meta_campaigns c2 on p_level = 'adset' and c2.workspace_id = p_workspace_id and c2.campaign_id = s.campaign_id
  left join public.meta_ads d on p_level = 'ad' and d.workspace_id = p_workspace_id and d.ad_id = a.k
  left join public.meta_adsets s2 on p_level = 'ad' and s2.workspace_id = p_workspace_id and s2.adset_id = d.adset_id
  left join public.meta_ad_accounts acc on acc.workspace_id = p_workspace_id and acc.account_id = a.account_id
  where a.k is not null
  order by coalesce(a.spend, 0) desc;
end;
$$;

-- ---------------------------------------------------------------------------
-- Breakdowns (placement | age_gender | region)
-- ---------------------------------------------------------------------------
create or replace function public.meta_ads_breakdown(p_workspace_id uuid, p_from date, p_to date, p_accounts text[], p_breakdown text)
returns table (key1 text, key2 text, spend numeric, impressions numeric, link_clicks numeric, leads numeric, purchases numeric, purchase_value numeric, conversations numeric)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_workspace_member(p_workspace_id) then raise exception 'forbidden'; end if;
  return query
  select b.key1, b.key2, coalesce(sum(b.spend), 0), coalesce(sum(b.impressions), 0)::numeric, coalesce(sum(b.link_clicks), 0)::numeric,
         coalesce(sum(b.leads), 0), coalesce(sum(b.purchases), 0), coalesce(sum(b.purchase_value), 0), coalesce(sum(b.conversations), 0)
  from public.meta_insights_breakdowns b
  where b.workspace_id = p_workspace_id and b.breakdown = p_breakdown and b.date between p_from and p_to
    and (p_accounts is null or b.account_id = any(p_accounts))
  group by b.key1, b.key2
  order by coalesce(sum(b.spend), 0) desc;
end;
$$;

-- ---------------------------------------------------------------------------
-- Todas as ações (por tipo), pra enxergar conversões personalizadas
-- ---------------------------------------------------------------------------
create or replace function public.meta_ads_actions(p_workspace_id uuid, p_from date, p_to date, p_accounts text[] default null)
returns table (action_type text, qty numeric, value numeric)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_workspace_member(p_workspace_id) then raise exception 'forbidden'; end if;
  return query
  with q as (
    select (a->>'action_type') as t, (a->>'value')::numeric as v, 0::numeric as mv
    from public.meta_ad_insights_daily i, jsonb_array_elements(coalesce(i.actions, '[]'::jsonb)) a
    where i.workspace_id = p_workspace_id and i.date between p_from and p_to and (p_accounts is null or i.account_id = any(p_accounts))
    union all
    select (a->>'action_type'), 0::numeric, (a->>'value')::numeric
    from public.meta_ad_insights_daily i, jsonb_array_elements(coalesce(i.action_values, '[]'::jsonb)) a
    where i.workspace_id = p_workspace_id and i.date between p_from and p_to and (p_accounts is null or i.account_id = any(p_accounts))
  )
  select q.t, sum(q.v), sum(q.mv) from q group by q.t order by sum(q.v) desc;
end;
$$;

revoke all on function public.meta_ads_totals(uuid, date, date, text[]) from public, anon;
revoke all on function public.meta_ads_daily(uuid, date, date, text[]) from public, anon;
revoke all on function public.meta_ads_ranking(uuid, date, date, text[], text, text) from public, anon;
revoke all on function public.meta_ads_breakdown(uuid, date, date, text[], text) from public, anon;
revoke all on function public.meta_ads_actions(uuid, date, date, text[]) from public, anon;
grant execute on function public.meta_ads_totals(uuid, date, date, text[]) to authenticated;
grant execute on function public.meta_ads_daily(uuid, date, date, text[]) to authenticated;
grant execute on function public.meta_ads_ranking(uuid, date, date, text[], text, text) to authenticated;
grant execute on function public.meta_ads_breakdown(uuid, date, date, text[], text) to authenticated;
grant execute on function public.meta_ads_actions(uuid, date, date, text[]) to authenticated;

-- ---------------------------------------------------------------------------
-- Permissões do menu Marketing (owner/admin sempre; gerente por padrão)
-- ---------------------------------------------------------------------------
insert into public.permission_keys (key, category, label, sort_order) values
  ('menu.marketing.meta-ads', 'marketing', 'Marketing · Meta Ads — Visão Geral', 70),
  ('menu.marketing.meta-ads-campanhas', 'marketing', 'Marketing · Meta Ads — Campanhas', 71),
  ('menu.marketing.meta-ads-publico', 'marketing', 'Marketing · Meta Ads — Público & Ações', 72)
on conflict (key) do nothing;

insert into public.role_permissions (workspace_id, role, permission_key, granted)
select w.id, 'manager'::public.workspace_role, k.key, true
from public.workspaces w
cross join (values ('menu.marketing.meta-ads'), ('menu.marketing.meta-ads-campanhas'), ('menu.marketing.meta-ads-publico')) as k(key)
on conflict (workspace_id, role, permission_key) do update set granted = excluded.granted;
