import { describe, expect, it } from 'vitest';
import {
  advanceInvocationBudget, checkInvocationBudget, validateInvocationAgainstDescriptor, validateCapabilityDescriptor,
  validateOAuthClientRegistration, validateOAuthRedirectUri, validateScopedInvocation,
} from '../src/auth/index.js';

const oauth = {
  schemaVersion: 1, appId: 'app-canonical-1', clientId: 'public-client-1',
  platform: 'web', publicClient: true, pkceMethod: 'S256',
  redirectUris: ['https://app.example.com/oauth/callback'],
};

const base = {
  schemaVersion: 1, appId: 'app-canonical-1', operationId: 'workflow.execute',
  revision: 'v3', displayName: 'Execute workflow',
  requiredScopes: ['workflow:execute'],
  inputParameters: [{ name: 'message', kind: 'string', required: true }],
  outputParameters: [{ name: 'result', kind: 'object', required: true }],
};

const invocation = {
  schemaVersion: 1, callerAppId: 'app-A', targetAppId: 'app-B',
  audienceAppId: 'app-B', principalUserId: 'user-1',
  callerWorkspaceId: 'ws-1', targetWorkspaceId: 'ws-2',
  operationId: 'workflow.execute', expectedRevision: 'v3', operationKind: 'workflow',
  grantId: 'grant-1', traceId: 'trace-1', activeAppChain: ['app-A'],
  deadlineAtMs: 2000, maxDepth: 4, remainingCalls: 8, remainingRetries: 2,
};

describe('portable ULTRST identity and capability contracts', () => {
  it('accepts only explicit public S256 clients with exact registered HTTPS callbacks', () => {
    expect(validateOAuthClientRegistration(oauth).ok).toBe(true);
    expect(validateOAuthClientRegistration({ ...oauth, pkceMethod: 'plain' }).ok).toBe(false);
    expect(validateOAuthClientRegistration({ ...oauth, clientSecret: 'do-not-publish' }).ok).toBe(false);
    expect(validateOAuthClientRegistration({ ...oauth, redirectUris: ['http://app.example.com/cb'] }).ok).toBe(false);
    expect(validateOAuthClientRegistration({ ...oauth, redirectUris: ['https://*.example.com/cb'] }).ok).toBe(false);
    expect(validateOAuthClientRegistration({ ...oauth, redirectUris: ['https://app.example.com/cb#token'] }).ok).toBe(false);
    expect(validateOAuthClientRegistration({ ...oauth, redirectUris: [oauth.redirectUris[0], oauth.redirectUris[0]] }).ok).toBe(false);
  });

  it('requires mobile verified-domain assertions and desktop ephemeral loopback callback', () => {
    const mobile = { ...oauth, platform: 'android', redirectUris: ['https://mobile.example.com/oauth/cb'] };
    expect(validateOAuthClientRegistration(mobile).ok).toBe(false);
    expect(validateOAuthClientRegistration({ ...mobile, verifiedHosts: ['mobile.example.com'] }).ok).toBe(true);
    expect(validateOAuthClientRegistration({ ...mobile, platform: 'ios', verifiedHosts: ['mobile.example.com'] }).ok).toBe(true);
    expect(validateOAuthClientRegistration({ ...mobile, platform: 'ios', verifiedHosts: ['mobile.example.com'], redirectUris: ['https://mobile.example.com/other#bad'] }).ok).toBe(false);
    expect(validateOAuthClientRegistration({ ...oauth, platform: 'desktop', redirectUris: ['http://127.0.0.1:51675/callback'] }).ok).toBe(true);
    expect(validateOAuthClientRegistration({ ...mobile, verifiedHosts: ['another.example.com'] }).ok).toBe(false);
    expect(validateOAuthRedirectUri('http://127.0.0.1:51675/callback', 'desktop').ok).toBe(true);
    expect(validateOAuthRedirectUri('http://[::1]:51675/callback', 'desktop').ok).toBe(true);
    expect(validateOAuthRedirectUri('http://0.0.0.0:51675/callback', 'desktop').ok).toBe(false);
    expect(validateOAuthRedirectUri('http://localhost:51675/callback', 'desktop').ok).toBe(false);
    expect(validateOAuthRedirectUri('http://127.0.0.1/callback', 'desktop').ok).toBe(false);
  });

  it('never accepts secret material, raw graphs, or private workflow descriptors', () => {
    const workflow = {
      ...base, kind: 'workflow', workflowId: 'w-1', ownerUserId: 'u-1',
      sourceWorkspaceId: 'ws-1', published: true,
    };
    expect(validateCapabilityDescriptor(workflow).ok).toBe(true);
    expect(validateCapabilityDescriptor({ ...workflow, published: false }).ok).toBe(false);
    expect(validateCapabilityDescriptor({ ...workflow, definition: { nodes: [] } }).ok).toBe(false);
    expect(validateCapabilityDescriptor({ ...workflow, apiKey: 'secret' }).ok).toBe(false);
    expect(validateCapabilityDescriptor({ ...workflow, inputParameters: [{ name: 'key', kind: 'string', required: true, default: 'secret' }] }).ok).toBe(false);
    expect(validateCapabilityDescriptor({ ...base, kind: 'backend', deploymentId: 'deploy-1' }).ok).toBe(true);
    expect(validateCapabilityDescriptor({ ...base, kind: 'frontend', deploymentId: 'deploy-1', sessionPermission: 'inspect' }).ok).toBe(true);
    expect(validateCapabilityDescriptor({ ...base, kind: 'frontend', deploymentId: 'deploy-1' }).ok).toBe(false);
    expect(validateScopedInvocation({ ...invocation, operationKind: 'frontend' }).ok).toBe(false);
    expect(validateScopedInvocation({ ...invocation, operationKind: 'frontend', frontendSessionId: 'live-1', frontendPermission: 'act' }).ok).toBe(false);
    expect(validateScopedInvocation({ ...invocation, operationKind: 'frontend', frontendSessionId: 'live-1', frontendPermission: 'act', frontendConsentId: 'consent-1' }).ok).toBe(true);
  });

  it('requires target audience and bounds cycles, depth, deadlines and total work', () => {
    expect(validateScopedInvocation(invocation).ok).toBe(true);
    expect(validateScopedInvocation({ ...invocation, audienceAppId: 'app-C' }).ok).toBe(false);
    expect(validateScopedInvocation({ ...invocation, principalUserId: '' }).ok).toBe(false);
    expect(validateScopedInvocation({ ...invocation, activeAppChain: ['app-C'] }).ok).toBe(false);
    expect(checkInvocationBudget(invocation, 1000).ok).toBe(true);
    expect(checkInvocationBudget(invocation, 2000)).toEqual({ ok: false, reason: 'INVOCATION_DEADLINE_EXCEEDED' });
    expect(checkInvocationBudget({ ...invocation, targetAppId: 'app-A', audienceAppId: 'app-A' }, 1000)).toEqual({ ok: false, reason: 'INVOCATION_CYCLE' });
    expect(checkInvocationBudget({ ...invocation, maxDepth: 1 }, 1000)).toEqual({ ok: false, reason: 'INVOCATION_MAX_DEPTH' });
    expect(checkInvocationBudget({ ...invocation, remainingCalls: 0 }, 1000)).toEqual({ ok: false, reason: 'INVOCATION_WORK_BUDGET_EXHAUSTED' });
    const first = advanceInvocationBudget(invocation, 1000);
    expect(first.ok).toBe(true);
    if (first.ok) {
      const second = advanceInvocationBudget({
        ...invocation, callerAppId: 'app-B', targetAppId: 'app-C', audienceAppId: 'app-C',
        activeAppChain: first.value.activeAppChain, remainingCalls: first.value.remainingCalls,
      }, 1100);
      expect(second.ok).toBe(true);
      if (second.ok) expect(second.value.activeAppChain).toEqual(['app-A', 'app-B', 'app-C']);
      expect(advanceInvocationBudget({
        ...invocation, callerAppId: 'app-B', targetAppId: 'app-A', audienceAppId: 'app-A',
        activeAppChain: first.value.activeAppChain, remainingCalls: first.value.remainingCalls,
      }, 1100)).toEqual({ ok: false, reason: 'INVOCATION_CYCLE' });
    }
    const targetWorkflow = { ...base, appId: 'app-B', kind: 'workflow', workflowId: 'wf-1', ownerUserId: 'u-1', sourceWorkspaceId: 'ws-2', published: true };
    expect(validateInvocationAgainstDescriptor(invocation, targetWorkflow, 1000).ok).toBe(true);
    expect(validateInvocationAgainstDescriptor(invocation, { ...targetWorkflow, revision: 'v4' }, 1000)).toEqual({ ok: false, reason: 'TARGET_CAPABILITY_REVISION_OR_KIND_MISMATCH' });
    expect(validateInvocationAgainstDescriptor(invocation, { ...targetWorkflow, sourceWorkspaceId: 'foreign-ws' }, 1000)).toEqual({ ok: false, reason: 'WORKFLOW_WORKSPACE_MISMATCH' });
    expect(advanceInvocationBudget(invocation, 1000)).toEqual({
      ok: true, value: {
        activeAppChain: ['app-A', 'app-B'], remainingCalls: 7,
        remainingRetries: 2, deadlineAtMs: 2000,
      },
    });
  });
});
