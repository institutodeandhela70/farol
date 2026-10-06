-- Receita passa a ser por DATA DE COMPETÊNCIA na IULI (receita faturada), tenha o dinheiro
-- sido creditado ou não: título de categoria de produto com competência no período, com
-- ou sem baixa. A venda passou no cartão e está na IULI em 30/09; o vencimento (15/10) é
-- quando o dinheiro cai na conta — isso é o Caixa. Recebido = título com baixa; a receber =
-- sem baixa.
--
-- O vínculo com o negócio do HubSpot passa a medir a proximidade pela competência (que é
-- a data da venda), e "venda do mês / outros meses" compara o mês da competência com o
-- mês do ganho do negócio.

-- Competência no Caixa também (coluna nova no fim)
create or replace view public.caixa_lancamentos_v with (security_invoker = true) as
select
  r.workspace_id, r.integration_id, r.iuli_id,
  i.label as empresa, r.empresa as cliente, r.description,
  r.due_date, r.pagamento, r.status,
  case
    when r.status = 'recebida' then 'recebido'
    when r.due_date < (now() at time zone 'America/Sao_Paulo')::date then 'vencido'
    else 'a_vencer'
  end as situacao,
  r.categoria_id, r.categoria,
  case when r.categoria_id is null then 'sem_categoria' else coalesce(m.tratamento, 'revisar') end as tratamento,
  case when m.tratamento = 'soma' then coalesce(nullif(m.produto, ''), r.categoria) end as produto,
  case when r.status = 'recebida' then coalesce(r.valor_pago, r.valor, 0) else coalesce(r.valor, 0) end as valor_caixa,
  r.competencia
from public.iuli_receivables r
join public.integrations i on i.id = r.integration_id
left join public.iuli_category_map m on m.workspace_id = r.workspace_id and m.nome_norm = public.iuli_norm(btrim(r.categoria))
where r.removed_at is null;

drop view if exists public.receita_lancamentos_v;
create view public.receita_lancamentos_v with (security_invoker = true) as
select
  v.workspace_id, v.integration_id, v.iuli_id, v.empresa, v.cliente, v.categoria, v.produto, v.tratamento,
  v.competencia, v.pagamento, v.due_date,
  case when v.situacao = 'recebido' then 'recebido' else 'a_receber' end as situacao,
  v.valor_caixa as valor,
  l.hubspot_id, l.dia_ganho, l.pipeline_kind, l.dealname,
  case
    when l.hubspot_id is null then 'sem_negocio'
    when date_trunc('month', l.dia_ganho::timestamp) = date_trunc('month', v.competencia::timestamp) then 'mes'
    else 'outros'
  end as origem
from public.caixa_lancamentos_v v
left join public.receita_links l on l.integration_id = v.integration_id and l.iuli_id = v.iuli_id
where v.competencia is not null;

-- Vínculo: proximidade pela competência (data da venda)
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
           coalesce(v.competencia, v.pagamento, v.due_date) as ref_dia, v.cliente,
           (coalesce(c.is_high, false) and not coalesce(c.count_hubla, false)) as so_contratos
    from public.caixa_lancamentos_v v
    left join public.sales_product_catalog c on c.workspace_id = v.workspace_id and c.produto = v.produto
    where v.workspace_id = p_workspace_id
      and v.tratamento = 'soma'
      and coalesce(v.competencia, v.pagamento, v.due_date) is not null
      and (p_since is null or coalesce(v.competencia, v.pagamento, v.due_date) >= p_since)
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

-- ---------------------------------------------------------------------------
-- Consultas da Receita (competência; recebido + a receber)
-- ---------------------------------------------------------------------------
drop function if exists public.receita_summary(uuid, date, date, uuid[], text[], boolean);
create function public.receita_summary(
  p_workspace_id uuid, p_from date, p_to date,
  p_integration_ids uuid[] default null, p_produto text[] default null, p_excluir_ee boolean default false
)
returns table (origem text, produto text, situacao text, qtd bigint, total numeric)
language sql stable security definer set search_path = public
as $$
  select v.origem, v.produto, v.situacao, count(*), coalesce(sum(v.valor), 0)
  from public.receita_lancamentos_v v
  where public.is_workspace_member(p_workspace_id)
    and v.workspace_id = p_workspace_id
    and v.competencia between p_from and p_to
    and v.tratamento = 'soma'
    and (p_integration_ids is null or v.integration_id = any(p_integration_ids))
    and (p_produto is null or v.produto = any(p_produto))
    and (not p_excluir_ee or not public.iuli_is_intercompany(v.workspace_id, v.cliente))
  group by 1, 2, 3;
$$;

create or replace function public.receita_series(
  p_workspace_id uuid, p_from date, p_to date, p_grain text default 'day',
  p_integration_ids uuid[] default null, p_produto text[] default null, p_excluir_ee boolean default false
)
returns table (bucket date, origem text, qtd bigint, total numeric)
language sql stable security definer set search_path = public
as $$
  select date_trunc(case when p_grain in ('week', 'month') then p_grain else 'day' end, v.competencia::timestamp)::date,
         v.origem, count(*), coalesce(sum(v.valor), 0)
  from public.receita_lancamentos_v v
  where public.is_workspace_member(p_workspace_id)
    and v.workspace_id = p_workspace_id
    and v.competencia between p_from and p_to
    and v.tratamento = 'soma'
    and (p_integration_ids is null or v.integration_id = any(p_integration_ids))
    and (p_produto is null or v.produto = any(p_produto))
    and (not p_excluir_ee or not public.iuli_is_intercompany(v.workspace_id, v.cliente))
  group by 1, 2;
$$;

-- Safra: mês da competência × mês da venda (mes_venda nulo = sem negócio vinculado).
create or replace function public.receita_safra(
  p_workspace_id uuid, p_from date, p_to date,
  p_integration_ids uuid[] default null, p_produto text[] default null, p_excluir_ee boolean default false
)
returns table (mes_entrada date, mes_venda date, qtd bigint, total numeric)
language sql stable security definer set search_path = public
as $$
  select date_trunc('month', v.competencia::timestamp)::date,
         case when v.dia_ganho is null then null else date_trunc('month', v.dia_ganho::timestamp)::date end,
         count(*), coalesce(sum(v.valor), 0)
  from public.receita_lancamentos_v v
  where public.is_workspace_member(p_workspace_id)
    and v.workspace_id = p_workspace_id
    and v.competencia between p_from and p_to
    and v.tratamento = 'soma'
    and (p_integration_ids is null or v.integration_id = any(p_integration_ids))
    and (p_produto is null or v.produto = any(p_produto))
    and (not p_excluir_ee or not public.iuli_is_intercompany(v.workspace_id, v.cliente))
  group by 1, 2;
$$;

-- Fora da soma (por competência, com ou sem baixa)
create or replace function public.receita_fora(
  p_workspace_id uuid, p_from date, p_to date,
  p_integration_ids uuid[] default null, p_excluir_ee boolean default false
)
returns table (tratamento text, categoria text, qtd bigint, total numeric)
language sql stable security definer set search_path = public
as $$
  select v.tratamento, coalesce(v.categoria, '(sem categoria)'), count(*), coalesce(sum(v.valor_caixa), 0)
  from public.caixa_lancamentos_v v
  where public.is_workspace_member(p_workspace_id)
    and v.workspace_id = p_workspace_id
    and v.competencia between p_from and p_to
    and v.tratamento <> 'soma'
    and (p_integration_ids is null or v.integration_id = any(p_integration_ids))
    and (not p_excluir_ee or not public.iuli_is_intercompany(v.workspace_id, v.cliente))
  group by 1, 2;
$$;

create or replace function public.receita_produtos(p_workspace_id uuid, p_from date, p_to date)
returns table (produto text, total numeric)
language sql stable security definer set search_path = public
as $$
  select v.produto, coalesce(sum(v.valor_caixa), 0)
  from public.caixa_lancamentos_v v
  where public.is_workspace_member(p_workspace_id)
    and v.workspace_id = p_workspace_id
    and v.competencia between p_from and p_to and v.tratamento = 'soma'
  group by 1 order by 2 desc;
$$;

-- Detalhe: por competência, com situação (recebido / a receber)
drop function if exists public.receita_detalhe(uuid, date, date, text, text, date, uuid[], text[], text, text, numeric, numeric, text, text, integer, integer);
create function public.receita_detalhe(
  p_workspace_id uuid, p_from date, p_to date,
  p_tratamento text default 'soma',
  p_origem text default null,
  p_mes_venda date default null,
  p_integration_ids uuid[] default null,
  p_produto text[] default null,
  p_categoria text default null,
  p_search text default null,
  p_min numeric default null,
  p_max numeric default null,
  p_sort text default 'valor',
  p_dir text default 'desc',
  p_limit integer default 50,
  p_offset integer default 0,
  p_situacoes text[] default null
)
returns table (
  empresa text, iuli_id bigint, cliente text, categoria text, produto text, tratamento text, situacao text,
  competencia date, pagamento date, due_date date, valor numeric, valor_previsto numeric, nf_numero text, venda_id bigint, descricao text,
  origem text, hubspot_id text, dealname text, dia_ganho date, pipeline_kind text,
  owner_id text, closer_owner_id text, contact_email text, contact_phone text, documento text,
  total_count bigint, total_sum numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_sort text := case p_sort
    when 'competencia' then 'f.competencia' when 'pagamento' then 'f.pagamento' when 'cliente' then 'f.cliente'
    when 'produto' then 'f.produto' when 'categoria' then 'f.categoria' when 'empresa' then 'f.empresa'
    when 'dia_ganho' then 'f.dia_ganho' when 'due_date' then 'f.due_date' when 'situacao' then 'f.situacao' else 'f.valor' end;
  v_dir text := case when lower(p_dir) = 'asc' then 'asc' else 'desc' end;
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
begin
  if not public.is_workspace_member(p_workspace_id) then
    return;
  end if;
  return query execute format($q$
    with f as (
      select v.integration_id, v.iuli_id, v.empresa, v.cliente, v.categoria, v.produto, v.tratamento, v.situacao,
             v.competencia, v.pagamento, v.due_date, v.valor, v.origem, v.hubspot_id, v.dealname, v.dia_ganho, v.pipeline_kind
      from public.receita_lancamentos_v v
      where v.workspace_id = $1
        and v.competencia between $2 and $3
        and ($4 is null or v.tratamento = $4)
        and ($5 is null or v.origem = $5)
        and ($6 is null or (v.dia_ganho is not null and date_trunc('month', v.dia_ganho::timestamp)::date = $6))
        and ($7 is null or v.integration_id = any($7))
        and ($8 is null or v.produto = any($8))
        and ($9 is null or v.categoria = $9)
        and ($10 is null or v.valor >= $10)
        and ($11 is null or v.valor <= $11)
        and ($15 is null or v.situacao = any($15))
        and ($12 is null
             or public.receita_client_norm(v.cliente) like '%%' || public.receita_client_norm($12) || '%%'
             or v.produto ilike '%%' || $12 || '%%'
             or v.categoria ilike '%%' || $12 || '%%'
             or v.dealname ilike '%%' || $12 || '%%')
    ),
    agg as (select count(*) as n, coalesce(sum(valor), 0) as s from f),
    page as (
      select * from f order by %s %s nulls last, f.iuli_id limit least(greatest($13, 1), 1000) offset greatest($14, 0)
    )
    select p.empresa, p.iuli_id, p.cliente, p.categoria, p.produto, p.tratamento, p.situacao,
           p.competencia, p.pagamento, p.due_date, p.valor, r.valor, r.nf_numero, r.venda_id, r.description,
           p.origem, p.hubspot_id, p.dealname, p.dia_ganho, p.pipeline_kind,
           d.owner_id, d.closer_owner_id,
           coalesce(c.email, hb.customer_email, tm.customer_email),
           coalesce(c.phone, hb.customer_phone, tm.customer_phone),
           coalesce(nullif(d.raw_properties->>'cpf', ''), hb.customer_document, tm.customer_document),
           agg.n, agg.s
    from page p
    cross join agg
    left join public.iuli_receivables r on r.integration_id = p.integration_id and r.iuli_id = p.iuli_id
    left join public.hubspot_deals d on d.workspace_id = $1 and d.hubspot_id = p.hubspot_id
    left join public.hubspot_contacts c on c.workspace_id = d.workspace_id and c.hubspot_id = d.contact_ids[1] and d.contact_ids[1] <> '-'
    left join public.iuli_sales s on s.integration_id = p.integration_id and s.iuli_id = r.venda_id
    left join lateral (
      select h.customer_email, h.customer_phone, h.customer_document from public.hubla_sales h
      where h.workspace_id = $1 and h.invoice_id = s.external_id limit 1
    ) hb on true
    left join lateral (
      select t.customer_email, t.customer_phone, t.customer_document from public.tmb_sales t
      where s.external_id ~ '^\d{1,15}$' and t.workspace_id = $1 and t.pedido_id = s.external_id::bigint limit 1
    ) tm on true
    order by %s %s nulls last, p.iuli_id
  $q$, v_sort, v_dir, replace(v_sort, 'f.', 'p.'), v_dir)
  using p_workspace_id, p_from, p_to, p_tratamento, p_origem, p_mes_venda, p_integration_ids, p_produto,
        p_categoria, p_min, p_max, v_search, p_limit, p_offset, p_situacoes;
end;
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'receita_summary(uuid, date, date, uuid[], text[], boolean)',
    'receita_detalhe(uuid, date, date, text, text, date, uuid[], text[], text, text, numeric, numeric, text, text, integer, integer, text[])'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- receita_titulos (não usada pelas telas) saiu: o detalhe é receita_detalhe.
drop function if exists public.receita_titulos(uuid, date, date, text, uuid[], text[], boolean, integer);
