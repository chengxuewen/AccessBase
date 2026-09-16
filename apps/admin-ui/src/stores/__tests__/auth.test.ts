import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the API client — stores/auth.ts imports from '../api/client'
vi.mock('../../api/client.js', () => ({
  default: {
    post: vi.fn(),
    get: vi.fn(),
  },
}));

import client from '../../api/client.js';
import { useAuthStore } from '../auth.js';

const mockedPost = vi.mocked(client.post);

function mfaPayload(flowToken: string) {
  return { data: { success: true, data: { mfaRequired: true, flowToken } } };
}

function sessionPayload(accessToken: string, refreshToken: string) {
  return {
    data: {
      success: true,
      data: { accessToken, refreshToken, user: { id: 'u1', email: 'a@b.com', name: 'A', roles: [] } },
    },
  };
}

describe('auth store — MFA branch hygiene', () => {
  beforeEach(() => {
    // Reset the store to a clean state between tests
    useAuthStore.setState({
      user: null,
      token: 'old-token',
      refreshToken: 'old-refresh',
      isAuthenticated: true,
      mfaFlowToken: null,
      error: null,
      isLoading: false,
    });
    mockedPost.mockReset();
  });

  it('exchangeOAuthCode: mfaRequired clears token/refreshToken/user + sets flowToken', async () => {
    mockedPost.mockResolvedValueOnce(mfaPayload('ft-oauth-123'));

    await useAuthStore.getState().exchangeOAuthCode('some-code');

    const state = useAuthStore.getState();
    expect(state.mfaFlowToken).toBe('ft-oauth-123');
    expect(state.token).toBeNull();
    expect(state.refreshToken).toBeNull();
    expect(state.user).toBeNull();
    expect(state.isAuthenticated).toBe(false);
  });

  it('exchangeSamlCode: mfaRequired clears token/refreshToken/user + sets flowToken', async () => {
    mockedPost.mockResolvedValueOnce(mfaPayload('ft-saml-456'));

    await useAuthStore.getState().exchangeSamlCode('some-code');

    const state = useAuthStore.getState();
    expect(state.mfaFlowToken).toBe('ft-saml-456');
    expect(state.token).toBeNull();
    expect(state.refreshToken).toBeNull();
    expect(state.user).toBeNull();
    expect(state.isAuthenticated).toBe(false);
  });

  it('exchangeOAuthCode: non-MFA path sets session tokens', async () => {
    mockedPost.mockResolvedValueOnce(sessionPayload('new-token', 'new-refresh'));

    await useAuthStore.getState().exchangeOAuthCode('code-ok');

    const state = useAuthStore.getState();
    expect(state.token).toBe('new-token');
    expect(state.refreshToken).toBe('new-refresh');
    expect(state.isAuthenticated).toBe(true);
    expect(state.mfaFlowToken).toBeNull();
  });
});
