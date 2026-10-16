// test/ui/deploy-zoom-toggle.test.js — 设置「部署放大棋盘」 (GitHub #602, PR #646 by @Euqorab): the deploy fold — a
// piece picked up on the own prep board (or a legal drop's open direction wheel) folds the shop and zooms the board to
// the shop-collapsed prep camera — is the official client's behaviour and this build's own since PR #646, and it is now
// a setting a player can switch off. On by default, so a profile saved before the switch behaves exactly as before and
// untouched installs stay byte-identical; off, `screens/game.js deployFold` stays false for every interaction, which
// leaves the camera effect and the derived `shopFolded` / `barCollapsed` states on the pre-#646 path.
// Run: node --test test/ui/deploy-zoom-toggle.test.js

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sanitizeSettings, DEFAULT_SETTINGS, deployFoldsShop, foldCamera, prepCameraFor } from '../../public/js/ui/gameLogic.js';
import { GEO } from '../../shared/constants.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');
const LABEL = '部署放大棋盘';
const HINT = '休整期拖起干员、装备或召唤物准备部署，以及放下后选朝向时，临时收起商店并把棋盘放大到收起商店时的视角（按官方）。关闭后保持你当前的收起 / 展开状态。';

// ---- the setting ---------------------------------------------------------------------------------------------------

describe('deployZoom is stored with the other settings', () => {
  test('on by default, and for a profile saved before the switch', () => {
    assert.equal(DEFAULT_SETTINGS.deployZoom, true, 'the default keeps PR #646\'s behaviour');
    assert.equal(sanitizeSettings(null).deployZoom, true);
    assert.equal(sanitizeSettings({}).deployZoom, true, 'junk input');
    assert.equal(sanitizeSettings({ bgm: 0.4, mysticEnergy: true }).deployZoom, true, 'a profile saved before the switch');
    assert.equal(sanitizeSettings({ deployZoom: true }).deployZoom, true);
    assert.equal(sanitizeSettings({ deployZoom: false }).deployZoom, false, 'the player switched it off');
  });

  test('only a boolean false turns it off — junk falls back to on', () => {
    for (const bad of ['false', 'true', 1, 0, null, {}, []]) {
      assert.equal(sanitizeSettings({ deployZoom: bad }).deployZoom, true, JSON.stringify(bad));
    }
    // the rest of the profile is untouched by the switch (sanitize gives the same object plus the one key)
    assert.deepEqual(sanitizeSettings({ deployZoom: false, bgm: 0.4, keys: {} }),
      { ...sanitizeSettings({ bgm: 0.4, keys: {} }), deployZoom: false });
  });

  test('it is a general settings key: the same localStorage profile (sp.pref.settings), no key of its own', () => {
    const store = read('public/js/store.js');
    assert.match(store, /loadPref\(`sp\.pref\.\$\{key\}`|sp\.pref\.\$\{key\}/, 'the sp.pref.<key> storage the settings use');
    const ui = read('public/js/ui/settings.js');
    assert.match(ui, /savePref\('settings', sanitizeSettings\(s\)\);/, 'persisted with the settings store');
    assert.doesNotMatch(ui, /'deploy-zoom'|'deployZoom'\s*\)/, 'no separate preference key');
  });
});

// ---- the switch in the settings dialog ------------------------------------------------------------------------------

describe('设置 →「部署放大棋盘」', () => {
  const ui = read('public/js/ui/settings.js');

  test('a toggle with a hint, beside the other optional display rows', () => {
    assert.match(ui, /<\$\{Toggle\} label=\$\{t\('部署放大棋盘'\)\} micro="DEPLOY ZOOM" value=\$\{s\.deployZoom !== false\} onChange=\$\{\(v\) => updateSettings\(\{ deployZoom: v \}\)\} \/>/);
    assert.ok(ui.includes(`t('${HINT}')`), 'the hint under it');
    assert.ok(ui.indexOf("t('秘术师能量')") < ui.indexOf(`t('${LABEL}')`), 'in the optional-rows block with the others');
  });

  test('the label and the hint are in every language pack', () => {
    for (const lang of ['en', 'ja', 'ko', 'zh-TW']) {
      const pack = JSON.parse(read(`public/i18n/${lang}.json`));
      for (const id of [LABEL, HINT]) assert.ok(typeof pack[id] === 'string' && pack[id].length > 0, `${lang}: ${id}`);
    }
    // the label is short enough for the row and the hint says what changes when it is off
    for (const lang of ['en', 'ja', 'ko', 'zh-TW']) {
      const pack = JSON.parse(read(`public/i18n/${lang}.json`));
      assert.ok(pack[LABEL].length <= 28, `${lang}: the label stays a row label`);
    }
  });
});

// ---- the wiring: off leaves the pre-#646 path ------------------------------------------------------------------------

describe('screens/game.js gates the deploy fold on the switch', () => {
  const game = read('public/js/screens/game.js');

  test('deployFold is false whenever the setting is off, whatever the interaction state', () => {
    assert.match(game, /const deployZoom = useSettings\(\)\.deployZoom !== false;/);
    assert.match(game, /const deployFold = deployZoom && deployFoldsShop\(\{/);
    // the gate is the setting only: the interaction inputs it is derived from are unchanged
    assert.match(game, /const deployFold = deployZoom && deployFoldsShop\(\{\n\s+ownPrep: !!view && viewModeRef\.current === 'prep' && showPrep, editable, pen, drag: !!drag, facing: !!facing,\n\s+\}\);/);
    // off ⇒ the two derived states are the player's own state alone, exactly as before PR #646
    assert.match(game, /const shopFolded = showShop && \(pen \? penRef\.current\.collapsed : \(collapsed \|\| deployFold\)\);/);
    assert.match(game, /const barCollapsed = collapsed \|\| deployFold;/);
    // and nothing else reads the switch: the settings read, the gate, and the note in the comment above them
    assert.equal((game.match(/deployZoom/gi) || []).length, 3, 'the settings read, the gate, the comment');
  });

  test('the camera effect keeps its deployFold branch (dead while the switch is off) and its foldCamera path', () => {
    const branch = game.indexOf('if (deployFold) {');
    assert.ok(branch > 0);
    // deployFold false reaches the pre-#646 foldCamera call, deferred while dragging exactly as it always was
    assert.match(game.slice(branch), /const next = foldCamera\(\{[\s\S]{0,300}?\n\s+pen, busy: !!drag \|\| !!facing, current: camRef\.current,\n\s+\}\);/);
    assert.match(game, /\}, \[view, deployFold, shopFolded, showPrep, pen, !!drag, !!facing, prepCamKey\]\);/);
  });
});

// ---- off is the pre-#646 camera path at the logic level ---------------------------------------------------------------

describe('with the setting off, every interaction state takes the pre-#646 camera decision', () => {
  const pl = (id) => ({ playerId: id, seat: 0, alive: true });
  const pub = { round: 6, bossRound: 14, hiddenRound: 15, players: [pl('a'), pl('b')] };

  test('deployZoom false ⇒ deployFold false for each state deployFoldsShop would otherwise fold', () => {
    const states = [
      { ownPrep: true, editable: true, pen: false, drag: true },
      { ownPrep: true, editable: true, pen: false, facing: true },
      { ownPrep: true, editable: true, pen: false, drag: true, facing: true },
    ];
    // the gate screens/game.js writes, read as it is: `deployZoom` true is the player's own value, false the switch off
    const gated = (setting, s) => (setting !== false) && deployFoldsShop(s);
    for (const s of states) {
      assert.equal(deployFoldsShop(s), true, `the feature itself still folds: ${JSON.stringify(s)}`);
      assert.equal(gated(true, s), true, `on: unchanged, still folds ${JSON.stringify(s)}`);
      assert.equal(gated(false, s), false, `off: never folds ${JSON.stringify(s)}`);
    }
  });

  test('the shop fold then follows the player\'s own 收起 state alone — the two framing options, nothing else', () => {
    const folded = prepCameraFor(pub, 'a', true);
    const open = prepCameraFor(pub, 'a', false);
    assert.deepEqual(folded, { kind: 'prep', opts: { rect: { ...GEO.NORMAL_RECT }, side: 'L', shop: false } });
    assert.deepEqual(open, { kind: 'prep', opts: { rect: { ...GEO.NORMAL_RECT }, side: 'L', shop: true } });
    // deployFold false: shopFolded is the player's own `collapsed`; a hand-made fold is still deferred mid-drag
    const cur = { kind: 'prep', opts: { rect: { ...GEO.NORMAL_RECT }, side: 'L', shop: true } };
    assert.equal(foldCamera({ pub, myId: 'a', ownPrep: true, folded: false, busy: true, current: cur }), null,
      'a hand-made fold stays deferred while a piece is dragged');
    assert.deepEqual(foldCamera({ pub, myId: 'a', ownPrep: true, folded: true, busy: false, current: cur }), folded,
      'and it flies once the interaction ends, as before PR #646');
  });
});
