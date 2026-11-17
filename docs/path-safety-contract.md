# Portable path safety utilities

GutTS owns parsing and origin/path safety, not provider credentials or API logic.

Import from `@dinilmusick/gutts/urls/safety`:
- `normalizeStoragePath(path)`: validated portable storage-relative path.
- `encodeSafePathSegments(path)`: safe segment-by-segment encoding.
- `resolveTrustedApiUrl(origin, path)`: resolve a relative API path against an HTTPS origin.

Security rules: reject traversal, deeply encoded traversal, delimiters, malformed
encoding, user-info origins, origin changes and fragment injection. An encoded
slash is allowed in *API paths only*, to support scoped identifiers (GitLab);
a slash-encoded `..` segment is forbidden. If too many decoding levels remain,
fail closed.

Kloks owns Cloudflare, Vercel, GitHub, Dropbox, B2 and Google API wrappers;
SRKL owns credential storage. No provider SDK or dependency is introduced here.

Use an authorized, fixed provider origin; these helpers do not replace scope
authorization and do not follow HTTP redirects.
