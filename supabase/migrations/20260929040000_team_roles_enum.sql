-- Papéis de negócio para a Fase 1 de gestão de equipe: ADMIN, GERENTE, VENDEDOR.
-- 'owner' continua existindo (quem criou o workspace) mas não é mais oferecido
-- como opção atribuível na UI — só admin/manager/vendedor aparecem lá.
-- Precisa estar em sua própria migration: um valor de enum recém-criado não
-- pode ser usado (ex.: em UPDATE) na mesma transação em que foi adicionado.
alter type public.workspace_role add value if not exists 'manager';
alter type public.workspace_role add value if not exists 'vendedor';
