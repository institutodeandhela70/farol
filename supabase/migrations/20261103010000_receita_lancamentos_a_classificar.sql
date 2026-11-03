-- Complemento da 20261103000000: receita_lancamentos_v também expõe a marca
-- a_classificar (usada pelo detalhamento da Receita).
create or replace view public.receita_lancamentos_v as
 SELECT v.workspace_id,
    v.integration_id,
    v.iuli_id,
    v.empresa,
    v.cliente,
    v.categoria,
    v.produto,
    v.tratamento,
    v.competencia,
    v.pagamento,
    v.due_date,
        CASE
            WHEN v.situacao = 'recebido'::text THEN 'recebido'::text
            ELSE 'a_receber'::text
        END AS situacao,
    v.valor_caixa AS valor,
    l.hubspot_id,
    l.dia_ganho,
    l.pipeline_kind,
    l.dealname,
        CASE
            WHEN l.hubspot_id IS NULL THEN 'sem_negocio'::text
            WHEN date_trunc('month'::text, l.dia_ganho::timestamp without time zone) = date_trunc('month'::text, v.competencia::timestamp without time zone) THEN 'mes'::text
            ELSE 'outros'::text
        END AS origem,
    v.a_classificar
   FROM caixa_lancamentos_v v
     LEFT JOIN receita_links l ON l.integration_id = v.integration_id AND l.iuli_id = v.iuli_id
  WHERE v.competencia IS NOT NULL;
