# Contribution instructions

- `packages/*/src` is the editable source of truth; `packages/*/dist` is generated and tracked. Do not hand-edit dist.
- Run `npm install`, `npm run build`, `npm run check`, and `npm test` before release. Builds and checks do not use the network.
- Every release requires a version bump in the package source metadata and regenerated dist metadata. Keep the canonical raw `main` URLs unchanged.
- Release destination is GitHub `origin`, branch `main`; push only with explicit release approval.
- Dark Reader vendor updates must preserve `vendor/LICENSE.txt`, `PROVENANCE.md`, and the private Chrome shim. Use the tools in `tools/`.
