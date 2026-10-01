-- Receita: vínculo entrada da IULI ↔ negócio do HubSpot guardado em tabela
-- (calcular a cada consulta levava ~9s para 9 meses). Atualizado de hora em hora
-- (últimos 45 dias) e por inteiro uma vez por dia. manual = vínculo feito à mão
-- (a atualização não sobrescreve).

create table if not exists public.receita_links (
  integration_id uuid not null references public.integrations(id) on delete cascade,
  iuli_id bigint not null,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  hubspot_id text,
  dia_ganho date,
  pipeline_kind text,
  dealname text,
  manual boolean not null default false,
  linked_at timestamptz not null default now(),
  primary key (integration_id, iuli_id)
);
create index if not exists receita_links_ws_idx on public.receita_links (workspace_id);

alter table public.receita_links enable row level security;
drop policy if exists "receita_links_select_member" on public.receita_links;
create policy "receita_links_select_member" on public.receita_links for select to authenticated
  using (public.is_workspace_member(workspace_id));

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
    select v.integration_id, v.iuli_id, v.workspace_id, v.produto, v.pagamento, v.cliente
    from public.caixa_lancamentos_v v
    where v.workspace_id = p_workspace_id
      and v.tratamento = 'soma' and v.situacao = 'recebido' and v.pagamento is not null
      and (p_since is null or v.pagamento >= p_since)
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
      order by (d.dia <= r.pagamento + 45) desc, abs(r.pagamento - d.dia)
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

-- Botão "atualizar vínculos" (dono/admin).
create or replace function public.receita_refresh_links_admin(p_workspace_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_workspace_member(p_workspace_id, array['owner', 'admin']::public.workspace_role[]) then
    raise exception 'sem permissão';
  end if;
  return public.receita_refresh_links(p_workspace_id, date '2025-01-01');
end;
$$;
revoke all on function public.receita_refresh_links_admin(uuid) from public, anon;
grant execute on function public.receita_refresh_links_admin(uuid) to authenticated;

create or replace view public.receita_lancamentos_v with (security_invoker = true) as
select
  v.workspace_id, v.integration_id, v.iuli_id, v.empresa, v.cliente, v.categoria, v.produto, v.tratamento,
  v.pagamento, v.due_date, v.valor_caixa as valor,
  l.hubspot_id,
  l.dia_ganho,
  l.pipeline_kind,
  l.dealname,
  case
    when l.hubspot_id is null then 'sem_negocio'
    when date_trunc('month', l.dia_ganho::timestamp) = date_trunc('month', v.pagamento::timestamp) then 'mes'
    else 'outros'
  end as origem
from public.caixa_lancamentos_v v
left join public.receita_links l on l.integration_id = v.integration_id and l.iuli_id = v.iuli_id
where v.situacao = 'recebido' and v.pagamento is not null;

-- Cron: últimos 45 dias de hora em hora; tudo desde 2025 uma vez por dia.
create or replace function public.receita_refresh_all(p_since date)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  w record;
begin
  for w in select distinct workspace_id from public.iuli_category_map loop
    perform public.receita_refresh_links(w.workspace_id, p_since);
  end loop;
end;
$$;
revoke all on function public.receita_refresh_all(date) from public, anon, authenticated;

select cron.unschedule('farol-receita-links-recent') where exists (select 1 from cron.job where jobname = 'farol-receita-links-recent');
select cron.unschedule('farol-receita-links-full') where exists (select 1 from cron.job where jobname = 'farol-receita-links-full');
select cron.schedule('farol-receita-links-recent', '40 * * * *', $$ select public.receita_refresh_all(current_date - 45); $$);
select cron.schedule('farol-receita-links-full', '40 6 * * *', $$ select public.receita_refresh_all(date '2025-01-01'); $$);

select public.receita_refresh_all(date '2025-01-01');
