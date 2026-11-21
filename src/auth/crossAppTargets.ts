import {
  contractAppId, contractExactKeys, contractId, contractRecord,
  type ContractCheck,
} from './oauthClientContract.js';
import { parseIdentityId } from './identityIds.js';

/** Discovery metadata is untrusted. It does not authenticate a peer or registry. */
export const CROSS_APP_ROUTING_VERSION = 1 as const;
export type CrossAppTierV1 = 'in_process' | 'native_peer' | 'cloud';
export type CrossAppHostV1 = 'composed' | 'desktop' | 'cloud_only';

export interface NativePeerBeaconV1 {
  schemaVersion: typeof CROSS_APP_ROUTING_VERSION;
  appId: string;
  deploymentId: string;
  /** The beacon NEVER carries credentials. Actual calls require authenticated TLS. */
  endpointUrl: string;
  transport: 'authenticated_https';
  nonce: string;
  issuedAtMs: number;
  expiresAtMs: number;
}

export interface RankedCloudDeploymentV1 {
  schemaVersion: typeof CROSS_APP_ROUTING_VERSION;
  appId: string;
  deploymentId: string;
  operationId: string;
  /** Verified registry URL, not an application identity. */
  endpointUrl: string;
  /** Assigned by DEPM independently; consumers MUST NOT recalculate it. */
  weight: number;
  scoredAtMs: number;
  lastSeenAtMs: number;
  eligible: true;
}

const BEACON_KEYS = [
  'schemaVersion', 'appId', 'deploymentId', 'endpointUrl',
  'transport', 'nonce', 'issuedAtMs', 'expiresAtMs',
] as const;
const CLOUD_KEYS = [
  'schemaVersion', 'appId', 'deploymentId', 'operationId',
  'endpointUrl', 'weight', 'scoredAtMs', 'lastSeenAtMs', 'eligible',
] as const;

function time(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/** Reject URL credentials, fragments, query injections, insecure LAN endpoints and ambiguous hostnames. */
export function validateAuthenticatedEndpoint(input: unknown): ContractCheck<string> {
  if (typeof input !== 'string' || input.length > 2048 || input.trim() !== input) {
    return { ok: false, reason: 'INVALID_ENDPOINT_URL' };
  }
  try {
    const url = new URL(input);
    const canonical = url.href === input
      || (url.pathname === '/' && url.href === input + '/');
    if (!canonical || url.protocol !== 'https:' || !url.hostname
      || url.username || url.password || url.hash || url.search
      || url.hostname.includes('%')
      || url.pathname.includes('//')) {
      return { ok: false, reason: 'INSECURE_OR_AMBIGUOUS_ENDPOINT' };
    }
  } catch {
    return { ok: false, reason: 'INVALID_ENDPOINT_URL' };
  }
  return { ok: true, value: input };
}

/** UDP peer beacons are short-lived hints only; target identity MUST be verified during TLS/OAuth invocation. */
export function validateNativePeerBeacon(input: unknown, nowMs: number): ContractCheck<NativePeerBeaconV1> {
  const value = contractRecord(input);
  if (!value || !contractExactKeys(value, BEACON_KEYS)
    || value.schemaVersion !== 1 || !contractAppId(value.appId)
    || parseIdentityId('deployment', value.deploymentId) === null
    || value.transport !== 'authenticated_https'
    || !contractId(value.nonce) || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(String(value.nonce))
    || !time(nowMs)
    || !time(value.issuedAtMs) || !time(value.expiresAtMs)) {
    return { ok: false, reason: 'INVALID_PEER_BEACON' };
  }
  const endpoint = validateAuthenticatedEndpoint(value.endpointUrl);
  if (!endpoint.ok) return endpoint;
  if (value.issuedAtMs > nowMs + 5000 || value.expiresAtMs <= nowMs
    || value.expiresAtMs <= value.issuedAtMs
    || value.expiresAtMs - value.issuedAtMs > 120000) {
    return { ok: false, reason: 'EXPIRED_OR_UNBOUNDED_PEER_BEACON' };
  }
  return { ok: true, value: input as NativePeerBeaconV1 };
}

/** Confirm an untrusted beacon names the requested immutable application. */
export function validateNativePeerForTarget(
  input: unknown, expectedAppId: string, nowMs: number,
): ContractCheck<NativePeerBeaconV1> {
  const peer = validateNativePeerBeacon(input, nowMs);
  if (!peer.ok) return peer;
  if (!contractAppId(expectedAppId) || peer.value.appId !== expectedAppId) {
    return { ok: false, reason: 'PEER_APPLICATION_ID_MISMATCH' };
  }
  return peer;
}

/**
 * Source MUST be an authenticated, target-scoped registry response.
 * Validation is shape/freshness only, not proof of registry signature or caller grants.
 */
export function validateRankedCloudDeployment(
  input: unknown, targetAppId: string, operationId: string, nowMs: number,
  maxScoreAgeMs = 3 * 60 * 60 * 1000,
): ContractCheck<RankedCloudDeploymentV1> {
  const value = contractRecord(input);
  if (!contractAppId(targetAppId) || !contractId(operationId) || !time(nowMs)
    || !time(maxScoreAgeMs) || maxScoreAgeMs > 3 * 60 * 60 * 1000
    || !value || !contractExactKeys(value, CLOUD_KEYS)
    || value.schemaVersion !== 1 || value.appId !== targetAppId
    || value.operationId !== operationId
    || parseIdentityId('deployment', value.deploymentId) === null
    || value.eligible !== true
    || typeof value.weight !== 'number' || !Number.isFinite(value.weight)
    || value.weight < 0 || value.weight > 1000000
    || !time(value.scoredAtMs) || !time(value.lastSeenAtMs)) {
    return { ok: false, reason: 'INVALID_OR_UNAUTHORIZED_CLOUD_CANDIDATE' };
  }
  const endpoint = validateAuthenticatedEndpoint(value.endpointUrl);
  if (!endpoint.ok) return endpoint;
  if (value.scoredAtMs > nowMs || nowMs - value.scoredAtMs > maxScoreAgeMs
    || value.lastSeenAtMs > nowMs) {
    return { ok: false, reason: 'STALE_CLOUD_CANDIDATE' };
  }
  return { ok: true, value: input as RankedCloudDeploymentV1 };
}

/** Sort only trusted precomputed weights; duplicate IDs or malformed records fail closed. */
export function orderRankedCloudDeployments(
  candidates: readonly unknown[], targetAppId: string, operationId: string, nowMs: number,
): ContractCheck<RankedCloudDeploymentV1[]> {
  if (!Array.isArray(candidates) || candidates.length > 256) {
    return { ok: false, reason: 'INVALID_CLOUD_CANDIDATE_SET' };
  }
  const found: RankedCloudDeploymentV1[] = [];
  const ids = new Set<string>();
  for (const candidate of candidates) {
    const checked = validateRankedCloudDeployment(candidate, targetAppId, operationId, nowMs);
    if (!checked.ok) return checked;
    if (ids.has(checked.value.deploymentId)) {
      return { ok: false, reason: 'DUPLICATE_CLOUD_DEPLOYMENT' };
    }
    ids.add(checked.value.deploymentId);
    found.push(checked.value);
  }
  return { ok: true, value: found.sort((a, b) =>
    b.weight - a.weight || a.deploymentId.localeCompare(b.deploymentId)) };
}

/** Priority only: no authority changes when switching transports. */
export function crossAppTierOrder(host: CrossAppHostV1): readonly CrossAppTierV1[] {
  switch (host) {
    case 'composed': return ['in_process', 'native_peer', 'cloud'];
    case 'desktop': return ['native_peer', 'cloud'];
    case 'cloud_only': return ['cloud'];
    default: throw new TypeError('UNKNOWN_CROSS_APP_HOST');
  }
}
