# Vendas · Receita · Caixa — plano por fases

> Documento vivo. Atualizado a cada fase concluída (status, o que foi feito, decisões, pendências).
> Criado em 2026-09-30. Dono: Raffa Nunes. Execução: Eva (Claude Code).

## Status geral

| Fase | Nome | Status |
|---|---|---|
| 0 | Diagnóstico da base | ✅ Concluída (2026-09-30) |
| 1 | Base + Vendas (HubSpot) | ✅ Construída na dev (aguardando sua revisão) |
| 2 | Sincronização IULI `list_transactions` (categoria) + hash CPF | 🟡 Implementada na dev; setembro/2026 carregado, histórico em andamento |
| 3 | De-para categoria IULI → produto Farol (configuração) | ✅ Construída na dev (aguardando sua revisão das categorias) |
| 4 | Caixa | ✅ Construída na dev (aguardando sua revisão) |
| 5 | Receita | ✅ Construída na dev (aguardando sua revisão) |
| 6 | Visão Geral + fechamento do menu | ✅ Construída na dev (aguardando sua revisão) |

Regra de trabalho: **cada fase é apresentada e aprovada separadamente** antes da próxima. Antes de travar o visual (Fase 1), apresentar 2–3 opções de mockup.

---

## 1. Definições aprovadas

### Vendas
- Fonte: HubSpot, negócios **ganhos** (`is_closed_won`), data = **`closedate`**.
- **High ticket = pipeline "Pipeline de Contratos"**: conta todos os negócios ganhos, separados em:
  - **Os 6**: MI, IPM, Dynastia, Inspiratori, PI, Dubai (ver tabela de produtos abaixo).
  - **Fora dos 6**: aparecem num **painel próprio, informativo, que NÃO entra na soma** do dashboard (não deveriam estar nessa pipeline; serve para corrigir na origem).
- **Demais vendas = pipeline "Vendas Hubla & TMB"**, sem duplicar o que já está em Contratos.
  - Regra de deduplicação (interpretação das respostas de 2026-09-30): um negócio da Hubla & TMB **só sai da soma se duplica um negócio ganho de Contratos** (mesmo cliente e mesmo produto dos 6). MI/IPM/etc. vendidos por Hubla/TMB **sem** negócio correspondente em Contratos **contam**. Dubai (10 negócios ganhos na Hubla & TMB, 0 em Contratos) **fica na soma**.
  - A taxa de duplicidade é medida e apresentada na Fase 1 para confirmação antes de travar a regra.
- **Combo** (ex.: "Combo: II + IPM") conta **dentro dos 6**, como linha própria (valor não é dividido).
- Outras pipelines (Direto, Agendamento, Distrato, Lançamento, MXP - GD, IPL, etc.) **não entram**, como hoje.

### Receita
- Tudo que **entrou na IULI** = lançamento de receita **baixado** (`valor_pago`, na **data de pagamento**).
- Só conta lançamento cuja **categoria da IULI é de produto** (categoria = nome do produto, grupo DRE "RECEITA BRUTA OPERACIONAL"), mapeada pelo **de-para categoria → produto Farol**.
- Conta mesmo **sem negócio vinculado** no HubSpot (aparece como "receita de produto sem negócio vinculado").
- Quando há negócio vinculado, usa a **data do ganho** do negócio para separar:
  - **Receita de vendas do mês** (ganho no mesmo mês da entrada);
  - **Receita de vendas de outros meses** (ganho em mês anterior) — com **matriz de safra** (mês da entrada × mês da venda).
- **Fora da soma** (mostrado à parte, com valor):
  - `RECEITA A CLASSIFICAR` → bloco **"precisa categorizar"** (cobrar o fechamento na IULI);
  - `Outros Produtos` (decisão 2026-09-30);
  - categorias não operacionais / financeiras (empréstimos, patrocínio, aporte, reserva, rendimentos, reembolso etc.), conforme o grupo DRE.

### Caixa
- Só IULI, pela **data de vencimento** (`due_date`): recebido, a vencer, vencido.
- Mesmo universo da Receita: **só categorias de produto**; `RECEITA A CLASSIFICAR`, `Outros Produtos` e não operacionais ficam à parte.
- É caixa de **entradas**. Contas a pagar/saldo não estão liberados no token.

### Filtros (todas as telas, na URL)
- Período: **mês** (qualquer mês), **últimos 7 dias**, **mês atual**, **personalizado (de/até)**.
- Empresa IULI: **consolidado Memorável + Instituto Deandhela** (padrão) ou cada uma; intercompany fora por padrão (regra já existente).
- Extras: produto, vendedor (Vendas).
- Fuso: datas do HubSpot em **America/Sao_Paulo**; datas de pagamento/vencimento da IULI já são `date`.

### Convenções do projeto
- Cada número com ícone **"i"** de origem do campo (dicionário em arquivo próprio, mantido em sincronia com as funções SQL).
- Funções SQL `security invoker`, testadas sob RLS; migrations versionadas; não mexer em arquivos já modificados sem necessidade (exceto o menu).

---

## 2. Os 6 produtos e o que fica fora (Pipeline de Contratos, ganhos — dados de 2026-09-30)

Produto do negócio em **Contratos** = propriedade `produto_de_interesse`. Produto do negócio em **Hubla & TMB** = propriedade `produtos` (8.345 de 8.351 preenchidos).

| Grupo | Valores de `produto_de_interesse` | Negócios | Valor |
|---|---|---|---|
| MI | Imperium · Mentoria Imperium Renovação · **Mentoria Millions** | 418 (+2) | R$ 22,68 mi (+R$ 0,16 mi) |
| IPM | Imersão Palcos Milionários | 636 | R$ 9,06 mi |
| Dynastia | Dynastia · Dynastia Renovação | 16 | R$ 1,13 mi |
| Inspiratori | Inspiratori · Mentoria Inspiratori · **Inspiratori Online** | 74 (+9) | R$ 0,75 mi (+R$ 9 mil) |
| PI | [PI] Palestrante Irresistível | 13 | R$ 0,54 mi |
| Dubai | [DXP] Dubai Experience | 0 ganhos em Contratos (10 abertos) — 10 ganhos na Hubla & TMB (R$ 231 mil) | — |
| **Fora dos 6** (painel informativo) | Vivendo de Palestra/VPO, Do Zero aos Palcos, MXP (todas), Imersão Eventos Milionários, Imersão/Workshop Palestrante Lucrativo, Acesso estendido, Análise/Consultoria de Palestra, [AP] Agência de Palestrante, vazios | ~692 | ~R$ 1,94 mi |

Combos (ex.: "Combo: II + IPM", "Combo: IPM + II") → dentro dos 6, linha própria.

---

## 3. Achados da Fase 0 (base de dev)

- HubSpot e IULI estão no workspace "Raffa Nunes". IULI tem 2 integrações: Instituto Deandhela e Memorável.
- Negócios da Hubla & TMB: 8.351 ganhos, nome = cliente (`[HUBLA] Fulano`), sem contato associado; produto vem de `produtos`.
- Hubla/TMB vendem MI e IPM também (592 MI e 555 IPM na Hubla) → origem da duplicidade com Contratos.
- IULI, em 2026 (jan–set): R$ 16,46 mi recebidos em títulos; ~R$ 5,7 mi **não são venda** (empréstimo, SISPAG/PIX entre empresas, patrocínio, reserva, "apenas DFC").
- `get_accounts_receivable` **não traz categoria**. A categoria vem em **`list_transactions`** (liberado nas duas empresas em 2026-09-30): `id` = id do título a receber, + `categoria_id`, `categoria`, `venda_id`, `contraparte`, `conta_id`, `conciliado`, dados de NF.
- `list_categories` (plano de contas, 238 categorias, com grupo DRE e categoria pai) também liberado.
- Amostra de setembro/2026: Instituto tem ~27% do valor em `RECEITA A CLASSIFICAR` e R$ 315 mil em `Empréstimos Tomados`; Memorável usa `Outros Produtos`, `Combo: II + IPM`, `MXP Experience`, `[IPL]`, `[DP100K]`, `Reserva a Receber`.
- Limites da IULI: 1 consulta por vez por empresa, ~200 chamadas/hora sustentáveis (ver memória `reference-iuli-mcp`).

---

## 4. Fases

### Fase 0 — Diagnóstico ✅
Feito em 2026-09-30 (somente leitura na base de dev e 10 chamadas de leitura na IULI). Resultado: seções 2 e 3 deste documento.

### Fase 1 — Base + Vendas
**Objetivo:** menu novo, filtros, tabela de produtos e a tela de Vendas (só HubSpot).
1. Mockups (2–3 opções de visual, incl. uma com o visual Comercial/IULI) → Raffa escolhe.
2. Migration: tabela **`product_catalog`** (produto Farol, grupo, `conta_nos_6`, ordem) e **`hubspot_product_map`** (valor de `produto_de_interesse` / `produtos` → produto Farol). Carga inicial com os 6 + fora dos 6 + combos; tela simples de edição.
3. RPCs `sales_*` (resumo, por período, por produto, por vendedor, lista de negócios, **painel "fora dos 6"**), com filtros de data e empresa/produto/vendedor.
4. Regra de deduplicação Hubla & TMB × Contratos: medir a taxa de duplicidade e **apresentar ao Raffa** (quantos negócios saem, quais) antes de fechar.
5. Menu/rotas novas (grupo próprio), componente de filtros de período (mês / 7 dias / mês atual / personalizado) na URL.
6. Tela **Vendas**: KPIs (total, High ticket × Demais, nº de negócios, ticket médio); gráficos: evolução diária/mensal empilhada, ranking por produto, por vendedor, pizza/barras High ticket × Demais; tabela de negócios (abre o negócio); painel "Produtos fora dos 6"; bloco "sem produto identificado".
7. Dicionário de origens ("i") e atualização da memória/documento.

**Entrega:** tela de Vendas funcionando em dev. **Critério:** totais do mês conferem com consulta direta ao HubSpot no banco; dedupe aprovada.

### Fase 2 — Sincronização `list_transactions` (categoria) + hash CPF
**Objetivo:** ter a categoria de cada lançamento de receita no nosso banco.
- Migration: colunas em `iuli_receivables` (`categoria_id`, `categoria`, `venda_id`, `contraparte`, `conta_id`, `conciliado`, `doc_hash`) e tabela **`iuli_categories`** (plano de contas com grupo DRE, pai, nível, tipo).
- `sync-iuli-records`: nova tarefa `transactions` (type=receita), paginada (100/página), respeitando os limites da IULI; cron já existente.
- **Precisamos buscar de novo na IULI?** Sim, mas só o necessário: os títulos já estão no banco e o `id` bate, então a busca **apenas preenche categoria** (e `venda_id`/contraparte) nos registros existentes; não recarrega nada do zero.
  - Escopo da carga: receitas **baixadas desde 2025-01** e **todas as em aberto** (Caixa). Histórico anterior, sob demanda. Estimativa: ~60–70% das ~42 mil receitas ≈ 250–300 chamadas ≈ **algumas horas em segundo plano**, sem travar as telas (elas usam o que já estiver carregado).
  - Continuação incremental: janela recente reprocessada **a cada hora**; lançamentos **em aberto e "a classificar"** reconferidos **diariamente** (a categoria pode ser corrigida depois); conferência de consistência contra totais (`soma_valores_pagos`).
- **Hash do CPF** (aprovado): guardar apenas um **HMAC-SHA256 com segredo do servidor** (não SHA simples — CPF é fácil de "quebrar" por tentativa). Usado como chave secundária para ligar título ↔ cliente Hubla/TMB/HubSpot (`cpf`). CPF em claro continua **sem ser armazenado**.
- Dicionário de origens da IULI atualizado.

**Entrega:** base com categoria em ≥ 99% dos lançamentos de receita do escopo; relatório de cobertura (valor por categoria). **Critério:** soma por mês de `valor_pago` confere com `soma_valores_pagos` da IULI.

### Fase 3 — De-para categoria IULI → produto Farol (configuração)
- Tabela **`iuli_category_map`** (categoria → produto Farol, e `tratamento`: `soma` | `fora_outros_produtos` | `a_classificar` | `nao_operacional`), pré-preenchida pelo nome da categoria e pelo grupo DRE.
- Tela de configuração para o Raffa revisar (mostra valor recebido por categoria para facilitar a decisão).
- Pré-regras já decididas: `RECEITA A CLASSIFICAR` = a_classificar; `Outros Produtos` = fora; Combo = dentro dos 6; Mentoria Millions = MI; Renovação Imperium = MI (a confirmar na tela); Inspiratori Online = Inspiratori.

### Fase 4 — Caixa
- Universo: receitas com categoria de produto (de-para), por **data de vencimento**; recebido / a vencer / vencido.
- Telas e gráficos: KPIs (previsto, recebido, a vencer, vencido), entradas por dia/semana/mês empilhadas por situação, linha de acumulado, envelhecimento do vencido, por produto, top clientes; painel à parte **"fora da soma"** (a classificar, Outros Produtos, não operacional).
- Filtros: período, empresa (consolidado/cada uma), produto.

### Fase 5 — Receita
- Universo: receitas baixadas com categoria de produto, pela **data de pagamento**.
- Vínculo com negócio do HubSpot (para data do ganho), em cascata: `venda_id` → venda IULI → `external_id` → Hubla/TMB → negócio; hash do CPF; nome do cliente + produto + proximidade de data (Contratos). Sem vínculo: conta como **"produto sem negócio vinculado"**.
- Telas e gráficos: KPIs (total, vendas do mês, vendas de outros meses, sem negócio), barras empilhadas por período, **matriz de safra** (entrada × mês da venda), por produto, tabela de lançamentos com o negócio vinculado; painel "precisa categorizar" (a classificar, com valor e lista); tela **Conciliação** (sem vínculo + vínculo manual).
- Mostra também Vendas × Receita no mesmo período (o que vendi × o que entrou).

### Fase 6 — Visão Geral + fechamento
- Visão Geral: três KPIs lado a lado (Vendas, Receita, Caixa), ponte vendido → entrou → a entrar, barras Vendas × Receita por mês.
- Permissões do menu, dicionário completo de origens, revisão de desempenho, documentação final, publicação (dev → prod só com aprovação).

---

## 5. Registro de decisões

| Data | Decisão |
|---|---|
| 2026-09-30 | Vendas por `closedate`; conta tudo de Contratos, separando os 6 × fora dos 6 (fora = painel informativo, fora da soma). |
| 2026-09-30 | Inspiratori Online → Inspiratori; Mentoria Millions → MI. |
| 2026-09-30 | Consolidar Memorável + Instituto Deandhela, com filtro por empresa. |
| 2026-09-30 | Receita só com categoria de produto; conta mesmo sem negócio vinculado; `RECEITA A CLASSIFICAR` fora da soma com aviso de categorizar; `Outros Produtos` fora; Combo dentro dos 6. |
| 2026-09-30 | Caixa = mesmo universo da Receita, por vencimento. |
| 2026-09-30 | Dubai fica na soma; MI/IPM da Hubla/TMB sem negócio em Contratos contam (exclui-se só a duplicidade). |
| 2026-09-30 | Guardar hash do CPF (HMAC) dos títulos IULI. |
| 2026-09-30 | Criar configuração de-para categoria IULI → produto Farol. |

## 6. Pendências

- Confirmar (na Fase 1) a regra de deduplicação Hubla & TMB × Contratos com os números reais.
- Confirmar na tela da Fase 3 os destinos de `Mentoria`, `Renovação Imperium`, `Workshop/Palestra/Eventos Memorável`, `Reserva a Receber` e demais.
- Conferir se a Memorável tem mais categorias "a classificar" em outros meses.

## 7. Histórico de atualizações

- 2026-09-30 — **Detalhamento + centavos + base de dados (dev).** Decisões do Raffa: CPF/CNPJ completo; remover o filtro "sem operações entre empresas" (removido da interface; as consultas não excluem mais nada); a tabela do fim respeita os filtros da tela; exportação só CSV. **Centavos:** KPIs, rankings, tabelas e dicas dos gráficos mostram o valor completo (`src/lib/money.ts`); só o eixo dos gráficos é abreviado. **Detalhamento:** migration `20260930260000_detalhe_functions.sql` (`vendas_detalhe`, `receita_detalhe`, `caixa_detalhe`: mesmos filtros dos resumos, paginação/ordenação/pesquisa no banco, `total_count`/`total_sum`; o vínculo entrada↔negócio passou a cobrir também títulos em aberto). Componentes: `DetailTable` (pesquisa, filtros de data/produto/vendedor/pipeline/origem/situação/categoria/empresa/valor, colunas à escolha lembradas no navegador, ordenação, paginação de 50, exportar CSV em `;` com BOM e vírgula decimal), `DrillContext` (painel lateral ao clicar), `ResultCharts` (`KpiTile`, `ClickBarChart`, `ClickCashChart`, `ClickBarList`, `SplitBar` clicáveis). Cada KPI, barra, fatia, ranking, célula da safra, faixa do vencido, painel "fora da soma" e linha da ponte abre as linhas que o formam. As telas Vendas, Receita, Caixa e Visão Geral (abas Vendas/Receita/Caixa) têm a seção "Base de dados" no fim. Conferido em setembro/2026: soma das linhas = KPI ao centavo em todas as telas (Vendas R$ 3.505.309,94 / 794; Receita R$ 754.130,99 / 792; Caixa R$ 1.012.871,47 / 878). **Cobertura dos dados de cliente (set/2026):** CPF/CNPJ em 93% das vendas, 87% das entradas e 84% dos títulos do caixa; e-mail e telefone em 37% das vendas (60% em Contratos), 42% das entradas e 45% do caixa; vendedor nas vendas de Contratos (31/53), quase nunca na Hubla & TMB (negócios sem dono no HubSpot). Pendente: link "abrir no HubSpot" (falta o número do portal).

- 2026-09-30 — **Fase 6 (Visão Geral) construída (dev) — plano completo na dev.** Tela `resultado/visao-geral` (`ResultadoVisaoGeral.tsx`), primeira do menu e destino de `/resultado`. Mostra: os 3 KPIs lado a lado (Vendas, Receita, Caixa previsto) com link para cada detalhe; a ponte "do vendido ao que entra" (vendido → entrou de vendas do mês → de outros meses → sem negócio → a receber); gráfico Vendas × Receita × Caixa dos 12 meses até a data final; tabela por produto (vendido, receita, caixa); e "O que precisa de atenção" (fora dos 6, sem produto, duplicidade, a classificar na receita e no caixa, sem negócio vinculado, vencido antigo, sem categoria carregada, categorias a revisar). Filtros: período, empresa, sem operações entre empresas. Migration `20260930250000` (permissão do menu). Setembro/2026: vendido R$ 3,51 mi · entrou R$ 754 mil (R$ 246 mil de vendas do mês = 7% do vendido) · caixa previsto R$ 1,01 mi.

## 7b. Regra corrigida em 2026-10-05: a venda dos 6 é só a de Contratos

O negócio da pipeline **Vendas Hubla & TMB** é criado a cada **pagamento** (closedate = createdate = momento do webhook da Hubla); cada parcela vira um negócio. Para os produtos dos 6, **a venda e a data do ganho são as da pipeline de Contratos** (decisão do Raffa). Migration `20261005000000_sales_contratos_only.sql`: coluna `sales_product_catalog.count_hubla` (padrão desligada; ligada só para Dubai e Combo, que não têm ganho em Contratos; editável em Produtos); os negócios da Hubla & TMB dos 6 saem das Vendas (a flag `duplicado` passou a significar "fora das Vendas"; Dubai/Combo seguem a regra de duplicidade com Contratos); o vínculo entrada↔negócio (`receita_refresh_links`) para produto dos 6 só aceita negócio de Contratos, então a data do ganho na Receita/safra é a da venda. Setembro/2026: Vendas R$ 3.083.780,71 (774 negócios) = high ticket R$ 2.896.452,00 (Contratos R$ 2.636.052,00 + Dubai/Combo R$ 260.400,00) + demais R$ 187.328,71; 46 pagamentos da Hubla & TMB dos 6 (R$ 775.543,00) ficam fora das Vendas. Exemplo conferido: Aline Maria Menezes da Silveira (MI) agora liga ao negócio de Contratos ganho em 08/02/2026 (antes pegava o pagamento de 31/08 na Hubla). Telas de Vendas/Produtos/Visão Geral com os textos novos.

## 7c. Receita por competência (2026-10-05)

A Receita deixou de ser "o que entrou na conta (data do pagamento)" e passou a ser a **receita faturada, pela DATA DE COMPETÊNCIA na IULI**, com ou sem baixa: a venda que passou no cartão e já está na IULI conta na data da competência, e o vencimento (quando o dinheiro cai) é o Caixa. Migration `20261005100000_receita_competencia.sql`: `competencia` em `caixa_lancamentos_v`; `receita_lancamentos_v` com todos os status e situação `recebido`/`a_receber`; `receita_summary/series/safra/fora/produtos/detalhe` por competência (o detalhe ganhou `p_situacoes`); `receita_refresh_links` mede a proximidade pela competência; `receita_titulos` removida. Tela: KPIs Receita faturada, Já recebido (com baixa) e A receber (sem baixa), além de vendas do mês / outros meses / sem negócio; painel Já recebido × a receber; safra = mês da competência × mês da venda; tabela com colunas Competência e Situação. Setembro/2026: 721 títulos, R$ 1.019.229,81 (recebido R$ 799.533,99 + a receber R$ 219.695,82; do mês R$ 484.283,51, outros meses R$ 143.086,61, sem negócio R$ 391.859,69). Exemplo: MARCOS PAULO CHAVES PINHEIRO aparece em 30/09/2026, "a receber", R$ 27.303,72 (vence 15/10), IPM, sem negócio vinculado (o negócio dele em Contratos está em Aguardando Assinatura, não ganho).

## 7d. Vendas que deveriam estar em Contratos e não foram encontradas lá (2026-10-05)

Painel na tela de Vendas (antes da Base de dados) + função `vendas_faltantes(workspace, de, até)` (migrations `20261005200000` e `20261005210000`; funções `sales_name_match/sales_tokens_in/sales_last_token`; colunas geradas `customer_norm` em `hubla_sales`/`tmb_sales`). Junta as evidências de venda dos produtos dos 6 — pagamentos da Hubla & TMB (negócios ganhos no período) e títulos faturados na IULI (competência no período, sem vínculo com negócio de Contratos) — e lista os clientes sem negócio GANHO de Contratos do mesmo cliente e produto: `nao_existe` ou `nao_ganho` (etapa/valor/vendedor do negócio em Contratos). Nome casado por igualdade, contido ou primeiro+último nome. Valor estimado = maior entre Hubla & TMB e IULI. Totais, filtros, pesquisa e CSV. Setembro/2026: 43 clientes, R$ 622.102,10 estimados (Hubla & TMB R$ 442.297,00 · IULI R$ 257.702,10): 20 não existem em Contratos (R$ 241.900,00) e 23 existem mas não ganhos (R$ 380.202,10).

## 7e. Resultado → Pesquisa (2026-10-06)

Nova tela `resultado/pesquisa` (menu Resultado; permissão `menu.resultado.pesquisa`). Base: títulos da IULI de **categoria de produto** (jan/2025 em diante), **uma linha por título**. Pesquisa por pessoa (nome, e-mail, telefone ou CPF), produto, empresa, situação e vínculo; período por **competência (padrão)**, vencimento, pagamento ou **data do ganho** do negócio de Contratos ligado. Colunas: competência, vencimento, pago em, cliente, e-mail/telefone/CPF, produto/categoria, situação, valor, data do ganho (Contratos), negócio vinculado (etapa, vendedor, como foi ligado), CSV. "Detalhar" abre: título e venda na IULI, Hubla, TMB, vínculo e negócio no HubSpot, contato, outros negócios e outros lançamentos do mesmo cliente. Migration `20261006000000_pesquisa.sql`: `pesquisa_lancamentos`, `pesquisa_lancamento_detalhe`; `receita_links.metodo`; **vínculo mais forte quando o nome não bate**: (2) CPF do cliente na Hubla/TMB = CPF do negócio (`hubspot_deals.cpf_digits`) ou e-mail igual ao do contato do negócio; (3) valor exato do título (ou da venda na IULI) + data até 30 dias, só com um único candidato. Resultado jan/2025–set/2026: +1.047 títulos ligados (611 por CPF, 334 por e-mail, 102 por valor + data). Arquivos: `ResultadoPesquisa.tsx`, `LancamentoDetail.tsx`, `searchData.ts`.

## 8. Checklist para produção (nada disso foi feito em produção)

1. **Aplicar as migrations na ordem** (todas em `supabase/migrations`): `20260930070000` (categoria IULI), `…080000`, `…090000`, `…100000`, `…110000`, `…120000`, `…130000`, `…140000`, `…150000`, `…160000`, `…170000` (Vendas), `…180000`, `…190000` (de-para de categorias), `…200000` (Caixa), `…210000`, `…220000`, `…230000`, `…240000` (Receita), `…250000` (Visão Geral), `…260000` (detalhamento; `20261005000000` (Contratos-only), `20261005100000` (Receita por competência), `20261005200000` e `20261005210000` (vendas que faltam em Contratos), `20261006000000` (Pesquisa; recalcula os vínculos, ~1 min); refaz os vínculos de Receita/Caixa, rodar `receita_refresh_all(date '2025-01-01')` depois). As colunas geradas de `hubspot_deals` reescrevem a tabela (alguns segundos a ~1 min cada).
2. **Secret `IULI_DOC_HASH_KEY`** nas secrets da função (gerar um valor novo para produção; não reutilizar o da dev) e **deploy da função `sync-iuli-records`** (inclui as tarefas de categoria). Invalidar o cache de ferramentas (`integrations.config.tools_checked_at`) ou esperar 6 h.
3. **Conferir o token da IULI em produção**: precisa liberar `list_transactions` e `list_categories` nas duas empresas.
4. **Dados de configuração que NÃO vão na migration** e precisam ser refeitos/conferidos na tela: de-para de categorias (Categorias — a revisão feita na dev), produtos dos 6 e correções (Produtos), janela da dedupe. As migrations já semeiam pipelines (por nome: "Pipeline de Contratos" e "Vendas Hubla & TMB"), os 6 produtos e uma sugestão inicial do de-para.
5. **Aguardar a carga histórica de categoria** (do mês atual para trás até jan/2025) e o primeiro ciclo dos crons `farol-receita-links-*`.
6. **Revisar as pendências de negócio** da seção 6 antes de divulgar os números.

## 8b. Ajustes de integração feitos em 2026-10-02 (aplicar também em produção)

- **HubSpot 4× ao dia** (03h, 13h, 17h e 20h, Brasília): a de 03h segue no `farol-daily-sync`; novo cron `farol-hubspot-sync` (`0 16,20,23 * * *` em UTC) chama `trigger_hubspot_sync()` — migration `20261002000000_hubspot_sync_schedule.sql`.
- **TMB**: `sync-tmb` e `tmb-webhook` não tinham `verify_jwt = false` no `config.toml`, então a plataforma devolvia 401 antes do código rodar (cron nunca sincronizava e o webhook nunca recebeu evento). Adicionado ao `config.toml` e feito deploy das duas funções. O webhook se protege sozinho (`x-tmb-token` × `webhook_secret`); o `sync-tmb`, pelo token interno ou sessão. Recarga completa feita: 437 pedidos (1 novo, de 01/09). Falta conferir no painel da TMB se o webhook aponta para `/functions/v1/tmb-webhook` com o cabeçalho `x-tmb-token`.
- **Asaas (Instituto Deandhela)**: chave inválida (`invalid_access_token`, sandbox) — a verificar pelo Raffa.

## 9. Pendências conhecidas

- Vínculo manual entrada ↔ negócio (a coluna `receita_links.manual` existe, falta a tela).
- Contador `rows_synced` das tarefas `transactions:*` aparece 0 na tela de status (cosmético).
- O filtro "Últimos 7 dias" olha para trás; para o futuro do Caixa use o período personalizado.
- Preferências de menu por perfil: vendedor não vê o grupo Resultado por padrão (gerente vê).

- 2026-09-30 — **Fase 5 (Receita) construída (dev).** Migrations `20260930210000` a `20260930240000`: colunas geradas `dealname_parts` (pessoas do nome do negócio, índice GIN) em `hubspot_deals`; `receita_client_norm`; tabela `receita_links` (entrada da IULI ↔ negócio do HubSpot; coluna `manual` reservada para vínculo manual) atualizada por cron (`farol-receita-links-recent` de hora em hora nos últimos 45 dias; `farol-receita-links-full` diário desde 2025) e botão "Atualizar vínculos" (dono/admin); view `receita_lancamentos_v`; funções `receita_summary/series/safra/fora/titulos/produtos`. Tela `resultado/receita` (`ResultadoReceita.tsx`, `receitaData.ts`). **Regra de vínculo:** nome do cliente da IULI igual ao do negócio (ou a uma das pessoas de um combo "A e B") + mesmo produto; vale o negócio ganho mais próximo da data da entrada (até 45 dias depois). Origem: `mes` (ganho no mesmo mês da entrada) · `outros` (outro mês) · `sem_negocio` (continua contando). **Setembro/2026** (consolidado, sem operações entre empresas): receita R$ 754 mil — de vendas do mês R$ 246 mil (33%), de vendas de outros meses R$ 362 mil (48%), sem negócio vinculado R$ 146 mil (19%). Jan–set/2026: R$ 9,7 mi (do mês R$ 3,96 mi · outros meses R$ 3,80 mi · sem negócio R$ 1,95 mi). Matriz de safra (6 meses até a data final) na tela. **Limitação conhecida:** vínculo manual ainda não tem tela (a lista de conciliação só mostra as entradas sem negócio); casos típicos sem vínculo: comprador pessoa jurídica, nome diferente entre IULI e HubSpot, venda fora das pipelines Contratos e Hubla & TMB.

- 2026-09-30 — **Revisão do de-para + Fase 4 (Caixa) construída (dev).** Revisão das 24 categorias "a revisar" (dados da dev; refazer na tela em outro ambiente): 12 viraram produto/serviço com nome próprio e entram na soma (Consultoria de Palestra, Palestra Presencial, Workshop/Palestra/Eventos, Treinamento, MBA, Mentoria, Low Ticket, Produto Online, Latam, Agência de Palestras, The Tathi's Brazil, Gravações/Modelos/Livros); 9 são receita operacional sem produto e ficam fora da soma como "Outras receitas" (Loja Memorável, Locação Arena, Comissão de Indicação, Royalties (2), Multa por Distrato, Outros Serviços, Outros Eventos, Produtos Físicos); 3 genéricas foram para "a classificar" (Vendas Rede/Cielo/Stripe, Receitas de Produtos, Receitas de Serviços). Resultado: 30 soma · 24 não operacional · 10 outras receitas · 4 a classificar · 0 a revisar. **Caixa:** migration `20260930200000_caixa.sql` (view `caixa_lancamentos_v`; funções `caixa_series/summary/fora/clientes/aging/titulos/produtos`, security definer); tela `resultado/caixa` (`ResultadoCaixa.tsx`, `CashChart.tsx`, `cashData.ts`). Setembro/2026 (consolidado, sem operações entre empresas): previsto R$ 1,01 mi — recebido R$ 794 mil (78%), a vencer R$ 54 mil, vencido R$ 165 mil; fora da soma: R$ 312 mil a classificar, R$ 210 mil não operacional, R$ 10 mil outras receitas. Vencido de hoje (todo o período): R$ 18,5 mi, dos quais R$ 15,5 mi com mais de 1 ano (provável baixa não registrada).

- 2026-09-30 — **Fase 3 construída (dev).** Migrations `20260930180000` e `20260930190000`: tabela `iuli_category_map` (por nome da categoria, igual nas duas empresas; tratamento `soma` / `fora_outros_produtos` / `a_classificar` / `nao_operacional` / `revisar` + produto), `iuli_category_map_seed` (sugestão inicial pelo nome e pelo grupo do DRE), `iuli_category_map_list` (com o recebido e o em aberto por categoria) e `iuli_category_map_refresh`. Tela `resultado/categorias` (`ResultadoCategorias.tsx`). Sugestão inicial para 68 categorias de receita: 18 entram na soma (com produto), 24 não operacionais (DRE), 24 a revisar, 1 a classificar (`RECEITA A CLASSIFICAR`), 1 Outros Produtos. Dos R$ 15,5 mi recebidos já carregados: R$ 9,18 mi entram na soma, R$ 5,52 mi não operacionais (empréstimos, patrocínio etc.), R$ 369 mil a classificar, R$ 204 mil Outros Produtos, R$ 203 mil a revisar.

- 2026-09-30 — **Fase 1 construída (dev).** Menu novo **Resultado** (Vendas, Produtos). Visual escolhido: opção A (Clássico FAROL) com a barra de divisão High ticket × Demais da opção B. Filtros na URL: Mês (qualquer mês), Últimos 7 dias, Mês atual, Personalizado + produto e vendedor. Migrations `20260930080000` a `20260930170000`: `sales_pipeline_roles`, `sales_product_catalog`, `sales_product_overrides`, `sales_settings`; `sales_canon_product()` (padroniza o nome: `produto_de_interesse` em Contratos, `produtos` na Hubla & TMB); views `sales_deals_v`/`sales_deals_x_v` (grupo high / fora_dos_6 / demais + marca de duplicado); funções `sales_summary/series/deals_list/duplicates/options/raw_products` (security definer, checagem de membro); colunas geradas em `hubspot_deals` (`dealname_norm`, `produto_contratos`, `produto_hubla`) e índices. **Dedupe** Hubla & TMB × Contratos: mesmo cliente + mesmo produto dos 6, ganho até 90 dias de diferença (nome igual ou contido no nome do combo de Contratos) — configurável na tela Produtos. Medição histórica (jan/2025–set/2026): 320 negócios / R$ 4,80 mi removidos por duplicidade. Setembro/2026: total R$ 3,51 mi (794 negócios): High ticket R$ 3,32 mi (86), Demais R$ 187 mil (708), 23 removidos por duplicidade (R$ 484 mil), 20 fora dos 6 (R$ 66,8 mil, fora da soma). Desempenho: ~1,3 s por consulta no app. Telas: `src/pages/resultado/ResultadoVendas.tsx` e `ResultadoProdutos.tsx`; dicionário de origens em `src/lib/resultSources.ts`. **Pendente de revisão do Raffa:** regra de dedupe (janela de 90 dias), lista de produtos dos 6, e o painel de 5 negócios da Hubla & TMB sem produto no HubSpot.

- 2026-09-30 — **Fase 2 implementada (dev).** Migration `20260930070000_iuli_transactions_category.sql` (colunas `categoria_id/categoria/venda_id/contraparte/conta_id/conciliado/categoria_synced_at/doc_hash` em `iuli_receivables`; tabela `iuli_categories`; função `iuli_apply_transactions`; view `iuli_receivables_v` com categoria). `sync-iuli-records` ganhou as tarefas `categories:full`, `transactions:recent` (hora), `transactions:open` e `transactions:classify` (dia) e `transactions:backfill` (do mês atual para trás até jan/2025); hash do CPF via HMAC (`IULI_DOC_HASH_KEY`, secret na função). **Resultado:** setembro/2026 100% com categoria (Instituto 103/103, Memorável 883/883); soma dos recebidos do Instituto = R$ 754.424,82, igual a `soma_valores_pagos` da IULI. Plano de contas carregado (238 e 204 categorias). Histórico (jan/2025 em diante) e os títulos em aberto seguem carregando em segundo plano. Observação: a lista de ferramentas liberadas fica em cache de 6h (`integrations.config.tools_checked_at`); foi invalidada manualmente.

- 2026-09-30 — Documento criado com as fases 0–6 e as decisões aprovadas. Fase 0 concluída.
