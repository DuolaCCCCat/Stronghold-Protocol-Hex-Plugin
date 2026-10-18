// 若不是你突然闯进我生活 (plugins/dj-amiya) interface-plugin browser test. Not part of the default run.
//   SP_E2E=1 node --test test/ui/dj-amiya.e2e.test.js
//
// Reaches 休整期 with BOTH bundled ui plugins switched on in this browser (`sp.pref.ui-plugins`), 粥友的酒 (dj-wine,
// `hud.right`) and this one (`hud.left`), then checks what this plugin's design depends on:
//   1. the two slots do not share a plugin: both pages are mounted at once, both default to the play area's
//      bottom-left corner, they are vertically staggered (no overlap) and both leave the corner buttons clear;
//   2. this button is the ring and the animated GIF only — no visible name (the accessible name is an `aria-label`
//      that a screenshot cannot see), while 粥友的酒's button keeps its label;
//   3. clicking it starts ITS music: the Web Audio graph runs (context running, position advancing, the Analyser sees
//      real energy), the decoded length is the new track's 32.6 s, the panel opens, the host's `units-gif`
//      visual puts one animated Amiya stand-in over every unit, AND the host's `dj-rotate` visual turns the battle
//      interface and the pieces / enemies / items on the board with it (`prefers-reduced-motion` never applies either);
//   4. stopping / closing the panel puts both effects back — the stand-in layer destroyed, every view shown again, every
//      field container at its own scale, the HUD class gone (粥友的酒's own switch still counts: while it plays the
//      shared `dj-rotate` stays on) — and leaving the match puts the frames away;
//   5. with the plugin switched off nothing is mounted and its page is never requested.
// Do not run it from the sandbox; the integration pass runs it.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Client, OUT, ROOT, hasChrome, startRealServer } from '../e2e/client.mjs';

const ENABLED = process.env.SP_E2E === '1' && hasChrome();
const PLUGIN = path.join(ROOT, 'plugins/dj-amiya');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const FRAME_RE = (id) => new RegExp(`/p/${id}/[0-9a-f]{8}/ui/index\\.html$`);
/** The entry page of one of the two bundled ui plugins. */
const frameOf = (c, id) => c.page.frames().find((f) => FRAME_RE(id).test(f.url()));

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

describe('若不是你突然闯进我生活 (dj-amiya) in hud.left', { skip: !ENABLED }, () => {
  test('the second button mounts beside 粥友的酒, plays its own song, turns the units into GIFs, and restores everything', { timeout: 6 * 60 * 1000 }, async () => {
    assert.ok(fs.existsSync(path.join(PLUGIN, 'ui/index.html')), 'run node plugins-src/dj-amiya/build-page.mjs first');
    // The server's own plugins/: the host gates every ui plugin on `content.plugins > 0`, so a server without an
    // installed plugin never mounts one.
    const srv = await startRealServer({ fast: { timerScale: 1, combatSpeed: 2, startRound: 1, autoPlace: true } });
    const P = (await import('puppeteer-core')).default;
    const c = new Client(P, srv.base, 'solo', { prefix: 'dj-amiya', w: 1600, h: 900 });
    const errors = [];
    const frameRequests = [];
    try {
      await c.open();
      c.page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
      c.page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
      c.page.on('request', (r) => { if (/\/p\/(dj-wine|dj-amiya)\//.test(r.url())) frameRequests.push(r.url()); });
      // which stand-in sheets this page really fetches: the Amiya2 plugin must never ask for the other one
      const sheets = new Map();
      c.page.on('response', (r) => {
        const m = /\/img\/dj-units\/(amiya|prss)\.png$/.exec(r.url());
        if (m) sheets.set(m[0], r.status());
      });

      // ---- switched off: neither plugin page is requested, and no frame exists outside the match ------------------
      await c.page.waitForSelector('.title-login input', { timeout: 20000 });
      assert.deepEqual(frameRequests, [], 'no plugin page is requested while both are off');
      assert.equal(await c.page.evaluate(() => document.querySelector('iframe[src*="/p/"]') !== null), false,
        'the plugins run in iframes, so a plugin element cannot exist outside them');

      // ---- switched on: both buttons mount in the match's two HUD slots -------------------------------------------
      await c.page.evaluate(() => {
        localStorage.setItem('sp.pref.ui-plugins', JSON.stringify(['dj-amiya', 'dj-wine']));
        localStorage.removeItem('sp.name');
      });
      await c.page.reload({ waitUntil: 'domcontentloaded' });
      await c.page.waitForSelector('.screen', { timeout: 20000 });
      await reachPrep(c);
      await c.page.waitForSelector('[data-ui-slot="hud.right"] iframe', { timeout: 20000 });
      await c.page.waitForSelector('[data-ui-slot="hud.left"] iframe', { timeout: 20000 });
      const wine = frameOf(c, 'dj-wine');
      const amiya = frameOf(c, 'dj-amiya');
      assert.ok(wine, '粥友的酒 is mounted in hud.right');
      assert.ok(amiya, 'this plugin is mounted in hud.left');
      assert.notEqual(wine, amiya, 'the two plugins are two frames in two slots');
      await amiya.waitForSelector('#btn', { timeout: 10000 });
      await wine.waitForSelector('#btn', { timeout: 10000 });
      assert.ok(frameRequests.some((u) => /\/p\/dj-amiya\//.test(u)), 'this page is requested once it is on');
      assert.ok(frameRequests.some((u) => /\/p\/dj-wine\//.test(u)), 'and 粥友的酒 keeps its own page');

      // ---- this button: the ring and the GIF only, no visible name ------------------------------------------------
      const look = await amiya.evaluate(() => {
        const btn = document.getElementById('btn');
        const gif = document.getElementById('gif');
        const r = btn.getBoundingClientRect();
        return {
          text: btn.textContent.replace(/\s+/g, ''),
          gifText: gif.textContent,
          labels: btn.querySelectorAll('.am-btn__label, .am-btn__badge').length,
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
      assert.equal(look.aria, '若不是你突然闯进我生活', 'the accessible name is still there (invisible)');
      assert.match(look.title, /点一下开始 DJ/, 'the tooltip says what it does');
      assert.match(look.base, /^data:image\/gif;base64,/, 'the button image is the inlined gif');
      assert.equal(look.nw, 128, 'the Amiya2 gif is the 128 px one');
      assert.equal(look.nh, 128);
      assert.ok(look.w > 40 && look.w < 110 && look.h > 40 && look.h < 110, `the button is a small icon (${look.w}x${look.h})`);
      assert.equal(look.htmlBg, 'rgba(0, 0, 0, 0)', 'the page is transparent');
      assert.match(look.scheme, /dark/, 'and declares a dark color-scheme (no white box)');
      const wineText = await wine.evaluate(() => document.getElementById('btn').textContent.replace(/\s+/g, ''));
      assert.match(wineText, /粥友的酒/, '粥友的酒 keeps its visible name (that plugin is unchanged)');

      // the button's GIF is a real animated one: decoded, and (where Edge exposes `ImageDecoder`) by its real frame
      // count — never by two composited screenshots of the iframe: on this machine an animated GIF inside an iframe
      // does not advance between screenshots, so a pixel diff proves nothing (and the old shot-diff hung here).
      const gifInfo = await amiya.evaluate(async () => {
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
        return { decoded, frames, nw: gif.naturalWidth, nh: gif.naturalHeight };
      });
      assert.equal(gifInfo.decoded, true, 'the inlined amiya gif decodes to a real bitmap');
      assert.equal(gifInfo.nw, 128, 'the amiya gif is the 128 px one');
      if (gifInfo.frames !== null) assert.ok(gifInfo.frames > 1, `the gif really has multiple frames (${gifInfo.frames})`);

      // ---- both buttons: bottom-left, vertically staggered, clear of the corner buttons ---------------------------
      const iconBox = async (fr) => {
        const o = await c.page.evaluate((id) => {
          const f = document.querySelector(`[data-ui-slot="${id}"] iframe`);
          const r = f.getBoundingClientRect();
          return { x: r.left, y: r.top };
        }, fr === 'wine' ? 'hud.right' : 'hud.left');
        const b = await (fr === 'wine' ? wine : amiya).evaluate(() => {
          const r = document.getElementById('btn').getBoundingClientRect();
          return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
        });
        return { left: o.x + b.left, top: o.y + b.top, right: o.x + b.right, bottom: o.y + b.bottom };
      };
      const overlaps = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
      const amiyaBox = await iconBox('amiya');
      const wineBox = await iconBox('wine');
      const corner = await c.page.evaluate(() => {
        const el = document.querySelector('.gm__corner');
        const r = el.getBoundingClientRect();
        return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
      });
      for (const [name, box] of [['dj-amiya', amiyaBox], ['dj-wine', wineBox]]) {
        assert.ok(box.left < 200, `${name} defaults to the left edge (left ${Math.round(box.left)})`);
        assert.ok(box.top > 500, `${name} defaults to the bottom (top ${Math.round(box.top)})`);
        assert.equal(overlaps(box, corner), false, `${name} leaves the corner buttons clear`);
        assert.ok(Math.abs(box.left - corner.left) < 40, `${name} lines up with the corner buttons`);
      }
      assert.ok(amiyaBox.bottom <= wineBox.top + 1, `the second button sits above 粥友的酒 (${Math.round(amiyaBox.bottom)} <= ${Math.round(wineBox.top)})`);
      assert.equal(overlaps(amiyaBox, wineBox), false, 'the two buttons never overlap');
      await c.page.screenshot({ path: path.join(OUT, 'dj-amiya-two-buttons.png') });

      // ---- click it: its own song plays, the units become GIF stand-ins, and the interface turns too -------------
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

      assert.equal(await gifState(), null, 'nothing of the effect exists before it is asked for');
      // the canvas half of `dj-rotate` (render/djRotate.js) writes each field view's root container; this plugin asks
      // for it together with `units-gif`, so the containers' own numbers before the click are what `off` must restore
      const rootsNow = () => c.page.evaluate(() => {
        const R = globalThis.__SP_VIEW__?.raw;
        if (!R) return [];
        const out = [];
        for (const [k, v] of R.debug.views) {
          if (!v || v.destroyed || !v.root || !v.root.scale) continue;
          out.push({ k: String(k), sx: v.root.scale.x, sy: v.root.scale.y, rot: v.root.rotation });
        }
        out.sort((a, b) => (a.k < b.k ? -1 : a.k > b.k ? 1 : 0));
        return out;
      });
      const djState = () => c.page.evaluate(() => globalThis.__SP_VIEW__?.raw?.stats?.().djRotate ?? null);
      const djParts = () => c.page.evaluate(() => {
        const hud = document.querySelector('.gm__hud');
        const dj = (el) => (el.getAnimations ? el.getAnimations() : []).filter((a) => a.animationName && a.animationName.indexOf('gm-dj') === 0);
        const parts = [...hud.querySelectorAll('*')].filter((el) => dj(el).length > 0);
        return { cls: hud.classList.contains('is-dj-rotate'), parts: parts.length, scale: parts.slice(0, 4).map((el) => getComputedStyle(el).scale).join('|') };
      });
      assert.equal(await djState(), null, 'the canvas half does not exist before it is asked for');
      const base = await fieldState();
      const baseRoots = await rootsNow();
      assert.ok(base.views.length > 0, 'the prep pieces are on the field');
      await amiya.click('#btn');
      await amiya.waitForFunction(() => window.__AMIYA__ && window.__AMIYA__.isPlaying(), { timeout: 15000 });
      await waitGif(true);
      await sleep(1200);
      const a = await amiya.evaluate(() => ({
        playing: window.__AMIYA__.isPlaying(), ctx: window.__AMIYA__.ctxState(),
        pos: window.__AMIYA__.position(), dur: window.__AMIYA__.duration(),
        energy: window.__AMIYA__.energy(), open: window.__AMIYA__.panelOpen(),
      }));
      assert.equal(a.playing, true, 'playing after the click');
      assert.equal(a.ctx, 'running', 'the AudioContext is running');
      assert.ok(Math.abs(a.dur - 32.6008) < 0.05, `the NEW song decoded (${a.dur.toFixed(3)} s, the mp3 is 32.601 s)`);
      assert.ok(a.energy > 0, `the analyser sees real signal (energy ${a.energy})`);
      assert.equal(a.open, true, 'the panel opened');
      const gifOn = await gifState();
      assert.equal(gifOn.on, true, 'the units-gif visual is on');
      assert.equal(gifOn.strategy, 'amiya2', 'this plugin asks the host for the one-sheet `amiya2` strategy (its own behaviour is unchanged)');
      assert.deepEqual([...new Set(Object.values(gifOn.picks))], ['amiya2'], 'every unit on the field draws the Amiya2 sheet');
      assert.equal(gifOn.counts.prss, 0, 'no unit draws the prss sheet (the other plugin\'s)');
      assert.equal(gifOn.frames.prss, 0, 'the prss sheet is never even sliced');
      assert.equal(sheets.has('/img/dj-units/prss.png'), false, 'and it is never requested either');
      assert.equal(gifOn.sprites, base.views.length, 'one stand-in per unit view');
      assert.deepEqual(hiddenKeys(await fieldState()), base.views.map((v) => v.k), 'every unit view is hidden behind its stand-in');
      const frameA = (await gifState()).frame;
      await sleep(350);
      const frameB = (await gifState()).frame;
      assert.notEqual(frameA, frameB, `the stand-ins are animating (${frameA} → ${frameB})`);
      await c.page.screenshot({ path: path.join(OUT, 'dj-amiya-units-gif-a.png') });
      await c.page.screenshot({ path: path.join(OUT, 'dj-amiya-units-gif-b.png') });
      const hud = async () => c.page.evaluate(() => {
        const el = document.querySelector('.gm__hud');
        return { cls: el.classList.contains('is-dj-rotate'), transform: getComputedStyle(el).transform };
      });
      // this plugin asks for `dj-rotate` as well as `units-gif`: the interface turns (the HUD's parts run the two
      // animations) and the field's containers are multiplied by the same factor
      const turned = await djParts();
      assert.equal(turned.cls, true, 'this plugin turns the battle interface too');
      assert.ok(turned.parts >= 6, `the HUD's parts are animating (${turned.parts})`);
      const djA = await djState();
      assert.equal(djA.on, true, 'and the canvas half is on: the pieces / enemies / items on the board turn');
      assert.ok(djA.containers >= baseRoots.length, `every field view is transformed (${djA.containers})`);
      const ratio = (await rootsNow()).map((v) => {
        const b = baseRoots.find((x) => x.k === v.k);
        return b && b.sx !== 0 ? v.sx / b.sx : null;
      });
      assert.equal(ratio.every((x) => x !== null), true, 'every field view has a baseline');
      assert.ok(Math.max(...ratio) - Math.min(...ratio) < 1e-9, 'one factor for every unit (the reference\'s shared phase)');
      assert.ok(Math.abs(ratio[0] - 1) > 0.01, `the units are really turned / squashed (${ratio[0].toFixed(3)})`);

      // 粥友的酒 keeps its own behaviour: its music and the HUD turn, and this plugin's effect stays on
      await wine.click('#btn');
      await wine.waitForFunction(() => window.__DJ__ && window.__DJ__.isPlaying(), { timeout: 15000 });
      await sleep(900);
      const w = await wine.evaluate(() => ({ dur: window.__DJ__.duration(), energy: window.__DJ__.energy() }));
      assert.ok(Math.abs(w.dur - 30.0466) < 0.05, `粥友的酒 still plays its own song (${w.dur.toFixed(3)} s)`);
      assert.ok(w.energy > 0, 'with real signal');
      assert.equal((await hud()).cls, true, '粥友的酒 still turns the HUD');
      assert.equal(await amiya.evaluate(() => window.__AMIYA__.isPlaying()), true, 'both songs can play at once (one plugin each)');

      // ---- stopping this plugin: its music, its effect and the units all come back -------------------------------
      await amiya.evaluate(() => window.__AMIYA__.stop());
      await amiya.waitForFunction(() => window.__AMIYA__ && !window.__AMIYA__.isPlaying(), { timeout: 10000 });
      await waitGif(false);
      const after = await fieldState();
      assert.equal(after.world, base.world, 'the stand-in layer is destroyed (as many world children as before)');
      assert.deepEqual(hiddenKeys(after), [], 'every unit shows itself again');
      assert.deepEqual(after.views, base.views, 'positions / depth / culling are exactly what they were');
      // 粥友的酒 still holds `dj-rotate` (it is playing), so the shared visual stays on — per-plugin accounting
      assert.equal((await djParts()).cls, true, 'the interface keeps turning while 粥友的酒 still asks for it');
      assert.equal((await djState()).on, true, 'and the field keeps turning for the same reason');
      assert.equal(await wine.evaluate(() => window.__DJ__.isPlaying()), true, '粥友的酒 keeps playing (it has its own switch)');
      await wine.evaluate(() => window.__DJ__.stop());
      await c.page.waitForFunction(() => getComputedStyle(document.querySelector('.gm__hud')).transform === 'none', { timeout: 10000 });
      // ... and with no plugin asking, both halves are off and every container is back at its own numbers
      assert.equal((await djParts()).cls, false, 'with no plugin asking, the class is gone');
      const djOff = await djState();
      assert.equal(djOff.on, false, 'the canvas half is off');
      assert.equal(djOff.containers, 0, 'nothing is left to put back');
      const backRoots = await rootsNow();
      for (const b of baseRoots) {
        const n = backRoots.find((x) => x.k === b.k);
        assert.ok(n, `piece ${b.k} is still on the field`);
        assert.deepEqual([n.sx, n.sy, n.rot], [b.sx, b.sy, b.rot], `piece ${b.k} is back at its own scale and rotation (not 1)`);
      }

      // ---- closing the panel of this plugin leaves no residue ---------------------------------------------------
      await amiya.evaluate(() => window.__AMIYA__.toggle());
      await amiya.waitForFunction(() => window.__AMIYA__.isPlaying(), { timeout: 10000 });
      await sleep(400);
      await amiya.click('#close');
      await sleep(300);
      assert.equal(await amiya.evaluate(() => window.__AMIYA__.panelOpen()), false, 'the panel is closed');
      assert.equal(await amiya.evaluate(() => window.__AMIYA__.isPlaying()), true, 'the music may keep playing');
      // closing the panel turns both effects back (the same release path 粥友的酒 uses)
      assert.equal((await djParts()).cls, false, 'closing the panel turns the interface back');
      assert.equal(((await djState()) || {}).on === true, false, 'and the field with it');
      await amiya.evaluate(() => window.__AMIYA__.stop());
      await waitGif(false);

      // ---- reduced motion: never enabled ---------------------------------------------------------------
      await c.page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
      const reducedBase = await rootsNow();
      await amiya.evaluate(() => window.__AMIYA__.toggle());
      await amiya.waitForFunction(() => window.__AMIYA__.isPlaying(), { timeout: 10000 });
      await sleep(900);
      assert.equal((await gifState()).on, false, 'reduced motion leaves the stand-ins off');
      assert.equal(hiddenKeys(await fieldState()).length, 0, 'and no unit is hidden');
      assert.equal((await djParts()).cls, false, 'nor is the interface turned');
      assert.equal(((await djState()) || {}).on === true, false, 'nor the field');
      const reducedNow = await rootsNow();
      const written = reducedBase.filter((b) => { const n = reducedNow.find((x) => x.k === b.k); return n && (n.sx !== b.sx || n.sy !== b.sy); });
      assert.deepEqual(written, [], 'and no container scale was written');
      await amiya.evaluate(() => window.__AMIYA__.stop());
      await c.page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);

      // ---- leaving the match: both frames are parked (hidden), nothing of them is left on screen ----------------
      await c.page.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => (x.getAttribute('aria-label') || '').includes('离开')); if (b) b.click(); });
      await sleep(600);
      await c.page.evaluate(() => {
        const box = document.querySelector('.modal__box');
        const b = box && [...box.querySelectorAll('button')].find((x) => (x.className || '').includes('btn--primary') || (x.className || '').includes('btn--danger'));
        if (b) b.click();
      });
      await sleep(3000);
      const left = await c.page.evaluate(() => {
        const frames = [...document.querySelectorAll('iframe[src*="/p/"]')];
        const park = document.getElementById('sp-ui-park');
        return {
          screenCls: [...document.querySelectorAll('.screen')].map((s) => s.className).join(' | '),
          slots: document.querySelectorAll('[data-ui-slot="hud.right"], [data-ui-slot="hud.left"]').length,
          frames: frames.length,
          visible: frames.some((f) => f.getBoundingClientRect().width > 1),
          inPark: frames.every((f) => park && park.contains(f)),
          parkHidden: !!park && (park.hidden || park.getAttribute('aria-hidden') === 'true'),
        };
      });
      assert.match(left.screenCls, /lobby-screen/, 'the match screen was actually left');
      assert.equal(left.slots, 0, 'both HUD slots are gone with the match');
      assert.equal(left.visible, false, 'no plugin button is visible off the match');
      assert.equal(left.inPark, true, 'the host parked both frames instead of dropping them');
      assert.equal(left.parkHidden, true, 'and the park is hidden');

      assert.deepEqual(errors, [], 'no console/page errors');
    } finally {
      await c.close();
      await srv.stop();
    }
  });
});
