import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApplicationAuthClient } from '../src/auth/applicationAuthClient.js';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('canonical application OAuth browser contract', () => {
  it('redirects to first-party backend rather than Google or a bearer callback', () => {
    const navigate = vi.fn();
    const auth = new ApplicationAuthClient({ navigate });
    auth.signInWithGoogle('/workspace');
    expect(navigate).toHaveBeenCalledWith('/api/auth/oidc/start?next=%2Fworkspace');
    expect(auth.getAuthHeaders()).toEqual({});
  });

  it('rejects protocol-relative, cross-origin and backslash return targets', () => {
    const auth = new ApplicationAuthClient({ navigate: vi.fn() });
    for (const path of ['//other.example', '/\\evil.example', 'https://other.example/path']) {
      expect(() => auth.startSignIn(path)).toThrow();
    }
  });

  it('returns a validated server-issued session without exposing bearer tokens', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({
      authenticated: true,
      user: { id: 'verified-user', name: 'Test', email: 'test@example.com' },
      session: { id: 'opaque-session', userId: 'verified-user', expiresAt: '2030-01-01T00:00:00Z' },
    }));
    const auth = new ApplicationAuthClient({ fetcher });
    const session = await auth.getSession();
    expect(session.authenticated).toBe(true);
    expect(session.user?.id).toBe('verified-user');
    expect(fetcher).toHaveBeenCalledWith('/api/auth/oidc/session', expect.objectContaining({
      method: 'GET', credentials: 'same-origin',
    }));
  });

  it('returns unauthenticated only on 401 and keeps temporary outages distinguishable', async () => {
    const forbidden = new ApplicationAuthClient({ fetcher: vi.fn().mockResolvedValue(new Response(null, {status: 401})) });
    expect((await forbidden.getSession()).authenticated).toBe(false);
    const offline = new ApplicationAuthClient({ fetcher: vi.fn().mockResolvedValue(new Response(null, {status: 503})) });
    await expect(offline.getSession()).rejects.toThrow(/AUTH_SESSION_UNAVAILABLE/);
  });

  it('does not claim logout unless server revocation is independently confirmed', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(Response.json({ success: true }))
      .mockResolvedValueOnce(new Response(null, { status: 401 }));
    const auth = new ApplicationAuthClient({ fetcher });
    await expect(auth.signOut()).resolves.toBeUndefined();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
