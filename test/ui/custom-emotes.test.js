// Custom emote packs (added 2026-10-18): two 交流 pages after the official six, their committed
// art under public/img/emotes/ (the official battle-emote size, 120×120), the wire whitelist and the guarantee that
// the official tables (EMOTE_THEMES / EMOTES / data/emotes.json) are untouched. Browser behaviour is covered by
// test/ui/emotes.e2e.test.js and the watch-emote suite (test/ui/watch-emote.test.js).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  EMOTES, EMOTE_THEMES, EMOTE_CATALOG, EMOTE_WHEEL_THEMES, CUSTOM_EMOTE_THEMES, CUSTOM_EMOTE_CATALOG,
  SENDABLE_EMOTES, isSendableEmote, emoteInfo, emoteArtPath, emoteArtGroup,
} from '../../shared/constants.js';
import { validateC2S } from '../../shared/protocol.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ART_DIR = path.join(ROOT, 'public/img/emotes');
const readJson = (rel) => JSON.parse(readFileSync(path.join(ROOT, rel), 'utf8'));

/** Dimensions and animation flag of a WebP file (VP8X, VP8L or VP8 — all Pillow writes here are VP8X). */
function webpInfo(file) {
  const b = readFileSync(file);
  assert.equal(b.subarray(0, 4).toString(), 'RIFF', `${file}: RIFF`);
  assert.equal(b.subarray(8, 12).toString(), 'WEBP', `${file}: WEBP`);
  const kind = b.subarray(12, 16).toString();
  if (kind === 'VP8X') {
    return { w: 1 + b.readUIntLE(24, 3), h: 1 + b.readUIntLE(27, 3), animated: !!(b[20] & 0x02) };
  }
  if (kind === 'VP8L') {
    const bits = b.readUInt32LE(21);
    return { w: (bits & 0x3fff) + 1, h: ((bits >> 14) & 0x3fff) + 1, animated: false };
  }
  assert.equal(kind, 'VP8 ', `${file}: a WebP bitstream`);
  return { w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff, animated: false };
}

describe('custom emote catalog', () => {
  test('two custom pages follow the official six; the official tables stay official-only', () => {
    assert.deepEqual(CUSTOM_EMOTE_THEMES.map((t) => t.themeId), ['emoticon_custom_amiya', 'emoticon_custom_qq']);
    assert.deepEqual(EMOTE_WHEEL_THEMES.map((t) => t.themeId),
      [...EMOTE_THEMES.map((t) => t.themeId), ...CUSTOM_EMOTE_THEMES.map((t) => t.themeId)]);
    assert.equal(EMOTE_THEMES.length, 6, 'the official wheel pages are not edited');
    assert.equal(EMOTES.length, 36);
    assert.equal(EMOTE_CATALOG.length, 36);
    assert.equal(EMOTE_WHEEL_THEMES.length, 8);
    assert.equal(CUSTOM_EMOTE_CATALOG.length, 7, 'four QQ pictures + three Amiya / Priestess animations');
    for (const t of CUSTOM_EMOTE_THEMES) {
      assert.ok(t.emotes.length >= 1 && t.emotes.length <= 6, `${t.themeId}: fits one 3×2 page`);
      assert.ok(t.sortId > 1065, `${t.themeId}: after every official theme`);
      for (const e of t.emotes) assert.ok(e.sortId > 1065, e.id);
    }
    const ids = SENDABLE_EMOTES;
    assert.deepEqual(ids, [...EMOTES, ...CUSTOM_EMOTE_CATALOG.map((e) => e.id)]);
    assert.equal(new Set(ids).size, 43, '36 official + 7 custom, no duplicates');
    for (const id of CUSTOM_EMOTE_CATALOG.map((e) => e.id)) {
      assert.match(id, /^custom_[a-z0-9_]+$/);
      assert.ok(!EMOTES.includes(id), `${id} is not an official id`);
      assert.equal(emoteInfo(id)?.id, id);
      assert.equal(isSendableEmote(id), true);
    }
    for (const id of EMOTES) assert.equal(isSendableEmote(id), true, id);
    assert.equal(isSendableEmote('happy'), false);
    assert.equal(isSendableEmote('__proto__'), false);
    assert.equal(isSendableEmote(null), false);
    assert.ok(Object.isFrozen(CUSTOM_EMOTE_THEMES) && Object.isFrozen(CUSTOM_EMOTE_THEMES[0].emotes));
  });

  test('the wire accepts the custom ids (g.emote { id }) and nothing else', () => {
    for (const e of CUSTOM_EMOTE_CATALOG) assert.equal(validateC2S({ t: 'g.emote', id: e.id }), null, e.id);
    for (const id of ['custom_nope', 'autochess_room_hello', 'happy', '', 7, null]) {
      assert.notEqual(validateC2S({ t: 'g.emote', id }), null, String(id));
    }
  });

  test('each custom emote has one committed picture URL and no manifest group', () => {
    for (const e of CUSTOM_EMOTE_CATALOG) {
      assert.equal(e.art, emoteArtPath(e.id), e.id);
      assert.match(e.art, /^\/img\/emotes\/[a-z0-9_]+\.webp$/);
      assert.equal(emoteArtGroup(e.id), null, `${e.id}: not a local-client / mirror group`);
      assert.equal(emoteInfo(e.id).themeId, e.themeId);
      assert.ok(e.label, `${e.id}: an aria-label`);
    }
    assert.equal(emoteArtPath('nope'), null);
    assert.equal(emoteArtGroup('nope'), null);
  });

  test('the official data/emotes.json is untouched by the custom packs', () => {
    const doc = readJson('data/emotes.json');
    assert.equal(doc.themes.length, 6);
    assert.deepEqual(doc.themes.map((t) => t.themeId), EMOTE_THEMES.map((t) => t.themeId));
    assert.equal(doc.emotes.length, 36);
    for (const e of doc.emotes) assert.ok(!String(e.id).startsWith('custom_'), e.id);
  });
});

describe('custom emote art (public/img/emotes)', () => {
  test('every picture exists, is 120×120 like the official basic emotes, and stays small', () => {
    const files = readdirSync(ART_DIR).filter((f) => f.endsWith('.webp')).sort();
    assert.deepEqual(files, CUSTOM_EMOTE_CATALOG.map((e) => path.basename(e.art)).sort(), 'the folder and the catalog agree');
    const official = path.join(ROOT, 'public/assets/local/emoticon/basic/pic_happy_battle.png');
    for (const e of CUSTOM_EMOTE_CATALOG) {
      const file = path.join(ROOT, 'public', e.art);
      assert.ok(existsSync(file), file);
      const info = webpInfo(file);
      assert.deepEqual([info.w, info.h], [120, 120], `${e.id}: the official battle-emote plate (120×120)`);
      assert.ok(statSync(file).size <= 160 * 1024, `${e.id}: ${statSync(file).size} bytes`);
    }
    if (existsSync(official)) {
      const png = readFileSync(official);
      assert.equal(png.readUInt32BE(16), 120, 'the official basic emote art is 120 wide');
      assert.equal(png.readUInt32BE(20), 120, 'the official basic emote art is 120 high');
    }
  });

  test('the GIF-derived pictures animate, the two stills do not', () => {
    const animated = new Set(['custom_amiya_sit', 'custom_amiya_cheer', 'custom_prss_smug', 'custom_qq_cat_wow', 'custom_qq_cat_no']);
    for (const e of CUSTOM_EMOTE_CATALOG) {
      assert.equal(webpInfo(path.join(ROOT, 'public', e.art)).animated, animated.has(e.id), e.id);
    }
  });

  test('the asset README names every file and credits the sources, with no local paths', () => {
    const readme = readFileSync(path.join(ART_DIR, 'README.md'), 'utf8');
    assert.match(readme, /疚刃/);
    assert.match(readme, /QQ/);
    for (const e of CUSTOM_EMOTE_CATALOG) assert.ok(readme.includes(path.basename(e.art)), `${path.basename(e.art)} in the README`);
    assert.doesNotMatch(readme, /[A-Z]:[\\/]/);
  });
});
