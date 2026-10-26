-- Painéis de lançamento (Marketing): DP100K e IPL Fortaleza.
-- Reproduzem, sobre os dados do FAROL (Meta + Hubla), os dois dashboards de referência
-- analisados em docs/analise-dashboards-meta-ads.md.
--
-- Cruzamento Meta × Hubla:
--   • campanha → funil/frente pelo NOME da campanha (meta_funnel_of / meta_front_of)
--   • venda → anúncio pelo utm_content da fatura (igual ao nome do anúncio, ou código [AD-NN])
--   • venda "da Meta" = utm_source = 'meta_ads'
-- Valores da Hubla: status 'Paga', total_value, dia no fuso de São Paulo.

-- ---------------------------------------------------------------------------
-- Colunas derivadas das ações da Meta (visitas na página, checkout e vídeo de 3 s)
-- ---------------------------------------------------------------------------
alter table public.meta_ad_insights_daily
  add column if not exists landing_page_views numeric generated always as (public.meta_action_sum(actions, 'landing_page_view')) stored,
  add column if not exists initiate_checkouts numeric generated always as (public.meta_action_sum(actions, 'initiate_checkout')) stored,
  add column if not exists video_views numeric generated always as (public.meta_action_sum(actions, 'video_view')) stored;

-- ---------------------------------------------------------------------------
-- Classificadores por nome
-- ---------------------------------------------------------------------------
create or replace function public.meta_funnel_of(p_name text)
returns text language sql immutable parallel safe as $$
  select case
    when p_name ~* 'nutri' then 'nutricao'
    when p_name ~* 'rmkt|remarket' then 'rmkt'
    when p_name ~* 'vsl' then 'vsl'
    when p_name ~* 'quiz' then 'quiz'
    else 'oferta_principal'
  end;
$$;

-- IPL: ANT antecipação · VDA venda direta (anúncios) · QNT captação quente · VID vídeos · EST estáticos
create or replace function public.meta_front_of(p_name text)
returns text language sql immutable parallel safe as $$
  select case
    when p_name ~* 'antecipa' then 'ANT'
    when p_name ~* 'vendas' then 'VDA'
    when p_name ~* 'quente' then 'QNT'
    when p_name ~* 'v[ií]deos?' then 'VID'
    when p_name ~* 'est[aá]tic' then 'EST'
    else 'OUT'
  end;
$$;

create or replace function public.meta_ad_code(p_name text)
returns text language sql immutable parallel safe as $$
  select upper((regexp_match(coalesce(p_name, ''), '\[(AD-[0-9]+)', 'i'))[1]);
$$;

-- ---------------------------------------------------------------------------
-- DP100K — série diária (tráfego da Meta + vendas da Hubla)
-- p_funnel null = todos os funis (inclui nutrição e IPM/outras); com funil, só tráfego e ingressos dele.
-- ---------------------------------------------------------------------------
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
  s as (
    select (h.paid_at at time zone 'America/Sao_Paulo')::date d,
           count(*) filter (where h.product_name = any(p_ticket)) ing_n,
           coalesce(sum(h.total_value) filter (where h.product_name = any(p_ticket)), 0) ing_rev,
           count(*) filter (where h.product_name = any(p_ticket) and h.utm_source = 'meta_ads') ing_meta,
           coalesce(sum(h.total_value) filter (where h.product_name = any(p_ticket) and h.utm_source = 'meta_ads'), 0) ing_meta_rev,
           count(*) filter (where p_funnel is null and h.product_name = any(p_ipm)) ipm_n,
           coalesce(sum(h.total_value) filter (where p_funnel is null and h.product_name = any(p_ipm)), 0) ipm_rev,
           count(*) filter (where p_funnel is null and h.product_name = any(p_other)) out_n,
           coalesce(sum(h.total_value) filter (where p_funnel is null and h.product_name = any(p_other)), 0) out_rev
    from public.hubla_sales h
    where h.workspace_id = p_workspace_id and h.status = 'Paga'
      and (h.paid_at at time zone 'America/Sao_Paulo')::date between p_from and p_to
      and (h.product_name = any(p_ticket) or h.product_name = any(p_ipm) or h.product_name = any(p_other))
      and (p_funnel is null or (public.meta_funnel_of(h.utm_campaign) = p_funnel and h.utm_campaign ~* p_campaign_re))
    group by 1
  )
  select coalesce(t.d, s.d), coalesce(t.spend, 0), coalesce(t.impr, 0), coalesce(t.reach, 0), coalesce(t.lclk, 0),
         coalesce(t.lpv, 0), coalesce(t.ic, 0), coalesce(s.ing_n, 0), coalesce(s.ing_rev, 0), coalesce(s.ing_meta, 0),
         coalesce(s.ing_meta_rev, 0), coalesce(s.ipm_n, 0), coalesce(s.ipm_rev, 0), coalesce(s.out_n, 0), coalesce(s.out_rev, 0)
  from t full join s on s.d = t.d
  order by 1;
end;
$$;

-- ---------------------------------------------------------------------------
-- Criativos (por nome do anúncio no DP100K; por código [AD-NN] + frente no IPL)
-- p_mode: 'dp100k' (seg = funil) | 'ipl' (seg = frente)
-- ---------------------------------------------------------------------------
create or replace function public.launch_ads(
  p_workspace_id uuid, p_from date, p_to date, p_campaign_re text, p_mode text, p_seg text default null
)
returns table (
  ad_key text, ad_name text, ad_code text, campaign_name text, seg text, is_active boolean,
  thumb text, permalink text,
  spend numeric, purch numeric, impr numeric, ic numeric, lpv numeric, lclk numeric, leads numeric,
  vimpr numeric, vviews numeric
)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.is_workspace_member(p_workspace_id) then raise exception 'forbidden'; end if;
  return query
  with base as (
    select i.*, a.name an, a.effective_status ast, a.creative_thumbnail_url th, a.creative_image_url img,
           a.instagram_permalink_url ig, c.name cn,
           case when p_mode = 'ipl' then public.meta_front_of(c.name) else public.meta_funnel_of(c.name) end sg
    from public.meta_ad_insights_daily i
    join public.meta_campaigns c on c.workspace_id = i.workspace_id and c.campaign_id = i.campaign_id
    left join public.meta_ads a on a.workspace_id = i.workspace_id and a.ad_id = i.ad_id
    where i.workspace_id = p_workspace_id and i.date between p_from and p_to and c.name ~* p_campaign_re
  )
  select
    case when p_mode = 'ipl' then coalesce(public.meta_ad_code(b.an), 'sem AD') || '|' || b.sg else lower(coalesce(b.an, b.ad_id)) end,
    (array_agg(b.an order by b.spend desc))[1],
    public.meta_ad_code((array_agg(b.an order by b.spend desc))[1]),
    (array_agg(b.cn order by b.spend desc))[1],
    b.sg,
    bool_or(b.ast = 'ACTIVE'),
    (array_agg(coalesce(b.th, b.img) order by (coalesce(b.th, b.img) is null), b.date desc))[1],
    (array_agg(b.ig order by (b.ig is null), b.date desc))[1],
    coalesce(sum(b.spend), 0), coalesce(sum(b.purchases), 0), coalesce(sum(b.impressions), 0)::numeric,
    coalesce(sum(b.initiate_checkouts), 0), coalesce(sum(b.landing_page_views), 0), coalesce(sum(b.link_clicks), 0)::numeric,
    coalesce(sum(b.leads), 0),
    coalesce(sum(b.impressions) filter (where b.video_views > 0), 0)::numeric, coalesce(sum(b.video_views), 0)
  from base b
  where (p_seg is null or b.sg = p_seg) and not (p_mode = 'dp100k' and b.sg = 'nutricao')
  group by 1, b.sg
  having coalesce(sum(b.spend), 0) > 0 or coalesce(sum(b.purchases), 0) > 0
  order by coalesce(sum(b.spend), 0) desc;
end;
$$;

-- Vendas por anúncio (utm_content), no mesmo critério de chave de launch_ads.
create or replace function public.launch_sales_by_ad(
  p_workspace_id uuid, p_from date, p_to date, p_products text[], p_mode text, p_frente text default null
)
returns table (ad_key text, n bigint, rev numeric)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.is_workspace_member(p_workspace_id) then raise exception 'forbidden'; end if;
  return query
  select case when p_mode = 'ipl' then coalesce(public.meta_ad_code(h.utm_content), 'sem AD') || '|VDA' else lower(h.utm_content) end,
         count(*), coalesce(sum(h.total_value), 0)
  from public.hubla_sales h
  where h.workspace_id = p_workspace_id and h.status = 'Paga' and h.product_name = any(p_products)
    and (h.paid_at at time zone 'America/Sao_Paulo')::date between p_from and p_to
    and (p_mode <> 'ipl' or h.utm_source = 'meta_ads')
    and h.utm_content is not null
  group by 1;
end;
$$;

-- ---------------------------------------------------------------------------
-- IPL — vendas pagas, sem dados pessoais (frente, tipo de ingresso e cadeiras já classificados)
-- ---------------------------------------------------------------------------
create or replace function public.launch_ipl_sales(p_workspace_id uuid, p_products text[], p_from date, p_to date)
returns table (
  day date, hour text, offer text, tp text, cad integer, value numeric, pay_method text, installments integer,
  fr text, src text, camp text, ad_code text
)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.is_workspace_member(p_workspace_id) then raise exception 'forbidden'; end if;
  return query
  select (h.paid_at at time zone 'America/Sao_Paulo')::date,
         to_char(h.paid_at at time zone 'America/Sao_Paulo', 'HH24:MI'),
         h.offer_name,
         case when h.offer_name ~* 'segunda' then 'Segunda cadeira avulsa'
              when h.offer_name ~* 'vip' and h.offer_name ~* 'duplo|duas|2 cadeiras' then 'VIP duplo'
              when h.offer_name ~* 'vip' then 'VIP'
              when h.offer_name ~* 'duplo|duas|2 cadeiras' then 'Duplo'
              else 'Individual' end,
         case when h.offer_name ~* 'segunda' then 1
              when h.offer_name ~* 'duplo|duas|2 cadeiras' then 2 else 1 end,
         coalesce(h.total_value, 0), h.payment_method, coalesce(h.installments, 1),
         case when h.utm_campaign ~* 'le08' then 'MET'
              when h.utm_source = 'meta_ads' then 'VDA'
              when h.utm_campaign ~* 'fp08' then 'VDD'
              else 'OUT' end,
         coalesce(h.utm_source, ''), coalesce(h.utm_campaign, ''), public.meta_ad_code(h.utm_content)
  from public.hubla_sales h
  where h.workspace_id = p_workspace_id and h.status = 'Paga' and h.product_name = any(p_products)
    and (h.paid_at at time zone 'America/Sao_Paulo')::date between p_from and p_to
  order by h.paid_at;
end;
$$;

-- IPL — situação das faturas (checkout)
create or replace function public.launch_invoice_status(p_workspace_id uuid, p_products text[])
returns table (status text, n bigint)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.is_workspace_member(p_workspace_id) then raise exception 'forbidden'; end if;
  return query select h.status, count(*) from public.hubla_sales h
  where h.workspace_id = p_workspace_id and h.product_name = any(p_products) group by h.status;
end;
$$;

-- IPL — tráfego por dia × frente × anúncio (leads do pixel = ação 'lead')
create or replace function public.launch_traffic(p_workspace_id uuid, p_from date, p_to date, p_campaign_re text)
returns table (day date, front text, ad_code text, spend numeric, impr numeric, reach numeric, clicks numeric, lpv numeric, leads numeric)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.is_workspace_member(p_workspace_id) then raise exception 'forbidden'; end if;
  return query
  select i.date, public.meta_front_of(c.name), coalesce(public.meta_ad_code(a.name), 'sem AD'),
         coalesce(sum(i.spend), 0), coalesce(sum(i.impressions), 0)::numeric, coalesce(sum(i.reach), 0)::numeric,
         coalesce(sum(i.link_clicks), 0)::numeric, coalesce(sum(i.landing_page_views), 0), coalesce(sum(i.leads), 0)
  from public.meta_ad_insights_daily i
  join public.meta_campaigns c on c.workspace_id = i.workspace_id and c.campaign_id = i.campaign_id
  left join public.meta_ads a on a.workspace_id = i.workspace_id and a.ad_id = i.ad_id
  where i.workspace_id = p_workspace_id and i.date between p_from and p_to and c.name ~* p_campaign_re
  group by 1, 2, 3
  order by 1;
end;
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'launch_daily(uuid,date,date,text,text,text[],text[],text[])',
    'launch_ads(uuid,date,date,text,text,text)',
    'launch_sales_by_ad(uuid,date,date,text[],text,text)',
    'launch_ipl_sales(uuid,text[],date,date)',
    'launch_invoice_status(uuid,text[])',
    'launch_traffic(uuid,date,date,text)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Permissões do menu (owner/admin sempre; gerente por padrão)
-- ---------------------------------------------------------------------------
insert into public.permission_keys (key, category, label, sort_order) values
  ('menu.marketing.painel-dp100k', 'marketing', 'Marketing · Painel DP100K', 76),
  ('menu.marketing.painel-ipl-fortaleza', 'marketing', 'Marketing · Painel IPL Fortaleza', 77)
on conflict (key) do nothing;

insert into public.role_permissions (workspace_id, role, permission_key, granted)
select w.id, 'manager'::public.workspace_role, k.key, true
from public.workspaces w
cross join (values ('menu.marketing.painel-dp100k'), ('menu.marketing.painel-ipl-fortaleza')) as k(key)
on conflict (workspace_id, role, permission_key) do update set granted = excluded.granted;
