import type { ReactNode } from "react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useWorkspace } from "@/hooks/WorkspaceProvider";
import { useHubspotOwners } from "@/lib/hubspotMeta";
import { ownerDisplay } from "@/lib/commercial";
import { METHOD_LABEL, useSearchDetail, type SearchRow } from "@/lib/searchData";
import { formatMoney } from "@/lib/money";
import { LoadingBlock } from "@/components/commercial/CommercialUI";

// Painel "Detalhar": tudo sobre um lançamento — título e venda na IULI, Hubla/TMB, vínculo,
// negócio e contato no HubSpot, e os outros negócios e lançamentos do mesmo cliente.

type Obj = Record<string, unknown>;

const dayBR = (v: unknown) => {
  if (!v) return "";
  const s = String(v).slice(0, 10);
  return s.split("-").reverse().join("/");
};
const dateTimeBR = (v: unknown) => {
  if (!v) return "";
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
};
const money = (v: unknown) => (v === null || v === undefined || v === "" ? "" : formatMoney(Number(v)));
const yesNo = (v: unknown) => (v ? "Sim" : "Não");
const PIPELINE: Record<string, string> = { contratos: "Contratos", hubla_tmb: "Hubla & TMB" };
const STATUS: Record<string, string> = { recebido: "Recebido", a_vencer: "A vencer", vencido: "Vencido", recebida: "Recebida", sem_baixa: "Sem baixa" };

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2 rounded-lg border border-border p-4">
      <h3 className="text-sm font-semibold">{title}</h3>
      {children}
    </section>
  );
}

function Fields({ items }: { items: [string, ReactNode][] }) {
  const shown = items.filter(([, v]) => v !== null && v !== undefined && v !== "");
  if (!shown.length) return <p className="text-sm text-muted-foreground">Sem informação.</p>;
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
      {shown.map(([k, v]) => (
        <div key={k} className="flex flex-col">
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">{k}</dt>
          <dd className="break-words font-medium">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function LancamentoDetail({ row, onClose }: { row: SearchRow | null; onClose: () => void }) {
  const { workspace } = useWorkspace();
  const ws = workspace?.id;
  const owners = useHubspotOwners(ws);
  const detail = useSearchDetail(ws, row?.integration_id ?? null, row?.iuli_id ?? null);
  const d = detail.data;

  const titulo = (d?.titulo ?? null) as Obj | null;
  const venda = (d?.venda_iuli ?? null) as Obj | null;
  const hubla = (d?.hubla ?? null) as Obj | null;
  const tmb = (d?.tmb ?? null) as Obj | null;
  const vinculo = (d?.vinculo ?? null) as Obj | null;
  const negocio = (d?.negocio ?? null) as Obj | null;
  const contato = (d?.contato ?? null) as Obj | null;
  const outrosNegocios = (d?.outros_negocios ?? []) as Obj[];
  const outrosTitulos = (d?.outros_titulos ?? []) as Obj[];
  const owner = (id: unknown) => (id ? ownerDisplay(owners, String(id)) : "");

  return (
    <Sheet open={!!row} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="flex w-full flex-col gap-4 overflow-y-auto sm:max-w-[min(900px,96vw)]">
        <SheetHeader className="text-left">
          <SheetTitle>{row?.cliente ?? "Lançamento"}</SheetTitle>
          <SheetDescription>
            {row?.produto} · {row?.empresa} · lançamento {row?.iuli_id}
          </SheetDescription>
        </SheetHeader>

        {detail.isLoading ? (
          <LoadingBlock />
        ) : detail.error ? (
          <p className="text-sm text-destructive">Não foi possível carregar o detalhe: {(detail.error as Error).message}</p>
        ) : !d ? (
          <p className="text-sm text-muted-foreground">Lançamento não encontrado.</p>
        ) : (
          <>
            <Section title="Lançamento na IULI (título a receber)">
              <Fields
                items={[
                  ["Cliente", String(titulo?.cliente ?? "")],
                  ["Empresa", String(titulo?.empresa ?? "")],
                  ["Produto", String(titulo?.produto ?? "")],
                  ["Categoria", String(titulo?.categoria ?? "")],
                  ["Situação", STATUS[String(titulo?.situacao ?? "")] ?? String(titulo?.situacao ?? "")],
                  ["Competência", dayBR(titulo?.competencia)],
                  ["Vencimento", dayBR(titulo?.vencimento)],
                  ["Pagamento", dayBR(titulo?.pagamento)],
                  ["Valor previsto", money(titulo?.valor_previsto)],
                  ["Valor pago", money(titulo?.valor_pago)],
                  ["Juros", Number(titulo?.juros ?? 0) ? money(titulo?.juros) : ""],
                  ["Nota fiscal", String(titulo?.nf_numero ?? "") || (titulo?.tem_nf ? "Sim (sem número)" : "")],
                  ["Boleto", yesNo(titulo?.tem_boleto)],
                  ["Comprovante", yesNo(titulo?.tem_comprovante)],
                  ["Venda na IULI", titulo?.venda_id ? String(titulo.venda_id) : ""],
                  ["Descrição", String(titulo?.descricao ?? "")],
                  ["Sincronizado em", dateTimeBR(titulo?.sincronizado_em)],
                ]}
              />
            </Section>

            {venda && (
              <Section title="Venda na IULI">
                <Fields
                  items={[
                    ["Status", String(venda.status ?? "")],
                    ["Valor total", money(venda.valor_total)],
                    ["Valor líquido", money(venda.valor_liquido)],
                    ["Competência", dayBR(venda.competencia)],
                    ["Pagamento", dayBR(venda.pagamento)],
                    ["Origem (ID na plataforma)", String(venda.external_id ?? "")],
                    ["Descrição", String(venda.descricao ?? "")],
                  ]}
                />
              </Section>
            )}

            {hubla && (
              <Section title="Hubla">
                <Fields
                  items={[
                    ["Cliente", String(hubla.customer_name ?? "")],
                    ["E-mail", String(hubla.customer_email ?? "")],
                    ["Telefone", String(hubla.customer_phone ?? "")],
                    ["CPF/CNPJ", String(hubla.customer_document ?? "")],
                    ["Produto", String(hubla.product_name ?? "")],
                    ["Oferta", String(hubla.offer_name ?? "")],
                    ["Status", String(hubla.status ?? "")],
                    ["Forma de pagamento", String(hubla.payment_method ?? "")],
                    ["Valor", money(hubla.total_value)],
                    ["Valor líquido", money(hubla.net_value)],
                    ["Parcelas no cartão", hubla.installments ? String(hubla.installments) : ""],
                    ["Parcela do plano", hubla.parcela ? `${hubla.parcela} de ${hubla.parcelas_total ?? "?"}` : ""],
                    ["Criada em", dateTimeBR(hubla.created_at_hubla)],
                    ["Paga em", dateTimeBR(hubla.paid_at)],
                    ["Cupom", String(hubla.coupon_code ?? "")],
                    ["Origem do tráfego", [hubla.utm_source, hubla.utm_campaign].filter(Boolean).join(" · ")],
                  ]}
                />
              </Section>
            )}

            {tmb && (
              <Section title="TMB">
                <Fields
                  items={[
                    ["Cliente", String(tmb.customer_name ?? "")],
                    ["E-mail", String(tmb.customer_email ?? "")],
                    ["Telefone", String(tmb.customer_phone ?? "")],
                    ["CPF/CNPJ", String(tmb.customer_document ?? "")],
                    ["Produto", String(tmb.product_name ?? "")],
                    ["Pedido", String(tmb.pedido_id ?? "")],
                    ["Status", `${tmb.status ?? ""} ${tmb.status_financeiro ? `· ${tmb.status_financeiro}` : ""}`.trim()],
                    ["Valor", money(tmb.valor_total)],
                    ["Parcelas", tmb.parcelas ? String(tmb.parcelas) : ""],
                    ["Criado em", dayBR(tmb.criado_em)],
                    ["Efetivado em", dayBR(tmb.data_efetivado)],
                  ]}
                />
              </Section>
            )}

            <Section title="Negócio vinculado no HubSpot">
              {negocio ? (
                <>
                  <Fields
                    items={[
                      ["Negócio", String(negocio.dealname ?? "")],
                      ["Pipeline", String(negocio.pipeline ?? "")],
                      ["Etapa", String(negocio.etapa ?? "")],
                      ["Ganho?", yesNo(negocio.is_closed_won)],
                      ["Data do ganho (closedate)", dateTimeBR(negocio.closedate)],
                      ["Criado em", dateTimeBR(negocio.created_at_hubspot)],
                      ["Valor", money(negocio.amount)],
                      ["Produto", String(negocio.produto ?? "")],
                      ["Vendedor", owner(negocio.owner_id)],
                      ["Closer", owner(negocio.closer_owner_id)],
                      ["CPF no negócio", String(negocio.cpf ?? "")],
                      ["Como foi ligado", METHOD_LABEL[String(vinculo?.metodo ?? "")] ?? String(vinculo?.metodo ?? "")],
                    ]}
                  />
                  {contato && (
                    <Fields
                      items={[
                        ["Contato", [contato.firstname, contato.lastname].filter(Boolean).join(" ")],
                        ["E-mail do contato", String(contato.email ?? "")],
                        ["Telefone do contato", String(contato.phone ?? "")],
                      ]}
                    />
                  )}
                </>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Nenhum negócio de {PIPELINE.contratos} ligado a este lançamento (por nome, CPF, e-mail ou valor + data). Veja abaixo os outros negócios do cliente.
                </p>
              )}
            </Section>

            <Section title={`Outros negócios do mesmo cliente no HubSpot (${outrosNegocios.length})`}>
              {outrosNegocios.length ? (
                <div className="-mx-4 overflow-x-auto md:mx-0">
                  <table className="w-full min-w-[640px] text-sm">
                    <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <tr className="border-b border-border">
                        <th className="px-3 py-2 font-medium">Negócio</th>
                        <th className="px-3 py-2 font-medium">Pipeline · etapa</th>
                        <th className="px-3 py-2 font-medium">Fechamento</th>
                        <th className="px-3 py-2 text-right font-medium">Valor</th>
                      </tr>
                    </thead>
                    <tbody>
                      {outrosNegocios.map((n, i) => (
                        <tr key={`${n.hubspot_id}-${i}`} className="border-b border-border/60 last:border-0">
                          <td className="px-3 py-2">
                            {String(n.dealname ?? "")}
                            {n.produto ? <span className="block text-xs text-muted-foreground">{String(n.produto)}</span> : null}
                          </td>
                          <td className="px-3 py-2">
                            {String(n.pipeline ?? "")} · {String(n.etapa ?? "")}
                            {n.is_closed_won ? <span className="ml-1 text-xs font-semibold text-primary">ganho</span> : null}
                          </td>
                          <td className="px-3 py-2 tabular-nums">{dayBR(n.closedate)}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{money(n.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Nenhum outro negócio encontrado para esse nome.</p>
              )}
            </Section>

            <Section title={`Outros lançamentos de produto do mesmo cliente na IULI (${outrosTitulos.length})`}>
              {outrosTitulos.length ? (
                <div className="-mx-4 overflow-x-auto md:mx-0">
                  <table className="w-full min-w-[560px] text-sm">
                    <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <tr className="border-b border-border">
                        <th className="px-3 py-2 font-medium">Competência</th>
                        <th className="px-3 py-2 font-medium">Vencimento</th>
                        <th className="px-3 py-2 font-medium">Situação</th>
                        <th className="px-3 py-2 font-medium">Categoria</th>
                        <th className="px-3 py-2 text-right font-medium">Valor</th>
                      </tr>
                    </thead>
                    <tbody>
                      {outrosTitulos.map((t, i) => (
                        <tr key={`${t.iuli_id}-${i}`} className="border-b border-border/60 last:border-0">
                          <td className="px-3 py-2 tabular-nums">{dayBR(t.competencia)}</td>
                          <td className="px-3 py-2 tabular-nums">{dayBR(t.due_date)}</td>
                          <td className="px-3 py-2">{STATUS[String(t.situacao ?? "")] ?? String(t.situacao ?? "")}</td>
                          <td className="px-3 py-2">{String(t.categoria ?? "")}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{money(t.valor)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Nenhum outro lançamento de produto desse cliente nesta empresa.</p>
              )}
            </Section>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
