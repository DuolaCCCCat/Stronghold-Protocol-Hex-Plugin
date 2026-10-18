// test/ui/dj-tune.test.js — 粥友的酒's `dj-rotate` tuning, and the reference numbers every other button gets.
//
// The owner tuned the turn / the squash / the pulse until the button felt right. Those numbers are deliberately NOT
// the host's constants: they travel in ONE plugin's `effect` message (`tune`, shared/plugins/ui.js UI_ROTATE_TUNE), so
//   · 粥友的酒 (plugins/dj-wine) asks for them — its template's TUNE line, carried into the built page,
//   · the other three buttons (dj-amiya / dj-prss / dj-wine-2) send no `tune` and keep the reference mod's numbers,
//   · the host's two halves (public/css/screens/game.css, public/js/render/djRotate.js) keep the reference's numbers.
//
// This is the file that fails when the tuning is written into a host half instead of into the one plugin (the symptom
// the owner reported: every button slows down / deepens with it). No browser needed: the template, the built page, the
// stylesheet and the module are all readable, and the message is checked by the same validator the host runs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TURN_PERIOD, SQUASH_PERIOD, SQUASH_MIN, WIDTH_MAX, resolveTune } from '../../public/js/render/djRotate.js';
import { validatePluginMessage } from '../../shared/plugins/ui.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/** The single tuning line the template carries: `var TUNE = { turn: …, squash: …, pulse: … };`. */
function tuneLine(html) {
  const m = /var TUNE = \{ turn: ([\d.]+), squash: ([\d.]+), pulse: ([\d.]+) \}/.exec(html);
  assert.ok(m, 'the 粥友的酒 template still has its `var TUNE = { turn, squash, pulse }` line');
  return { turn: Number(m[1]), squash: Number(m[2]), pulse: Number(m[3]), text: m[0] };
}

/** A `--gm-dj-…` custom property's value in the stylesheet. */
function cssVar(css, name) {
  const m = new RegExp('--' + name + ':\\s*([^;]+);').exec(css);
  return m ? m[1].trim() : null;
}

test('the owner\'s numbers travel in one plugin\'s `tune`, and the host keeps the reference\'s', () => {
  const tpl = read('plugins-src/dj-wine/index.template.html');
  const tune = tuneLine(tpl);
  // the owner's values: ×1.15 the turn (1.116667 → 0.971014 s), 48% of the height taken away, 1.375× the pulse
  assert.deepEqual({ turn: tune.turn, squash: tune.squash, pulse: tune.pulse },
    { turn: 0.971014, squash: 0.48, pulse: 0.460605 });

  // the page the host actually serves is generated from this template: it must carry the same line (rebuild after
  // editing the template — `node plugins-src/dj-wine/build-page.mjs`)
  const page = read('plugins/dj-wine/ui/index.html');
  assert.ok(page.includes(tune.text + ';'),
    'plugins/dj-wine/ui/index.html was rebuilt from the template (node plugins-src/dj-wine/build-page.mjs)');

  // and it is a legal message: the host accepts exactly these numbers and hands them to the field module unchanged
  const msg = { v: 1, t: 'effect', name: 'dj-rotate', on: true, tune: { turn: tune.turn, squash: tune.squash, pulse: tune.pulse } };
  const r = validatePluginMessage(msg);
  assert.deepEqual(r, { ok: true, msg }, 'the plugin\'s effect message passes validatePluginMessage');
  assert.deepEqual(resolveTune(msg.tune), msg.tune, 'and the canvas half resolves to the same three numbers');

  // the host's own halves are the reference's — a tuned value written back into either one is the bug this pins
  assert.equal(TURN_PERIOD, 67 / 60, 'render/djRotate.js TURN_PERIOD is the reference\'s 1.116667 s');
  assert.equal(SQUASH_PERIOD, 38 / 60, 'render/djRotate.js SQUASH_PERIOD is the reference\'s .633333 s');
  assert.equal(SQUASH_MIN, 0.6, 'render/djRotate.js SQUASH_MIN is the reference\'s 60%');
  assert.equal(WIDTH_MAX, 1.1, 'render/djRotate.js WIDTH_MAX is the reference\'s 110%');
  assert.deepEqual(resolveTune(null), { turn: TURN_PERIOD, squash: 0.4, pulse: SQUASH_PERIOD },
    'no tune (the other three buttons) = the reference numbers');
  const css = read('public/css/screens/game.css');
  assert.equal(cssVar(css, 'gm-dj-turn-dur'), '1.116667s', 'game.css defaults the turn to the reference\'s 1.116667 s');
  assert.equal(cssVar(css, 'gm-dj-pulse-dur'), '.633333s', 'game.css defaults the pulse to the reference\'s .633333 s');
  assert.equal(cssVar(css, 'gm-dj-depth'), '.4', 'game.css defaults the depth to the reference\'s 40%');
  assert.match(css, /calc\(1 - var\(--gm-dj-depth\) \* var\(--gm-dj-squash\)\)/, 'the scale reads the overridable depth');
});

test('the other three buttons send no tune, so they keep the reference defaults', () => {
  for (const id of ['dj-amiya', 'dj-prss', 'dj-wine-2']) {
    const tpl = read(`plugins-src/${id}/index.template.html`);
    assert.ok(tpl.includes("name: 'dj-rotate'"), `${id} asks for dj-rotate`);
    assert.equal(/name: 'dj-rotate'[^}]*\btune\b/.test(tpl), false, `${id} sends no tune (nothing of 粥友的酒 leaks in)`);
    assert.equal(/\bTUNE\b/.test(tpl), false, `${id} carries no TUNE line at all`);
  }
});
