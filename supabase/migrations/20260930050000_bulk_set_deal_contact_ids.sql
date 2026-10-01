-- Atualiza contact_ids de vários negócios numa única ida ao banco (usado pelo
-- backfill-hubspot-deal-contacts — 100 updates individuais por lote seria lento
-- demais pros ~39 mil negócios existentes).
create or replace function public.bulk_set_deal_contact_ids(p_workspace_id uuid, p_updates jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  update public.hubspot_deals d
  set contact_ids = u.contact_ids
  from jsonb_to_recordset(p_updates) as u(id uuid, contact_ids text[])
  where d.id = u.id and d.workspace_id = p_workspace_id;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- security definer + sem checagem de membership — só a Edge Function (service
-- role) pode chamar isso. Sem isso, qualquer usuário autenticado conseguiria
-- reescrever contact_ids de negócios de QUALQUER workspace via RPC direta.
revoke all on function public.bulk_set_deal_contact_ids(uuid, jsonb) from public, anon, authenticated;
