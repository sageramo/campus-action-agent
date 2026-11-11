// Copies the web workbench's pure list logic into the mini program, so both edit the same v3 list
// format. Run after changing campus-action-agent/{time-state,task-state,shanshui,calendar}.js:
//   node scripts/sync-lib.mjs
// The mini program has no structuredClone, TextEncoder or crypto.randomUUID; they are swapped for
// equivalents (the list is plain JSON, so a JSON copy is exact).
import { readFileSync, writeFileSync } from 'node:fs';

const web = new URL('../../campus-action-agent/', import.meta.url);
const out = new URL('../miniprogram/lib/', import.meta.url);
const header = name => `// GENERATED from campus-action-agent/${name} by scripts/sync-lib.mjs. Do not edit here.\n`;
const swaps = [
  [/structuredClone\(value\)/g, 'JSON.parse(JSON.stringify(value))'],
  [/new TextEncoder\(\)\.encode\((\w+)\)\.(byteLength|length)/g, 'utf8Length($1)'],
  [/globalThis\.crypto\?\.randomUUID\?\.\(\)/g, 'undefined'],
];
const helper = "const utf8Length = text => { let n = 0; for (const ch of String(text)) { const c = ch.codePointAt(0); n += c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4; } return n; };\n";
for (const name of ['task-state.js', 'time-state.js', 'shanshui.js', 'calendar.js']) {
  let source = readFileSync(new URL(name, web), 'utf8');
  for (const [pattern, replacement] of swaps) source = source.replace(pattern, replacement);
  const needsHelper = source.includes('utf8Length(');
  writeFileSync(new URL(name, out), header(name) + (needsHelper ? helper : '') + source);
  for (const banned of ['structuredClone', 'TextEncoder', 'globalThis', 'document.', 'localStorage']) {
    if (source.includes(banned)) throw new Error(`${name} still uses ${banned}`);
  }
  console.log('synced', name);
}
