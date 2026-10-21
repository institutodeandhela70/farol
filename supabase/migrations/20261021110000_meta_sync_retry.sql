-- Meta sync: depois de bater o limite de uso da Graph API (code 17) a função para e
-- deixa o cursor salvo. Em vez de esperar o próximo ciclo de 3h, o cron passa a
-- checar a cada 15 min e só dispara quando há carga pendente (cursor em andamento)
-- ou quando o último ciclo completo tem mais de 3h.
create or replace function public.trigger_meta_sync()
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
    raise notice 'trigger_meta_sync: faltando segredo no Vault — abortando.';
    return;
  end if;

  for v_row in
    select i.id
    from public.integrations i
    where i.provider = 'meta' and i.status <> 'disconnected' and i.sync_enabled = true
      and (
        exists (
          select 1 from public.meta_sync_state s
          where s.integration_id = i.id and (s.cursor_date is not null or s.cycle_started_at is not null)
        )
        or not exists (
          select 1 from public.meta_sync_state s
          where s.integration_id = i.id and s.completed_at > now() - interval '3 hours'
        )
      )
  loop
    perform net.http_post(
      url := v_function_base_url || '/functions/v1/sync-meta-ads',
      headers := jsonb_build_object('Authorization', 'Bearer ' || v_internal_token, 'Content-Type', 'application/json'),
      body := jsonb_build_object('integration_id', v_row.id, 'background', true)
    );
  end loop;
end;
$$;
revoke all on function public.trigger_meta_sync() from public, anon, authenticated;

select cron.unschedule('farol-meta-sync') where exists (select 1 from cron.job where jobname = 'farol-meta-sync');
select cron.schedule('farol-meta-sync', '*/15 * * * *', $$ select public.trigger_meta_sync(); $$);
