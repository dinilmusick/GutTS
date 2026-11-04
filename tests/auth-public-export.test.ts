import { describe, expect, it } from 'vitest';
import { createLuthAuthClient, LuthAuthClient } from '@dinilmusick/gutts/auth';

describe('GutTS public authentication package export', () => {
  it('resolves the documented auth subpath and exposes the Luth client factory', () => {
    const client = createLuthAuthClient({
      ecosystemId: 'ultrst-armada',
      applicationId: 'gutts-public-export-test',
      origin: 'https://example.test',
      autoRegister: false,
    });
    expect(client).toBeInstanceOf(LuthAuthClient);
    expect(client.applicationId).toBe('gutts-public-export-test');
    expect(typeof client.refreshSession).toBe('function');
  });
});
