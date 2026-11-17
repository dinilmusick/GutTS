/** Portable, SDK-free validation. Provider-specific scopes remain outside GutTS. */
const ENCODED_ESCAPE = /%[0-9a-f]{2}/i;
const INVALID_CHAR = /[\\?#\x00-\x1f\x7f]/;

/** Validate every decoding layer so repeated escaping cannot hide traversal. */
function validateSegment(segment: string, allowEncodedSlash = false): void {
  let value = segment;
  for (let depth = 0; depth < 8; depth++) {
    try { value = decodeURIComponent(value); }
    catch { throw new Error('Path contains invalid percent encoding'); }
    const parts = value.split('/');
    if (parts.some(part => part === '.' || part === '..')
        || INVALID_CHAR.test(value) || (!allowEncodedSlash && value.includes('/')))
      throw new Error('Unsafe relative path segment');
    if (!ENCODED_ESCAPE.test(value)) return;
  }
  throw new Error('Path is too deeply encoded to verify safely');
}

/** Normalize a storage-relative path; preserve harmless filenames and root compatibility. */
export function normalizeStoragePath(path = ''): string {
  if (typeof path !== 'string' || INVALID_CHAR.test(path))
    throw new Error('Invalid storage path');
  const parts = path.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);
  for (const part of parts) validateSegment(part);
  return parts.join('/');
}

/** URI-encode individual path segments without collapsing directory structure. */
export function encodeSafePathSegments(path: string): string {
  const normalized = normalizeStoragePath(path);
  if (!normalized) throw new Error('A nonempty relative path is required');
  return normalized.split('/').map(encodeURIComponent).join('/');
}

/**
 * Resolve a relative API path against a bare HTTPS origin.
 * Encoded slashes are supported (e.g., GitLab project identifiers) but cannot
 * conceal traversal, query delimiters, backslashes or another host.
 */
export function resolveTrustedApiUrl(origin: string, path: string): URL {
  let base: URL;
  try { base = new URL(origin); }
  catch { throw new Error('Invalid trusted API origin'); }
  if (base.protocol !== 'https:' || base.username || base.password
      || base.pathname !== '/' || base.search || base.hash)
    throw new Error('Trusted API origin must be a bare HTTPS origin');
  if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//')
      || INVALID_CHAR.test(path.replace(/\?.*$/, '')))
    throw new Error('Only trusted-origin relative API paths are permitted');
  const pathname = path.split('?')[0] ?? '';
  for (const part of pathname.split('/').filter(Boolean))
    validateSegment(part, true);
  const target = new URL(path, base);
  if (target.origin !== base.origin || target.username || target.password || target.hash)
    throw new Error('API path escaped its trusted origin');
  return target;
}
