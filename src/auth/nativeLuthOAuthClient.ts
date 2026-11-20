import {
  DEFAULT_UNIVERSAL_DISCOVERY_URL,
  UniversalInitializationError,
  type UniversalConfigurationV1,
} from './universalInitialization.js';
import { createUniversalInitializationClient } from './universalInitializationClient.js';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
function b64url(bytes: Uint8Array): string {
  let bits = 0, value = 0, result = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 6) {
      bits -= 6;
      result += ALPHABET[(value >>> bits) & 63];
    }
  }
  if (bits > 0) result += ALPHABET[(value << (6 - bits)) & 63];
  return result;
}
function randomToken(): string { return b64url(crypto.getRandomValues(new Uint8Array(32))); }
function equals(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let i = 0; i < left.length; i++) difference |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return difference === 0;
}
function validNativeRedirect(input: string): URL {
  const value = new URL(input);
  if (value.username || value.password || value.search || value.hash ||
      !value.pathname || value.pathname === '/') {
    throw new Error('INVALID_REGISTERED_NATIVE_REDIRECT');
  }
  const loopback = value.protocol === 'http:' &&
    ['127.0.0.1', '[::1]', 'localhost'].includes(value.hostname);
  if (value.protocol !== 'https:' && !loopback &&
      !/^[a-z][a-z0-9+.-]*:$/.test(value.protocol)) {
    throw new Error('INVALID_REGISTERED_NATIVE_REDIRECT');
  }
  return value;
}

export interface NativeLuthSecureStore {
  /** Must be implemented by platform Keychain/Keystore or equivalent. */
  read(key: string): Promise<string | null>;
  write(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}
export interface NativeLuthPublicClientOptions {
  appId: string;
  clientId: string;
  registeredRedirectUri: string;
  expectedLuthOrigin: string;
  runtime: 'desktop' | 'android' | 'ios';
  secureStore: NativeLuthSecureStore;
  fetcher?: typeof fetch;
}
interface PendingAuthorization { state: string; verifier: string; createdAt: number }
interface TokenRecord {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
}
const STORE_PENDING = 'ultrst.luth.native.oauth.pending.v1';
const STORE_TOKEN = 'ultrst.luth.native.oauth.token.v1';

/**
 * Native public OAuth client. No client secret is accepted or serialized.
 * Registration, secure storage and OS browser/deep-link handling belong to
 * platform adapters. No HTTP loopback is permitted except local loopback.
 */
export function createNativeLuthOAuthClient(options: NativeLuthPublicClientOptions) {
  if (!/^[a-z0-9][a-z0-9_-]{0,119}$/.test(options.appId) ||
      !/^[a-zA-Z0-9._~-]{3,200}$/.test(options.clientId)) {
    throw new Error('UNREGISTERED_NATIVE_APPLICATION');
  }
  const redirect = validNativeRedirect(options.registeredRedirectUri);
  const luth = new URL(options.expectedLuthOrigin);
  if (luth.protocol !== 'https:' &&
      !(luth.protocol === 'http:' &&
        ['localhost', '127.0.0.1', '[::1]'].includes(luth.hostname))) {
    throw new Error('UNTRUSTED_LUTH_ISSUER');
  }
  const issuerOrigin = luth.origin;
  const fetcher = options.fetcher ?? fetch;
  const client = createUniversalInitializationClient(
    { appId: options.appId, runtime: options.runtime,
      discoveryUrl: issuerOrigin + '/api/discovery/v1' },
    { expectedIssuerOrigin: issuerOrigin, fetcher,
      authorize: async () => {
        const record = await readToken();
        if (!record || record.expiresAt <= Date.now()) {
          throw new UniversalInitializationError('AUTHENTICATION_REQUIRED', 'Native OAuth session expired.');
        }
        return { authorization: 'Bearer ' + record.accessToken };
      } },
  );

  async function readToken(): Promise<TokenRecord | null> {
    const raw = await options.secureStore.read(STORE_TOKEN);
    if (!raw) return null;
    try {
      const token = JSON.parse(raw) as TokenRecord;
      return typeof token.accessToken === 'string' && typeof token.expiresAt === 'number'
        ? token : null;
    } catch { return null; }
  }

  async function beginAuthorization(): Promise<string> {
    const doc = await client.discover();
    if (!doc.capabilities.publicNativeClients || !doc.capabilities.pkceS256) {
      throw new Error('NATIVE_OAUTH_CLIENT_NOT_REGISTERED');
    }
    const state = randomToken(), verifier = randomToken();
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
    await options.secureStore.write(STORE_PENDING, JSON.stringify({
      state, verifier, createdAt: Date.now(),
    } satisfies PendingAuthorization));
    const url = new URL(doc.issuer + '/oauth2/authorize');
    const params = {
      response_type: 'code', client_id: options.clientId,
      redirect_uri: redirect.toString(), scope: 'openid profile email offline_access',
      state, code_challenge: b64url(digest), code_challenge_method: 'S256',
    };
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    return url.toString();
  }

  async function completeAuthorization(callbackUrl: string): Promise<void> {
    const raw = await options.secureStore.read(STORE_PENDING);
    if (!raw) throw new Error('NATIVE_AUTHORIZATION_NOT_STARTED');
    let pending: PendingAuthorization;
    try { pending = JSON.parse(raw) as PendingAuthorization; }
    catch { throw new Error('NATIVE_AUTHORIZATION_STATE_INVALID'); }
    if (!pending.state || !pending.verifier || !Number.isFinite(pending.createdAt) ||
        Date.now() - pending.createdAt > 600_000 || pending.createdAt > Date.now() + 30_000) {
      await options.secureStore.remove(STORE_PENDING);
      throw new Error('NATIVE_AUTHORIZATION_EXPIRED');
    }
    const callback = new URL(callbackUrl);
    if (callback.origin !== redirect.origin || callback.pathname !== redirect.pathname ||
        callback.username || callback.password || callback.hash ||
        callback.searchParams.getAll('code').length !== 1 ||
        callback.searchParams.getAll('state').length !== 1 ||
        callback.searchParams.getAll('iss').length !== 1 ||
        !equals(callback.searchParams.get('state') || '', pending.state) ||
        callback.searchParams.get('iss') !== issuerOrigin + '/api/auth' ||
        !/^[A-Za-z0-9._~-]{16,2048}$/.test(callback.searchParams.get('code') || '')) {
      throw new Error('NATIVE_AUTHORIZATION_CALLBACK_REJECTED');
    }
    await options.secureStore.remove(STORE_PENDING); // consume before exchange
    const endpoint = issuerOrigin + '/api/auth/oauth2/token';
    const response = await fetcher(endpoint, {
      method: 'POST', cache: 'no-store', credentials: 'omit', redirect: 'error',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: options.clientId, redirect_uri: redirect.toString(),
        code: callback.searchParams.get('code')!, code_verifier: pending.verifier,
      }),
    });
    if (!response.ok) throw new Error('NATIVE_OAUTH_CODE_EXCHANGE_REJECTED');
    const token = await response.json() as Record<string, unknown>;
    if (token.token_type !== 'Bearer' || typeof token.access_token !== 'string' ||
        typeof token.expires_in !== 'number' || token.expires_in <= 0 ||
        token.expires_in > 86400 ||
        (token.refresh_token != null && typeof token.refresh_token !== 'string')) {
      throw new Error('NATIVE_OAUTH_TOKEN_RESPONSE_INVALID');
    }
    await options.secureStore.write(STORE_TOKEN, JSON.stringify({
      accessToken: token.access_token,
      ...(typeof token.refresh_token === 'string' ? { refreshToken: token.refresh_token } : {}),
      expiresAt: Date.now() + token.expires_in * 1000,
    } satisfies TokenRecord));
  }

  async function getConfiguration(): Promise<UniversalConfigurationV1> {
    return client.configuration();
  }

  async function signOut(): Promise<void> {
    const token = await readToken();
    await options.secureStore.remove(STORE_TOKEN);
    await options.secureStore.remove(STORE_PENDING);
    client.invalidate();
    if (!token?.refreshToken) return;
    const response = await fetcher(issuerOrigin + '/api/auth/oauth2/revoke', {
      method: 'POST', cache: 'no-store', credentials: 'omit', redirect: 'error',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: options.clientId,
        token: token.refreshToken, token_type_hint: 'refresh_token' }),
    });
    if (!response.ok) throw new Error('NATIVE_OAUTH_REMOTE_REVOCATION_UNVERIFIED');
  }

  return { beginAuthorization, completeAuthorization, getConfiguration, signOut };
}
