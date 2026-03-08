"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import { useRouter, usePathname } from "next/navigation";
import { createSupabaseBrowserClient } from "./supabase";
import type { Session, SupabaseClient } from "@supabase/supabase-js";

interface AuthContextValue {
  session: Session | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  session: null,
  isAuthenticated: false,
  isLoading: true,
  logout: async () => {},
});

// Lazy singleton — created on first access so SSG pre-rendering
// never triggers the Supabase client constructor (which throws
// if env vars are missing).
let _supabase: SupabaseClient | null = null;

function getSupabase(): SupabaseClient {
  if (!_supabase) {
    _supabase = createSupabaseBrowserClient();
  }
  return _supabase;
}

export { getSupabase };

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    const sb = getSupabase();

    sb.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setIsLoading(false);
    });

    const { data: { subscription } } = sb.auth.onAuthStateChange(
      (_event, session) => {
        setSession(session);
        setIsLoading(false);
      },
    );

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!isLoading && !session && pathname !== "/login") {
      router.replace("/login");
    }
  }, [isLoading, session, pathname, router]);

  const logout = useCallback(async () => {
    await getSupabase().auth.signOut();
    router.replace("/login");
  }, [router]);

  return (
    <AuthContext.Provider
      value={{
        session,
        isAuthenticated: !!session,
        isLoading,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
