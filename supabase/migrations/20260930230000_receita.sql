-- Resultado — Fase 5: Receita.
--
-- Receita = o que ENTROU na IULI (título com baixa, valor pago, na data do
-- pagamento), só de categorias de produto (iuli_category_map.tratamento = 'soma').
-- Cada entrada é ligada ao negócio ganho do HubSpot (pipelines Contratos e
-- Hubla & TMB) pelo cliente + produto; a data do GANHO do negócio diz de quando
-- é a venda:
--   mes          o negócio foi ganho no mesmo mês da entrada
--   outros       o negócio foi ganho em outro mês (normalmente anterior)
--   sem_negocio  não achei negócio do mesmo cliente e produto — continua contando
--                (tem categoria de produto), só não dá pra datar a venda
-- Vínculo: nome do cliente da IULI igual ao nome do negócio (ou a uma das pessoas
-- de um combo "A e B"), mesmo produto; escolhe o negócio ganho até 45 dias depois
-- do pagamento mais próximo da data da entrada.

create or replace view public.receita_lancamentos_v with (security_invoker = true) as
select
  v.workspace_id,
  v.integration_id,
  v.iuli_id,
  v.empresa,
  v.cliente,
  v.categoria,
  v.produto,
  v.tratamento,
  v.pagamento,
  v.due_date,
  v.valor_caixa as valor,
  l.hubspot_id,
  l.dia as dia_ganho,
  l.pipeline_kind,
  l.dealname,
  case
    when l.hubspot_id is null then 'sem_negocio'
    when date_trunc('month', l.dia::timestamp) = date_trunc('month', v.pagamento::timestamp) then 'mes'
    else 'outros'
  end as origem
from public.caixa_lancamentos_v v
left join lateral (
  select d.hubspot_id, d.dia, d.pipeline_kind, d.dealname
  from public.sales_deals_v d
  where v.tratamento = 'soma'
    and d.workspace_id = v.workspace_id
    and d.produto = v.produto
    and d.cliente_parts @> array[public.receita_client_norm(v.cliente)]
  order by (d.dia <= v.pagamento + 45) desc, abs(v.pagamento - d.dia)
  limit 1
) l on true
where v.situacao = 'recebido' and v.pagamento is not null;

create or replace function public.receita_summary(
  p_workspace_id uuid, p_from date, p_to date,
  p_integration_ids uuid[] default null, p_produto text[] default null, p_excluir_ee boolean default true
)
returns table (origem text, produto text, qtd bigint, total numeric)
language sql stable security definer set search_path = public
as $$
  select v.origem, v.produto, count(*), coalesce(sum(v.valor), 0)
  from public.receita_lancamentos_v v
  where public.is_workspace_member(p_workspace_id)
    and v.workspace_id = p_workspace_id
    and v.pagamento between p_from and p_to
    and v.tratamento = 'soma'
    and (p_integration_ids is null or v.integration_id = any(p_integration_ids))
    and (p_produto is null or v.produto = any(p_produto))
    and (not p_excluir_ee or not public.iuli_is_intercompany(v.workspace_id, v.cliente))
  group by 1, 2;
$$;

create or replace function public.receita_series(
  p_workspace_id uuid, p_from date, p_to date, p_grain text default 'day',
  p_integration_ids uuid[] default null, p_produto text[] default null, p_excluir_ee boolean default true
)
returns table (bucket date, origem text, qtd bigint, total numeric)
language sql stable security definer set search_path = public
as $$
  select date_trunc(case when p_grain in ('week', 'month') then p_grain else 'day' end, v.pagamento::timestamp)::date,
         v.origem, count(*), coalesce(sum(v.valor), 0)
  from public.receita_lancamentos_v v
  where public.is_workspace_member(p_workspace_id)
    and v.workspace_id = p_workspace_id
    and v.pagamento between p_from and p_to
    and v.tratamento = 'soma'
    and (p_integration_ids is null or v.integration_id = any(p_integration_ids))
    and (p_produto is null or v.produto = any(p_produto))
    and (not p_excluir_ee or not public.iuli_is_intercompany(v.workspace_id, v.cliente))
  group by 1, 2;
$$;

-- Safra: mês da entrada × mês da venda (mes_venda nulo = sem negócio vinculado).
create or replace function public.receita_safra(
  p_workspace_id uuid, p_from date, p_to date,
  p_integration_ids uuid[] default null, p_produto text[] default null, p_excluir_ee boolean default true
)
returns table (mes_entrada date, mes_venda date, qtd bigint, total numeric)
language sql stable security definer set search_path = public
as $$
  select date_trunc('month', v.pagamento::timestamp)::date,
         case when v.dia_ganho is null then null else date_trunc('month', v.dia_ganho::timestamp)::date end,
         count(*), coalesce(sum(v.valor), 0)
  from public.receita_lancamentos_v v
  where public.is_workspace_member(p_workspace_id)
    and v.workspace_id = p_workspace_id
    and v.pagamento between p_from and p_to
    and v.tratamento = 'soma'
    and (p_integration_ids is null or v.integration_id = any(p_integration_ids))
    and (p_produto is null or v.produto = any(p_produto))
    and (not p_excluir_ee or not public.iuli_is_intercompany(v.workspace_id, v.cliente))
  group by 1, 2;
$$;

-- Entradas do período que ficaram FORA da soma, por tratamento/categoria.
create or replace function public.receita_fora(
  p_workspace_id uuid, p_from date, p_to date,
  p_integration_ids uuid[] default null, p_excluir_ee boolean default true
)
returns table (tratamento text, categoria text, qtd bigint, total numeric)
language sql stable security definer set search_path = public
as $$
  select v.tratamento, coalesce(v.categoria, '(sem categoria)'), count(*), coalesce(sum(v.valor_caixa), 0)
  from public.caixa_lancamentos_v v
  where public.is_workspace_member(p_workspace_id)
    and v.workspace_id = p_workspace_id
    and v.situacao = 'recebido' and v.pagamento between p_from and p_to
    and v.tratamento <> 'soma'
    and (p_integration_ids is null or v.integration_id = any(p_integration_ids))
    and (not p_excluir_ee or not public.iuli_is_intercompany(v.workspace_id, v.cliente))
  group by 1, 2;
$$;

-- Lançamentos do período (maiores, ou só uma origem — "sem_negocio" é a lista de conciliação).
create or replace function public.receita_titulos(
  p_workspace_id uuid, p_from date, p_to date,
  p_origem text default null,
  p_integration_ids uuid[] default null, p_produto text[] default null, p_excluir_ee boolean default true,
  p_limit integer default 20
)
returns table (empresa text, cliente text, categoria text, produto text, pagamento date, dia_ganho date, dealname text, pipeline_kind text, origem text, valor numeric)
language sql stable security definer set search_path = public
as $$
  select v.empresa, v.cliente, v.categoria, v.produto, v.pagamento, v.dia_ganho, v.dealname, v.pipeline_kind, v.origem, v.valor
  from public.receita_lancamentos_v v
  where public.is_workspace_member(p_workspace_id)
    and v.workspace_id = p_workspace_id
    and v.pagamento between p_from and p_to
    and v.tratamento = 'soma'
    and (p_origem is null or v.origem = p_origem)
    and (p_integration_ids is null or v.integration_id = any(p_integration_ids))
    and (p_produto is null or v.produto = any(p_produto))
    and (not p_excluir_ee or not public.iuli_is_intercompany(v.workspace_id, v.cliente))
  order by v.valor desc
  limit least(greatest(p_limit, 1), 300);
$$;

create or replace function public.receita_produtos(p_workspace_id uuid, p_from date, p_to date)
returns table (produto text, total numeric)
language sql stable security definer set search_path = public
as $$
  select v.produto, coalesce(sum(v.valor_caixa), 0)
  from public.caixa_lancamentos_v v
  where public.is_workspace_member(p_workspace_id)
    and v.workspace_id = p_workspace_id and v.situacao = 'recebido'
    and v.pagamento between p_from and p_to and v.tratamento = 'soma'
  group by 1 order by 2 desc;
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'receita_summary(uuid, date, date, uuid[], text[], boolean)',
    'receita_series(uuid, date, date, text, uuid[], text[], boolean)',
    'receita_safra(uuid, date, date, uuid[], text[], boolean)',
    'receita_fora(uuid, date, date, uuid[], boolean)',
    'receita_titulos(uuid, date, date, text, uuid[], text[], boolean, integer)',
    'receita_produtos(uuid, date, date)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

insert into public.permission_keys (key, category, label, sort_order) values
  ('menu.resultado.receita', 'resultado', 'Resultado · Receita', 62)
on conflict (key) do nothing;

insert into public.role_permissions (workspace_id, role, permission_key, granted)
select w.id, 'manager'::public.workspace_role, 'menu.resultado.receita', true
from public.workspaces w
on conflict (workspace_id, role, permission_key) do update set granted = excluded.granted;
