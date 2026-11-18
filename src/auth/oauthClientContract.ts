import { parseIdentityId } from './identityIds.js';

/**
 * Versioned, portable registration contract. Luth (not an app frontend) is
 * responsible for proving client ownership and authorizing each redirect.
 * Validation here only checks shape and callback safety; it never grants trust.
 */
export const ULTRST_APP_CONTRACT_VERSION = 1 as const;
export type OAuthPlatform = 'web' | 'ios' | 'android' | 'desktop';

export interface OAuthClientRegistrationV1 {
  schemaVersion: typeof ULTRST_APP_CONTRACT_VERSION;
  /** The immutable Neon app_id. An origin or deployment is NOT an app ID. */
  appId: string;
  /** An OAuth client ID belongs to an app, not to a deployment or device. */
  clientId: string;
  platform: OAuthPlatform;
  publicClient: true;
  pkceMethod: 'S256';
  redirectUris: readonly string[];
  /**
   * Hosts independently verified by the trusted Luth registration authority.
   * Only relevant for iOS Universal Links / Android App Links.
   * This is an assertion to VERIFY server-side, never proof from a caller.
   */
  verifiedHosts?: readonly string[];
}

export type ContractCheck<T> =
  | { ok: true; value: T }
  | { ok: false; reason: string };

export function contractRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

export function contractId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 256
    && value.trim() === value && !/[\\\s]/.test(value);
}

/** Canonical app IDs are stable slugs/UUIDs, never deployment URLs or paths. */
export function contractAppId(value: unknown): value is string {
  // Application IDs are registry slugs/UUIDs, never URI schemes or origins.
  if (typeof value !== 'string' || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(value)) return false;
  return parseIdentityId('application', value) !== null;
}

export function contractExactKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

/** Reject redirects that cannot be matched by strict exact-string comparison. */
export function validateOAuthRedirectUri(
  candidate: unknown,
  platform: OAuthPlatform,
  verifiedHosts: readonly string[] = [],
): ContractCheck<string> {
  if (typeof candidate !== 'string' || candidate.length > 2048 || candidate.trim() !== candidate
    || candidate.includes('*') || candidate.includes('#')) {
    return { ok: false, reason: 'INVALID_REDIRECT_URI' };
  }
  let parsed: URL;
  try { parsed = new URL(candidate); } catch { return { ok: false, reason: 'INVALID_REDIRECT_URI' }; }
  if (parsed.username || parsed.password || parsed.hash || parsed.search || !parsed.pathname
    || parsed.href !== candidate) {
    return { ok: false, reason: 'NON_CANONICAL_REDIRECT_URI' };
  }
  if (platform === 'desktop') {
    if (parsed.protocol !== 'http:' || !['127.0.0.1', '[::1]'].includes(parsed.hostname)
      || !parsed.port || Number(parsed.port) < 1 || Number(parsed.port) > 65535
      || parsed.pathname === '/') {
      return { ok: false, reason: 'DESKTOP_REQUIRES_EXACT_LOOPBACK_CALLBACK' };
    }
  } else if (parsed.protocol !== 'https:' || !parsed.hostname
    || parsed.hostname === 'localhost' || parsed.hostname.endsWith('.localhost')
    || parsed.hostname.includes(':')) {
    return { ok: false, reason: 'WEB_OR_MOBILE_REQUIRES_HTTPS' };
  } else if ((platform === 'ios' || platform === 'android')
    && !verifiedHosts.includes(parsed.hostname)) {
    return { ok: false, reason: 'MOBILE_HOST_NOT_VERIFIED' };
  }
  return { ok: true, value: candidate };
}

export function validateOAuthClientRegistration(
  input: unknown,
): ContractCheck<OAuthClientRegistrationV1> {
  const o = contractRecord(input);
  if (!o || !contractExactKeys(o, [
    'schemaVersion', 'appId', 'clientId', 'platform', 'publicClient',
    'pkceMethod', 'redirectUris', 'verifiedHosts',
  ])) return { ok: false, reason: 'INVALID_CLIENT_FIELDS' };
  if (o.schemaVersion !== 1 || !contractAppId(o.appId) || parseIdentityId('oauth_client', o.clientId) === null
    || !['web', 'ios', 'android', 'desktop'].includes(String(o.platform))
    || o.publicClient !== true || o.pkceMethod !== 'S256') {
    return { ok: false, reason: 'INVALID_CLIENT_IDENTITY_OR_PKCE' };
  }
  const platform = o.platform as OAuthPlatform;
  const hosts = o.verifiedHosts === undefined ? [] : o.verifiedHosts;
  if (!Array.isArray(hosts) || !hosts.every(
    (host) => typeof host === 'string' && host === host.toLowerCase()
      && /^[a-z0-9.-]+$/.test(host) && !host.includes('..') && !host.startsWith('.'),
  )) return { ok: false, reason: 'INVALID_VERIFIED_HOSTS' };
  if (!Array.isArray(o.redirectUris) || o.redirectUris.length === 0
    || o.redirectUris.length > 32 || new Set(o.redirectUris).size !== o.redirectUris.length) {
    return { ok: false, reason: 'INVALID_REDIRECT_SET' };
  }
  for (const uri of o.redirectUris) {
    const result = validateOAuthRedirectUri(uri, platform, hosts as string[]);
    if (!result.ok) return result;
  }
  return { ok: true, value: input as OAuthClientRegistrationV1 };
}
