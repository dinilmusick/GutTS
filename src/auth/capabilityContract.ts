import {
  contractExactKeys, contractId, contractRecord, type ContractCheck,
  ULTRST_APP_CONTRACT_VERSION,
} from './oauthClientContract.js';

/**
 * Safe, metadata-only descriptors. Discovery MUST be authenticated and
 * filtered by owner/workspace/grants at the target, never served as a global
 * directory of user workflows.
 */
export type CapabilityParameterKind = 'string' | 'number' | 'integer' | 'boolean' | 'object' | 'array';
export interface CapabilityParameterV1 {
  name: string;
  kind: CapabilityParameterKind;
  required: boolean;
}
export interface CapabilityBaseV1 {
  schemaVersion: typeof ULTRST_APP_CONTRACT_VERSION;
  appId: string;
  operationId: string;
  revision: string;
  displayName: string;
  requiredScopes: readonly string[];
  inputParameters: readonly CapabilityParameterV1[];
  outputParameters: readonly CapabilityParameterV1[];
}
export interface StaticCapabilityV1 extends CapabilityBaseV1 {
  kind: 'backend' | 'frontend';
  deploymentId: string;
  /** Only the active session holder can inspect/act. No session is published. */
  sessionPermission?: 'inspect' | 'act';
}
export interface WorkflowPublicationV1 extends CapabilityBaseV1 {
  kind: 'workflow';
  workflowId: string;
  ownerUserId: string;
  sourceWorkspaceId: string;
  /** Explicit opt-in is necessary but never sufficient to authorize access. */
  published: true;
}
export type CapabilityDescriptorV1 = StaticCapabilityV1 | WorkflowPublicationV1;

const baseKeys = [
  'schemaVersion', 'appId', 'operationId', 'revision', 'displayName',
  'requiredScopes', 'inputParameters', 'outputParameters', 'kind',
] as const;

function validParameters(value: unknown): value is CapabilityParameterV1[] {
  return Array.isArray(value) && value.length <= 128 && value.every((entry) => {
    const p = contractRecord(entry);
    return !!p && contractExactKeys(p, ['name', 'kind', 'required'])
      && contractId(p.name)
      && ['string', 'number', 'integer', 'boolean', 'object', 'array'].includes(String(p.kind))
      && typeof p.required === 'boolean';
  }) && new Set(value.map((entry) => entry.name)).size === value.length;
}

function validScopes(value: unknown): value is string[] {
  return Array.isArray(value) && value.length <= 64
    && value.every(contractId) && new Set(value).size === value.length;
}

/** Unknown fields, secret values and raw workflow definitions are rejected. */
export function validateCapabilityDescriptor(input: unknown): ContractCheck<CapabilityDescriptorV1> {
  const o = contractRecord(input);
  if (!o || o.schemaVersion !== 1 || !contractId(o.appId)
    || !contractId(o.operationId) || !contractId(o.revision)
    || typeof o.displayName !== 'string' || o.displayName.trim().length === 0
    || o.displayName.length > 160
    || !validScopes(o.requiredScopes)
    || !validParameters(o.inputParameters) || !validParameters(o.outputParameters)) {
    return { ok: false, reason: 'INVALID_CAPABILITY_BASE' };
  }
  if (o.kind === 'workflow') {
    if (!contractExactKeys(o, [...baseKeys, 'workflowId', 'ownerUserId', 'sourceWorkspaceId', 'published'])
      || !contractId(o.workflowId) || !contractId(o.ownerUserId)
      || !contractId(o.sourceWorkspaceId) || o.published !== true) {
      return { ok: false, reason: 'INVALID_OR_PRIVATE_WORKFLOW_PUBLICATION' };
    }
  } else if (o.kind === 'backend' || o.kind === 'frontend') {
    if (!contractExactKeys(o, [...baseKeys, 'deploymentId', 'sessionPermission'])
      || !contractId(o.deploymentId)
      || (o.kind === 'frontend' && !['inspect', 'act'].includes(String(o.sessionPermission)))
      || (o.kind === 'backend' && o.sessionPermission !== undefined)) {
      return { ok: false, reason: 'INVALID_STATIC_CAPABILITY' };
    }
  } else {
    return { ok: false, reason: 'UNKNOWN_CAPABILITY_KIND' };
  }
  return { ok: true, value: input as CapabilityDescriptorV1 };
}
