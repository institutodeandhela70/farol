-- Vendas: índice parcial dos negócios ganhos (a view de vendas filtra por
-- workspace + pipeline + data do ganho) — a dedupe consulta essa lista por negócio.
create index if not exists hubspot_deals_won_idx
  on public.hubspot_deals (workspace_id, pipeline, closedate)
  where is_closed_won and closedate is not null;
