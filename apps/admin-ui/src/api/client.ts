import axios from 'axios';
import { useAuthStore } from '../stores/auth';
import type { ApiEnvelope } from './types';

const client = axios.create({
  baseURL: '/api',
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
  },
});

client.interceptors.request.use(
  (config) => {
    const { token } = useAuthStore.getState();
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error),
);

interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

// Single-flight: concurrent 401s share one refresh instead of racing to rotate
// the same token (rotation replay would make all but the first fail).
let refreshInFlight: Promise<TokenPair> | null = null;

async function requestTokenPair(refreshToken: string): Promise<TokenPair> {
  const { data } = await axios.post<ApiEnvelope<TokenPair>>('/api/v1/auth/refresh', { refreshToken });
  // Server envelope (routes/auth.ts:374-377): { success, data: { accessToken, refreshToken, expiresIn } }
  const pair: TokenPair | undefined = data?.data;
  if (typeof pair?.accessToken !== 'string' || typeof pair?.refreshToken !== 'string') {
    throw new Error('Refresh response missing token pair');
  }
  useAuthStore.getState().setTokens(pair.accessToken, pair.refreshToken);
  return pair;
}

client.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (error.response?.status === 401) {
      const { refreshToken, logout } = useAuthStore.getState();
      if (refreshToken && !error.config._retry) {
        error.config._retry = true;
        try {
          refreshInFlight ??= requestTokenPair(refreshToken).finally(() => {
            refreshInFlight = null;
          });
          const pair = await refreshInFlight;
          error.config.headers.Authorization = `Bearer ${pair.accessToken}`;
          return client(error.config);
        } catch {
          logout();
        }
      } else {
        logout();
      }
    }
    return Promise.reject(error);
  },
);

export default client;
