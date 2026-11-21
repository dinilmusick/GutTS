import {
  contractExactKeys, contractId, contractRecord, type ContractCheck,
} from './oauthClientContract.js';
import {
  checkInvocationBudget, type ScopedInvocationV1,
} from './invocationContract.js';

/** Same canonical identity and operation across every route tier. */
export interface RoutedInvocationV1 {
  schemaVersion: 1;
  invocation: ScopedInvocationV1;
  executionId: string;
  effect: 'read' | 'write';
  /** Stable across retries and ALL deployments. Never use a new key on timeout. */
  idempotencyKey?: string;
  /** Digest of canonical operation input; never includes credentials. */
  payloadSha256: string;
}

export type InvocationDeliveryV1 = 'not_sent' | 'uncertain' | 'acknowledged';
export type InvocationResultClassV1 =
  | 'success' | 'unauthorized' | 'forbidden' | 'invalid_target'
  | 'unavailable' | 'timeout' | 'application_error';

export interface InvocationAttemptResultV1 {
  schemaVersion: 1;
  resultClass: InvocationResultClassV1;
  delivery: InvocationDeliveryV1;
  httpStatus?: number;
}

/** This attestation must come from trusted execution infrastructure, never a caller flag. */
export type DurableDeduplicationAttestationV1 = 'none' | 'shared_atomic';
/** Only the trusted execution host can determine the authoritative operation effect. */
export interface TrustedInvocationRetryPolicyV1 {
  authoritativeEffect: 'read' | 'write';
  durableDeduplication: DurableDeduplicationAttestationV1;
}
export interface FailoverDecisionV1 {
  mayTryNext: boolean;
  reason: string;
}

const ROUTED_KEYS = [
  'schemaVersion', 'invocation', 'executionId', 'effect', 'idempotencyKey', 'payloadSha256',
] as const;
const OUTCOME_KEYS = ['schemaVersion', 'resultClass', 'delivery', 'httpStatus'] as const;

export function validateRoutedInvocation(input: unknown, nowMs: number): ContractCheck<RoutedInvocationV1> {
  const value = contractRecord(input);
  if (!value || !contractExactKeys(value, ROUTED_KEYS) || value.schemaVersion !== 1
    || !contractId(value.executionId) || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(String(value.executionId))
    || !['read', 'write'].includes(String(value.effect))
    || typeof value.payloadSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.payloadSha256)
    || (value.idempotencyKey !== undefined && (
      !contractId(value.idempotencyKey)
      || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(String(value.idempotencyKey))
    ))
    || (value.effect === 'write' && value.idempotencyKey === undefined)) {
    return { ok: false, reason: 'INVALID_ROUTED_INVOCATION' };
  }
  const invocation = checkInvocationBudget(value.invocation, nowMs);
  if (!invocation.ok) return invocation;
  return { ok: true, value: input as RoutedInvocationV1 };
}

/**
 * A durable dedup store must atomically enforce this fingerprint AND persist results.
 * This pure check is not a substitute for a storage uniqueness constraint.
 */
export function validateRetryFingerprint(
  previousInput: unknown, nextInput: unknown, nowMs: number,
): ContractCheck<RoutedInvocationV1> {
  const previous = validateRoutedInvocation(previousInput, nowMs);
  if (!previous.ok) return previous;
  const next = validateRoutedInvocation(nextInput, nowMs);
  if (!next.ok) return next;
  const a = previous.value;
  const b = next.value;
  const x = a.invocation;
  const y = b.invocation;
  if (a.executionId !== b.executionId || a.idempotencyKey !== b.idempotencyKey
    || a.payloadSha256 !== b.payloadSha256 || a.effect !== b.effect
    || x.callerAppId !== y.callerAppId || x.targetAppId !== y.targetAppId
    || x.audienceAppId !== y.audienceAppId || x.principalUserId !== y.principalUserId
    || x.callerWorkspaceId !== y.callerWorkspaceId || x.targetWorkspaceId !== y.targetWorkspaceId
    || x.operationId !== y.operationId || x.expectedRevision !== y.expectedRevision
    || x.operationKind !== y.operationKind || x.grantId !== y.grantId
    || x.traceId !== y.traceId
    || x.frontendSessionId !== y.frontendSessionId
    || x.frontendPermission !== y.frontendPermission
    || x.frontendConsentId !== y.frontendConsentId
    || x.maxDepth !== y.maxDepth || x.remainingCalls !== y.remainingCalls
    || x.activeAppChain.length !== y.activeAppChain.length
    || x.activeAppChain.some((appId, index) => appId !== y.activeAppChain[index])
    || x.deadlineAtMs !== y.deadlineAtMs) {
    return { ok: false, reason: 'REPLAY_FINGERPRINT_MISMATCH' };
  }
  return next;
}

/** Validate explicit delivery classifications, never map 401/403 to an availability failure. */
export function validateInvocationAttempt(input: unknown): ContractCheck<InvocationAttemptResultV1> {
  const value = contractRecord(input);
  if (!value || !contractExactKeys(value, OUTCOME_KEYS) || value.schemaVersion !== 1
    || !['success', 'unauthorized', 'forbidden', 'invalid_target',
      'unavailable', 'timeout', 'application_error'].includes(String(value.resultClass))
    || !['not_sent', 'uncertain', 'acknowledged'].includes(String(value.delivery))
    || (value.httpStatus !== undefined
      && (!Number.isInteger(value.httpStatus) || Number(value.httpStatus) < 100
        || Number(value.httpStatus) > 599))) {
    return { ok: false, reason: 'INVALID_INVOCATION_ATTEMPT' };
  }
  if ((value.httpStatus === 401 && value.resultClass !== 'unauthorized')
    || (value.httpStatus === 403 && value.resultClass !== 'forbidden')
    || (value.resultClass === 'unauthorized' && value.httpStatus !== 401)
    || (value.resultClass === 'forbidden' && value.httpStatus !== 403)
    || (value.resultClass === 'success'
      && (value.delivery !== 'acknowledged'
        || typeof value.httpStatus !== 'number' || value.httpStatus < 200 || value.httpStatus >= 300))
    || (value.resultClass === 'timeout' && (value.delivery !== 'uncertain'
      || (value.httpStatus !== undefined && value.httpStatus !== 504)))
    || (value.resultClass === 'unavailable' && (value.delivery === 'acknowledged'
      || (value.httpStatus !== undefined && value.delivery === 'not_sent')
      || (value.httpStatus !== undefined && ![502, 503, 504].includes(Number(value.httpStatus)))))
    || (['unauthorized', 'forbidden'].includes(String(value.resultClass))
      && value.delivery !== 'acknowledged')
    || (value.resultClass === 'application_error' && (value.delivery !== 'acknowledged'
      || (typeof value.httpStatus === 'number' && value.httpStatus < 400)))
    || (value.resultClass === 'invalid_target' && value.delivery === 'not_sent' && value.httpStatus !== undefined)) {
    return { ok: false, reason: 'CONTRADICTORY_INVOCATION_ATTEMPT' };
  }
  return { ok: true, value: input as InvocationAttemptResultV1 };
}

/**
 * Security policy, not a request executor. The host MUST independently authenticate
 * Luth, grant, workspace and operation at every target. On uncertain delivery,
 * writes may retry ONLY if an authoritative shared atomic dedup store guarantees
 * identical executionId/idempotencyKey/payload/result across deployments.
 * Both the operation effect and delivery classification must originate from trusted
 * target registry/transport infrastructure, NEVER from the caller payload.
 */
export function evaluateInvocationFailover(
  routedInput: unknown, attemptInput: unknown, nowMs: number,
  trustedPolicy?: TrustedInvocationRetryPolicyV1,
): FailoverDecisionV1 {
  const routed = validateRoutedInvocation(routedInput, nowMs);
  if (!routed.ok) return { mayTryNext: false, reason: routed.reason };
  const attempt = validateInvocationAttempt(attemptInput);
  if (!attempt.ok) return { mayTryNext: false, reason: attempt.reason };
  if (!trustedPolicy || !['read', 'write'].includes(trustedPolicy.authoritativeEffect)
    || !['none', 'shared_atomic'].includes(trustedPolicy.durableDeduplication)) {
    return { mayTryNext: false, reason: 'UNVERIFIED_RETRY_POLICY' };
  }
  if (trustedPolicy.authoritativeEffect !== routed.value.effect) {
    return { mayTryNext: false, reason: 'OPERATION_EFFECT_MISMATCH' };
  }
  const call = routed.value.invocation;
  const result = attempt.value;
  if (result.resultClass === 'unauthorized' || result.resultClass === 'forbidden'
    || result.httpStatus === 401 || result.httpStatus === 403) {
    return { mayTryNext: false, reason: 'AUTHORIZATION_DENIED' };
  }
  if (['success', 'invalid_target', 'application_error'].includes(result.resultClass)) {
    return { mayTryNext: false, reason: 'TERMINAL_RESULT' };
  }
  if (call.remainingRetries <= 0) {
    return { mayTryNext: false, reason: 'RETRY_BUDGET_EXHAUSTED' };
  }
  if (result.delivery === 'not_sent') return { mayTryNext: true, reason: 'NOT_DISPATCHED' };
  if (routed.value.effect === 'read') return { mayTryNext: true, reason: 'READ_RETRY' };
  if (trustedPolicy.durableDeduplication === 'shared_atomic' && routed.value.idempotencyKey) {
    return { mayTryNext: true, reason: 'SHARED_ATOMIC_DEDUPLICATION_REQUIRED' };
  }
  return { mayTryNext: false, reason: 'POSSIBLE_DUPLICATE_SIDE_EFFECT' };
}
