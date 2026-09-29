-- Migra membros existentes do papel legado 'member' para 'vendedor'.
-- 'member' fica reservado no enum (Postgres não permite remover valores),
-- mas não é mais atribuído a partir daqui.
update public.workspace_members
set role = 'vendedor'
where role = 'member';

update public.workspace_invites
set role = 'vendedor'
where role = 'member' and status = 'pending';

-- Perfil força troca de senha no primeiro login (fluxo de senha temporária, Fase 2).
alter table public.profiles
  add column if not exists must_change_password boolean not null default false;
