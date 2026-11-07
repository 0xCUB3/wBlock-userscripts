// Holds the userscripts to their proven rules.
//
// Each rule in tests/rules has a shipped twin: a pure function in a built
// userscript between `// @gdp-begin <name>` and `// @gdp-end`, reading
// nothing outside itself. proveAndHold proves the rule's laws (kernel
// checked), checks the broken variant is refused, runs the shipped function
// beside the rule on aimed draws, and makes sure that comparison can tell a
// mutated copy apart.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { proveSteps } from 'gdp-wired';

export function shippedFunction(slug, name) {
  const source = readFileSync(new URL(`../../packages/${slug}/dist/${slug}.user.js`, import.meta.url), 'utf8');
  const match = source.match(new RegExp(`// @gdp-begin ${name}\\n([\\s\\S]*?)// @gdp-end`));
  if (!match) throw new Error(`${slug}: no @gdp-begin ${name} block`);
  return new Function(`'use strict';\n${match[1]}\nreturn ${name};`)();
}

export function proveAndHold({ title, rule, laws, stepLaws = [], naive, slug, fn, init, params, draw, mutate, trials = 3000, depth = 30 }) {
  const proof = proveSteps(rule, laws, stepLaws);
  assert.deepEqual({ proven: proof.proven, checked: proof.checked }, { proven: true, checked: true }, JSON.stringify(proof));
  console.log(`PASS: ${title}: ${laws.length + stepLaws.length} laws proven and kernel-checked`);

  const broken = proveSteps(naive, laws, stepLaws, { search: false });
  assert.equal(broken.proven, false, `${title}: the broken variant must be refused`);
  console.log(`PASS: ${title}: the broken variant is refused (${broken.goal})`);

  const step = shippedFunction(slug, fn);
  const hold = candidate => rule.compare({ init, step: candidate }, { trials, depth, params, draw });
  const held = hold(step);
  assert.equal(held.failure, undefined, held.failure);
  console.log(`PASS: ${title}: the shipped ${fn} matches the rule on ${held.checked} steps`);
  const mutant = hold(mutate(step));
  assert.ok(mutant.failure, `${title}: compare must tell a mutated ${fn} apart`);
  console.log(`PASS: ${title}: compare catches a mutated ${fn}`);

  const cross = rule.crossCheck(laws, stepLaws);
  assert.equal(cross.failure, undefined, cross.failure);
}
