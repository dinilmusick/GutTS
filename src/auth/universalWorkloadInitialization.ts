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
  if (Object.keys(root).some(key =>
    !['protocol', 'version', 'application', 'principal', 'workspaceId', 'settings', 'cache'].includes(key)) ||
      root.protocol !== UNIVERSAL_WORKLOAD_CONFIG_VERSION || root.version !== 1 ||
      app.appId !== expectedAppId ||
      typeof app.ecosystemId !== 'string' || typeof app.name !== 'string' ||
      principal.kind !== 'workload' || principal.clientId !== expectedClientId ||
      Object.keys(principal).some(key => !['kind', 'clientId'].includes(key)) ||
      root.workspaceId !== null ||
      !Array.isArray(settings.supportedServices) ||
      !settings.supportedServices.every(value => typeof value === 'string') ||
      (settings.deploymentOrigin !== null && typeof settings.deploymentOrigin !== 'string') ||
      (settings.deploymentEnvironment !== null &&
       typeof settings.deploymentEnvironment !== 'string') ||
      Object.keys(settings).some(key => ![
        'supportedServices', 'deploymentOrigin', 'deploymentEnvironment',
      ].includes(key)) ||
      cache.maxAgeSeconds !== 0 || typeof cache.generatedAt !== 'string' ||
      typeof cache.revision !== 'string') {
    throw new UniversalInitializationError('CONFIG_VERSION_UNSUPPORTED', 'Unsupported or unsafe workload configuration.');
  }
  return root as unknown as UniversalWorkloadConfigurationV1;
}
