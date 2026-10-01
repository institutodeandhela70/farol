-- Resultado — detalhamento: cada número de KPI/gráfico/tabela abre as linhas que o formam.
--
-- vendas_detalhe / receita_detalhe / caixa_detalhe usam os MESMOS filtros das
-- funções de resumo (sales_summary, receita_summary, caixa_summary), então a soma
-- das linhas (total_sum) fecha com o número clicado. Cada linha traz o cliente
-- (e e-mail, telefone e documento quando existirem), vendedor, produto, valor e datas.
--
-- Filtros comuns: p_search (nome do cliente, e-mail, telefone, produto, negócio),
-- valor mínimo/máximo, ordenação (colunas permitidas) e paginação no banco.
-- total_count / total_sum vêm em toda linha (da consulta filtrada inteira).

-- ---------------------------------------------------------------------------
-- Vínculo também para títulos em aberto (Caixa mostra vendedor/negócio do título).
-- Para o título sem pagamento, a proximidade é medida pelo vencimento.
-- ---------------------------------------------------------------------------
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
           coalesce(v.pagamento, v.due_date) as ref_dia, v.cliente
    from public.caixa_lancamentos_v v
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
-- Vendas
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- Receita (entrada = título com baixa, por data de pagamento)
-- ---------------------------------------------------------------------------
create or replace function public.receita_detalhe(
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
  p_offset integer default 0
)
returns table (
  empresa text, iuli_id bigint, cliente text, categoria text, produto text, tratamento text,
  pagamento date, due_date date, valor numeric, valor_previsto numeric, nf_numero text, venda_id bigint, descricao text,
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
    when 'pagamento' then 'f.pagamento' when 'cliente' then 'f.cliente' when 'produto' then 'f.produto'
    when 'categoria' then 'f.categoria' when 'empresa' then 'f.empresa' when 'dia_ganho' then 'f.dia_ganho'
    when 'due_date' then 'f.due_date' else 'f.valor' end;
  v_dir text := case when lower(p_dir) = 'asc' then 'asc' else 'desc' end;
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
begin
  if not public.is_workspace_member(p_workspace_id) then
    return;
  end if;
  return query execute format($q$
    with f as (
      select v.integration_id, v.iuli_id, v.empresa, v.cliente, v.categoria, v.produto, v.tratamento,
             v.pagamento, v.due_date, v.valor, v.origem, v.hubspot_id, v.dealname, v.dia_ganho, v.pipeline_kind
      from public.receita_lancamentos_v v
      where v.workspace_id = $1
        and v.pagamento between $2 and $3
        and ($4 is null or v.tratamento = $4)
        and ($5 is null or v.origem = $5)
        and ($6 is null or (v.dia_ganho is not null and date_trunc('month', v.dia_ganho::timestamp)::date = $6))
        and ($7 is null or v.integration_id = any($7))
        and ($8 is null or v.produto = any($8))
        and ($9 is null or v.categoria = $9)
        and ($10 is null or v.valor >= $10)
        and ($11 is null or v.valor <= $11)
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
    select p.empresa, p.iuli_id, p.cliente, p.categoria, p.produto, p.tratamento,
           p.pagamento, p.due_date, p.valor, r.valor, r.nf_numero, r.venda_id, r.description,
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
        p_categoria, p_min, p_max, v_search, p_limit, p_offset;
end;
$$;

-- ---------------------------------------------------------------------------
-- Caixa (título por data de vencimento; recebido, a vencer ou vencido)
-- ---------------------------------------------------------------------------
create or replace function public.caixa_detalhe(
  p_workspace_id uuid, p_from date, p_to date,
  p_tratamento text default 'soma',
  p_situacoes text[] default null,
  p_atraso_min integer default null,
  p_atraso_max integer default null,
  p_integration_ids uuid[] default null,
  p_produto text[] default null,
  p_categoria text default null,
  p_search text default null,
  p_min numeric default null,
  p_max numeric default null,
  p_sort text default 'valor',
  p_dir text default 'desc',
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  empresa text, iuli_id bigint, cliente text, categoria text, produto text, tratamento text, situacao text,
  due_date date, pagamento date, valor numeric, valor_previsto numeric, nf_numero text, venda_id bigint, descricao text,
  hubspot_id text, dealname text, dia_ganho date, pipeline_kind text,
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
    when 'due_date' then 'f.due_date' when 'cliente' then 'f.cliente' when 'produto' then 'f.produto'
    when 'categoria' then 'f.categoria' when 'empresa' then 'f.empresa' when 'situacao' then 'f.situacao'
    when 'pagamento' then 'f.pagamento' else 'f.valor' end;
  v_dir text := case when lower(p_dir) = 'asc' then 'asc' else 'desc' end;
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  if not public.is_workspace_member(p_workspace_id) then
    return;
  end if;
  return query execute format($q$
    with f as (
      select v.integration_id, v.iuli_id, v.empresa, v.cliente, v.categoria, v.produto, v.tratamento, v.situacao,
             v.due_date, v.pagamento, v.valor_caixa as valor, l.hubspot_id, l.dealname, l.dia_ganho, l.pipeline_kind
      from public.caixa_lancamentos_v v
      left join public.receita_links l on l.integration_id = v.integration_id and l.iuli_id = v.iuli_id
      where v.workspace_id = $1
        and v.due_date between $2 and $3
        and ($4 is null or v.tratamento = $4)
        and ($5 is null or v.situacao = any($5))
        and ($6 is null or ($15 - v.due_date) >= $6)
        and ($7 is null or ($15 - v.due_date) <= $7)
        and ($8 is null or v.integration_id = any($8))
        and ($9 is null or v.produto = any($9))
        and ($10 is null or v.categoria = $10)
        and ($11 is null or v.valor_caixa >= $11)
        and ($12 is null or v.valor_caixa <= $12)
        and ($13 is null
             or public.receita_client_norm(v.cliente) like '%%' || public.receita_client_norm($13) || '%%'
             or v.produto ilike '%%' || $13 || '%%'
             or v.categoria ilike '%%' || $13 || '%%'
             or l.dealname ilike '%%' || $13 || '%%')
    ),
    agg as (select count(*) as n, coalesce(sum(valor), 0) as s from f),
    page as (
      select * from f order by %s %s nulls last, f.iuli_id limit least(greatest($14, 1), 1000) offset greatest($16, 0)
    )
    select p.empresa, p.iuli_id, p.cliente, p.categoria, p.produto, p.tratamento, p.situacao,
           p.due_date, p.pagamento, p.valor, r.valor, r.nf_numero, r.venda_id, r.description,
           p.hubspot_id, p.dealname, p.dia_ganho, p.pipeline_kind,
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
  using p_workspace_id, p_from, p_to, p_tratamento, p_situacoes, p_atraso_min, p_atraso_max, p_integration_ids,
        p_produto, p_categoria, p_min, p_max, v_search, p_limit, v_hoje, p_offset;
end;
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'vendas_detalhe(uuid, date, date, text[], text, text, text[], boolean, boolean, text, numeric, numeric, text, text, integer, integer)',
    'receita_detalhe(uuid, date, date, text, text, date, uuid[], text[], text, text, numeric, numeric, text, text, integer, integer)',
    'caixa_detalhe(uuid, date, date, text, text[], integer, integer, uuid[], text[], text, text, numeric, numeric, text, text, integer, integer)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
