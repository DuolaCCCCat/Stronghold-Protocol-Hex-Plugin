// 粥友的酒 2 (plugins/dj-wine-2) interface-plugin browser test. Not part of the default run.
//   SP_E2E=1 node --test test/ui/dj-wine-2.e2e.test.js
//
// Reaches 休整期 with ALL FOUR bundled ui plugins switched on in this browser (`sp.pref.ui-plugins`): 粥友的酒
// (dj-wine, `hud.right`), 若不是你突然闯进我生活 (dj-amiya, `hud.left`), 说不痛苦那是假的 (dj-prss, `hud.left2`) and
// this one (`hud.left3`), then checks what the fourth button's design depends on:
//   1. the four slots do not share a plugin: all four pages are mounted at once, all four default to the play area's
//      bottom-left corner, they are vertically staggered (no pair overlaps), and none covers the corner keys or the
//      shop bar; each button is the top hit target at its own centre;
//   2. this button is the Amiya GIF ALONE — no visible name, no ring, no ♪ badge and no breathing animation (the
//      accessible name stays invisible), while 粥友的酒 keeps its label;
//   3. clicking it starts ITS song: the Web Audio graph runs (context running, position advancing, the Analyser sees
//      real energy), the decoded length is 粥友的酒's 30.047 s, the progress starts at 0 rather than resuming, and the
//      panel says 「粥友的酒 2」 / 「DJ-Amiya」;
//   4. the three host visuals come on together: `dj-neon` (the host's neon box: rim rainbow + 4–8 blobs,
//      `pointer-events: none`), `dj-rotate` (the HUD's parts turn and the field containers are transformed), and
//      `units-gif` with the fixed `strategy: 'amiya'` — every unit draws the FIRST Amiya sheet
//      (`/img/dj-units/amiya.png`, 27 frames), not the Amiya2 (70 frames) or Prss sheet;
//   5. stopping puts every one of them back — the stand-in layer destroyed, the neon box removed, the HUD class gone,
//      every field container at its own scale, the progress at 0 — and closing the panel / leaving the match release
//      them too; `prefers-reduced-motion: reduce` never enables any of them;
//   6. with the plugin switched off its page is never requested, and the whole run has no console/page errors.
// The four-button screenshot and the stand-in screenshots are written to test/e2e/out/.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Client, OUT, ROOT, hasChrome, startRealServer } from '../e2e/client.mjs';

const ENABLED = process.env.SP_E2E === '1' && hasChrome();
const PLUGIN = path.join(ROOT, 'plugins/dj-wine-2');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const FRAME_RE = (id) => new RegExp(`/p/${id}/[0-9a-f]{8}/ui/index\\.html$`);
const frameOf = (c, id) => c.page.frames().find((f) => FRAME_RE(id).test(f.url()));
/** 粥友的酒's length after its m4s → mp3 transcode (ffprobe 30.046673 s). */
const SONG_SECONDS = 30.0466;
const SHEETS = { amiya2: '/img/dj-units/amiya2.png', prss: '/img/dj-units/prss.png', amiya: '/img/dj-units/amiya.png' };

async function reachPrep(c) {
  await c.enter('凯尔希');
  await c.page.waitForSelector('.lobby-screen', { timeout: 20000 });
  await c.click('.mode-card', '独立模拟');
  await c.click('.diff-card', '标准模拟');
  await c.click('.create-box button', '开始独立模拟');
  await c.waitFor((s) => !!s.room, 'solo room');
  if (!(await c.st().phase)) await c.click('.room-bar__right button', '开始模拟', { timeout: 20000 });
  await c.waitFor((s) => s.phase === 'INFO_CHECK', 'briefing', 30000);
  await c.click('.brief__foot .btn--primary', '准备就绪');
  await c.waitFor((s) => s.phase === 'BAND_DRAFT', 'band draft', 30000);
  await c.click('.dband', null, { nth: 1 });
  await c.click('.draft-detail__btns .btn--primary', '确认选择');
  await c.waitFor((s) => s.phase === 'PREP', 'prep', 60000);
}

describe('粥友的酒 2 (dj-wine-2) in hud.left3', { skip: !ENABLED }, () => {
  test('the fourth button joins the stack, plays its song with neon + the first Amiya stand-ins, and restores everything', { timeout: 8 * 60 * 1000 }, async () => {
    assert.ok(fs.existsSync(path.join(PLUGIN, 'ui/index.html')), 'run node plugins-src/dj-wine-2/build-page.mjs first');
    // The server's own plugins/: the starter kit is placed on the board (autoPlace), so the field has units whose
    // stand-ins the effect can replace.
    const srv = await startRealServer({ fast: { timerScale: 1, combatSpeed: 2, startRound: 1, autoPlace: true } });
    const P = (await import('puppeteer-core')).default;
    const c = new Client(P, srv.base, 'solo', { prefix: 'dj-wine-2', w: 1600, h: 900 });
    const errors = [];
    const frameRequests = [];
    try {
      await c.open();
      c.page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
      c.page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
      c.page.on('request', (r) => { if (/\/p\/(dj-wine|dj-amiya|dj-prss|dj-wine-2)\//.test(r.url())) frameRequests.push(r.url()); });

      // ---- switched off: this plugin's page is never requested, and no frame exists outside the match ---------------
      await c.page.waitForSelector('.title-login input', { timeout: 20000 });
      assert.deepEqual(frameRequests, [], 'no plugin page is requested while all four are off');
      assert.equal(await c.page.evaluate(() => document.querySelector('iframe[src*="/p/"]') !== null), false,
        'the plugins run in iframes, so a plugin element cannot exist outside them');

      // ---- switched on: all four buttons mount in the match's four HUD slots ---------------------------------------
      await c.page.evaluate(() => {
        localStorage.setItem('sp.pref.ui-plugins', JSON.stringify(['dj-wine', 'dj-amiya', 'dj-prss', 'dj-wine-2']));
        localStorage.removeItem('sp.name');
      });
      await c.page.reload({ waitUntil: 'domcontentloaded' });
      await c.page.waitForSelector('.screen', { timeout: 20000 });
      await reachPrep(c);
      const SLOTS = ['hud.right', 'hud.left', 'hud.left2', 'hud.left3'];
      for (const slot of SLOTS) await c.page.waitForSelector(`[data-ui-slot="${slot}"] iframe`, { timeout: 20000 });
      const wine = frameOf(c, 'dj-wine');
      const amiya = frameOf(c, 'dj-amiya');
      const prss = frameOf(c, 'dj-prss');
      const w2 = frameOf(c, 'dj-wine-2');
      assert.ok(wine, '粥友的酒 is mounted in hud.right');
      assert.ok(amiya, 'the second button is mounted in hud.left');
      assert.ok(prss, 'the third button is mounted in hud.left2');
      assert.ok(w2, 'this plugin is mounted in hud.left3');
      assert.equal(new Set([wine, amiya, prss, w2]).size, 4, 'four plugins, four frames, four slots');
      for (const fr of [wine, amiya, prss, w2]) await fr.waitForSelector('#btn', { timeout: 10000 });
      // each page places its own frame at the play area's bottom-left once the host answers; measure only when all did
      await wine.waitForFunction(() => window.__DJ__ && window.__DJ__.placed(), { timeout: 10000 });
      await amiya.waitForFunction(() => window.__AMIYA__ && window.__AMIYA__.placed(), { timeout: 10000 });
      await prss.waitForFunction(() => window.__PRSS__ && window.__PRSS__.placed(), { timeout: 10000 });
      await w2.waitForFunction(() => window.__WINE2__ && window.__WINE2__.placed(), { timeout: 10000 });
      for (const id of ['dj-wine', 'dj-amiya', 'dj-prss', 'dj-wine-2']) {
        assert.ok(frameRequests.some((u) => new RegExp(`/p/${id}/`).test(u)), `${id}'s page is requested once it is on`);
      }

      // ---- this button: the GIF alone, no ring / label / badge / breathing animation ------------------------------
      const look = await w2.evaluate(() => {
        const btn = document.getElementById('btn');
        const gif = document.getElementById('gif');
        const r = btn.getBoundingClientRect();
        const cs = getComputedStyle(btn);
        return {
          text: btn.textContent.replace(/\s+/g, ''),
          labels: btn.querySelectorAll('.dj-btn__label, .dj-btn__badge').length,
          ring: btn.querySelectorAll('.dj-btn__ring').length,
          aria: btn.getAttribute('aria-label'),
          title: btn.getAttribute('title'),
          nw: gif.naturalWidth, nh: gif.naturalHeight,
          w: r.width, h: r.height,
          base: gif.src.slice(0, 30),
          anim: cs.animationName,
          htmlBg: getComputedStyle(document.documentElement).backgroundColor,
          scheme: getComputedStyle(document.documentElement).colorScheme,
        };
      });
      assert.equal(look.text, '', `the button shows no text at all (got ${JSON.stringify(look.text)})`);
      assert.equal(look.labels, 0, 'no label / badge element is in the button');
      assert.equal(look.ring, 0, 'and no decorative ring element');
      assert.equal(look.aria, '粥友的酒 2', 'the accessible name is still there (invisible)');
      assert.match(look.title, /点一下开始 DJ/, 'the tooltip says what it does');
      assert.match(look.base, /^data:image\/gif;base64,/, 'the button image is the inlined gif');
      assert.equal(look.nw, 128, 'the Amiya gif is the 128 px one');
      assert.equal(look.nh, 128);
      assert.equal(look.anim, 'none', 'no breathing / spin ornament on the plain button');
      assert.ok(look.w > 40 && look.w < 80 && look.h > 40 && look.h < 80, `the plain button is a small icon (${look.w}x${look.h})`);
      assert.equal(look.htmlBg, 'rgba(0, 0, 0, 0)', 'the page is transparent');
      assert.match(look.scheme, /dark/, 'and declares a dark color-scheme (no white box)');
      const wineText = await wine.evaluate(() => document.getElementById('btn').textContent.replace(/\s+/g, ''));
      assert.match(wineText, /粥友的酒/, '粥友的酒 keeps its visible name (that plugin is unchanged)');

      // ---- four buttons: bottom-left, vertically staggered, clear of the corner keys and the shop bar --------------
      const iconBox = async (slot, frame) => {
        const o = await c.page.evaluate((slot) => {
          const f = document.querySelector(`[data-ui-slot="${slot}"] iframe`);
          const r = f.getBoundingClientRect();
          return { x: r.left, y: r.top };
        }, slot);
        const b = await frame.evaluate(() => {
          const r = document.getElementById('btn').getBoundingClientRect();
          return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
        });
        return { left: o.x + b.left, top: o.y + b.top, right: o.x + b.right, bottom: o.y + b.bottom };
      };
      const overlaps = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
      const boxes = {
        'hud.right': await iconBox('hud.right', wine),
        'hud.left': await iconBox('hud.left', amiya),
        'hud.left2': await iconBox('hud.left2', prss),
        'hud.left3': await iconBox('hud.left3', w2),
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
        assert.ok(box.top > 300, `${slot} defaults to the bottom (top ${Math.round(box.top)})`);
        assert.equal(overlaps(box, corner), false, `${slot} leaves the corner keys clear`);
        assert.ok(Math.abs(box.left - corner.left) < 40, `${slot} lines up with the corner keys`);
        if (shop && shop.w > 0 && shop.h > 0) assert.equal(overlaps(box, shop), false, `${slot} leaves the shop bar clear`);
        const hit = await c.page.evaluate((pt) => {
          const el = document.elementFromPoint(pt.x, pt.y);
          return el && el.tagName === 'IFRAME' ? (el.dataset.plugin || '') : (el ? el.tagName : '');
        }, { x: (box.left + box.right) / 2, y: (box.top + box.bottom) / 2 });
        assert.equal(hit, slot === 'hud.right' ? 'dj-wine' : slot === 'hud.left' ? 'dj-amiya' : slot === 'hud.left2' ? 'dj-prss' : 'dj-wine-2',
          `${slot} is not covered at its centre (hit ${hit})`);
      }
      const order = Object.entries(boxes).sort((a, b) => a[1].top - b[1].top).map(([slot]) => slot);
      assert.deepEqual(order, ['hud.left3', 'hud.left2', 'hud.left', 'hud.right'],
        'the four are vertically staggered: wine 2 on top, then prss, amiya, wine');
      const slots = Object.keys(boxes);
      for (let i = 0; i < slots.length; i++) {
        for (let j = i + 1; j < slots.length; j++) {
          assert.equal(overlaps(boxes[slots[i]], boxes[slots[j]]), false, `${slots[i]} and ${slots[j]} never overlap`);
        }
      }
      await c.page.screenshot({ path: path.join(OUT, 'dj-wine-2-four-buttons.png') });

      // ---- click it: its song, the neon box, the turned interface and the first Amiya stand-ins --------------------
      const gifState = () => c.page.evaluate(() => globalThis.__SP_VIEW__.raw.stats().unitsGif);
      const djState = () => c.page.evaluate(() => globalThis.__SP_VIEW__.raw.stats().djRotate);
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
      const djParts = () => c.page.evaluate(() => {
        const hud = document.querySelector('.gm__hud');
        const dj = (el) => (el.getAnimations ? el.getAnimations() : []).filter((a) => a.animationName && a.animationName.indexOf('gm-dj') === 0);
        const parts = [...hud.querySelectorAll('*')].filter((el) => dj(el).length > 0);
        return { cls: hud.classList.contains('is-dj-rotate'), parts: parts.length, scale: parts.slice(0, 4).map((el) => getComputedStyle(el).scale).join('|') };
      });
      const neonBits = () => c.page.evaluate(() => {
        const el = document.querySelector('.gm__neon');
        if (!el) return null;
        const cs = getComputedStyle(el);
        return {
          pointer: cs.pointerEvents, z: cs.zIndex,
          edge: !!el.querySelector('.gm__neon__edge'), rainbow: !!el.querySelector('.gm__neon__rainbow'),
          blobs: el.querySelectorAll('.gm__neon__blob').length,
          anims: el.getAnimations ? el.getAnimations().length : 0,
        };
      });
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

      assert.equal(await gifState(), null, 'nothing of units-gif exists before it is asked for');
      assert.equal(await djState(), null, 'the canvas half of dj-rotate does not exist before it is asked for');
      assert.equal(await neonBits(), null, 'no neon box exists before it is asked for');
      const base = await fieldState();
      const baseRoots = await rootsNow();
      assert.ok(base.views.length > 0, 'the auto-placed units are on the field');

      await w2.evaluate(() => window.__WINE2__.toggle());
      await w2.waitForFunction(() => window.__WINE2__.isPlaying(), { timeout: 15000 });
      await waitGif(true);
      await sleep(1100);
      const a = await w2.evaluate(() => ({
        playing: window.__WINE2__.isPlaying(), ctx: window.__WINE2__.ctxState(),
        pos: window.__WINE2__.position(), dur: window.__WINE2__.duration(),
        energy: window.__WINE2__.energy(), open: window.__WINE2__.panelOpen(),
        progress: window.__WINE2__.progressWidth(), clock: window.__WINE2__.clockText(),
      }));
      assert.equal(a.playing, true, 'playing after the click');
      assert.equal(a.ctx, 'running', 'the AudioContext is running');
      assert.ok(Math.abs(a.dur - SONG_SECONDS) < 0.05, `粥友的酒 decoded (${a.dur.toFixed(3)} s, the mp3 is 30.047 s)`);
      assert.ok(a.energy > 0, `the analyser sees real signal (energy ${a.energy})`);
      assert.equal(a.open, true, 'the panel opened');
      assert.match(a.clock, /^00:0[0-1] \//, `the progress starts at 00:00 (${a.clock})`);
      assert.ok(a.pos < 2, `the position starts this playback at 0 (${a.pos.toFixed(2)} s)`);
      const panel = await w2.evaluate(() => ({
        title: document.querySelector('.dj-panel__title').textContent,
        name: document.querySelector('.dj-deck__name').textContent,
        by: document.querySelector('.dj-deck__by').textContent,
      }));
      assert.match(panel.title, /粥友的酒 2/, 'the panel names the fourth button');
      assert.equal(panel.name, '粥友的酒 2');
      assert.equal(panel.by.trim(), 'DJ-Amiya', 'the panel and plugin.json are signed DJ-Amiya');

      // the neon box: one host-owned decorative layer, no pointer capture, 4–8 blobs, its fade-in running
      const neon = await neonBits();
      assert.ok(neon, 'dj-neon put its box on the body');
      assert.equal(neon.pointer, 'none', 'the neon box never takes a click');
      assert.equal(neon.z, '2', 'above the screen (1) and below the dialogs');
      assert.equal(neon.edge, true, 'the rim layer is there');
      assert.equal(neon.rainbow, true, 'the rainbow layer is there');
      assert.ok(neon.blobs >= 4 && neon.blobs <= 8, `4–8 coloured blobs (${neon.blobs})`);
      assert.ok(neon.anims > 0, 'the box is animating');
      await c.page.screenshot({ path: path.join(OUT, 'dj-wine-2-neon.png') });

      // the interface turns (dj-rotate)
      const turned = await djParts();
      assert.equal(turned.cls, true, 'the fourth button turns the battle interface');
      assert.ok(turned.parts >= 6, `the HUD's parts are animating (${turned.parts})`);
      const djA = await djState();
      assert.equal(djA.on, true, 'and the canvas half is on: the pieces / enemies / items on the board turn');
      const ratioA = (await rootsNow()).map((v) => {
        const b = baseRoots.find((x) => x.k === v.k);
        return b && b.sx !== 0 ? v.sx / b.sx : null;
      });
      assert.equal(ratioA.every((x) => x !== null), true, 'every field view has a baseline');
      assert.ok(Math.abs(ratioA[0] - 1) > 0.01, `the units are really turned / squashed (${ratioA[0].toFixed(3)})`);

      // the units: every one draws the FIRST Amiya sheet, not amiya2 and not prss
      const g = await gifState();
      assert.equal(g.on, true, 'the units-gif visual is on');
      assert.equal(g.strategy, 'amiya', 'the host reports the fixed strategy the page sent');
      assert.equal(g.frames.amiya, 27, 'the first Amiya sheet has its 27 frames');
      assert.equal(g.frames.amiya2, 0, 'the Amiya2 sheet is not even loaded for this session');
      assert.equal(g.frames.prss, 0, 'nor the Prss sheet');
      assert.equal(g.sprites, base.views.length, 'one stand-in per unit view');
      assert.equal(g.counts.amiya, g.sprites, 'every stand-in draws the amiya sheet');
      for (const [key, pick] of Object.entries(g.picks)) assert.equal(pick, 'amiya', `unit ${key} draws the first Amiya sheet`);
      const si = await standIns();
      assert.equal(si.n, g.sprites, 'the stand-in layer draws one sprite per view');
      assert.deepEqual(si.sheets, [SHEETS.amiya], `every stand-in draws from the one first-Amiya sheet (${si.sheets.join(', ')})`);
      assert.deepEqual(hiddenKeys(await fieldState()), base.views.map((v) => v.k), 'every unit view is hidden behind its stand-in');
      const frameA = g.frame;
      await sleep(400);
      const frameB = (await gifState()).frame;
      assert.notEqual(frameA, frameB, `the stand-ins are animating (${frameA} → ${frameB})`);
      await c.page.screenshot({ path: path.join(OUT, 'dj-wine-2-units-amiya-a.png') });
      await sleep(400);
      await c.page.screenshot({ path: path.join(OUT, 'dj-wine-2-units-amiya-b.png') });

      // ---- stopping: music, neon, rotation and the units all come back ----------------------------------------------
      await w2.evaluate(() => window.__WINE2__.stop());
      await w2.waitForFunction(() => !window.__WINE2__.isPlaying(), { timeout: 10000 });
      await waitGif(false);
      assert.equal(await neonBits(), null, 'stopping removes the neon box whole');
      assert.equal((await djParts()).cls, false, 'the interface is back (no class)');
      assert.equal(((await djState()) || {}).on === true, false, 'the canvas half is off');
      const after = await fieldState();
      assert.equal(after.world, base.world, 'the stand-in layer is destroyed (as many world children as before)');
      assert.deepEqual(hiddenKeys(after), [], 'every unit shows itself again');
      assert.deepEqual(after.views, base.views, 'culling / visibility / positions / depth are exactly what they were');
      const backRoots = await rootsNow();
      for (const b of baseRoots) {
        const n = backRoots.find((x) => x.k === b.k);
        assert.ok(n, `piece ${b.k} is still on the field`);
        assert.deepEqual([n.sx, n.sy, n.rot], [b.sx, b.sy, b.rot], `piece ${b.k} is back at its own scale and rotation (not 1)`);
      }
      const stopped = await w2.evaluate(() => ({ pos: window.__WINE2__.position(), progress: window.__WINE2__.progressWidth(), clock: window.__WINE2__.clockText() }));
      assert.equal(stopped.pos, 0, 'the progress is back to 0 when stopped');
      assert.equal(stopped.progress, 0, 'and the progress bar is empty');
      assert.match(stopped.clock, /^00:00 \//, `the clock reads 00:00 (${stopped.clock})`);

      // ---- start again: the progress does not resume the previous playback ------------------------------------------
      await w2.evaluate(() => window.__WINE2__.toggle());
      await w2.waitForFunction(() => window.__WINE2__.isPlaying(), { timeout: 10000 });
      await waitGif(true);
      await sleep(150);
      const restarted = await w2.evaluate(() => ({ pos: window.__WINE2__.position(), progress: window.__WINE2__.progressWidth() }));
      assert.ok(restarted.pos < 1.0, `a new playback starts at 0, not where the last one stopped (${restarted.pos.toFixed(2)} s)`);
      assert.ok(restarted.progress < 10, `and its bar does too (${restarted.progress}%)`);

      // ---- closing the panel releases all three (the music may keep playing) ---------------------------------------
      // the playback started above is still running and its panel is still open: closing the panel is its own release
      // path (stop + closePanel is the button's toggle, which would also stop the music)
      await w2.waitForFunction(() => window.__WINE2__.panelOpen(), { timeout: 10000 });
      await waitGif(true);
      await sleep(250);
      await w2.click('#close');
      await sleep(300);
      assert.equal(await w2.evaluate(() => window.__WINE2__.panelOpen()), false, 'the panel is closed');
      assert.equal(await w2.evaluate(() => window.__WINE2__.isPlaying()), true, 'the music may keep playing');
      assert.equal(await neonBits(), null, 'closing the panel puts the neon out');
      assert.equal((await djParts()).cls, false, 'closing the panel turns the interface back');
      assert.equal(((await djState()) || {}).on === true, false, 'closing the panel restores the field');
      await w2.evaluate(() => window.__WINE2__.stop());
      await waitGif(false);

      // ---- reduced motion: none of the three is ever enabled -------------------------------------------------------
      await c.page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
      const reducedBase = await rootsNow();
      await w2.evaluate(() => window.__WINE2__.toggle());
      await w2.waitForFunction(() => window.__WINE2__.isPlaying(), { timeout: 10000 });
      await sleep(900);
      assert.equal(((await gifState()) || {}).on === true, false, 'reduced motion leaves the stand-ins off');
      assert.equal(hiddenKeys(await fieldState()).length, 0, 'and no unit is hidden');
      assert.equal(await neonBits(), null, 'nor is the neon box built');
      assert.equal((await djParts()).cls, false, 'nor is the interface turned');
      assert.equal(((await djState()) || {}).on === true, false, 'nor the field');
      const reducedNow = await rootsNow();
      const written = reducedBase.filter((bb) => { const n = reducedNow.find((x) => x.k === bb.k); return n && (n.sx !== bb.sx || n.sy !== bb.sy); });
      assert.deepEqual(written, [], 'and no container scale was written');
      await w2.evaluate(() => window.__WINE2__.stop());
      await c.page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);

      // ---- leaving the match: all four frames are parked (hidden), nothing is left on screen -----------------------
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
          slots: document.querySelectorAll('[data-ui-slot="hud.right"], [data-ui-slot="hud.left"], [data-ui-slot="hud.left2"], [data-ui-slot="hud.left3"]').length,
          frames: frames.length,
          visible: frames.some((f) => f.getBoundingClientRect().width > 1),
          inPark: frames.every((f) => park && park.contains(f)),
          parkHidden: !!park && (park.hidden || park.getAttribute('aria-hidden') === 'true'),
        };
      });
      assert.match(left.screenCls, /lobby-screen/, 'the match screen was actually left');
      assert.equal(left.slots, 0, 'all four HUD slots are gone with the match');
      assert.equal(left.frames, 4, 'the four frames are still there, parked');
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
