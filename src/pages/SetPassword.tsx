import { useEffect, useState, type FormEvent } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { Eye, EyeOff } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type PasswordStrength = { label: string; pct: number; barClass: string; textClass: string };

function getPasswordStrength(password: string): PasswordStrength {
  if (!password) return { label: "", pct: 0, barClass: "", textClass: "" };

  let score = 0;
  if (password.length >= 8) score++;
  if (password.length >= 12) score++;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score++;
  if (/\d/.test(password)) score++;
  if (/[^A-Za-z0-9]/.test(password)) score++;

  if (score <= 2) return { label: "Fraca", pct: 33, barClass: "bg-destructive", textClass: "text-destructive" };
  if (score <= 3) return { label: "Média", pct: 66, barClass: "bg-amber-500", textClass: "text-amber-500" };
  return { label: "Forte", pct: 100, barClass: "bg-primary", textClass: "text-primary" };
}

function PasswordField({
  id,
  label,
  value,
  onChange,
  strength,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  strength?: PasswordStrength;
}) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Input
          id={id}
          type={visible ? "text" : "password"}
          required
          minLength={8}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="pr-10"
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? "Ocultar senha" : "Mostrar senha"}
          className="absolute right-0 top-0 flex h-10 w-10 items-center justify-center text-muted-foreground hover:text-foreground"
        >
          {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </button>
      </div>
      {strength && value && (
        <div className="flex flex-col gap-1">
          <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
            <div
              className={`h-full transition-all ${strength.barClass}`}
              style={{ width: `${strength.pct}%` }}
            />
          </div>
          <p className={`text-xs ${strength.textClass}`}>Senha {strength.label.toLowerCase()}</p>
        </div>
      )}
    </div>
  );
}

export default function SetPassword() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();

  const [checking, setChecking] = useState(true);
  const [mustChange, setMustChange] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!user) return;
    supabase
      .from("profiles")
      .select("must_change_password")
      .eq("id", user.id)
      .maybeSingle()
      .then(({ data }) => {
        setMustChange(data?.must_change_password ?? false);
        setChecking(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  if (!authLoading && !user) return <Navigate to="/auth" replace />;
  if (!checking && !mustChange) return <Navigate to="/" replace />;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError("A senha precisa ter pelo menos 8 caracteres.");
      return;
    }
    if (password !== confirmPassword) {
      setError("As senhas não coincidem.");
      return;
    }

    setSubmitting(true);

    const { error: updateError } = await supabase.auth.updateUser({ password });
    if (updateError) {
      setSubmitting(false);
      setError(updateError.message);
      return;
    }

    await supabase.from("profiles").update({ must_change_password: false }).eq("id", user!.id);

    setSubmitting(false);
    navigate("/", { replace: true });
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 text-foreground">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <h1 className="text-lg font-medium">Crie uma nova senha</h1>
          <p className="text-sm text-muted-foreground">
            Você entrou com uma senha temporária — defina uma senha definitiva pra continuar.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4 rounded-lg border border-border bg-card p-6">
          <PasswordField
            id="new-password"
            label="Nova senha"
            value={password}
            onChange={setPassword}
            strength={getPasswordStrength(password)}
          />

          <PasswordField id="confirm-password" label="Confirmar senha" value={confirmPassword} onChange={setConfirmPassword} />

          {error && <p className="text-sm text-destructive">{error}</p>}

          <Button type="submit" disabled={submitting}>
            {submitting ? "Salvando..." : "Salvar e continuar"}
          </Button>
        </form>
      </div>
    </div>
  );
}
