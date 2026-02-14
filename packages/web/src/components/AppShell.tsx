"use client";

import { usePathname } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { Navigation } from "./Navigation";

export function AppShell({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();
  const pathname = usePathname();

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-200 border-t-[#2D7D46]" />
      </div>
    );
  }

  const isLoginPage = pathname === "/login";

  if (!isAuthenticated || isLoginPage) {
    return <>{children}</>;
  }

  return (
    <div className="flex min-h-screen">
      <Navigation />
      <main className="ml-56 flex-1 bg-gray-50 p-6">{children}</main>
    </div>
  );
}
