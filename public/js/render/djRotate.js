// render/djRotate.js — the canvas half of the host visual `dj-rotate` (shared/plugins/ui.js `UI_EFFECTS`,
// docs/PLUGINS.md §14).
//
// The DOM half is one class on the battle HUD (public/css/screens/game.css:36-68): every part of the HUD turns about
// its own centre — a `cos θ` horizontal turn and a squash pulse — and the class leaving puts every part back at its own
// `scale`. Nothing in that stylesheet reaches the field, because the field is a canvas. This file is the same 整活 on
// what the canvas draws: the **pieces, enemies and items on the board** turn and are squashed with the HUD, from the
// same clock, at the same parameters, in the same phase (the reference applies it to both engines, and the host visual
// is one switch, not two).
//
// The reference (behaviour and parameters only — its repo is GPL-3.0, nothing here is copied): `cyanfish.dj-all`
// `client/engine-pixi.js` writes one factor set per frame into PIXI objects —
//
//   yK = 1 − (1 − M)·s                                (engine-pixi.js:277, 290)   height
//   xK = (1 + (W − 1)·s) · cos θ                      (engine-pixi.js:278, 291-294) width × the turn
//   s  = squashProfile(t/Tq + φ)                      (config.js:238-244)        .4 down, .4 up, .2 at rest
//   θ  = 2π·(t/Ts + φ)                                (engine-pixi.js:286)
//
// with the factory defaults `spinMode: 'axis'`, `spinPeriod: 67`, `squashPeriod: 38`, `squashMinPct: 60`,
// `widthMaxPct: 110` (config.js:129-135) at FPS 60 (config.js:27) — i.e. 1.116667 s per turn and .633333 s per squash
// pulse, 60% of the height and 110% of the width, one phase for every element (`phase` is 0 unless its optional random
// offset is on, config.js:256-259). ★ `'axis'` is a **width multiplier**, never a `rotation`: the element is mirrored
// through the edge-on moment (its `xK` is allowed to go negative, engine-pixi.js:292-294). These are the **defaults**;
// a plugin may ask for its own `turn` / `squash` / `pulse` in the `effect` message (`tune`, shared/plugins/ui.js
// UI_ROTATE_TUNE, `resolveTune` below), exactly as it may for the HUD's half in the stylesheet.
//
// ★★ **The owner's local tuning — and why it is not in this file:** the owner tuned the 粥友的酒 button until it felt
// right (turn ×1.15 faster ⇒ 0.971014 s, the squash 20% deeper ⇒ 48% of the height taken away, 52% at the lowest, the
// pulse ×1.375 ⇒ 0.460605 s). Those numbers are the **plugin's**, sent in its `effect` message (`tune`,
// plugins-src/dj-wine/index.template.html), so they apply to that one button only. This module keeps the reference's
// numbers as its defaults (writing the owner's values here would silently change every button — the bug this
// parameterisation replaced), and the HUD half in public/css/screens/game.css reads the same `tune` for the same reason.
//
// Its targets are picked by view kind over the host's view map (engine-pixi.js:97-126; the table is elements.js:354-364):
// op / enemy / token → `UnitView.body`, item → `ItemView.plate`, device → its screen-absolute Graphics with a
// pivot + position swap. `body` and `plate` are both anchored at the unit's feet, so "each part turns about its own
// pivot" is the same picture as "the unit turns about its feet".
//
// Ours is one level up, and that is why it can be exact: every field view already **has** a root container
// (`units.js:721` UnitView.root, `units.js:2393` ItemView.root — both added to `layers.units`), every display object of
// the view is a child of it, and the host never writes `root.scale` or `root.rotation` (the only other `r.root.scale`
// writes in the renderer are the bars' own containers, units.js:1925/1953 — different objects). So **one transform per
// unit** reproduces the reference's per-part result, and one saved pair of numbers per unit puts it back: `off` restores
// the exact numbers the container had before the first write — not `1`, the host's numbers.
//
// What this deliberately does not turn (the reference's other groups): the unit bars (`layers.bars` — a separate
// container per unit, no child of the root; turning those is the reference's per-container pivot swap), the damage
// numbers and the effects, the board's own geometry (grid, tiles, highlights — `layers.ground` / `tiles`), and the
// devices (a crate / turret draws its Graphics in screen-absolute coordinates straight into `layers.units`, with no
// container of its own). The first three are not 棋子 / 敌人 / 装备 either; the board must stay readable.
//
// Only a transform: no texture, mesh, sim value or unit record is written, nothing is rebuilt and no number is
// re-derived (the same rule `units-gif` follows, render/unitsGif.js). A view that appears while the effect is on is
// picked up by the next frame with its own baseline; one that leaves the field takes its (destroyed) container with it
// and is forgotten. `prefers-reduced-motion: reduce` refuses it here too, like the host and the stylesheet.

import { normalizeRotateTune } from '../../../shared/plugins/ui.js';

/** Seconds per turn: 67 frames at 60 fps (the reference's `spinPeriod`, config.js:131). The default, not the rule. */
export const TURN_PERIOD = 67 / 60;
/** Seconds per squash pulse: 38 frames at 60 fps (the reference's `squashPeriod`, config.js:132). */
export const SQUASH_PERIOD = 38 / 60;
/** The lowest the squash takes the height (the reference's `squashMinPct` 60, config.js:133). */
export const SQUASH_MIN = 0.6;
/** The widest the squash takes the width (the reference's `widthMaxPct` 110, config.js:134). */
export const WIDTH_MAX = 1.1;
/** The pulse's two linear legs: `.4` down, `.4` up, the rest at rest (config.js:236-244, `gm-dj-squash`). */
export const SQUASH_IN = 0.4;
export const SQUASH_OUT = 0.4;

/**
 * The three numbers one `dj-rotate` look is drawn with, resolved: `{ turn, squash, pulse }` — seconds per turn, the
 * fraction of the height the pulse takes away, seconds per pulse. A plugin may send any of them in its `effect`
 * message's `tune` (`UI_ROTATE_TUNE`, shared/plugins/ui.js — already bounded by the validator there); this only keeps
 * the module safe on its own and falls back to the reference for whatever is missing or out of range. `squash` is the
 * fraction *removed*, so the height at the peak is `1 - squash` (the reference's 0.4 ⇒ 60%).
 * @param {unknown} tune
 * @returns {{ turn: number, squash: number, pulse: number }}
 */
export function resolveTune(tune) {
  const t = normalizeRotateTune(tune) || {};
  return {
    turn: typeof t.turn === 'number' ? t.turn : TURN_PERIOD,
    squash: typeof t.squash === 'number' ? t.squash : 1 - SQUASH_MIN,
    pulse: typeof t.pulse === 'number' ? t.pulse : SQUASH_PERIOD,
  };
}

/**
 * The turn's eight samples (public/css/screens/game.css `gm-dj-turn`): `cos θ` at 0°, 45°, … 315°, linearly joined —
 * the same values the DOM animation passes through, so the canvas and the HUD are in the same phase.
 */
const TURN_SAMPLES = Object.freeze([1, Math.SQRT1_2, 0, -Math.SQRT1_2, -1, -Math.SQRT1_2, 0, Math.SQRT1_2]);

const frac = (x) => x - Math.floor(x);

/** The horizontal turn at `t` seconds: `cos θ` as the DOM's `gm-dj-turn` keyframes sample it (1 → 0 → −1 → 1). The
 *  optional `tune` is the requesting plugin's `{ turn, squash, pulse }` (`resolveTune`); absent = the reference's. */
export function turnAt(t, tune) {
  const { turn } = resolveTune(tune);
  const u = frac(Number(t) / turn) * TURN_SAMPLES.length;
  const i = Math.floor(u) % TURN_SAMPLES.length;
  const a = TURN_SAMPLES[i];
  const b = TURN_SAMPLES[(i + 1) % TURN_SAMPLES.length];
  return a + (b - a) * (u - Math.floor(u));
}

/** The squash amount at `t` seconds: 0 = the height as drawn, 1 = the lowest the pulse goes. `pulse` is the
 *  requesting plugin's seconds per pulse; absent = the reference's .633333 s. */
export function squashAt(t, tune) {
  const { pulse } = resolveTune(tune);
  const u = frac(Number(t) / pulse);
  if (u < SQUASH_IN) return u / SQUASH_IN;
  if (u < SQUASH_IN + SQUASH_OUT) return 1 - (u - SQUASH_IN) / SQUASH_OUT;
  return 0;
}

/**
 * The factors one frame writes, as multipliers of a container's own scale:
 * `{ x: (1 + (W−1)·s)·cos θ, y: 1 − D·s, s }` for the tune's `squash` D (the reference's .4) — exactly the DOM's
 * `scale: calc((1 + .1·s) * turn) calc(1 − D·s)` (public/css/screens/game.css).
 * @param {number} t seconds since the effect was switched on
 * @param {{ turn?: number, squash?: number, pulse?: number }} [tune] the requesting plugin's numbers
 * @returns {{ x: number, y: number, s: number }}
 */
export function factorsAt(t, tune) {
  const { squash } = resolveTune(tune);
  const s = squashAt(t, tune);
  return { x: (1 + (WIDTH_MAX - 1) * s) * turnAt(t, tune), y: 1 - squash * s, s };
}

/** `prefers-reduced-motion` leaves the effect off altogether (the plugin host and the stylesheet check too). */
function reducedMotion() {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * The field side of `dj-rotate`, for one field view.
 * @param {{ views?: Map<any, any>, now?: () => number, tune?: unknown }} [opts] the live view map (`render/app.js`
 *   `views`), its clock, and the requesting plugin's starting numbers (`resolveTune`; absent = the reference's)
 */
export function createDjRotate({ views = new Map(), now = () => performance.now(), tune } = {}) {
  let on = false;
  let startAt = 0;
  /** The numbers this instance is drawing with: the requester's `tune`, or the reference's (resolved once per change). */
  let cur = resolveTune(tune);
  /** @type {Map<any, { sx: number, sy: number }>} root container → its own scale, read before the first write */
  const saved = new Map();
  const last = { x: 1, y: 1, s: 0 };

  /** One frame: the same factor for every unit (the reference's shared phase), each times its own baseline scale. */
  function apply(t) {
    const k = factorsAt(t, cur);
    last.x = k.x; last.y = k.y; last.s = k.s;
    for (const v of views.values()) {
      const root = v && v.root;
      if (!v || v.destroyed || !root || !root.scale) continue;
      let rec = saved.get(root);
      if (!rec) { rec = { sx: root.scale.x, sy: root.scale.y }; saved.set(root, rec); }
      root.scale.set(rec.sx * k.x, rec.sy * k.y);
    }
    // a unit that left the field took its container with it: nothing is left to put back
    for (const root of saved.keys()) if (root.destroyed) saved.delete(root);
  }

  /** Put every touched container's own scale back, number for number, and forget them. */
  function restore() {
    for (const [root, rec] of saved) {
      if (!root || root.destroyed || !root.scale) continue;
      root.scale.set(rec.sx, rec.sy);
    }
    saved.clear();
  }

  /**
   * Turn the canvas half on or off, optionally with the requesting plugin's numbers. `false` is idempotent. Returns
   * whether it is on after the call — `false` when `prefers-reduced-motion: reduce` refuses it.
   *
   * `nextTune` is what the requester in force wants: `null` = the reference's numbers, omitted = keep the current ones
   * (the constructor's `tune`, or whoever had it before). A call while it is already on with different numbers is a
   * **handover** (another plugin pressed, or one let go and the previous requester's numbers come back): the numbers are
   * swapped and the clock restarts at t = 0, the phase a fresh start has — every container keeps its own baseline, so
   * nothing of the previous requester survives and both halves (HUD, field) start their new periods together. The same
   * numbers twice change nothing (the period is not restarted).
   * @param {boolean} want @param {unknown} [nextTune]
   */
  function setOn(want, nextTune) {
    const next = !!want;
    if (next && nextTune !== undefined) {
      const n = resolveTune(nextTune);
      const changed = n.turn !== cur.turn || n.squash !== cur.squash || n.pulse !== cur.pulse;
      if (changed) {
        cur = n;
        if (on) { startAt = now(); apply(0); }   // t = 0 is the identity; the new periods start together
      }
    }
    if (next === on) return on;
    if (!next) { on = false; restore(); return on; }
    if (reducedMotion()) return false;
    startAt = now();
    on = true;
    apply(0);              // t = 0 is the identity; this is what records each container's own scale
    return on;
  }

  return {
    /** Whether it is on (and writing this frame). */
    get on() { return on; },
    setOn,
    /** One frame, called by the render app right before PIXI draws (render/app.js `setDjRotate`). */
    tick() { if (on) apply((now() - startAt) / 1000); },
    /** Dev / test reading: the state, the numbers in force and the factors of the last frame. */
    stats() {
      return {
        on, views: views.size, containers: saved.size, x: last.x, y: last.y, s: last.s,
        turn: cur.turn, squash: cur.squash, pulse: cur.pulse,
      };
    },
    /** Unmount (the field view is going away): off first, so every container is left as it was. */
    destroy() { setOn(false); },
  };
}
