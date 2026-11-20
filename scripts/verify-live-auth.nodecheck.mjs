import { test } from 'node:test';
import assert from 'node:assert/strict';
import { APPS, AUTH_ORIGIN, verifyProductionAuth } from './verify-live-auth.mjs';

function mock({ ready = false, leaked = false, validConfig = false, maliciousRedirect = false } = {}) {
  return async function fetcher(input, init) {
    const url = new URL(input), app = APPS.find(a => a.origin === url.origin);
    if (app) {
      if (url.pathname === '/api/auth/oidc/start') {
        if (!ready) return Response.json({ error: 'CANONICAL_APP_AUTH_NOT_PROVISIONED' }, { status: 503 });
        const target = new URL('/api/auth/oauth2/authorize', maliciousRedirect ? 'https://evil.invalid' : AUTH_ORIGIN);
        target.searchParams.set('response_type', 'code');
        target.searchParams.set('code_challenge_method', 'S256');
        target.searchParams.set('code_challenge', 'x'.repeat(43));
        target.searchParams.set('redirect_uri', app.origin + '/api/auth/oidc/callback');
        return new Response(null, { status: 303, headers: {
          location: target.toString(), 'set-cookie': '__Host-ultrst_oidc_flow=abc; Path=/; Secure; HttpOnly; SameSite=Lax',
        } });
      }
      if (url.pathname === '/api/auth/oidc/session') return Response.json({}, { status: 401 });
      if (url.pathname === '/api/auth/oidc/callback') return Response.json({}, { status: 400 });
    }
    if (url.origin !== AUTH_ORIGIN) throw new Error('Unexpected mock host');
    if (url.pathname === '/api/discovery/v1') {
      if (init.method === 'POST') return Response.json({}, { status: 405 });
      const appId = url.searchParams.get('app_id');
      if (appId === '../../secret') return Response.json({}, { status: 400 });
      if (!APPS.some(a => a.appId === appId)) return Response.json({}, { status: 404 });
      return Response.json({
        protocol: 'ultrst.discovery.v1', version: 1,
        application: { appId }, issuer: AUTH_ORIGIN + '/api/auth',
        configurationUrl: AUTH_ORIGIN + '/api/config/v1',
        publicOAuth: { nativeClientSecretAllowed: false },
        ...(leaked ? { clientSecret: 'do-not-expose' } : {}),
      });
    }
    if (url.pathname === '/api/config/v1') return Response.json({}, {
      status: validConfig ? 200 : 401, headers: { 'cache-control': 'private, no-store' },
    });
    if (url.pathname === '/api/registry/oauth-clients') return Response.json({}, {
      status: init.method === 'POST' ? 403 : 401,
    });
    throw new Error('Unexpected mock path ' + url.pathname);
  };
}

test('certifies no-session denial and records unprovisioned apps without claiming login', async () => {
  const report = await verifyProductionAuth({ fetcher: mock() });
  assert.equal(report.result, 'public_boundaries_pass');
  assert.equal(report.oauthStartReady, 0);
  assert.equal(report.interactiveLogin, 'not_tested_requires_user_session');
});

test('strict post-enrollment mode cannot pass without real OAuth clients', async () => {
  await assert.rejects(() => verifyProductionAuth({ fetcher: mock(), requireEnrolled: true }),
    /not provisioned/);
});

test('post-enrollment mode requires issuer-pinned authorization code with PKCE', async () => {
  const report = await verifyProductionAuth({ fetcher: mock({ ready: true }), requireEnrolled: true });
  assert.equal(report.oauthStartReady, 2);
  assert.equal(report.authenticatedConfig, 'not_tested_requires_user_session');
});

test('forged authorization response and leaked discovery secret are denied', async () => {
  await assert.rejects(() => verifyProductionAuth({ fetcher: mock({ validConfig: true }) }),
    /status/);
  await assert.rejects(() => verifyProductionAuth({ fetcher: mock({ leaked: true }) }),
    /Confidential field exposed/);
  await assert.rejects(() => verifyProductionAuth({ fetcher: mock({ ready: true, maliciousRedirect: true }) }),
    /untrusted OAuth issuer/);
});
