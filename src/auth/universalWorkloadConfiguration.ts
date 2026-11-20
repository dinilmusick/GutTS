import {
  UniversalInitializationError,
  type UniversalApplicationIdentity,
} from './universalInitialization.js';

export const UNIVERSAL_WORKLOAD_CONFIGURATION_VERSION =
  'ultrst.configuration.workload.v1' as const;

/** A trusted service identity, not an end-user session or public app ID. */
export interface UniversalWorkloadConfigurationV1 {
  protocol: typeof UNIVERSAL_WORKLOAD_CONFIGURATION_VERSION;
  version: 1;
  application: UniversalApplicationIdentity;
  principal: { kind: 'workload'; clientId: string };
  workspaceId: null;
  /** Only non-secret publicly usable runtime settings. */
  settings: {
    supportedServices: string[];
    deploymentOrigin: string | null;
    deploymentEnvironment: string | null;
  };
  cache: { maxAgeSeconds: 0; generatedAt: string; revision: string };
}

function record(value: unknown): Record<string, unknown> {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) {
    throw new UniversalInitializationError(
      'CONFIG_VERSION_UNSUPPORTED', 'Workload configuration must be an object.',
    );
  }
  return value as Record<string, unknown>;
}
function exactFields(row: Record<string, unknown>, fields: readonly string[]): boolean {
  return Object.keys(row).every(key => fields.includes(key)) &&
    fields.every(key => Object.prototype.hasOwnProperty.call(row, key));
}
function originOrNull(value: unknown): boolean {
  if (value === null) return true;
  if (typeof value !== 'string') return false;
  try {
    const u = new URL(value);
    return u.origin === value && !u.username && !u.password && !u.hash &&
      (u.protocol === 'https:' ||
        (u.protocol === 'http:' &&
         ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)));
  } catch { return false; }
}
function nonempty(value: unknown, limit = 240): value is string {
  return typeof value === 'string' && value.length > 0 &&
    value.length <= limit && value.trim() === value;
}
function fail(): never {
  throw new UniversalInitializationError(
    'CONFIG_VERSION_UNSUPPORTED',
    'Unrecognized, untrusted or incorrectly scoped workload configuration.',
  );
}

/**
 * Verify Luth's no-secret response before initializing trusted app services.
 * Authentication, token, scope, issuer and revocation verification remain at
 * Luth's protected API. This parser NEVER grants workload authorization.
 */
export function parseUniversalWorkloadConfigurationV1(
  payload: unknown,
  expectedAppId: string,
  expectedClientId: string,
): UniversalWorkloadConfigurationV1 {
  if (!/^[a-z0-9][a-z0-9_-]{0,119}$/.test(expectedAppId) ||
      !/^[A-Za-z0-9._~-]{3,200}$/.test(expectedClientId)) fail();
  const raw = record(payload);
  if (!exactFields(raw, [
    'protocol', 'version', 'application', 'principal',
    'workspaceId', 'settings', 'cache',
  ])) fail();
  const app = record(raw.application);
  const principal = record(raw.principal);
  const settings = record(raw.settings);
  const cache = record(raw.cache);
  if (!exactFields(app, ['appId', 'ecosystemId', 'name']) ||
      !exactFields(principal, ['kind', 'clientId']) ||
      !exactFields(settings, [
        'supportedServices', 'deploymentOrigin', 'deploymentEnvironment',
      ]) ||
      !exactFields(cache, ['maxAgeSeconds', 'generatedAt', 'revision'])) fail();
  if (raw.protocol !== UNIVERSAL_WORKLOAD_CONFIGURATION_VERSION ||
      raw.version !== 1 || raw.workspaceId !== null ||
      app.appId !== expectedAppId ||
      !nonempty(app.ecosystemId, 120) || !nonempty(app.name, 200) ||
      principal.kind !== 'workload' ||
      principal.clientId !== expectedClientId ||
      !Array.isArray(settings.supportedServices) ||
      settings.supportedServices.length > 100 ||
      !settings.supportedServices.every((v: unknown) =>
        typeof v === 'string' && /^[a-z0-9][a-z0-9_./-]{0,79}$/i.test(v)) ||
      !originOrNull(settings.deploymentOrigin) ||
      (settings.deploymentEnvironment !== null &&
        !nonempty(settings.deploymentEnvironment, 80)) ||
      cache.maxAgeSeconds !== 0 ||
      !nonempty(cache.generatedAt, 60) ||
      Number.isNaN(Date.parse(cache.generatedAt as string)) ||
      !nonempty(cache.revision, 240)) fail();
  return raw as unknown as UniversalWorkloadConfigurationV1;
}
