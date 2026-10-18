// The three bundled DJ ui plugins (dj-wine / dj-amiya / dj-prss) — the two checks requested in one browser run:
//   SP_E2E=1 CHROME_PATH=<chromium> node --test test/ui/dj-progress.e2e.test.js
//
//   1. signature: 设置 → 界面插件 lists the three with the SAME author, `DJ-Amiya` (the `authors` of their
//      plugins/<id>/plugin.json, shown from the catalogue entry — public/js/ui/settings.js). A wrong name in one
//      manifest is a red row here; the screenshot is taken here too.
//   2. the progress bar of every one of the three: start → ~3 s → stop → start again and the bar is at 0 again and
//      counts up from there (the old bug: the music restarted from the beginning while the bar resumed where the last
//      session stopped). Stopping, closing the panel (✕) and leaving the match all put it back to 0. The values are
//      read from the page itself (`#fill`'s width, `#clock`'s text and the plugin's own `position()`), not from a
//      screenshot.
// The match is a real one (独立模拟 → 标准模拟 → 休整期) on a temporary port of its own; servers and browser are
// torn down at the end. Not part of the default run.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Client, OUT, ROOT, hasChrome, startRealServer } from '../e2e/client.mjs';

const ENABLED = process.env.SP_E2E === '1' && hasChrome();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const FRAME_RE = (id) => new RegExp(`/p/${id}/[0-9a-f]{8}/ui/index\\.html$`);
const frameOf = (c, id) => c.page.frames().find((f) => FRAME_RE(id).test(f.url()));
/** The read-only handle each plugin page exposes for a test to read its audio clock. */
const HOOKS = { 'dj-wine': '__DJ__', 'dj-amiya': '__AMIYA__', 'dj-prss': '__PRSS__' };
/** The three pages are built from plugins-src/<id>/index.template.html. */
const PLUGINS = ['dj-wine', 'dj-amiya', 'dj-prss'];
/** `mm:ss` → seconds (the panel's clock). */
const clockSeconds = (s) => { const m = /^(\d+):(\d\d)/.exec(s); return m ? Number(m[1]) * 60 + Number(m[2]) : NaN; };

async function enterLobby(c) {
  await c.enter('凯尔希');
  await c.page.waitForSelector('.lobby-screen', { timeout: 20000 });
}

async function startMatch(c) {
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

describe('the three bundled DJ plugins: one signature, and a progress bar that restarts at 0', { skip: !ENABLED }, () => {
  test('设置 → 界面插件 signs all three DJ-Amiya, and every plugin restarts its progress at 0', { timeout: 9 * 60 * 1000 }, async () => {
    for (const id of PLUGINS) {
      assert.ok(fs.existsSync(path.join(ROOT, 'plugins', id, 'ui/index.html')), `${id}: run node plugins-src/${id}/build-page.mjs first`);
    }
    const srv = await startRealServer({ fast: { timerScale: 1, combatSpeed: 2, startRound: 1 } });
    const P = (await import('puppeteer-core')).default;
    const c = new Client(P, srv.base, 'solo', { prefix: 'dj-progress', w: 1600, h: 900 });
    const errors = [];
    try {
      await c.open();
      c.page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
      c.page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

      // ---- (1) the signature in 设置 → 界面插件 ---------------------------------------------------------------
      await c.page.waitForSelector('.title-login input', { timeout: 20000 });
      await c.page.evaluate(() => {
        localStorage.setItem('sp.pref.ui-plugins', JSON.stringify(['dj-wine', 'dj-amiya', 'dj-prss']));
        localStorage.removeItem('sp.name');
      });
      await c.page.reload({ waitUntil: 'domcontentloaded' });
      await c.page.waitForSelector('.screen', { timeout: 20000 });
      await enterLobby(c);
      await c.page.click('.lobby-screen [data-testid="settings-btn"]');
      await c.page.waitForSelector('.modal [data-testid="ui-plugins"] .set-row[data-plugin="dj-wine"]', { timeout: 20000 });
      const rows = await c.page.evaluate((ids) => {
        const out = {};
        for (const id of ids) {
          const row = document.querySelector(`[data-testid="ui-plugins"] .set-row[data-plugin="${id}"]`);
          out[id] = row ? { text: row.textContent.replace(/\s+/g, ' ').trim(), authors: row.dataset.authors || '' } : null;
        }
        return out;
      }, PLUGINS);
      for (const id of PLUGINS) {
        assert.ok(rows[id], `${id} is listed in 设置 → 界面插件`);
        assert.equal(rows[id].authors, 'DJ-Amiya', `${id}: the row's author is DJ-Amiya (got ${JSON.stringify(rows[id].authors)})`);
        assert.match(rows[id].text, /作者 DJ-Amiya/, `${id}: the row shows 作者 DJ-Amiya (${rows[id].text})`);
        assert.doesNotMatch(rows[id].text, /作者 hex/, `${id}: the old signature is gone`);
      }
      // the section itself: scroll the settings body down to it and shoot its box. `captureBeyondViewport: false` is
      // what makes a clipped shot of a scrolled inner container faithful (Chrome re-lays out the page otherwise and
      // resets the modal's own scroll, so the crop shows the section's old place).
      await c.page.evaluate(() => { const sc = document.querySelector('.modal__body'); sc.scrollTop = sc.scrollHeight; });
      await sleep(500);
      const box = await c.page.evaluate(() => {
        const s = document.querySelector('[data-testid="ui-plugins"]');
        const r = s.getBoundingClientRect();
        return { x: Math.max(0, Math.round(r.left - 10)), y: Math.max(0, Math.round(r.top - 10)), w: Math.round(r.width + 20), h: Math.round(r.height + 20) };
      });
      assert.ok(box.w > 300 && box.h > 80, `the 界面插件 section is on screen (${JSON.stringify(box)})`);
      await c.page.screenshot({
        path: path.join(OUT, 'dj-progress-settings-authors.png'),
        clip: { x: box.x, y: box.y, width: box.w, height: Math.min(900 - box.y, box.h) },
        captureBeyondViewport: false,
      });
      await c.page.keyboard.press('Escape');
      await sleep(300);

      // ---- into a real match ----------------------------------------------------------------------------------
      await startMatch(c);
      await c.page.waitForSelector('[data-ui-slot="hud.right"] iframe', { timeout: 20000 });
      await c.page.waitForSelector('[data-ui-slot="hud.left"] iframe', { timeout: 20000 });
      await c.page.waitForSelector('[data-ui-slot="hud.left2"] iframe', { timeout: 20000 });
      const frames = {};
      for (const id of PLUGINS) {
        frames[id] = frameOf(c, id);
        assert.ok(frames[id], `${id} is mounted in its slot`);
        await frames[id].waitForSelector('#btn', { timeout: 10000 });
        await frames[id].waitForFunction((n) => !!window[n] && !!window[n].placed && window[n].placed(), { timeout: 15000 }, HOOKS[id]);
      }

      // ---- (2) per plugin: start → 3 s → stop → start means the bar is at 0 again ---------------------------
      for (const id of PLUGINS) {
        const fr = frames[id];
        const hook = HOOKS[id];
        const state = () => fr.evaluate((n) => ({
          playing: !!(window[n] && window[n].isPlaying()),
          open: !!(window[n] && window[n].panelOpen()),
          pos: window[n] && window[n].position ? window[n].position() : null,
          width: parseFloat(document.getElementById('fill').style.width) || 0,
          clock: document.getElementById('clock').textContent.trim(),
        }), hook);

        // start
        await fr.click('#btn');
        await fr.waitForFunction((n) => window[n] && window[n].isPlaying(), { timeout: 15000 }, hook);
        const started = await state();
        assert.equal(started.open, true, `${id}: the click opens the panel`);
        assert.ok(started.pos < 1, `${id}: the first start begins at 0 (${started.pos.toFixed(2)} s)`);
        assert.ok(started.width < 8, `${id}: the bar starts empty (${started.width}%)`);

        // three seconds in it has really moved
        await sleep(3000);
        const mid = await state();
        assert.ok(mid.pos > 2.4, `${id}: after ~3 s the progress advanced (${mid.pos.toFixed(2)} s)`);
        assert.ok(mid.width > 2, `${id}: the bar grew (${mid.width}%)`);
        assert.ok(clockSeconds(mid.clock) >= 2, `${id}: the clock counts up (${mid.clock})`);

        // stop: everything back to 0
        await fr.evaluate((n) => window[n].stop(), hook);
        await fr.waitForFunction((n) => !window[n].isPlaying(), { timeout: 10000 }, hook);
        const stopped = await state();
        assert.equal(stopped.pos, 0, `${id}: stopping puts the progress back to 0`);
        assert.equal(stopped.width, 0, `${id}: and the bar to 0% (${stopped.width})`);
        assert.equal(clockSeconds(stopped.clock), 0, `${id}: the clock reads 00:00 (${stopped.clock})`);

        // start again: the bar must be at 0 and count up from there (the music starts from the beginning too)
        await fr.click('#btn');
        await fr.waitForFunction((n) => window[n].isPlaying(), { timeout: 15000 }, hook);
        const restarted = await state();
        assert.ok(restarted.pos < 1, `${id}: the second start begins at 0 again (${restarted.pos.toFixed(2)} s)`);
        assert.ok(restarted.width < 8, `${id}: the bar restarts empty (${restarted.width}%)`);
        assert.equal(clockSeconds(restarted.clock), 0, `${id}: the clock restarts at 00:00 (${restarted.clock})`);
        await c.page.screenshot({ path: path.join(OUT, `dj-progress-reset-${id}.png`) });
        await sleep(600);
        const grown = await state();
        assert.ok(grown.pos > restarted.pos, `${id}: and it counts up from there (${restarted.pos.toFixed(2)} → ${grown.pos.toFixed(2)} s)`);

        // the ✕ close also zeroes the bar (the music may keep playing; the bar is what is asked to reset)
        await fr.click('#close');
        await sleep(250);
        const closed = await state();
        assert.equal(closed.open, false, `${id}: ✕ closes the panel`);
        assert.equal(closed.width, 0, `${id}: closing the panel zeroes the bar`);
        assert.equal(clockSeconds(closed.clock), 0, `${id}: and the clock (${closed.clock})`);
        await fr.evaluate((n) => window[n].stop(), hook);
        await fr.waitForFunction((n) => !window[n].isPlaying(), { timeout: 10000 }, hook);
      }

      assert.deepEqual(errors, [], 'no console / page errors');
    } finally {
      await c.close();
      await srv.stop();
    }
  });
});
