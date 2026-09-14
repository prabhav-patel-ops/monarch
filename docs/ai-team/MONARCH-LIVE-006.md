# MONARCH-LIVE-006 — persistent deployment

## Deployment contract

- Host the static Vite/PWA build with GitHub Pages and GitHub Actions.
- Production URL: `https://prabhav-patel-ops.github.io/monarch/`.
- Derive the production base path from `actions/configure-pages` so scripts,
  icons, the web manifest, PWA scope, and service-worker assets remain under the
  repository path.
- Run the existing tests plus a generated-build path check before deployment.
- Deploy only the generated `dist/` artifact. No credentials are stored in the
  repository or browser bundle.

## Data and runtime caveats

The deployment changes asset paths only. The live save remains origin-local
browser storage under `monarch.v1`; transactional rollback keys, IndexedDB
recovery snapshots, and backup import/export are unchanged. Moving from
localhost to the live origin does not copy browser storage automatically, so an
existing localhost save should be exported and imported once on the live site.

GitHub Pages cannot run `netlify/functions/claude`. The core app remains fully
static and functional, while the optional System chat and meal-photo scan keep
their current graceful unavailable behavior unless the app is deployed to
Netlify with the server-side `ANTHROPIC_API_KEY`.
