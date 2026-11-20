# ULTRST production authentication certification

## Automated live boundary check

The GitHub Actions workflow **ULTRST production authentication boundary** tests actual deployed Luth, SRKL and Aiko endpoints with **no credentials**. It verifies public discovery, no confidential fields, rejection of unknown/malformed applications, missing and forged Bearer denial for configuration, admin enrollment denial without a session, cross-origin enrollment denial, application OAuth start (unprovisioned or correct code+PKCE redirect), and rejection of unauthenticated sessions/forged callbacks.

A green default workflow means only **public security boundaries passed**. It cannot prove that a real user authenticated or received authorized workspace configuration. Its report explicitly labels interactive login and authenticated configuration as *not tested*.

## Administrator-authorized OAuth enrollment

1. Sign into https://luth.blueprint-ninjastudios.workers.dev with an **ACTIVE Luth administrator account**.
2. Open **Application OAuth Clients → Manage**. This invokes the existing, server-authorized `/api/registry/oauth-clients` endpoint.
3. Enroll exact `srkl` origin `https://srkl-engine.todadjp.workers.dev`.
4. Enroll exact `aiko` origin `https://aiko.todadjp.workers.dev`.
5. Independently confirm each active official OAuth client is paired with its protected system-database `applicationOAuth[app_id|origin]` record **without reading or printing secret values**. Both applications must use their canonical `APP_URL` and server-only system database binding.

Never copy OAuth client secrets, refresh tokens, or BFF encryption keys into Worker `LUTH_OAUTH_*` variables or browser code. Do not directly insert OAuth clients in SQL or bypass administrator and verified-origin checks.

## Strict post-enrollment validation

In GitHub → `dinilmusick/GutTS` → Actions → **ULTRST production authentication boundary** → **Run workflow**, select `main` and `require_enrolled=true`. Both application OAuth start routes must return Luth authorization-code redirects with **PKCE S256**, correct callback origins, and secure HttpOnly flow cookies. A provisioning error fails this strict run.

## Final independent browser / user E2E gate

Using a clean browser and a test Luth user, complete the real Google OAuth redirect/callback, verify the first-party HttpOnly session, then reload and confirm session continuity. Request authenticated workspace-scoped configuration through the same-origin BFF and verify only the authorized workspace succeeds. Repeat as a **different user**: deny cross-user and cross-app workspace access and unauthorized operations. Revoke the grant/session and verify the old browser session loses protected access. Sign out and confirm login is required again. Check that client secrets, database URLs, refresh/access tokens, and BFF keys never appear in browser responses, URLs, logs, or persisted web state.

Record exact deploy SHA/build IDs, non-secret enrollment evidence, real session/authorization test outcomes, and an independent verifier ID in ATAX. **Do not mark the auth infrastructure E2E certified until all positive, negative, revocation, and workspace-isolation cases pass.**
