import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('GutTS authoritative manifest', () => {
  const manifest = JSON.parse(readFileSync(new URL('../gutts.manifest.json', import.meta.url), 'utf8'));
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

  it('matches the published package identity and version', () => {
    expect(pkg.private).toBe(false);
    expect(manifest.package).toBe(pkg.name);
    expect(manifest.version).toBe(pkg.version);
    expect(manifest.packageType).toBe('global-utility');
  });

  it('requires explicit promotion evidence', () => {
    expect(manifest.promotion.eligible).toBe(true);
    expect(manifest.promotion.requiresExplicitEvidence).toBe(true);
  });
});
