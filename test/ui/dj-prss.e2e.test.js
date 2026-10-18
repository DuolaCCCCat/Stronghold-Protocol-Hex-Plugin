// 说不痛苦那是假的 (plugins/dj-prss) interface-plugin browser test. Not part of the default run.
//   SP_E2E=1 node --test test/ui/dj-prss.e2e.test.js
//
// Reaches 休整期 with ALL THREE bundled ui plugins switched on in this browser (`sp.pref.ui-plugins`): 粥友的酒
// (dj-wine, `hud.right`), 若不是你突然闯进我生活 (dj-amiya, `hud.left`) and this one (`hud.left2`), then checks what
// this plugin's design depends on:
//   1. the three slots do not share a plugin: all three pages are mounted at once, all three default to the play area's
//      bottom-left corner, they are vertically staggered (no pair overlaps), and none of them covers the corner buttons
//      or the shop bar; each button is the top hit target at its own centre;
//   2. this button is the ring and the prss GIF only — no visible name (the accessible name is an
//      `aria-label` a screenshot cannot see), while 粥友的酒 keeps its label. The GIF is checked by decoding it and,
//      where the browser has `ImageDecoder`, by its real frame count — never by two composited screenshots: in this
//      machine's Edge an iframe's animated GIF does not advance between screenshots (the trap in dj-amiya's test);
//   3. clicking it starts ITS music: the Web Audio graph runs (context running, position advancing, the Analyser sees
//      real energy), the decoded length is the new track's 39.869 s, the panel opens, the `units-gif` visual puts one
//      animated stand-in over every unit, the page asks the host for the `mix` strategy (every unit gets its own sheet)
//      and the host reports that strategy back, AND the host's `dj-rotate` visual turns the battle interface and the
//      pieces / enemies / items on the board;
//   4. while all of that is on, a real press on a piece still picks it and a real hand-card drag still deploys one;
//   5. `mix` is really per unit and stable: a fixed host seed puts BOTH sheets on the field at once (a screenshot of
//      the two GIFs side by side), one unit keeps its sheet from frame to frame, and the same seed reproduces the same
//      assignment while a new session rolls its own;
//   5b. the prss stand-in is drawn at 0.80× of the amiya2 one: the content box read out of each sheet, times the
//      bounds PIXI really draws it at, gives that ratio within ±0.03 — the ratio lives in the asset (prss.png at 0.80×
//      of amiya2's 84×96 content box), not in a per-variant factor in the renderer (see test/ui/dj-units.test.js for
//      the PNG-level check);
//   6. stopping / closing the panel puts everything back — the stand-in layer destroyed, every view shown again, every
//      field container at its own scale, the HUD class gone — and leaving the match puts the frames away;
//   6b. all three buttons share the host's night-club lighting (`effect: dj-neon`): each one alone puts ONE box up
//      (one screenshot each), two playing at once still show one box, one stopping leaves it on for the other (same
//      box and seed), and the last one stopping removes it whole (node, animation and computed styles back);
//   7. `prefers-reduced-motion: reduce` never enables it; with the plugin switched off its page is never requested.
// Do not run it from the sandbox; the integration pass runs it.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Client, OUT, ROOT, hasChrome, startRealServer } from '../e2e/client.mjs';
import { GIF_VARIANTS } from '../../public/js/render/unitsGif.js';

const ENABLED = process.env.SP_E2E === '1' && hasChrome();
const PLUGIN = path.join(ROOT, 'plugins/dj-prss');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const FRAME_RE = (id) => new RegExp(`/p/${id}/[0-9a-f]{8}/ui/index\\.html$`);
/** The entry page of one of the three bundled ui plugins. */
const frameOf = (c, id) => c.page.frames().find((f) => FRAME_RE(id).test(f.url()));
/** The track's length after the m4s → mp3 128k transcode (ffprobe 39.868730 s). */
const SONG_SECONDS = 39.8687;

async function reachPrep(c) {
  await c.enter('凯尔希');
  await c.page.waitForSelector('.lobby-screen', { timeout: 20000 });
  await c.click('.mode-card', '独立模拟');
  await c.click('.diff-card', '标准模拟');
  await c.click('.create-box button', '开始独立模拟');
  await c.waitFor((s) => !!s.room, 'solo room');
  if (!(await c.st()).phase) await c.click('.room-bar__right button', '开始模拟', { timeout: 20000 });
  await c.waitFor((s) => s.phase === 'INFO_CHECK', 'briefing', 30000);
  await c.click('.brief__foot .btn--primary', '准备就绪');
  await c.waitFor((s) => s.phase === 'BAND_DRAFT', 'band draft', 30000);
  await c.click('.dband', null, { nth: 1 });
  await c.click('.draft-detail__btns .btn--primary', '确认选择');
  await c.waitFor((s) => s.phase === 'PREP', 'prep', 60000);
}

const handOf = (c) => c.handPieces('chess');
const boardOf = (c) => c.boardPieces();

/** A real hand-card deploy: press the card, drag it onto a free legal tile, swipe the wheel. Returns the tile. */
async function deployFromHand(c, uid, dir = 'RIGHT') {
  const tile = await c.freeTileFor(uid);
  assert.ok(tile, `a legal free tile for hand card ${uid}`);
  const from = await c.piecePoint(uid);
  assert.ok(from, `hand card ${uid} is drawn on screen`);
  const to = await c.tilePoint(tile.row, tile.col);
  assert.ok(to, `tile ${tile.row},${tile.col} is on screen`);
  await c.drag(from, to);
  await c.page.waitForSelector('.fwheel__dia', { timeout: 6000 });
  await c.swipe(dir);
  await sleep(700);
  return tile;
}

describe('说不痛苦那是假的 (dj-prss) in hud.left2', { skip: !ENABLED }, () => {
  test('the third button mounts beside the other two, plays its own song, gives every unit its own stand-in sheet (mix), and restores everything', { timeout: 9 * 60 * 1000 }, async () => {
    assert.ok(fs.existsSync(path.join(PLUGIN, 'ui/index.html')), 'run node plugins-src/dj-prss/build-page.mjs first');
    // The server's own plugins/: the host gates every ui plugin on `content.plugins > 0`. The starter kit is handed to
    // the hand (no autoPlace), so a real hand-card drag can be made while the effects are on.
    const srv = await startRealServer({ fast: { timerScale: 1, combatSpeed: 2, startRound: 1 } });
    const P = (await import('puppeteer-core')).default;
    const c = new Client(P, srv.base, 'solo', { prefix: 'dj-prss', w: 1600, h: 900 });
    const errors = [];
    const frameRequests = [];
    const sheets = new Map();
    try {
      await c.open();
      c.page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
      c.page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
      c.page.on('request', (r) => { if (/\/p\/(dj-wine|dj-amiya|dj-prss)\//.test(r.url())) frameRequests.push(r.url()); });
      c.page.on('response', (r) => {
        const u = r.url();
        if (/\/img\/dj-units\/(amiya2|prss)\.png$/.test(u)) sheets.set(new URL(u).pathname, r.status());
      });

      // ---- switched off: this plugin's page is never requested, and no frame exists outside the match -------------
      await c.page.waitForSelector('.title-login input', { timeout: 20000 });
      assert.deepEqual(frameRequests, [], 'no plugin page is requested while all three are off');
      assert.equal(await c.page.evaluate(() => document.querySelector('iframe[src*="/p/"]') !== null), false,
        'the plugins run in iframes, so a plugin element cannot exist outside them');

      // ---- switched on: all three buttons mount in the match's three HUD slots ------------------------------------
      await c.page.evaluate(() => {
        localStorage.setItem('sp.pref.ui-plugins', JSON.stringify(['dj-wine', 'dj-amiya', 'dj-prss']));
        localStorage.removeItem('sp.name');
      });
      await c.page.reload({ waitUntil: 'domcontentloaded' });
      await c.page.waitForSelector('.screen', { timeout: 20000 });
      await reachPrep(c);
      await c.page.waitForSelector('[data-ui-slot="hud.right"] iframe', { timeout: 20000 });
      await c.page.waitForSelector('[data-ui-slot="hud.left"] iframe', { timeout: 20000 });
      await c.page.waitForSelector('[data-ui-slot="hud.left2"] iframe', { timeout: 20000 });
      const wine = frameOf(c, 'dj-wine');
      const amiya = frameOf(c, 'dj-amiya');
      const prss = frameOf(c, 'dj-prss');
      assert.ok(wine, '粥友的酒 is mounted in hud.right');
      assert.ok(amiya, 'the second button is mounted in hud.left');
      assert.ok(prss, 'this plugin is mounted in hud.left2');
      assert.equal(new Set([wine, amiya, prss]).size, 3, 'three plugins, three frames, three slots');
      for (const fr of [wine, amiya, prss]) await fr.waitForSelector('#btn', { timeout: 10000 });
      // each page places its own frame at the play area's bottom-left once the host answers; measure only when all did
      await wine.waitForFunction(() => window.__DJ__ && window.__DJ__.placed(), { timeout: 10000 });
      await amiya.waitForFunction(() => window.__AMIYA__ && window.__AMIYA__.placed(), { timeout: 10000 });
      await prss.waitForFunction(() => window.__PRSS__ && window.__PRSS__.placed(), { timeout: 10000 });
      for (const id of ['dj-wine', 'dj-amiya', 'dj-prss']) {
        assert.ok(frameRequests.some((u) => new RegExp(`/p/${id}/`).test(u)), `${id}'s page is requested once it is on`);
      }

      // ---- this button: the ring and the prss GIF only, no visible name -------------------------------------------
      const look = await prss.evaluate(() => {
        const btn = document.getElementById('btn');
        const gif = document.getElementById('gif');
        const r = btn.getBoundingClientRect();
        return {
          text: btn.textContent.replace(/\s+/g, ''),
          gifText: gif.textContent,
          labels: btn.querySelectorAll('.pr-btn__label, .pr-btn__badge').length,
          aria: btn.getAttribute('aria-label'),
          title: btn.getAttribute('title'),
          nw: gif.naturalWidth, nh: gif.naturalHeight,
          w: r.width, h: r.height,
          base: gif.src.slice(0, 30),
          htmlBg: getComputedStyle(document.documentElement).backgroundColor,
          scheme: getComputedStyle(document.documentElement).colorScheme,
        };
      });
      assert.equal(look.text, '', `the button shows no text at all (got ${JSON.stringify(look.text)})`);
      assert.equal(look.labels, 0, 'no label / badge element is left in the button');
      assert.equal(look.aria, '说不痛苦那是假的', 'the accessible name is still there (invisible)');
      assert.match(look.title, /点一下开始 DJ/, 'the tooltip says what it does');
      assert.match(look.base, /^data:image\/gif;base64,/, 'the button image is the inlined gif');
      assert.equal(look.nw, 128, 'the prss gif is the 128 px one');
      assert.equal(look.nh, 128);
      assert.ok(look.w > 40 && look.w < 110 && look.h > 40 && look.h < 110, `the button is a small icon (${look.w}x${look.h})`);
      assert.equal(look.htmlBg, 'rgba(0, 0, 0, 0)', 'the page is transparent');
      assert.match(look.scheme, /dark/, 'and declares a dark color-scheme (no white box)');
      const wineText = await wine.evaluate(() => document.getElementById('btn').textContent.replace(/\s+/g, ''));
      assert.match(wineText, /粥友的酒/, '粥友的酒 keeps its visible name (that plugin is unchanged)');

      // the GIF decodes and is the inlined 70-frame one. NOT a screenshot-diff: in this machine's Edge the iframe's
      // animated GIF does not advance between two composited screenshots, so a pixel diff would prove nothing (that is
      // the known trap in test/ui/dj-amiya.e2e.test.js). `ImageDecoder` reads the real frame count where it exists.
      const gifInfo = await prss.evaluate(async () => {
        const gif = document.getElementById('gif');
        let decoded = false;
        try { await gif.decode(); decoded = true; } catch { decoded = false; }
        let frames = null;
        try {
          if (typeof ImageDecoder === 'function') {
            const b64 = gif.src.split(',')[1] || '';
            const bin = atob(b64);
            const u8 = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
            const dec = new ImageDecoder({ data: u8, type: 'image/gif' });
            await dec.tracks.ready;
            frames = dec.tracks.selectedTrack ? dec.tracks.selectedTrack.frameCount : 0;
            dec.close();
          }
        } catch { frames = null; }
        return { decoded, nw: gif.naturalWidth, nh: gif.naturalHeight, srcLen: gif.src.length, frames };
      });
      assert.equal(gifInfo.decoded, true, 'the inlined prss gif decodes to a real bitmap');
      assert.equal(gifInfo.nw, 128, 'the prss gif is the 128 px one');
      assert.equal(gifInfo.nh, 128);
      assert.ok(gifInfo.srcLen > 370000, `the gif is the inlined 287 KB file, not a placeholder (${gifInfo.srcLen} base64 chars)`);
      if (gifInfo.frames !== null) assert.ok(gifInfo.frames > 1, `the gif really has multiple frames (${gifInfo.frames})`);

      // ---- three buttons: bottom-left, vertically staggered, clear of the corner keys and the shop bar -------------
      const iconBox = async (id) => {
        const o = await c.page.evaluate((id) => {
          const f = document.querySelector(`[data-ui-slot="${id}"] iframe`);
          const r = f.getBoundingClientRect();
          return { x: r.left, y: r.top };
        }, id);
        const frame = id === 'hud.right' ? wine : id === 'hud.left' ? amiya : prss;
        const b = await frame.evaluate(() => {
          const r = document.getElementById('btn').getBoundingClientRect();
          return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
        });
        return { left: o.x + b.left, top: o.y + b.top, right: o.x + b.right, bottom: o.y + b.bottom };
      };
      const overlaps = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
      const boxes = {
        'hud.right': await iconBox('hud.right'),
        'hud.left': await iconBox('hud.left'),
        'hud.left2': await iconBox('hud.left2'),
      };
      const corner = await c.page.evaluate(() => {
        const el = document.querySelector('.gm__corner');
        const r = el.getBoundingClientRect();
        return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
      });
      const shop = await c.page.evaluate(() => {
        const el = document.querySelector('.shopbar');
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, w: r.width, h: r.height };
      });
      for (const [slot, box] of Object.entries(boxes)) {
        assert.ok(box.left < 200, `${slot} defaults to the left edge (left ${Math.round(box.left)})`);
        assert.ok(box.top > 450, `${slot} defaults to the bottom (top ${Math.round(box.top)})`);
        assert.equal(overlaps(box, corner), false, `${slot} leaves the corner keys clear`);
        assert.ok(Math.abs(box.left - corner.left) < 40, `${slot} lines up with the corner keys`);
        if (shop && shop.w > 0 && shop.h > 0) assert.equal(overlaps(box, shop), false, `${slot} leaves the shop bar clear`);
        // the button is the top hit target at its own centre: the slot's iframe, never something drawn over it
        const hit = await c.page.evaluate((pt) => {
          const el = document.elementFromPoint(pt.x, pt.y);
          return el && el.tagName === 'IFRAME' ? (el.dataset.plugin || '') : (el ? el.tagName : '');
        }, { x: (box.left + box.right) / 2, y: (box.top + box.bottom) / 2 });
        assert.equal(hit, slot === 'hud.right' ? 'dj-wine' : slot === 'hud.left' ? 'dj-amiya' : 'dj-prss',
          `${slot} is not covered at its centre (hit ${hit})`);
      }
      const order = [
        ['dj-wine', boxes['hud.right']],
        ['dj-amiya', boxes['hud.left']],
        ['dj-prss', boxes['hud.left2']],
      ].sort((a, b) => a[1].top - b[1].top).map(([id]) => id);
      assert.deepEqual(order, ['dj-prss', 'dj-amiya', 'dj-wine'], 'the three are vertically staggered: prss on top, then amiya, then wine');
      assert.equal(overlaps(boxes['hud.right'], boxes['hud.left']), false, 'dj-wine and dj-amiya never overlap');
      assert.equal(overlaps(boxes['hud.left'], boxes['hud.left2']), false, 'dj-amiya and dj-prss never overlap');
      assert.equal(overlaps(boxes['hud.right'], boxes['hud.left2']), false, 'dj-wine and dj-prss never overlap');
      await c.page.screenshot({ path: path.join(OUT, 'dj-prss-three-buttons.png') });

      // ---- one real deploy first, so the field has a container whose own numbers must come back later -------------
      const hand0 = await handOf(c);
      assert.ok(hand0.length >= 2, `the starter kit is in the hand (${hand0.length} cards)`);
      const firstTile = await deployFromHand(c, hand0[0].uid);
      const board1 = await boardOf(c);
      assert.equal(board1.length, 1, 'the first card is on the board');
      assert.deepEqual([board1[0].row, board1[0].col], [firstTile.row, firstTile.col]);

      const gifState = () => c.page.evaluate(() => globalThis.__SP_VIEW__.raw.stats().unitsGif);
      const fieldState = () => c.page.evaluate(() => {
        const R = globalThis.__SP_VIEW__.raw;
        const PARTS = ['root', 'hud', 'shadow', 'facingArrow', 'blockIcon', 'gfx', 'plate'];
        return {
          world: R.debug.ctx.layers.units.parent.children.length,
          views: [...R.debug.views.entries()].map(([k, v]) => ({
            k: String(k), culled: !!v.culled,
            shown: PARTS.some((p) => v[p] && v[p].visible) || !!(v.box && v.box.mesh && v.box.mesh.visible),
            x: v.root ? Math.round(v.root.position.x) : null, y: v.root ? Math.round(v.root.position.y) : null, z: v.root ? v.root.zIndex : null,
          })),
        };
      });
      const waitGif = (on) => c.page.waitForFunction((want) => {
        const g = globalThis.__SP_VIEW__.raw.stats().unitsGif;
        return !!g && g.on === want && (want ? g.sprites > 0 : g.sprites === 0);
      }, { timeout: 20000 }, on);
      const hiddenKeys = (s) => s.views.filter((v) => !v.culled && !v.shown).map((v) => v.k);
      /** The three roots the canvas half of `dj-rotate` writes: their own scale / rotation before the effect. */
      const rootsNow = () => c.page.evaluate(() => {
        const R = globalThis.__SP_VIEW__.raw;
        const out = [];
        for (const [k, v] of R.debug.views) {
          if (!v || v.destroyed || !v.root || !v.root.scale) continue;
          out.push({ k: String(k), sx: v.root.scale.x, sy: v.root.scale.y, rot: v.root.rotation });
        }
        out.sort((a, b) => (a.k < b.k ? -1 : a.k > b.k ? 1 : 0));
        return out;
      });
      const djState = () => c.page.evaluate(() => globalThis.__SP_VIEW__.raw.stats().djRotate);
      const djParts = () => c.page.evaluate(() => {
        const hud = document.querySelector('.gm__hud');
        const dj = (el) => (el.getAnimations ? el.getAnimations() : []).filter((a) => a.animationName && a.animationName.indexOf('gm-dj') === 0);
        const parts = [...hud.querySelectorAll('*')].filter((el) => dj(el).length > 0);
        return { cls: hud.classList.contains('is-dj-rotate'), parts: parts.length, scale: parts.slice(0, 4).map((el) => getComputedStyle(el).scale).join('|') };
      });
      /** The stand-in layer's sprites and the one sheet they all draw from (baseTexture texture-cache id = its URL). */
      const standIns = () => c.page.evaluate(() => {
        const R = globalThis.__SP_VIEW__.raw;
        const units = R.debug.ctx.layers.units;
        const world = units.parent;
        const layer = world.children[world.getChildIndex(units) + 1];
        if (!layer || !layer.children) return { n: 0, sheets: [] };
        const ids = [];
        for (const spr of layer.children) {
          const bt = spr.texture && spr.texture.baseTexture;
          const cache = bt && bt.textureCacheIds;
          ids.push(cache && cache.length ? cache[0] : null);
        }
        return { n: layer.children.length, sheets: [...new Set(ids.filter(Boolean))] };
      });

      assert.equal(await gifState(), null, 'nothing of the effect exists before it is asked for');
      assert.equal(await djState(), null, 'the canvas half of dj-rotate does not exist before it is asked for');
      const base = await fieldState();
      const baseRoots = await rootsNow();
      assert.ok(base.views.length >= 1, 'the deployed piece is on the field');

      // ---- click it: its own song plays, the units become per-unit stand-ins, the interface turns --------------------
      await prss.click('#btn');
      await prss.waitForFunction(() => window.__PRSS__ && window.__PRSS__.isPlaying(), { timeout: 15000 });
      await waitGif(true);
      await sleep(1200);
      const a = await prss.evaluate(() => ({
        playing: window.__PRSS__.isPlaying(), ctx: window.__PRSS__.ctxState(),
        pos: window.__PRSS__.position(), dur: window.__PRSS__.duration(),
        energy: window.__PRSS__.energy(), open: window.__PRSS__.panelOpen(),
        strategy: window.__PRSS__.strategy(),
      }));
      assert.equal(a.playing, true, 'playing after the click');
      assert.equal(a.ctx, 'running', 'the AudioContext is running');
      assert.ok(Math.abs(a.dur - SONG_SECONDS) < 0.05, `the NEW song decoded (${a.dur.toFixed(3)} s, the mp3 is 39.869 s)`);
      assert.ok(a.energy > 0, `the analyser sees real signal (energy ${a.energy})`);
      assert.equal(a.open, true, 'the panel opened');
      assert.equal(a.strategy, 'mix', 'the page asks the host for the per-unit `mix` strategy');
      const gifOn = await gifState();
      assert.equal(gifOn.on, true, 'the units-gif visual is on');
      assert.equal(gifOn.strategy, 'mix', 'the host reports the strategy the page sent, not a single sheet');
      assert.equal(gifOn.sprites, base.views.length, 'one stand-in per unit view');
      // every unit is assigned one of the two sheets — by the host, per unit
      const SHEETS = { amiya2: '/img/dj-units/amiya2.png', prss: '/img/dj-units/prss.png' };
      assert.deepEqual(Object.keys(gifOn.picks).sort(), base.views.map((v) => v.k).sort(), 'every live view has its own pick');
      for (const [k, v] of Object.entries(gifOn.picks)) assert.ok(SHEETS[v], `unit ${k} draws a known sheet (${v})`);
      assert.equal(Math.max(...[gifOn.frames.amiya2, gifOn.frames.prss]), 70, 'the sheet(s) in use have their 70 frames');
      const si = await standIns();
      assert.equal(si.n, base.views.length, 'the stand-in layer draws one sprite per unit');
      for (const u of si.sheets) assert.ok(Object.values(SHEETS).includes(u), `every stand-in draws a host sheet (${u})`);
      assert.equal(si.sheets.length, new Set(Object.values(gifOn.picks)).size, 'the layer draws exactly the sheets the picks name');
      assert.deepEqual(hiddenKeys(await fieldState()), base.views.map((v) => v.k), 'every unit view is hidden behind its stand-in');
      const frameA = (await gifState()).frame;
      const picksA = gifOn.picks;
      await sleep(350);
      const after350 = await gifState();
      assert.notEqual(frameA, after350.frame, `the stand-ins are animating (${frameA} → ${after350.frame})`);
      // the pick is per unit and does NOT follow the animation clock: the same key keeps its sheet frame after frame
      assert.deepEqual(after350.picks, picksA, 'each unit keeps its sheet from frame to frame (no per-frame flicker)');
      const turned = await djParts();
      assert.equal(turned.cls, true, 'this plugin turns the battle interface too');
      assert.ok(turned.parts >= 6, `the HUD's parts are animating (${turned.parts})`);
      const djA = await djState();
      assert.equal(djA.on, true, 'and the canvas half is on: the pieces / enemies / items on the board turn');
      assert.ok(djA.containers >= baseRoots.length, `every field view is transformed (${djA.containers})`);
      const ratioA = (await rootsNow()).map((v) => {
        const b = baseRoots.find((x) => x.k === v.k);
        return b && b.sx !== 0 ? v.sx / b.sx : null;
      });
      assert.equal(ratioA.every((x) => x !== null), true, 'every field view has a baseline');
      assert.ok(Math.max(...ratioA) - Math.min(...ratioA) < 1e-9, 'one factor for every unit');
      assert.ok(Math.abs(ratioA[0] - 1) > 0.01, `the units are really turned / squashed (${ratioA[0].toFixed(3)})`);
      await c.page.screenshot({ path: path.join(OUT, 'dj-prss-units-amiya2-a.png') });
      await sleep(350);
      await c.page.screenshot({ path: path.join(OUT, 'dj-prss-units-amiya2-b.png') });

      // ---- while all of that is on: a real hand-card drag still deploys ------------------------------------------
      const hand1 = await handOf(c);
      assert.ok(hand1.length >= 1, 'a card is still in the hand');
      const secondTile = await deployFromHand(c, hand1[0].uid);
      const board2 = await boardOf(c);
      assert.equal(board2.length, 2, 'the second card deployed while the effects were on');
      const second = board2.find((p) => p.row === secondTile.row && p.col === secondTile.col);
      assert.ok(second, 'it stands on the tile it was dropped on');
      // a hand card that moves to the board is still one view, so the sprite count may not grow: what matters is that
      // every live view has its stand-in and that the unit just deployed is hidden behind one.
      const gif2 = await gifState();
      assert.equal(gif2.on, true, 'the effect stays on across the deploy');
      assert.equal(gif2.sprites, gif2.views, `one stand-in per live view (${gif2.sprites} of ${gif2.views})`);
      const si2 = await standIns();
      assert.equal(si2.n, gif2.sprites, 'the layer draws one sprite per live view');
      for (const u of si2.sheets) assert.ok(Object.values(SHEETS).includes(u), 'still host sheets, one per unit');
      for (const [k, v] of Object.entries(picksA)) assert.equal(gif2.picks[k], v, `unit ${k} kept its sheet across the deploy`);
      assert.equal(Object.keys(gif2.picks).length, gif2.sprites, 'the unit just deployed got its own pick too');
      const newView = await c.page.evaluate((uid) => {
        const R = globalThis.__SP_VIEW__.raw;
        const v = R.debug.views.get('p:' + uid) || [...R.debug.views.values()].find((x) => x.uid === uid || x.info?.uid === uid);
        if (!v) return null;
        const PARTS = ['hud', 'shadow', 'facingArrow', 'blockIcon', 'gfx', 'plate'];
        return { key: String(v.uid ?? '?'), shown: PARTS.some((p) => v[p] && v[p].visible), culled: !!v.culled };
      }, second.uid);
      assert.ok(newView, 'the unit deployed while it was on has a view');
      assert.equal(newView.shown, false, 'and its stand-in stands in for it (every part hidden)');
      const secondKey = await c.page.evaluate((uid) => {
        const R = globalThis.__SP_VIEW__.raw;
        for (const [k, v] of R.debug.views) if (v.uid === uid || v.info?.uid === uid) return String(k);
        return null;
      }, second.uid);
      assert.ok(secondKey, 'the deployed card has a view key');

      // ---- a real press on a turning piece still picks it ----------------------------------------------------------
      const aim = await c.page.evaluate(() => {
        const raw = globalThis.__SP_VIEW__.raw;
        for (const v of raw.debug.views.values()) {
          if (!v.root || !v.placed || v.culled || !v.info || v.info.kind === 'device') continue;
          const x = Math.round(v.screen.x), y = Math.round(v.screen.y);
          const el = document.elementFromPoint(x, y);
          if (!el || el.tagName !== 'CANVAS') continue;
          const hit = raw.debug.pick.pieceAt(x, y);
          if (!hit) continue;
          return { x, y, uid: String(hit.uid ?? hit.id ?? ''), kind: v.info.kind };
        }
        return null;
      });
      assert.ok(aim, 'a piece can be aimed at while the field turns and the units are stand-ins');
      await c.page.mouse.click(aim.x, aim.y);
      const picked = await c.page.waitForSelector('.uframe', { timeout: 4000 }).then(() => true, () => false);
      assert.equal(picked, true, `a real press on the turning piece (${aim.x},${aim.y}, ${aim.kind}) selects it`);
      await c.page.keyboard.press('Escape');
      await sleep(250);
      assert.equal((await gifState()).on, true, 'the stand-ins survived the pick (the panel is DOM, not the field)');
      assert.equal((await djState()).on, true, 'and the field is still turning');

      // ---- stopping: its music, its effect and the units all come back ---------------------------------------------
      await prss.evaluate(() => window.__PRSS__.stop());
      await prss.waitForFunction(() => window.__PRSS__ && !window.__PRSS__.isPlaying(), { timeout: 10000 });
      await waitGif(false);
      const after = await fieldState();
      assert.equal(after.world, base.world, 'the stand-in layer is destroyed (as many world children as before)');
      assert.deepEqual(hiddenKeys(after), [], 'every unit shows itself again');
      for (const bv of base.views) {
        const nv = after.views.find((v) => v.k === bv.k);
        assert.ok(nv, `the view that was on the field before ${bv.k} is still there`);
        // the unit deployed while the effect was on legitimately moved (hand → board): its own numbers are not the
        // before-effect ones, so the exact restore is checked for every other view
        if (bv.k === secondKey) { assert.equal(nv.shown, true, `the unit deployed while it was on shows itself again (${bv.k})`); continue; }
        assert.deepEqual([nv.culled, nv.shown, nv.x, nv.y, nv.z], [bv.culled, bv.shown, bv.x, bv.y, bv.z],
          `view ${bv.k}: culling / visibility / position / depth are exactly what they were`);
      }
      assert.ok(after.views.length >= base.views.length, 'the unit deployed while it was on is still on the field, shown');
      assert.equal((await djParts()).cls, false, 'the interface is back (no class)');
      assert.equal(((await djState()) || {}).on === true, false, 'the canvas half is off');
      const backRoots = await rootsNow();
      for (const b of baseRoots) {
        const n = backRoots.find((x) => x.k === b.k);
        assert.ok(n, `piece ${b.k} is still on the field`);
        assert.deepEqual([n.sx, n.sy, n.rot], [b.sx, b.sy, b.rot], `piece ${b.k} is back at its own scale and rotation (not 1)`);
      }

      // ---- `mix` really puts two sheets on the field, per unit and stable ------------------------------------------
      // The host's pick is `pickVariant(viewKey, sessionSeed)` (public/js/render/unitsGif.js) — a pure function, so a
      // fixed seed reproduces a session and a mixed field (both GIFs at once) can be found without waiting on luck.
      const startSession = async (seed) => {
        if (seed != null) await c.page.evaluate((n) => globalThis.__SP_VIEW__.raw.debug.unitsGif.setSeed(n), seed);
        await prss.evaluate(() => window.__PRSS__.start());
        await prss.waitForFunction(() => window.__PRSS__.isPlaying(), { timeout: 10000 });
        await c.page.waitForFunction(() => {
          const g = globalThis.__SP_VIEW__.raw.stats().unitsGif;
          return !!g && g.on && g.counts.amiya2 + g.counts.prss > 0;
        }, { timeout: 15000 });
        return gifState();
      };
      const stopSession = async () => {
        await prss.evaluate(() => window.__PRSS__.stop());
        await prss.waitForFunction(() => !window.__PRSS__.isPlaying(), { timeout: 10000 });
        await waitGif(false);
      };
      let mixed = null;
      for (let seed = 1; seed <= 20 && !mixed; seed++) {
        const st = await startSession(seed);
        if (st.counts.amiya2 > 0 && st.counts.prss > 0) { mixed = { seed, ...st }; break; }
        await stopSession();
      }
      assert.ok(mixed, 'a fixed seed puts BOTH sheets on the field at once (the two GIFs interleave)');
      const flavours = [...new Set(Object.values(mixed.picks))].sort();
      assert.deepEqual(flavours, ['amiya2', 'prss'], `one unit draws amiya2 and another prss (${flavours.join(', ')})`);
      assert.equal(mixed.counts.amiya2 + mixed.counts.prss, mixed.sprites, 'every stand-in draws one of the two sheets');
      const mixSheets = (await standIns()).sheets.slice().sort();
      assert.deepEqual(mixSheets, ['/img/dj-units/amiya2.png', '/img/dj-units/prss.png'], 'both sheets are really drawn in the same frame');
      await c.page.screenshot({ path: path.join(OUT, 'dj-prss-units-mix.png') });

      // ---- the prss stand-in is 0.80× of the amiya2 one: the sheets set the size, not the renderer ------------------
      // `prss.png` first filled 96×96 of its 96 px frame against amiya2's 84×96 — the two source GIFs were cropped to
      // the same frame but not to the same content scale — and was then squeezed to that 84×96 content box (sx =
      // 84/96, feet row kept). The owner then asked for a prss GIF that READS smaller on the board: the sheet is 0.80×
      // of that box now (~67×76 of art; 25 % was the first try, judged too much), so on one tile a prss stand-in is
      // drawn at 0.80× of an amiya2 one. The renderer has no per-variant factor (that would need a table in
      // render/unitsGif.js and one more number to tune per sheet) — the ratio is in the PNG. So this reads the content
      // box out of each sheet as the browser has it and converts it to pixels with the bounds PIXI really draws a
      // stand-in at: both halves have to hold — the frame every stand-in is scaled to (getBounds) and the content each
      // sheet fills of it.
      const sheetBox = (url) => c.page.evaluate(async (u) => {
        // The sheet the renderer has already loaded — a second `new Image()` would fetch it again and the cached answer
        // (304) would overwrite the 200 this test checks further down.
        const R = globalThis.__SP_VIEW__.raw;
        const units = R.debug.ctx.layers.units;
        const world = units.parent;
        const layer = world.children[world.getChildIndex(units) + 1];
        const table = { cols: 10, cell: 112, inset: 8, size: 96, count: 70 };
        let img = null;
        for (const spr of layer.children) {
          const bt = spr.texture && spr.texture.baseTexture;
          if (!bt || !bt.textureCacheIds || bt.textureCacheIds.indexOf(u) < 0) continue;
          img = bt.resource && bt.resource.source;
          break;
        }
        if (!img) return null;
        if (img.decode) { try { await img.decode(); } catch { /* already decoded */ } }
        const cv = document.createElement('canvas');
        cv.width = img.naturalWidth || img.width;
        cv.height = img.naturalHeight || img.height;
        const g = cv.getContext('2d');
        g.drawImage(img, 0, 0);
        const px = g.getImageData(0, 0, cv.width, cv.height).data;
        let x0 = Infinity; let y0 = Infinity; let x1 = -1; let y1 = -1;
        for (let i = 0; i < table.count; i += 1) {
          const ox = (i % table.cols) * table.cell + table.inset;
          const oy = Math.floor(i / table.cols) * table.cell + table.inset;
          for (let y = 0; y < table.size; y += 1) {
            for (let x = 0; x < table.size; x += 1) {
              // alpha > 8: above the 4/255 anti-aliasing fringe the source crop left on the frame border
              if (px[(((oy + y) * cv.width) + ox + x) * 4 + 3] <= 8) continue;
              if (x < x0) x0 = x;
              if (x > x1) x1 = x;
              if (y < y0) y0 = y;
              if (y > y1) y1 = y;
            }
          }
        }
        return { w: x1 - x0 + 1, h: y1 - y0 + 1, x: x0, y: y0 };
      }, url);
      const sheetBoxes = { amiya2: await sheetBox(SHEETS.amiya2), prss: await sheetBox(SHEETS.prss) };
      assert.ok(sheetBoxes.amiya2 && sheetBoxes.prss, 'both sheets are in the renderer when the box is measured');
      // the ratio the owner asked for: the prss art is 0.80× of amiya2's in the PNG itself. 0.03 is the tolerance the
      // PNG-level check (test/ui/dj-units.test.js) uses too: the alpha box moves by a pixel with the resample.
      const RATIO = 0.80;
      for (const [axis, key] of [['width', 'w'], ['height', 'h']]) {
        const a = sheetBoxes.amiya2[key];
        const p = sheetBoxes.prss[key];
        assert.ok(Math.abs(p / a - RATIO) <= 0.03,
          `the prss sheet fills 0.80× the ${axis} of the amiya2 sheet (amiya2 ${a} px, prss ${p} px, ratio ${(p / a).toFixed(4)})`);
      }
      // every stand-in on the field, with the bounds PIXI really draws it at and the scale it chose
      const standInSizes = () => c.page.evaluate(() => {
        const R = globalThis.__SP_VIEW__.raw;
        const units = R.debug.ctx.layers.units;
        const world = units.parent;
        const layer = world.children[world.getChildIndex(units) + 1];
        if (!layer || !layer.children) return [];
        return layer.children.map((spr) => {
          const bt = spr.texture && spr.texture.baseTexture;
          const cache = bt && bt.textureCacheIds;
          const b = spr.getBounds();
          return {
            sheet: cache && cache.length ? cache[0] : null,
            bw: b.width, bh: b.height, sx: Math.abs(spr.scale.x), sy: Math.abs(spr.scale.y),
          };
        });
      });
      const sizes = await standInSizes();
      assert.ok(sizes.length >= 2, `both stand-ins are on the field (${sizes.length})`);
      // The frame is the same 96 px picture for both sheets and the renderer scales it by ONE rule — `h / size`, with
      // `size` = 96 for both — so a stand-in's bounds are that frame times its own tile's scale. A per-variant factor
      // (the alternative the maintainer refused: normalise the renderer instead of the art) would show up here as
      // bounds / 96 ≠ the sprite's own scale.
      for (const s of sizes) {
        const asset = GIF_VARIANTS[s.sheet === SHEETS.prss ? 'prss' : 'amiya2'];
        assert.ok(Math.abs(s.bw - asset.size * s.sx) <= 0.01 && Math.abs(s.bh - asset.size * s.sy) <= 0.01,
          `${s.sheet}: the stand-in is one 96 px frame at its own scale (${s.bw.toFixed(2)}x${s.bh.toFixed(2)} for scale ${s.sx.toFixed(3)}x${s.sy.toFixed(3)})`);
        assert.ok(Math.abs(s.bw - s.bh) <= 0.5, `${s.sheet}: the frame is square (${s.bw.toFixed(1)}x${s.bh.toFixed(1)})`);
      }
      // Two units stand on tiles drawn at different sizes (the isometric depth scale), so the comparison is made at
      // ONE frame size — the first stand-in's — which is exactly what the two sheets would be drawn at side by side.
      const refW = sizes[0].bw;
      const refH = sizes[0].bh;
      const drawn = (/** @type {'amiya2'|'prss'} */ v) => {
        assert.ok(sizes.some((s) => s.sheet === SHEETS[v]), `a ${v} stand-in is on the field`);
        const asset = GIF_VARIANTS[v];
        return { w: (sheetBoxes[v].w / asset.size) * refW, h: (sheetBoxes[v].h / asset.size) * refH };
      };
      const drawnA = drawn('amiya2');
      const drawnP = drawn('prss');
      assert.ok(Math.abs(drawnP.w / drawnA.w - RATIO) <= 0.03,
        `the prss stand-in is drawn 0.80× the width of an amiya2 one at one frame size (amiya2 ${drawnA.w.toFixed(1)} px, prss ${drawnP.w.toFixed(1)} px, ratio ${(drawnP.w / drawnA.w).toFixed(4)})`);
      assert.ok(Math.abs(drawnP.h / drawnA.h - RATIO) <= 0.03,
        `and 0.80× its height (amiya2 ${drawnA.h.toFixed(1)} px, prss ${drawnP.h.toFixed(1)} px, ratio ${(drawnP.h / drawnA.h).toFixed(4)})`);
      // one screenshot of the two of them side by side, for the human reading the log
      const pair = await c.page.evaluate(() => {
        const R = globalThis.__SP_VIEW__.raw;
        const g = R.stats().unitsGif;
        const pts = [...R.debug.views.entries()]
          .filter(([k, v]) => v.placed && !v.culled && v.screen && g.picks[String(k)])
          .map(([k, v]) => ({ k: String(k), x: v.screen.x, y: v.screen.y, pick: g.picks[String(k)] }));
        let best = null;
        for (const a of pts.filter((p) => p.pick === 'amiya2')) {
          for (const b of pts.filter((p) => p.pick === 'prss')) {
            const d = Math.hypot(a.x - b.x, a.y - b.y);
            if (d < 1 || d > 320) continue;
            if (!best || d < best.d) best = { a, b, d };
          }
        }
        return best;
      });
      if (pair) {
        const vp = c.page.viewport() || { width: 1600, height: 900 };
        const pad = 110;
        const left = Math.max(0, Math.min(pair.a.x, pair.b.x) - pad);
        const top = Math.max(0, Math.min(pair.a.y, pair.b.y) - pad - 30);
        const clip = {
          x: left,
          y: top,
          width: Math.min(vp.width - left, Math.abs(pair.a.x - pair.b.x) + pad * 2),
          height: Math.min(vp.height - top, Math.abs(pair.a.y - pair.b.y) + pad + 40),
        };
        await c.page.screenshot({ path: path.join(OUT, 'dj-prss-units-mix-size.png'), clip });
      }
      await sleep(400);
      const mixLater = await gifState();
      assert.deepEqual(mixLater.picks, mixed.picks, 'the mixed field is stable: no unit switches sheets mid-session');
      assert.equal(mixLater.strategy, 'mix');
      await stopSession();
      assert.equal((await fieldState()).world, base.world, 'the mixed session left no layer behind');

      // the same seed reproduces the same per-unit assignment: the choice belongs to the host, not to a page roll
      const seeded = await startSession(5);
      const seededPicks = seeded.picks;
      await sleep(300);
      assert.deepEqual((await gifState()).picks, seededPicks, 'one unit keeps one sheet for the whole session');
      await stopSession();
      const seeded2 = await startSession(5);
      assert.deepEqual(seeded2.picks, seededPicks, 'the same seed reproduces the same assignment');
      await stopSession();
      assert.ok(sheets.get('/img/dj-units/amiya2.png') === 200, 'the amiya2 sheet really loaded in a real browser (200)');
      assert.ok(sheets.get('/img/dj-units/prss.png') === 200, 'and so did the prss sheet (200)');

      // ---- closing the panel of this plugin leaves no residue ------------------------------------------------------
      await prss.evaluate(() => window.__PRSS__.toggle());
      await prss.waitForFunction(() => window.__PRSS__.isPlaying(), { timeout: 10000 });
      await prss.waitForFunction(() => window.__PRSS__.panelOpen(), { timeout: 10000 });
      await waitGif(true);
      await sleep(300);
      // The host clamps a placed frame to the play area and the plugin moves its own frame when the panel opens; after
      // the many start/stop sessions above the frame's resize message can lag behind the throttled message budget, so
      // the ✕ can sit just outside the iframe's box. Clicking it in the plugin's DOM is the same close handler and is
      // what this step is about (closePanel's release path), not a hit-test of the host's frame.
      await prss.evaluate(() => document.getElementById('close').click());
      await sleep(300);
      assert.equal(await prss.evaluate(() => window.__PRSS__.panelOpen()), false, 'the panel is closed');
      assert.equal(await prss.evaluate(() => window.__PRSS__.isPlaying()), true, 'the music may keep playing');
      assert.equal(((await djState()) || {}).on === true, false, 'closing the panel turns the field back');
      assert.equal((await djParts()).cls, false, 'and the interface back');
      await prss.evaluate(() => window.__PRSS__.stop());
      await waitGif(false);

      // ---- ONE night-club lighting for three buttons: accounted per plugin, never stacked ---------------------------
      // All three bundled DJ plugins ask the host for `effect: dj-neon` (docs/PLUGINS.md §14) while their music plays.
      // The box is the host's own; what this block checks is the ACCOUNTING — the host keeps one box while any of the
      // three wants it, keeps it up when one stops while another still wants it, and removes it whole (node gone, no
      // animation left, every computed style back) once the last one lets go. It fails if the host stacked a second
      // box for a second plugin or released the box of a plugin still playing.
      const neon = () => c.page.evaluate(() => {
        const roots = document.querySelectorAll('.gm__neon');
        const parts = [...document.querySelectorAll('.gm__neon, .gm__neon *')];
        return {
          roots: roots.length,
          edge: document.querySelectorAll('.gm__neon__edge').length,
          blobs: document.querySelectorAll('.gm__neon__blob').length,
          seed: roots[0] ? roots[0].dataset.seed : null,
          anims: parts.reduce((n, el) => n + (el.getAnimations ? el.getAnimations().length : 0), 0),
        };
      });
      /** The screen's own computed styles, field by field: the off has to put every one of them back. */
      const plainLook = () => c.page.evaluate(() => {
        const pick = (sel) => {
          const el = sel === 'body' ? document.body : document.querySelector(sel);
          if (!el) return null;
          const cs = getComputedStyle(el);
          const o = {};
          for (const p of ['transform', 'opacity', 'filter', 'scale', 'zIndex', 'display', 'position', 'backgroundColor', 'maskImage', 'animationName']) o[p] = cs[p];
          return o;
        };
        const screen = document.querySelector('.screen.gm');
        return {
          screen: pick('.screen.gm'), hud: pick('.gm__hud'), field: pick('.gm__field'), body: pick('body'),
          screenInline: screen ? screen.getAttribute('style') : null,
          bodyInline: document.body.getAttribute('style'),
          hudClass: (document.querySelector('.gm__hud') || {}).className || null,
        };
      });
      const lookBeforeNeon = await plainLook();
      assert.equal((await neon()).roots, 0, 'no neon box is up before any of the three buttons plays');
      /** The plugin's own toggle (its pointer-up handler runs the same function; the panel of a lower button can cover
       *  a higher button while it is open — a real, deliberately allowed overlap — so this section drives the handler). */
      const clickBtn = (fr, handle) => fr.evaluate((h) => window[h].toggle(), handle);
      /** Each of the three pages and its own read-only handle. */
      const BUTTONS = [
        ['dj-wine', wine, '__DJ__', 'dj-neon-wine.png'],
        ['dj-amiya', amiya, '__AMIYA__', 'dj-neon-amiya.png'],
        ['dj-prss', prss, '__PRSS__', 'dj-neon-prss.png'],
      ];
      for (const [id, fr, handle, shot] of BUTTONS) {
        await clickBtn(fr, handle);
        await fr.waitForFunction((h) => window[h] && window[h].isPlaying(), { timeout: 15000 }, handle);
        // `>= 1`, not `=== 1`: the count itself is asserted below, so a host that stacks a box fails on the message
        // that says what went wrong instead of on a bare wait timeout
        await c.page.waitForFunction(() => document.querySelectorAll('.gm__neon').length >= 1, { timeout: 8000 });
        // the box fades in over 0.9 s and the blobs flash on their own cycles: let it reach full strength before the
        // screenshot, so the picture really shows the lighting (and not a 10 %-opacity first frame)
        await sleep(1200);
        const one = await neon();
        assert.equal(one.roots, 1, `${id}: its button puts up exactly ONE host neon box`);
        assert.equal(one.edge, 1, `${id}: the rim layer is there`);
        assert.ok(one.blobs >= 4 && one.blobs <= 8, `${id}: with 4–8 blobs (${one.blobs})`);
        assert.ok(one.anims >= 6, `${id}: and the stylesheet animations run (${one.anims})`);
        await c.page.screenshot({ path: path.join(OUT, shot) });
        await clickBtn(fr, handle);
        await fr.waitForFunction((h) => window[h] && !window[h].isPlaying(), { timeout: 15000 }, handle);
        await c.page.waitForFunction(() => document.querySelectorAll('.gm__neon').length === 0, { timeout: 8000 });
      }
      // two of them playing at once: the host still keeps ONE box (no second copy of the layers), and one stopping
      // while the other still wants it leaves it on — same box, same seed, still animating
      await clickBtn(wine, '__DJ__');
      await wine.waitForFunction(() => window.__DJ__.isPlaying(), { timeout: 15000 });
      await clickBtn(prss, '__PRSS__');
      await prss.waitForFunction(() => window.__PRSS__.isPlaying(), { timeout: 15000 });
      await c.page.waitForFunction(() => document.querySelectorAll('.gm__neon').length >= 1, { timeout: 8000 });
      await sleep(1200);
      const both = await neon();
      assert.equal(both.roots, 1, 'two DJ plugins playing at once still show ONE neon box (the host accounts per plugin)');
      assert.equal(both.edge, 1, 'one rim, not two');
      assert.ok(both.blobs >= 4 && both.blobs <= 8, `one set of blobs (${both.blobs}), not a stack of two boxes`);
      await c.page.screenshot({ path: path.join(OUT, 'dj-neon-two.png') });
      await clickBtn(wine, '__DJ__');
      await wine.waitForFunction(() => !window.__DJ__.isPlaying(), { timeout: 15000 });
      await sleep(250);
      const oneLeft = await neon();
      assert.equal(oneLeft.roots, 1, 'one of the two stops: the box stays up for the plugin that still wants it');
      assert.equal(oneLeft.seed, both.seed, 'and it is the same box (not rebuilt, not re-randomised under it)');
      assert.ok(oneLeft.anims >= 6, `still animating (${oneLeft.anims})`);
      assert.equal(await prss.evaluate(() => window.__PRSS__.isPlaying()), true, 'the other button is still playing');
      await c.page.screenshot({ path: path.join(OUT, 'dj-neon-one-left.png') });
      await clickBtn(prss, '__PRSS__');
      await prss.waitForFunction(() => !window.__PRSS__.isPlaying(), { timeout: 15000 });
      await c.page.waitForFunction(() => document.querySelectorAll('.gm__neon').length === 0, { timeout: 8000 });
      const gone = await neon();
      assert.equal(gone.roots, 0, 'the last one lets go: the box is removed whole');
      assert.equal(gone.edge, 0, 'no layer survives it');
      assert.equal(gone.anims, 0, 'and no gm-neon animation is left running');
      const lookAfterNeon = await plainLook();
      const neonDiff = [];
      for (const key of ['screen', 'hud', 'field', 'body']) {
        for (const p of Object.keys(lookBeforeNeon[key] || {})) {
          if ((lookBeforeNeon[key] || {})[p] !== (lookAfterNeon[key] || {})[p]) neonDiff.push(`${key}.${p}: ${lookBeforeNeon[key][p]} -> ${lookAfterNeon[key][p]}`);
        }
      }
      assert.deepEqual(neonDiff, [], `every computed style is what it was before (${neonDiff.length} changed)`);
      assert.equal(lookAfterNeon.screenInline, lookBeforeNeon.screenInline, 'no inline style was left on the match screen');
      assert.equal(lookAfterNeon.bodyInline, lookBeforeNeon.bodyInline, 'no inline style was left on the body');
      assert.equal(lookAfterNeon.hudClass, lookBeforeNeon.hudClass, 'and the HUD class is exactly what it was');

      // ---- reduced motion: never enabled --------------------------------------------------------------------------
      await c.page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
      const reducedBase = await rootsNow();
      await prss.evaluate(() => window.__PRSS__.toggle());
      await prss.waitForFunction(() => window.__PRSS__.isPlaying(), { timeout: 10000 });
      await sleep(900);
      assert.equal((await gifState()).on, false, 'reduced motion leaves the stand-ins off');
      assert.equal(hiddenKeys(await fieldState()).length, 0, 'and no unit is hidden');
      assert.equal((await djParts()).cls, false, 'nor is the interface turned');
      assert.equal(((await djState()) || {}).on === true, false, 'nor the field');
      const reducedNow = await rootsNow();
      const written = reducedBase.filter((bb) => { const n = reducedNow.find((x) => x.k === bb.k); return n && (n.sx !== bb.sx || n.sy !== bb.sy); });
      assert.deepEqual(written, [], 'and no container scale was written');
      await prss.evaluate(() => window.__PRSS__.stop());
      await c.page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);

      // ---- leaving the match: all three frames are parked (hidden), nothing is left on screen ----------------------
      await c.page.evaluate(() => { const btn = [...document.querySelectorAll('button')].find((x) => (x.getAttribute('aria-label') || '').includes('离开')); if (btn) btn.click(); });
      await sleep(600);
      await c.page.evaluate(() => {
        const box = document.querySelector('.modal__box');
        const btn = box && [...box.querySelectorAll('button')].find((x) => (x.className || '').includes('btn--primary') || (x.className || '').includes('btn--danger'));
        if (btn) btn.click();
      });
      await sleep(3000);
      const left = await c.page.evaluate(() => {
        const frames = [...document.querySelectorAll('iframe[src*="/p/"]')];
        const park = document.getElementById('sp-ui-park');
        return {
          screenCls: [...document.querySelectorAll('.screen')].map((s) => s.className).join(' | '),
          slots: document.querySelectorAll('[data-ui-slot="hud.right"], [data-ui-slot="hud.left"], [data-ui-slot="hud.left2"]').length,
          frames: frames.length,
          visible: frames.some((f) => f.getBoundingClientRect().width > 1),
          inPark: frames.every((f) => park && park.contains(f)),
          parkHidden: !!park && (park.hidden || park.getAttribute('aria-hidden') === 'true'),
        };
      });
      assert.match(left.screenCls, /lobby-screen/, 'the match screen was actually left');
      assert.equal(left.slots, 0, 'all three HUD slots are gone with the match');
      assert.equal(left.frames, 3, 'the three frames are still there, parked');
      assert.equal(left.visible, false, 'no plugin button is visible off the match');
      assert.equal(left.inPark, true, 'the host parked the frames instead of dropping them');
      assert.equal(left.parkHidden, true, 'and the park is hidden');

      assert.deepEqual(errors, [], 'no console/page errors');
    } finally {
      await c.close();
      await srv.stop();
    }
  });
});
