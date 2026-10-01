import { useEffect, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { supabase } from "@/lib/supabase";
import { useWorkspace } from "@/hooks/WorkspaceProvider";
import { Input } from "@/components/ui/input";

interface BankAccount {
  id: string;
  display_name: string;
}

interface FilterOption {
  id: string;
  name: string;
}

interface ReceitaRow {
  id: string;
  posted_at: string | null;
  amount: number | null;
  contact_name: string | null;
  payer_name: string | null;
  product_name: string | null;
  owner_name: string | null;
  cost_center: string | null;
  bank_account_id: string;
}

function formatCurrency(value: number | null) {
  return (value ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Date(`${value}T00:00:00`).toLocaleDateString("pt-BR");
}

const PAGE_SIZE = 50;

export default function ReceitasDashboard() {
  const { workspace } = useWorkspace();
  const [rows, setRows] = useState<ReceitaRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [bankAccountFilter, setBankAccountFilter] = useState("all");
  const [productFilter, setProductFilter] = useState("all");
  const [ownerFilter, setOwnerFilter] = useState("all");
  const [page, setPage] = useState(1);

  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [filterOptions, setFilterOptions] = useState<{ products: FilterOption[]; owners: FilterOption[] }>({
    products: [],
    owners: [],
  });
  const [summary, setSummary] = useState({ total_count: 0, gross_total: 0 });
  const [chartData, setChartData] = useState<{ month: string; valor: number }[]>([]);

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 350);
    return () => clearTimeout(t);
  }, [searchInput]);

  useEffect(() => {
    if (!workspace) return;
    supabase
      .from("bank_accounts")
      .select("id, display_name")
      .eq("workspace_id", workspace.id)
      .order("display_name")
      .then(({ data }) => setBankAccounts(data ?? []));

    supabase.rpc("receitas_oficiais_filter_options", { p_workspace_id: workspace.id }).then(({ data }) => {
      const row = data?.[0];
      setFilterOptions({
        products: (row?.products ?? []).filter((p: FilterOption) => p.name),
        owners: (row?.owners ?? []).filter((o: FilterOption) => o.name),
      });
    });

    supabase.rpc("receitas_oficiais_monthly_totals", { p_workspace_id: workspace.id }).then(({ data }) => {
      setChartData((data ?? []).map((r: { month: string; gross_total: number }) => ({ month: r.month, valor: r.gross_total })));
    });
  }, [workspace?.id]);

  useEffect(() => {
    setPage(1);
  }, [search, bankAccountFilter, productFilter, ownerFilter]);

  useEffect(() => {
    if (!workspace) return;
    setLoading(true);

    const filters = {
      p_workspace_id: workspace.id,
      p_search: search || null,
      p_bank_account_id: bankAccountFilter === "all" ? null : bankAccountFilter,
      p_product_id: productFilter === "all" ? null : productFilter,
      p_owner_id: ownerFilter === "all" ? null : ownerFilter,
    };

    supabase.rpc("receitas_oficiais_summary", filters).then(({ data }) => {
      const row = data?.[0];
      setSummary({ total_count: row?.total_count ?? 0, gross_total: row?.gross_total ?? 0 });
    });

    let query = supabase
      .from("receitas_oficiais")
      .select("id, posted_at, amount, contact_name, payer_name, product_name, owner_name, cost_center, bank_account_id")
      .eq("workspace_id", workspace.id);

    if (bankAccountFilter !== "all") query = query.eq("bank_account_id", bankAccountFilter);
    if (productFilter !== "all") query = query.eq("hubspot_product_id", productFilter);
    if (ownerFilter !== "all") query = query.eq("hubspot_owner_id", ownerFilter);
    if (search) query = query.or(`contact_name.ilike.%${search}%,payer_name.ilike.%${search}%`);

    query
      .order("posted_at", { ascending: false, nullsFirst: false })
      .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1)
      .then(({ data }) => {
        setRows(data ?? []);
        setLoading(false);
      });
  }, [workspace?.id, search, bankAccountFilter, productFilter, ownerFilter, page]);

  const totalPages = Math.max(1, Math.ceil(summary.total_count / PAGE_SIZE));
  const ticketMedio = summary.total_count > 0 ? summary.gross_total / summary.total_count : 0;
  const bankAccountName = (id: string) => bankAccounts.find((b) => b.id === id)?.display_name ?? "—";

  return (
    <div className="p-6">
      <h1 className="text-xl font-medium">Receitas</h1>
      <p className="mt-1 text-sm text-muted-foreground">Base oficial — lançamentos de banco/OFX já finalizados.</p>

      <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-lg bg-muted p-4">
          <p className="text-sm text-muted-foreground">Faturamento (filtro atual)</p>
          <p className="mt-1 text-2xl font-medium">{formatCurrency(summary.gross_total)}</p>
        </div>
        <div className="rounded-lg bg-muted p-4">
          <p className="text-sm text-muted-foreground">Ticket médio (filtro atual)</p>
          <p className="mt-1 text-2xl font-medium">{formatCurrency(ticketMedio)}</p>
        </div>
        <div className="rounded-lg bg-muted p-4">
          <p className="text-sm text-muted-foreground">Lançamentos (filtro atual)</p>
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
          placeholder="Buscar por contato ou pagante..."
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          className="sm:max-w-xs"
        />
        <div className="flex flex-wrap gap-2">
          <select
            value={bankAccountFilter}
            onChange={(e) => setBankAccountFilter(e.target.value)}
            className="h-10 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="all">Todas as contas</option>
            {bankAccounts.map((b) => (
              <option key={b.id} value={b.id}>
                {b.display_name}
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
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <select
            value={ownerFilter}
            onChange={(e) => setOwnerFilter(e.target.value)}
            className="h-10 max-w-[180px] rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="all">Todos os donos</option>
            {filterOptions.owners.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="mt-4 overflow-x-auto overflow-hidden rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-muted-foreground">
            <tr>
              <th className="px-4 py-2 font-medium">Data</th>
              <th className="px-4 py-2 font-medium">Contato</th>
              <th className="px-4 py-2 font-medium">Produto</th>
              <th className="px-4 py-2 font-medium">Dono</th>
              <th className="px-4 py-2 font-medium">Centro de Custo</th>
              <th className="px-4 py-2 font-medium">Conta</th>
              <th className="px-4 py-2 font-medium">Valor</th>
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
                  Nenhuma receita encontrada com esse filtro.
                </td>
              </tr>
            )}
            {!loading &&
              rows.map((r) => (
                <tr key={r.id} className="border-t border-border">
                  <td className="px-4 py-2 text-muted-foreground">{formatDate(r.posted_at)}</td>
                  <td className="px-4 py-2">
                    <div>{r.contact_name ?? r.payer_name ?? "—"}</div>
                    {r.contact_name && r.payer_name && r.contact_name !== r.payer_name && (
                      <div className="text-xs text-muted-foreground">Pagante: {r.payer_name}</div>
                    )}
                  </td>
                  <td className="px-4 py-2">{r.product_name ?? "—"}</td>
                  <td className="px-4 py-2 text-muted-foreground">{r.owner_name ?? "—"}</td>
                  <td className="px-4 py-2 text-muted-foreground">{r.cost_center ?? "—"}</td>
                  <td className="px-4 py-2 text-muted-foreground">{bankAccountName(r.bank_account_id)}</td>
                  <td className="px-4 py-2">{formatCurrency(r.amount)}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="mt-3 flex items-center justify-between text-sm text-muted-foreground">
          <span>
            Página {page} de {totalPages} ({summary.total_count.toLocaleString("pt-BR")} lançamentos)
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
