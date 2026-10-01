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
}

export default function EventoInscricao() {
  const { slug } = useParams<{ slug: string }>();
  const [event, setEvent] = useState<PublicEvent | null>(null);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ full_name: "", email: "", phone: "", cpf: "" });
  const [saving, setSaving] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!slug) return;
    supabase
      .rpc("get_public_event_by_signup_slug", { p_slug: slug })
      .then(({ data }) => {
        setEvent((data?.[0] as PublicEvent) ?? null);
        setLoading(false);
      });
  }, [slug]);

  const handleSubmit = async () => {
    if (!event) return;
    if (!form.full_name.trim() || !form.email.trim()) {
      setError("Preencha ao menos nome e e-mail.");
      return;
    }

    setSaving(true);
    setError(null);

    const { error: insertError } = await supabase.from("event_participants").insert({
      workspace_id: event.workspace_id,
      event_id: event.id,
      full_name: form.full_name.trim(),
      email: form.email.trim(),
      phone: form.phone.trim() || null,
      cpf: form.cpf.trim() || null,
      origin: "signup_form",
      approval_status: "pendente",
    });

    setSaving(false);

    if (insertError) {
      setError("Não foi possível enviar seu cadastro. Tente novamente em instantes.");
      return;
    }

    setSubmitted(true);
  };

  if (loading) {
    return <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">Carregando...</div>;
  }

  if (!event) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6 text-center text-sm text-muted-foreground">
        Link de cadastro não encontrado ou o evento não está mais aceitando inscrições.
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6 text-center">
        <div>
          <h1 className="text-lg font-medium">Cadastro recebido!</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Obrigado por se inscrever no {event.name}. Em breve o time vai confirmar sua participação.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <h1 className="text-lg font-medium">{event.name}</h1>
        <p className="mt-1 text-sm text-muted-foreground">Preencha seus dados pra confirmar sua participação.</p>

        <div className="mt-6 flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="signup-name">Nome completo</Label>
            <Input id="signup-name" value={form.full_name} onChange={(e) => setForm((f) => ({ ...f, full_name: e.target.value }))} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="signup-email">E-mail</Label>
            <Input
              id="signup-email"
              type="email"
              value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="signup-phone">Telefone</Label>
            <Input id="signup-phone" value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="signup-cpf">CPF</Label>
            <Input id="signup-cpf" value={form.cpf} onChange={(e) => setForm((f) => ({ ...f, cpf: e.target.value }))} />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <Button onClick={handleSubmit} disabled={saving}>
            {saving ? "Enviando..." : "Confirmar inscrição"}
          </Button>
        </div>
      </div>
    </div>
  );
}
