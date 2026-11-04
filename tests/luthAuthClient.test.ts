import { afterEach, describe, expect, it, vi } from 'vitest';
import { LuthAuthClient, type LuthAuthTokenStore } from '../src/auth/luthAuthClient.js';

function tokenStore(initial = ''): LuthAuthTokenStore {
  let token = initial;
  return {
    get: () => token,
    set: (value) => { token = value; },
    clear: () => { token = ''; },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('LuthAuthClient', () => {
  it('captures the bearer token issued by Luth and sends it on later requests', async () => {
    const store = tokenStore();
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({
        registered: true,
        ecosystemId: 'ultrst-armada',
        applicationId: 'test',
        origin: 'https://test.example',
        environment: 'production',
        authenticationEnabled: true,
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        authenticated: true,
        user: { id: 'u1', name: 'Test', email: 'test@example.com' },
        session: { id: 's1', userId: 'u1', expiresAt: new Date().toISOString() },
      }), { status: 200, headers: { 'set-auth-token': 'token-1' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        authenticated: true,
        user: { id: 'u1', name: 'Test', email: 'test@example.com' },
        session: { id: 's1', userId: 'u1', expiresAt: new Date().toISOString() },
      }), { status: 200 }));

    const client = new LuthAuthClient({
      ecosystemId: 'ultrst-armada',
      applicationId: 'test',
      origin: 'https://test.example',
      tokenStore: store,
    });

    await client.getSession();
    expect(store.get()).toBe('token-1');
    await client.getSession();

    const secondSessionRequest = fetchMock.mock.calls[2]?.[1];
    const headers = new Headers(secondSessionRequest?.headers);
    expect(headers.get('authorization')).toBe('Bearer token-1');
  });

  it('clears the token only after a successful sign-out and verifies invalidation', async () => {
    const store = tokenStore('token-1');
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('{}', { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ authenticated: false, error: 'SESSION_INVALID' }), { status: 401 }));

    const client = new LuthAuthClient({
      ecosystemId: 'ultrst-armada',
      applicationId: 'test',
      origin: 'https://test.example',
      tokenStore: store,
    });

    await client.signOut();
    expect(store.get()).toBe('');
  });
});
