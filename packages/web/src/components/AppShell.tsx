"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { Navigation } from "./Navigation";

export function AppShell({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();
  const pathname = usePathname();
  const [navOpen, setNavOpen] = useState(false);

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-200 border-t-[#2D7D46]" />
      </div>
    );
  }

  const isLoginPage = pathname === "/login";
  const isOnboardingPage = pathname === "/onboarding";

  if (!isAuthenticated || isLoginPage || isOnboardingPage) {
    return <>{children}</>;
  }

  return (
    <div className="flex min-h-screen">
      {/* Mobile top bar */}
      <header className="fixed left-0 right-0 top-0 z-30 flex h-14 items-center gap-3 border-b border-gray-200 bg-white px-4 md:hidden">
        <button
          onClick={() => setNavOpen(true)}
          className="rounded-lg p-1.5 text-gray-600 hover:bg-gray-100"
        >
          <HamburgerIcon />
        </button>
        <span className="text-lg font-bold text-[#2D7D46]">Gardoo</span>
      </header>

      <Navigation open={navOpen} onClose={() => setNavOpen(false)} />

      <main className="min-w-0 flex-1 bg-gray-50 p-4 pt-18 md:ml-56 md:p-6 md:pt-6">
        {children}
      </main>
    </div>
  );
}

function HamburgerIcon() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="3" y1="18" x2="21" y2="18" />
    </svg>
  );
}
