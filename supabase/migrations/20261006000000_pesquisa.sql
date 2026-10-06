-- Resultado → Pesquisa: pesquisa de lançamentos (títulos) de receita de produto da IULI,
-- com o negócio de Contratos vinculado (data do ganho), e o detalhe completo de um lançamento.
--
-- 1) O vínculo título ↔ negócio ganha mais duas tentativas quando o NOME não bate:
--    · documento/e-mail: CPF (ou e-mail) do cliente na Hubla/TMB = CPF do negócio (propriedade
--      cpf) ou e-mail do contato do negócio;
--    · valor exato + data: negócio do mesmo produto, valor igual ao do título (ou ao da venda
--      na IULI) e ganho até 30 dias da competência — só vale se houver UM candidato.
--    receita_links.metodo diz como foi ligado (nome, documento, email, valor_data, manual).

alter table public.receita_links add column if not exists metodo text;

alter table public.hubspot_deals
  add column if not exists cpf_digits text generated always as (nullif(regexp_replace(coalesce(raw_properties->>'cpf', ''), '\D', '', 'g'), '')) stored;
create index if not exists hubspot_deals_cpf_idx on public.hubspot_deals (workspace_id, cpf_digits) where cpf_digits is not null;
create index if not exists hubspot_contacts_email_lower_idx on public.hubspot_contacts (workspace_id, lower(email)) where email is not null;
create index if not exists hubla_sales_invoice_idx on public.hubla_sales (workspace_id, invoice_id);

create or replace function public.receita_refresh_links(p_workspace_id uuid, p_since date default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
  v_since date := coalesce(p_since, date '2025-01-01');
begin
  -- Passo 1: nome + produto (competência como referência de data)
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
  insert into public.receita_links (integration_id, iuli_id, workspace_id, hubspot_id, dia_ganho, pipeline_kind, dealname, metodo, linked_at)
  select integration_id, iuli_id, workspace_id, hubspot_id, dia, pipeline_kind, dealname,
         case when hubspot_id is not null then 'nome' end, now()
  from m
  on conflict (integration_id, iuli_id) do update
    set hubspot_id = excluded.hubspot_id, dia_ganho = excluded.dia_ganho, pipeline_kind = excluded.pipeline_kind,
        dealname = excluded.dealname, metodo = excluded.metodo, linked_at = excluded.linked_at
    where not public.receita_links.manual;
  get diagnostics v_count = row_count;

  -- Passos 2 e 3: só para o que ficou sem negócio
  with dl as materialized (
    select d.hubspot_id, d.dia, d.pipeline_kind, d.dealname, d.produto, d.amount, hd.cpf_digits, lower(ct.email) as email
    from public.sales_deals_v d
    join public.hubspot_deals hd on hd.workspace_id = d.workspace_id and hd.hubspot_id = d.hubspot_id
    left join public.hubspot_contacts ct on ct.workspace_id = hd.workspace_id and ct.hubspot_id = hd.contact_ids[1] and hd.contact_ids[1] <> '-'
    where d.workspace_id = p_workspace_id
  ),
  u as (
    select l.integration_id, l.iuli_id, v.produto, v.competencia, v.valor_caixa as valor, s.valor_total as venda_total,
           lower(coalesce(h.customer_email, t.customer_email)) as email,
           nullif(regexp_replace(coalesce(h.customer_document, t.customer_document, ''), '\D', '', 'g'), '') as doc,
           (coalesce(c.is_high, false) and not coalesce(c.count_hubla, false)) as so_contratos
    from public.receita_links l
    join public.caixa_lancamentos_v v on v.integration_id = l.integration_id and v.iuli_id = l.iuli_id
    left join public.sales_product_catalog c on c.workspace_id = v.workspace_id and c.produto = v.produto
    join public.iuli_receivables r on r.integration_id = l.integration_id and r.iuli_id = l.iuli_id
    left join public.iuli_sales s on s.integration_id = r.integration_id and s.iuli_id = r.venda_id
    left join lateral (select x.customer_email, x.customer_document from public.hubla_sales x where x.workspace_id = p_workspace_id and x.invoice_id = s.external_id limit 1) h on true
    left join lateral (select x.customer_email, x.customer_document from public.tmb_sales x where s.external_id ~ '^\d{1,15}$' and x.workspace_id = p_workspace_id and x.pedido_id = (case when s.external_id ~ '^d{1,15}$' then s.external_id::bigint end) limit 1) t on true
    where l.workspace_id = p_workspace_id and l.hubspot_id is null and not l.manual
      and v.tratamento = 'soma' and v.competencia is not null and v.competencia >= v_since
  ),
  a as (
    select distinct on (u.integration_id, u.iuli_id)
           u.integration_id, u.iuli_id, dl.hubspot_id, dl.dia, dl.pipeline_kind, dl.dealname,
           case when u.doc is not null and dl.cpf_digits = u.doc then 'documento' else 'email' end as metodo
    from u
    join dl on dl.produto = u.produto
           and (not u.so_contratos or dl.pipeline_kind = 'contratos')
           and ((u.doc is not null and length(u.doc) >= 11 and dl.cpf_digits = u.doc) or (u.email is not null and dl.email = u.email))
    order by u.integration_id, u.iuli_id, abs(dl.dia - u.competencia)
  ),
  b as (
    select u.integration_id, u.iuli_id, min(dl.hubspot_id) as hubspot_id, min(dl.dia) as dia, min(dl.pipeline_kind) as pipeline_kind, min(dl.dealname) as dealname
    from u
    join dl on dl.produto = u.produto
           and (not u.so_contratos or dl.pipeline_kind = 'contratos')
           and (abs(dl.amount - u.valor) < 0.01 or abs(dl.amount - coalesce(u.venda_total, -1)) < 0.01)
           and abs(dl.dia - u.competencia) <= 30
    where not exists (select 1 from a where a.integration_id = u.integration_id and a.iuli_id = u.iuli_id)
    group by u.integration_id, u.iuli_id
    having count(distinct dl.hubspot_id) = 1
  ),
  best as (
    select integration_id, iuli_id, hubspot_id, dia, pipeline_kind, dealname, metodo from a
    union all
    select integration_id, iuli_id, hubspot_id, dia, pipeline_kind, dealname, 'valor_data' from b
  )
  update public.receita_links l
  set hubspot_id = best.hubspot_id, dia_ganho = best.dia, pipeline_kind = best.pipeline_kind,
      dealname = best.dealname, metodo = best.metodo, linked_at = now()
  from best
  where l.integration_id = best.integration_id and l.iuli_id = best.iuli_id and not l.manual;

  return v_count;
end;
$$;
revoke all on function public.receita_refresh_links(uuid, date) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Pesquisa de lançamentos (um por título; só categorias de produto)
-- p_base: competencia | vencimento | pagamento | ganho (data do ganho do negócio de Contratos)
-- ---------------------------------------------------------------------------
create or replace function public.pesquisa_lancamentos(
  p_workspace_id uuid,
  p_base text default 'competencia',
  p_from date default null,
  p_to date default null,
  p_search text default null,
  p_produto text[] default null,
  p_integration_ids uuid[] default null,
  p_situacoes text[] default null,
  p_categoria text default null,
  p_vinculo text default null,
  p_sort text default 'competencia',
  p_dir text default 'desc',
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  integration_id uuid, iuli_id bigint, empresa text, cliente text, categoria text, produto text, situacao text,
  competencia date, due_date date, pagamento date, valor numeric, valor_previsto numeric, nf_numero text, venda_id bigint,
  hubspot_id text, dealname text, dia_ganho date, pipeline_kind text, metodo text, etapa text,
  owner_id text, closer_owner_id text, deal_amount numeric,
  contact_email text, contact_phone text, documento text,
  total_count bigint, total_sum numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_date text := case p_base when 'vencimento' then 'v.due_date' when 'pagamento' then 'v.pagamento' when 'ganho' then 'l.dia_ganho' else 'v.competencia' end;
  v_sort text := case p_sort
    when 'due_date' then 'f.due_date' when 'pagamento' then 'f.pagamento' when 'dia_ganho' then 'f.dia_ganho'
    when 'cliente' then 'f.cliente' when 'produto' then 'f.produto' when 'valor' then 'f.valor' when 'situacao' then 'f.situacao'
    else 'f.competencia' end;
  v_dir text := case when lower(p_dir) = 'asc' then 'asc' else 'desc' end;
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
  v_digits text := nullif(regexp_replace(coalesce(p_search, ''), '\D', '', 'g'), '');
begin
  if not public.is_workspace_member(p_workspace_id) then
    return;
  end if;
  return query execute format($q$
    with f as (
      select v.integration_id, v.iuli_id, v.empresa, v.cliente, v.categoria, v.produto, v.situacao,
             v.competencia, v.due_date, v.pagamento, v.valor_caixa as valor,
             l.hubspot_id, l.dealname, l.dia_ganho, l.pipeline_kind, l.metodo,
             r.nf_numero, r.venda_id, r.valor as valor_previsto,
             coalesce(c.email, h.customer_email, t.customer_email) as email,
             coalesce(c.phone, h.customer_phone, t.customer_phone) as phone,
             coalesce(nullif(d.cpf_digits, ''), regexp_replace(coalesce(h.customer_document, t.customer_document, ''), '\D', '', 'g')) as doc
      from public.caixa_lancamentos_v v
      left join public.receita_links l on l.integration_id = v.integration_id and l.iuli_id = v.iuli_id
      left join public.iuli_receivables r on r.integration_id = v.integration_id and r.iuli_id = v.iuli_id
      left join public.iuli_sales s on s.integration_id = r.integration_id and s.iuli_id = r.venda_id
      left join public.hubla_sales h on h.workspace_id = v.workspace_id and h.invoice_id = s.external_id
      left join public.tmb_sales t on s.external_id ~ '^\d{1,15}$' and t.workspace_id = v.workspace_id and t.pedido_id = (case when s.external_id ~ '^d{1,15}$' then s.external_id::bigint end)
      left join public.hubspot_deals d on d.workspace_id = v.workspace_id and d.hubspot_id = l.hubspot_id
      left join public.hubspot_contacts c on c.workspace_id = d.workspace_id and c.hubspot_id = d.contact_ids[1] and d.contact_ids[1] <> '-'
      where v.workspace_id = $1
        and v.tratamento = 'soma'
        and ($2::date is null or %1$s >= $2)
        and ($3::date is null or %1$s <= $3)
        and ($4 is null or v.produto = any($4))
        and ($5 is null or v.integration_id = any($5))
        and ($6 is null or (case when v.situacao = 'recebido' then 'recebido' else 'a_receber' end) = any($6) or v.situacao = any($6))
        and ($7 is null or v.categoria = $7)
        and ($8 is null or ($8 = 'com' and l.hubspot_id is not null) or ($8 = 'sem' and l.hubspot_id is null))
        and ($9 is null
             or public.receita_client_norm(v.cliente) like '%%' || public.receita_client_norm($9) || '%%'
             or v.produto ilike '%%' || $9 || '%%'
             or v.categoria ilike '%%' || $9 || '%%'
             or l.dealname ilike '%%' || $9 || '%%'
             or coalesce(c.email, h.customer_email, t.customer_email) ilike '%%' || $9 || '%%'
             or coalesce(c.phone, h.customer_phone, t.customer_phone) ilike '%%' || $9 || '%%'
             or ($10 is not null and length($10) >= 6 and regexp_replace(coalesce(nullif(d.cpf_digits, ''), h.customer_document, t.customer_document, ''), '\D', '', 'g') like '%%' || $10 || '%%'))
    ),
    agg as (select count(*) as n, coalesce(sum(valor), 0) as s from f),
    page as (
      select * from f order by %2$s %3$s nulls last, f.iuli_id limit least(greatest($11, 1), 1000) offset greatest($12, 0)
    )
    select p.integration_id, p.iuli_id, p.empresa, p.cliente, p.categoria, p.produto, p.situacao,
           p.competencia, p.due_date, p.pagamento, p.valor, p.valor_previsto, p.nf_numero, p.venda_id,
           p.hubspot_id, p.dealname, p.dia_ganho, p.pipeline_kind, p.metodo,
           (select coalesce(st.label, hd.dealstage) from public.hubspot_deals hd
              left join public.hubspot_pipeline_stages st on st.pipeline_id = hd.pipeline and st.stage_id = hd.dealstage
              where hd.workspace_id = $1 and hd.hubspot_id = p.hubspot_id),
           hd2.owner_id, hd2.closer_owner_id, hd2.amount,
           p.email, p.phone, nullif(p.doc, ''),
           agg.n, agg.s
    from page p
    cross join agg
    left join public.hubspot_deals hd2 on hd2.workspace_id = $1 and hd2.hubspot_id = p.hubspot_id
    order by %4$s %3$s nulls last, p.iuli_id
  $q$, v_date, v_sort, v_dir, replace(v_sort, 'f.', 'p.'))
  using p_workspace_id, p_from, p_to, p_produto, p_integration_ids, p_situacoes, p_categoria, p_vinculo, v_search, v_digits, p_limit, p_offset;
end;
$$;

-- ---------------------------------------------------------------------------
-- Detalhe completo de um lançamento
-- ---------------------------------------------------------------------------
create or replace function public.pesquisa_lancamento_detalhe(p_workspace_id uuid, p_integration_id uuid, p_iuli_id bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v jsonb;
begin
  if not public.is_workspace_member(p_workspace_id) then
    return null;
  end if;
  select jsonb_build_object(
    'titulo', jsonb_build_object(
      'iuli_id', r.iuli_id, 'empresa', i.label, 'cliente', r.empresa, 'descricao', r.description, 'status', r.status,
      'situacao', cl.situacao, 'competencia', r.competencia, 'vencimento', r.due_date, 'pagamento', r.pagamento,
      'valor_previsto', r.valor, 'valor_pago', r.valor_pago, 'juros', r.juros, 'nf_numero', r.nf_numero,
      'tem_nf', r.tem_nf, 'tem_boleto', r.tem_boleto, 'tem_comprovante', r.tem_comprovante, 'venda_id', r.venda_id,
      'categoria', r.categoria, 'produto', cl.produto, 'tratamento', cl.tratamento, 'sincronizado_em', r.synced_at
    ),
    'venda_iuli', (select to_jsonb(x) from (
      select s.iuli_id, s.status, s.valor_total, s.valor_liquido, s.competencia, s.pagamento, s.external_id, s.cliente, s.descricao, s.nfe_status
      from public.iuli_sales s where s.integration_id = r.integration_id and s.iuli_id = r.venda_id) x),
    'hubla', (select to_jsonb(x) from (
      select h.invoice_id, h.status, h.product_name, h.offer_name, h.payment_method, h.total_value, h.net_value, h.installments,
             h.smart_installment_number as parcela, h.smart_installment_total as parcelas_total, h.created_at_hubla, h.paid_at, h.due_date,
             h.customer_name, h.customer_email, h.customer_phone, h.customer_document, h.coupon_code, h.utm_source, h.utm_campaign
      from public.hubla_sales h where h.workspace_id = p_workspace_id and h.invoice_id = s.external_id limit 1) x),
    'tmb', (select to_jsonb(x) from (
      select t.pedido_id, t.status, t.status_financeiro, t.product_name, t.valor_total, t.parcelas, t.criado_em, t.data_efetivado,
             t.customer_name, t.customer_email, t.customer_phone, t.customer_document
      from public.tmb_sales t where s.external_id ~ '^\d{1,15}$' and t.workspace_id = p_workspace_id and t.pedido_id = (case when s.external_id ~ '^d{1,15}$' then s.external_id::bigint end) limit 1) x),
    'vinculo', (select to_jsonb(x) from (
      select l.hubspot_id, l.dealname, l.dia_ganho, l.pipeline_kind, l.metodo, l.manual, l.linked_at
      from public.receita_links l where l.integration_id = r.integration_id and l.iuli_id = r.iuli_id) x),
    'negocio', (select to_jsonb(x) from (
      select d.hubspot_id, d.dealname, d.amount, d.closedate, d.created_at_hubspot, d.is_closed_won, d.owner_id, d.closer_owner_id,
             coalesce(st.label, d.dealstage) as etapa, pp.label as pipeline, coalesce(d.produto_contratos, d.produto_hubla) as produto,
             d.cpf_digits as cpf
      from public.receita_links l
      join public.hubspot_deals d on d.workspace_id = p_workspace_id and d.hubspot_id = l.hubspot_id
      left join public.hubspot_pipelines pp on pp.workspace_id = d.workspace_id and pp.pipeline_id = d.pipeline
      left join public.hubspot_pipeline_stages st on st.pipeline_id = d.pipeline and st.stage_id = d.dealstage
      where l.integration_id = r.integration_id and l.iuli_id = r.iuli_id) x),
    'contato', (select to_jsonb(x) from (
      select ct.hubspot_id, ct.firstname, ct.lastname, ct.email, ct.phone, ct.lifecyclestage
      from public.receita_links l
      join public.hubspot_deals d on d.workspace_id = p_workspace_id and d.hubspot_id = l.hubspot_id
      join public.hubspot_contacts ct on ct.workspace_id = d.workspace_id and ct.hubspot_id = d.contact_ids[1]
      where l.integration_id = r.integration_id and l.iuli_id = r.iuli_id limit 1) x),
    'outros_negocios', coalesce((select jsonb_agg(to_jsonb(x) order by x.closedate desc nulls last) from (
      select d.hubspot_id, d.dealname, d.amount, d.closedate, d.is_closed_won, pp.label as pipeline, coalesce(st.label, d.dealstage) as etapa,
             coalesce(d.produto_contratos, d.produto_hubla) as produto
      from public.hubspot_deals d
      left join public.hubspot_pipelines pp on pp.workspace_id = d.workspace_id and pp.pipeline_id = d.pipeline
      left join public.hubspot_pipeline_stages st on st.pipeline_id = d.pipeline and st.stage_id = d.dealstage
      where d.workspace_id = p_workspace_id and public.sales_name_match(public.receita_client_norm(r.empresa), d.dealname_norm)
      order by d.closedate desc nulls last limit 25) x), '[]'::jsonb),
    'outros_titulos', coalesce((select jsonb_agg(to_jsonb(x) order by x.competencia desc) from (
      select o.iuli_id, o.competencia, o.due_date, o.pagamento, o.situacao, o.categoria, o.valor_caixa as valor
      from public.caixa_lancamentos_v o
      where o.workspace_id = p_workspace_id and o.tratamento = 'soma' and o.integration_id = r.integration_id
        and o.iuli_id <> r.iuli_id and public.receita_client_norm(o.cliente) = public.receita_client_norm(r.empresa)
      order by o.competencia desc nulls last limit 30) x), '[]'::jsonb)
  )
  into v
  from public.iuli_receivables r
  join public.integrations i on i.id = r.integration_id
  join public.caixa_lancamentos_v cl on cl.integration_id = r.integration_id and cl.iuli_id = r.iuli_id
  left join public.iuli_sales s on s.integration_id = r.integration_id and s.iuli_id = r.venda_id
  where r.integration_id = p_integration_id and r.iuli_id = p_iuli_id and r.workspace_id = p_workspace_id;
  return v;
end;
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'pesquisa_lancamentos(uuid, text, date, date, text, text[], uuid[], text[], text, text, text, text, integer, integer)',
    'pesquisa_lancamento_detalhe(uuid, uuid, bigint)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

insert into public.permission_keys (key, category, label, sort_order) values
  ('menu.resultado.pesquisa', 'resultado', 'Resultado · Pesquisa', 63)
on conflict (key) do nothing;

insert into public.role_permissions (workspace_id, role, permission_key, granted)
select w.id, 'manager'::public.workspace_role, 'menu.resultado.pesquisa', true
from public.workspaces w
on conflict (workspace_id, role, permission_key) do update set granted = excluded.granted;
