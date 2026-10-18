// 粥友的酒 (plugins/dj-wine) interface-plugin browser test. Not part of the default run.
//   SP_E2E=1 node --test test/ui/dj-wine.e2e.test.js
//
// Reaches 休整期 with the plugin switched on in this browser (`sp.pref.ui-plugins`), then checks what the design
// depends on:
//   1. the button is mounted in hud.right, its amiya GIF actually decoded (a data: URI, so `naturalWidth` is real),
//      and its frame is not blank;
//   2. its default place is the bottom-left corner, clear of the shop bar and of the corner buttons (a remembered
//      place wins after a drag, and survives a reload);
//   3. clicking it starts the DJ: the Web Audio graph runs (context running, position advancing, the Analyser sees
//      real energy), the panel opens and the host's battle interface keeps turning (`effect: dj-rotate`: every part of
//      the HUD turns about its own centre, two endless animations, and it is still turning a second later) — and so does
//      the field: every piece / enemy / item view's root container is multiplied by the same factor
//      (render/djRotate.js), it never stops over 10.5 s, a real press on a turning piece still selects it, and
//      closing / stopping puts every container back at the exact numbers it had (not "back to 1"); the same click
//      also asks for `effect: dj-neon` (the host's two decorative RGB layers: a rolling rim rainbow under a mask and
//      four flashing blobs, `pointer-events: none`), which is one box while on, never stacks, moves between two frames
//      0.5 s apart, blocks no `elementFromPoint`, and is gone whole on off (no node, no animation, the computed styles
//      field by field what they were) — and is never created under `prefers-reduced-motion: reduce`;
//   4. clicking again stops the music and closes the panel, and leaving the match tears the frame down entirely;
//   5. the host's second visual `effect: units-gif` (a different plugin asks for it; 粥友的酒 does not): every unit
//      view is hidden behind one animated stand-in per unit, the battle runs on and a unit can still be picked, and
//      `on: false` destroys the layer and puts the very same views back — three rounds leave nothing behind, and
//      `prefers-reduced-motion: reduce` never enables it;
//   6. with the plugin switched off nothing is mounted and the frame's URL is never requested.
// Do not run it from the sandbox; the integration pass runs it.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Client, OUT, ROOT, hasChrome, startRealServer } from '../e2e/client.mjs';

const ENABLED = process.env.SP_E2E === '1' && hasChrome();
const PLUGIN = path.join(ROOT, 'plugins/dj-wine');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The plugin's frame, once mounted. */
function frameOf(c) {
  return c.page.frames().find((f) => /\/p\/dj-wine\/[0-9a-f]{8}\/ui\/index\.html$/.test(f.url()));
}
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

describe('粥友的酒 (dj-wine) in hud.right', { skip: !ENABLED }, () => {
  test('the button mounts, the DJ plays (Web Audio), and leaving the match tears it down', { timeout: 5 * 60 * 1000 }, async () => {
    assert.ok(fs.existsSync(path.join(PLUGIN, 'ui/index.html')), 'run node plugins-src/dj-wine/build-page.mjs first');
    // ★ The server's own plugins/ (not a temp folder): the host gates every ui plugin on `content.plugins > 0`
    // (public/js/ui/pluginFrame.js sync → installedCount), so a server with no plugin installed never mounts one.
    const srv = await startRealServer({ fast: { timerScale: 1, combatSpeed: 2, startRound: 1, autoPlace: true } });
    const P = (await import('puppeteer-core')).default;
    const c = new Client(P, srv.base, 'solo', { prefix: 'dj-wine', w: 1600, h: 900 });
    const errors = [];
    const frameRequests = [];
    try {
      await c.open();
      c.page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
      c.page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
      c.page.on('request', (r) => { if (r.url().includes('/p/dj-wine/')) frameRequests.push(r.url()); });

      // ---- switched off: the plugin page is never requested, and no frame exists outside the match -----------
      await c.page.waitForSelector('.title-login input', { timeout: 20000 });
      assert.equal(await c.page.evaluate(() => document.querySelector('iframe[src*="/p/"]') !== null), false,
        'the plugin runs in an iframe, so a plugin-owned element cannot exist outside it');
      assert.equal(frameRequests.length, 0, 'the plugin page is never requested while the plugin is off');
      assert.equal(await c.page.evaluate(() =>
        Array.from(document.styleSheets).some((s) => { try { return Array.from(s.cssRules).some((r) => String(r.cssText).includes('dj-btn')); } catch { return false; } })),
      false, 'no plugin CSS reaches the host document');
      assert.equal(await c.page.evaluate(() => document.querySelectorAll('.gm__neon').length), 0,
        'the host creates no neon layer for a plugin that is off');

      // ---- switched on: the button mounts in hud.right once the match starts ----------------------------------
      // `sp.pref.ui-plugins` is read when the page's modules first load, so reload after writing it (as
      // test/ui/ui-plugins.e2e.test.js does). `sp.name` is dropped so the reload lands on the title form again.
      await c.page.evaluate(() => {
        localStorage.setItem('sp.pref.ui-plugins', JSON.stringify(['dj-wine']));
        localStorage.removeItem('sp.name');
      });
      await c.page.reload({ waitUntil: 'domcontentloaded' });
      await c.page.waitForSelector('.screen', { timeout: 20000 });
      await reachPrep(c);
      await c.page.waitForSelector('[data-ui-slot="hud.right"] iframe', { timeout: 20000 });
      const frame = frameOf(c);
      assert.ok(frame, 'the sandboxed page is the plugin entry');
      await frame.waitForSelector('#btn', { timeout: 10000 });
      assert.ok(frameRequests.length > 0, 'the plugin page was requested once it is on');

      // the GIF is a data: URI, so a decoded image has a real natural size; a blank frame would not
      const gif = await frame.evaluate(() => {
        const i = document.getElementById('gif');
        const r = i.getBoundingClientRect();
        return { nw: i.naturalWidth, nh: i.naturalHeight, complete: i.complete, w: r.width, h: r.height, base: i.src.slice(0, 30) };
      });
      assert.match(gif.base, /^data:image\/gif;base64,/, 'the button image is the inlined gif');
      assert.ok(gif.nw > 0 && gif.nh > 0, `the gif decoded (${gif.nw}x${gif.nh})`);
      assert.ok(gif.w > 20 && gif.h > 20, `the button is really laid out (${gif.w}x${gif.h})`);

      // ---- no white box: the page is transparent, and the host's frame paints nothing ------------------------
      const look = await frame.evaluate(() => ({
        htmlBg: getComputedStyle(document.documentElement).backgroundColor,
        bodyBg: getComputedStyle(document.body).backgroundColor,
        scheme: getComputedStyle(document.documentElement).colorScheme,
      }));
      assert.equal(look.htmlBg, 'rgba(0, 0, 0, 0)', 'the page root is transparent');
      assert.equal(look.bodyBg, 'rgba(0, 0, 0, 0)', 'the body is transparent');
      assert.match(look.scheme, /dark/, 'a dark used color-scheme: without it Chromium paints the frame white');
      const hostLook = await c.page.evaluate(() => {
        const f = document.querySelector('[data-ui-slot="hud.right"] iframe');
        const s = getComputedStyle(f);
        return { bg: s.backgroundColor, border: s.borderTopWidth, opacity: s.opacity, ready: f.classList.contains('is-ready') };
      });
      assert.equal(hostLook.bg, 'rgba(0, 0, 0, 0)', 'the frame element paints no background');
      assert.equal(hostLook.border, '0px', 'and no border');
      assert.equal(hostLook.ready, true, 'it is shown only after its entry load (no blank flash)');
      assert.equal(hostLook.opacity, '1');

      // ---- the button moves its own frame: four corners and the middle, and the passed-over host still clicks --
      const iframeOrigin = () => c.page.evaluate(() => {
        const f = document.querySelector('[data-ui-slot="hud.right"] iframe');
        const r = f.getBoundingClientRect();
        return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, w: innerWidth, h: innerHeight };
      });
      const buttonBox = async () => {
        const o = await iframeOrigin();
        const b = await frame.evaluate(() => {
          const r = document.getElementById('btn').getBoundingClientRect();
          return { left: r.left, top: r.top, width: r.width, height: r.height };
        });
        return { x: o.left + b.left + b.width / 2, y: o.top + b.top + b.height / 2, w: o.w, h: o.h, frame: o };
      };
      const dragTo = async (tx, ty) => {
        const from = await buttonBox();
        await c.page.mouse.move(from.x, from.y);
        await c.page.mouse.down();
        for (let i = 1; i <= 12; i++) {
          await c.page.mouse.move(from.x + ((tx - from.x) * i) / 12, from.y + ((ty - from.y) * i) / 12);
          await sleep(18);
        }
        await c.page.mouse.up();
        await sleep(350);
        return buttonBox();
      };
      // ---- the default place: the bottom-left corner, clear of the shop bar and of the corner buttons ----------
      // The hud.right slot's own place is the bottom-right, where the shop bar is; with no remembered place the page
      // sends `frame` itself and puts the button above the corner buttons on the left (index.template.html
      // placeDefault: the host rem from the play area, the corner's .24rem/.56rem rows, a 92 px floor).
      const rectOf = (sel) => c.page.evaluate((s) => {
        const el = document.querySelector(s);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
      }, sel);
      const buttonRect = async () => {
        const o = await iframeOrigin();
        const b = await frame.evaluate(() => {
          const r = document.getElementById('btn').getBoundingClientRect();
          return { left: r.left, top: r.top, width: r.width, height: r.height };
        });
        return { left: o.left + b.left, top: o.top + b.top, right: o.left + b.left + b.width, bottom: o.top + b.top + b.height };
      };
      const overlaps = (a, b) => !!a && !!b && a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
      const first = await buttonBox();
      assert.ok(first.x < 300 && first.y > first.h - 260,
        `it starts in the bottom-left corner (${Math.round(first.x)},${Math.round(first.y)} of ${first.w}x${first.h})`);
      assert.equal(await frame.evaluate(() => window.__DJ__.defaulted()), true, 'the page placed itself (no remembered place yet)');
      const btnRect = await buttonRect();
      const shopRect = await rectOf('.shopbar');
      const cornerRect = await rectOf('.gm__corner');
      assert.ok(shopRect && cornerRect, 'the shop bar and the corner buttons are on screen');
      assert.equal(overlaps(btnRect, shopRect), false, `the default place does not cover the shop bar (${JSON.stringify(btnRect)} vs ${JSON.stringify(shopRect)})`);
      assert.equal(overlaps(btnRect, cornerRect), false, 'and it leaves the corner buttons clear');
      assert.ok(btnRect.bottom < cornerRect.top, `it sits above the corner buttons (${Math.round(btnRect.bottom)} < ${Math.round(cornerRect.top)})`);
      await c.page.screenshot({ path: path.join(OUT, 'dj-wine-default-place.png') });
      const targets = [
        [Math.round(first.w / 2), Math.round(first.h / 2)],
        [40, 48], [Math.round(first.w - 40), 48], [40, Math.round(first.h - 48)], [Math.round(first.w - 40), Math.round(first.h - 48)],
      ];
      for (const [tx, ty] of targets) {
        const after = await dragTo(tx, ty);
        // the button is clamped to the play area (its own half + the frame's inset near a corner)
        assert.ok(Math.abs(after.x - tx) < 60 && Math.abs(after.y - ty) < 60,
          `dropped near ${tx},${ty} (got ${Math.round(after.x)},${Math.round(after.y)})`);
        // and it stays there (no frame drift after the release)
        const still = await buttonBox();
        assert.ok(Math.abs(still.x - after.x) < 2 && Math.abs(still.y - after.y) < 2, 'the frame stays where it was dropped');
        // the box is small, so the host is still hittable where the drag passed (not a full-screen layer)
        const probe = await c.page.evaluate(({ x, y, w, h }) => {
          const px = x < w / 2 ? Math.min(w - 10, x + 160) : Math.max(10, x - 160);
          const py = Math.min(h - 10, Math.max(10, y));
          const el = document.elementFromPoint(px, py);
          return el ? { tag: el.tagName, inFrame: !!el.closest('iframe'), px, py } : null;
        }, { x: Math.round(after.x), y: Math.round(after.y), w: after.w, h: after.h });
        assert.ok(probe && !probe.inFrame, `the host is on top away from the frame (${JSON.stringify(probe)})`);
      }
      // the remembered place survives a refresh
      const beforeReload = await buttonBox();
      await c.page.reload({ waitUntil: 'domcontentloaded' });
      await c.page.waitForSelector('[data-ui-slot="hud.right"] iframe', { timeout: 20000 });
      const frame2 = c.page.frames().find((f) => /\/p\/dj-wine\/[0-9a-f]{8}\/ui\/index\.html$/.test(f.url()));
      assert.ok(frame2, 'the frame is back after a refresh');
      await frame2.waitForFunction(() => window.__DJ__ && window.__DJ__.frame(), { timeout: 20000 });
      await sleep(500);
      const o2 = await c.page.evaluate(() => {
        const f = document.querySelector('[data-ui-slot="hud.right"] iframe');
        const r = f.getBoundingClientRect();
        return { left: r.left, top: r.top };
      });
      const b2 = await frame2.evaluate(() => {
        const r = document.getElementById('btn').getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      });
      assert.ok(Math.abs(o2.left + b2.x - beforeReload.x) < 4 && Math.abs(o2.top + b2.y - beforeReload.y) < 4,
        `the place is remembered (${Math.round(o2.left + b2.x)},${Math.round(o2.top + b2.y)} vs ${Math.round(beforeReload.x)},${Math.round(beforeReload.y)})`);

      // ---- the DJ: the HUD's parts turn, and so does the field (one switch, both engines) -----------------------
      assert.equal(await frame2.evaluate(() => window.__DJ__.isPlaying()), false, 'silent before the click');
      // the canvas half (`effect: dj-rotate` → render/djRotate.js): one transform per field view's root container.
      // Read the containers before anything asks for the effect: `off` has to bring these very numbers back.
      const fieldRoots = () => c.page.evaluate(() => {
        const R = globalThis.__SP_VIEW__?.raw;
        if (!R) return [];
        const out = [];
        for (const [k, v] of R.debug.views) {
          if (!v || v.destroyed || !v.root || !v.root.scale) continue;
          out.push({ k: String(k), kind: (v.info && v.info.kind) || '', sx: v.root.scale.x, sy: v.root.scale.y, rot: v.root.rotation });
        }
        out.sort((a, b) => (a.k < b.k ? -1 : a.k > b.k ? 1 : 0));
        return out;
      });
      const djState = () => c.page.evaluate(() => globalThis.__SP_VIEW__?.raw?.stats?.().djRotate ?? null);
      /** Each container's width/height against its own baseline — one shared factor if the phase is shared. */
      const factorOf = (now, base) => now.map((v) => {
        const b = base.find((x) => x.k === v.k);
        return b && b.sx !== 0 ? v.sx / b.sx : null;
      });
      /** What is not back where it was: keys that left, and keys whose own numbers changed. */
      const residue = (now, base) => {
        const missing = base.filter((b) => !now.some((x) => x.k === b.k)).map((b) => b.k);
        const changed = base
          .map((b) => { const n = now.find((x) => x.k === b.k); return n && (n.sx !== b.sx || n.sy !== b.sy || n.rot !== b.rot) ? `${b.k}: ${b.sx}/${b.sy}/${b.rot} -> ${n.sx}/${n.sy}/${n.rot}` : null; })
          .filter(Boolean);
        return { missing, changed };
      };
      assert.equal(await djState(), null, 'the canvas half does not exist until a plugin asks for dj-rotate');
      // the field view of the resumed match is still mounting: wait for the pieces to be drawn before reading them
      await c.page.waitForFunction(() => {
        const R = globalThis.__SP_VIEW__?.raw;
        if (!R) return false;
        for (const v of R.debug.views.values()) if (v.root && v.placed) return true;
        return false;
      }, { timeout: 30000 });
      const fieldBase = await fieldRoots();
      assert.ok(fieldBase.length >= 3, `the prep field has pieces to turn (${fieldBase.length})`);
      // The same click also asks for the host's night-club lighting (`effect: dj-neon`). Read the screen's own
      // computed styles before anything is asked for: the off has to put every one of them back, field by field.
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
          screen: pick('.screen.gm'), hud: pick('.gm__hud'), field: pick('.gm__field'), vignette: pick('.gm__vignette'), body: pick('body'),
          screenInline: screen ? screen.getAttribute('style') : null,
          bodyInline: document.body.getAttribute('style'),
          hudClass: (document.querySelector('.gm__hud') || {}).className || null,
        };
      });
      const lookBefore = await plainLook();
      /** Post `effect: dj-neon` from the plugin's own frame — the real host path (validate → setEffect). */
      const neonEffect = (on) => frame2.evaluate((m) => { parent.postMessage(m, '*'); }, { v: 1, t: 'effect', name: 'dj-neon', on });
      await frame2.click('#btn');
      await frame2.waitForFunction(() => window.__DJ__ && window.__DJ__.isPlaying(), { timeout: 15000 });
      await sleep(1200);
      const a = await frame2.evaluate(() => ({
        playing: window.__DJ__.isPlaying(), ctx: window.__DJ__.ctxState(),
        pos: window.__DJ__.position(), dur: window.__DJ__.duration(),
        energy: window.__DJ__.energy(), open: window.__DJ__.panelOpen(),
      }));
      assert.equal(a.playing, true, 'playing after the click');
      assert.equal(a.ctx, 'running', 'the AudioContext is running');
      assert.ok(a.dur > 25 && a.dur < 35, `the song decoded (${a.dur.toFixed(2)}s)`);
      assert.ok(a.energy > 0, `the analyser sees real signal (energy ${a.energy})`);
      assert.equal(a.open, true, 'the DJ panel opened');

      // ---- the host interface really turns (the controlled effect), and keeps turning -----------------------
      // The 整活 is per part (the reference mod cyanfish.dj-all applies it that way): every part of the HUD turns about
      // its own centre with two endless animations — a `cos θ` horizontal turn and a squash pulse — and the HUD itself
      // is never transformed. Reading surfaces (detail pane, popup, drawer, dialog, direction wheel) are not turned.
      const turnOn = await c.page.evaluate(() => {
        const hud = document.querySelector('.gm__hud');
        // only the animations this stylesheet adds: parts of the game animate on their own (a shop card's pop-in)
        const dj = (el) => (el.getAnimations ? el.getAnimations() : []).filter((a) => a.animationName && a.animationName.indexOf('gm-dj') === 0);
        const parts = [...hud.querySelectorAll('*')].filter((el) => dj(el).length > 0);
        return {
          cls: hud.classList.contains('is-dj-rotate'),
          hudTransform: getComputedStyle(hud).transform,
          parts: parts.length,
          two: parts.every((el) => dj(el).length === 2),
          names: parts[0] ? dj(parts[0]).map((a) => a.animationName).join(',') : '',
          scale: parts.slice(0, 6).map((el) => getComputedStyle(el).scale).join('|'),
          noRead: !parts.some((el) => /dpanel|bpop|edrawer|modal|fwheel/.test(String(el.className || ''))),
        };
      });
      assert.equal(turnOn.cls, true, 'playing asks the host for dj-rotate');
      assert.equal(turnOn.hudTransform, 'none', 'the HUD itself never turns (the reference turns its parts, not the screen)');
      assert.ok(turnOn.parts >= 8, `the HUD's parts are animating (${turnOn.parts})`);
      assert.equal(turnOn.two, true, 'each of them runs both animations (turn + squash)');
      assert.match(turnOn.names, /gm-dj-(squash|turn).*gm-dj-(squash|turn)/, `a turn animation and a squash animation (${turnOn.names})`);
      assert.equal(turnOn.noRead, true, 'no reading/clicking surface (detail pane, popup, drawer, dialog, wheel) is turned');
      await c.page.screenshot({ path: path.join(OUT, 'dj-wine-turn-a.png') });
      await sleep(1000);
      const turnLater = await c.page.evaluate(() => {
        const dj = (el) => (el.getAnimations ? el.getAnimations() : []).filter((a) => a.animationName && a.animationName.indexOf('gm-dj') === 0);
        const parts = [...document.querySelectorAll('.gm__hud *')].filter((el) => dj(el).length > 0);
        return {
          parts: parts.length,
          scale: parts.slice(0, 6).map((el) => getComputedStyle(el).scale).join('|'),
          clock: parts[0] ? Math.round(dj(parts[0])[0].currentTime) : 0,
        };
      });
      assert.ok(turnLater.parts >= 8, `still turning a second later (${turnLater.parts} parts, it does not run once)`);
      assert.notEqual(turnLater.scale, turnOn.scale, `the parts are drawn somewhere else a second later (${turnOn.scale} -> ${turnLater.scale})`);
      assert.ok(turnLater.clock > 0, `the animation clock runs (${turnLater.clock} ms)`);
      await c.page.screenshot({ path: path.join(OUT, 'dj-wine-turn-b.png') });

      // ---- the canvas half: the pieces / enemies / items on the board turn and are squashed too -----------------
      // The reference applies its 整活 to both engines; the host visual is one switch, so the field view's containers
      // are multiplied by the HUD stylesheet's own factors (render/djRotate.js): x × 110%·cos θ, y × 52% at the peak
      // (the reference's 60% made 20% deeper — the owner's local tuning, carried by both halves).
      const djOn = await djState();
      assert.equal(djOn.on, true, 'playing also turns the field');
      const f1 = await fieldRoots();
      const k1 = factorOf(f1, fieldBase);
      assert.equal(k1.every((x) => x !== null), true, 'every field view has a baseline');
      assert.ok(Math.max(...k1) - Math.min(...k1) < 1e-9,
        `every unit is at the same factor (the reference's shared phase), spread ${Math.max(...k1) - Math.min(...k1)}`);
      const y1 = f1.map((v) => { const b = fieldBase.find((x) => x.k === v.k); return b && b.sy !== 0 ? v.sy / b.sy : null; });
      await sleep(240);
      const f2 = await fieldRoots();
      const k2 = factorOf(f2, fieldBase);
      const y2 = f2.map((v) => { const b = fieldBase.find((x) => x.k === v.k); return b && b.sy !== 0 ? v.sy / b.sy : null; });
      assert.notEqual(k1[0].toFixed(4), k2[0].toFixed(4), `the units are drawn somewhere else 240 ms later (${k1[0].toFixed(4)} → ${k2[0].toFixed(4)})`);
      const spread = [Math.abs(k1[0] - 1), Math.abs(k2[0] - 1), Math.abs(y1[0] - 1), Math.abs(y2[0] - 1)];
      assert.ok(Math.max(...spread) > 0.02, `they are really turned / squashed, not at rest (${spread.map((v) => v.toFixed(3)).join(', ')})`);
      assert.ok(y1.every((v) => Math.abs(v - y1[0]) < 1e-9) && y2.every((v) => Math.abs(v - y2[0]) < 1e-9),
        'and every unit is squashed by the same amount (one clock)');
      await c.page.screenshot({ path: path.join(OUT, 'dj-wine-field-turn-a.png') });
      await sleep(500);
      await c.page.screenshot({ path: path.join(OUT, 'dj-wine-field-turn-b.png') });

      // ---- the host's night-club lighting, `dj-neon` (the third controlled effect) ------------------------------
      // The same click asks for the host's two decorative layers (docs/PLUGINS.md §14): one fixed, full-screen box
      // with `pointer-events: none` — a rim rainbow that rolls under a mask fading to transparent in the middle, plus
      // four coloured blobs flashing out of phase. CSS only. `on: false` removes the box whole, so no node, class or
      // inline style is left and `getAnimations()` is back where it was. This block is what makes "not applied",
      // "not restored" and "still on under reduced motion" fail.
      const neon = () => c.page.evaluate(() => {
        const root = document.querySelector('.gm__neon');
        const dj = (el) => (el && el.getAnimations ? el.getAnimations() : []).filter((a) => (a.animationName || '').indexOf('gm-neon') === 0);
        const parts = [...document.querySelectorAll('.gm__neon, .gm__neon *')];
        const rainbow = document.querySelector('.gm__neon__rainbow');
        const blobs = [...document.querySelectorAll('.gm__neon__blob')];
        const rect = root ? root.getBoundingClientRect() : null;
        return {
          roots: document.querySelectorAll('.gm__neon').length,
          pointer: root ? getComputedStyle(root).pointerEvents : null,
          z: root ? Number(getComputedStyle(root).zIndex) : null,
          edge: document.querySelectorAll('.gm__neon__edge').length,
          rainbow: document.querySelectorAll('.gm__neon__rainbow').length,
          blobs: blobs.length,
          blend: blobs[0] ? getComputedStyle(blobs[0]).mixBlendMode : null,
          blur: blobs[0] ? getComputedStyle(blobs[0]).filter : null,
          drift: blobs[0] ? getComputedStyle(blobs[0]).translate : null,
          hues: blobs.map((b) => getComputedStyle(b).getPropertyValue('--gm-neon-hue').trim()).join(','),
          anims: parts.reduce((n, el) => n + dj(el).length, 0),
          names: [...new Set(parts.flatMap((el) => dj(el).map((a) => a.animationName)))].sort(),
          transform: rainbow ? getComputedStyle(rainbow).transform : null,
          flashing: blobs.map((el) => `${getComputedStyle(el).opacity}|${getComputedStyle(el).filter}`).join(','),
          rect: rect ? { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) } : null,
          viewport: { w: innerWidth, h: innerHeight },
          position: root ? getComputedStyle(root).position : null,
          rootTransform: root ? getComputedStyle(root).transform : null,
          parent: root && root.parentElement ? root.parentElement.tagName : null,
          seed: root ? root.dataset.seed : null,
        };
      });
      const neonOn = await neon();
      assert.equal(neonOn.roots, 1, 'playing puts the host\'s neon up (one box, not a tree)');
      assert.equal(neonOn.edge, 1, 'layer A: the rim glow is there');
      assert.equal(neonOn.rainbow, 1, 'with its rolling rainbow');
      assert.ok(neonOn.blobs >= 4 && neonOn.blobs <= 8, `layer B: 4–8 coloured blobs (${neonOn.blobs})`);
      assert.equal(neonOn.blend, 'screen', 'the blobs are screen-blended');
      assert.match(neonOn.blur, /blur\((4[0-9]|[5-7][0-9])px\)/, `each blob carries its own 40–72 px blur (${neonOn.blur})`);
      assert.equal(neonOn.pointer, 'none', 'the whole box never takes a click (pointer-events: none)');
      assert.ok(neonOn.z > 1 && neonOn.z < 40, `above the match screen and under the banners (z-index ${neonOn.z})`);
      assert.equal(neonOn.parent, 'BODY', 'the box is a child of the body — outside the match screen and the HUD');
      assert.equal(neonOn.position, 'fixed', 'and positioned against the viewport');
      assert.equal(neonOn.rootTransform, 'none', 'the box itself is never transformed (the HUD\'s turn cannot reach it)');
      assert.deepEqual(neonOn.rect, { x: 0, y: 0, w: neonOn.viewport.w, h: neonOn.viewport.h },
        'it covers the viewport, corners included');
      assert.ok(/^[1-9][0-9]*$/.test(String(neonOn.seed)), `the box carries a fresh random seed (${neonOn.seed})`);
      assert.ok(neonOn.anims >= 6, `the stylesheet animations run (${neonOn.anims}: ${neonOn.names.join(', ')})`);
      assert.match(neonOn.names.join(','), /gm-neon-in/, 'the box fades in (0.9 s)');
      assert.match(neonOn.names.join(','), /gm-neon-breathe/, 'the rim breathes');
      assert.match(neonOn.names.join(','), /gm-neon-spin/, 'the rainbow rolls');
      await c.page.screenshot({ path: path.join(OUT, 'dj-wine-neon-a.png') });
      await sleep(500);
      const neonLater = await neon();
      await c.page.screenshot({ path: path.join(OUT, 'dj-wine-neon-b.png') });
      assert.notEqual(neonLater.transform, neonOn.transform,
        `the rainbow is somewhere else 0.5 s later (${neonOn.transform} -> ${neonLater.transform})`);
      assert.notEqual(neonLater.flashing, neonOn.flashing, `and the blobs are flashing (${neonOn.flashing} -> ${neonLater.flashing})`);
      // even at the extreme phases of the turn (edge-on and mirrored) the box keeps covering the viewport: it is a
      // child of the body, so the HUD's `scale` never reaches it
      const extreme = await c.page.evaluate(async () => {
        const gtop = document.querySelector('.gtop');
        const scaleX = () => {
          const s = getComputedStyle(gtop).scale;
          if (!s || s === 'none') return 1;
          const n = Number(s.trim().split(/\s+/)[0]);
          return Number.isFinite(n) ? n : 1;
        };
        const t0 = performance.now();
        let sx = scaleX();
        while (performance.now() - t0 < 2600 && !(sx < -0.97 || Math.abs(sx) < 0.08)) {
          await new Promise((r) => setTimeout(r, 55));
          sx = scaleX();
        }
        const root = document.querySelector('.gm__neon');
        const r = root.getBoundingClientRect();
        return {
          sx, rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
          transform: getComputedStyle(root).transform, w: innerWidth, h: innerHeight,
        };
      });
      assert.equal(extreme.transform, 'none', 'at an extreme phase of the turn the neon box is still untransformed');
      assert.deepEqual(extreme.rect, { x: 0, y: 0, w: extreme.w, h: extreme.h },
        `and still covers every corner at phase ${extreme.sx.toFixed(3)}`);
      // nothing under the box is blocked: elementFromPoint never returns the layer itself
      const neonSpots = await c.page.evaluate(() => [[800, 450], [420, 420], [1480, 320], [80, 820], [1520, 820], [260, 800], [800, 70], [800, 850], [1340, 500]]
        .map(([x, y]) => {
          const el = document.elementFromPoint(x, y);
          return { x, y, tag: el ? el.tagName : null, neon: !!(el && el.closest && el.closest('.gm__neon')) };
        }));
      assert.equal(neonSpots.every((p) => !p.neon), true, 'elementFromPoint never lands on the neon box');
      assert.ok(neonSpots.filter((p) => p.tag === 'CANVAS').length >= 3,
        `the board's own points still reach the canvas (${neonSpots.filter((p) => p.tag === 'CANVAS').length} of ${neonSpots.length})`);

      // ---- it does not stop: 10.5 s of samples ---------------------------------------------------------------
      const seen = new Set();
      let worstSpread = 0;
      let stayed = 0;
      for (let i = 0; i < 21; i++) {
        await sleep(500);
        const st = await djState();
        const rows = await fieldRoots();
        const kk = factorOf(rows, fieldBase);
        worstSpread = Math.max(worstSpread, Math.max(...kk) - Math.min(...kk));
        seen.add(kk[0].toFixed(3));
        if (st.on && rows.length >= fieldBase.length && kk.every((x) => x !== null)) stayed++;
      }
      assert.equal(stayed, 21, `on and every unit turning for all 10.5 s (${stayed}/21 samples)`);
      assert.ok(seen.size >= 8, `it keeps moving (${seen.size} distinct factors over 10.5 s)`);
      assert.ok(worstSpread < 1e-9, `still one phase for every unit (worst spread ${worstSpread})`);

      // ---- a real press on a turning piece still picks it ------------------------------------------------------
      // Picking is ground-tile based (render/pick.js), so the transform cannot move the hit box away from the unit:
      // the piece a player aims at is the piece the press selects, however squashed it is at that instant.
      const aim = await c.page.evaluate(() => {
        const raw = globalThis.__SP_VIEW__.raw;
        for (const v of raw.debug.views.values()) {
          if (!v.root || !v.placed || v.culled || !v.info || v.info.kind === 'device') continue;
          const x = Math.round(v.screen.x), y = Math.round(v.screen.y);
          if (!(x > 60 && y > 140)) continue;
          const el = document.elementFromPoint(x, y);
          if (!el || el.tagName !== 'CANVAS') continue;
          const hit = raw.debug.pick.pieceAt(x, y);
          if (!hit) continue;
          return { x, y, uid: String(hit.uid ?? hit.id ?? ''), kind: v.info.kind };
        }
        return null;
      });
      assert.ok(aim, 'a piece can be aimed at while the field turns');
      await c.page.mouse.click(aim.x, aim.y);
      const picked = await c.page.waitForSelector('.uframe', { timeout: 4000 }).then(() => true, () => false);
      assert.equal(picked, true, `a real press on the turning piece (${aim.x},${aim.y}, ${aim.kind}) selects it`);
      await c.page.keyboard.press('Escape');
      await sleep(250);

      // the playhead really advances
      await sleep(1100);
      const b = await frame2.evaluate(() => ({ pos: window.__DJ__.position(), playing: window.__DJ__.isPlaying() }));
      assert.equal(b.playing, true, 'still playing');
      assert.ok(b.pos > a.pos, `the position advanced (${a.pos.toFixed(2)} -> ${b.pos.toFixed(2)})`);

      // ---- the in-frame 整活 is really animating (the record spin is a live animation) -------------------------
      const spin = await frame2.evaluate(() => {
        const rec = document.querySelector('.dj-deck__rec');
        const anims = rec.getAnimations ? rec.getAnimations() : [];
        return { on: document.getElementById('root').classList.contains('is-on'), count: anims.length };
      });
      assert.equal(spin.on, true, 'the root is in the playing state');
      assert.ok(spin.count > 0, 'the deck record is animating while playing');

      // ---- closing the panel restores the interface at once (the music may keep playing) -----------------------
      await frame2.click('#close');
      await sleep(300);
      const closedPanel = await c.page.evaluate(() => {
        const hud = document.querySelector('.gm__hud');
        return {
          cls: hud.classList.contains('is-dj-rotate'),
          transform: getComputedStyle(hud).transform,
          anims: [...hud.querySelectorAll('*')].filter((el) => el.getAnimations && el.getAnimations().length > 0).length,
          scale: [...hud.querySelectorAll('.gtop, .team, .gm__effects, .shopbar > *, .gm__corner > *')]
            .map((el) => getComputedStyle(el).scale).join('|'),
        };
      });
      assert.equal(closedPanel.cls, false, 'closing the panel turns the interface back');
      assert.equal(closedPanel.transform, 'none', 'no transform residue');
      assert.equal(closedPanel.anims, 0, 'no animation is left running');
      assert.equal(closedPanel.scale.split('|').every((v) => v === 'none' || v === '1' || v === '1 1'), true,
        `every part is back at its own scale (${closedPanel.scale})`);
      // the canvas half too: each container at the exact numbers it had, not "back to 1"
      const djClosed = await djState();
      assert.equal(djClosed.on, false, 'closing the panel stops the field too');
      assert.equal(djClosed.containers, 0, 'nothing is left to put back');
      const fieldClosed = await fieldRoots();
      const restClosed = residue(fieldClosed, fieldBase);
      assert.deepEqual(restClosed.missing, [], 'every piece is still on the field');
      assert.deepEqual(restClosed.changed, [], `every container is back at its own scale and rotation (${restClosed.changed.length} changed)`);
      assert.equal(await frame2.evaluate(() => window.__DJ__.isPlaying()), true, 'the music continues');

      // ---- click again: it stops, and the HUD is already plain -------------------------------------------------
      await frame2.click('#btn');
      await frame2.waitForFunction(() => window.__DJ__ && !window.__DJ__.isPlaying(), { timeout: 10000 });
      const d = await frame2.evaluate(() => ({
        playing: window.__DJ__.isPlaying(), open: window.__DJ__.panelOpen(),
        on: document.getElementById('root').classList.contains('is-on'),
        anims: (document.querySelector('.dj-deck__rec').getAnimations ? document.querySelector('.dj-deck__rec').getAnimations().length : 0),
      }));
      assert.equal(d.playing, false, 'stopped after the second click');
      assert.equal(d.open, false, 'the panel closed');
      assert.equal(d.on, false, 'the playing state was cleared (no leftover transform/animation)');
      assert.equal(d.anims, 0, 'the animation stopped (no residue)');
      const turnOff = await c.page.evaluate(() => {
        const hud = document.querySelector('.gm__hud');
        return {
          cls: hud.classList.contains('is-dj-rotate'),
          transform: getComputedStyle(hud).transform,
          anims: [...hud.querySelectorAll('*')].filter((el) => el.getAnimations && el.getAnimations().length > 0).length,
        };
      });
      assert.equal(turnOff.cls, false, 'stopping removes the class');
      assert.equal(turnOff.transform, 'none', 'and the element is exactly as before');
      assert.equal(turnOff.anims, 0, 'and no animation is left running');
      const fieldStopped = residue(await fieldRoots(), fieldBase);
      assert.deepEqual(fieldStopped.changed, [], 'and the field is still exactly what it was (stopping an off effect is a no-op)');

      // ---- the neon is gone whole: no node, no animation, the computed styles field by field what they were ------
      const neonOff = await neon();
      assert.equal(neonOff.roots, 0, 'stopping takes both neon layers away');
      assert.equal(neonOff.anims, 0, 'and no gm-neon animation is left');
      const lookAfter = await plainLook();
      const lookDiff = [];
      for (const key of ['screen', 'hud', 'field', 'vignette', 'body']) {
        for (const p of Object.keys(lookBefore[key] || {})) {
          if ((lookBefore[key] || {})[p] !== (lookAfter[key] || {})[p]) lookDiff.push(`${key}.${p}: ${lookBefore[key][p]} -> ${lookAfter[key][p]}`);
        }
      }
      assert.deepEqual(lookDiff, [], `every computed style is what it was before the click (${lookDiff.length} changed)`);
      assert.equal(lookAfter.screenInline, lookBefore.screenInline, 'no inline style was left on the match screen');
      assert.equal(lookAfter.bodyInline, lookBefore.bodyInline, 'no inline style was left on the body');
      assert.equal(lookAfter.hudClass, lookBefore.hudClass, 'the HUD class is exactly what it was');
      // three rounds, each asked twice: never a second box, never a leftover, and a new seed every time
      const seeds = new Set();
      for (let i = 0; i < 3; i++) {
        await neonEffect(true);
        await sleep(200);
        const once = await neon();
        await neonEffect(true);
        await sleep(100);
        const twice = await neon();
        await neonEffect(false);
        await sleep(200);
        const gone = await neon();
        seeds.add(String(once.seed));
        assert.equal(once.roots, 1, `round ${i + 1}: one box while it is on`);
        assert.equal(twice.roots, 1, `round ${i + 1}: asking again does not stack a second box`);
        assert.equal(twice.seed, once.seed, `round ${i + 1}: asking again keeps the same seed (nothing re-randomized under it)`);
        assert.equal(gone.roots, 0, `round ${i + 1}: gone after the off`);
        assert.equal(gone.anims, 0, `round ${i + 1}: no animation survives the off`);
      }
      assert.equal(seeds.size, 3, `each round draws a new random seed (${[...seeds].join(', ')})`);

      // ---- the second host effect, `units-gif` (a plugin asks for it; 粥友的酒 itself does not) ----------------
      // The host applies it for a plugin that names it (docs/PLUGINS.md §14): the units on the field are replaced by
      // an animated stand-in, visibility only, and `on: false` puts the very same views back. Posted from the plugin's
      // own frame, so it takes the real host path: validatePluginMessage → ui/pluginFrame.js setEffect → the field
      // view's render/unitsGif.js. The test is what makes "not restored" / "layer not destroyed" fail.
      const plugEffect = (name, on) => frame2.evaluate((m) => { parent.postMessage(m, '*'); }, { v: 1, t: 'effect', name, on });
      const gifState = () => c.page.evaluate(() => globalThis.__SP_VIEW__.raw.stats().unitsGif);
      const fieldState = () => c.page.evaluate(() => {
        const R = globalThis.__SP_VIEW__.raw;
        // the renderables of a view: a unit / piece has root + hud + shadow (+ a facing chevron, a block icon), an item
        // a plate, a device a Graphics body and a 3D box — `shown` is true while any of them draws
        const PARTS = ['root', 'hud', 'shadow', 'facingArrow', 'blockIcon', 'gfx', 'plate'];
        return {
          world: R.debug.ctx.layers.units.parent.children.length,
          views: [...R.debug.views.entries()].map(([k, v]) => ({
            k: String(k), placed: !!v.placed, culled: !!v.culled,
            shown: PARTS.some((p) => v[p] && v[p].visible) || !!(v.box && v.box.mesh && v.box.mesh.visible),
            x: v.root ? Math.round(v.root.position.x) : null,
            y: v.root ? Math.round(v.root.position.y) : null,
            z: v.root ? v.root.zIndex : null,
          })),
        };
      });
      const waitGif = (on) => c.page.waitForFunction((want) => {
        const g = globalThis.__SP_VIEW__.raw.stats().unitsGif;
        return !!g && g.on === want && (want ? g.sprites > 0 : g.sprites === 0);
      }, { timeout: 20000 }, on);
      const hiddenKeys = (s) => s.views.filter((v) => !v.culled && !v.shown).map((v) => v.k);

      assert.equal(await gifState(), null, 'nothing is fetched or drawn until a plugin asks for the effect');
      const prepBase = await fieldState();
      assert.ok(prepBase.views.length > 0, 'the prep pieces are on the field');
      await c.page.screenshot({ path: path.join(OUT, 'dj-wine-unitsgif-prep-base.png') });
      await plugEffect('units-gif', true);
      await waitGif(true);
      assert.equal((await gifState()).sprites, prepBase.views.length, 'one stand-in per unit view');
      assert.deepEqual(hiddenKeys(await fieldState()), prepBase.views.map((v) => v.k), 'every unit view is hidden while the stand-ins are up');
      await sleep(300);
      await c.page.screenshot({ path: path.join(OUT, 'dj-wine-unitsgif-prep-a.png') });
      const frameA = (await gifState()).frame;
      await sleep(400);
      const frameB = (await gifState()).frame;
      assert.notEqual(frameA, frameB, `the stand-ins are animating (frame ${frameA} → ${frameB})`);
      await c.page.screenshot({ path: path.join(OUT, 'dj-wine-unitsgif-prep-b.png') });

      // off: the stand-in layer is destroyed and every view is exactly what it was (position, depth, culling, seen)
      await plugEffect('units-gif', false);
      await waitGif(false);
      const prepOff = await fieldState();
      assert.equal(prepOff.world, prepBase.world, 'the stand-in layer is gone (as many world children as before)');
      assert.deepEqual(hiddenKeys(prepOff), [], 'every view shows itself again');
      assert.deepEqual(prepOff.views, prepBase.views, 'positions / depth / culling are exactly what they were');
      await c.page.screenshot({ path: path.join(OUT, 'dj-wine-unitsgif-prep-off.png') });

      // three more rounds: nothing accumulates and every round ends exactly as it started
      for (let i = 0; i < 3; i++) {
        await plugEffect('units-gif', true);
        await waitGif(true);
        assert.equal((await gifState()).sprites, prepBase.views.length, `round ${i + 1}: one stand-in per unit, not more`);
        await plugEffect('units-gif', false);
        await waitGif(false);
        const back = await fieldState();
        assert.equal(back.world, prepBase.world, `round ${i + 1}: the layer is destroyed again`);
        assert.deepEqual(hiddenKeys(back), [], `round ${i + 1}: nothing stays hidden`);
      }

      // on across the round start: the battle's own units get stand-ins, the battle runs, and the units still pick
      await plugEffect('units-gif', true);
      await waitGif(true);
      await c.click('.readybtn');
      await c.waitFor((s) => s.phase === 'COMBAT', 'combat', 60000);
      await sleep(1200);
      const battleGif = await gifState();
      assert.equal(battleGif.on, true, 'the effect survives the round start');
      assert.ok(battleGif.sprites > 0, `the battle units got stand-ins (${battleGif.sprites})`);
      const picking = await c.page.evaluate(() => {
        const R = globalThis.__SP_VIEW__.raw;
        const v = [...R.debug.views.values()].find((x) => x.root && x.info && x.info.kind !== 'device' && !x.culled);
        if (!v) return null;
        const hit = R.debug.pick.battleUnitAt(Math.round(v.screen.x), Math.round(v.screen.y));
        return { id: String(v.id), mode: R.mode, hit: hit ? String(hit.id) : null, fps: R.stats().fps };
      });
      assert.ok(picking && picking.mode === 'battle', 'the battle is running on screen');
      assert.equal(picking.hit, picking.id, 'a unit can still be picked under its stand-in (hit-testing is untouched)');
      assert.ok(picking.fps > 20, `the field still draws at speed (${picking.fps} fps)`);
      await plugEffect('units-gif', false);
      await waitGif(false);
      assert.equal((await fieldState()).world, prepBase.world, 'no stand-in layer is left in battle either');
      assert.deepEqual(hiddenKeys(await fieldState()), [], 'the battle views are back');

      // ---- in battle: the enemies turn too, and a real press still finds one ---------------------------------
      // The same switch as the HUD: `dj-rotate` on the canvas half transforms every battle view's root container,
      // enemies included (they only exist in battle). One shared factor — the reference's single phase.
      await plugEffect('dj-rotate', true);
      await sleep(500);
      assert.equal((await djState()).on, true, 'the effect turns the battle field as well');
      const battleRoots = () => c.page.evaluate(() => {
        const R = globalThis.__SP_VIEW__.raw;
        const out = [];
        for (const [k, v] of R.debug.views) {
          if (!v || v.destroyed || !v.root || !v.root.scale) continue;
          out.push({ k: String(k), kind: (v.info && (v.info.kind || v.info.side)) || '', sx: v.root.scale.x, sy: v.root.scale.y });
        }
        return out;
      });
      const en1 = await battleRoots();
      assert.equal(en1.some((v) => v.kind === 'enemy'), true, `enemy views are among the field's units (${[...new Set(en1.map((v) => v.kind))].join(',')})`);
      await sleep(160);
      const en2 = await battleRoots();
      const ratios = en1.map((v) => { const n = en2.find((x) => x.k === v.k); return n && v.sx !== 0 ? n.sx / v.sx : null; }).filter((x) => x !== null);
      assert.ok(ratios.length >= en1.length - 1, 'every battle unit was sampled twice');
      assert.ok(Math.max(...ratios) - Math.min(...ratios) < 1e-9, 'every battle unit — enemies and allies — moves by the same factor');
      assert.ok(Math.abs(ratios[0] - 1) > 1e-6, `and it is moving (${ratios[0].toFixed(4)} per 160 ms)`);
      // a real press on a turning enemy opens its detail card (game.js: battle pick → detail)
      const aimFoe = () => c.page.evaluate(() => {
        const raw = globalThis.__SP_VIEW__.raw;
        for (const v of raw.debug.views.values()) {
          if (!v.root || !v.placed || v.culled || !v.info || v.info.kind !== 'enemy') continue;
          for (const dy of [0, -10, -20, -32, -48]) {
            const x = Math.round(v.screen.x), y = Math.round(v.screen.y + dy);
            if (!(x > 40 && y > 60)) continue;
            const el = document.elementFromPoint(x, y);
            if (!el || el.tagName !== 'CANVAS') continue;
            const hit = raw.debug.pick.battleUnitAt(x, y);
            if (hit && String(hit.id) === String(v.id)) return { x, y, id: String(hit.id) };
          }
        }
        return null;
      });
      let foe = null;
      for (let i = 0; i < 40 && !foe; i++) { foe = await aimFoe(); if (!foe) await sleep(250); }
      assert.ok(foe, 'an enemy can be aimed at while the field turns');
      await c.page.mouse.click(foe.x, foe.y);
      const foeShown = await c.page.waitForSelector('.dpanel', { timeout: 4000 }).then(() => true, () => false);
      assert.equal(foeShown, true, `a real press on the turning enemy (${foe.x},${foe.y}, ${foe.id}) opens its details`);
      await c.page.keyboard.press('Escape');
      await sleep(250);
      await plugEffect('dj-rotate', false);
      await sleep(250);
      assert.equal((await djState()).on, false, 'and it stops on the field too');

      // ---- prefers-reduced-motion: the effect is not applied at all ------------------------------------------
      await c.page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
      const reducedFieldBase = await fieldRoots();
      await frame2.evaluate(() => window.__DJ__.toggle());
      await sleep(800);
      const reduced = await c.page.evaluate(() => {
        const hud = document.querySelector('.gm__hud');
        return {
          playing: true, cls: hud.classList.contains('is-dj-rotate'), transform: getComputedStyle(hud).transform,
          anims: [...hud.querySelectorAll('*')].filter((el) => el.getAnimations && el.getAnimations().length > 0).length,
        };
      });
      assert.equal(await frame2.evaluate(() => window.__DJ__.isPlaying()), true, 'playing under reduced motion');
      assert.equal(reduced.cls, false, 'the class is not added under reduced motion');
      assert.equal(reduced.transform, 'none');
      assert.equal(reduced.anims, 0, 'nothing turns under reduced motion');
      assert.equal(((await djState()) || {}).on === true, false, 'the field is not turned under reduced motion either');
      assert.deepEqual(residue(await fieldRoots(), reducedFieldBase).changed, [], 'and no container scale was written');
      // the night-club lighting too: the host creates no neon box at all
      const neonReduced = await neon();
      assert.equal(neonReduced.roots, 0, 'dj-neon is not created under prefers-reduced-motion');
      assert.equal(neonReduced.anims, 0, 'and no neon animation runs');
      // the ui plugin's other visual too: units-gif stays off, and no unit is ever hidden
      const reducedBefore = await fieldState();
      await plugEffect('units-gif', true);
      await sleep(700);
      assert.equal((await gifState()).on, false, 'units-gif is not enabled under prefers-reduced-motion');
      assert.equal((await gifState()).sprites, 0, 'no stand-in is drawn under reduced motion');
      assert.deepEqual(hiddenKeys(await fieldState()), [], 'no unit was hidden under reduced motion');
      assert.equal((await fieldState()).world, reducedBefore.world, 'no layer was added under reduced motion');
      await frame2.evaluate(() => window.__DJ__.stop());
      await c.page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);
      await sleep(200);
      assert.equal(await c.page.evaluate(() => getComputedStyle(document.querySelector('.gm__hud')).transform), 'none');
      await plugEffect('units-gif', false);
      await sleep(200);

      assert.equal(await c.page.evaluate(() => document.querySelector('[data-ui-slot="hud.right"] iframe') !== null), true,
        'the frame is still mounted until the match is left');

      // ---- leaving the match: the host parks the frame, so the button can no longer be seen or clicked ---------
      // (the host keeps the sandboxed iframe alive but moves it to #sp-ui-park — hidden, aria-hidden — and
      //  re-mounts it on the next match; the plugin itself stops its audio before it is parked.)
      await c.page.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => (x.getAttribute('aria-label') || '').includes('离开')); if (b) b.click(); });
      await sleep(600);
      // the leave button opens a confirm dialog; take its primary button to actually leave
      await c.page.evaluate(() => {
        const box = document.querySelector('.modal__box');
        const b = box && [...box.querySelectorAll('button')].find((x) => (x.className || '').includes('btn--primary') || (x.className || '').includes('btn--danger'));
        if (b) b.click();
      });
      await sleep(3000);
      const after = await c.page.evaluate(() => {
        const f = document.querySelector('iframe[src*="/p/dj-wine/"]');
        const park = document.getElementById('sp-ui-park');
        return {
          screenCls: [...document.querySelectorAll('.screen')].map((s) => s.className).join(' | '),
          neon: document.querySelectorAll('.gm__neon').length,
          neonAnims: document.getAnimations().filter((a) => (a.animationName || '').indexOf('gm-neon') === 0).length,
          slotEl: !!document.querySelector('[data-ui-slot="hud.right"]'),
          slotFrame: document.querySelector('[data-ui-slot="hud.right"] iframe') !== null,
          anyFrame: !!f,
          visible: !!f && f.getBoundingClientRect().width > 1,
          inPark: !!f && !!park && park.contains(f),
          parkHidden: !!park && (park.hidden || park.getAttribute('aria-hidden') === 'true'),
        };
      });
      assert.match(after.screenCls, /lobby-screen/, 'the match screen was actually left');
      assert.equal(after.slotEl, false, 'the hud.right slot is gone with the match');
      assert.equal(after.slotFrame, false, 'no frame in the hud.right slot once the match is left');
      assert.equal(after.visible, false, 'the button is not visible off the match screen');
      assert.equal(after.inPark, true, 'the host parked the frame instead of dropping it');
      assert.equal(after.parkHidden, true, 'the park is hidden, so nothing of the plugin shows in the lobby');
      assert.equal(after.neon, 0, 'no neon box survives the match screen');
      assert.equal(after.neonAnims, 0, 'and no neon animation runs in the lobby');

      assert.deepEqual(errors, [], 'no console/page errors');
      assert.equal(after.slotFrame, false, 'no frame in the hud.right slot once the match is left');
      assert.equal(after.visible, false, 'the button is not visible off the match screen');
      assert.equal(after.inPark, true, 'the host parked the frame instead of dropping it');
      assert.equal(after.parkHidden, true, 'the park is hidden, so nothing of the plugin shows in the lobby');
      assert.equal(after.neon, 0, 'no neon box survives the match screen');
      assert.equal(after.neonAnims, 0, 'and no neon animation runs in the lobby');

      assert.deepEqual(errors, [], 'no console/page errors');
    } finally {
      await c.close();
      await srv.stop();
    }
  });
});


