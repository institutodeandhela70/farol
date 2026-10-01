-- IULI — categoria de cada lançamento de receita (Vendas · Receita · Caixa, Fase 2).
--
-- A ferramenta get_accounts_receivable não traz categoria; a list_transactions
-- traz (categoria_id, categoria, venda_id, contraparte…) com o MESMO id do
-- título a receber. A sincronização só PREENCHE estas colunas nos títulos que já
-- existem (iuli_apply_transactions) — não recarrega nada do zero.
--
-- doc_hash: HMAC-SHA256 do CPF/CNPJ (segredo IULI_DOC_HASH_KEY nas secrets da
-- função). O documento em claro continua sem ser guardado; o hash serve só de
-- chave para ligar o título ao cliente da Hubla/TMB/HubSpot.

alter table public.iuli_receivables
  add column if not exists categoria_id bigint,
  add column if not exists categoria text,
  add column if not exists venda_id bigint,
  add column if not exists contraparte text,
  add column if not exists conta_id bigint,
  add column if not exists conciliado boolean,
  add column if not exists categoria_synced_at timestamptz,
  add column if not exists doc_hash text;

create index if not exists iuli_receivables_ws_categoria_idx on public.iuli_receivables (workspace_id, categoria_id);
create index if not exists iuli_receivables_venda_idx on public.iuli_receivables (integration_id, venda_id) where venda_id is not null;
create index if not exists iuli_receivables_doc_hash_idx on public.iuli_receivables (workspace_id, doc_hash) where doc_hash is not null;

-- Plano de contas (list_categories), uma linha por categoria de cada empresa.
create table if not exists public.iuli_categories (
  integration_id uuid not null references public.integrations(id) on delete cascade,
  iuli_id bigint not null,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  nome text not null,
  nivel integer,
  pai_id bigint,
  tipo integer,                -- 1 = receita, 2 = despesa
  dre_category_id integer,
  categoria_dre text,
  codigo_contabil text,
  removed_at timestamptz,
  synced_at timestamptz not null default now(),
  primary key (integration_id, iuli_id)
);
create index if not exists iuli_categories_ws_idx on public.iuli_categories (workspace_id);

alter table public.iuli_categories enable row level security;
drop policy if exists "iuli_categories_select_member" on public.iuli_categories;
create policy "iuli_categories_select_member" on public.iuli_categories for select to authenticated
  using (public.is_workspace_member(workspace_id));

-- Aplica o lote de lançamentos nos títulos existentes. Devolve quantos casaram
-- (os demais ainda não estão em iuli_receivables — a sincronização de títulos
-- os traz e a releitura seguinte preenche a categoria).
create or replace function public.iuli_apply_transactions(p_integration_id uuid, p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  update public.iuli_receivables r
  set categoria_id = u.categoria_id,
      categoria = u.categoria,
      venda_id = u.venda_id,
      contraparte = u.contraparte,
      conta_id = u.conta_id,
      conciliado = u.conciliado,
      categoria_synced_at = now()
  from jsonb_to_recordset(p_rows) as u(
    iuli_id bigint, categoria_id bigint, categoria text, venda_id bigint,
    contraparte text, conta_id bigint, conciliado boolean
  )
  where r.integration_id = p_integration_id and r.iuli_id = u.iuli_id;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke all on function public.iuli_apply_transactions(uuid, jsonb) from public, anon, authenticated;

-- A view de títulos passa a expor a categoria (colunas novas no fim).
create or replace view public.iuli_receivables_v with (security_invoker = true) as
select
  r.integration_id,
  r.iuli_id,
  r.workspace_id,
  i.label as empresa,
  r.description,
  r.status,
  r.due_date,
  r.competencia,
  r.pagamento,
  r.valor,
  r.valor_pago,
  r.juros,
  r.empresa as cliente,
  r.nf_numero,
  r.tem_nf,
  r.tem_anexo,
  r.tem_comprovante,
  r.tem_boleto,
  case
    when r.status = 'recebida' then 'recebido'
    when r.due_date < (now() at time zone 'America/Sao_Paulo')::date then 'vencido'
    else 'a_vencer'
  end as situacao,
  public.iuli_is_intercompany(r.workspace_id, r.empresa) as entre_empresas,
  r.categoria_id,
  r.categoria,
  r.venda_id,
  r.categoria_synced_at
from public.iuli_receivables r
join public.integrations i on i.id = r.integration_id
where r.removed_at is null;

grant select on public.iuli_receivables_v to authenticated;
