/** Browser/Worker-safe path utilities: no Node, SDK, or provider policy. */
function validateSegment(segment: string): void {
  let decoded = segment;
  // Catch double-encoded traversal and separators without decoding benign filenames.
  for (let depth = 0; depth < 3; depth++) {
    try { decoded = decodeURIComponent(decoded); }
    catch { throw new Error('Path contains invalid percent encoding'); }
    if (decoded === '.' || decoded === '..' || /[\\/?#\x00-\x1f\x7f]/.test(decoded))
      throw new Error('Unsafe relative path segment');
    if (!/%[0-9a-f]{2}/i.test(decoded)) break;
  }
}
/** Normalize a storage-relative path; preserve harmless filenames and root compatibility. */
export function normalizeStoragePath(path = ''): string {
  if (typeof path !== 'string' || /[\\?#\x00-\x1f\x7f]/.test(path))
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
/** Resolve relative API paths against a strict HTTPS origin before authorizing a request. */
export function resolveTrustedApiUrl(origin: string, path: string): URL {
  let base: URL;
  try { base = new URL(origin); }
  catch { throw new Error('Invalid trusted API origin'); }
  if (base.protocol !== 'https:' || base.username || base.password
      || base.pathname !== '/' || base.search || base.hash)
    throw new Error('Trusted API origin must be a bare HTTPS origin');
  if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//')
      || /[\\#\x00-\x1f\x7f]/.test(path))
    throw new Error('Only trusted-origin relative API paths are permitted');
  // URL removes dot segments automatically: validate their raw encoded representation.
  const pathname = path.split('?')[0] ?? '';
  for (const part of pathname.split('/').filter(Boolean)) {
    let decoded = part;
    for (let depth = 0; depth < 3; depth++) {
      try { decoded = decodeURIComponent(decoded); }
      catch { throw new Error('Invalid API path percent encoding'); }
      if (decoded === '.' || decoded === '..' || decoded.includes('\\'))
        throw new Error('API path traversal is prohibited');
      if (!/%[0-9a-f]{2}/i.test(decoded)) break;
    }
  }
  const target = new URL(path, base);
  if (target.origin !== base.origin || target.username || target.password || target.hash)
    throw new Error('API path escaped its trusted origin');
  return target;
}
