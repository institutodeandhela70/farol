-- IULI — notas negadas sem data.
--
-- A IULI não grava criada_em nas notas negadas (conferido em 30/09/2026: 1.650
-- na Instituto, 184 na Memorável). Como o Farol busca notas por janela de
-- data, elas nunca apareciam. Sem filtro de data, a IULI devolve só as 100
-- mais recentes (sem paginação) — sync-iuli-records (tarefa invoices:undated)
-- guarda essas 100 de cada empresa; a contagem exata vem do por_status do
-- snapshot invoices:all.
--
-- Esta visão liga cada negada à venda que tentou faturar (venda_id), pra dar
-- uma data (a da venda) e o cliente.

create or replace view public.iuli_invoices_undated_v with (security_invoker = true) as
select
  n.integration_id,
  n.iuli_id,
  n.workspace_id,
  i.label as empresa,
  n.valor,
  n.status,
  n.detalhe_status,
  n.venda_id,
  s.competencia as venda_em,
  s.cliente,
  n.synced_at
from public.iuli_invoices n
join public.integrations i on i.id = n.integration_id
left join public.iuli_sales s on s.integration_id = n.integration_id and s.iuli_id = n.venda_id
where n.criada_em is null
  and n.removed_at is null;

grant select on public.iuli_invoices_undated_v to authenticated;
