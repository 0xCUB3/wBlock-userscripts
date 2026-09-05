// Older app releases cannot migrate DeArrow into its own catalog entry yet.
// Keep their opt-in working from the same source; new wBlock disables this shim.
export function cleanerDistribution(slug, source, deArrowSource) {
  if (slug !== 'tube-cleaner') return source;
  const executable = deArrowSource.replace(/\/\/ ==UserScript==[\s\S]*?\/\/ ==\/UserScript==\s*/, '');
  return source + '\n(function () {\n' +
    '  if (typeof __wblockTubeCleanerDeArrow !== "object" || !__wblockTubeCleanerDeArrow.enabled || window.__wblockDeArrowDebug) return;\n' +
    '  const __wblockDeArrowSettings = __wblockTubeCleanerDeArrow;\n' + executable + '\n})();\n';
}
