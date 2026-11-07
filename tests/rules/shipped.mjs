// Pulls a pure function out of a built userscript so a proof can be held to
// the code that ships. The function sits between `// @gdp-begin <name>` and
// `// @gdp-end` and must not read anything outside itself.
import { readFileSync } from 'node:fs';

export function shippedFunction(slug, name) {
  const source = readFileSync(new URL(`../../packages/${slug}/dist/${slug}.user.js`, import.meta.url), 'utf8');
  const match = source.match(new RegExp(`// @gdp-begin ${name}\\n([\\s\\S]*?)// @gdp-end`));
  if (!match) throw new Error(`${slug}: no @gdp-begin ${name} block`);
  return new Function(`'use strict';\n${match[1]}\nreturn ${name};`)();
}
