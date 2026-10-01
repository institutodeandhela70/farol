import { useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { supabase } from "@/lib/supabase";
import { useWorkspace } from "@/hooks/WorkspaceProvider";

interface ChargeRow {
  value: number;
  status: string;
}

const RECEIVED_STATUSES = new Set(["RECEIVED", "RECEIVED_IN_CASH", "CONFIRMED"]);

function formatCurrency(value: number) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-muted p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-medium">{value}</p>
    </div>
  );
}

export default function VisaoGeral() {
  const { workspace } = useWorkspace();
  const [charges, setCharges] = useState<ChargeRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!workspace) return;
    supabase
      .from("asaas_charges")
      .select("value, status")
      .eq("workspace_id", workspace.id)
      .then(({ data }) => {
        setCharges(data ?? []);
        setLoading(false);
      });
  }, [workspace?.id]);

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

  return (
    <div className="p-6">
      <h1 className="text-xl font-medium">Visão geral</h1>
      <p className="mt-1 text-sm text-muted-foreground">Cobranças Asaas do workspace.</p>

      <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <MetricCard label="Recebido" value={formatCurrency(totals.received)} />
        <MetricCard label="Pendente" value={formatCurrency(totals.pending)} />
        <MetricCard label="Vencido" value={formatCurrency(totals.overdue)} />
      </div>

      <div className="mt-6 h-64 rounded-lg border border-border p-4">
        {loading ? (
          <p className="text-sm text-muted-foreground">Carregando...</p>
        ) : charges.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nenhuma cobrança sincronizada ainda — conecte o Asaas em Configurações → Integrações.
          </p>
        ) : (
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
        )}
      </div>
    </div>
  );
}
