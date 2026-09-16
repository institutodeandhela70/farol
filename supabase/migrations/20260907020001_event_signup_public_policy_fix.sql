-- Fix: a policy anterior fazia `exists (select 1 from public.events ...)`
-- direto dentro do WITH CHECK — isso roda com o privilégio de quem está
-- inserindo (anon), que não tem SELECT em events (só workspace member tem),
-- então a subquery sempre via vazio e a policy nunca deixava passar nem um
-- insert válido (confirmado via teste com curl puro, sem sessão de usuário:
-- HTTP 401/RLS mesmo com dados corretos). Fix: mover a checagem pra uma
-- função security definer (mesmo padrão de get_public_event_by_signup_slug),
-- que roda com o privilégio de quem criou a função e por isso enxerga
-- events independente da RLS de events.
create or replace function public.event_accepts_public_signup(p_event_id uuid, p_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.events e
    where e.id = p_event_id
      and e.workspace_id = p_workspace_id
      and e.status = 'ativo'
      and e.signup_form_slug is not null
  );
$$;

drop policy if exists "event_participants_insert_anon_signup" on public.event_participants;
create policy "event_participants_insert_anon_signup"
  on public.event_participants for insert
  to anon
  with check (
    origin = 'signup_form'
    and approval_status = 'pendente'
    and public.event_accepts_public_signup(event_id, workspace_id)
  );
