-- Módulo de Eventos (Fase 3): cadastro externo de cortesia — link público,
-- sem login, que qualquer pessoa preenche. Primeira policy `insert to anon`
-- do projeto (antes só existia `select to anon` pra convite de workspace,
-- ver 20260824203017). Escopo apertado: só aceita a forma exata de uma
-- submissão de cadastro (origin fixo, sempre nasce pendente), e só pra
-- evento ativo cujo workspace_id bate com o do evento (evita escrita
-- cross-tenant mesmo que alguém falsifique o payload).
drop policy if exists "event_participants_insert_anon_signup" on public.event_participants;
create policy "event_participants_insert_anon_signup"
  on public.event_participants for insert
  to anon
  with check (
    origin = 'signup_form'
    and approval_status = 'pendente'
    and exists (
      select 1 from public.events e
      where e.id = event_participants.event_id
        and e.status = 'ativo'
        and e.signup_form_slug is not null
        and e.workspace_id = event_participants.workspace_id
    )
  );

-- Lookup público do evento pelo slug do link de cadastro — não expõe a
-- tabela events inteira pro anon (tem hubspot_pipeline_id, sales_form_slug
-- etc.), só o mínimo que a página de cadastro precisa mostrar/gravar.
create or replace function public.get_public_event_by_signup_slug(p_slug text)
returns table (id uuid, workspace_id uuid, name text)
language sql
stable
security definer
set search_path = public
as $$
  select id, workspace_id, name
  from public.events
  where signup_form_slug = p_slug and status = 'ativo';
$$;
