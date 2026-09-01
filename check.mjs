/* Build check for index.html.   Run: node check.mjs
 *
 * This exists because the same bug has now shipped four times: a new component
 * gives an inner element a short class name (.sc, .mk, .id) that already has a
 * bare global rule somewhere else in the stylesheet, and the global rule wins
 * silently. There is no error, nothing throws, the element just quietly takes
 * on layout it was never meant to have — the last one made every row on the
 * home page 147px tall with a 36px gap inside the score cell.
 *
 * The check: a class that is used as an INNER element of some component
 * (it appears in the stylesheet only as `.parent .child`) must not also have a
 * bare global rule `.child { }`. That combination is the bug, exactly.
 */
import fs from 'fs';
import vm from 'vm';

const src = fs.readFileSync(new URL('./index.html', import.meta.url), 'utf8');
let bad = 0;
const fail = (...a) => { bad++; console.log('✗', ...a); };

/* ── 1. inline script syntax ─────────────────────────────────────── */
const scripts = [...src.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
try { new vm.Script(scripts.join('\n;\n')); console.log('✓ script syntax'); }
catch (e) { fail('script syntax:', e.message); }

/* ── 2. selector inventory ───────────────────────────────────────── */
const css  = (src.match(/<style>([\s\S]*?)<\/style>/) || [])[1] || '';
const body = css.replace(/\/\*[\s\S]*?\*\//g, '');

const bareRule = new Set();        // .foo { }            — matches anywhere
const childOf  = new Map();        // child -> Set(parent) from `.parent .child`

for (const m of body.matchAll(/(^|[}{;])\s*([^{}@]+?)\s*\{/g)) {
  for (const raw of m[2].split(',')) {
    const sel = raw.trim();
    if (!sel || sel.startsWith('@') || sel.startsWith('%')) continue;
    if (/^\.[A-Za-z][-\w]*$/.test(sel)) { bareRule.add(sel.slice(1)); continue; }
    // descendant chains: pull the last class and any class before it
    const parts = sel.split(/\s+|>/).filter(Boolean);
    if (parts.length < 2) continue;
    const lastClasses = [...parts[parts.length - 1].matchAll(/\.([A-Za-z][-\w]*)/g)].map(x => x[1]);
    const ancestors = parts.slice(0, -1).flatMap(p =>
      [...p.matchAll(/\.([A-Za-z][-\w]*)/g)].map(x => x[1]));
    if (!lastClasses.length || !ancestors.length) continue;
    for (const c of lastClasses) {
      if (!childOf.has(c)) childOf.set(c, new Set());
      ancestors.forEach(a => childOf.get(c).add(a));
    }
  }
}

/* ── 3. the collision ────────────────────────────────────────────── */
/* SHARED is the list of primitives that are MEANT to be dropped inside other
   components and tuned there — `.hm-cta .btn{height:50px}` is a deliberate
   override, not an accident. Everything else that has a bare global rule and
   turns up as somebody else's inner element is the bug. Keeping this list
   explicit is the point: adding a name to it is a decision, and a new inner
   name that trips the check is a question worth answering. */
const SHARED = new Set([
  'btn','card','chip','sk','sk-row','tilt','edge','mag','lead','sec','sec-h','rv','pad','lift','glow',
  'micro','qm','tip','up','down','warn','info','pri','ghost','on','ico','go','seg','pill','stripe',
  'mono','crumb','dock','rail','page','shell','main','top','pgr','pgb','pgd','pgn',
]);
const stem = c => c.includes('-') ? c.split('-')[0] : c;
const hits = [];
for (const [child, parents] of childOf) {
  if (!bareRule.has(child) || SHARED.has(child)) continue;
  /* a compound ancestor (.hm-stage.touched) counts as one: sharing the stem
     through any of its classes means the rule is inside its own component */
  const own = [...parents].some(p => stem(p) === stem(child) || p === child);
  if (!own) hits.push({ child, foreign: [...parents] });
}
if (hits.length) {
  fail('class collisions — a bare global rule also used as an inner element:');
  for (const h of hits) console.log(`    .${h.child}  is global, and nested under  ${h.foreign.map(f => '.' + f).join(', ')}`);
} else {
  console.log('✓ no class collisions');
}

/* ── 4. the list to check new inner names against ────────────────── */
const globals = [...bareRule].filter(c => !c.includes('-')).sort();
console.log('  short global class names — never reuse one as an inner element:');
console.log('   ', globals.join(' '));

/* ── 5. classes produced by script with no rule anywhere ─────────── */
const declared = new Set([...body.matchAll(/\.([A-Za-z][-\w]*)/g)].map(m => m[1]));
const used = new Set();
for (const s of scripts) {
  for (const m of s.matchAll(/\bel\(\s*'[a-z0-9]+'\s*,\s*'([a-z0-9 -]+)'/g))
    m[1].split(/\s+/).forEach(c => c && used.add(c));
  for (const m of s.matchAll(/class="([a-z0-9 -]+)"/g))
    m[1].split(/\s+/).forEach(c => c && used.add(c));
}
const orphans = [...used].filter(c => !declared.has(c));
if (orphans.length) console.log('  ⚠ classes created with no CSS rule:', orphans.join(', '));

console.log(bad ? `\n${bad} problem(s)` : '\nclean');
process.exit(bad ? 1 : 0);
