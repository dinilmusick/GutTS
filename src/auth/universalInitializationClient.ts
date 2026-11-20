import {
  DEFAULT_UNIVERSAL_DISCOVERY_URL,
  parseUniversalDiscoveryV1,
  parseUniversalConfigurationV1,
  UniversalInitializationError,
  type UniversalBootstrapOptions,
  type UniversalDiscoveryV1,
  type UniversalConfigurationV1,
  type UniversalAuthReadiness,
} from './universalInitialization.js';

export interface UniversalInitializationTransport {
  fetcher?: typeof fetch;
  /** Custom origin is permitted only if it matches the pinned expected issuer. */
  expectedIssuerOrigin: string;
  /** Optional Authorization from the existing platform authentication adapter. */
  authorize?: () => Promise<HeadersInit>;
  /** Default: public Luth canonical discovery endpoint. */
  discoveryUrls?: string[];
  timeoutMs?: number;
  retries?: number;
  onStateChange?: (state: UniversalAuthReadiness) => void;
}

function safeOrigin(value: string): string {
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash ||
      (url.protocol !== 'https:' &&
       !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) {
    throw new UniversalInitializationError('UNTRUSTED_ISSUER', 'A pinned HTTPS issuer is required.');
  }
  return url.origin;
}

export class UniversalInitializationClient {
  private state: UniversalAuthReadiness = 'discovery';
  private cachedDiscovery: { value: UniversalDiscoveryV1; expiresAt: number } | null = null;
  private readonly pinnedOrigin: string;
  private readonly fetcher: typeof fetch;

  constructor(
    private readonly bootstrap: UniversalBootstrapOptions,
    private readonly transport: UniversalInitializationTransport,
  ) {
    if (!/^[a-z0-9][a-z0-9_-]{0,119}$/.test(bootstrap.appId)) {
      throw new UniversalInitializationError('INVALID_DISCOVERY', 'Canonical app ID is invalid.');
    }
    this.pinnedOrigin = safeOrigin(transport.expectedIssuerOrigin);
    this.fetcher = transport.fetcher ?? fetch;
  }

  get readiness(): UniversalAuthReadiness { return this.state; }

  /** Release a potentially stale discovery document on logout, revocation or app switch. */
  invalidate(): void {
    this.cachedDiscovery = null;
    this.change('discovery');
  }

  private change(value: UniversalAuthReadiness): void {
    this.state = value;
    this.transport.onStateChange?.(value);
  }

  private async fetchJson(
    url: string, init: RequestInit, retry: boolean,
  ): Promise<unknown> {
    const count = retry ? Math.max(0, Math.min(this.transport.retries ?? 1, 3)) : 0;
    let lastError: unknown;
    for (let attempt = 0; attempt <= count; attempt++) {
      const controller = new AbortController();
      const timeoutMs = Math.max(1000, Math.min(this.transport.timeoutMs ?? 8000, 30000));
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await this.fetcher(url, {
          ...init, signal: controller.signal, redirect: 'error',
          cache: init.cache ?? 'no-store',
        });
        if (response.status === 401) throw new UniversalInitializationError(
          'AUTHENTICATION_REQUIRED', 'Authenticate with Luth first.', 401,
        );
        if (response.status === 403) throw new UniversalInitializationError(
          'AUTHORIZATION_DENIED', 'Application or workspace access denied.', 403,
        );
        if (response.status === 404) throw new UniversalInitializationError(
          'APP_NOT_FOUND', 'Application is not registered.', 404,
        );
        if (response.status === 400 || response.status === 426) throw new UniversalInitializationError(
          'CONFIG_VERSION_UNSUPPORTED', 'Unsupported initialization request.', response.status,
        );
        if (!response.ok) {
          if (attempt < count && [502, 503, 504].includes(response.status)) continue;
          throw new UniversalInitializationError(
            'CONFIG_UNAVAILABLE', 'Luth initialization unavailable.', response.status,
          );
        }
        const data = await response.json();
        return data;
      } catch (error) {
        lastError = error;
        if (error instanceof UniversalInitializationError) throw error;
        if (attempt === count) break;
      } finally {
        clearTimeout(timeout);
      }
    }
    throw lastError instanceof UniversalInitializationError
      ? lastError
      : new UniversalInitializationError('DISCOVERY_UNAVAILABLE', 'Luth network unavailable.');
  }

  async discover(forceRefresh = false): Promise<UniversalDiscoveryV1> {
    if (!forceRefresh && this.cachedDiscovery && this.cachedDiscovery.expiresAt > Date.now()) {
      return this.cachedDiscovery.value;
    }
    this.change('discovery');
    const urls = this.transport.discoveryUrls ??
      [this.bootstrap.discoveryUrl ?? DEFAULT_UNIVERSAL_DISCOVERY_URL];
    let last: unknown = null;
    for (const rawUrl of urls) {
      try {
        const url = new URL(rawUrl);
        if (safeOrigin(rawUrl) !== this.pinnedOrigin ||
            url.pathname !== '/api/discovery/v1') {
          throw new UniversalInitializationError('UNTRUSTED_ISSUER', 'Discovery URL does not match pinned issuer.');
        }
        url.searchParams.set('app_id', this.bootstrap.appId);
        const data = await this.fetchJson(url.toString(),
          { method: 'GET', credentials: 'omit' }, true);
        const document = parseUniversalDiscoveryV1(data, this.bootstrap.appId, this.pinnedOrigin);
        this.cachedDiscovery = {
          value: document,
          expiresAt: Date.now() + Math.min(30, document.cache.maxAgeSeconds) * 1000,
        };
        this.change('unauthenticated');
        return document;
      } catch (error) {
        last = error;
        if (error instanceof UniversalInitializationError &&
            ['UNTRUSTED_ISSUER', 'INVALID_DISCOVERY', 'APP_NOT_FOUND'].includes(error.code)) {
          this.change('denied');
          throw error;
        }
      }
    }
    this.change('unavailable');
    throw last ?? new UniversalInitializationError('DISCOVERY_UNAVAILABLE', 'No Luth discovery endpoint responded.');
  }

  /**
   * The authentication adapter owns cookie/bearer transport; this client never
   * stores or mints tokens. Luth independently verifies all configuration calls.
   * Only non-secret user configuration is retrieved; trusted-workload secret
   * delivery is explicitly unsupported until identity federation is deployed.
   */
  async configuration(): Promise<UniversalConfigurationV1> {
    const document = await this.discover();
    this.change('configuring');
    try {
      const url = new URL(document.configurationUrl);
      url.searchParams.set('app_id', this.bootstrap.appId);
      const headers = new Headers(await this.transport.authorize?.());
      const data = await this.fetchJson(url.toString(), {
        method: 'GET', credentials: 'include',
        headers,
      }, false);
      const result = parseUniversalConfigurationV1(data, this.bootstrap.appId);
      this.change('ready');
      return result;
    } catch (error) {
      const code = error instanceof UniversalInitializationError ? error.code : 'CONFIG_UNAVAILABLE';
      this.change(code === 'AUTHENTICATION_REQUIRED' ? 'unauthenticated' :
        code === 'AUTHORIZATION_DENIED' || code === 'APP_IDENTITY_UNVERIFIED'
          ? 'denied' : 'unavailable');
      throw error;
    }
  }
}

export function createUniversalInitializationClient(
  bootstrap: UniversalBootstrapOptions,
  transport: UniversalInitializationTransport,
): UniversalInitializationClient {
  return new UniversalInitializationClient(bootstrap, transport);
}
