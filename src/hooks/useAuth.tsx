import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Session, User } from "@supabase/supabase-js";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

interface AuthContextValue {
  user: User | null;
  session: Session | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signUp: (email: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  // loading=true só enquanto a sessão inicial (getSession) ainda não voltou.
  // Eventos posteriores (TOKEN_REFRESHED ao voltar o foco da aba, etc.) nunca
  // voltam a marcar loading=true — é isso que fazia a tela toda piscar/recarregar.
  const [loading, setLoading] = useState(true);
  const explicitSignOutRef = useRef(false);
  const previousUserIdRef = useRef<string | null>(null);
  const queryClient = useQueryClient();

  useEffect(() => {
    let mounted = true;
    let ready = false;

    const applySession = (next: Session | null) => {
      // Só troca a referência do objeto quando o token realmente mudou —
      // evita re-render em cascata de todo contexto/consumidores.
      setSession((prev) => (prev?.access_token === next?.access_token ? prev : next));
      setUser((prev) => {
        const nextId = next?.user?.id ?? null;
        const prevId = prev?.id ?? null;
        if (prevId === nextId) return prev;
        return next?.user ?? null;
      });

      const nextId = next?.user?.id ?? null;
      const prevId = previousUserIdRef.current;
      if (prevId !== nextId && prevId !== null) {
        queryClient.clear();
      }
      previousUserIdRef.current = nextId;
    };

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      applySession(data.session);
      ready = true;
      setLoading(false);
    });

    const { data: subscription } = supabase.auth.onAuthStateChange((event, newSession) => {
      if (!mounted) return;

      if (event === "SIGNED_OUT") {
        if (explicitSignOutRef.current) {
          explicitSignOutRef.current = false;
          applySession(null);
        } else {
          // SIGNED_OUT espúrio (rotação de refresh token / troca de foco entre
          // abas). Tenta recuperar a sessão antes de aceitar o logout.
          (async () => {
            const { data: stored } = await supabase.auth.getSession();
            if (!mounted) return;
            if (stored.session) {
              applySession(stored.session);
              return;
            }
            const { data: refreshed } = await supabase.auth.refreshSession();
            if (!mounted) return;
            applySession(refreshed.session ?? null);
          })();
        }
        if (!ready) {
          ready = true;
          setLoading(false);
        }
        return;
      }

      applySession(newSession);
      if (!ready) {
        ready = true;
        setLoading(false);
      }
    });

    return () => {
      mounted = false;
      subscription.subscription.unsubscribe();
    };
  }, [queryClient]);

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error?.message ?? null };
  };

  const signUp = async (email: string, password: string) => {
    const { error } = await supabase.auth.signUp({ email, password });
    return { error: error?.message ?? null };
  };

  const signOut = async () => {
    explicitSignOutRef.current = true;
    await supabase.auth.signOut();
  };

  return (
    <AuthContext.Provider value={{ user, session, loading, signIn, signUp, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth deve ser usado dentro de um AuthProvider");
  return ctx;
}
