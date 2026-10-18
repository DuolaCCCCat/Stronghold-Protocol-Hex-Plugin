// Watch emotes (观战表情, the 2026-10-18 request): while watching another player, a small button beside
// 交流 lets the watcher pick an emote from the same 交流 list and send it with `g.emote { id, watch }`. The server
// relays it as `m.emote { playerId, id, watch }`. The WATCHED player's own screen always plays the falls; anyone
// currently watching that target also plays them (live, and replayed from the last 2 s when they switch to it); the
// SENDER's own screen plays them only while its 「在自己屏幕显示弹幕」 switch is on (otherwise just the 连击 × N
// counter); a client watching somebody else (or nobody) plays none. Every client that receives the event (sender,
// target, any third party) shows the compact 「名字 ×n」 through the normal team-panel emote bubble, anchored beside
// the sender's avatar, n accumulated over 2 s. Nothing in the room state, the content hash or the battle data changes.
//
// The fall follows the shape of the official barrage (Cloudnyco/Duel-Channel `web/src/emote.js`, docs/ARCHITECTURE.md
// "飘落弹幕（轨道选择、缓动曲线）" — read for the parameter structure and the animation idea, no code copied): a fixed
// lane count, a random point inside the chosen lane, one eased 3.2 s fall from above the top edge to below the bottom
// edge, and a growing / shrinking scale. This implementation adds the small sway, spin and the fade-out the request
// asks for, and drives it with CSS keyframes rather than per-frame DOM writes.
//
// Clicks are PULSED (a follow-up): the button counts clicks in a 200 ms window (emotes.js
// WATCH_EMOTE_PULSE_MS) and sends ONE `g.emote { id, watch, count }` when the window closes — at most ~5 messages/s
// per player. The receiving screens expand `count` EXACTLY (click 5 times → 5 falls, 85 → 85): the merge only lowers
// the request count, never the number of falling emotes. Every particle randomizes its own lane / position / delay /
// speed. The message carries no picture, only the catalogue id.
//
//   watchEmoteSide   which screen an `m.emote { watch }` belongs to (the watched player's, the watcher's, or neither)
//   watchRainSide    who gets a fall: the target always, a watcher of that target, the sender only with its switch on
//   rainBurst        the per-event particle parameters (pure; a stub RNG makes it testable)
//   WatchEmoteRain   the layer over the field: mounts on each new event, removes a particle when its fall ends
//   WatchEmoteCombo  the sender's centre-screen 连击 × N counter

import { useEffect, useRef, useState } from '../../vendor/hooks.module.js';
import { html } from './components.js';
import { EmoteArt } from './emotes.js';
import { t } from '../../../shared/i18n.js';

/** How long the sender's combo stays after the last click before it fades (the 1.5–2 s window). */
export const WATCH_EMOTE_COMBO_HOLD_MS = 1800;
/** The fade-out itself (the combo node stays this long, then unmounts). */
export const WATCH_EMOTE_COMBO_OUT_MS = 240;
/** The compact 「名字 ×n」 notice: n accumulates for 2 s after the last burst, then fades. Every client shows it. */
export const WATCH_EMOTE_NOTICE_HOLD_MS = 2000;
export const WATCH_EMOTE_NOTICE_OUT_MS = 240;
/** How long received watch events stay replayable per target (the 2 s window). */
export const WATCH_EMOTE_REPLAY_MS = 2000;

const cx = (...p) => p.flat().filter(Boolean).join(' ');
// Replay cache (per client, in memory): target playerId → its recent watch emotes. Fed by every received event;
// taken when this client switches to watching that target. Not persisted; entries older than 2 s are dropped.
const replayCache = new Map();

/** Remember a received `m.emote { watch }` for its target (call for every event, whichever screen it belongs to). */
export function rememberWatchEvent(e, now = Date.now()) {
  if (!e || typeof e.watch !== 'string' || !e.watch) return;
  const at = Number.isFinite(Number(e.at)) ? Number(e.at) : now;
  const list = (replayCache.get(e.watch) || []).filter((x) => now - x.at < WATCH_EMOTE_REPLAY_MS);
  list.push({ at, seq: Number(e.seq) || 0, watch: e.watch, playerId: e.playerId, id: e.id, count: Math.max(1, Math.trunc(Number(e.count) || 1)) });
  replayCache.set(e.watch, list);
}

/** The last-2-s events cached for a target (expired ones dropped), oldest first. */
export function takeWatchReplay(target, now = Date.now()) {
  const list = (replayCache.get(target) || []).filter((x) => now - x.at < WATCH_EMOTE_REPLAY_MS);
  if (list.length) replayCache.set(target, list);
  else replayCache.delete(target);
  return list;
}

/** Test / session helper: forget every cached replay. */
export function clearWatchReplay() { replayCache.clear(); }

// Parameter structure adapted from the official barrage prefab (the reference above): 9 lanes, 3.2 s, scale 0.8 → 1.1.
export const RAIN = Object.freeze({
  LANES: 9,
  LEFT_MIN: 0.04, LEFT_MAX: 0.96, // fraction of the field width (the lane's random point stays inside this)
  DELAY_MAX_MS: 620,
  DURATION_MIN_MS: 2700, DURATION_MAX_MS: 3700, FALL_MS: 3200, // FALL_MS = the official 3.2 s (the middle of the range)
  SWAY_MIN_REM: 0.1, SWAY_MAX_REM: 0.42,
  SPIN_MIN_DEG: -12, SPIN_MAX_DEG: 12,
  SIZE_MIN_REM: 0.46, SIZE_MAX_REM: 0.66,
});

const num = (v, lo, hi) => Math.min(hi, Math.max(lo, Number(v) || 0));
const round2 = (v) => Math.round(v * 100) / 100;

/**
 * Which screen an emote event belongs to: `'target'` for the watched player's own screen, `'watcher'` for the screen
 * of somebody watching that player, or null (an ordinary 交流 emote, another pair's event, history).
 * @param {{ watch?: string|null, playerId?: string, id?: string, seq?: number }} e
 * @param {{ myId?: string, watchingOther?: boolean, watchedPid?: string|null }} o
 */
export function watchEmoteSide(e, { myId = '', watchingOther = false, watchedPid = null } = {}) {
  if (!e || typeof e.watch !== 'string' || !e.watch) return null;
  if (e.watch === myId) return 'target';
  if (watchingOther && watchedPid && e.watch === watchedPid) return 'watcher';
  return null;
}

/**
 * Who actually gets a fall: the watched player's own screen always; anyone currently watching that target (live, or
 * replayed when they switch to it); the SENDER's screen only while 「在自己屏幕显示弹幕」 is on. A client watching
 * somebody else (or nobody) gets no fall.
 * @param {{ watch?: string|null, playerId?: string }} e
 * @param {{ myId?: string, ownRains?: boolean, watchingOther?: boolean, watchedPid?: string|null }} o
 */
export function watchRainSide(e, { myId = '', ownRains = false, watchingOther = false, watchedPid = null } = {}) {
  if (!e || typeof e.watch !== 'string' || !e.watch) return null;
  if (e.watch === myId) return 'target';
  if (!watchingOther || !watchedPid || e.watch !== watchedPid) return null;
  if (e.playerId === myId) return ownRains ? 'sender' : null;
  return 'watcher';
}

/**
 * Particle parameters of one pulse: exactly `count` drops (one per click — click 5 times, 5 falls; click 85, 85),
 * each with its own lane / position / delay / speed. Pure for a given `rand` (a `() => [0,1)` source; tests pass a
 * stub).
 * @param {() => number} [rand]
 * @param {number} [count] the pulse's click count (default 1)
 * @returns {Array<{ lane:number, left:number, delay:number, duration:number, sway:number, spin:number, size:number }>}
 */
export function rainBurst(rand = Math.random, count = 1) {
  const r = typeof rand === 'function' ? rand : Math.random;
  const n = Math.max(1, Math.trunc(Number(count) || 1));
  const out = [];
  for (let i = 0; i < n; i++) {
    const lane = Math.min(RAIN.LANES - 1, Math.floor(num(r(), 0, 0.999999) * RAIN.LANES));
    // the official prefab spawns at (lane + 0.15 + 0.7 * random) / lanes, clamped to the field
    const across = num((lane + 0.15 + 0.7 * num(r(), 0, 1)) / RAIN.LANES, RAIN.LEFT_MIN, RAIN.LEFT_MAX);
    out.push({
      lane,
      left: round2(across * 100),
      delay: Math.round(num(r(), 0, 1) * RAIN.DELAY_MAX_MS),
      duration: Math.round(RAIN.DURATION_MIN_MS + num(r(), 0, 1) * (RAIN.DURATION_MAX_MS - RAIN.DURATION_MIN_MS)),
      sway: round2(RAIN.SWAY_MIN_REM + num(r(), 0, 1) * (RAIN.SWAY_MAX_REM - RAIN.SWAY_MIN_REM)),
      spin: Math.round(RAIN.SPIN_MIN_DEG + num(r(), 0, 1) * (RAIN.SPIN_MAX_DEG - RAIN.SPIN_MIN_DEG)),
      size: round2(RAIN.SIZE_MIN_REM + num(r(), 0, 1) * (RAIN.SIZE_MAX_REM - RAIN.SIZE_MIN_REM)),
    });
  }
  return out;
}

/** Milliseconds a particle lives: its delay + fall + a small margin for the fade / removal. */
export const particleLife = (p) => Math.max(0, Math.round(p.delay + p.duration + 80));

let rainSeq = 0;

/**
 * The falling-emote layer over the field. `events` is the store's `emotes` array (m.emote records); a new record with
 * a `watch` field reports its bubble to `onReceive` on EVERY client, spawns `rainBurst()` particles on the target's
 * screen and on any screen currently watching that target (the sender only with `ownRains`), and is cached per target
 * for the 2 s switch replay. A view switch clears the previous board's particles first, then the replay adds the
 * target's recent ones. `onReplay(entries, target)` lets the screen raise the same bubble again.
 * @param {{ events: Array<any>, myId: string, watchingOther: boolean, watchedPid: string|null, ownRains?: boolean,
 *   onReceive?: (e: any)=>void, onReplay?: (entries: Array<any>, target: string)=>void }} props
 */
export function WatchEmoteRain({ events, myId, watchingOther, watchedPid, ownRains = false, onReceive, onReplay }) {
  const [items, setItems] = useState([]);
  const seen = useRef(null);
  const timers = useRef(new Map());
  const prevWatch = useRef({ watchingOther, watchedPid });
  const onReceiveRef = useRef(onReceive);
  onReceiveRef.current = onReceive;
  const onReplayRef = useRef(onReplay);
  onReplayRef.current = onReplay;
  const ownRainsRef = useRef(ownRains);
  ownRainsRef.current = ownRains;

  // New store events → the target's / its watchers' falls and EVERY client's compact 「名字 ×n」 bubble. Every event
  // also goes into the per-target 2 s replay cache.
  useEffect(() => {
    const list = Array.isArray(events) ? events : [];
    if (seen.current == null) {
      for (const e of list) if (e?.watch) rememberWatchEvent(e, Number(e.at) || Date.now());
      seen.current = list.length ? Number(list[list.length - 1].seq) || 0 : 0;
      return;
    }
    let top = seen.current;
    const fresh = [];
    for (const e of list) {
      const seq = Number(e?.seq) || 0;
      if (seq <= seen.current || !e?.watch) continue;
      rememberWatchEvent(e, Number(e.at) || Date.now());
      onReceiveRef.current?.(e); // every client, the sender's own echo included (the bubble is the same for all)
      const side = watchRainSide(e, { myId, ownRains, watchingOther, watchedPid });
      if (side) fresh.push({ e, side });
    }
    if (list.length) top = Math.max(top, ...list.map((e) => Number(e?.seq) || 0));
    seen.current = top;
    if (!fresh.length) return;
    const added = [];
    for (const { e, side } of fresh) {
      const n = Math.max(1, Math.trunc(Number(e.count) || 1));
      for (const p of rainBurst(Math.random, n)) added.push({ ...p, id: e.id, receiver: side, key: `r${++rainSeq}` });
    }
    setItems((cur) => [...cur, ...added]);
  }, [events, myId, ownRains, watchingOther, watchedPid]);

  // A view switch: drop the previous board's particles, then replay the new target's last 2 s from the cache (counts
  // exactly, fresh random positions) and raise the same bubble. Only the screens that should fall get particles: the
  // target, a watcher of it, or the sender with its own-rain switch on. Doing both in one effect keeps the order.
  useEffect(() => {
    const prev = prevWatch.current;
    prevWatch.current = { watchingOther, watchedPid };
    if (prev.watchingOther === watchingOther && prev.watchedPid === watchedPid) return;
    setItems([]);
    const target = watchingOther ? watchedPid : null;
    if (!target) return;
    const rain = ownRainsRef.current;
    const cache = takeWatchReplay(target);    const entries = cache.filter((e) =>
      !!watchRainSide({ ...e, at: Date.now() }, { myId, ownRains: rain, watchingOther: true, watchedPid: target }));
    if (!entries.length) return;
    const added = [];
    for (const e of entries) {
      const side = watchRainSide(e, { myId, ownRains: rain, watchingOther: true, watchedPid: target });
      if (!side) continue;
      for (const p of rainBurst(Math.random, e.count)) added.push({ ...p, id: e.id, receiver: side, key: `r${++rainSeq}` });
    }
    setItems((cur) => [...cur, ...added]);
    onReplayRef.current?.(entries, target);
  }, [watchingOther, watchedPid, myId]);

  // switching 「在自己屏幕显示弹幕」 off hides the sender's own falls at once
  useEffect(() => { if (!ownRains) setItems((cur) => cur.filter((p) => p.receiver !== 'sender')); }, [ownRains]);

  // A particle leaves when its fall (delay + duration + fade margin) is over.
  useEffect(() => {
    const live = new Set(items.map((p) => p.key));
    for (const p of items) {
      if (timers.current.has(p.key)) continue;
      const timer = setTimeout(() => {
        timers.current.delete(p.key);
        setItems((cur) => cur.filter((x) => x.key !== p.key));
      }, particleLife(p));
      timers.current.set(p.key, timer);
    }
    for (const [key, timer] of [...timers.current]) {
      if (!live.has(key)) { clearTimeout(timer); timers.current.delete(key); }
    }
  }, [items]);

  useEffect(() => () => { for (const timer of timers.current.values()) clearTimeout(timer); timers.current.clear(); }, []);

  return html`<div class="gm__emote-rain" data-watch-rain data-count=${items.length} aria-hidden="true">
    ${items.map((p) => html`<span key=${p.key} class="gm__emote-rain__drop" data-receiver=${p.receiver} data-emote=${p.id}
        style=${`left:${p.left}%;--rain-delay:${p.delay}ms;--rain-dur:${p.duration}ms;--rain-sway:${p.sway}rem;--rain-spin:${p.spin}deg;--rain-size:${p.size}rem`}>
      <span class="gm__emote-rain__inner"><${EmoteArt} id=${p.id} /></span>
    </span>`)}
  </div>`;
}

/**
 * The sender's centre-screen combo counter (`连击 × N`): one increment per click, a short pop on each change, and a
 * fade-out when `leaving` is set (screens/game.js holds it WATCH_EMOTE_COMBO_HOLD_MS after the last click, then
 * WATCH_EMOTE_COMBO_OUT_MS for this fade). Nothing falls on the sender's own screen.
 * @param {{ n: number, leaving?: boolean }} props
 */
export function WatchEmoteCombo({ n, leaving = false }) {
  const value = Math.max(0, Math.trunc(Number(n) || 0));
  if (!value) return null;
  return html`<div class=${cx('gm__combo', leaving && 'is-out')} data-watch-combo=${value} aria-hidden="true">
    <span key=${value} class="gm__combo__num">${t('连击 × {n}', { n: value })}</span>
  </div>`;
}
