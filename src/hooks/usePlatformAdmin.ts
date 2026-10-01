import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";

export function usePlatformAdmin() {
  const { user, loading: authLoading } = useAuth();
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setIsAdmin(false);
      setLoading(false);
      return;
    }

    setLoading(true);
    supabase.rpc("is_platform_admin").then(({ data, error }) => {
      setIsAdmin(!error && data === true);
      setLoading(false);
    });
  }, [user, authLoading]);

  return { isAdmin, loading: authLoading || loading };
}
