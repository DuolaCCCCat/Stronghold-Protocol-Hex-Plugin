// test/ui/dj-rotate.test.js — the canvas half of the ui plugins' `dj-rotate` visual (render/djRotate.js).
//
// No browser here: the module's factors are pure arithmetic and its engine only touches `root.scale` on whatever the
// field view's map holds, so a fake container is enough. What this pins:
//   1. the parameters are the reference mod's own defaults (67 frames/turn, 38 frames/squash, 60% height, 110% width,
//      one shared phase — cyanfish.dj-all config.js:129-135 at FPS 60), and they are what a plugin that sends no `tune`
//      gets. The owner's speed is NOT baked in here: it travels in one plugin's `effect` message (`tune`), so the other
//      buttons keep these numbers;
//   2. a `tune` (`{ turn, squash, pulse }`, the three numbers of shared/plugins/ui.js UI_ROTATE_TUNE) changes the three
//      periods/ratios and nothing else, and `resolveTune` falls back to the reference for what it does not get;
//   3. the turn is the DOM animation's own `cos θ` sampling (8 stops a turn), the pulse its `.4 / .4 / .2` profile;
//   4. switching it on multiplies each container's **own** scale, never writes rotation, and switching it off puts the
//      exact numbers back (not `1`) — a missing restore or a missing write fails here; a handover to another plugin's
//      numbers swaps the periods and starts them together, leaving every baseline untouched;
//   5. rounds do not accumulate, a view that appears while it is on gets its own baseline, one that leaves the field is
//      forgotten, and `prefers-reduced-motion: reduce` refuses it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TURN_PERIOD, SQUASH_PERIOD, SQUASH_MIN, WIDTH_MAX,
  turnAt, squashAt, factorsAt, resolveTune, createDjRotate,
} from '../../public/js/render/djRotate.js';

/** A PIXI.Container-ish object: only what the engine reads and writes. */
function root(sx, sy) {
  return { destroyed: false, rotation: 0.3, scale: { x: sx, y: sy, set(x, y) { this.x = x; this.y = y; } } };
}
function view(sx, sy, kind = 'chess') {
  return { destroyed: false, info: { kind }, root: root(sx, sy) };
}
/** A clock the test moves by hand. */
function clock() {
  let t = 1000;
  return { now: () => t, at(ms) { t = 1000 + ms; } };
}

test('the parameters are the reference defaults (a plugin may override them, this module may not)', () => {
  // 67 frames per turn at 60 fps, 38 frames per squash, squashMinPct 60, widthMaxPct 110 (config.js:129-135).
  // ★ These are the defaults the other three buttons get. 粥友的酒's faster/deeper look is its own `tune`, sent in its
  // effect message — so writing it here (the way the owner's hand-tuning once did) would silently change every button.
  assert.equal(TURN_PERIOD, 67 / 60, '67 frames per turn at 60 fps = 1.116667 s');
  assert.ok(Math.abs(TURN_PERIOD - 1.116667) < 1e-6);
  assert.equal(SQUASH_PERIOD, 38 / 60, '38 frames per squash = .633333 s');
  assert.ok(Math.abs(SQUASH_PERIOD - 0.633333) < 1e-6);
  assert.equal(SQUASH_MIN, 0.6, 'down to 60% of the height');
  assert.equal(WIDTH_MAX, 1.1, 'out to 110% of the width');
  assert.deepEqual(resolveTune(null), { turn: TURN_PERIOD, squash: 0.4, pulse: SQUASH_PERIOD },
    'no tune = exactly the reference numbers (40% of the height taken away)');
});


test('the turn is the DOM animation\'s cos θ sampling and the pulse its .4 / .4 / .2 profile', () => {
  // the eight stops of `gm-dj-turn` (public/css/screens/game.css:44-46): cos 0°, 45°, … 315°
  const expected = [1, Math.SQRT1_2, 0, -Math.SQRT1_2, -1, -Math.SQRT1_2, 0, Math.SQRT1_2];
  expected.forEach((want, i) => {
    const got = turnAt((i * TURN_PERIOD) / expected.length);
    assert.ok(Math.abs(got - want) < 1e-12, `stop ${i}: ${got} should be ${want}`);
  });
  assert.equal(turnAt(0), 1, 'it starts wide (the element faces the viewer)');
  assert.ok(Math.abs(turnAt(TURN_PERIOD * 0.25) - 0) < 1e-12, 'a quarter of the period is edge-on');
  assert.ok(Math.abs(turnAt(TURN_PERIOD) - 1) < 1e-12, 'one turn brings it back');
  assert.ok(Math.abs(turnAt(TURN_PERIOD * 0.5) + 1) < 1e-12, 'half a turn is the mirrored side');
  assert.ok(turnAt(TURN_PERIOD * 0.375) < 0, 'the far half is mirrored (a negative width, as the reference allows)');
  // squash: 0 → 1 at 40% → 0 at 80% → rest for the last 20%
  assert.equal(squashAt(0), 0);
  assert.ok(Math.abs(squashAt(SQUASH_PERIOD * 0.4) - 1) < 1e-12, '40% of the period is the lowest point');
  assert.ok(Math.abs(squashAt(SQUASH_PERIOD * 0.2) - 0.5) < 1e-12, 'the way down is linear');
  assert.ok(Math.abs(squashAt(SQUASH_PERIOD * 0.6) - 0.5) < 1e-12, 'and the way up too');
  assert.equal(squashAt(SQUASH_PERIOD * 0.8), 0, 'it is back at its own height at 80%');
  assert.equal(squashAt(SQUASH_PERIOD * 0.95), 0, 'and rests for the last 20% (that is the beat)');
  assert.equal(squashAt(SQUASH_PERIOD), 0, 'the pulse loops');
  // the full factor set at the lowest point: 110% wide × cos, 60% high
  const peak = factorsAt(SQUASH_PERIOD * 0.4);
  assert.ok(Math.abs(peak.s - 1) < 1e-12);
  assert.ok(Math.abs(peak.y - 0.6) < 1e-12, `the height at the lowest point is 60% (${peak.y})`);
  assert.ok(Math.abs(peak.x - WIDTH_MAX * turnAt(SQUASH_PERIOD * 0.4)) < 1e-12);
  // at rest it is the identity in height; the width is the turn alone
  const rest = factorsAt(0);
  assert.equal(rest.y, 1);
  assert.equal(rest.x, 1);
});

test('a tune moves the three numbers and nothing else (the 粥友的酒 look, per plugin)', () => {
  // 粥友的酒's numbers (plugins-src/dj-wine/index.template.html): ×1.15 the turn, 48% taken away, ×1.375 the pulse.
  const tune = { turn: 0.971014, squash: 0.48, pulse: 0.460605 };
  assert.deepEqual(resolveTune(tune), tune, 'a full tune is what the module draws with');
  // the turn is the same 8-stop cos, just faster
  assert.equal(turnAt(0, tune), 1);
  assert.ok(Math.abs(turnAt(tune.turn / 4, tune)) < 1e-12, 'a quarter of the tuned turn is edge-on');
  const refEdge = turnAt(TURN_PERIOD / 4);
  assert.equal(refEdge, 0, 'the reference is edge-on at its own quarter');
  assert.notEqual(turnAt(TURN_PERIOD / 4, tune), 0, 'and at the tuned speed the reference quarter is somewhere else');
  // the pulse keeps its .4 / .4 / .2 profile, on the tuned period
  assert.ok(Math.abs(squashAt(tune.pulse * 0.4, tune) - 1) < 1e-12);
  assert.equal(squashAt(tune.pulse * 0.8, tune), 0);
  assert.equal(squashAt(tune.pulse * 0.95, tune), 0);
  assert.notEqual(squashAt(SQUASH_PERIOD * 0.8, tune), 0, 'the tuned pulse is not the reference pulse');
  // the depth: 48% of the height taken away ⇒ 52% at the lowest, the width still 110%
  const peak = factorsAt(tune.pulse * 0.4, tune);
  assert.ok(Math.abs(peak.y - 0.52) < 1e-12, `52% high at the lowest point (${peak.y})`);
  assert.ok(Math.abs(peak.x - 1.1 * turnAt(tune.pulse * 0.4, tune)) < 1e-12);
  assert.equal(factorsAt(0, tune).y, 1, 'and at rest the height is its own again');
  // partial / junk tunes fall back per field, never to a 0 or a NaN
  assert.deepEqual(resolveTune({ squash: 0.48 }), { turn: TURN_PERIOD, squash: 0.48, pulse: SQUASH_PERIOD });
  assert.deepEqual(resolveTune({ turn: 999 }), { turn: TURN_PERIOD, squash: 0.4, pulse: SQUASH_PERIOD }, 'out of range = reference');
  assert.deepEqual(resolveTune({ pulse: -1 }), { turn: TURN_PERIOD, squash: 0.4, pulse: SQUASH_PERIOD });
  assert.deepEqual(resolveTune({ nope: 1 }), { turn: TURN_PERIOD, squash: 0.4, pulse: SQUASH_PERIOD }, 'unknown key = reference');
  assert.deepEqual(resolveTune({ turn: NaN, squash: '0.48' }), { turn: TURN_PERIOD, squash: 0.4, pulse: SQUASH_PERIOD });
  // the engine draws with the tune it was handed, and its stats report it (the dev / e2e reading)
  const c = clock();
  const views = new Map([['a', view(0.5, 0.5)]]);
  const eng = createDjRotate({ views, now: c.now, tune });
  eng.setOn(true);
  assert.deepEqual(
    { turn: eng.stats().turn, squash: eng.stats().squash, pulse: eng.stats().pulse }, tune);
  c.at(200);
  eng.tick();
  const k = factorsAt(0.2, tune);
  assert.ok(Math.abs(views.get('a').root.scale.y - 0.5 * k.y) < 1e-12);
  eng.setOn(false);
});


test('a handover to another plugin\'s numbers swaps the periods without touching the baselines', () => {
  const c = clock();
  const views = new Map([['a', view(0.5, 0.5)]]);
  const eng = createDjRotate({ views, now: c.now });
  const a = views.get('a').root;
  assert.equal(eng.setOn(true), true, 'the first plugin asks with no tune ⇒ the reference defaults');
  assert.deepEqual({ turn: eng.stats().turn, squash: eng.stats().squash, pulse: eng.stats().pulse },
    { turn: TURN_PERIOD, squash: 0.4, pulse: SQUASH_PERIOD });
  c.at(200);
  eng.tick();

  // the first plugin lets go while a second still asks: the visual stays on, at the SECOND plugin's own numbers
  const tune = { turn: 0.971014, squash: 0.48, pulse: 0.460605 };
  assert.equal(eng.setOn(true, tune), true, 'still on — a handover, not an off');
  assert.deepEqual([a.scale.x, a.scale.y], [0.5, 0.5], 'it restarts at t = 0, the identity, with the container\'s own baseline');
  assert.deepEqual({ turn: eng.stats().turn, squash: eng.stats().squash, pulse: eng.stats().pulse }, tune);
  c.at(400);                                // 200 ms into the new pulse
  eng.tick();
  const k = factorsAt(0.2, tune);
  assert.ok(Math.abs(a.scale.x - 0.5 * k.x) < 1e-12, 'the new period drives the frame');
  assert.ok(Math.abs(a.scale.y - 0.5 * k.y) < 1e-12);
  assert.equal(a.rotation, 0.3, 'the handover never writes rotation either');

  // and off still puts the exact numbers back, whichever tune was in force
  assert.equal(eng.setOn(false), false);
  assert.deepEqual([a.scale.x, a.scale.y], [0.5, 0.5]);
  assert.equal(eng.stats().containers, 0, 'nothing of either plugin is remembered');
});

test('on multiplies each container\'s own scale, off puts the exact numbers back', () => {
  const c = clock();
  const views = new Map([['a', view(0.5, 0.5)], ['b', view(0.37, 1.13)]]);
  const eng = createDjRotate({ views, now: c.now });
  const [a, b] = [...views.values()].map((v) => v.root);
  const before = [[a.scale.x, a.scale.y], [b.scale.x, b.scale.y]];
  assert.equal(eng.setOn(false), false, 'off before it was ever on does nothing');

  assert.equal(eng.setOn(true), true);
  assert.equal(eng.on, true);
  assert.deepEqual([a.scale.x, a.scale.y], before[0], 'at t = 0 the factor is the identity');
  assert.deepEqual([b.scale.x, b.scale.y], before[1]);

  c.at(200);                               // past the first squash's lowest point, off the turn's stops
  eng.tick();
  const k = factorsAt(0.2);
  assert.ok(Math.abs(a.scale.x - 0.5 * k.x) < 1e-12, `the root's own width is multiplied (${a.scale.x})`);
  assert.ok(Math.abs(b.scale.y - 1.13 * k.y) < 1e-12, `and its own height (${b.scale.y})`);
  assert.notDeepEqual([a.scale.x, a.scale.y], before[0], 'it really moved');
  assert.equal(a.rotation, 0.3, 'the turn is a width multiplier: rotation is never written');
  assert.equal(b.rotation, 0.3);

  assert.equal(eng.setOn(false), false);
  assert.deepEqual([a.scale.x, a.scale.y], before[0], 'the width is the number it had, not 1');
  assert.deepEqual([b.scale.x, b.scale.y], before[1]);
  assert.equal(eng.stats().containers, 0, 'nothing is remembered any more');
  assert.equal(a.rotation, 0.3);
});

test('rounds do not accumulate, late views get a baseline, gone views are forgotten, reduced motion refuses', () => {
  const c = clock();
  const views = new Map([['a', view(1, 1)]]);
  const eng = createDjRotate({ views, now: c.now });
  const a = views.get('a').root;
  const original = [a.scale.x, a.scale.y];
  for (let i = 0; i < 3; i++) {
    eng.setOn(true);
    c.at(120 + i * 100);
    eng.tick();
    eng.setOn(false);
    assert.deepEqual([a.scale.x, a.scale.y], original, `round ${i + 1} ends exactly where it started`);
  }

  // a piece deployed while it is on: picked up on the next frame with its own (non-identity) baseline
  c.at(500);
  eng.setOn(true);
  const late = view(0.25, 0.8);
  views.set('late', late);
  c.at(680);                               // 180 ms later: the pulse is on its way down, the turn is off its stops
  eng.tick();
  assert.equal(eng.stats().containers, 2, 'the new view is one more container');
  const k = factorsAt(0.18);
  assert.ok(Math.abs(late.root.scale.x - 0.25 * k.x) < 1e-12);
  assert.ok(Math.abs(late.root.scale.y - 0.8 * k.y) < 1e-12);
  views.delete('late');
  late.destroyed = true;
  late.root.destroyed = true;              // a destroyed view takes its container with it (units.js destroy)
  c.at(880);
  eng.tick();
  assert.equal(eng.stats().containers, 1, 'a view that left the field is forgotten (its container is destroyed)');
  eng.setOn(false);
  assert.deepEqual([a.scale.x, a.scale.y], original, 'and the surviving container is restored');

  // prefers-reduced-motion: reduce leaves it off, and nothing is written
  const prev = globalThis.matchMedia;
  globalThis.matchMedia = (q) => ({ matches: q === '(prefers-reduced-motion: reduce)', media: q });
  try {
    assert.equal(eng.setOn(true), false, 'reduced motion refuses the effect');
    assert.equal(eng.on, false);
    assert.deepEqual([a.scale.x, a.scale.y], original);
  } finally {
    if (prev === undefined) delete globalThis.matchMedia; else globalThis.matchMedia = prev;
  }
});
