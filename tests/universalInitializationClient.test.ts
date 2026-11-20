import { describe, expect, it, vi } from 'vitest';
import { createUniversalInitializationClient } from '../src/auth/universalInitializationClient.js';

const base = 'https://luth.example.test';
const publicDoc = () => ({
  protocol: 'ultrst.discovery.v1', version: 1,
  issuer: base + '/api/auth',
  oidcDiscoveryUrl: base + '/api/auth/.well-known/openid-configuration',
  oauthAuthorizationServerMetadataUrl: base + '/api/auth/.well-known/oauth-authorization-server',
  configurationUrl: base + '/api/config/v1',
  sessionUrl: base + '/api/session',
  application: { appId: 'aiko', ecosystemId: 'ultrst-armada', name: 'Aiko' },
  capabilities: { email: true, google: true, authorizationCode: true, pkceS256: true,
    publicNativeClients: false, trustedWorkloads: false },
  publicOAuth: { registrationRequired: true, nativeClientSecretAllowed: false },
  cache: { maxAgeSeconds: 30, generatedAt: new Date().toISOString() },
});
const config = () => ({
  protocol: 'ultrst.configuration.v1', version: 1,
  application: { appId: 'aiko', ecosystemId: 'ultrst-armada', name: 'Aiko' },
  principal: { userId: 'verified-user' }, workspaceId: null,
  settings: { supportedServices: ['agents'], deploymentOrigin: null, deploymentEnvironment: null },
  cache: { maxAgeSeconds: 0, revision: '1', generatedAt: new Date().toISOString() },
});

describe('portable universal initialization client', () => {
  it('discovers public app before making an authenticated config request', async () => {
    const requests: string[] = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      requests.push(url);
      return Response.json(url.includes('/api/config/v1') ? config() : publicDoc());
    });
    const client = createUniversalInitializationClient({ appId: 'aiko', runtime: 'browser' },
      { expectedIssuerOrigin: base, discoveryUrls: [base + '/api/discovery/v1'],
        fetcher: fetcher as typeof fetch });
    expect((await client.discover()).application.appId).toBe('aiko');
    expect(client.readiness).toBe('unauthenticated');
    expect((await client.configuration()).settings.supportedServices).toEqual(['agents']);
    expect(client.readiness).toBe('ready');
    expect(requests).toEqual([
      base + '/api/discovery/v1?app_id=aiko',
      base + '/api/config/v1?app_id=aiko',
    ]);
    client.invalidate();
    expect(client.readiness).toBe('discovery');
  });

  it('never follows an attacker issuer from public discovery', async () => {
    const fetcher = vi.fn(async () => Response.json({ ...publicDoc(), configurationUrl: 'https://evil.test/api/config/v1' }));
    const client = createUniversalInitializationClient({ appId: 'aiko', runtime: 'browser' },
      { expectedIssuerOrigin: base, discoveryUrls: [base + '/api/discovery/v1'],
        fetcher: fetcher as typeof fetch });
    await expect(client.discover()).rejects.toThrow();
    expect(client.readiness).toBe('denied');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('does not retry unauthorized config or convert 401 into ready', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) =>
      String(input).includes('/api/config/v1')
        ? Response.json({ error: 'AUTHENTICATION_REQUIRED' }, { status: 401 })
        : Response.json(publicDoc()));
    const client = createUniversalInitializationClient({ appId: 'aiko', runtime: 'browser' },
      { expectedIssuerOrigin: base, discoveryUrls: [base + '/api/discovery/v1'],
        fetcher: fetcher as typeof fetch, retries: 3 });
    await expect(client.configuration()).rejects.toMatchObject({ code: 'AUTHENTICATION_REQUIRED' });
    expect(client.readiness).toBe('unauthenticated');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('rejects discovery configured on an unexpected untrusted service', async () => {
    const fetcher = vi.fn(async () => Response.json(publicDoc()));
    const client = createUniversalInitializationClient({ appId: 'aiko', runtime: 'browser' },
      { expectedIssuerOrigin: base, discoveryUrls: ['https://evil.test/api/discovery/v1'],
        fetcher: fetcher as typeof fetch });
    await expect(client.discover()).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
});
