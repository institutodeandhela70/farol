import { useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { supabase } from "@/lib/supabase";
import { useWorkspace } from "@/hooks/WorkspaceProvider";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

interface ChargeRow {
  id: string;
  external_id: string;
  customer_name: string | null;
  value: number;
  status: string;
  due_date: string | null;
  payment_date: string | null;
}

const STATUS_LABEL: Record<string, string> = {
  PENDING: "Pendente",
  RECEIVED: "Recebido",
  CONFIRMED: "Confirmado",
  RECEIVED_IN_CASH: "Recebido em dinheiro",
  OVERDUE: "Vencido",
  REFUNDED: "Estornado",
  REFUND_REQUESTED: "Estorno solicitado",
  CHARGEBACK_REQUESTED: "Chargeback solicitado",
  CHARGEBACK_DISPUTE: "Em disputa",
  AWAITING_CHARGEBACK_REVERSAL: "Aguardando reversão",
  DUNNING_REQUESTED: "Em cobrança",
  DUNNING_RECEIVED: "Cobrança recebida",
  AWAITING_RISK_ANALYSIS: "Em análise de risco",
};

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  RECEIVED: "default",
  CONFIRMED: "default",
  RECEIVED_IN_CASH: "default",
  PENDING: "secondary",
  OVERDUE: "destructive",
  REFUNDED: "outline",
};

const RECEIVED_STATUSES = new Set(["RECEIVED", "RECEIVED_IN_CASH", "CONFIRMED"]);

function formatCurrency(value: number) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("pt-BR", { timeZone: "UTC" });
}

export default function AsaasDashboard() {
  const { workspace } = useWorkspace();
  const [charges, setCharges] = useState<ChargeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  useEffect(() => {
    if (!workspace) return;
    supabase
      .from("asaas_charges")
      .select("id, external_id, customer_name, value, status, due_date, payment_date")
      .eq("workspace_id", workspace.id)
      .order("due_date", { ascending: false, nullsFirst: false })
      .then(({ data }) => {
        setCharges(data ?? []);
        setLoading(false);
      });
  }, [workspace?.id]);

  const statusOptions = useMemo(() => {
    const set = new Set(charges.map((c) => c.status));
    return Array.from(set);
  }, [charges]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return charges.filter((c) => {
      const matchesSearch =
        !term ||
        c.customer_name?.toLowerCase().includes(term) ||
        c.external_id.toLowerCase().includes(term);
      const matchesStatus = statusFilter === "all" || c.status === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [charges, search, statusFilter]);

  const totals = useMemo(() => {
    let received = 0;
    let pending = 0;
    let overdue = 0;
    for (const c of charges) {
      if (RECEIVED_STATUSES.has(c.status)) received += c.value;
      else if (c.status === "PENDING") pending += c.value;
      else if (c.status === "OVERDUE") overdue += c.value;
    }
    return { received, pending, overdue };
  }, [charges]);

  const chartData = [
    { name: "Recebido", valor: totals.received },
    { name: "Pendente", valor: totals.pending },
    { name: "Vencido", valor: totals.overdue },
  ];

  if (loading) {
    return <div className="p-6 text-sm text-muted-foreground">Carregando...</div>;
  }

  return (
    <div className="p-6">
      <h1 className="text-xl font-medium">Asaas</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {charges.length} cobrança(s) sincronizada(s).
      </p>

      <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-lg bg-muted p-4">
          <p className="text-sm text-muted-foreground">Recebido</p>
          <p className="mt-1 text-2xl font-medium">{formatCurrency(totals.received)}</p>
        </div>
        <div className="rounded-lg bg-muted p-4">
          <p className="text-sm text-muted-foreground">Pendente</p>
          <p className="mt-1 text-2xl font-medium">{formatCurrency(totals.pending)}</p>
        </div>
        <div className="rounded-lg bg-muted p-4">
          <p className="text-sm text-muted-foreground">Vencido</p>
          <p className="mt-1 text-2xl font-medium">{formatCurrency(totals.overdue)}</p>
        </div>
      </div>

      {charges.length > 0 && (
        <div className="mt-6 h-56 rounded-lg border border-border p-4">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="name" stroke="hsl(var(--muted-foreground))" fontSize={12} />
              <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} />
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
          placeholder="Buscar por cliente ou id..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="sm:max-w-xs"
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="h-10 rounded-md border border-input bg-background px-3 text-sm sm:w-56"
        >
          <option value="all">Todos os status</option>
          {statusOptions.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s] ?? s}
            </option>
          ))}
        </select>
      </div>

      <div className="mt-4 overflow-x-auto overflow-hidden rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-muted-foreground">
            <tr>
              <th className="px-4 py-2 font-medium">Cliente</th>
              <th className="px-4 py-2 font-medium">Valor</th>
              <th className="px-4 py-2 font-medium">Status</th>
              <th className="px-4 py-2 font-medium">Vencimento</th>
              <th className="px-4 py-2 font-medium">Pagamento</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">
                  {charges.length === 0
                    ? "Nenhuma cobrança sincronizada ainda — conecte o Asaas em Configurações → Integrações."
                    : "Nenhuma cobrança encontrada com esse filtro."}
                </td>
              </tr>
            )}
            {filtered.map((c) => (
              <tr key={c.id} className="border-t border-border">
                <td className="px-4 py-2">{c.customer_name ?? "—"}</td>
                <td className="px-4 py-2">{formatCurrency(c.value)}</td>
                <td className="px-4 py-2">
                  <Badge variant={STATUS_VARIANT[c.status] ?? "outline"}>
                    {STATUS_LABEL[c.status] ?? c.status}
                  </Badge>
                </td>
                <td className="px-4 py-2 text-muted-foreground">{formatDate(c.due_date)}</td>
                <td className="px-4 py-2 text-muted-foreground">{formatDate(c.payment_date)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
