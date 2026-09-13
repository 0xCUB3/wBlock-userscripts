# Contribution instructions

- `packages/*/src` is the editable source of truth; `packages/*/dist` is generated and tracked. Never hand-edit `dist`.
- Before release, run `npm install`, `npm run build`, `npm run check`, and `npm test`; builds and checks must not use the network.
- Every release bumps package-source metadata and regenerates dist metadata. Keep canonical raw `main` URLs unchanged.
- Release destination is GitHub `origin`, branch `main`; push only with explicit release approval.
- Dark Reader vendor updates must preserve `vendor/LICENSE.txt`, `PROVENANCE.md`, and the private Chrome shim; use `tools/`.
