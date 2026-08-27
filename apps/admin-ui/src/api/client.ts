import axios from 'axios';
import { useAuthStore } from '../stores/auth';

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

client.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (error.response?.status === 401) {
      const { refreshToken, logout } = useAuthStore.getState();
      if (refreshToken && !error.config._retry) {
        error.config._retry = true;
        try {
          const { data } = await axios.post('/api/v1/auth/refresh', {
            refreshToken,
          });
          useAuthStore.getState().setTokens(data.accessToken, data.refreshToken);
          error.config.headers.Authorization = `Bearer ${data.accessToken}`;
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
