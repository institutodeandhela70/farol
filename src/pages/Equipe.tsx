import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import { useWorkspace, type WorkspaceRole } from "@/hooks/WorkspaceProvider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Checkbox } from "@/components/ui/checkbox";
import { Copy, Check, KeyRound, ShieldCheck, UserX, UserCheck } from "lucide-react";

type AssignableRole = "admin" | "manager" | "vendedor";
type ConfigurableRole = "manager" | "vendedor";

interface MemberRow {
  membership_id: string;
  user_id: string;
  email: string;
  full_name: string | null;
  role: WorkspaceRole;
  is_active: boolean;
  must_change_password: boolean;
  joined_at: string | null;
  created_at: string;
}

interface PermissionKeyRow {
  key: string;
  category: string;
  label: string;
  sort_order: number;
}

const ROLE_LABEL: Record<WorkspaceRole, string> = {
  owner: "Proprietário",
  admin: "Admin",
  manager: "Gerente",
  vendedor: "Vendedor",
};

const ROLE_BADGE_VARIANT: Record<WorkspaceRole, "default" | "secondary" | "outline"> = {
  owner: "default",
  admin: "default",
  manager: "secondary",
  vendedor: "outline",
};

const ASSIGNABLE_ROLES: AssignableRole[] = ["admin", "manager", "vendedor"];

const CATEGORY_LABEL: Record<string, string> = {
  top: "Geral",
  comercial: "Comercial",
  iuli: "Financeiro IULI",
  dashboards: "Dashboards",
  financeiro: "Financeiro",
  settings: "Configurações",
};

function groupByCategory(keys: PermissionKeyRow[]): { category: string; items: PermissionKeyRow[] }[] {
  const order: string[] = [];
  const byCategory = new Map<string, PermissionKeyRow[]>();
  for (const k of keys) {
    if (!byCategory.has(k.category)) {
      byCategory.set(k.category, []);
      order.push(k.category);
    }
    byCategory.get(k.category)!.push(k);
  }
  return order.map((category) => ({ category, items: byCategory.get(category)! }));
}

// navigator.clipboard.writeText falha (permissão negada, contexto não-seguro)
// em alguns navegadores/ambientes — cai pra document.execCommand como reserva
// em vez de deixar uma promise rejeitada sem tratamento.
async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const el = document.createElement("textarea");
      el.value = text;
      el.style.position = "fixed";
      el.style.opacity = "0";
      document.body.appendChild(el);
      el.focus();
      el.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(el);
      return ok;
    } catch {
      return false;
    }
  }
}

function CopyableSecret({ value }: { value: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");

  const handleCopy = async () => {
    const ok = await copyToClipboard(value);
    setState(ok ? "copied" : "failed");
    setTimeout(() => setState("idle"), 2000);
  };

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2">
        <code className="flex-1 text-sm">{value}</code>
        <Button type="button" size="sm" variant="outline" onClick={handleCopy}>
          {state === "copied" ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          {state === "copied" ? "Copiado" : "Copiar"}
        </Button>
      </div>
      {state === "failed" && (
        <p className="text-xs text-destructive">Não deu pra copiar automaticamente — selecione o texto e copie manualmente.</p>
      )}
    </div>
  );
}

function buildWhatsAppMessage(params: {
  name: string;
  email: string;
  password: string;
  isReset: boolean;
}): string {
  const { name, email, password, isReset } = params;
  const loginUrl = `${window.location.origin}/auth`;

  if (isReset) {
    return `Olá, ${name}! 👋\n\nSua senha no Farol ID foi redefinida. Aqui estão seus novos dados de acesso:\n\n🔗 Link: ${loginUrl}\n👤 Usuário: ${email}\n🔑 Nova senha temporária: ${password}\n\n⚠️ Por segurança, você será solicitado a trocar a senha no primeiro acesso.\n\nQualquer dúvida, é só chamar!`;
  }

  return `Olá, ${name}! 👋\n\nSua conta no Farol ID foi criada. Aqui estão seus dados de acesso:\n\n🔗 Link: ${loginUrl}\n👤 Usuário: ${email}\n🔑 Senha temporária: ${password}\n\n⚠️ Por segurança, você será solicitado a trocar a senha no primeiro acesso.\n\nQualquer dúvida, é só chamar!`;
}

function CopyableMessage({ value }: { value: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");

  const handleCopy = async () => {
    const ok = await copyToClipboard(value);
    setState(ok ? "copied" : "failed");
    setTimeout(() => setState("idle"), 2500);
  };

  return (
    <div className="flex flex-col gap-2">
      <textarea
        readOnly
        value={value}
        rows={8}
        onFocus={(e) => e.currentTarget.select()}
        className="rounded-md border border-input bg-background px-3 py-2 text-xs"
      />
      <Button type="button" variant="outline" onClick={handleCopy} className="gap-2">
        {state === "copied" ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
        {state === "copied" ? "Copiado!" : "Copiar mensagem"}
      </Button>
      {state === "failed" && (
        <p className="text-xs text-destructive">Não deu pra copiar automaticamente — clique no texto acima, ele já vem selecionado, e copie com Ctrl+C.</p>
      )}
    </div>
  );
}

export default function Equipe() {
  const { workspace, role: myRole } = useWorkspace();
  const { user } = useAuth();

  const [members, setMembers] = useState<MemberRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [rowFeedback, setRowFeedback] = useState<string | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState<{ full_name: string; email: string; role: AssignableRole }>({
    full_name: "",
    email: "",
    role: "vendedor",
  });
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createResult, setCreateResult] = useState<{
    temporary_password: string;
    email_sent: boolean;
    email: string;
    full_name: string;
  } | null>(null);

  const [resetTarget, setResetTarget] = useState<MemberRow | null>(null);
  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const [resetResult, setResetResult] = useState<{ temporary_password: string; email_sent: boolean } | null>(null);

  const [permissionKeys, setPermissionKeys] = useState<PermissionKeyRow[]>([]);
  const [rolePerms, setRolePerms] = useState<Map<string, boolean>>(new Map());

  const [overrideTarget, setOverrideTarget] = useState<MemberRow | null>(null);
  const [overrides, setOverrides] = useState<Map<string, boolean>>(new Map());

  const loadMembers = async () => {
    if (!workspace) return;
    setLoading(true);
    const { data, error } = await supabase.rpc("workspace_list_members", { p_workspace_id: workspace.id });
    if (!error) setMembers((data as MemberRow[]) ?? []);
    setLoading(false);
  };

  const loadMatrix = async () => {
    if (!workspace) return;
    const [{ data: keys }, { data: perms }] = await Promise.all([
      supabase.from("permission_keys").select("key, category, label, sort_order").order("sort_order"),
      supabase
        .from("role_permissions")
        .select("role, permission_key, granted")
        .eq("workspace_id", workspace.id),
    ]);
    setPermissionKeys((keys as PermissionKeyRow[]) ?? []);
    const map = new Map<string, boolean>();
    for (const p of (perms as { role: ConfigurableRole; permission_key: string; granted: boolean }[]) ?? []) {
      map.set(`${p.role}:${p.permission_key}`, p.granted);
    }
    setRolePerms(map);
  };

  useEffect(() => {
    loadMembers();
    loadMatrix();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace?.id]);

  const openOverrides = async (member: MemberRow) => {
    if (!workspace) return;
    setOverrideTarget(member);
    const { data } = await supabase
      .from("user_permission_overrides")
      .select("permission_key, granted")
      .eq("workspace_id", workspace.id)
      .eq("user_id", member.user_id);
    const map = new Map<string, boolean>();
    for (const o of (data as { permission_key: string; granted: boolean }[]) ?? []) {
      map.set(o.permission_key, o.granted);
    }
    setOverrides(map);
  };

  // Grava sempre um override explícito pra esse usuário — o checkbox mostra
  // o acesso que ele TEM agora (perfil + override), e marcar/desmarcar muda
  // isso diretamente, sem precisar de uma tela separada de "perfil padrão".
  const toggleUserPermission = async (key: string, granted: boolean) => {
    if (!overrideTarget || !workspace) return;
    await supabase
      .from("user_permission_overrides")
      .upsert(
        { workspace_id: workspace.id, user_id: overrideTarget.user_id, permission_key: key, granted },
        { onConflict: "workspace_id,user_id,permission_key" },
      );
    setOverrides((prev) => new Map(prev).set(key, granted));
  };

  const closeCreateDialog = () => {
    setCreateOpen(false);
    setCreateForm({ full_name: "", email: "", role: "vendedor" });
    setCreateResult(null);
    setCreateError(null);
  };

  const handleCreate = async () => {
    if (!workspace) return;
    if (!createForm.full_name.trim() || !createForm.email.trim()) {
      setCreateError("Preencha nome e e-mail.");
      return;
    }

    setCreating(true);
    setCreateError(null);

    const { data, error } = await supabase.functions.invoke("create-team-member-with-password", {
      body: {
        workspace_id: workspace.id,
        email: createForm.email.trim(),
        full_name: createForm.full_name.trim(),
        role: createForm.role,
      },
    });

    setCreating(false);

    if (error || data?.error) {
      setCreateError(data?.error ?? error?.message ?? "Falha ao cadastrar usuário.");
      return;
    }

    setCreateResult({
      temporary_password: data.temporary_password,
      email_sent: data.email_sent,
      email: createForm.email.trim(),
      full_name: createForm.full_name.trim(),
    });
    await loadMembers();
  };

  const handleRoleChange = async (member: MemberRow, role: AssignableRole) => {
    setRowFeedback(null);
    const { error } = await supabase.from("workspace_members").update({ role }).eq("id", member.membership_id);
    if (error) {
      setRowFeedback(`Falha ao trocar perfil de ${member.full_name ?? member.email}: ${error.message}`);
      return;
    }
    await loadMembers();
  };

  const handleToggleActive = async (member: MemberRow) => {
    setRowFeedback(null);
    const { error } = await supabase
      .from("workspace_members")
      .update({ is_active: !member.is_active })
      .eq("id", member.membership_id);
    if (error) {
      setRowFeedback(`Falha ao atualizar status de ${member.full_name ?? member.email}: ${error.message}`);
      return;
    }
    await loadMembers();
  };

  const closeResetDialog = () => {
    setResetTarget(null);
    setResetResult(null);
    setResetError(null);
  };

  const submitReset = async () => {
    if (!resetTarget || !workspace) return;
    setResetting(true);
    setResetError(null);

    const { data, error } = await supabase.functions.invoke("reset-workspace-member-password", {
      body: { workspace_id: workspace.id, user_id: resetTarget.user_id },
    });

    setResetting(false);

    if (error || data?.error) {
      setResetError(data?.error ?? error?.message ?? "Falha ao resetar senha.");
      return;
    }

    setResetResult({ temporary_password: data.temporary_password, email_sent: data.email_sent });
    await loadMembers();
  };

  if (loading) {
    return <div className="p-6 text-sm text-muted-foreground">Carregando...</div>;
  }

  const groupedPermissions = groupByCategory(permissionKeys);

  return (
    <div className="p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-medium">Equipe</h1>
          <p className="mt-1 text-sm text-muted-foreground">Usuários e permissões deste workspace.</p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>Cadastrar usuário</Button>
      </div>

      {rowFeedback && <p className="mt-4 text-sm text-destructive">{rowFeedback}</p>}

      <div className="mt-6 overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-muted-foreground">
            <tr>
              <th className="px-4 py-2 font-medium">Nome</th>
              <th className="px-4 py-2 font-medium">E-mail</th>
              <th className="px-4 py-2 font-medium">Perfil</th>
              <th className="px-4 py-2 font-medium">Status</th>
              <th className="px-4 py-2 font-medium">Ações</th>
            </tr>
          </thead>
          <tbody>
            {members.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">
                  Nenhum membro ainda.
                </td>
              </tr>
            )}
            {members.map((m) => {
              const isSelf = m.user_id === user?.id;
              const isOwner = m.role === "owner";
              const canManage = !isOwner && !isSelf && (myRole === "owner" || myRole === "admin");

              return (
                <tr key={m.membership_id} className="border-t border-border">
                  <td className="px-4 py-2">
                    {m.full_name ?? "—"}
                    {isSelf && <span className="text-muted-foreground"> (você)</span>}
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">{m.email}</td>
                  <td className="px-4 py-2">
                    {canManage ? (
                      <select
                        value={m.role}
                        onChange={(e) => handleRoleChange(m, e.target.value as AssignableRole)}
                        className="h-8 rounded-md border border-input bg-background px-2 text-sm"
                      >
                        {ASSIGNABLE_ROLES.filter((r) => r !== "admin" || myRole === "owner").map((r) => (
                          <option key={r} value={r}>
                            {ROLE_LABEL[r]}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <Badge variant={ROLE_BADGE_VARIANT[m.role]}>{ROLE_LABEL[m.role]}</Badge>
                    )}
                  </td>
                  <td className="px-4 py-2">
                    {!m.is_active ? (
                      <span className="text-muted-foreground">Inativo</span>
                    ) : m.must_change_password ? (
                      <span className="text-muted-foreground">Precisa trocar senha</span>
                    ) : (
                      <span className="text-primary">Ativo</span>
                    )}
                  </td>
                  <td className="px-4 py-2">
                    {canManage && (
                      <div className="flex items-center gap-1">
                        <Button
                          variant="outline"
                          size="icon"
                          className="size-8"
                          title="Resetar senha"
                          onClick={() => setResetTarget(m)}
                        >
                          <KeyRound className="size-4" />
                        </Button>
                        {(m.role === "manager" || m.role === "vendedor") && (
                          <Button
                            variant="outline"
                            size="icon"
                            className="size-8"
                            title="Permissões individuais"
                            onClick={() => openOverrides(m)}
                          >
                            <ShieldCheck className="size-4" />
                          </Button>
                        )}
                        <Button
                          variant="outline"
                          size="icon"
                          className="size-8"
                          title={m.is_active ? "Desativar" : "Reativar"}
                          onClick={() => handleToggleActive(m)}
                        >
                          {m.is_active ? <UserX className="size-4" /> : <UserCheck className="size-4" />}
                        </Button>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* --- Dialog: cadastrar usuário --- */}
      <Dialog open={createOpen} onOpenChange={(o) => (o ? setCreateOpen(true) : closeCreateDialog())}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cadastrar usuário</DialogTitle>
            <DialogDescription>
              {createResult
                ? "Usuário criado. Compartilhe a senha temporária abaixo — ela só aparece aqui, uma vez."
                : "Cria a conta com uma senha temporária e envia por e-mail via Brevo."}
            </DialogDescription>
          </DialogHeader>

          {createResult ? (
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <Label>Senha temporária</Label>
                <CopyableSecret value={createResult.temporary_password} />
              </div>
              <p className={createResult.email_sent ? "text-sm text-primary" : "text-sm text-destructive"}>
                {createResult.email_sent
                  ? "E-mail de boas-vindas enviado."
                  : "Não foi possível enviar o e-mail — compartilhe a senha manualmente."}
              </p>
              <div className="flex flex-col gap-1.5">
                <Label>Mensagem pra enviar por WhatsApp</Label>
                <CopyableMessage
                  value={buildWhatsAppMessage({
                    name: createResult.full_name,
                    email: createResult.email,
                    password: createResult.temporary_password,
                    isReset: false,
                  })}
                />
              </div>
              <DialogFooter>
                <Button onClick={closeCreateDialog}>Concluir</Button>
              </DialogFooter>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="equipe-name">Nome completo</Label>
                <Input
                  id="equipe-name"
                  value={createForm.full_name}
                  onChange={(e) => setCreateForm((f) => ({ ...f, full_name: e.target.value }))}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="equipe-email">E-mail</Label>
                <Input
                  id="equipe-email"
                  type="email"
                  value={createForm.email}
                  onChange={(e) => setCreateForm((f) => ({ ...f, email: e.target.value }))}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="equipe-role">Perfil</Label>
                <select
                  id="equipe-role"
                  value={createForm.role}
                  onChange={(e) => setCreateForm((f) => ({ ...f, role: e.target.value as AssignableRole }))}
                  className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                >
                  {ASSIGNABLE_ROLES.filter((r) => r !== "admin" || myRole === "owner").map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABEL[r]}
                    </option>
                  ))}
                </select>
              </div>

              {createError && <p className="text-sm text-destructive">{createError}</p>}

              <DialogFooter>
                <Button onClick={handleCreate} disabled={creating}>
                  {creating ? "Cadastrando..." : "Cadastrar"}
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* --- Dialog: resetar senha --- */}
      <Dialog open={!!resetTarget} onOpenChange={(o) => !o && closeResetDialog()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Resetar senha</DialogTitle>
            <DialogDescription>
              {resetResult
                ? "Nova senha temporária gerada. Compartilhe abaixo — ela só aparece aqui, uma vez."
                : `Gera uma nova senha temporária para ${resetTarget?.full_name ?? resetTarget?.email} e força a troca no próximo login.`}
            </DialogDescription>
          </DialogHeader>

          {resetResult ? (
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <Label>Senha temporária</Label>
                <CopyableSecret value={resetResult.temporary_password} />
              </div>
              <p className={resetResult.email_sent ? "text-sm text-primary" : "text-sm text-destructive"}>
                {resetResult.email_sent
                  ? "E-mail enviado."
                  : "Não foi possível enviar o e-mail — compartilhe a senha manualmente."}
              </p>
              <div className="flex flex-col gap-1.5">
                <Label>Mensagem pra enviar por WhatsApp</Label>
                <CopyableMessage
                  value={buildWhatsAppMessage({
                    name: resetTarget?.full_name ?? resetTarget?.email ?? "",
                    email: resetTarget?.email ?? "",
                    password: resetResult.temporary_password,
                    isReset: true,
                  })}
                />
              </div>
              <DialogFooter>
                <Button onClick={closeResetDialog}>Concluir</Button>
              </DialogFooter>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {resetError && <p className="text-sm text-destructive">{resetError}</p>}
              <DialogFooter>
                <Button variant="outline" onClick={closeResetDialog} disabled={resetting}>
                  Cancelar
                </Button>
                <Button onClick={submitReset} disabled={resetting}>
                  {resetting ? "Resetando..." : "Resetar senha"}
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* --- Sheet: permissões do usuário --- */}
      <Sheet open={!!overrideTarget} onOpenChange={(o) => !o && setOverrideTarget(null)}>
        <SheetContent className="overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Permissões de {overrideTarget?.full_name ?? overrideTarget?.email}</SheetTitle>
            <SheetDescription>
              O que essa pessoa pode acessar. Já vem marcado conforme o perfil ({overrideTarget && ROLE_LABEL[overrideTarget.role]}) —
              marque ou desmarque pra mudar só o acesso dela.
            </SheetDescription>
          </SheetHeader>

          <div className="mt-4 flex flex-col gap-4">
            {groupedPermissions.map((group) => (
              <div key={group.category}>
                <p className="mb-1.5 text-xs font-medium text-muted-foreground">
                  {CATEGORY_LABEL[group.category] ?? group.category}
                </p>
                <div className="flex flex-col gap-2">
                  {group.items.map((item) => {
                    const roleDefault = overrideTarget ? rolePerms.get(`${overrideTarget.role}:${item.key}`) ?? false : false;
                    const effective = overrides.has(item.key) ? overrides.get(item.key)! : roleDefault;
                    return (
                      <label key={item.key} className="flex items-center justify-between gap-2 text-sm">
                        <span>{item.label}</span>
                        <Checkbox
                          checked={effective}
                          onCheckedChange={(checked) => toggleUserPermission(item.key, checked === true)}
                        />
                      </label>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
