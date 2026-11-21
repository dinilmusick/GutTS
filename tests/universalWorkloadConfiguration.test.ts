import { describe, expect, it } from 'vitest';
import {
  parseUniversalWorkloadConfigurationV1,
  UNIVERSAL_WORKLOAD_CONFIG_VERSION,
} from '../src/auth/universalWorkloadInitialization.js';

const appId = 'srkl', clientId = 'srkl-worker-client';
const valid = () => ({
  protocol: UNIVERSAL_WORKLOAD_CONFIG_VERSION, version: 1,
  application: { appId, ecosystemId: 'ultrst-armada', name: 'SRKL' },
  principal: { kind: 'workload', clientId },
  workspaceId: null,
  settings: {
    supportedServices: ['accounts', 'storage'],
    deploymentOrigin: 'https://srkl.example.test',
    deploymentEnvironment: 'production',
  },
  cache: { maxAgeSeconds: 0, generatedAt: new Date().toISOString(), revision: '2026-11-21T00:00:00Z' },
});

describe('universal machine workload configuration v1', () => {
  it('accepts only the registered workload identity and strict no-store contract', () => {
    const data = parseUniversalWorkloadConfigurationV1(valid(), appId, clientId);
    expect(data.principal).toEqual({ kind: 'workload', clientId });
    expect(data.cache.maxAgeSeconds).toBe(0);
    expect(data.settings.supportedServices).toEqual(['accounts', 'storage']);
  });
  it('rejects cross-app, cross-client, and fake end-user principal substitutions', () => {
    expect(() => parseUniversalWorkloadConfigurationV1(valid(), 'aiko', clientId)).toThrow();
    expect(() => parseUniversalWorkloadConfigurationV1(valid(), appId, 'different-client')).toThrow();
    expect(() => parseUniversalWorkloadConfigurationV1({
      ...valid(), principal: { kind: 'user', clientId },
    }, appId, clientId)).toThrow();
  });
  it('denies every unexpected secret field, including nested and top-level', () => {
    for (const candidate of [
      { ...valid(), privateKey: 'do-not-expose' },
      { ...valid(), application: { ...valid().application, databaseUrl: 'postgres://private.invalid' } },
      { ...valid(), principal: { ...valid().principal, userId: 'other-user' } },
      { ...valid(), settings: { ...valid().settings, oauthClientSecret: 'private' } },
      { ...valid(), cache: { ...valid().cache, refreshToken: 'private' } },
    ]) {
      expect(() => parseUniversalWorkloadConfigurationV1(candidate, appId, clientId)).toThrow();
    }
  });
  it('rejects workspace claims, shared cache, invalid services and origin substitution', () => {
    const template = valid();
    expect(() => parseUniversalWorkloadConfigurationV1({
      ...template, workspaceId: 'not-authorized',
    }, appId, clientId)).toThrow();
    expect(() => parseUniversalWorkloadConfigurationV1({
      ...template, cache: { ...template.cache, maxAgeSeconds: 60 },
    }, appId, clientId)).toThrow();
    expect(() => parseUniversalWorkloadConfigurationV1({
      ...template, settings: { ...template.settings, supportedServices: ['x', { secret: true }] },
    }, appId, clientId)).toThrow();
    expect(() => parseUniversalWorkloadConfigurationV1({
      ...template, settings: { ...template.settings, deploymentOrigin: 'http://evil.example.test' },
    }, appId, clientId)).toThrow();
  });
  it('rejects malformed or unsupported protocol and expiration metadata', () => {
    expect(() => parseUniversalWorkloadConfigurationV1(null, appId, clientId)).toThrow();
    expect(() => parseUniversalWorkloadConfigurationV1({
      ...valid(), version: 2,
    }, appId, clientId)).toThrow();
    expect(() => parseUniversalWorkloadConfigurationV1({
      ...valid(), cache: { ...valid().cache, generatedAt: 'invalid-time' },
    }, appId, clientId)).toThrow();
  });
});
