# NormalPics Comment UI

This public fork retains the complete Sodesu v0.5.2 source tree and its
AGPL-3.0 license. The `embed/` directory contains the focused NormalPics
comment product derived from the interaction model of Sodesu.

## Product changes

- Removed login, profile, visitor editing, and attachment upload from the
  embedded product.
- Preserved Markdown preview, sorting, two-level replies, likes, and
  administrator deletion.
- Added strict `postMessage` origin checks for iframe integration.
- Replaced product attribution with a source-code link to this public fork.

## Build

```sh
cd embed
npm install
npm run build
```
