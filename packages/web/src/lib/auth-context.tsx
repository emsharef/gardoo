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

interface AuthContextValue {
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (token: string) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue>({
  token: null,
  isAuthenticated: false,
  isLoading: true,
  login: () => {},
  logout: () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    const stored = localStorage.getItem("gardoo_token");
    if (stored) {
      setToken(stored);
    }
    setIsLoading(false);
  }, []);

  useEffect(() => {
    if (!isLoading && !token && pathname !== "/login") {
      router.replace("/login");
    }
  }, [isLoading, token, pathname, router]);

  const login = useCallback(
    (newToken: string) => {
      localStorage.setItem("gardoo_token", newToken);
      setToken(newToken);
      router.replace("/");
    },
    [router],
  );

  const logout = useCallback(() => {
    localStorage.removeItem("gardoo_token");
    setToken(null);
    router.replace("/login");
  }, [router]);

  return (
    <AuthContext.Provider
      value={{
        token,
        isAuthenticated: !!token,
        isLoading,
        login,
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
