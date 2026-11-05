-- Otimiza o passo 0 (ID da fatura da Hubla) do receita_refresh_links: a versão
-- anterior estourava o tempo na atualização completa desde 2025 (a view de vendas
-- era recalculada várias vezes). Agora a lista de negócios é materializada uma vez.

CREATE OR REPLACE FUNCTION public.receita_refresh_links(p_workspace_id uuid, p_since date DEFAULT NULL::date)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    left join lateral (select x.customer_email, x.customer_document from public.tmb_sales x where s.external_id ~ '^\d{1,15}$' and x.workspace_id = p_workspace_id and x.pedido_id = (case when s.external_id ~ '^\d{1,15}$' then s.external_id::bigint end) limit 1) t on true
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

  -- Passo 0 (sobrepõe o nome): ID da fatura da Hubla. A venda da IULI guarda o
  -- ID da fatura (external_id) e o negócio da Hubla & TMB no HubSpot guarda o
  -- mesmo ID (hbl_invoice_id): chave exata, não depende de o nome estar igual.
  --  * produtos dos 6 (a venda é a de Contratos): sobe do negócio da Hubla ao
  --    negócio ganho de Contratos do mesmo produto que divide o contato;
  --  * demais produtos: liga direto ao negócio da Hubla.
  -- Materializa a lista de negócios uma vez só (a view de vendas é cara).
  with sdv as materialized (
    select d.hubspot_id, d.dia, d.pipeline_kind, d.dealname, d.produto,
           array_remove(hd.contact_ids, '-') as contacts
    from public.sales_deals_v d
    join public.hubspot_deals hd on hd.workspace_id = d.workspace_id and hd.hubspot_id = d.hubspot_id
    where d.workspace_id = p_workspace_id
  ),
  t as (
    select l.integration_id, l.iuli_id, v.produto, s.external_id,
           coalesce(v.competencia, v.pagamento, v.due_date) as ref_dia,
           (coalesce(c.is_high, false) and not coalesce(c.count_hubla, false)) as so_contratos
    from public.receita_links l
    join public.caixa_lancamentos_v v on v.integration_id = l.integration_id and v.iuli_id = l.iuli_id
    join public.iuli_receivables r on r.integration_id = l.integration_id and r.iuli_id = l.iuli_id
    join public.iuli_sales s on s.integration_id = r.integration_id and s.iuli_id = r.venda_id
    left join public.sales_product_catalog c on c.workspace_id = v.workspace_id and c.produto = v.produto
    where l.workspace_id = p_workspace_id and not l.manual
      and v.tratamento = 'soma'
      and s.external_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-'
      and coalesce(v.competencia, v.pagamento, v.due_date) >= v_since
  ),
  hd as materialized (
    select t.*, sd.dia as hub_dia, sd.pipeline_kind as hub_kind, sd.dealname as hub_name, sd.hubspot_id as hub_id, sd.contacts
    from t
    join public.hubspot_deals d on d.workspace_id = p_workspace_id and d.hbl_invoice_id = t.external_id
    join public.sales_pipeline_roles pr on pr.workspace_id = d.workspace_id and pr.pipeline_id = d.pipeline and pr.role = 'hubla_tmb'
    join sdv sd on sd.hubspot_id = d.hubspot_id
    where d.is_closed_won
  ),
  direto as (
    select distinct on (hd.integration_id, hd.iuli_id)
           hd.integration_id, hd.iuli_id, hd.hub_id as hubspot_id, hd.hub_dia as dia, hd.hub_kind as pipeline_kind, hd.hub_name as dealname
    from hd
    where not hd.so_contratos
    order by hd.integration_id, hd.iuli_id, abs(hd.ref_dia - hd.hub_dia)
  ),
  via_contratos as (
    select distinct on (hd.integration_id, hd.iuli_id)
           hd.integration_id, hd.iuli_id, k.hubspot_id, k.dia, k.pipeline_kind, k.dealname
    from (select * from hd where so_contratos and cardinality(contacts) > 0) hd
    join (select * from sdv where pipeline_kind = 'contratos') k on k.produto = hd.produto and k.contacts && hd.contacts
    order by hd.integration_id, hd.iuli_id, (k.dia <= hd.ref_dia + 45) desc, abs(hd.ref_dia - k.dia)
  ),
  por_id as (
    select * from direto
    union all
    select * from via_contratos
  )
  update public.receita_links l
  set hubspot_id = p.hubspot_id, dia_ganho = p.dia, pipeline_kind = p.pipeline_kind,
      dealname = p.dealname, metodo = 'hubla_id', linked_at = now()
  from por_id p
  where l.integration_id = p.integration_id and l.iuli_id = p.iuli_id and not l.manual;

  return v_count;
end;
$function$;
