import {
  UniversalInitializationError,
  type UniversalApplicationIdentity,
} from './universalInitialization.js';

export const UNIVERSAL_WORKLOAD_CONFIG_VERSION = 'ultrst.configuration.workload.v1' as const;

/** Machine principal, never a fabricated end-user session. */
export interface UniversalWorkloadConfigurationV1 {
  protocol: typeof UNIVERSAL_WORKLOAD_CONFIG_VERSION;
  version: 1;
  application: UniversalApplicationIdentity;
  principal: { kind: 'workload'; clientId: string };
  workspaceId: null;
  settings: {
    supportedServices: string[];
    deploymentOrigin: string | null;
    deploymentEnvironment: string | null;
  };
  cache: { maxAgeSeconds: 0; generatedAt: string; revision: string };
}

/** A public deployment origin must never include credentials or query data. */
function publicOriginOrNull(value: unknown): boolean {
  if (value === null) return true;
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.origin === value && !url.username && !url.password &&
      !url.hash && !url.search &&
      (url.protocol === 'https:' || (url.protocol === 'http:' &&
        ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)));
  } catch { return false; }
}
function ownFields(
  value: Record<string, unknown>, fields: readonly string[],
): boolean {
  return Object.keys(value).every(field => fields.includes(field)) &&
    fields.every(field => Object.prototype.hasOwnProperty.call(value, field));
}

/**
 * Explicit allowlist. Fail on any unrecognized top-level or settings field.
 * This contract deliberately excludes credentials, arbitrary SQL responses,
 * application account tokens, and workspace-specific configuration.
 */
export function parseUniversalWorkloadConfigurationV1(
  data: unknown,
  expectedAppId: string,
  expectedClientId: string,
): UniversalWorkloadConfigurationV1 {
  function object(input: unknown): Record<string, unknown> {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw new UniversalInitializationError('CONFIG_VERSION_UNSUPPORTED', 'Invalid workload configuration object.');
    }
    return input as Record<string, unknown>;
  }
  const root = object(data);
  const app = object(root.application);
  const principal = object(root.principal);
  const settings = object(root.settings);
  const cache = object(root.cache);
  if (!/^[a-z0-9][a-z0-9_-]{0,119}$/.test(expectedAppId) ||
      !/^[A-Za-z0-9._~-]{3,200}$/.test(expectedClientId) ||
      !ownFields(root, [
        'protocol', 'version', 'application', 'principal', 'workspaceId',
        'settings', 'cache',
      ]) || !ownFields(app, ['appId', 'ecosystemId', 'name']) ||
      !ownFields(principal, ['kind', 'clientId']) ||
      !ownFields(settings, [
        'supportedServices', 'deploymentOrigin', 'deploymentEnvironment',
      ]) || !ownFields(cache, ['maxAgeSeconds', 'generatedAt', 'revision']) ||
      root.protocol !== UNIVERSAL_WORKLOAD_CONFIG_VERSION || root.version !== 1 ||
      app.appId !== expectedAppId ||
      typeof app.ecosystemId !== 'string' || app.ecosystemId.length === 0 ||
      app.ecosystemId.length > 120 ||
      typeof app.name !== 'string' || app.name.length === 0 || app.name.length > 200 ||
      principal.kind !== 'workload' || principal.clientId !== expectedClientId ||
      root.workspaceId !== null ||
      !Array.isArray(settings.supportedServices) ||
      settings.supportedServices.length > 100 ||
      !settings.supportedServices.every(value =>
        typeof value === 'string' && /^[a-z0-9][a-z0-9_./-]{0,79}$/i.test(value)) ||
      !publicOriginOrNull(settings.deploymentOrigin) ||
      (settings.deploymentEnvironment !== null &&
       (typeof settings.deploymentEnvironment !== 'string' ||
        settings.deploymentEnvironment.length === 0 ||
        settings.deploymentEnvironment.length > 80)) ||
      cache.maxAgeSeconds !== 0 ||
      typeof cache.generatedAt !== 'string' ||
      Number.isNaN(Date.parse(cache.generatedAt as string)) ||
      typeof cache.revision !== 'string' ||
      cache.revision.length === 0 || cache.revision.length > 240) {
    throw new UniversalInitializationError('CONFIG_VERSION_UNSUPPORTED', 'Unsupported or unsafe workload configuration.');
  }
  return root as unknown as UniversalWorkloadConfigurationV1;
}
