-- Adiciona a TMB na lista de providers sincronizados pelo cron diário
-- (farol-daily-sync, já criado em 20260829040000_scheduled_sync.sql). O
-- FAROL_INTERNAL_TOKEN/edge_functions_base_url no Vault já existem — não
-- precisa recriar nada além da lista de providers.
create or replace function public.trigger_scheduled_syncs()
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
  select decrypted_secret into v_internal_token
  from vault.decrypted_secrets
  where name = 'farol_internal_token'
  limit 1;

  select decrypted_secret into v_function_base_url
  from vault.decrypted_secrets
  where name = 'edge_functions_base_url'
  limit 1;

  if v_internal_token is null or v_function_base_url is null then
    raise notice 'trigger_scheduled_syncs: faltando segredo no Vault (farol_internal_token ou edge_functions_base_url) — abortando.';
    return;
  end if;

  for v_row in
    select id, provider
    from public.integrations
    where provider in ('asaas', 'hubspot', 'tmb')
      and status <> 'error'
      and sync_enabled = true
  loop
    perform net.http_post(
      url := v_function_base_url || '/functions/v1/sync-' || v_row.provider,
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || v_internal_token,
        'Content-Type', 'application/json'
      ),
      body := jsonb_build_object('integration_id', v_row.id)
    );
  end loop;
end;
$$;
