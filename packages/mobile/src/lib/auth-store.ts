import { create } from "zustand";
import { supabase } from "./supabase";
import type { Session } from "@supabase/supabase-js";

interface AuthState {
  session: Session | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  initialize: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  session: null,
  isLoading: true,
  isAuthenticated: false,

  initialize: async () => {
    const { data: { session } } = await supabase.auth.getSession();
    set({
      session,
      isAuthenticated: !!session,
      isLoading: false,
    });

    supabase.auth.onAuthStateChange((_event, session) => {
      set({
        session,
        isAuthenticated: !!session,
      });
    });
  },
}));
