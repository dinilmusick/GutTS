import { describe, expect, it } from 'vitest';
import { parseUniversalDiscoveryV1 } from '../src/auth/universalInitialization.js';
import { parseUniversalWorkloadConfigurationV1 } from '../src/auth/universalWorkloadInitialization.js';

const luth = 'https://luth.example.test';
const discovery = () => ({
  protocol: 'ultrst.discovery.v1', version: 1,
  issuer: luth + '/api/auth',
  oidcDiscoveryUrl: luth + '/api/auth/.well-known/openid-configuration',
  oauthAuthorizationServerMetadataUrl: luth + '/api/auth/.well-known/oauth-authorization-server',
  configurationUrl: luth + '/api/config/v1',
  workloadConfigurationUrl: luth + '/api/config/workload/v1',
  sessionUrl: luth + '/api/session',
  capabilities: { email: true, google: true, authorizationCode: true,
    pkceS256: true, publicNativeClients: false, trustedWorkloads: true },
  publicOAuth: { registrationRequired: true, nativeClientSecretAllowed: false },
  application: { appId: 'srkl', ecosystemId: 'ultrst-armada', name: 'SRKL' },
  cache: { maxAgeSeconds: 30, generatedAt: new Date().toISOString() },
});
const configuration = () => ({
  protocol: 'ultrst.configuration.workload.v1', version: 1,
  application: { appId: 'srkl', ecosystemId: 'ultrst-armada', name: 'SRKL' },
  principal: { kind: 'workload', clientId: 'srkl-worker-client' },
  workspaceId: null,
  settings: {
    supportedServices: ['accounts'], deploymentOrigin: 'https://srkl.example.test',
    deploymentEnvironment: 'production',
  },
  cache: { maxAgeSeconds: 0, generatedAt: new Date().toISOString(), revision: '1' },
});
describe('Trusted workload initializer contracts', () => {
  it('validates the pinned workload endpoint and registered availability', () => {
    expect(parseUniversalDiscoveryV1(discovery(), 'srkl', luth).capabilities.trustedWorkloads).toBe(true);
    expect(() => parseUniversalDiscoveryV1({
      ...discovery(), workloadConfigurationUrl: 'https://evil.example.test/api/config/workload/v1',
    }, 'srkl', luth)).toThrow();
    expect(() => parseUniversalDiscoveryV1({
      ...discovery(), workloadConfigurationUrl: luth + '/api/internal/secrets',
    }, 'srkl', luth)).toThrow();
    expect(() => parseUniversalDiscoveryV1({
      ...discovery(), workloadConfigurationUrl: undefined,
    }, 'srkl', luth)).toThrow();
  });
  it('accepts only the exact workload principal and zero-cache allowlisted fields', () => {
    const result = parseUniversalWorkloadConfigurationV1(
      configuration(), 'srkl', 'srkl-worker-client',
    );
    expect(result.principal.kind).toBe('workload');
    expect(() => parseUniversalWorkloadConfigurationV1(
      configuration(), 'aiko', 'srkl-worker-client',
    )).toThrow();
    expect(() => parseUniversalWorkloadConfigurationV1(
      configuration(), 'srkl', 'wrong-client',
    )).toThrow();
  });
  it('never accepts fake user identity or extra server credentials', () => {
    const config = configuration();
    expect(() => parseUniversalWorkloadConfigurationV1({
      ...config, principal: { ...config.principal, userId: 'forged-user' },
    }, 'srkl', 'srkl-worker-client')).toThrow();
    expect(() => parseUniversalWorkloadConfigurationV1({
      ...config, settings: { ...config.settings, databaseUrl: 'postgres://should-not-leak' },
    }, 'srkl', 'srkl-worker-client')).toThrow();
    expect(() => parseUniversalWorkloadConfigurationV1({
      ...config, signingKey: 'secret',
    }, 'srkl', 'srkl-worker-client')).toThrow();
  });
  it('rejects replayable private configuration cache', () => {
    const config = configuration();
    expect(() => parseUniversalWorkloadConfigurationV1({
      ...config, cache: { ...config.cache, maxAgeSeconds: 60 },
    }, 'srkl', 'srkl-worker-client')).toThrow();
  });
});
