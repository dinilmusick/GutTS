import { describe, expect, it } from 'vitest';
import {
  crossAppTierOrder, evaluateInvocationFailover, orderRankedCloudDeployments,
  validateAuthenticatedEndpoint, validateInvocationAttempt, validateNativePeerBeacon,
  validateRankedCloudDeployment, validateRetryFingerprint, validateRoutedInvocation,
} from '../src/auth/index.js';

const now = 2_000_000;
const beacon = {
  schemaVersion: 1, appId: 'app-brwlr', deploymentId: 'desktop-1',
  endpointUrl: 'https://192.168.1.21:4200/invoke',
  transport: 'authenticated_https', nonce: 'beacon-01',
  issuedAtMs: now - 1000, expiresAtMs: now + 60_000,
};
const cloud = {
  schemaVersion: 1, appId: 'app-aiko', deploymentId: 'worker-one',
  operationId: 'workflow.execute', endpointUrl: 'https://aiko.example.com/api/invoke',
  weight: 55, scoredAtMs: now - 100_000, lastSeenAtMs: now - 1000,
  eligible: true,
};
const invocation = {
  schemaVersion: 1, callerAppId: 'app-brwlr', targetAppId: 'app-aiko',
  audienceAppId: 'app-aiko', principalUserId: 'user-A',
  callerWorkspaceId: 'workspace-A', targetWorkspaceId: 'workspace-B',
  operationId: 'workflow.execute', expectedRevision: 'revision-1',
  operationKind: 'workflow', grantId: 'grant-A', traceId: 'trace-A',
  activeAppChain: ['app-brwlr'], deadlineAtMs: now + 60_000,
  maxDepth: 8, remainingCalls: 10, remainingRetries: 2,
};
const routed = {
  schemaVersion: 1, invocation, executionId: 'execution-1',
  effect: 'write', idempotencyKey: 'idem-1', payloadSha256: 'a'.repeat(64),
};
const timeout = { schemaVersion: 1, resultClass: 'timeout', delivery: 'uncertain' };
const unavailability = { schemaVersion: 1, resultClass: 'unavailable', delivery: 'not_sent' };

describe('portable cross-app discovery and route contracts', () => {
  it('keeps the Hubrys/native/cloud escalation order explicit', () => {
    expect(crossAppTierOrder('composed')).toEqual(['in_process', 'native_peer', 'cloud']);
    expect(crossAppTierOrder('desktop')).toEqual(['native_peer', 'cloud']);
    expect(crossAppTierOrder('cloud_only')).toEqual(['cloud']);
  });

  it('rejects spoofed identity, insecure LAN payloads and credentials in UDP hints', () => {
    expect(validateNativePeerBeacon(beacon, now).ok).toBe(true);
    for (const appId of ['https://app.example', 'app/name', 'app?x=1', 'app#hash']) {
      expect(validateNativePeerBeacon({ ...beacon, appId }, now).ok).toBe(false);
    }
    expect(validateNativePeerBeacon({ ...beacon, endpointUrl: 'http://192.168.1.21:4200/invoke' }, now).ok).toBe(false);
    expect(validateNativePeerBeacon({ ...beacon, bearerToken: 'secret' }, now).ok).toBe(false);
    expect(validateNativePeerBeacon({ ...beacon, transport: 'plaintext_udp' }, now).ok).toBe(false);
    expect(validateNativePeerBeacon({ ...beacon, expiresAtMs: now }, now).ok).toBe(false);
    expect(validateNativePeerBeacon({ ...beacon, expiresAtMs: now + 500_000 }, now).ok).toBe(false);
    expect(validateNativePeerBeacon({ ...beacon, issuedAtMs: now + 6000 }, now).ok).toBe(false);
    expect(validateAuthenticatedEndpoint('https://user:pass@example.org/invoke').ok).toBe(false);
    expect(validateAuthenticatedEndpoint('https://example.org/invoke?token=x').ok).toBe(false);
    expect(validateAuthenticatedEndpoint('https://example.org/invoke#private').ok).toBe(false);
    expect(validateAuthenticatedEndpoint('https://example.org/invoke').ok).toBe(true);
    expect(validateAuthenticatedEndpoint('https://localhost:8443/invoke').ok).toBe(true);
    expect(validateAuthenticatedEndpoint('https://node.local:8443/invoke').ok).toBe(true);
    expect(validateNativePeerBeacon({ ...beacon, nonce: 'https://bad.example' }, now).ok).toBe(false);
  });

  it('orders only authenticated-registry-supplied precomputed scores, not recomputed weights', () => {
    const slower = { ...cloud, deploymentId: 'worker-two', weight: 11 };
    const faster = { ...cloud, deploymentId: 'worker-three', weight: 90 };
    const result = orderRankedCloudDeployments([slower, cloud, faster], 'app-aiko', 'workflow.execute', now);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.map((x) => x.deploymentId))
      .toEqual(['worker-three', 'worker-one', 'worker-two']);
    expect(orderRankedCloudDeployments([cloud, cloud], 'app-aiko', 'workflow.execute', now).ok).toBe(false);
    expect(validateRankedCloudDeployment(cloud, 'app-srkl', 'workflow.execute', now).ok).toBe(false);
    expect(validateRankedCloudDeployment(cloud, 'app-aiko', 'other-operation', now).ok).toBe(false);
    expect(validateRankedCloudDeployment({ ...cloud, endpointUrl: 'http://aiko.example.com' }, 'app-aiko', 'workflow.execute', now).ok).toBe(false);
    expect(validateRankedCloudDeployment({ ...cloud, lastSeenAtMs: now + 20_000 }, 'app-aiko', 'workflow.execute', now).ok).toBe(false);
    expect(validateRankedCloudDeployment({ ...cloud, scoredAtMs: now - 3 * 60 * 60 * 1000 - 1 }, 'app-aiko', 'workflow.execute', now).ok).toBe(false);
    expect(validateRankedCloudDeployment({ ...cloud, clientSecret: 'no' }, 'app-aiko', 'workflow.execute', now).ok).toBe(false);
  });
});

describe('routed invocation authorization boundary and retry safety', () => {
  it('reuses canonical invocation budget and rejects identity/operation injection', () => {
    expect(validateRoutedInvocation(routed, now).ok).toBe(true);
    expect(validateRoutedInvocation({ ...routed, invocation: { ...invocation, audienceAppId: 'app-srkl' } }, now).ok).toBe(false);
    expect(validateRoutedInvocation({ ...routed, invocation: { ...invocation, callerAppId: 'https://spoofed.example' } }, now).ok).toBe(false);
    expect(validateRoutedInvocation({ ...routed, invocation: { ...invocation, deadlineAtMs: now - 1 } }, now).ok).toBe(false);
    expect(validateRoutedInvocation({ ...routed, invocation: { ...invocation, targetAppId: 'app-brwlr', audienceAppId: 'app-brwlr' } }, now).ok).toBe(false);
    expect(validateRoutedInvocation({ ...routed, effect: 'write', idempotencyKey: undefined }, now).ok).toBe(false);
    expect(validateRoutedInvocation({ ...routed, payloadSha256: 'not-a-digest' }, now).ok).toBe(false);
    expect(validateRoutedInvocation({ ...routed, apiKey: 'no' }, now).ok).toBe(false);
  });

  it('prevents replay of one idempotency key across a different principal, target, payload or grant', () => {
    expect(validateRetryFingerprint(routed, routed, now).ok).toBe(true);
    for (const changed of [
      { ...routed, payloadSha256: 'b'.repeat(64) },
      { ...routed, invocation: { ...invocation, principalUserId: 'user-B' } },
      { ...routed, invocation: { ...invocation, targetWorkspaceId: 'workspace-C' } },
      { ...routed, invocation: { ...invocation, grantId: 'grant-B' } },
      { ...routed, executionId: 'execution-2' },
      { ...routed, invocation: { ...invocation, activeAppChain: ['other-app', 'app-brwlr'] } },
    ]) {
      expect(validateRetryFingerprint(routed, changed, now).ok).toBe(false);
    }
  });

  it('blocks authorization downgrades, blind timeout retries and exhausted budgets', () => {
    const denied = { schemaVersion: 1, resultClass: 'unauthorized', delivery: 'acknowledged', httpStatus: 401 };
    const forbidden = { schemaVersion: 1, resultClass: 'forbidden', delivery: 'acknowledged', httpStatus: 403 };
    expect(evaluateInvocationFailover(routed, denied, now).mayTryNext).toBe(false);
    expect(evaluateInvocationFailover(routed, forbidden, now, 'shared_atomic').mayTryNext).toBe(false);
    expect(validateInvocationAttempt({ ...unavailability, httpStatus: 401 }).ok).toBe(false);
    expect(validateInvocationAttempt({ ...timeout, delivery: 'not_sent' }).ok).toBe(false);
    expect(validateInvocationAttempt({ ...unavailability, httpStatus: 503 }).ok).toBe(false);
    expect(validateInvocationAttempt({ ...unavailability, delivery: 'uncertain', httpStatus: 200 }).ok).toBe(false);
    expect(validateInvocationAttempt({ ...timeout, httpStatus: 200 }).ok).toBe(false);
    expect(evaluateInvocationFailover(routed, unavailability, now).mayTryNext).toBe(true);
    expect(evaluateInvocationFailover(routed, timeout, now)).toEqual({
      mayTryNext: false, reason: 'POSSIBLE_DUPLICATE_SIDE_EFFECT',
    });
    expect(evaluateInvocationFailover(routed, timeout, now, 'shared_atomic').mayTryNext).toBe(true);
    expect(evaluateInvocationFailover({ ...routed, effect: 'read', idempotencyKey: undefined }, timeout, now).mayTryNext).toBe(true);
    expect(evaluateInvocationFailover({ ...routed, invocation: { ...invocation, remainingRetries: 0 } }, timeout, now, 'shared_atomic').mayTryNext).toBe(false);
    expect(evaluateInvocationFailover(routed, timeout, now + 61_000, 'shared_atomic').mayTryNext).toBe(false);
    expect(evaluateInvocationFailover(routed, { schemaVersion: 1, resultClass: 'application_error', delivery: 'acknowledged', httpStatus: 500 }, now).mayTryNext).toBe(false);
  });
});
