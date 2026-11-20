import { describe, expect, it } from 'vitest';
import {
  parseUniversalDiscoveryV1, parseUniversalConfigurationV1,
  UniversalInitializationError, UNIVERSAL_DISCOVERY_VERSION, UNIVERSAL_CONFIG_VERSION,
} from '../src/auth/universalInitialization.js';

const issuerOrigin = 'https://luth.example.test';
const discovery = () => ({
  protocol: UNIVERSAL_DISCOVERY_VERSION,
  version: 1,
  issuer: issuerOrigin + '/api/auth',
  oidcDiscoveryUrl: issuerOrigin + '/api/auth/.well-known/openid-configuration',
  oauthAuthorizationServerMetadataUrl: issuerOrigin + '/api/auth/.well-known/oauth-authorization-server',
  configurationUrl: issuerOrigin + '/api/config/v1',
  sessionUrl: issuerOrigin + '/api/session',
  application: { appId: 'srkl', ecosystemId: 'ultrst-armada', name: 'SRKL' },
  capabilities: { email: true, google: true, authorizationCode: true,
    pkceS256: true, publicNativeClients: false, trustedWorkloads: false },
  publicOAuth: { registrationRequired: true, nativeClientSecretAllowed: false },
  cache: { maxAgeSeconds: 30, generatedAt: '2026-11-20T00:00:00.000Z' },
});
const config = () => ({
  protocol: UNIVERSAL_CONFIG_VERSION,
  version: 1,
  application: { appId: 'srkl', ecosystemId: 'ultrst-armada', name: 'SRKL' },
  principal: { userId: 'user-1' },
  workspaceId: null,
  settings: { supportedServices: ['storage'], deploymentOrigin: null, deploymentEnvironment: null },
  cache: { maxAgeSeconds: 0, generatedAt: '2026-11-20T00:00:00.000Z', revision: '1' },
});

describe('Universal Luth initialization contract', () => {
  it('accepts a valid bounded discovery document', () => {
    expect(parseUniversalDiscoveryV1(discovery(), 'srkl', issuerOrigin).application.appId).toBe('srkl');
  });
  it('does not derive application identity from a different deployment URL', () => {
    expect(() => parseUniversalDiscoveryV1(discovery(), 'aiko', issuerOrigin)).toThrow(UniversalInitializationError);
  });
  it('rejects malicious configuration origins and downgraded PKCE', () => {
    expect(() => parseUniversalDiscoveryV1({ ...discovery(), configurationUrl: 'https://evil.test/api/config/v1' }, 'srkl', issuerOrigin)).toThrow();
    expect(() => parseUniversalDiscoveryV1({ ...discovery(), capabilities: { ...discovery().capabilities, pkceS256: false } }, 'srkl', issuerOrigin)).toThrow();
  });
  it('rejects an insecure origin and unbounded public cache lifetime', () => {
    expect(() => parseUniversalDiscoveryV1(discovery(), 'srkl', 'http://public.example.test')).toThrow();
    expect(() => parseUniversalDiscoveryV1({ ...discovery(), cache: { ...discovery().cache, maxAgeSeconds: 3600 } }, 'srkl', issuerOrigin)).toThrow();
  });
  it('requires exact public native registrations to be present when capability is advertised', () => {
    const metadata = {
      ...discovery(),
      capabilities: { ...discovery().capabilities, publicNativeClients: true },
      publicOAuth: { registrationRequired: true, nativeClientSecretAllowed: false,
        nativeClients: [{ clientId: 'srkl-ios-public', platform: 'ios',
          redirectUris: ['https://srkl.example.test/mobile/callback'] }] },
    };
    expect(parseUniversalDiscoveryV1(metadata, 'srkl', issuerOrigin)
      .publicOAuth.nativeClients?.[0].clientId).toBe('srkl-ios-public');
    expect(() => parseUniversalDiscoveryV1({ ...metadata,
      publicOAuth: { ...metadata.publicOAuth, nativeClients: [] },
    }, 'srkl', issuerOrigin)).toThrow();
  });
  it('rejects secret-bearing public metadata and downgraded native redirects', () => {
    const client = { clientId: 'srkl-public-ios', platform: 'ios',
      redirectUris: ['https://srkl.example.test/mobile/callback'] };
    const base = { ...discovery(),
      capabilities: { ...discovery().capabilities, publicNativeClients: true },
      publicOAuth: { registrationRequired: true, nativeClientSecretAllowed: false,
        nativeClients: [client] },
    };
    expect(() => parseUniversalDiscoveryV1({ ...base,
      publicOAuth: { ...base.publicOAuth, clientSecret: 'not-allowed' },
    }, 'srkl', issuerOrigin)).toThrow();
    expect(() => parseUniversalDiscoveryV1({ ...base,
      publicOAuth: { ...base.publicOAuth,
        nativeClients: [{ ...client, clientSecret: 'not-allowed' }] },
    }, 'srkl', issuerOrigin)).toThrow();
    expect(() => parseUniversalDiscoveryV1({ ...base,
      publicOAuth: { ...base.publicOAuth,
        nativeClients: [{ ...client, redirectUris: ['http://evil.example.test/callback'] }] },
    }, 'srkl', issuerOrigin)).toThrow();
  });
  it('accepts least-privilege no-store configuration only for the expected app and user', () => {
    expect(parseUniversalConfigurationV1(config(), 'srkl', 'user-1').principal.userId).toBe('user-1');
    expect(() => parseUniversalConfigurationV1(config(), 'aiko', 'user-1')).toThrow();
    expect(() => parseUniversalConfigurationV1(config(), 'srkl', 'user-2')).toThrow();
  });
  it('rejects secret injection and invalid cache policies', () => {
    expect(() => parseUniversalConfigurationV1({
      ...config(), settings: { ...config().settings, clientSecret: 'must-never-appear' },
    }, 'srkl')).toThrow();
    expect(() => parseUniversalConfigurationV1({
      ...config(), cache: { ...config().cache, maxAgeSeconds: 90 },
    }, 'srkl')).toThrow();
  });
});
