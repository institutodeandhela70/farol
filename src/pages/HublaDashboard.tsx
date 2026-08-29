import { useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { supabase } from "@/lib/supabase";
import { useWorkspace } from "@/hooks/WorkspaceProvider";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

interface SaleRow {
  id: string;
  invoice_id: string;
  status: string | null;
  payment_method: string | null;
  product_name: string | null;
  customer_name: string | null;
  customer_email: string | null;
  total_value: number | null;
  net_value: number | null;
  paid_at: string | null;
}

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  Paga: "default",
  Pendente: "secondary",
  Reembolsada: "outline",
  Atrasada: "destructive",
  Cancelada: "destructive",
  Recusada: "destructive",
};

function formatCurrency(value: number | null) {
  return (value ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("pt-BR");
}

const PAGE_SIZE = 50;

export default function HublaDashboard() {
  const { workspace } = useWorkspace();
  const [rows, setRows] = useState<SaleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [productFilter, setProductFilter] = useState("all");
  const [page, setPage] = useState(1);

  const [filterOptions, setFilterOptions] = useState<{ statuses: string[]; products: string[] }>({
    statuses: [],
    products: [],
  });
  const [summary, setSummary] = useState({ total_count: 0, gross_total: 0, net_total: 0 });
  const [chartData, setChartData] = useState<{ month: string; valor: number }[]>([]);

  // Debounce da busca por texto.
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 350);
    return () => clearTimeout(t);
  }, [searchInput]);

  useEffect(() => {
    if (!workspace) return;
    supabase.rpc("hubla_sales_filter_options", { p_workspace_id: workspace.id }).then(({ data }) => {
      const row = data?.[0];
      setFilterOptions({ statuses: row?.statuses ?? [], products: row?.products ?? [] });
    });
    supabase.rpc("hubla_sales_monthly_totals", { p_workspace_id: workspace.id }).then(({ data }) => {
      setChartData((data ?? []).map((r: { month: string; gross_total: number }) => ({ month: r.month, valor: r.gross_total })));
    });
  }, [workspace?.id]);

  useEffect(() => {
    setPage(1);
  }, [search, statusFilter, productFilter]);

  useEffect(() => {
    if (!workspace) return;
    setLoading(true);

    const filters = {
      p_workspace_id: workspace.id,
      p_search: search || null,
      p_status: statusFilter === "all" ? null : statusFilter,
      p_product: productFilter === "all" ? null : productFilter,
    };

    supabase.rpc("hubla_sales_summary", filters).then(({ data }) => {
      const row = data?.[0];
      setSummary({
        total_count: row?.total_count ?? 0,
        gross_total: row?.gross_total ?? 0,
        net_total: row?.net_total ?? 0,
      });
    });

    let query = supabase
      .from("hubla_sales")
      .select("id, invoice_id, status, payment_method, product_name, customer_name, customer_email, total_value, net_value, paid_at")
      .eq("workspace_id", workspace.id);

    if (statusFilter !== "all") query = query.eq("status", statusFilter);
    if (productFilter !== "all") query = query.eq("product_name", productFilter);
    if (search) query = query.or(`customer_name.ilike.%${search}%,customer_email.ilike.%${search}%,invoice_id.ilike.%${search}%`);

    query
      .order("paid_at", { ascending: false, nullsFirst: false })
      .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1)
      .then(({ data }) => {
        setRows(data ?? []);
        setLoading(false);
      });
  }, [workspace?.id, search, statusFilter, productFilter, page]);

  const totalPages = Math.max(1, Math.ceil(summary.total_count / PAGE_SIZE));

  return (
    <div className="p-6">
      <h1 className="text-xl font-medium">Hubla</h1>
      <p className="mt-1 text-sm text-muted-foreground">Vendas sincronizadas do workspace.</p>

      <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-lg bg-muted p-4">
          <p className="text-sm text-muted-foreground">Faturamento bruto (filtro atual)</p>
          <p className="mt-1 text-2xl font-medium">{formatCurrency(summary.gross_total)}</p>
        </div>
        <div className="rounded-lg bg-muted p-4">
          <p className="text-sm text-muted-foreground">Valor líquido (filtro atual)</p>
          <p className="mt-1 text-2xl font-medium">{formatCurrency(summary.net_total)}</p>
        </div>
        <div className="rounded-lg bg-muted p-4">
          <p className="text-sm text-muted-foreground">Vendas (filtro atual)</p>
          <p className="mt-1 text-2xl font-medium">{summary.total_count.toLocaleString("pt-BR")}</p>
        </div>
      </div>

      {chartData.length > 0 && (
        <div className="mt-6 h-56 rounded-lg border border-border p-4">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="month" stroke="hsl(var(--muted-foreground))" fontSize={11} />
              <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} />
              <Tooltip
                formatter={(value: number) => formatCurrency(value)}
                contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))" }}
              />
              <Bar dataKey="valor" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Input
          placeholder="Buscar por cliente, e-mail ou id da fatura..."
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          className="sm:max-w-xs"
        />
        <div className="flex gap-2">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="h-10 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="all">Todos os status</option>
            {filterOptions.statuses.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <select
            value={productFilter}
            onChange={(e) => setProductFilter(e.target.value)}
            className="h-10 max-w-[220px] rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="all">Todos os produtos</option>
            {filterOptions.products.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="mt-4 overflow-x-auto overflow-hidden rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-muted-foreground">
            <tr>
              <th className="px-4 py-2 font-medium">Cliente</th>
              <th className="px-4 py-2 font-medium">Produto</th>
              <th className="px-4 py-2 font-medium">Valor</th>
              <th className="px-4 py-2 font-medium">Líquido</th>
              <th className="px-4 py-2 font-medium">Pagamento</th>
              <th className="px-4 py-2 font-medium">Status</th>
              <th className="px-4 py-2 font-medium">Data</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-muted-foreground">
                  Carregando...
                </td>
              </tr>
            )}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-muted-foreground">
                  Nenhuma venda encontrada com esse filtro.
                </td>
              </tr>
            )}
            {!loading &&
              rows.map((s) => (
                <tr key={s.id} className="border-t border-border">
                  <td className="px-4 py-2">
                    <div>{s.customer_name ?? "—"}</div>
                    <div className="text-xs text-muted-foreground">{s.customer_email}</div>
                  </td>
                  <td className="px-4 py-2">{s.product_name ?? "—"}</td>
                  <td className="px-4 py-2">{formatCurrency(s.total_value)}</td>
                  <td className="px-4 py-2 text-muted-foreground">{formatCurrency(s.net_value)}</td>
                  <td className="px-4 py-2 text-muted-foreground">{s.payment_method ?? "—"}</td>
                  <td className="px-4 py-2">
                    {s.status && <Badge variant={STATUS_VARIANT[s.status] ?? "outline"}>{s.status}</Badge>}
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">{formatDate(s.paid_at)}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="mt-3 flex items-center justify-between text-sm text-muted-foreground">
          <span>
            Página {page} de {totalPages} ({summary.total_count.toLocaleString("pt-BR")} vendas)
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="rounded-md border border-input px-3 py-1 disabled:opacity-50"
            >
              Anterior
            </button>
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              className="rounded-md border border-input px-3 py-1 disabled:opacity-50"
            >
              Próxima
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
