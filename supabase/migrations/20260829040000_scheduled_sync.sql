-- Sincronização automática diária (Asaas + HubSpot), respeitando o interruptor
-- sync_enabled de cada integração. A credencial (service role key) fica guardada
-- no Vault do Supabase — nunca em texto puro numa migração.
create extension if not exists pg_cron;
create extension if not exists pg_net;

create or replace function public.trigger_scheduled_syncs()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_service_role_key text;
  v_function_base_url text;
  v_row record;
begin
  select decrypted_secret into v_service_role_key
  from vault.decrypted_secrets
  where name = 'service_role_key'
  limit 1;

  select decrypted_secret into v_function_base_url
  from vault.decrypted_secrets
  where name = 'edge_functions_base_url'
  limit 1;

  if v_service_role_key is null or v_function_base_url is null then
    raise notice 'trigger_scheduled_syncs: faltando segredo no Vault (service_role_key ou edge_functions_base_url) — abortando.';
    return;
  end if;

  for v_row in
    select id, provider
    from public.integrations
    where provider in ('asaas', 'hubspot')
      and status <> 'error'
      and sync_enabled = true
  loop
    perform net.http_post(
      url := v_function_base_url || '/functions/v1/sync-' || v_row.provider,
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || v_service_role_key,
        'Content-Type', 'application/json'
      ),
      body := jsonb_build_object('integration_id', v_row.id)
    );
  end loop;
end;
$$;

select cron.schedule(
  'farol-daily-sync',
  '0 6 * * *',
  $$ select public.trigger_scheduled_syncs(); $$
);
