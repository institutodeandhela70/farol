-- Ritmo das sincronizações da IULI.
--
-- Na carga inicial a IULI bloqueou por 25 min depois de ~550 chamadas em ~45
-- min (cota não documentada). As duas funções agora têm teto de 30 chamadas
-- por execução e ficam pausadas quando a IULI pede espera longa. Aqui os
-- horários passam a não se sobrepor:
--   farol-iuli-sync          (totais)    :00 :15 :30 :45
--   farol-iuli-records-sync  (registros) :02 :12 :22 :32 :42 :52
-- = até ~180 chamadas/h de registros + as poucas de totais.

select cron.unschedule('farol-iuli-records-sync')
where exists (select 1 from cron.job where jobname = 'farol-iuli-records-sync');

select cron.schedule(
  'farol-iuli-records-sync',
  '2,12,22,32,42,52 * * * *',
  $$ select public.trigger_iuli_records_sync(); $$
);

select cron.unschedule('farol-iuli-sync')
where exists (select 1 from cron.job where jobname = 'farol-iuli-sync');

select cron.schedule(
  'farol-iuli-sync',
  '*/15 * * * *',
  $$ select public.trigger_iuli_sync(); $$
);
