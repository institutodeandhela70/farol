-- Vendas que deveriam estar na pipeline de Contratos e não foram encontradas lá.
--
-- Para os produtos dos 6, a venda é a de Contratos (negócio GANHO). Esta lista junta as duas
-- evidências de que houve venda — pagamentos na Hubla & TMB (negócios ganhos no período) e
-- títulos faturados na IULI (competência no período) — e mostra o que NÃO tem negócio ganho
-- de Contratos do mesmo cliente e produto:
--   nao_existe  não há negócio do cliente/produto em Contratos
--   nao_ganho   há negócio em Contratos, mas ainda não ganho (etapa e valor informados)
-- Casamento de nomes: igual, contido (10+ letras) ou primeiro e último nome presentes
-- (a Hubla abrevia: "Aline m m da Silveira" × "Aline Maria Menezes da Silveira").

create or replace function public.sales_last_token(p text)
returns text language sql immutable as $$ select (regexp_match(coalesce(p, ''), '(\S+)$'))[1] $$;

create or replace function public.sales_tokens_in(a text, b text)
returns boolean language sql immutable as $$
  select length(split_part(a, ' ', 1)) >= 3
     and length(coalesce(public.sales_last_token(a), '')) >= 3
     and split_part(a, ' ', 1) <> public.sales_last_token(a)
     and position(' ' || split_part(a, ' ', 1) || ' ' in ' ' || b || ' ') > 0
     and position(' ' || public.sales_last_token(a) || ' ' in ' ' || b || ' ') > 0
$$;

create or replace function public.sales_name_match(a text, b text)
returns boolean language sql immutable as $$
  select coalesce(a, '') <> '' and coalesce(b, '') <> '' and (
    a = b
    or (length(a) >= 10 and position(a in b) > 0)
    or (length(b) >= 10 and position(b in a) > 0)
    or public.sales_tokens_in(a, b)
    or public.sales_tokens_in(b, a)
  )
$$;

create or replace function public.vendas_faltantes(p_workspace_id uuid, p_from date, p_to date)
returns table (
  cliente text, produto text, contratos_situacao text, contratos_etapa text, contratos_negocio text,
  contratos_valor numeric, contratos_data date, contratos_owner_id text,
  hubla_qtd bigint, hubla_valor numeric, hubla_primeira date,
  iuli_qtd bigint, iuli_valor numeric, iuli_recebido numeric, iuli_a_receber numeric, iuli_primeira date,
  contact_email text, contact_phone text, documento text
)
language sql
stable
security definer
set search_path = public
as $$
  with ea as (
    select v.cliente_norm as nm, v.produto,
           max(regexp_replace(coalesce(v.dealname, ''), '^\s*\[[^\]]*\]\s*', '')) as nome,
           count(*) as qtd, sum(v.amount) as valor, min(v.dia) as primeira, max(v.dia) as ultima
    from public.sales_deals_v v
    where public.is_workspace_member(p_workspace_id)
      and v.workspace_id = p_workspace_id and v.pipeline_kind = 'hubla_tmb' and v.is_high
      and v.dia between p_from and p_to and v.cliente_norm <> ''
    group by 1, 2
  ),
  eb as (
    select public.receita_client_norm(v.cliente) as nm, v.produto, max(v.cliente) as nome,
           count(*) as qtd, sum(v.valor) as valor,
           coalesce(sum(v.valor) filter (where v.situacao = 'recebido'), 0) as recebido,
           coalesce(sum(v.valor) filter (where v.situacao <> 'recebido'), 0) as areceber,
           min(v.competencia) as primeira
    from public.receita_lancamentos_v v
    join public.sales_product_catalog c on c.workspace_id = v.workspace_id and c.produto = v.produto and c.is_high
    where public.is_workspace_member(p_workspace_id)
      and v.workspace_id = p_workspace_id and v.tratamento = 'soma'
      and v.competencia between p_from and p_to and coalesce(v.pipeline_kind, '') <> 'contratos'
      and public.receita_client_norm(v.cliente) <> ''
    group by 1, 2
  ),
  m as (
    select coalesce(a.nm, b.nm) as nm, coalesce(a.produto, b.produto) as produto, coalesce(a.nome, b.nome) as nome,
           a.qtd as a_qtd, a.valor as a_valor, a.primeira as a_primeira,
           b.qtd as b_qtd, b.valor as b_valor, b.recebido as b_rec, b.areceber as b_arec, b.primeira as b_primeira,
           least(a.primeira, b.primeira) as ev_min, greatest(a.ultima, b.primeira) as ev_max
    from ea a
    full join eb b on a.produto = b.produto and public.sales_name_match(a.nm, b.nm)
  ),
  cont as materialized (
    select d.dealname, d.dealname_norm, public.sales_canon_product(d.produto_contratos) as produto,
           coalesce(st.label, d.dealstage) as etapa, d.is_closed_won as ganho, d.amount,
           (d.closedate at time zone 'America/Sao_Paulo')::date as dia, d.owner_id, d.contact_ids[1] as contact_id, d.closedate
    from public.hubspot_deals d
    join public.sales_pipeline_roles pr on pr.workspace_id = d.workspace_id and pr.pipeline_id = d.pipeline and pr.role = 'contratos'
    left join public.hubspot_pipeline_stages st on st.pipeline_id = d.pipeline and st.stage_id = d.dealstage
    where public.is_workspace_member(p_workspace_id) and d.workspace_id = p_workspace_id
  ),
  r as (
    select m.*, k.dealname, k.etapa, k.ganho, k.amount, k.dia, k.owner_id, k.contact_id
    from m
    left join lateral (
      select c.dealname, c.etapa, c.ganho, c.amount, c.dia, c.owner_id, c.contact_id
      from cont c
      where c.produto = m.produto
        and public.sales_name_match(m.nm, c.dealname_norm)
        and (not c.ganho or c.dia between m.ev_min - 400 and m.ev_max + 60)
      order by c.ganho desc, c.closedate desc nulls last
      limit 1
    ) k on true
  )
  select r.nome, r.produto,
         case when r.dealname is null then 'nao_existe' else 'nao_ganho' end,
         r.etapa, r.dealname, r.amount, r.dia, r.owner_id,
         r.a_qtd, r.a_valor, r.a_primeira,
         r.b_qtd, r.b_valor, r.b_rec, r.b_arec, r.b_primeira,
         coalesce(c.email, hb.customer_email, tm.customer_email),
         coalesce(c.phone, hb.customer_phone, tm.customer_phone),
         coalesce(hb.customer_document, tm.customer_document)
  from r
  left join public.hubspot_contacts c on c.workspace_id = p_workspace_id and c.hubspot_id = r.contact_id and r.contact_id <> '-'
  left join lateral (
    select h.customer_email, h.customer_phone, h.customer_document from public.hubla_sales h
    where h.workspace_id = p_workspace_id and h.customer_norm = r.nm limit 1
  ) hb on true
  left join lateral (
    select t.customer_email, t.customer_phone, t.customer_document from public.tmb_sales t
    where t.workspace_id = p_workspace_id and t.customer_norm = r.nm limit 1
  ) tm on true
  where not coalesce(r.ganho, false)
  order by coalesce(r.a_valor, 0) + coalesce(r.b_valor, 0) desc, r.nome;
$$;

revoke all on function public.vendas_faltantes(uuid, date, date) from public, anon;
grant execute on function public.vendas_faltantes(uuid, date, date) to authenticated;
