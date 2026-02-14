import * as SecureStore from "expo-secure-store";
import { create } from "zustand";

const TOKEN_KEY = "gardoo_auth_token";

interface AuthState {
  token: string | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  setToken: (token: string) => Promise<void>;
  clearToken: () => Promise<void>;
  loadToken: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  token: null,
  isLoading: true,
  isAuthenticated: false,

  setToken: async (token: string) => {
    await SecureStore.setItemAsync(TOKEN_KEY, token);
    set({ token, isAuthenticated: true });
  },

  clearToken: async () => {
    await SecureStore.deleteItemAsync(TOKEN_KEY);
    set({ token: null, isAuthenticated: false });
  },

  loadToken: async () => {
    try {
      const token = await SecureStore.getItemAsync(TOKEN_KEY);
      set({
        token,
        isAuthenticated: token !== null,
        isLoading: false,
      });
    } catch {
      set({ token: null, isAuthenticated: false, isLoading: false });
    }
  },
}));
