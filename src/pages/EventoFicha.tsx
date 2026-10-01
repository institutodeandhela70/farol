import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface PublicEvent {
  id: string;
  workspace_id: string;
  name: string;
  products: string[];
}

interface FichaForm {
  full_name: string;
  email: string;
  phone: string;
  cpf: string;
  rg: string;
  birth_date: string;
  address: string;
  hubla_product_name: string;
  hasSecond: boolean;
  second_full_name: string;
  second_cpf: string;
  second_rg: string;
  second_phone: string;
  second_birth_date: string;
  second_address: string;
}

const EMPTY_FORM: FichaForm = {
  full_name: "",
  email: "",
  phone: "",
  cpf: "",
  rg: "",
  birth_date: "",
  address: "",
  hubla_product_name: "",
  hasSecond: false,
  second_full_name: "",
  second_cpf: "",
  second_rg: "",
  second_phone: "",
  second_birth_date: "",
  second_address: "",
};

export default function EventoFicha() {
  const { slug } = useParams<{ slug: string }>();
  const [event, setEvent] = useState<PublicEvent | null>(null);
  const [loading, setLoading] = useState(true);

  const [step, setStep] = useState<"lookup" | "form" | "success">("lookup");
  const [lookupEmail, setLookupEmail] = useState("");
  const [lookupCpf, setLookupCpf] = useState("");
  const [looking, setLooking] = useState(false);

  const [form, setForm] = useState<FichaForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!slug) return;
    supabase
      .rpc("get_public_event_by_sales_slug", { p_slug: slug })
      .then(({ data }) => {
        setEvent((data?.[0] as PublicEvent) ?? null);
        setLoading(false);
      });
  }, [slug]);

  const handleLookup = async () => {
    if (!event) return;
    setLooking(true);

    const { data } = await supabase.rpc("lookup_public_participant", {
      p_event_id: event.id,
      p_email: lookupEmail.trim() || null,
      p_cpf: lookupCpf.trim() || null,
    });

    const match = data?.[0];
    setForm((f) => ({
      ...f,
      full_name: match?.full_name ?? f.full_name,
      email: match?.email ?? lookupEmail.trim(),
      phone: match?.phone ?? f.phone,
      cpf: match?.cpf ?? lookupCpf.trim(),
      rg: match?.rg ?? f.rg,
    }));

    setLooking(false);
    setStep("form");
  };

  const handleSubmit = async () => {
    if (!event) return;
    if (!form.full_name.trim() || !form.email.trim()) {
      setError("Preencha ao menos nome e e-mail.");
      return;
    }

    setSaving(true);
    setError(null);

    // Gera o id no cliente e evita `.select()` no insert — anon não tem
    // policy de SELECT em event_applications, então pedir a linha de volta
    // no mesmo INSERT quebraria por RLS (mesmo caso já visto no Onboarding).
    const applicationId = crypto.randomUUID();

    const { error: insertError } = await supabase.from("event_applications").insert({
      id: applicationId,
      workspace_id: event.workspace_id,
      event_id: event.id,
      hubla_product_name: form.hubla_product_name || null,
      full_name: form.full_name.trim(),
      email: form.email.trim(),
      phone: form.phone.trim() || null,
      cpf: form.cpf.trim() || null,
      rg: form.rg.trim() || null,
      birth_date: form.birth_date || null,
      address: form.address.trim() || null,
      second_full_name: form.hasSecond ? form.second_full_name.trim() || null : null,
      second_cpf: form.hasSecond ? form.second_cpf.trim() || null : null,
      second_rg: form.hasSecond ? form.second_rg.trim() || null : null,
      second_phone: form.hasSecond ? form.second_phone.trim() || null : null,
      second_birth_date: form.hasSecond ? form.second_birth_date || null : null,
      second_address: form.hasSecond ? form.second_address.trim() || null : null,
    });

    setSaving(false);

    if (insertError) {
      setError("Não foi possível enviar sua aplicação. Tente novamente em instantes.");
      return;
    }

    // Best-effort — se o gatilho não estiver ligado ou a mensagem falhar, a
    // aplicação já foi recebida do mesmo jeito, não bloqueia a tela de sucesso.
    await supabase.functions.invoke("send-event-whatsapp", {
      body: { event_id: event.id, trigger_type: "ficha_preenchida", application_id: applicationId },
    });

    setStep("success");
  };

  if (loading) {
    return <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">Carregando...</div>;
  }

  if (!event) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6 text-center text-sm text-muted-foreground">
        Link de aplicação não encontrado ou o evento não está mais ativo.
      </div>
    );
  }

  if (step === "success") {
    return (
      <div className="flex min-h-screen items-center justify-center p-6 text-center">
        <div>
          <h1 className="text-lg font-medium">Aplicação enviada!</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Recebemos seus dados do {event.name}. Um dos nossos closers vai falar com você em instantes.
          </p>
        </div>
      </div>
    );
  }

  if (step === "lookup") {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <h1 className="text-lg font-medium">{event.name}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Digite seu e-mail ou CPF pra já trazer seus dados preenchidos.
          </p>

          <div className="mt-6 flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="lookup-email">E-mail</Label>
              <Input id="lookup-email" type="email" value={lookupEmail} onChange={(e) => setLookupEmail(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="lookup-cpf">Ou CPF</Label>
              <Input id="lookup-cpf" value={lookupCpf} onChange={(e) => setLookupCpf(e.target.value)} />
            </div>

            <Button onClick={handleLookup} disabled={looking || (!lookupEmail.trim() && !lookupCpf.trim())}>
              {looking ? "Buscando..." : "Buscar meus dados"}
            </Button>
            <button type="button" onClick={() => setStep("form")} className="text-sm text-muted-foreground hover:underline">
              Não tenho, preencher do zero
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-md">
        <h1 className="text-lg font-medium">{event.name}</h1>
        <p className="mt-1 text-sm text-muted-foreground">Confirme ou complete seus dados.</p>

        <div className="mt-6 flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ficha-name">Nome completo</Label>
            <Input id="ficha-name" value={form.full_name} onChange={(e) => setForm((f) => ({ ...f, full_name: e.target.value }))} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ficha-email">E-mail</Label>
            <Input
              id="ficha-email"
              type="email"
              value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ficha-phone">Telefone</Label>
              <Input id="ficha-phone" value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ficha-birth">Data de nasc.</Label>
              <Input
                id="ficha-birth"
                type="date"
                value={form.birth_date}
                onChange={(e) => setForm((f) => ({ ...f, birth_date: e.target.value }))}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ficha-cpf">CPF</Label>
              <Input id="ficha-cpf" value={form.cpf} onChange={(e) => setForm((f) => ({ ...f, cpf: e.target.value }))} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ficha-rg">RG</Label>
              <Input id="ficha-rg" value={form.rg} onChange={(e) => setForm((f) => ({ ...f, rg: e.target.value }))} />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ficha-address">Endereço</Label>
            <Input id="ficha-address" value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} />
          </div>

          {event.products.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ficha-product">Produto</Label>
              <select
                id="ficha-product"
                value={form.hubla_product_name}
                onChange={(e) => setForm((f) => ({ ...f, hubla_product_name: e.target.value }))}
                className="h-10 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">Selecione</option>
                {event.products.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>
          )}

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.hasSecond}
              onChange={(e) => setForm((f) => ({ ...f, hasSecond: e.target.checked }))}
            />
            Trouxe um acompanhante (2 acessos)
          </label>

          {form.hasSecond && (
            <div className="flex flex-col gap-3 rounded-md border border-dashed border-border p-3">
              <p className="text-xs font-medium text-muted-foreground">Dados do 2º participante</p>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="ficha-second-name">Nome completo</Label>
                <Input
                  id="ficha-second-name"
                  value={form.second_full_name}
                  onChange={(e) => setForm((f) => ({ ...f, second_full_name: e.target.value }))}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="ficha-second-cpf">CPF</Label>
                  <Input
                    id="ficha-second-cpf"
                    value={form.second_cpf}
                    onChange={(e) => setForm((f) => ({ ...f, second_cpf: e.target.value }))}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="ficha-second-rg">RG</Label>
                  <Input
                    id="ficha-second-rg"
                    value={form.second_rg}
                    onChange={(e) => setForm((f) => ({ ...f, second_rg: e.target.value }))}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="ficha-second-phone">Telefone</Label>
                  <Input
                    id="ficha-second-phone"
                    value={form.second_phone}
                    onChange={(e) => setForm((f) => ({ ...f, second_phone: e.target.value }))}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="ficha-second-birth">Data de nasc.</Label>
                  <Input
                    id="ficha-second-birth"
                    type="date"
                    value={form.second_birth_date}
                    onChange={(e) => setForm((f) => ({ ...f, second_birth_date: e.target.value }))}
                  />
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="ficha-second-address">Endereço</Label>
                <Input
                  id="ficha-second-address"
                  value={form.second_address}
                  onChange={(e) => setForm((f) => ({ ...f, second_address: e.target.value }))}
                />
              </div>
            </div>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}

          <Button onClick={handleSubmit} disabled={saving}>
            {saving ? "Enviando..." : "Enviar aplicação"}
          </Button>
        </div>
      </div>
    </div>
  );
}
