// GitHub #692: 「调整拖动干员时的视角」 — the 0.3.1 switch 设置「部署时收起商店」 (a boolean) becomes
// 设置「部署放大力度」 (an integer 0–100, default 100). 0 turns the deploy fold off exactly as the switch did; 100 is
// the released 0.3.1 framing; in between the shop still folds and the camera takes that share of the zoom (linear in
// the two official prep cameras), so a player can keep the fold but make the view change smaller.
//
// Covered here: the stored value and its migration (the old boolean, junk, out-of-range numbers), the settings modal's
// slider row and the four language packs, the diagnostics line, and the linear camera mapping (projection.js `fold`).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GEO } from '../../shared/constants.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');

const { sanitizeSettings, DEFAULT_SETTINGS, deployFoldsShop, prepCameraFor, prepDeployCamera } = await import('../../public/js/ui/gameLogic.js');
const { presetCamera } = await import('../../public/js/render/projection.js');
const { hudBands } = await import('../../public/js/ui/fieldHost.js');

const OLD_LABEL = '部署时收起商店';
const NEW_LABEL = '部署放大力度';
const OLD_HINT = '拖起干员、装备或召唤物，以及放下后选择朝向时，临时收起商店并放大棋盘。关闭后，拿起时既不改变商店的收起状态，也不缩放镜头。';
const NEW_HINT = '拖起干员、装备或召唤物，以及放下后选择朝向时，临时收起商店并放大棋盘。拖动滑块调整放大力度，0 为关闭（不收起商店，也不缩放镜头）。';

// ---- the stored strength ---------------------------------------------------------------------------------------------

describe('设置「部署放大力度」: the stored integer and the old boolean profile', () => {
  test('100 by default, an untouched profile gets the released 0.3.1 framing', () => {
    assert.equal(DEFAULT_SETTINGS.prepDeployFold, 100);
    assert.equal(sanitizeSettings(null).prepDeployFold, 100);
    assert.equal(sanitizeSettings({ bgm: 0.5 }).prepDeployFold, 100);
    assert.equal(sanitizeSettings({ prepDeployFold: undefined }).prepDeployFold, 100);
  });

  test('a profile saved before the slider migrates: true → 100, false → 0', () => {
    assert.equal(sanitizeSettings({ prepDeployFold: true }).prepDeployFold, 100);
    assert.equal(sanitizeSettings({ prepDeployFold: false }).prepDeployFold, 0);
  });

  test('numbers are rounded and clamped to 0–100', () => {
    for (const [v, want] of [[0, 0], [1, 1], [25, 25], [50, 50], [100, 100], [-1, 0], [-100, 0], [150, 100], [33.6, 34], [99.4, 99]]) {
      assert.equal(sanitizeSettings({ prepDeployFold: v }).prepDeployFold, want, String(v));
    }
  });

  test('a missing key or junk stays 100, never off', () => {
    for (const bad of ['50', '', null, NaN, Infinity, -Infinity, {}, [], [50], () => 50]) {
      assert.equal(sanitizeSettings({ prepDeployFold: bad }).prepDeployFold, 100, String(bad));
    }
  });

  test('the fold decision still follows the strength: 0 folds nothing, above 0 folds like before', () => {
    const own = { ownPrep: true, editable: true, pen: false, drag: true };
    assert.equal(deployFoldsShop({ ...own, enabled: 0 > 0 }), false);
    assert.equal(deployFoldsShop({ ...own, enabled: 25 > 0 }), true);
    assert.equal(deployFoldsShop({ ...own, enabled: 100 > 0 }), true);
  });
});

// ---- the settings modal and the language packs -----------------------------------------------------------------------

describe('the settings modal: a 1 % slider, its value text, and the four packs', () => {
  const settings = read('public/js/ui/settings.js');

  test('the row is a slider (0–100, step 1) that writes on input, not the old toggle', () => {
    assert.match(settings, /function FoldSlider\(\{ label, micro, value, onChange \}\)/);
    assert.match(settings, /type="range" min="0" max="100" step="1"/);
    assert.match(settings, /data-testid="prep-deploy-fold"/);
    assert.match(settings, /onInput=\$\{\(e\) => onChange\(Number\(e\.currentTarget\.value\)\)\}/);
    assert.match(settings, /<\$\{FoldSlider\} label=\$\{t\('部署放大力度'\)\}/);
    assert.doesNotMatch(settings, new RegExp(`<\\$\\{Toggle\\} label=\\$\\{t\\('${OLD_LABEL}'\\)\\}`));
    assert.doesNotMatch(settings, new RegExp(OLD_LABEL));
  });

  test('the value reads as a percentage, 0 as 关闭', () => {
    assert.match(settings, /aria-valuetext=\$\{v \? `\$\{v\}%` : tc\('toggle', '关闭'\)\}/);
    assert.match(settings, /<span class="set-row__val num">\$\{v \? `\$\{v\}%` : tc\('toggle', '关闭'\)\}<\/span>/);
  });

  test('the hint says 力度 and 0 = 关闭, and every pack translates both strings', () => {
    assert.match(settings, new RegExp(NEW_HINT.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    for (const lang of ['en', 'ja', 'ko', 'zh-TW']) {
      const pack = JSON.parse(read(`public/i18n/${lang}.json`));
      assert.equal(typeof pack[NEW_LABEL], 'string', `${lang}: the strength label`);
      assert.ok(pack[NEW_LABEL].length > 0, `${lang}: a non-empty label`);
      assert.equal(typeof pack[NEW_HINT], 'string', `${lang}: the strength hint`);
      assert.ok(pack[NEW_HINT].length > 0, `${lang}: a non-empty hint`);
      assert.equal(pack[OLD_LABEL], undefined, `${lang}: the boolean label is gone`);
      assert.equal(pack[OLD_HINT], undefined, `${lang}: the boolean hint is gone`);
    }
  });

  test('the diagnostics report a strength other than 100 (and 0 as off)', () => {
    const diag = read('public/js/diag.js');
    assert.match(diag, /settings\.prepDeployFold === 0 \? 'deploy fold off' : settings\.prepDeployFold !== 100 \? `deploy fold \$\{settings\.prepDeployFold\}%` : null/);
  });
});

// ---- the camera: linear between the shop camera and the folded-shop camera -------------------------------------------

/** The DOM bits hudBands reads (a coarse phone at 1rem = 40 px, 844×390). */
function withDom({ rem }, fn) {
  const g = globalThis;
  const saved = { document: g.document, getComputedStyle: g.getComputedStyle };
  const root = { classList: { contains: (c) => c === 'sp-coarse' } };
  g.getComputedStyle = (el) => ({ fontSize: `${rem}px`, getPropertyValue: (p) => (el === root && p === '--tap-min' ? ' 44px' : '') });
  g.document = {
    documentElement: root,
    querySelector: (s) => (s === '.gm__hud' ? { getBoundingClientRect: () => ({ top: 0, bottom: 0 }) } : null),
    querySelectorAll: (s) => (s.includes('.gm__corner') ? [{ top: 390 - 0.24 * rem - 34, height: 34 }] : []),
  };
  try { return fn(); } finally { g.document = saved.document; g.getComputedStyle = saved.getComputedStyle; }
}

describe('the camera strength: 0 = no zoom, 100 = the released folded-shop camera, linear in between', () => {
  const [w, h] = [844, 390];
  const opts = { rect: { ...GEO.NORMAL_RECT }, side: 'L' };
  const tileW = (cam, row) => cam.project(5.5, row - 0.5).x - cam.project(4.5, row - 0.5).x;

  test('844×390 phone: the endpoints are the two released cameras and the middle is the linear blend', () => {
    withDom({ rem: 40 }, () => {
      const foldHud = hudBands('prep', { width: w, height: h }, { shop: false });
      // the folded-shop pixel framing of a hand-made 收起, and the shop camera — the released 100 % / 0 % ends
      const folded = presetCamera('prep', { width: w, height: h }, { ...opts, shop: false, hud: foldHud });
      const open = presetCamera('prep', { width: w, height: h }, { ...opts, shop: true, hud: foldHud });
      const at = (fold) => presetCamera('prep', { width: w, height: h }, { ...opts, shop: false, fold, hud: foldHud });

      // 100 % (and a missing value) is the released folded-shop camera, byte for byte
      assert.deepEqual(at(1).params(), folded.params());
      assert.deepEqual(presetCamera('prep', { width: w, height: h }, { ...opts, shop: false, hud: foldHud }).params(), folded.params());
      // 0 % is the shop camera: no zoom and no shift at all
      assert.deepEqual(at(0).params(), open.params());

      // 50 %: linear in every parameter — halfway between the two framings (the focal scale too)
      const half = at(0.5);
      assert.ok(Math.abs(half.tx - (open.tx + folded.tx) / 2) < 1e-9, `tx ${half.tx}`);
      assert.ok(Math.abs(half.ty - (open.ty + folded.ty) / 2) < 1e-9, `ty ${half.ty}`);
      assert.ok(Math.abs(half.scale - (open.scale + folded.scale) / 2) < 1e-9, `scale ${half.scale}`);
      assert.ok(Math.abs(half.dist - (open.dist + folded.dist) / 2) < 1e-9, `dist ${half.dist}`);

      // the board grows monotonically with the strength, and 25 % is visibly smaller than the full fold
      const px = (cam) => cam.project(5.5, 9.5).x - cam.project(4.5, 9.5).x;
      assert.equal(px(at(0)), px(open));
      assert.ok(px(at(0.25)) > px(open) && px(at(0.25)) < px(half), `25 % ${px(at(0.25))} between ${px(open)} and ${px(half)}`);
      assert.ok(px(half) < px(folded), `50 % ${px(half)} under the full fold ${px(folded)}`);
      assert.ok(tileW(half, 10) > 0);
    });
  });

  test('the prep camera request carries the share; the shop fold decision is separate', () => {
    const pl = (id, seat) => ({ playerId: id, seat, alive: true });
    const pub = { round: 6, bossRound: 14, hiddenRound: 15, players: [pl('a', 0), pl('b', 1)] };
    const open = prepCameraFor(pub, 'a', false);
    const frame = { pub, myId: 'a', ownPrep: true, pen: false, folded: false, current: open, deployFold: true };
    assert.deepEqual(prepDeployCamera({ ...frame, fold: 0.25 }).opts,
      { rect: { ...GEO.NORMAL_RECT }, side: 'L', shop: false, fold: 0.25 });
    assert.deepEqual(prepDeployCamera(frame).opts, { rect: { ...GEO.NORMAL_RECT }, side: 'L', shop: false },
      'without a strength the request is the released one');
    // the shop was already folded by hand: no strength may zoom it back out
    const folded = prepCameraFor(pub, 'a', true);
    assert.deepEqual(prepDeployCamera({ ...frame, fold: 0.25, ownFolded: true, current: open }).opts,
      { rect: { ...GEO.NORMAL_RECT }, side: 'L', shop: false },
      'a folded shop keeps the released full request, whatever the strength');
    assert.equal(prepDeployCamera({ ...frame, fold: 0.25, ownFolded: true, current: folded }), null,
      'already at the folded-shop camera: nothing to ask for');
  });
});

// ---- the docs follow the code ----------------------------------------------------------------------------------------

describe('the reference docs describe the strength', () => {
  test('design/client.md and PLAYING.md', () => {
    const client = read('docs/design/client.md');
    assert.match(client, /prepDeployFold`\n\(部署放大力度; integer 0–100, default 100/);
    assert.match(client, /a saved boolean migrates `true` → 100 \/ `false` → 0/);
    const playing = read('docs/PLAYING.md');
    assert.match(playing, /部署放大力度/);
    assert.match(playing, /0 为关闭/);
  });
});
