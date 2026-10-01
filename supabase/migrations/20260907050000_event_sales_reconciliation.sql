-- Módulo de Eventos (Fase 6): reconciliação de vendas — quanto entrou de
-- verdade na Hubla pros produtos vinculados ao evento (ingresso e/ou vendido
-- no evento), e — pros vendidos no evento — quanto o time já fechou dentro
-- do próprio sistema (event_applications finalizadas), pra comparar as duas
-- fontes lado a lado.
-- Janela de datas do evento com tolerância de 30 dias após o fim (pagamentos
-- parcelados/atrasados que fecham depois do evento) — e sem limite quando o
-- evento não tem datas configuradas ainda, pra não subestimar silenciosamente.
create or replace function public.event_sales_reconciliation(p_event_id uuid)
returns table (
  hubla_product_name text,
  role text,
  hubla_sales_count bigint,
  hubla_sales_total numeric,
  applications_finalized_count bigint,
  applications_finalized_total numeric
)
language sql
stable
security definer
set search_path = public
as $$
  select
    ep.hubla_product_name,
    ep.role,
    coalesce(hs.sales_count, 0),
    coalesce(hs.sales_total, 0),
    coalesce(app.app_count, 0),
    coalesce(app.app_total, 0)
  from public.event_products ep
  join public.events e on e.id = ep.event_id
  left join lateral (
    select count(*)::bigint as sales_count, coalesce(sum(hs.total_value), 0) as sales_total
    from public.hubla_sales hs
    where hs.workspace_id = e.workspace_id
      and hs.product_name = ep.hubla_product_name
      and hs.status = 'Paga'
      and hs.paid_at >= coalesce(e.starts_at, '-infinity'::timestamptz)
      and hs.paid_at <= coalesce(e.ends_at, e.starts_at, 'infinity'::timestamptz) + interval '30 days'
  ) hs on true
  left join lateral (
    select count(*)::bigint as app_count, coalesce(sum(ea.amount), 0) as app_total
    from public.event_applications ea
    where ea.event_id = ep.event_id
      and ea.hubla_product_name = ep.hubla_product_name
      and ea.status = 'finalizada'
  ) app on true
  where ep.event_id = p_event_id
    and public.is_workspace_member(e.workspace_id)
  order by ep.role, ep.hubla_product_name;
$$;
