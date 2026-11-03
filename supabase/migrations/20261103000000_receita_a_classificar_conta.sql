-- Lançamentos em "RECEITA A CLASSIFICAR" na IULI passam a ENTRAR nos totais
-- de Receita, Caixa e Pesquisa (com o produto "(a classificar)"), mas continuam
-- sinalizados: o aviso "Precisa categorizar" e o detalhamento "a_classificar"
-- seguem existindo para orientar a categorização dentro da IULI.

create or replace view public.caixa_lancamentos_v as
 SELECT r.workspace_id,
    r.integration_id,
    r.iuli_id,
    i.label AS empresa,
    r.empresa AS cliente,
    r.description,
    r.due_date,
    r.pagamento,
    r.status,
        CASE
            WHEN r.status = 'recebida'::text THEN 'recebido'::text
            WHEN r.due_date < (now() AT TIME ZONE 'America/Sao_Paulo'::text)::date THEN 'vencido'::text
            ELSE 'a_vencer'::text
        END AS situacao,
    r.categoria_id,
    r.categoria,
        CASE
            WHEN r.categoria_id IS NULL THEN 'sem_categoria'::text
            WHEN m.tratamento = 'a_classificar'::text THEN 'soma'::text
            ELSE COALESCE(m.tratamento, 'revisar'::text)
        END AS tratamento,
        CASE
            WHEN m.tratamento = 'soma'::text THEN COALESCE(NULLIF(m.produto, ''::text), r.categoria)
            WHEN m.tratamento = 'a_classificar'::text THEN '(a classificar)'::text
            ELSE NULL::text
        END AS produto,
        CASE
            WHEN r.status = 'recebida'::text THEN COALESCE(r.valor_pago, r.valor, 0::numeric)
            ELSE COALESCE(r.valor, 0::numeric)
        END AS valor_caixa,
    r.competencia,
    (r.categoria_id IS NOT NULL AND m.tratamento = 'a_classificar'::text) AS a_classificar
   FROM iuli_receivables r
     JOIN integrations i ON i.id = r.integration_id
     LEFT JOIN iuli_category_map m ON m.workspace_id = r.workspace_id AND m.nome_norm = iuli_norm(btrim(r.categoria))
  WHERE r.removed_at IS NULL;

CREATE OR REPLACE FUNCTION public.receita_fora(p_workspace_id uuid, p_from date, p_to date, p_integration_ids uuid[] DEFAULT NULL::uuid[], p_excluir_ee boolean DEFAULT false)
 RETURNS TABLE(tratamento text, categoria text, qtd bigint, total numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select case when v.a_classificar then 'a_classificar' else v.tratamento end, coalesce(v.categoria, '(sem categoria)'), count(*), coalesce(sum(v.valor_caixa), 0)
  from public.caixa_lancamentos_v v
  where public.is_workspace_member(p_workspace_id)
    and v.workspace_id = p_workspace_id
    and v.competencia between p_from and p_to
    and (v.tratamento <> 'soma' or v.a_classificar)
    and (p_integration_ids is null or v.integration_id = any(p_integration_ids))
    and (not p_excluir_ee or not public.iuli_is_intercompany(v.workspace_id, v.cliente))
  group by 1, 2;
$function$;

CREATE OR REPLACE FUNCTION public.caixa_fora(p_workspace_id uuid, p_from date, p_to date, p_integration_ids uuid[] DEFAULT NULL::uuid[], p_excluir_ee boolean DEFAULT true)
 RETURNS TABLE(tratamento text, categoria text, qtd bigint, total numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select case when v.a_classificar then 'a_classificar' else v.tratamento end, coalesce(v.categoria, '(sem categoria)'), count(*), coalesce(sum(v.valor_caixa), 0)
  from public.caixa_lancamentos_v v
  where public.is_workspace_member(p_workspace_id)
    and v.workspace_id = p_workspace_id
    and v.due_date between p_from and p_to
    and (v.tratamento <> 'soma' or v.a_classificar)
    and (p_integration_ids is null or v.integration_id = any(p_integration_ids))
    and (not p_excluir_ee or not public.iuli_is_intercompany(v.workspace_id, v.cliente))
  group by 1, 2;
$function$;

CREATE OR REPLACE FUNCTION public.receita_detalhe(p_workspace_id uuid, p_from date, p_to date, p_tratamento text DEFAULT 'soma'::text, p_origem text DEFAULT NULL::text, p_mes_venda date DEFAULT NULL::date, p_integration_ids uuid[] DEFAULT NULL::uuid[], p_produto text[] DEFAULT NULL::text[], p_categoria text DEFAULT NULL::text, p_search text DEFAULT NULL::text, p_min numeric DEFAULT NULL::numeric, p_max numeric DEFAULT NULL::numeric, p_sort text DEFAULT 'valor'::text, p_dir text DEFAULT 'desc'::text, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0, p_situacoes text[] DEFAULT NULL::text[])
 RETURNS TABLE(empresa text, iuli_id bigint, cliente text, categoria text, produto text, tratamento text, situacao text, competencia date, pagamento date, due_date date, valor numeric, valor_previsto numeric, nf_numero text, venda_id bigint, descricao text, origem text, hubspot_id text, dealname text, dia_ganho date, pipeline_kind text, owner_id text, closer_owner_id text, contact_email text, contact_phone text, documento text, total_count bigint, total_sum numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
      select v.integration_id, v.iuli_id, v.empresa, v.cliente, v.categoria, v.produto, case when v.a_classificar then 'a_classificar' else v.tratamento end as tratamento, v.situacao,
             v.competencia, v.pagamento, v.due_date, v.valor, v.origem, v.hubspot_id, v.dealname, v.dia_ganho, v.pipeline_kind
      from public.receita_lancamentos_v v
      where v.workspace_id = $1
        and v.competencia between $2 and $3
        and ($4 is null or (case when $4 = 'a_classificar' then v.a_classificar else v.tratamento = $4 end))
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
$function$;

CREATE OR REPLACE FUNCTION public.caixa_detalhe(p_workspace_id uuid, p_from date, p_to date, p_tratamento text DEFAULT 'soma'::text, p_situacoes text[] DEFAULT NULL::text[], p_atraso_min integer DEFAULT NULL::integer, p_atraso_max integer DEFAULT NULL::integer, p_integration_ids uuid[] DEFAULT NULL::uuid[], p_produto text[] DEFAULT NULL::text[], p_categoria text DEFAULT NULL::text, p_search text DEFAULT NULL::text, p_min numeric DEFAULT NULL::numeric, p_max numeric DEFAULT NULL::numeric, p_sort text DEFAULT 'valor'::text, p_dir text DEFAULT 'desc'::text, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
 RETURNS TABLE(empresa text, iuli_id bigint, cliente text, categoria text, produto text, tratamento text, situacao text, due_date date, pagamento date, valor numeric, valor_previsto numeric, nf_numero text, venda_id bigint, descricao text, hubspot_id text, dealname text, dia_ganho date, pipeline_kind text, owner_id text, closer_owner_id text, contact_email text, contact_phone text, documento text, total_count bigint, total_sum numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
      select v.integration_id, v.iuli_id, v.empresa, v.cliente, v.categoria, v.produto, case when v.a_classificar then 'a_classificar' else v.tratamento end as tratamento, v.situacao,
             v.due_date, v.pagamento, v.valor_caixa as valor, l.hubspot_id, l.dealname, l.dia_ganho, l.pipeline_kind
      from public.caixa_lancamentos_v v
      left join public.receita_links l on l.integration_id = v.integration_id and l.iuli_id = v.iuli_id
      where v.workspace_id = $1
        and v.due_date between $2 and $3
        and ($4 is null or (case when $4 = 'a_classificar' then v.a_classificar else v.tratamento = $4 end))
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
$function$;
