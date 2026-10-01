-- Vendas · Receita · Caixa — Fase 3: de-para categoria da IULI → produto do Farol.
--
-- A categoria de cada lançamento (iuli_receivables.categoria_id) diz de que
-- produto é a entrada. Cada empresa da IULI tem seu plano de contas (ids
-- diferentes), então o de-para é pelo NOME da categoria, igual nas duas.
--
-- tratamento:
--   soma                  receita de produto — entra na Receita e no Caixa (com o produto)
--   fora_outros_produtos  "Outros Produtos" — fica fora da soma
--   a_classificar         "RECEITA A CLASSIFICAR" — fora da soma, com aviso pra categorizar
--   nao_operacional       empréstimo, patrocínio, aporte, financeiro… — fora da soma
--   revisar               ainda sem decisão — fora da soma até alguém decidir

create table if not exists public.iuli_category_map (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  nome_norm text not null,
  categoria text not null,
  produto text,
  tratamento text not null default 'revisar'
    check (tratamento in ('soma', 'fora_outros_produtos', 'a_classificar', 'nao_operacional', 'revisar')),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, nome_norm)
);

alter table public.iuli_category_map enable row level security;
drop policy if exists "iuli_category_map_select_member" on public.iuli_category_map;
create policy "iuli_category_map_select_member" on public.iuli_category_map for select to authenticated
  using (public.is_workspace_member(workspace_id));
drop policy if exists "iuli_category_map_write_admin" on public.iuli_category_map;
create policy "iuli_category_map_write_admin" on public.iuli_category_map for all to authenticated
  using (public.is_workspace_member(workspace_id, array['owner', 'admin']::public.workspace_role[]))
  with check (public.is_workspace_member(workspace_id, array['owner', 'admin']::public.workspace_role[]));

-- Sugestão inicial para as categorias de receita que ainda não têm linha.
create or replace function public.iuli_category_map_seed(p_workspace_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  insert into public.iuli_category_map (workspace_id, nome_norm, categoria, produto, tratamento)
  select distinct on (public.iuli_norm(btrim(c.nome)))
    p_workspace_id,
    public.iuli_norm(btrim(c.nome)),
    btrim(c.nome),
    case when t.tratamento = 'soma' then t.prod end,
    t.tratamento
  from public.iuli_categories c
  cross join lateral (
    select public.sales_canon_product(
      case
        when c.nome ~* 'mentoria' and c.nome ~* 'milion' then 'Imperium'
        when c.nome ~* 'palestrante 100' then 'DP100K'
        else c.nome
      end
    ) as prod
  ) p
  cross join lateral (
    select p.prod,
      case
        when c.categoria_dre is null or c.categoria_dre not ilike '%RECEITA BRUTA OPERACIONAL%' then 'nao_operacional'
        when c.nome ~* 'classific' then 'a_classificar'
        when c.nome ~* '^outros produtos' then 'fora_outros_produtos'
        when coalesce(c.nivel, 2) <= 1 then 'revisar'
        when p.prod in ('MI', 'IPM', 'Dynastia', 'Inspiratori', 'PI', 'Dubai', 'Combo II + IPM', 'MXP', 'VPO', 'DZP', 'DP100K', 'IPL', 'Eventos Milionários') then 'soma'
        else 'revisar'
      end as tratamento
  ) t
  where c.workspace_id = p_workspace_id and c.removed_at is null and c.tipo = 1
  order by public.iuli_norm(btrim(c.nome)), c.iuli_id
  on conflict (workspace_id, nome_norm) do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke all on function public.iuli_category_map_seed(uuid) from public, anon, authenticated;

select public.iuli_category_map_seed(w.id) from public.workspaces w;

-- Lista do de-para com o que já entrou em cada categoria (dados carregados até agora).
create or replace function public.iuli_category_map_list(p_workspace_id uuid)
returns table (
  nome_norm text, categoria text, produto text, tratamento text, categoria_dre text,
  empresas text[], qtd_recebido bigint, valor_recebido numeric, qtd_aberto bigint, valor_aberto numeric
)
language sql
stable
security definer
set search_path = public
as $$
  with stats as (
    select public.iuli_norm(btrim(c.nome)) as nome_norm,
           max(c.categoria_dre) as categoria_dre,
           array_agg(distinct i.label) as empresas,
           count(*) filter (where r.status = 'recebida') as qtd_recebido,
           coalesce(sum(r.valor_pago) filter (where r.status = 'recebida'), 0) as valor_recebido,
           count(*) filter (where r.status <> 'recebida') as qtd_aberto,
           coalesce(sum(r.valor) filter (where r.status <> 'recebida'), 0) as valor_aberto
    from public.iuli_receivables r
    join public.iuli_categories c on c.integration_id = r.integration_id and c.iuli_id = r.categoria_id
    join public.integrations i on i.id = r.integration_id
    where public.is_workspace_member(p_workspace_id)
      and r.workspace_id = p_workspace_id and r.removed_at is null
    group by 1
  )
  select m.nome_norm, m.categoria, m.produto, m.tratamento, s.categoria_dre,
         coalesce(s.empresas, '{}'::text[]),
         coalesce(s.qtd_recebido, 0), coalesce(s.valor_recebido, 0),
         coalesce(s.qtd_aberto, 0), coalesce(s.valor_aberto, 0)
  from public.iuli_category_map m
  left join stats s using (nome_norm)
  where public.is_workspace_member(p_workspace_id) and m.workspace_id = p_workspace_id
  order by coalesce(s.valor_recebido, 0) desc, m.categoria;
$$;
revoke all on function public.iuli_category_map_list(uuid) from public, anon;
grant execute on function public.iuli_category_map_list(uuid) to authenticated;

-- Permissão do menu
insert into public.permission_keys (key, category, label, sort_order) values
  ('menu.resultado.categorias', 'resultado', 'Resultado · Categorias IULI (de-para)', 66)
on conflict (key) do nothing;

insert into public.role_permissions (workspace_id, role, permission_key, granted)
select w.id, 'manager'::public.workspace_role, 'menu.resultado.categorias', true
from public.workspaces w
on conflict (workspace_id, role, permission_key) do update set granted = excluded.granted;
