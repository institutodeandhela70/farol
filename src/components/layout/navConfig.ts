import {
  BarChart3,
  Briefcase,
  CalendarCheck,
  CalendarRange,
  CalendarClock,
  Filter,
  Handshake,
  Target,
  UserRound,
  FileText,
  FolderKanban,
  HandCoins,
  Package,
  Tags,
  Repeat,
  ShoppingCart,
  Wallet,
  Contact,
  CreditCard,
  FileSpreadsheet,
  GraduationCap,
  Landmark,
  LayoutDashboard,
  type LucideIcon,
  Plug,
  Receipt,
  ScrollText,
  Settings,
  ShoppingBag,
  TrendingUp,
  Upload,
  Users,
} from "lucide-react";

export interface NavLink {
  id: string;
  label: string;
  icon: LucideIcon;
}

export interface NavGroup {
  id: string;
  label: string;
  icon: LucideIcon;
  children: NavLink[];
}

export const topLevelLinks: NavLink[] = [
  { id: "dashboard", label: "Visão geral", icon: LayoutDashboard },
  { id: "eventos", label: "Eventos", icon: CalendarRange },
];

export const navGroups: NavGroup[] = [
  {
    id: "resultado",
    label: "Resultado",
    icon: BarChart3,
    children: [
      { id: "resultado/visao-geral", label: "Visão Geral", icon: LayoutDashboard },
      { id: "resultado/vendas", label: "Vendas", icon: ShoppingCart },
      { id: "resultado/receita", label: "Receita", icon: TrendingUp },
      { id: "resultado/caixa", label: "Caixa", icon: HandCoins },
      { id: "resultado/produtos", label: "Produtos", icon: Package },
      { id: "resultado/categorias", label: "Categorias IULI", icon: Tags },
    ],
  },
  {
    id: "comercial",
    label: "Comercial",
    icon: Handshake,
    children: [
      { id: "comercial/visao-geral", label: "Visão Geral", icon: LayoutDashboard },
      { id: "comercial/agenda", label: "Agenda & Produtividade", icon: CalendarClock },
      { id: "comercial/pipeline", label: "Pipeline & Previsão", icon: Filter },
      { id: "comercial/fechamento", label: "Fechamento Mensal", icon: BarChart3 },
      { id: "comercial/vendedor", label: "Ficha do Vendedor", icon: UserRound },
      { id: "comercial/metas", label: "Metas", icon: Target },
    ],
  },
  {
    id: "iuli",
    label: "Financeiro IULI",
    icon: Wallet,
    children: [
      { id: "iuli/visao-geral", label: "Visão Geral", icon: LayoutDashboard },
      { id: "iuli/vendas", label: "Vendas", icon: ShoppingCart },
      { id: "iuli/receber", label: "Contas a Receber", icon: HandCoins },
      { id: "iuli/notas", label: "Notas Fiscais", icon: FileText },
      { id: "iuli/assinaturas", label: "Assinaturas", icon: Repeat },
      { id: "iuli/cadastros", label: "Projetos & Cadastros", icon: FolderKanban },
    ],
  },
  {
    id: "dashboards",
    label: "Dashboards",
    icon: TrendingUp,
    children: [
      { id: "dashboards/hubla", label: "Hubla", icon: ShoppingBag },
      { id: "dashboards/asaas", label: "Asaas", icon: CreditCard },
      { id: "dashboards/hubspot-negocios", label: "HubSpot Negócios", icon: Briefcase },
      { id: "dashboards/hubspot-contatos", label: "HubSpot Contatos", icon: Contact },
      { id: "dashboards/hubspot-agendas", label: "HubSpot Agendas", icon: CalendarCheck },
      { id: "dashboards/hotmart", label: "Hotmart", icon: GraduationCap },
      { id: "dashboards/tmb", label: "TMB", icon: Receipt },
      { id: "dashboards/planilhas", label: "Planilhas", icon: FileSpreadsheet },
    ],
  },
  {
    id: "financeiro",
    label: "Financeiro",
    icon: Landmark,
    children: [
      { id: "financeiro/dashboard", label: "Dashboard", icon: BarChart3 },
      { id: "financeiro/receitas", label: "Receitas", icon: Upload },
    ],
  },
  {
    id: "settings",
    label: "Configurações",
    icon: Settings,
    children: [
      { id: "settings/integracoes", label: "Integrações", icon: Plug },
      { id: "settings/integracoes-logs", label: "Logs de Integrações", icon: ScrollText },
      { id: "settings/equipe", label: "Equipe", icon: Users },
      { id: "settings/geral", label: "Geral", icon: Settings },
    ],
  },
];
