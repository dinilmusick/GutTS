/**
 * ULTRST universal initialization v1 wire contract.
 *
 * This module contains portable public data types and shape validators only.
 * It deliberately does not implement login, store credentials, or grant an
 * application identity based on an appId supplied by a caller.
 */
export const UNIVERSAL_DISCOVERY_VERSION = 'ultrst.discovery.v1' as const;
export const UNIVERSAL_CONFIG_VERSION = 'ultrst.configuration.v1' as const;
export const DEFAULT_UNIVERSAL_DISCOVERY_URL =
  'https://luth.blueprint-ninjastudios.workers.dev/api/discovery/v1';

export type UniversalRuntimeKind =
  | 'browser' | 'cloudflare-worker' | 'serverless' | 'server'
  | 'desktop' | 'android' | 'ios' | 'headless';

export type UniversalAuthReadiness =
  | 'discovery' | 'unauthenticated' | 'authenticating'
  | 'authenticated' | 'configuring' | 'ready'
  | 'denied' | 'unavailable';

export type UniversalConfigurationErrorCode =
  | 'INVALID_DISCOVERY' | 'UNTRUSTED_ISSUER' | 'APP_NOT_FOUND'
  | 'AUTHENTICATION_REQUIRED' | 'AUTHORIZATION_DENIED'
  | 'APP_IDENTITY_UNVERIFIED' | 'WORKSPACE_ACCESS_DENIED'
  | 'CONFIG_VERSION_UNSUPPORTED' | 'CONFIG_UNAVAILABLE'
  | 'DISCOVERY_UNAVAILABLE';

export interface UniversalApplicationIdentity {
  /** Immutable identity in public."ultrst-apps".app_id. Never derive from URL. */
  appId: string;
  ecosystemId: string;
  name: string;
}

export interface PublicNativeOAuthClient {
  clientId: string;
  platform: 'desktop' | 'android' | 'ios';
  redirectUris: string[];
}

export interface UniversalDiscoveryV1 {
  protocol: typeof UNIVERSAL_DISCOVERY_VERSION;
  version: 1;
  issuer: string;
  oidcDiscoveryUrl: string;
  oauthAuthorizationServerMetadataUrl: string;
  configurationUrl: string;
  sessionUrl: string;
  capabilities: {
    email: boolean;
    google: boolean;
    authorizationCode: true;
    pkceS256: true;
    publicNativeClients: boolean;
    trustedWorkloads: boolean;
  };
  application: UniversalApplicationIdentity;
  /** No raw credential or provider-secret data may appear here. */
  publicOAuth: {
    registrationRequired: true;
    nativeClientSecretAllowed: false;
    /** Present only for operator-approved public clients; never contains secrets. */
    nativeClients?: PublicNativeOAuthClient[];
  };
  cache: { maxAgeSeconds: number; generatedAt: string };
}

export interface UniversalConfigurationV1 {
  protocol: typeof UNIVERSAL_CONFIG_VERSION;
  version: 1;
  application: UniversalApplicationIdentity;
  principal: { userId: string };
  workspaceId: string | null;
  /** Explicitly public, non-secret configuration only. */
  settings: {
    supportedServices: string[];
    deploymentOrigin: string | null;
    deploymentEnvironment: string | null;
  };
  cache: { maxAgeSeconds: number; generatedAt: string; revision: string };
}

export interface UniversalBootstrapOptions {
  appId: string;
  runtime: UniversalRuntimeKind;
  discoveryUrl?: string;
  expectedIssuer?: string;
}

export class UniversalInitializationError extends Error {
  constructor(
    public readonly code: UniversalConfigurationErrorCode,
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'UniversalInitializationError';
  }
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new UniversalInitializationError('INVALID_DISCOVERY', 'Expected a JSON object.');
  }
  return value as Record<string, unknown>;
}

function secureOrigin(value: unknown): string {
  if (typeof value !== 'string') {
    throw new UniversalInitializationError('INVALID_DISCOVERY', 'Invalid endpoint URL.');
  }
  let url: URL;
  try { url = new URL(value); }
  catch { throw new UniversalInitializationError('INVALID_DISCOVERY', 'Invalid endpoint URL.'); }
  if (url.username || url.password || url.hash ||
      (url.protocol !== 'https:' &&
       !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) {
    throw new UniversalInitializationError('UNTRUSTED_ISSUER', 'Endpoint origin is not trusted.');
  }
  return url.origin;
}

function publicNativeRedirectSafe(value: unknown, platform: string): boolean {
  if (typeof value !== 'string' || value.length > 2048) return false;
  try {
    const url = new URL(value);
    if (url.username || url.password || url.hash || url.search ||
        !url.pathname || url.pathname === '/') return false;
    if (url.protocol === 'https:') return true;
    return platform === 'desktop' && url.protocol === 'http:' &&
      ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  } catch { return false; }
}

/** Validate discovery before using any returned authentication or configuration URL. */
export function parseUniversalDiscoveryV1(
  payload: unknown,
  expectedAppId: string,
  expectedIssuerOrigin: string,
): UniversalDiscoveryV1 {
  const raw = record(payload);
  const app = record(raw.application);
  const caps = record(raw.capabilities);
  const oauth = record(raw.publicOAuth);
  const cache = record(raw.cache);
  if (raw.protocol !== UNIVERSAL_DISCOVERY_VERSION || raw.version !== 1 ||
      typeof app.appId !== 'string' || app.appId !== expectedAppId ||
      typeof app.ecosystemId !== 'string' || typeof app.name !== 'string' ||
      typeof cache.generatedAt !== 'string' ||
      typeof cache.maxAgeSeconds !== 'number' ||
      !Number.isInteger(cache.maxAgeSeconds) ||
      cache.maxAgeSeconds < 0 || cache.maxAgeSeconds > 300) {
    throw new UniversalInitializationError('INVALID_DISCOVERY', 'Discovery contract mismatch.');
  }
  for (const key of ['email', 'google', 'publicNativeClients', 'trustedWorkloads']) {
    if (typeof caps[key] !== 'boolean') {
      throw new UniversalInitializationError('INVALID_DISCOVERY', 'Invalid capability metadata.');
    }
  }
  if (caps.authorizationCode !== true || caps.pkceS256 !== true ||
      oauth.registrationRequired !== true || oauth.nativeClientSecretAllowed !== false) {
    throw new UniversalInitializationError('INVALID_DISCOVERY', 'Insecure authentication metadata.');
  }
  if (Object.keys(oauth).some(key =>
    !['registrationRequired', 'nativeClientSecretAllowed', 'nativeClients'].includes(key))) {
    throw new UniversalInitializationError('INVALID_DISCOVERY', 'Unexpected OAuth client metadata.');
  }
  const native = oauth.nativeClients;
  if ((caps.publicNativeClients || native !== undefined) &&
      (!Array.isArray(native) || native.length > 20 ||
       Boolean(caps.publicNativeClients) !== (native.length > 0))) {
    throw new UniversalInitializationError('INVALID_DISCOVERY', 'Invalid native client availability.');
  }
  if (Array.isArray(native)) {
    for (const candidate of native) {
      const registration = record(candidate);
      if (Object.keys(registration).some(key =>
        !['clientId', 'platform', 'redirectUris'].includes(key)) ||
        typeof registration.clientId !== 'string' ||
        !/^[a-zA-Z0-9._~-]{3,200}$/.test(registration.clientId) ||
        !['desktop', 'android', 'ios'].includes(String(registration.platform)) ||
        !Array.isArray(registration.redirectUris) ||
        registration.redirectUris.length < 1 || registration.redirectUris.length > 10 ||
        !registration.redirectUris.every(value =>
          publicNativeRedirectSafe(value, String(registration.platform)))) {
        throw new UniversalInitializationError('INVALID_DISCOVERY', 'Invalid public native client metadata.');
      }
    }
  }
  const trusted = secureOrigin(expectedIssuerOrigin);
  for (const key of ['issuer', 'oidcDiscoveryUrl', 'oauthAuthorizationServerMetadataUrl', 'configurationUrl', 'sessionUrl']) {
    if (secureOrigin(raw[key]) !== trusted) {
      throw new UniversalInitializationError('UNTRUSTED_ISSUER', 'Discovery endpoint is outside the trusted Luth origin.');
    }
  }
  if (new URL(raw.issuer as string).pathname !== '/api/auth' ||
      new URL(raw.configurationUrl as string).pathname !== '/api/config/v1') {
    throw new UniversalInitializationError('INVALID_DISCOVERY', 'Unexpected Luth issuer or configuration path.');
  }
  return raw as unknown as UniversalDiscoveryV1;
}

/** Configuration parsing is deliberately narrower than arbitrary JSON settings. */
export function parseUniversalConfigurationV1(
  payload: unknown, expectedAppId: string, expectedUserId?: string,
): UniversalConfigurationV1 {
  const raw = record(payload);
  const app = record(raw.application);
  const principal = record(raw.principal);
  const settings = record(raw.settings);
  const cache = record(raw.cache);
  if (raw.protocol !== UNIVERSAL_CONFIG_VERSION || raw.version !== 1 ||
      app.appId !== expectedAppId ||
      typeof app.ecosystemId !== 'string' || typeof app.name !== 'string' ||
      typeof principal.userId !== 'string' || !principal.userId ||
      (expectedUserId !== undefined && principal.userId !== expectedUserId) ||
      (raw.workspaceId !== null && typeof raw.workspaceId !== 'string') ||
      !Array.isArray(settings.supportedServices) ||
      !settings.supportedServices.every((value: unknown) => typeof value === 'string') ||
      (settings.deploymentOrigin !== null && typeof settings.deploymentOrigin !== 'string') ||
      (settings.deploymentEnvironment !== null && typeof settings.deploymentEnvironment !== 'string') ||
      cache.maxAgeSeconds !== 0 || typeof cache.revision !== 'string' ||
      typeof cache.generatedAt !== 'string') {
    throw new UniversalInitializationError('CONFIG_VERSION_UNSUPPORTED', 'Invalid or unsupported configuration.');
  }
  // The protected endpoint is intentionally no-store. Unexpected properties
  // indicate protocol drift or a potential secret leak, so fail closed.
  if (Object.keys(settings).some((key) =>
    !['supportedServices', 'deploymentOrigin', 'deploymentEnvironment'].includes(key))) {
    throw new UniversalInitializationError('CONFIG_VERSION_UNSUPPORTED', 'Unexpected configuration field.');
  }
  return raw as unknown as UniversalConfigurationV1;
}
