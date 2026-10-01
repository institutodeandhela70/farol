-- Config, templates e log de e-mail transacional (Brevo). Escopo global (não
-- por workspace): são e-mails de sistema (boas-vindas com senha temporária,
-- reset de senha), não comunicação de negócio de um tenant específico. Só
-- platform_admins configura/lê isso — mesmo padrão de acesso de platform_admins.
create table if not exists public.email_settings (
  id integer primary key default 1,
  sender_name text not null default 'Farol ID',
  sender_email text,
  reply_to text,
  updated_at timestamptz not null default now(),
  constraint email_settings_singleton check (id = 1)
);

insert into public.email_settings (id) values (1) on conflict (id) do nothing;

create table if not exists public.email_templates (
  key text primary key,
  subject text not null,
  html_content text not null,
  is_active boolean not null default true,
  updated_at timestamptz not null default now()
);

create table if not exists public.email_send_log (
  id uuid primary key default gen_random_uuid(),
  template_key text references public.email_templates(key),
  workspace_id uuid references public.workspaces(id) on delete set null,
  to_email text not null,
  subject text not null,
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed')),
  brevo_message_id text,
  error_message text,
  created_at timestamptz not null default now()
);

alter table public.email_settings enable row level security;
alter table public.email_templates enable row level security;
alter table public.email_send_log enable row level security;

drop policy if exists "email_settings_platform_admin" on public.email_settings;
create policy "email_settings_platform_admin"
  on public.email_settings for all
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

drop policy if exists "email_templates_platform_admin" on public.email_templates;
create policy "email_templates_platform_admin"
  on public.email_templates for all
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

drop policy if exists "email_send_log_platform_admin_select" on public.email_send_log;
create policy "email_send_log_platform_admin_select"
  on public.email_send_log for select
  using (public.is_platform_admin());

insert into public.email_templates (key, subject, html_content) values
(
  'welcome-team-member',
  'Bem-vindo(a) ao Farol ID',
  '<div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
    <h1 style="font-size: 20px;">Olá, {{name}}!</h1>
    <p>Sua conta no Farol ID foi criada. Use os dados abaixo para o primeiro acesso:</p>
    <p><strong>E-mail:</strong> {{email}}<br/>
    <strong>Senha temporária:</strong> {{temporaryPassword}}</p>
    <p>No primeiro login você será solicitado a criar uma nova senha.</p>
    <p><a href="{{loginUrl}}" style="display:inline-block;padding:10px 16px;background:#111;color:#fff;text-decoration:none;border-radius:6px;">Acessar o Farol ID</a></p>
  </div>'
),
(
  'password-reset',
  'Sua senha foi redefinida',
  '<div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
    <h1 style="font-size: 20px;">Olá, {{name}}!</h1>
    <p>Sua senha no Farol ID foi redefinida por um administrador. Use a senha temporária abaixo para entrar:</p>
    <p><strong>Senha temporária:</strong> {{temporaryPassword}}</p>
    <p>No próximo login você será solicitado a criar uma nova senha.</p>
    <p><a href="{{loginUrl}}" style="display:inline-block;padding:10px 16px;background:#111;color:#fff;text-decoration:none;border-radius:6px;">Acessar o Farol ID</a></p>
  </div>'
)
on conflict (key) do nothing;
