-- Pipeline de receitas via OFX (Itaú): upload -> triagem -> enriquecimento (liga
-- a Contato/Produto/Dono reais da HubSpot) -> finalização do lote financeiro.
-- Hubla/TMB/Asaas continuam com suas próprias tabelas/dashboards — esta base é
-- só pro dinheiro que entra direto no banco, sem passar por nenhuma plataforma.

create type public.ofx_import_status as enum ('triagem', 'enriquecimento', 'finalizado');
create type public.ofx_transaction_status as enum ('pendente', 'selecionado', 'ignorado', 'finalizado');

-- Contas bancárias/entidades (ex: Itaú ID, Itaú MG — duas empresas distintas do
-- mesmo workspace). Cadastro é decisão administrativa, não operação do dia a dia.
create table public.bank_accounts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,

  bank_name text not null,
  entity_label text not null,
  display_name text not null,

  created_at timestamptz not null default now(),

  unique (workspace_id, bank_name, entity_label)
);

alter table public.bank_accounts enable row level security;

create policy "bank_accounts_select_member"
  on public.bank_accounts for select
  using (public.is_workspace_member(workspace_id));

create policy "bank_accounts_write_admin"
  on public.bank_accounts for all
  using (public.is_workspace_member(workspace_id, array['owner', 'admin']::public.workspace_role[]))
  with check (public.is_workspace_member(workspace_id, array['owner', 'admin']::public.workspace_role[]));

-- Um lote por upload de arquivo OFX.
create table public.ofx_imports (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  bank_account_id uuid not null references public.bank_accounts(id),

  file_name text,
  status public.ofx_import_status not null default 'triagem',
  transactions_total integer not null default 0,
  transactions_selected integer not null default 0,

  uploaded_by uuid references auth.users(id),
  uploaded_at timestamptz not null default now(),
  finalized_by uuid references auth.users(id),
  finalized_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.ofx_imports enable row level security;

create policy "ofx_imports_select_member"
  on public.ofx_imports for select
  using (public.is_workspace_member(workspace_id));

create policy "ofx_imports_write_member"
  on public.ofx_imports for insert
  with check (public.is_workspace_member(workspace_id));

create policy "ofx_imports_update_member"
  on public.ofx_imports for update
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

create policy "ofx_imports_delete_admin"
  on public.ofx_imports for delete
  using (public.is_workspace_member(workspace_id, array['owner', 'admin']::public.workspace_role[]));

-- Um lançamento por transação do extrato. Enriquecimento liga ao Contato (aluno),
-- Produto e Dono reais da HubSpot — não são cadastros próprios do FAROL ID.
create table public.ofx_transactions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  ofx_import_id uuid references public.ofx_imports(id) on delete cascade,
  bank_account_id uuid not null references public.bank_accounts(id),

  fitid text,
  trn_type text,
  posted_at date,
  amount numeric(14, 2),
  memo text,

  status public.ofx_transaction_status not null default 'pendente',

  hubspot_contact_id text,
  contact_name text,
  hubspot_product_id text,
  product_name text,
  hubspot_deal_id text,
  hubspot_owner_id text,
  owner_name text,

  -- Pagante: quem de fato transferiu o dinheiro — pode ser um terceiro (empresa,
  -- responsável) diferente do aluno/contato ligado à HubSpot.
  payer_name text,
  payer_document text,

  cost_center text,
  notes text,

  source text not null default 'ofx_upload' check (source in ('ofx_upload', 'import_planilha')),
  raw_payload jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (workspace_id, bank_account_id, fitid)
);

create index ofx_transactions_workspace_status_idx on public.ofx_transactions (workspace_id, status);
create index ofx_transactions_workspace_import_idx on public.ofx_transactions (workspace_id, ofx_import_id);

alter table public.ofx_transactions enable row level security;

create policy "ofx_transactions_select_member"
  on public.ofx_transactions for select
  using (public.is_workspace_member(workspace_id));

create policy "ofx_transactions_write_member"
  on public.ofx_transactions for insert
  with check (public.is_workspace_member(workspace_id));

create policy "ofx_transactions_update_member"
  on public.ofx_transactions for update
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

create policy "ofx_transactions_delete_admin"
  on public.ofx_transactions for delete
  using (public.is_workspace_member(workspace_id, array['owner', 'admin']::public.workspace_role[]));

-- Base oficial: view sobre os lançamentos finalizados, não tabela espelhada —
-- sem dual-write, sem risco de dessincronizar. RLS herda da tabela base.
create view public.receitas_oficiais as
  select * from public.ofx_transactions where status = 'finalizado';

-- Catálogo de Produtos da HubSpot — novo objeto sincronizado (mesmo padrão de
-- hubspot_contacts/hubspot_deals), usado no enriquecimento pra ligar cada
-- lançamento a um produto real em vez de texto livre.
create table public.hubspot_products (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  hubspot_id text not null,
  name text,
  price numeric(14, 2),
  sku text,
  description text,
  created_at_hubspot timestamptz,
  updated_at_hubspot timestamptz,
  raw_properties jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, hubspot_id)
);

create index hubspot_products_workspace_idx on public.hubspot_products (workspace_id);

alter table public.hubspot_products enable row level security;

create policy "hubspot_products_select_member"
  on public.hubspot_products for select
  using (public.is_workspace_member(workspace_id));
