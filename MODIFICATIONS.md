# NormalPics Comment UI

Integration and maintenance details: [INTEGRATION.md](./INTEGRATION.md)

This public fork retains the complete Sodesu v0.5.2 source tree and its
AGPL-3.0 license. The `embed/` directory contains the focused NormalPics
comment product derived from the interaction model of Sodesu.

## Product changes

- Refactored the `embed/` runtime into small modules for configuration, API
  access, parent-window messaging, mobile panel gestures, Markdown preview,
  operating-system detection, DOM mounting, and comment rendering.
- Moved deployment-specific origins and CSP values into Vite/Wrangler
  configuration instead of embedding them in the application logic.
- Removed login, profile, visitor editing, and attachment upload from the
  embedded product.
- Preserved Markdown preview, two-level replies, likes, and administrator
  deletion.
- Replaced visible sorting controls with a fixed ranking that prioritizes
  liked comments by like count, then unliked comments by recency.
- Added deterministic nickname-initial avatars, icon-only heart likes, and a
  hidden administrator verification trigger.
- Added normalized operating-system labels and a privacy-preserving,
  device-bound nickname-change cooldown.
- Added strict `postMessage` origin checks for iframe integration.
- Replaced product attribution with an underlined `Powered by Sodesu v0.5.2`
  link to this public fork.

## Build

```sh
cd embed
npm install
npm run build
```

Production configuration lives in `embed/.env.production` and
`embed/wrangler.toml`. See `INTEGRATION.md` before changing domains or CSP.
