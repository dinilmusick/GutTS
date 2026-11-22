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
    expect(navigate).toHaveBeenCalledWith('/api/auth/oidc/start?method=google&next=%2Fworkspace');
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
  it('signs in through the same-origin email BFF and reads only the verified opaque session', async () => {
    const verified = { authenticated: true,
      user: { id: 'uid', email: 'person@example.test', name: 'Example' },
      session: { id: 'opaque', expiresAt: '2027-01-01T00:00:00Z' } };
    const fetcher = vi.fn()
      .mockResolvedValueOnce(Response.json({ success: true }))
      .mockResolvedValueOnce(Response.json(verified));
    const auth = new ApplicationAuthClient({ fetcher });
    const session = await auth.signInWithEmailCredentials({
      email: 'person@example.test', password: 'private-password',
    });
    expect(session.user?.id).toBe('uid');
    expect(fetcher).toHaveBeenNthCalledWith(1, '/api/auth/oidc/email/sign-in',
      expect.objectContaining({ method: 'POST', credentials: 'same-origin', cache: 'no-store' }));
    const post = fetcher.mock.calls[0]![1];
    expect(JSON.parse(post.body)).toEqual({ email: 'person@example.test', password: 'private-password' });
    expect(fetcher.mock.calls[1]![0]).toBe('/api/auth/oidc/session');
    expect(auth.getAuthHeaders()).toEqual({});
  });

  it('registers through the same canonical BFF rather than creating an app-local account', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(Response.json({ success: true }))
      .mockResolvedValueOnce(Response.json({
        authenticated: true, user: { id: 'new', email: 'new@example.test' },
        session: { id: 'opaque' },
      }));
    const auth = new ApplicationAuthClient({ fetcher });
    expect((await auth.signUpWithEmailCredentials({
      name: 'New User', email: 'new@example.test', password: 'private-password',
    })).authenticated).toBe(true);
    expect(fetcher.mock.calls[0]![0]).toBe('/api/auth/oidc/email/sign-up');
  });

  it('does not accept a successful email POST without server-verified session hydration', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(Response.json({ success: true }))
      .mockResolvedValueOnce(new Response(null, { status: 401 }));
    const auth = new ApplicationAuthClient({ fetcher });
    expect((await auth.signInWithEmailCredentials({
      email: 'user@example.test', password: 'pass',
    })).authenticated).toBe(false);
  });

  it('preserves validation errors without exposing provider credentials or tokens', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ error: 'INVALID_EMAIL_CREDENTIALS' }, { status: 401 }));
    const auth = new ApplicationAuthClient({ fetcher });
    await expect(auth.signInWithEmailCredentials({ email: 'user@example.test', password: 'wrong' }))
      .rejects.toThrow('Incorrect email address or password.');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

});
