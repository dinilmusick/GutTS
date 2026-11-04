import {
  type DeploymentEnvironment,
  type EmailSignInCredentials,
  type EmailSignUpData,
  type GoogleSignInOptions,
  type LuthAuthClientConfig,
  LuthAuthError,
  type LuthAuthTokenStore,
  type LuthSessionResult,
  type RegisterApplicationResult,
} from './luthAuthTypes.js';

export function resolveClientOrigin(explicitOrigin?: string): string {
  if (explicitOrigin?.trim()) return explicitOrigin.trim();
  if (typeof window !== 'undefined' && window.location?.origin) return window.location.origin;
  return '';
}

export function resolveClientEnvironment(origin: string): DeploymentEnvironment {
  try {
    const host = new URL(origin).hostname.toLowerCase();
    if (host === 'localhost' || host === '127.0.0.1' || host === '[::1]') return 'development';
    if (host.includes('staging')) return 'staging';
    if (host.includes('preview') || host.includes('-git-') || host.endsWith('.workers.dev')) return 'preview';
    return 'production';
  } catch {
    return 'production';
  }
}

const browserTokenStore: LuthAuthTokenStore = {
  get: () => {
    try { return sessionStorage.getItem('luth-session-token') || ''; } catch { return ''; }
  },
  set: (token) => {
    try { sessionStorage.setItem('luth-session-token', token); } catch {}
  },
  clear: () => {
    try { sessionStorage.removeItem('luth-session-token'); } catch {}
  },
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class LuthAuthClient {
  public readonly ecosystemId: string;
  public readonly applicationId: string;
  public readonly luthUrl: string;
  public readonly origin: string;
  public readonly environment: DeploymentEnvironment;
  private readonly autoRegister: boolean;
  private readonly maxRetries: number;
  private readonly retryDelayMs: number;
  private readonly tokenStore: LuthAuthTokenStore;
  private registrationPromise: Promise<RegisterApplicationResult> | null = null;

  constructor(config: LuthAuthClientConfig) {
    this.ecosystemId = config.ecosystemId;
    this.applicationId = config.applicationId;
    this.luthUrl = (config.luthUrl || 'https://luth.blueprint-ninjastudios.workers.dev').replace(/\/+$/, '');
    this.origin = resolveClientOrigin(config.origin);
    this.environment = config.environment || resolveClientEnvironment(this.origin);
    this.autoRegister = config.autoRegister ?? true;
    this.maxRetries = config.maxRetries ?? 3;
    this.retryDelayMs = config.retryDelayMs ?? 100;
    this.tokenStore = config.tokenStore || browserTokenStore;
  }

  public getAuthHeaders(): HeadersInit {
    const token = this.tokenStore.get();
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  public clearAuthToken(): void {
    this.tokenStore.clear();
  }

  private async request(path: string, init: RequestInit = {}): Promise<Response> {
    return fetch(`${this.luthUrl}${path}`, {
      ...init,
      credentials: init.credentials ?? 'include',
      cache: init.cache ?? 'no-store',
      headers: { ...this.getAuthHeaders(), ...(init.headers || {}) },
    });
  }

  public async register(): Promise<RegisterApplicationResult> {
    let lastError: unknown = null;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const response = await this.request('/api/registry/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ecosystemId: this.ecosystemId,
            applicationId: this.applicationId,
            origin: this.origin,
            environment: this.environment,
          }),
        });
        const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
        if (response.ok) return data as unknown as RegisterApplicationResult;
        const error = new LuthAuthError(
          String(data.code || (response.status === 404 ? 'APPLICATION_NOT_REGISTERED' : 'REGISTRATION_FAILED')),
          String(data.message || 'Application registration failed'),
          response.status,
        );
        if (response.status < 500) throw error;
        lastError = error;
      } catch (error) {
        if (error instanceof LuthAuthError && error.status && error.status < 500) throw error;
        lastError = error;
      }
      if (attempt < this.maxRetries) await sleep(this.retryDelayMs * 2 ** attempt);
    }
    throw new LuthAuthError(
      'REGISTRATION_FAILED',
      lastError instanceof Error ? lastError.message : 'Application registration timed out',
    );
  }

  public async ensureRegistered(): Promise<RegisterApplicationResult | null> {
    if (!this.autoRegister) return null;
    if (!this.registrationPromise) {
      this.registrationPromise = this.register().catch((error) => {
        this.registrationPromise = null;
        throw error;
      });
    }
    return this.registrationPromise;
  }

  public async getSession(): Promise<LuthSessionResult> {
    await this.ensureRegistered();
    const response = await this.request('/api/session');
    const token = response.headers?.get?.('set-auth-token');
    if (token) this.tokenStore.set(token);
    if (response.status === 401) {
      this.clearAuthToken();
      return { authenticated: false, error: 'SESSION_INVALID' };
    }
    if (!response.ok) throw new LuthAuthError('AUTHENTICATION_FAILED', `Session fetch failed (${response.status})`, response.status);
    const result = await response.json() as LuthSessionResult;
    if (result.session?.token) this.tokenStore.set(result.session.token);
    return result;
  }

  public async signInWithEmail(credentials: EmailSignInCredentials): Promise<unknown> {
    await this.ensureRegistered();
    return this.postAuth('/api/auth/sign-in/email', credentials, 'Sign in failed');
  }

  public async signUpWithEmail(data: EmailSignUpData): Promise<unknown> {
    await this.ensureRegistered();
    return this.postAuth('/api/auth/sign-up/email', data, 'Sign up failed');
  }

  public async signInWithGoogle(options?: GoogleSignInOptions): Promise<unknown> {
    await this.ensureRegistered();
    return this.postAuth('/api/auth/sign-in/social', {
      provider: 'google',
      callbackURL: options?.callbackURL || this.origin,
    }, 'Google sign-in failed');
  }

  public async signOut(): Promise<void> {
    const response = await this.request('/api/auth/sign-out', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) {
      throw new LuthAuthError(String(data.code || 'AUTHENTICATION_FAILED'), String(data.message || 'Sign out failed'), response.status);
    }
    this.clearAuthToken();
    const session = await this.getSession();
    if (session.authenticated) {
      throw new LuthAuthError('SESSION_INVALIDATION_FAILED', 'Luth session is still active after sign-out.');
    }
  }

  private async postAuth(path: string, body: unknown, fallback: string): Promise<unknown> {
    const response = await this.request(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    const session = data.session as Record<string, unknown> | undefined;
    const token = response.headers?.get?.('set-auth-token') || String(data.token || session?.token || '');
    if (token) this.tokenStore.set(token);
    if (!response.ok) {
      throw new LuthAuthError(String(data.code || 'AUTHENTICATION_FAILED'), String(data.message || fallback), response.status);
    }
    return data;
  }
}

export function createLuthAuthClient(config: LuthAuthClientConfig): LuthAuthClient {
  return new LuthAuthClient(config);
}
