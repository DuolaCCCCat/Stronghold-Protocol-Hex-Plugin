// test/ui/plugin-frame-ready.test.js — a ui plugin's frame is revealed only once its ENTRY document has loaded.
//
// A browser paints an iframe's blank first document immediately, which would flash a white/opaque box over the game
// before the plugin's page has painted. The host therefore keeps the frame at opacity 0 (public/css/components.css,
// `.ui-slot__frame`) and only adds `is-ready` when the load counter reaches the entry (public/js/ui/pluginFrame.js),
// taking it off again when the frame is re-parented and a new document starts over. These checks are static: the
// behaviour itself is exercised by the dj-*.e2e tests in a real browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('the frame is hidden until is-ready, and is-ready shows it', () => {
  const css = read('public/css/components.css');
  assert.match(css, /\.ui-slot__frame \{[^}]*opacity: 0;/);
  assert.match(css, /\.ui-slot__frame\.is-ready \{[^}]*opacity: 1;/);
});

test('the host adds is-ready at the entry load, and removes it when the frame is re-parented', () => {
  const src = read('public/js/ui/pluginFrame.js');
  const entry = src.slice(src.indexOf("iframe.addEventListener('load'"), src.indexOf('iframe.src = src;'));
  assert.match(entry, /if \(decision === 'entry'\) \{/);
  assert.match(entry, /rec\.iframe\.classList\.add\('is-ready'\)/);
  const move = src.slice(src.indexOf('function moveFrame('), src.indexOf('/** @param {FrameRec} rec */'));
  assert.match(move, /rec\.iframe\.classList\.remove\('is-ready'\)/);
});
