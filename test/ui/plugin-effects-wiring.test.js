// test/ui/plugin-effects-wiring.test.js — the three host visuals a ui plugin asks for must reach the field view and
// must be undable. Two real defects this locks:
//   1. `guardView` only forwards the names in fieldHost's METHODS/OPTIONAL lists. `setUnitsGif` / `setDjRotate` were
//      missing there, so the guarded view handed to `pluginFrame.setFieldView` had neither method, the effects were
//      dropped silently and 单位变 GIF / 旋转 never happened.
//   2. `dj-neon`'s undo used a module handle (`neonEl`) instead of the document: a box left behind by an earlier handle
//      survived the off, so the lighting stayed on.
// Static on purpose: the real DOM behaviour is a browser check. Deleting the removal, or dropping a name from
// the whitelist, turns these red.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('the guarded field view forwards the two host-visual methods', () => {
  const host = read('public/js/ui/fieldHost.js');
  const list = /const OPTIONAL = \[([^\]]*)\]/.exec(host);
  assert.ok(list, 'fieldHost has an OPTIONAL list');
  assert.match(list[1], /'setUnitsGif'/);
  assert.match(list[1], /'setDjRotate'/);
});

test('an effect request is recorded before it is applied, so a half that is not ready cannot drop it', () => {
  const src = read('public/js/ui/pluginFrame.js');
  const on = src.slice(src.indexOf('function setEffect('), src.indexOf('} else {', src.indexOf('function setEffect(')));
  const record = on.indexOf('rec.effects.add(name)');
  assert.ok(record > 0, 'the on branch records the effect');
  for (const applied of ['setFieldUnitsGif(true, rec.variant)', 'setNeon(true)', 'applyDjRotate()']) {
    const at = on.indexOf(applied);
    assert.ok(at > 0, `${applied} is applied`);
    assert.ok(at > record, `${applied} comes after rec.effects.add (recording must not depend on it)`);
  }
});

test('dj-neon is removed from the document, not just from a module handle', () => {
  const src = read('public/js/ui/pluginFrame.js');
  const fn = src.slice(src.indexOf('function removeNeon()'), src.indexOf('/** A fresh non-zero 32-bit seed'));
  assert.match(fn, /document\.querySelectorAll\(`\.\$\{NEON_CLASS\}`\)/);
  assert.match(fn, /\.remove\(\)/);
  assert.doesNotMatch(fn, /neonEl\.remove\(\)/, 'the handle alone is not the undo');
});

test('setFieldView re-applies every recorded visual to the view it is handed', () => {
  const src = read('public/js/ui/pluginFrame.js');
  const fn = src.slice(src.indexOf('export function setFieldView(view)'), src.indexOf('export function setFieldView(view)') + 900);
  assert.match(fn, /setFieldUnitsGif\(effectWanted\(GIF_EFFECT\)/);
  assert.match(fn, /applyDjRotate\(\)/);
  assert.match(fn, /setNeon\(view \? effectWanted\(NEON_EFFECT\) : false\)/);
});
