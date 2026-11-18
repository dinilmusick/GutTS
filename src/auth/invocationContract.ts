import { type CapabilityDescriptorV1, validateCapabilityDescriptor } from './capabilityContract.js';
import {
  contractExactKeys, contractId, contractRecord, type ContractCheck,
  ULTRST_APP_CONTRACT_VERSION,
} from './oauthClientContract.js';

/**
 * An invocation envelope is untrusted transport data, not authorization.
 * The TARGET must independently authenticate the Luth principal, verify the
 * grant, workspace membership, audience, operation revision, and output policy
 * on EVERY hop (HTTP, MCP, graph, and agent). Never trust client-provided IDs.
 */
export interface ScopedInvocationV1 {
  schemaVersion: typeof ULTRST_APP_CONTRACT_VERSION;
  callerAppId: string;
  targetAppId: string;
  audienceAppId: string;
  principalUserId: string;
  callerWorkspaceId: string;
  targetWorkspaceId: string;
  operationId: string;
  expectedRevision: string;
  operationKind: 'backend' | 'frontend' | 'workflow';
  /** Required for frontend, obtained from live window broker; not proof of consent. */
  frontendSessionId?: string;
  frontendPermission?: 'inspect' | 'act';
  frontendConsentId?: string;
  grantId: string;
  traceId: string;
  /** Trusted server-to-server ancestry, INCLUDING the caller app. */
  activeAppChain: readonly string[];
  deadlineAtMs: number;
  maxDepth: number;
  remainingCalls: number;
  remainingRetries: number;
}

const invocationKeys = [
  'schemaVersion', 'callerAppId', 'targetAppId', 'audienceAppId', 'principalUserId',
  'callerWorkspaceId', 'targetWorkspaceId', 'operationId', 'expectedRevision',
  'operationKind', 'frontendSessionId', 'frontendPermission', 'frontendConsentId',
  'grantId', 'traceId', 'activeAppChain', 'deadlineAtMs', 'maxDepth',
  'remainingCalls', 'remainingRetries',
] as const;

export function validateScopedInvocation(input: unknown): ContractCheck<ScopedInvocationV1> {
  const o = contractRecord(input);
  if (!o || !contractExactKeys(o, invocationKeys) || o.schemaVersion !== 1
    || !contractId(o.callerAppId) || !contractId(o.targetAppId)
    || !contractId(o.audienceAppId) || !contractId(o.principalUserId)
    || !contractId(o.callerWorkspaceId) || !contractId(o.targetWorkspaceId)
    || !contractId(o.operationId) || !contractId(o.expectedRevision)
    || !contractId(o.grantId) || !contractId(o.traceId)
    || !['backend', 'frontend', 'workflow'].includes(String(o.operationKind))
    || o.audienceAppId !== o.targetAppId) {
    return { ok: false, reason: 'INVALID_INVOCATION_IDENTITY_OR_AUDIENCE' };
  }
  if (o.operationKind === 'frontend') {
    if (!contractId(o.frontendSessionId) || !contractId(o.frontendConsentId)
      || !['inspect', 'act'].includes(String(o.frontendPermission))) {
      return { ok: false, reason: 'FRONTEND_REQUIRES_LIVE_SESSION_AND_CONSENT' };
    }
  } else if (o.frontendSessionId !== undefined || o.frontendPermission !== undefined
    || o.frontendConsentId !== undefined) {
    return { ok: false, reason: 'NON_FRONTEND_SESSION_NOT_ALLOWED' };
  }
  if (!Array.isArray(o.activeAppChain) || !o.activeAppChain.every(contractId)
    || o.activeAppChain.length === 0 || o.activeAppChain.length > 16
    || o.activeAppChain[o.activeAppChain.length - 1] !== o.callerAppId) {
    return { ok: false, reason: 'INVALID_CALL_ANCESTRY' };
  }
  if (typeof o.deadlineAtMs !== 'number' || !Number.isSafeInteger(o.deadlineAtMs)
    || typeof o.maxDepth !== 'number' || !Number.isSafeInteger(o.maxDepth)
    || o.maxDepth < 1 || o.maxDepth > 16
    || typeof o.remainingCalls !== 'number' || !Number.isSafeInteger(o.remainingCalls)
    || o.remainingCalls < 0 || o.remainingCalls > 1000
    || typeof o.remainingRetries !== 'number' || !Number.isSafeInteger(o.remainingRetries)
    || o.remainingRetries < 0 || o.remainingRetries > 20) {
    return { ok: false, reason: 'INVALID_EXECUTION_BUDGET' };
  }
  return { ok: true, value: input as ScopedInvocationV1 };
}

/**
 * Pure admission guard. The caller must FIRST validate the signed, trusted
 * ancestry and independently reauthorize the target-side grant. This function
 * cannot authenticate a user or prove any server-side attestation.
 */
export function checkInvocationBudget(input: unknown, nowMs: number): ContractCheck<ScopedInvocationV1> {
  const checked = validateScopedInvocation(input);
  if (!checked.ok) return checked;
  const call = checked.value;
  if (!Number.isFinite(nowMs) || nowMs >= call.deadlineAtMs) {
    return { ok: false, reason: 'INVOCATION_DEADLINE_EXCEEDED' };
  }
  if (call.activeAppChain.length >= call.maxDepth) {
    return { ok: false, reason: 'INVOCATION_MAX_DEPTH' };
  }
  if (call.activeAppChain.includes(call.targetAppId)) {
    return { ok: false, reason: 'INVOCATION_CYCLE' };
  }
  if (call.remainingCalls === 0) {
    return { ok: false, reason: 'INVOCATION_WORK_BUDGET_EXHAUSTED' };
  }
  return checked;
}

/** A successful hop consumes one call and carries bounded ancestry forward. */
export function advanceInvocationBudget(
  input: unknown, nowMs: number,
): ContractCheck<Pick<ScopedInvocationV1, 'activeAppChain' | 'remainingCalls' | 'remainingRetries' | 'deadlineAtMs'>> {
  const check = checkInvocationBudget(input, nowMs);
  if (!check.ok) return check;
  const value = check.value;
  return {
    ok: true,
    value: {
      activeAppChain: [...value.activeAppChain, value.targetAppId],
      remainingCalls: value.remainingCalls - 1,
      remainingRetries: value.remainingRetries,
      deadlineAtMs: value.deadlineAtMs,
    },
  };
}

/**
 * Confirms the selected capability's target, revision and kind have not
 * changed before dispatch. The target must STILL independently reauthorize
 * user/workspace/grant and (for frontend) live-window/session/consent.
 */
export function validateInvocationAgainstDescriptor(
  invocationInput: unknown,
  descriptorInput: unknown,
  nowMs: number,
): ContractCheck<{ invocation: ScopedInvocationV1; descriptor: CapabilityDescriptorV1 }> {
  const invocation = checkInvocationBudget(invocationInput, nowMs);
  if (!invocation.ok) return invocation;
  const descriptor = validateCapabilityDescriptor(descriptorInput);
  if (!descriptor.ok) return descriptor;
  if (descriptor.value.appId !== invocation.value.targetAppId
    || descriptor.value.operationId !== invocation.value.operationId
    || descriptor.value.revision !== invocation.value.expectedRevision
    || descriptor.value.kind !== invocation.value.operationKind) {
    return { ok: false, reason: 'TARGET_CAPABILITY_REVISION_OR_KIND_MISMATCH' };
  }
  if (descriptor.value.kind === 'workflow'
    && descriptor.value.sourceWorkspaceId !== invocation.value.targetWorkspaceId) {
    return { ok: false, reason: 'WORKFLOW_WORKSPACE_MISMATCH' };
  }
  if (descriptor.value.kind === 'frontend'
    && descriptor.value.sessionPermission !== invocation.value.frontendPermission) {
    return { ok: false, reason: 'FRONTEND_PERMISSION_MISMATCH' };
  }
  return { ok: true, value: { invocation: invocation.value, descriptor: descriptor.value } };
}
