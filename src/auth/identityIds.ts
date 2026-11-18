/**
 * Identity roles shared across Luth, Skipo, Kloks and application consumers.
 * An application is stable across URLs, deployments, OAuth clients and sessions.
 * These tagged references are portable JSON; never infer a role from a raw ID.
 */
export const IDENTITY_KINDS = [
  'application',
  'deployment',
  'oauth_client',
  'user',
  'workspace',
  'ui_session',
] as const;

export type IdentityKind = (typeof IDENTITY_KINDS)[number];

declare const identityBrand: unique symbol;
export type IdentityId<K extends IdentityKind> = string & {
  readonly [identityBrand]: K;
};
export type ApplicationId = IdentityId<'application'>;
export type DeploymentId = IdentityId<'deployment'>;
export type OAuthClientId = IdentityId<'oauth_client'>;
export type UserId = IdentityId<'user'>;
export type WorkspaceId = IdentityId<'workspace'>;
export type UiSessionId = IdentityId<'ui_session'>;

/** A discriminated, non-secret wire representation. */
export type IdentityRef<K extends IdentityKind = IdentityKind> =
  K extends IdentityKind ? Readonly<{ kind: K; id: IdentityId<K> }> : never;

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;

export function isIdentityKind(value: unknown): value is IdentityKind {
  return typeof value === 'string' &&
    (IDENTITY_KINDS as readonly string[]).includes(value);
}

/** Accept existing slug/UUID IDs unchanged; reject URL/whitespace/control injection. */
export function parseIdentityId<K extends IdentityKind>(
  kind: K,
  value: unknown,
): IdentityId<K> | null {
  if (!isIdentityKind(kind) || typeof value !== 'string' || !ID_PATTERN.test(value)) {
    return null;
  }
  return value as IdentityId<K>;
}

export function requireIdentityId<K extends IdentityKind>(
  kind: K,
  value: unknown,
): IdentityId<K> {
  const id = parseIdentityId(kind, value);
  if (id === null) throw new TypeError(`Invalid ${kind} identity ID`);
  return id;
}

export function identityRef<K extends IdentityKind>(kind: K, id: string): IdentityRef<K> {
  return { kind, id: requireIdentityId(kind, id) } as IdentityRef<K>;
}

/** Fail closed on ambiguous/unknown roles. Never treat a URL as an application ID. */
export function parseIdentityRef(value: unknown): IdentityRef | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (!isIdentityKind(record.kind)) return null;
  const id = parseIdentityId(record.kind, record.id);
  if (id === null) return null;
  return { kind: record.kind, id } as IdentityRef;
}

/**
 * Read previous Skipo/Luth registration payloads without changing their wire shape.
 * Conflicting aliases are rejected instead of silently switching app identities.
 */
export function parseLegacyApplicationId(value: unknown): ApplicationId | null {
  if (typeof value === 'string') return parseIdentityId('application', value);
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const aliases = ['app_id', 'appId', 'applicationId'] as const;
  let result: ApplicationId | null = null;
  for (const key of aliases) {
    if (!Object.prototype.hasOwnProperty.call(record, key)) continue;
    const candidate = parseIdentityId('application', record[key]);
    if (candidate === null || (result !== null && result !== candidate)) return null;
    result = candidate;
  }
  return result;
}
