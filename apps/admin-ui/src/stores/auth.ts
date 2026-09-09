import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { isAxiosError } from 'axios';
import client from '../api/client';
import type { ApiEnvelope } from '../api/types';

interface User {
  id: string;
  email: string;
  name: string;
  roles: { id: string; name: string }[];
  /** Effective 'resource:action' codes from /auth/me; undefined = old backend → no gating */
  permissions?: string[];
  mfaEnabled?: boolean;
}

interface AuthState {
  user: User | null;
  token: string | null;
  refreshToken: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
  mfaFlowToken: string | null;
  login: (email: string, password: string) => Promise<boolean>;
  logout: () => void;
  logoutWithServer: () => Promise<void>;
  setTokens: (token: string, refreshToken: string) => void;
  fetchUser: () => Promise<void>;
  exchangeOAuthCode: (code: string) => Promise<void>;
  verifyMfa: (code: string) => Promise<boolean>;
  cancelMfa: () => void;
  hasPermission: (code: string) => boolean;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      token: null,
      refreshToken: null,
      isAuthenticated: false,
      isLoading: false,
      error: null,
      mfaFlowToken: null,

      login: async (email: string, password: string) => {
        set({ isLoading: true, error: null });
        try {
          const { data } = await client.post<ApiEnvelope<{
            mfaRequired?: boolean;
            flowToken?: string;
            accessToken?: string;
            refreshToken?: string;
            user?: User | null;
          }>>('/v1/auth/login', {
            email,
            password,
          });
          const payload = data.data;
          // MFA step-up: no tokens yet — hold the flow token, Login.tsx renders the TOTP step
          if (payload.mfaRequired === true && typeof payload.flowToken === 'string') {
            set({ mfaFlowToken: payload.flowToken, isLoading: false });
            return false;
          }
          const { accessToken, refreshToken, user } = payload as {
            accessToken: string;
            refreshToken: string;
            user: User | null;
          };
          set({
            user,
            token: accessToken,
            refreshToken,
            isAuthenticated: true,
            isLoading: false,
            mfaFlowToken: null,
          });
          return true;
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : 'Login failed';
          set({ error: message, isLoading: false, mfaFlowToken: null });
          throw error;
        }
      },

      logout: () => {
        set({
          user: null,
          token: null,
          refreshToken: null,
          isAuthenticated: false,
          error: null,
          mfaFlowToken: null,
        });
      },

      logoutWithServer: async () => {
        const { refreshToken } = get();
        if (refreshToken) {
          try {
            await client.post('/v1/auth/logout', { refreshToken });
          } catch {
            // best-effort: server may be unreachable or the session already gone
          }
        }
        get().logout();
      },

      setTokens: (token: string, refreshToken: string) => {
        set({ token, refreshToken, isAuthenticated: true });
      },

      // Complete the MFA login step-up: flowToken + TOTP/recovery code → token pair.
      // Returns false (keeping mfaFlowToken set) on a wrong/expired code so the
      // form stays visible; on success the session is established immediately.
      verifyMfa: async (code: string) => {
        const { mfaFlowToken } = get();
        if (!mfaFlowToken) return false;
        set({ isLoading: true, error: null });
        try {
          const { data } = await client.post<ApiEnvelope<{ accessToken: string; refreshToken: string }>>('/v1/auth/mfa/verify', {
            flowToken: mfaFlowToken,
            code,
          });
          const { accessToken, refreshToken } = data.data;
          set({
            token: accessToken,
            refreshToken,
            isAuthenticated: true,
            isLoading: false,
            mfaFlowToken: null,
          });
          return true;
        } catch (error: unknown) {
          set({
            isLoading: false,
            error: error instanceof Error ? error.message : 'MFA verification failed',
          });
          return false;
        }
      },

      cancelMfa: () => {
        set({ mfaFlowToken: null, error: null });
      },

      // Data-driven gate (admin holds all 9 codes via seed — no hardcoded bypass).
      // undefined permissions = legacy backend response → allow everything.
      hasPermission: (code: string) => {
        const perms = get().user?.permissions;
        return perms === undefined ? true : perms.includes(code);
      },

      fetchUser: async () => {
        const { token } = get();
        if (!token) return;
        try {
          const { data } = await client.get<ApiEnvelope<User>>('/v1/auth/me');
          set({ user: data.data, isAuthenticated: true, error: null });
        } catch (error: unknown) {
          if (isAxiosError(error) && error.response?.status === 401) {
            // Refresh already failed in the interceptor — the session is genuinely dead
            get().logout();
            return;
          }
          // Transient failure (5xx / network): keep the session, surface a retryable error
          set({ error: error instanceof Error ? error.message : 'Failed to load user' });
        }
      },

      exchangeOAuthCode: async (code: string) => {
        const { data } = await client.post<ApiEnvelope<{ accessToken: string; refreshToken: string; user: User | null }>>('/v1/auth/oauth/exchange', { code });
        if (!data.success) throw new Error(data.error?.message ?? 'OAuth exchange failed');
        const { accessToken, refreshToken, user } = data.data;
        set({
          user: user ?? null,
          token: accessToken,
          refreshToken,
          isAuthenticated: true,
        });
      },
    }),
    {
      name: 'auth-storage',
      partialize: (state) => ({
        token: state.token,
        refreshToken: state.refreshToken,
        user: state.user,
        isAuthenticated: state.isAuthenticated,
      }),
    },
  ),
);
