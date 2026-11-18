import { describe, expect, it } from 'vitest';
import {
  IDENTITY_KINDS, identityRef, isIdentityKind, parseIdentityId,
  parseIdentityRef, parseLegacyApplicationId, requireIdentityId,
} from '../src/auth/identityIds.js';

describe('canonical application identity references', () => {
  it('keeps the existing app slug and UUID without converting to a deployment URL', () => {
    expect(parseIdentityId('application', 'aiko')).toBe('aiko');
    expect(parseIdentityId('deployment', '9fa54152-1e8f-4d11-8db6-12db240eefed'))
      .toBe('9fa54152-1e8f-4d11-8db6-12db240eefed');
    expect(parseIdentityId('application', 'https://aiko.example')).toBeNull();
    expect(parseIdentityId('application', ' aiko')).toBeNull();
    expect(parseIdentityId('application', 'aiko\n')).toBeNull();
    expect(parseIdentityId('application', '')).toBeNull();
  });

  it('makes the role mandatory for serialized IDs', () => {
    for (const kind of IDENTITY_KINDS) {
      expect(isIdentityKind(kind)).toBe(true);
      expect(parseIdentityRef(identityRef(kind, 'same-id'))).toEqual({ kind, id: 'same-id' });
    }
    expect(isIdentityKind('origin')).toBe(false);
    expect(parseIdentityRef({ id: 'aiko' })).toBeNull();
    expect(parseIdentityRef({ kind: 'origin', id: 'aiko' })).toBeNull();
    expect(parseIdentityRef({ kind: 'application', id: 'https://example.com' })).toBeNull();
    expect(parseIdentityRef({ kind: 'deployment', id: 123 })).toBeNull();
    expect(parseIdentityRef([])).toBeNull();
    expect(() => requireIdentityId('application', 'https://bad')).toThrow(TypeError);
  });

  it('reads legacy Luth and Skipo IDs while rejecting conflicting aliases', () => {
    expect(parseLegacyApplicationId({ applicationId: 'srkl' })).toBe('srkl');
    expect(parseLegacyApplicationId({ app_id: 'aiko', appId: 'aiko' })).toBe('aiko');
    expect(parseLegacyApplicationId('kone')).toBe('kone');
    expect(parseLegacyApplicationId({ app_id: 'aiko', applicationId: 'kone' })).toBeNull();
    expect(parseLegacyApplicationId({ applicationId: 'https://bad' })).toBeNull();
    expect(parseLegacyApplicationId({ appId: null })).toBeNull();
    expect(parseLegacyApplicationId({ origin: 'https://aiko.example' })).toBeNull();
  });
});
