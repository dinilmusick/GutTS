import { describe, expect, it } from 'vitest';
import {
  normalizeStoragePath, encodeSafePathSegments, resolveTrustedApiUrl,
} from '../src/urls/path-safety.js';

describe('portable path safety', () => {
  it('normalizes safe paths while preserving Unicode and root semantics', () => {
    expect(normalizeStoragePath('/some//folder/')).toBe('some/folder');
    expect(normalizeStoragePath('/')).toBe('');
    expect(normalizeStoragePath('')).toBe('');
    expect(normalizeStoragePath('हिंदी/notes.txt')).toBe('हिंदी/notes.txt');
    expect(encodeSafePathSegments('a b/हिंदी.txt')).toBe('a%20b/%E0%A4%B9%E0%A4%BF%E0%A4%82%E0%A4%A6%E0%A5%80.txt');
  });
  it('rejects traversal, encoded separators, malformed escapes and controls', () => {
    const unsafe = [
      '/a/../b', '/a/./b', '/a/%2e%2e/b', '/a/%2E/b',
      '/a/%252e%252e/b', '/a/%2525252e%2525252e/b',
      '/a/%2f/b', '/a/%5c/b', '/a/%252f/b',
      '/a?b', '/a#b', '/a\\b', '/a/%xx', '/a/\u0000b',
    ];
    for (const path of unsafe) expect(() => normalizeStoragePath(path)).toThrow();
  });
  it('accepts in-origin relative endpoints and encoded GitLab project identifiers', () => {
    expect(resolveTrustedApiUrl('https://gitlab.com', '/api/v4/projects/team%2Frepo?per_page=10').href)
      .toBe('https://gitlab.com/api/v4/projects/team%2Frepo?per_page=10');
  });
  it('rejects cross-origin, protocol, dot-segment and credential-bearing URLs', () => {
    const forbidden = [
      '//attacker.test/api', '/\\attacker.test', '/%2e%2e/escape',
      '/%252e%252e/escape', '/x/../escape', '/x/%5c/escape',
      '/x#fragment', '\n/evil',
    ];
    for (const path of forbidden)
      expect(() => resolveTrustedApiUrl('https://api.example.com', path)).toThrow();
    for (const origin of [
      'http://api.example.com','https://user:token@api.example.com',
      'https://api.example.com/v1', 'https://api.example.com/?secret=x',
    ]) expect(() => resolveTrustedApiUrl(origin, '/v1')).toThrow();
  });
});
