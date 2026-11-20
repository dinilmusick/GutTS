/**
 * Public-only ULTRST production auth boundary verification. No user credentials,
 * OAuth client secrets, database connections, or application source are required.
 * A successful run is NOT proof that an interactive user can sign in.
 */
import assert from 'node:assert/strict';
import { resolve } from 'node:path';

export const AUTH_ORIGIN = 'https://luth.blueprint-ninjastudios.workers.dev';
export const APPS = Object.freeze([
  { appId: 'srkl', origin: 'https://srkl-engine.todadjp.workers.dev' },
  { appId: 'aiko', origin: 'https://aiko.todadjp.workers.dev' },
]);
const sensitiveKeys = new Set([
  'clientsecret', 'accesstoken', 'refreshtoken', 'bffsecret',
  'databaseurl', 'systemdatabaseurl', 'privatekey', 'jwtsecret',
]);

function assertNoConfidentialFields(value) {
  if (!value || typeof value !== 'object') return;
  for (const [key, nested] of Object.entries(value)) {
    assert(!sensitiveKeys.has(key.replace(/[-_]/g, '').toLowerCase()),
      `Confidential field exposed: ${key}`);
    assertNoConfidentialFields(nested);
  }
}

export async function verifyProductionAuth({
  fetcher = fetch, requireEnrolled = false,
  luthOrigin = AUTH_ORIGIN, apps = APPS,
} = {}) {
  const results = [];
  async function request(base, route, init = {}) {
    const url = new URL(route, base);
    const response = await fetcher(url.toString(), {
      method: 'GET', redirect: 'manual', cache: 'no-store',
      credentials: 'omit', signal: AbortSignal.timeout(20_000),
      headers: { accept: 'application/json', ...(init.headers ?? {}) },
      ...init,
    });
    assert(response instanceof Response, 'Unexpected HTTP response type');
    return response;
  }
  async function status(base, route, expected, init = {}) {
    const response = await request(base, route, init);
    assert.equal(response.status, expected, `${new URL(route, base).pathname} status`);
    return response;
  }
  function noStore(response, context) {
    assert.match(response.headers.get('cache-control') ?? '', /no-store/i,
      `${context} must not be cached`);
  }
  for (const { appId } of apps) {
    const response = await status(luthOrigin, `/api/discovery/v1?app_id=${appId}`, 200);
    const raw = await response.text();
    assert(raw.length > 0 && raw.length < 32_768, 'Discovery size unavailable/unbounded');
    const doc = JSON.parse(raw);
    assert.equal(doc.protocol, 'ultrst.discovery.v1');
    assert.equal(doc.version, 1);
    assert.equal(doc.application?.appId, appId);
    assert.equal(doc.issuer, luthOrigin + '/api/auth');
    assert.equal(doc.configurationUrl, luthOrigin + '/api/config/v1');
    assert.equal(doc.publicOAuth?.nativeClientSecretAllowed, false);
    assertNoConfidentialFields(doc);
    const unauth = await status(luthOrigin, `/api/config/v1?app_id=${appId}`, 401);
    noStore(unauth, appId + ' unauthorized config');
    const forged = await status(luthOrigin, `/api/config/v1?app_id=${appId}`, 401,
      { headers: { authorization: 'Bearer definitely.invalid.token' } });
    noStore(forged, appId + ' forged bearer');
    results.push({ appId, discovery: 'pass', unauthorizedConfig: 'denied' });
  }
  await status(luthOrigin, '/api/discovery/v1?app_id=nonexistent-app-123', 404);
  await status(luthOrigin, '/api/discovery/v1?app_id=..%2F..%2Fsecret', 400);
  await status(luthOrigin, '/api/discovery/v1?app_id=srkl', 405, { method: 'POST' });
  await status(luthOrigin, '/api/registry/oauth-clients', 401);
  await status(luthOrigin, '/api/registry/oauth-clients', 403, {
    method: 'POST', headers: { origin: 'https://evil.invalid', 'content-type': 'application/json' },
    body: JSON.stringify({ appId: 'srkl', origin: apps[0].origin }),
  });
  let ready = 0;
  for (const { appId, origin } of apps) {
    const start = await request(origin, '/api/auth/oidc/start');
    assert([303, 503].includes(start.status), `${appId} unexpected OAuth start ${start.status}`);
    if (start.status === 303) {
      const location = start.headers.get('location');
      assert(location, `${appId} missing OAuth location`);
      const redirect = new URL(location);
      assert.equal(redirect.origin, luthOrigin, `${appId} untrusted OAuth issuer`);
      assert.equal(redirect.pathname, '/api/auth/oauth2/authorize');
      assert.equal(redirect.searchParams.get('response_type'), 'code');
      assert.equal(redirect.searchParams.get('code_challenge_method'), 'S256');
      assert.match(redirect.searchParams.get('code_challenge') ?? '', /^[A-Za-z0-9_-]{43}$/);
      assert.equal(redirect.searchParams.get('redirect_uri'), origin + '/api/auth/oidc/callback');
      assert(!redirect.searchParams.has('client_secret'));
      assert(!redirect.searchParams.has('code_verifier'));
      const cookie = start.headers.get('set-cookie') ?? '';
      assert.match(cookie, /HttpOnly/i);
      assert.match(cookie, /Secure/i);
      ready++;
      results.push({ appId, oauthStart: 'code_pkce_ready' });
    } else {
      assert(!requireEnrolled, `${appId} is not provisioned: enrollment required`);
      assert(!start.headers.get('location'), `${appId} 503 attempted redirect`);
      results.push({ appId, oauthStart: 'not_provisioned_fail_closed' });
    }
    const unauthSession = await request(origin, '/api/auth/oidc/session');
    assert([401, 403, 503].includes(unauthSession.status),
      `${appId} unauthenticated session must not succeed`);
    const forgedCallback = await request(origin,
      '/api/auth/oidc/callback?code=forged&state=forged');
    assert([400, 401, 403, 503].includes(forgedCallback.status),
      `${appId} forged OAuth callback must be rejected`);
  }
  return {
    result: 'public_boundaries_pass',
    oauthStartReady: ready,
    expectedApps: apps.length,
    interactiveLogin: 'not_tested_requires_user_session',
    authenticatedConfig: 'not_tested_requires_user_session',
    results,
  };
}

if (process.argv[1] && new URL(import.meta.url).pathname === resolve(process.argv[1])) {
  verifyProductionAuth({ requireEnrolled: process.env.REQUIRE_ENROLLED === 'true' })
    .then(report => { console.log('AUTH_PRODUCTION_BOUNDARY_REPORT', JSON.stringify(report)); })
    .catch(error => { console.error('AUTH_PRODUCTION_BOUNDARY_FAILED', error.message); process.exitCode = 1; });
}
