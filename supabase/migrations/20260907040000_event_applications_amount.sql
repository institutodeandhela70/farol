-- Fase 5: valor fechado na negociação. Não dá pra derivar isso de um preço
-- fixo por produto — a ficha em papel já mostrava parcelamento, exceções
-- autorizadas ("Autorizado pela Nicoly") e entrada+restante negociados caso a
-- caso, então quem fecha a venda digita o valor de verdade.
alter table public.event_applications add column if not exists amount numeric(14, 2);
