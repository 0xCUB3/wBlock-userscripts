// Older app releases cannot migrate DeArrow into its own catalog entry yet.
// Keep their opt-in working from the same source; new wBlock disables this shim.
export function cleanerDistribution(slug, source, deArrowSource) {
  if (slug !== 'tube-cleaner') return source;
  const executable = deArrowSource.replace(/\/\/ ==UserScript==[\s\S]*?\/\/ ==\/UserScript==\s*/, '');
  return source + '\n(function () {\n' +
    '  if (typeof __wblockTubeCleanerDeArrow !== "object" || !__wblockTubeCleanerDeArrow.enabled || window.__wblockDeArrowDebug) return;\n' +
    '  const __wblockDeArrowSettings = __wblockTubeCleanerDeArrow;\n' + executable + '\n})();\n';
}

// The metadata block goes first so managers find it without scanning the
// ~100 KB vendored Dark Reader line; the adapter still runs after the vendor.
export function darkReaderDistribution(vendor, adapter) {
  const header = adapter.match(/\/\/ ==UserScript==[\s\S]*?\/\/ ==\/UserScript==\n/)[0];
  return `${header}${vendor.trimEnd()}\n${adapter.slice(header.length)}`;
}
