import { describe, expect, it, vi } from 'vitest';
import { createNativeLuthOAuthClient } from '../src/auth/nativeLuthOAuthClient.js';

const luth = 'https://luth.example.test';
const doc = (enabled: boolean) => ({
  protocol: 'ultrst.discovery.v1', version: 1,
  issuer: luth + '/api/auth',
  oidcDiscoveryUrl: luth + '/api/auth/.well-known/openid-configuration',
  oauthAuthorizationServerMetadataUrl: luth + '/api/auth/.well-known/oauth-authorization-server',
  configurationUrl: luth + '/api/config/v1', sessionUrl: luth + '/api/session',
  application: { appId: 'srkl', ecosystemId: 'ultrst-armada', name: 'SRKL' },
  capabilities: {
    email: true, google: true, authorizationCode: true,
    pkceS256: true, publicNativeClients: enabled, trustedWorkloads: false,
  },
  publicOAuth: { registrationRequired: true, nativeClientSecretAllowed: false },
  cache: { maxAgeSeconds: 30, generatedAt: new Date().toISOString() },
});
const config = {
  protocol: 'ultrst.configuration.v1', version: 1,
  application: doc(true).application, principal: { userId: 'person-1' },
  workspaceId: null,
  settings: { supportedServices: ['accounts'], deploymentOrigin: null, deploymentEnvironment: null },
  cache: { maxAgeSeconds: 0, generatedAt: new Date().toISOString(), revision: '1' },
};

function harness(enabled = true) {
  const secrets = new Map<string, string>();
  const secureStore = {
    read: async (key: string) => secrets.get(key) ?? null,
    write: async (key: string, value: string) => { secrets.set(key, value); },
    remove: async (key: string) => { secrets.delete(key); },
  };
  const requests: { url: string; init: RequestInit | undefined }[] = [];
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    requests.push({ url, init });
    if (url.includes('discovery/v1')) return Response.json(doc(enabled));
    if (url.includes('/oauth2/token')) return Response.json({
      token_type: 'Bearer', access_token: 'valid-user-oauth-bearer-1234',
      refresh_token: 'valid-refresh-token-123456', expires_in: 3600,
    });
    if (url.includes('/config/v1')) return Response.json(config);
    return Response.json({ success: true });
  });
  const client = createNativeLuthOAuthClient({
    appId: 'srkl', clientId: 'srkl-public-ios',
    registeredRedirectUri: 'https://srkl.example.test/mobile/callback',
    runtime: 'ios', expectedLuthOrigin: luth, secureStore,
    fetcher: fetcher as typeof fetch,
  });
  return { client, requests, secrets };
}

describe('Native PKCE public client', () => {
  it('does not authorize a native app until the Luth registry advertises public clients', async () => {
    const { client, secrets } = harness(false);
    await expect(client.beginAuthorization()).rejects.toThrow('NATIVE_OAUTH_CLIENT_NOT_REGISTERED');
    expect(secrets.size).toBe(0);
  });

  it('builds PKCE S256 without secrets and rejects substituted callbacks', async () => {
    const { client, secrets, requests } = harness();
    const uri = new URL(await client.beginAuthorization());
    expect(uri.searchParams.get('code_challenge_method')).toBe('S256');
    expect(uri.searchParams.get('client_secret')).toBeNull();
    const state = uri.searchParams.get('state')!;
    await expect(client.completeAuthorization(
      'https://srkl.example.test/mobile/callback?code=abcdefghijklmnopqrstuvwxyz&state=wrong&iss=' +
      encodeURIComponent(luth + '/api/auth'),
    )).rejects.toThrow('NATIVE_AUTHORIZATION_CALLBACK_REJECTED');
    const callback = new URL('https://srkl.example.test/mobile/callback');
    callback.searchParams.set('state', state);
    callback.searchParams.set('code', 'abcdefghijklmnopqrstuvwxyz');
    callback.searchParams.set('iss', luth + '/api/auth');
    await client.completeAuthorization(callback.toString());
    expect([...secrets.keys()].some(key => key.endsWith('.pending.v1'))).toBe(false);
    const tokenExchange = requests.find(r => r.url.includes('/oauth2/token'))!;
    const body = String(tokenExchange.init?.body);
    expect(body).toContain('code_verifier=');
    expect(body).not.toContain('client_secret');
    expect((await client.getConfiguration()).principal.userId).toBe('person-1');
    expect(requests.find(r => r.url.includes('/config/v1'))?.init?.headers).toBeDefined();
    await client.signOut();
    expect(secrets.size).toBe(0);
  });

  it('isolates tokens and pending PKCE state across separate public app registrations', async () => {
    const shared = new Map<string, string>();
    const secureStore = {
      read: async (key: string) => shared.get(key) ?? null,
      write: async (key: string, value: string) => { shared.set(key, value); },
      remove: async (key: string) => { shared.delete(key); },
    };
    const fetcher = vi.fn(async () => Response.json(doc(true)));
    const options = {
      appId: 'srkl', registeredRedirectUri: 'https://srkl.example.test/mobile/callback',
      runtime: 'ios' as const, expectedLuthOrigin: luth,
      secureStore, fetcher: fetcher as typeof fetch,
    };
    const first = createNativeLuthOAuthClient({ ...options, clientId: 'ios-a' });
    const second = createNativeLuthOAuthClient({ ...options, clientId: 'ios-b' });
    await first.beginAuthorization();
    await second.beginAuthorization();
    const keys = [...shared.keys()].filter(key => key.endsWith('.pending.v1'));
    expect(keys).toHaveLength(2);
    expect(keys[0]).not.toBe(keys[1]);
  });

  it('rejects unsafe redirect URIs rather than shipping confidential native client data', () => {
    const { client } = harness();
    expect(client).toBeDefined();
    expect(() => createNativeLuthOAuthClient({
      appId: 'srkl', clientId: 'public-mobile',
      registeredRedirectUri: 'http://evil.example.test/callback',
      runtime: 'android', expectedLuthOrigin: luth,
      secureStore: { read: async () => null, write: async () => {}, remove: async () => {} },
    })).toThrow('INVALID_REGISTERED_NATIVE_REDIRECT');
  });
});
