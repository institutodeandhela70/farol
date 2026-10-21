-- Meta (Facebook app: Meta Ads + Instagram) como mais um provider de integração.
-- Precisa estar em sua própria migration: um valor de enum recém-criado não
-- pode ser usado na mesma transação em que foi adicionado.
alter type public.integration_provider add value if not exists 'meta';
