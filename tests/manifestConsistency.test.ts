import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('GutTS authoritative manifest', () => {
  const manifest = JSON.parse(readFileSync(resolve(process.cwd(), 'gutts.manifest.json'), 'utf8'));
  const pkg = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8'));

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
