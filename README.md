# wBlock Userscripts

Standalone userscripts maintained for wBlock. The raw `main` branch is the update channel.

## Packages

- `packages/tube-cleaner`: native YouTube controls and playback features.
- `packages/player-cleaner`: native controls for custom web players.
- `packages/dearrow` replaces YouTube titles and thumbnails with community suggestions.
- `packages/dark-reader`: Dark Reader's MIT-licensed API engine for wBlock, without the full site-fix database.

Each package has editable `src/`, tracked generated `dist/`, and stable install metadata. Install from:

- `https://raw.githubusercontent.com/0xCUB3/wBlock-userscripts/main/packages/tube-cleaner/dist/tube-cleaner.user.js`
- `https://raw.githubusercontent.com/0xCUB3/wBlock-userscripts/main/packages/player-cleaner/dist/player-cleaner.user.js`
- `https://raw.githubusercontent.com/0xCUB3/wBlock-userscripts/main/packages/dark-reader/dist/dark-reader.user.js`
- `https://raw.githubusercontent.com/0xCUB3/wBlock-userscripts/main/packages/dearrow/dist/dearrow.user.js`

DeArrow runs independently of Tube Cleaner and uses community data from https://dearrow.ajay.app/ under CC BY-NC-SA 4.0.

## Development and release

```sh
npm install
npm run build
npm run check
npm test
```

Playwright WebKit is required for the cleaner harness (`npx playwright install webkit`). Bump the source metadata version for every release, then build and check. `dist/*.meta.js` files contain exactly the userscript metadata and are the update manifests. Do not edit generated files by hand. A release is published by pushing `main` to `origin`; raw `main` is intentionally the update channel.
