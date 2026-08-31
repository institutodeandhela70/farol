import {
  Briefcase,
  CalendarCheck,
  Contact,
  CreditCard,
  FileSpreadsheet,
  GraduationCap,
  LayoutDashboard,
  type LucideIcon,
  Plug,
  Settings,
  ShoppingBag,
  TrendingUp,
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
];

export const navGroups: NavGroup[] = [
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
      { id: "dashboards/tmb", label: "TMB", icon: TrendingUp },
      { id: "dashboards/planilhas", label: "Planilhas", icon: FileSpreadsheet },
    ],
  },
  {
    id: "settings",
    label: "Configurações",
    icon: Settings,
    children: [
      { id: "settings/integracoes", label: "Integrações", icon: Plug },
      { id: "settings/equipe", label: "Equipe", icon: Users },
      { id: "settings/geral", label: "Geral", icon: Settings },
    ],
  },
];
