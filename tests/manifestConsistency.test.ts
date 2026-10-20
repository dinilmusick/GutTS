import { describe, expect, it } from 'vitest';
import manifest from '../gutts.manifest.json' with { type: 'json' };
import pkg from '../package.json' with { type: 'json' };

describe('GutTS authoritative manifest', () => {
  it('matches the published package identity and version', () => {
    expect(manifest.package).toBe(pkg.name);
    expect(manifest.version).toBe(pkg.version);
    expect(manifest.packageType).toBe('global-utility');
  });

  it('requires explicit promotion evidence', () => {
    expect(manifest.promotion.eligible).toBe(true);
    expect(manifest.promotion.requiresExplicitEvidence).toBe(true);
  });
});
