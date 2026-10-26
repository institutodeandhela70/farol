# Análise dos dois dashboards de Meta Ads (referência para o FAROL)

Levantamento feito em 26/10/2026 sobre:

- **IPL Fortaleza** — https://ipl-fortaleza-dashboard.pages.dev/#geral
- **DP100K** — https://vianapatrick15-max.github.io/dp100k-dashboard-light/

Os dois são páginas estáticas (HTML + JS puro, sem framework), hospedadas em Cloudflare Pages e GitHub Pages. Nenhum dos dois consulta a Meta direto: um pipeline externo grava os números num pacote de dados e a página só desenha. Ambos são públicos (qualquer pessoa com o link vê gasto, receita e nomes de anúncios).

---

## 1. DP100K — "Dashboard · Vendas & Tráfego"

**Produto analisado:** desafio de 5 dias com ingresso de entrada (≈ R$ 97), back-end IPM e outras vendas. Ciclo semanal ("turmas").

### Como carrega os dados
- Um único `data.json` (≈ 2,8 MB) em `…/dp100k-fp02-dashboard/data.json`, lido com `fetch` + `?v=timestamp` (sem cache). Fallback: `data.json` local.
- Tudo é calculado no navegador a partir de linhas diárias já agregadas.
- `schema_version`, `updated_at` e `meta` (`date_min`, `date_max`, `default_start`, `default_end`) acompanham o pacote.

### Estrutura do `data.json`
| Chave | Conteúdo |
|---|---|
| `daily` | 1 linha por dia: `d, spend, impr, reach, lclk, lpv, ic, ing_n, ing_rev, ing_renda, ing_mql, ing_meta, ing_meta_rev, ipm_n, ipm_rev, out_n, out_rev` |
| `seg_daily` | o mesmo por funil (`oferta_principal, vsl, quiz, rmkt, nutricao`), sem IPM/outras |
| `funnels` | lista `{key,label}` dos funis |
| `ads_daily` | 1 linha por anúncio/dia: `d, ad, camp, seg, spend, purch, impr, ic, lpv, lclk` (+ `v3, p25, p50, p75, p100` nos de vídeo) |
| `hubla_ads_daily` | vendas da Hubla por anúncio/dia: `d, k (nome do anúncio em minúsculas), ing, renda, mql` |
| `ads_meta` | por anúncio: `status, permalink (Instagram), preview (fb.me), thumb, camp` |
| `turmas` | `{label, inicio, fim}` — semanas (ex.: "Maio/26 - 1") |
| `turma_daily`, `turma_seg_daily` | recorte pronto por turma (e por turma × funil) |

Siglas: `lclk` = cliques no link, `lpv` = visitas na página (landing page view), `ic` = início de checkout (initiate checkout), `ing_*` = ingressos, `ing_meta` = ingressos atribuídos a `utm_source=meta_ads`, `renda/mql` = respondeu pesquisa de renda / renda qualificada.

### Telas
Cabeçalho fixo (logo, "Atualizado em…", intervalo de dados) + abas **Geral · Por turma · Ads** + barra de **Funil** (Todos / Oferta principal / VSL / Quiz / RMKT) que vale para as três abas.

1. **Geral** — filtro de período (data de/até + atalhos Este mês, Mês passado, Últimos 30d, Últimos 7d, Tudo).
   - 8 KPIs: Investimento · Vendas Ingressos · CPA Geral · CPA Meta Ads · Vendas IPM · Outras Vendas · Faturamento · ROAS.
   - Gráfico SVG próprio "Vendas e faturamento por dia": linhas de Ingressos, IPM e Outras (eixo esquerdo, contagem) e Faturamento (eixo direito, R$) com área em degradê, linha-guia e tooltip.
   - Tabela "Métricas de tráfego por dia" (16 colunas) com linha de total.
2. **Por turma** — chips das turmas (padrão: a última), mesmos KPIs, gráfico e tabela, com o recorte da turma vindo pronto do pipeline.
3. **Ads** — grade de cartões de anúncio (até 60), ordenável: Mais vendas · Maior investimento · Melhor CPA · Melhor hook · Melhor hold. Cada cartão: prévia (iframe de embed do Instagram, ou imagem, ou link), ranking, código do AD, status Ativo/Pausado, vendas, investido, CPA, % MQL, impressões, CTR do link, **faixa de retenção de vídeo** (hook, hold e 4 barras 25/50/75/100%) e links para Instagram e Preview Meta.

### Fórmulas
- CPA geral = investimento ÷ ingressos vendidos. CPA Meta = investimento ÷ ingressos com `utm_source=meta_ads`.
- Faturamento = ingressos + IPM + outras. ROAS = faturamento ÷ investimento. Num funil específico mostra só "ROAS front" (IPM e outras só existem no Geral).
- CTR do link = cliques no link ÷ impressões. CPM = investimento ÷ impressões × 1000.
- Conv. página = checkouts ÷ visitas da página. Conv. checkout = vendas ÷ checkouts.
- **Hook** = visualizações de 3 s ÷ impressões. **Hold** = 100 % assistido ÷ visualizações de 3 s. Só aparecem se o anúncio tem pelo menos 30 visualizações de 3 s (piso contra ruído); impressões do hook contam só os dias com coleta de vídeo.
- % MQL de um anúncio = MQL ÷ respondentes de renda (Hubla), casando o anúncio pelo nome.
- Anúncios sem vídeo vão para o fim quando a ordenação é por hook/hold.

### Visual
Tema claro creme (`#f5f3ee`), IBM Plex Sans/Mono, cartões de 18 px de raio, abas em pílula com degradê azul, cores fixas por série (azul ingressos, âmbar IPM, roxo outras, verde faturamento). Responsivo (8 → 4 → 3 → 2 colunas de KPI).

---

## 2. IPL Fortaleza — "Painel da edição" (evento 16 a 18/10)

**Produto analisado:** uma edição presencial com meta de **220 cadeiras** vendidas até 14/10, vendida por três "frentes".

### Como carrega os dados
- O JSON inteiro (≈ 270 KB) está **embutido no HTML** (`const DATA = {…}`); a página só faz 1 requisição. O pipeline regera o arquivo (`gerado_em: 26/10/2026 13:22`).
- Fontes declaradas no rodapé: vendas da **Hubla** via webhook numa planilha; tráfego agregado por anúncio da mesma planilha; imagens e status dos anúncios pela **API da Meta**; captação do "meteórico" pela API da Meta (janela de 7 dias após o clique) e **ActiveCampaign**; perfil e MQL da **pesquisa pós-compra**. "Nenhum dado pessoal entra no painel."

### Estrutura do `DATA`
| Chave | Conteúdo |
|---|---|
| `plano` | `inicio, fim` da captação e `oferta` (abertura do carrinho) |
| `trafego` | 1 linha por dia × campanha × anúncio: `d, c, f (frente), a (AD-NN), s, i, r, k, l, lead` = gasto, impressões, alcance, cliques, visitas, leads do pixel |
| `ads` | por `AD-NN\|TIPO`: `rotulo, frente, ig, nome, adset, campanha, thumb, status` |
| `active` | inscritos do ActiveCampaign: `d, src, a` |
| `vendas` | vendas pagas da Hubla (sem nome do cliente): `d, h, of, v, vl, mp, pc, src, med, camp, term, f, t, a, uf, cid` |
| `edicao` | pacote agregado da edição: `vendas[] (d,h,of,tp,v,mp,pc,fr,cad,src,camp,a)`, `pessoas`, `reembolsos`, `trafego{VDA,MET}`, `criativos{AD-NN:{s,imp,cli,vis}}`, `faturas`, `carrinhos`, `mql`, `meta{cadeiras,ate,desde,evento}` |
| `pesquisa` | respostas da pesquisa pós-compra (cidade, UF, idade, gênero, ocupação, renda…) |
| parâmetros | `mql_piso` (8.001), `mql_alto_piso` (10.001), `pixel_cobertura` (0,5), `kill_cpl` (R$ 35) |

### Abas
**Visão geral · Vendas e retorno** | grupo **Criativos**: Venda direta · Captação | grupo **Meteórico**: Captação Le08 · Público.

1. **Visão geral** — cartão-herói "Cadeiras vendidas" (236 de 220, 107,3 %) com barra, marcador do trilho de hoje e selo "No trilho / Abaixo do trilho"; frase de diagnóstico ("no ritmo dos últimos 7 dias…"); 6 mini-cartões (Faltam, Necessário por dia, Ritmo atual, Projeção, Vendidas hoje, Pessoas); totais por tipo de ingresso (Individual, Duplo, VIP, VIP duplo, Segunda cadeira avulsa); gráfico acumulado (realizado × trilho da meta × projeção); cadeiras por dia empilhadas por frente com linha de "necessário por dia"; tabela dia a dia recolhível.
2. **Vendas e retorno** — KPIs (Receita, Investimento, ROAS da edição, Custo por venda, Ticket médio, Reembolsos, MQL 10k+); barras de investimento × receita por frente; receita por oferta; MQL por frente; vendas e cadeiras por tipo; funil de checkout (faturas geradas → pagas → expiradas → pendentes → carrinhos abandonados); forma de pagamento; tabela por frente.
3. **Criativos · Venda direta** — KPIs, dispersão "investimento × vendas por criativo" com linha de equilíbrio (1 venda a cada ticket médio), grade de cartões ordenável (Vendas, Investimento, CPA, ROAS, Venda/visita) e filtro (Todos, Ativos, Com venda), cada cartão com veredito colorido.
4. **Criativos · Captação** — seletor de período; cartões por criativo (leads, CPL, CTR, CPM, visitas, Página→lead, custo por visita), ordenáveis, filtráveis por Estáticos/Vídeos/Quente.
5. **Captação Le08** — KPIs (investimento, CPL pixel, leads pixel, inscritos Active), investimento e leads por dia, CPL por frente com traço do "kill switch", funil do anúncio ao inscrito (barras em raiz quadrada), bloco "Antecipação".
6. **Público** — perfil dos compradores a partir da pesquisa (renda, idade, ocupação, cenário, desejo, tempo que conhece, gênero, já participou).

### Conceitos e fórmulas
- **Frentes**: `MET` Meteórico (UTM de campanha com `le08`; a venda nasce no grupo), `VDA` Venda direta por anúncios (`utm_source=meta_ads`), `VDD` Venda direta por disparo (broadcast), `OUT` outros. Frente = a da primeira compra paga.
- **Cadeira** = venda paga; ingresso "Duplo" conta 2; reembolso sai.
- **Trilho**: parte do total até o dia anterior ao início do plano e sobe em linha reta até a meta: `passo = (meta − base) / dias`.
- **Ritmo** = média dos 7 dias fechados. **Necessário por dia** = (meta − vendido até ontem) ÷ dias restantes (com hoje). **Projeção** = vendido + ritmo × dias restantes.
- **Veredito do criativo (venda direta)**: CPA ≤ ticket médio → "se paga"; com venda e CPA acima → "CPA > ticket"; sem venda e gasto ≥ 1 ticket → "sem venda" (queima); senão "amostra curta".
- **Criativo na venda direta** = código `[AD-NN]` da `utm_content` da fatura (o pixel não entra).
- **Captação**: CPL pixel = investimento ÷ leads do pixel (o pixel enxerga ~metade do inscrito real); veredito contra o **kill switch** (R$ 35): abaixo = bom, até 1,5× = atenção, acima = crítico, sem lead após gastar o kill = crítico.
- **MQL 10k+** = renda declarada ≥ R$ 10.001 ÷ compradores que responderam à pesquisa; faixa apagada se há menos de 20 respostas.

### Visual
Tema claro neutro (`#f5f5f2`), gráficos SVG feitos à mão, tooltip único, paleta de 3 séries (azul `#2a78d6`, laranja `#eb6834`, verde `#1baf7a` + cinza), selos de status com ícone (bom / atenção / crítico). Hash na URL (`#geral`, `#vendas`…) guarda a aba.

---

## 3. O que cada painel precisa vs. o que o FAROL já tem

| Necessidade | Origem nos painéis | No FAROL (dev) |
|---|---|---|
| Gasto, impressões, alcance, cliques no link, por anúncio/dia | Meta (planilha/API) | ✅ `meta_ad_insights_daily` |
| Visitas na página, início de checkout, compras | Meta (pixel) | ✅ dentro de `actions` (`landing_page_view`, `initiate_checkout`, `purchase`) |
| Visualizações de 3 s (hook) | Meta | ✅ `video_view` |
| Retenção 25/50/75/100 % (hold) | Meta | ❌ não coletado hoje (só `thruplay`); exige novos campos no sync |
| Miniatura, status, link do Instagram do anúncio | Meta | ✅ `meta_ads` |
| Vendas pagas com UTM e código `[AD-NN]` | Hubla | ✅ `hubla_sales` (≈ 5,8 mil vendas com AD na UTM) — **mas** em dev há só 50 vendas desde 01/09 e nenhuma da edição de Fortaleza de 16–18/10 |
| Inscritos / leads reais | ActiveCampaign | ❌ sem integração |
| Pesquisa pós-compra (renda, perfil, MQL) | planilha de pesquisa | ❌ sem tabela equivalente |
| Meta de cadeiras, datas da edição, tipos de ingresso | configurado no pipeline | ❌ precisa de cadastro (tela de configuração) |
| Funis (oferta principal, VSL, quiz, RMKT, nutrição) | derivado do nome da campanha | ✅ dá para derivar de `meta_campaigns.name` |
| Turmas semanais | derivado de datas | ✅ gerável |
| Pedidos IPM / outras vendas | Hubla por produto | ✅ por `product_name` |

## 4. Observações
- O DP100K usa `ing_meta` (venda com `utm_source=meta_ads`) como atribuição; o pixel da Meta (`purch`) aparece só por anúncio.
- Os painéis são públicos. Se forem reproduzidos no FAROL, ficam atrás de login e das permissões de menu.
- A frequência de atualização é a do pipeline externo (manual/agendada). No FAROL, os dados da Meta atualizam a cada 3 h e a Hubla por webhook.
