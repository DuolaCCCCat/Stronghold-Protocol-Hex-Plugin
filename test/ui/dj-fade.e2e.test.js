// The four DJ buttons' 1-second fade-out (plugins-src/dj-wine, dj-amiya, dj-prss, dj-wine-2). Not part of the default run.
//   SP_E2E=1 node --test test/ui/dj-fade.e2e.test.js
//
// Each plugin's page plays through `source → gain → analyser → destination`. Stopping ramps that gain to 0 over 1.0 s
// and only then stops the source, so the sound fades instead of cutting. This test, in a real Edge tab with a real
// AudioContext, plays each of the four buttons for ≥2 s and then stops it, sampling the Analyser's **time-domain RMS**
// (and the live gain / the number of sources still sounding) every ~20 ms.
//
// Music is not a test tone: its own loudness moves from bar to bar, so a raw RMS window can go UP while the volume
// goes down. The test therefore plays the SAME 2 s of the track twice — once as a control (no stop) and once with the
// stop — and divides the two RMS curves at the same track positions; that ratio is the audible volume curve, and it
// must follow the 1.0 → 0 ramp (≈1 / .75 / .5 / .25 / 0 at 0 / .25 / .5 / .75 / 1.0 s). It also checks:
//   * the signal is still there right after the stop (not a hard cut);
//   * after 1.1 s the source is over (`activeSources() === 0`) and the Analyser reads 0 — no residual audio;
//   * a second playback starts from a fresh gain of 1 and is audible again;
//   * the leave path (`pagehide` → the plugin's kill) fades the same way and closes the AudioContext only after it;
//   * no console / page errors.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Client, ROOT, hasChrome, startRealServer } from '../e2e/client.mjs';

const ENABLED = process.env.SP_E2E === '1' && hasChrome();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const FRAME_RE = (id) => new RegExp(`/p/${id}/[0-9a-f]{8}/ui/index\\.html$`);
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

/**
 * Play 2 s of the track and sample 1.1 s as a control (no stop); then replay the same 2 s, stop, and sample the fade.
 * The two runs read the same musical content at the same offsets, so `fade / control` is the gain curve.
 */
const fadeOnce = (fr, handle, { leave = false } = {}) => fr.evaluate(async (h, leaveMatch) => {
  const H = window[h];
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const sample = async (ms) => {
    const t0 = performance.now();
    const rows = [];
    for (;;) {
      const t = performance.now() - t0;
      rows.push({ t, rms: H.rms(), gain: H.gain(), active: H.activeSources(), playing: H.isPlaying() });
      if (t >= ms) break;
      await wait(20);
    }
    return rows;
  };
  if (!H.isPlaying()) H.toggle();
  // wait for the source to actually start (the first playback decodes the mp3 asynchronously): both the control and
  // the fade run must be sampled at the same musical position, so the 2 s clock starts when playback does
  while (!H.isPlaying()) await wait(10);
  await wait(2000);
  const control = await sample(1100);
  H.toggle();                       // stop the control playback (its own fade is not measured)
  await wait(1200);
  H.toggle();                       // replay the same track from 0
  while (!H.isPlaying()) await wait(10);
  await wait(2000);
  const t0 = performance.now();
  if (leaveMatch) window.dispatchEvent(new Event('pagehide'));
  else H.toggle();
  const fade = [];
  for (;;) {
    const t = performance.now() - t0;
    fade.push({ t, rms: H.rms(), gain: H.gain(), active: H.activeSources(), playing: H.isPlaying() });
    if (t > 1400) break;
    await wait(20);
  }
  return { control, fade };
}, handle, leave);

const windowAvg = (rows, a, b) => {
  const xs = rows.filter((s) => s.t >= a && s.t < b);
  return xs.length ? xs.reduce((sum, x) => sum + x.rms, 0) / xs.length : 0;
};
const nearest = (rows, t) => rows.reduce((best, s) => (Math.abs(s.t - t) < Math.abs(best.t - t) ? s : best), rows[0]);
/** RMS at `t` averaged over ±60 ms in both runs, then the fade/control ratio (≈ the gain at that time). */
const ratioAt = (control, fade, t) => {
  const c = windowAvg(control, t - 60, t + 60);
  const f = windowAvg(fade, t - 60, t + 60);
  return c > 1e-6 ? f / c : 0;
};

/** The assertions every one of the four fade-outs has to pass (and the leave path too). */
function checkFade(id, { control, fade }) {
  const base = windowAvg(control, 0, 100);
  assert.ok(base > 0.005, `${id}: the track is really audible before the stop (RMS ${base.toFixed(4)})`);
  assert.equal(fade[0].playing, false, `${id}: the button is "stopped" at once (the UI does not wait for the fade)`);
  // 1. not a hard cut: the gain is still ~1 just after the stop, and the RMS ratio right after it is not near 0
  const r0 = ratioAt(control, fade, 40);
  assert.ok(r0 > 0.55, `${id}: the sound does not cut at the stop (RMS ratio 0-80 ms ${r0.toFixed(3)})`);
  assert.ok(nearest(fade, 40).gain > 0.9, `${id}: the gain is still ~1 just after the stop (${nearest(fade, 40).gain.toFixed(3)})`);
  // 2. the audible volume follows the 1 s ramp: ≈ .75 / .5 / .25 / 0
  const r250 = ratioAt(control, fade, 250);
  const r500 = ratioAt(control, fade, 500);
  const r750 = ratioAt(control, fade, 750);
  const r1000 = ratioAt(control, fade, 1000);
  assert.ok(r250 > 0.6 && r250 < 0.92, `${id}: volume at 0.25 s (${r250.toFixed(3)})`);
  assert.ok(r500 > 0.35 && r500 < 0.72, `${id}: volume at 0.5 s (${r500.toFixed(3)})`);
  assert.ok(r750 > 0.08 && r750 < 0.48, `${id}: volume at 0.75 s (${r750.toFixed(3)})`);
  assert.ok(r1000 < 0.15, `${id}: volume at 1.0 s (${r1000.toFixed(3)})`);
  assert.ok(r250 > r500 && r500 > r750 && r750 > r1000,
    `${id}: the audible volume falls monotonically through the ramp (${[r250, r500, r750, r1000].map((x) => x.toFixed(3)).join(' > ')})`);
  // 3. the gain itself rides the ramp
  const g250 = nearest(fade, 250).gain, g500 = nearest(fade, 500).gain, g750 = nearest(fade, 750).gain, g1000 = nearest(fade, 1000).gain;
  assert.ok(g250 > 0.55 && g250 < 0.98, `${id}: gain at 0.25 s is on the ramp (${g250.toFixed(3)})`);
  assert.ok(g500 > 0.25 && g500 < 0.75, `${id}: gain at 0.5 s is on the ramp (${g500.toFixed(3)})`);
  assert.ok(g750 > 0.02 && g750 < 0.52, `${id}: gain at 0.75 s is on the ramp (${g750.toFixed(3)})`);
  assert.ok(g1000 < 0.1, `${id}: gain at 1.0 s is ~0 (${g1000.toFixed(3)})`);
  // 4. after 1.1 s: the source has ended and the analyser reads 0 — no residual audio
  const late = fade.filter((s) => s.t >= 1100);
  assert.ok(late.length > 5, `${id}: samples after 1.1 s (${late.length})`);
  assert.equal(Math.max(...late.map((s) => s.active)), 0, `${id}: the source is over after 1.1 s`);
  assert.ok(Math.max(...late.map((s) => s.rms)) < 0.0005,
    `${id}: the Analyser reads 0 after 1.1 s (max ${Math.max(...late.map((s) => s.rms)).toFixed(6)})`);
  console.log(`[fade] ${id}`, JSON.stringify({
    rms: [ratioAt(control, fade, 0), r250, r500, r750, r1000].map((x) => +x.toFixed(3)),
    gain: [g250, g500, g750, g1000].map((x) => +x.toFixed(3)),
    rmsAfter: +Math.max(...late.map((s) => s.rms)).toFixed(6),
    activeAfter: Math.max(...late.map((s) => s.active)),
  }));
}

describe('the four DJ buttons fade their music out over 1 s', { skip: !ENABLED }, () => {
  test('each button ramps gain to 0 over 1 s, leaves no residual audio, and plays again from a fresh gain', { timeout: 7 * 60 * 1000 }, async () => {
    for (const id of ['dj-wine', 'dj-amiya', 'dj-prss', 'dj-wine-2']) {
      assert.ok(fs.existsSync(path.join(ROOT, 'plugins', id, 'ui/index.html')), `${id}: run its build-page.mjs first`);
    }
    const srv = await startRealServer({ fast: { timerScale: 1, combatSpeed: 2, startRound: 1, autoPlace: true } });
    const P = (await import('puppeteer-core')).default;
    const c = new Client(P, srv.base, 'solo', { prefix: 'dj-fade', w: 1600, h: 900 });
    const errors = [];
    try {
      await c.open();
      c.page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
      c.page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
      await c.page.waitForSelector('.title-login input', { timeout: 20000 });
      await c.page.evaluate(() => {
        localStorage.setItem('sp.pref.ui-plugins', JSON.stringify(['dj-wine', 'dj-amiya', 'dj-prss', 'dj-wine-2']));
        localStorage.removeItem('sp.name');
      });
      await c.page.reload({ waitUntil: 'domcontentloaded' });
      await c.page.waitForSelector('.screen', { timeout: 20000 });
      await reachPrep(c);
      for (const slot of ['hud.right', 'hud.left', 'hud.left2', 'hud.left3']) {
        await c.page.waitForSelector(`[data-ui-slot="${slot}"] iframe`, { timeout: 20000 });
      }
      const BUTTONS = [
        ['dj-wine', frameOf(c, 'dj-wine'), '__DJ__'],
        ['dj-amiya', frameOf(c, 'dj-amiya'), '__AMIYA__'],
        ['dj-prss', frameOf(c, 'dj-prss'), '__PRSS__'],
        ['dj-wine-2', frameOf(c, 'dj-wine-2'), '__WINE2__'],
      ];
      for (const [id, fr] of BUTTONS) assert.ok(fr, `${id}: its page is mounted`);

      const handles = new Map();
      for (const [id, fr, handle] of BUTTONS) {
        await fr.waitForFunction((h) => window[h] && window[h].placed(), { timeout: 10000 }, handle);
        handles.set(id, { fr, handle });
        // control + fade curves (same 2 s of the same track)
        const r = await fadeOnce(fr, handle);
        checkFade(id, r);
        // start again: a fresh GainNode at 1, and the new segment is audible from the beginning
        await fr.evaluate((h) => window[h].toggle(), handle);
        await fr.waitForFunction((h) => window[h].isPlaying(), { timeout: 10000 }, handle);
        await sleep(400);
        const again = await fr.evaluate((h) => ({
          gain: window[h].gain(), rms: window[h].rms(), pos: window[h].position(),
        }), handle);
        assert.ok(again.gain === 1, `${id}: a new playback resets the gain to 1 (${again.gain})`);
        assert.ok(again.rms > 0.003, `${id}: and is audible again (RMS ${again.rms.toFixed(4)})`);
        assert.ok(again.pos > 0.1 && again.pos < 1.2, `${id}: and starts from the beginning (${again.pos.toFixed(2)} s)`);
        await fr.evaluate((h) => window[h].toggle(), handle);
        await fr.waitForFunction((h) => window[h].activeSources() === 0, { timeout: 4000 }, handle);
      }

      // ---- the leave path: the plugin's kill() fades first and closes the AudioContext only after the ramp ----------
      const last = handles.get('dj-wine-2');
      const leaveFade = await fadeOnce(last.fr, last.handle, { leave: true });
      checkFade('dj-wine-2 (leave)', leaveFade);
      await sleep(200);
      assert.equal(await last.fr.evaluate((h) => window[h].activeSources(), last.handle), 0, 'leave: no source survives the fade');
      assert.equal(await last.fr.evaluate((h) => window[h].ctxState(), last.handle), 'closed', 'leave: the AudioContext is closed after the fade');

      assert.deepEqual(errors, [], 'no console/page errors');
    } finally {
      await c.close();
      await srv.stop();
    }
  });
});
