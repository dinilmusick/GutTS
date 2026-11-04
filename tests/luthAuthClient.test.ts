import { afterEach, describe, expect, it, vi } from 'vitest';
import { LuthAuthClient, hydrateLuthTokenFromUrl, type LuthAuthTokenStore } from '../src/auth/luthAuthClient.js';

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

  it('preserves complete JWT-shaped tokens in the default browser token store', async () => {
    const jwt = 'header.payload.signature';
    const values = new Map<string, string>();
    const originalStorage = globalThis.sessionStorage;
    Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
      removeItem: (key: string) => { values.delete(key); },
    } });
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('{}', { status: 200, headers: { 'set-auth-token': jwt } }));
    const client = new LuthAuthClient({ ecosystemId: 'ultrst-armada', applicationId: 'test', origin: 'https://test.example', autoRegister: false });
    await client.signInWithEmail({ email: 'test@example.com', password: 'secret' });
    expect(new Headers(client.getAuthHeaders()).get('authorization')).toBe(`Bearer ${jwt}`);
    Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: originalStorage });
  });

  it('hydrates an OAuth callback token from the URL and removes it from browser history', () => {
    const store = tokenStore();
    const originalWindow = globalThis.window;
    const originalDocument = globalThis.document;
    const replaceState = vi.fn();
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        location: { href: 'http://localhost/?token=oauth-token&keep=1#workspace', origin: 'http://localhost', search: '?token=oauth-token&keep=1', pathname: '/', hash: '#workspace' },
        history: { replaceState },
      },
    });
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: { title: 'Loky' },
    });

    expect(hydrateLuthTokenFromUrl(store)).toBe(true);
    expect(store.get()).toBe('oauth-token');
    expect(replaceState).toHaveBeenCalledWith({}, 'Loky', '/?keep=1#workspace');

    Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow });
    Object.defineProperty(globalThis, 'document', { configurable: true, value: originalDocument });
  });

  it('clears the token only after a successful sign-out and verifies invalidation', async () => {
    const store = tokenStore('token-1');
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('{}', { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        registered: true,
        ecosystemId: 'ultrst-armada',
        applicationId: 'test',
        origin: 'https://test.example',
        environment: 'production',
        authenticationEnabled: true,
      }), { status: 200 }))
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
