import type { LuthSessionResult } from './luthAuthTypes.js';
import { LuthAuthError } from './luthAuthTypes.js';

/**
 * Browser-side contract for the canonical Kloks OAuth backend-for-frontend.
 *
 * No OAuth code, verifier, access token, refresh token or Luth cookie is ever
 * available to application JavaScript. The app backend owns the PKCE exchange,
 * its opaque first-party HttpOnly cookie and all privileged session checks.
 */
export interface ApplicationAuthClientConfig {
  basePath?: string;
  fetcher?: typeof fetch;
  /** Navigation hook for native hosts and deterministic tests. */
  navigate?: (destination: string) => void;
}

export class ApplicationAuthClient {
  private readonly basePath: string;
  private readonly fetcher: typeof fetch;
  private readonly navigate: (destination: string) => void;

  constructor(config: ApplicationAuthClientConfig = {}) {
    const path = config.basePath || '/api/auth/oidc';
    if (!/^\/[A-Za-z0-9/_-]+$/.test(path) || path.includes('//')) {
      throw new LuthAuthError('INVALID_APPLICATION_AUTH_PATH', 'App authentication must use a fixed local path.');
    }
    this.basePath = path.replace(/\/$/, '');
    this.fetcher = config.fetcher || fetch;
    this.navigate = config.navigate || ((url) => {
      if (typeof window === 'undefined') throw new Error('Browser navigation unavailable.');
      window.location.assign(url);
    });
  }

  /** The app never forwards Luth bearer credentials from browser storage. */
  public getAuthHeaders(): HeadersInit {
    return {};
  }

  /** Starts the complete Luth-hosted Google/email login and consent flow. */
  public startSignIn(returnTo?: string): void {
    const next = returnTo || (typeof window !== 'undefined'
      ? window.location.pathname + window.location.search + window.location.hash : '/');
    if (!next.startsWith('/') || next.startsWith('//') || next.includes('\\') ||
        /[\x00-\x1F\x7F]/.test(next)) {
      throw new LuthAuthError('INVALID_AUTH_RETURN_PATH', 'Login return path must be local.');
    }
    this.navigate(this.basePath + '/start?next=' + encodeURIComponent(next));
  }

  public signInWithGoogle(returnTo?: string): void {
    this.startSignIn(returnTo);
  }

  public signInWithEmail(returnTo?: string): void {
    this.startSignIn(returnTo);
  }

  public async getSession(): Promise<LuthSessionResult> {
    let response: Response;
    try {
      response = await this.fetcher(this.basePath + '/session', {
        method: 'GET', credentials: 'same-origin', cache: 'no-store',
      });
    } catch {
      throw new LuthAuthError('AUTH_SESSION_UNAVAILABLE', 'Application authentication service is unavailable.', 503);
    }
    if (response.status === 401) return { authenticated: false, error: 'SESSION_INVALID' };
    if (!response.ok) throw new LuthAuthError('AUTH_SESSION_UNAVAILABLE', 'Application authentication service is unavailable.', response.status);
    const payload = await response.json() as LuthSessionResult;
    if (payload?.authenticated !== true || !payload.user?.id || !payload.user.email ||
        !payload.session?.id) {
      throw new LuthAuthError('AUTH_SESSION_INVALID', 'Application returned an invalid authenticated session.');
    }
    return payload;
  }

  public async signOut(): Promise<void> {
    let response: Response;
    try {
      response = await this.fetcher(this.basePath + '/logout', {
        method: 'POST', credentials: 'same-origin', cache: 'no-store',
        headers: { 'content-type': 'application/json' }, body: '{}',
      });
    } catch {
      throw new LuthAuthError('AUTH_LOGOUT_UNAVAILABLE', 'Logout service is unavailable.', 503);
    }
    if (!response.ok) throw new LuthAuthError('AUTH_LOGOUT_REJECTED', 'Logout was rejected by the application.', response.status);
    const verify = await this.getSession();
    if (verify.authenticated) throw new LuthAuthError('AUTH_LOGOUT_UNVERIFIED', 'Application session remains valid after logout.');
  }
}

export function createApplicationAuthClient(config: ApplicationAuthClientConfig = {}): ApplicationAuthClient {
  return new ApplicationAuthClient(config);
}
