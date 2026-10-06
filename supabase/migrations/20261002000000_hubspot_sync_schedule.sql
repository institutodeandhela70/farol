-- HubSpot: além da atualização diária das 03h (farol-daily-sync, horário de Brasília),
-- roda também às 13h, 17h e 20h (Brasília) — 16h, 20h e 23h UTC, que é o fuso do pg_cron.
-- Só o HubSpot: Asaas e TMB continuam no ciclo diário.
create or replace function public.trigger_hubspot_sync()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_internal_token text;
  v_function_base_url text;
  v_row record;
begin
  select decrypted_secret into v_internal_token from vault.decrypted_secrets where name = 'farol_internal_token' limit 1;
  select decrypted_secret into v_function_base_url from vault.decrypted_secrets where name = 'edge_functions_base_url' limit 1;

  if v_internal_token is null or v_function_base_url is null then
    raise notice 'trigger_hubspot_sync: faltando segredo no Vault — abortando.';
    return;
  end if;

  for v_row in
    select id from public.integrations
    where provider = 'hubspot' and status <> 'disconnected' and sync_enabled = true
  loop
    perform net.http_post(
      url := v_function_base_url || '/functions/v1/sync-hubspot',
      headers := jsonb_build_object('Authorization', 'Bearer ' || v_internal_token, 'Content-Type', 'application/json'),
      body := jsonb_build_object('integration_id', v_row.id)
    );
  end loop;
end;
$$;
revoke all on function public.trigger_hubspot_sync() from public, anon, authenticated;

select cron.unschedule('farol-hubspot-sync') where exists (select 1 from cron.job where jobname = 'farol-hubspot-sync');
select cron.schedule('farol-hubspot-sync', '0 16,20,23 * * *', $$ select public.trigger_hubspot_sync(); $$);
